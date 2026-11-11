// The speaker, through WebAudio.
//
// There is no sound chip. `$C030` is a soft switch and every access flips the speaker cone to
// the other position, so a sound is a list of cycle numbers and the pitch is how long the 6502
// spent between two of them. `../game/sound.js` is an interpreter for the two generators that
// produce those lists, and `render` turns a list into samples by averaging the 1-bit level
// over each sample's own span of cycles - because at 1 MHz a point reading of a square wave
// this fast aliases badly, and a cone with mass averages anyway.
//
// **One piece of state has to live here and nowhere else.** `$1D52` keeps a 16-bit shift
// register at `$1D4B`-`$1D4C` that *nothing initialises*, so a sound depends on where the last
// sound left it: over five seeds the same routine came out 108 toggles one time and 158
// another. `play` takes that state and returns the next one, and this class is what carries it
// across the whole session. Reset it between games and the noise stops being the disk's.
//
// The loop hands back a list of routine addresses - `$1F73` for the player's shot, `$1DD3` for
// a kill, and so on - in the order it asked for them, which is what `enqueue` takes.
import { SOUNDS } from '../game/sounds.js';
import { play, render, CPU_HZ } from '../game/sound.js';

/** By the address the loop names, since that is the only identifier it has. */
const BY_ADDRESS = new Map(SOUNDS.map((s) => [s.at, s]));

export class Audio {
  /**
   * @param {object} [opts] `volume` 0 to 1, `cpuHz` only for an experiment
   */
  constructor({ volume = 0.35, cpuHz = CPU_HZ } = {}) {
    this.ctx = null;
    this.gain = null;
    this.volume = volume;
    this.cpuHz = cpuHz;
    /** The shift register and Y, carried from sound to sound. See above. */
    this.state = null;
    this.muted = false;
    /** Set the first time the speaker refuses, so the page can say the sound has gone. */
    this.broken = null;
    /** What has been played, newest last, for the shell to show. */
    this.log = [];
  }

  /**
   * Start the audio context.
   *
   * Browsers will not let this happen before a gesture, so the shell calls it from the same
   * handler that starts the game and again on any later gesture if it is still suspended.
   */
  async resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.muted ? 0 : this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx.state === 'running';
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : this.volume;
  }

  /**
   * Let the context go.
   *
   * The page builds a fresh driver for every game - `Shell` for a flight, `Boot` for the whole
   * disk - and each owns one of these, so without this every boot and every "fly again" left
   * an AudioContext open and running. Browsers cap them at a handful: measured in the page,
   * three boot-and-fly cycles opened six, which is the limit Chrome enforces. `resume` builds
   * a new one on demand, so a closed Audio is usable again rather than dead.
   */
  close() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    // Closing one that is already closing is not an error anybody can act on.
    Promise.resolve(ctx.close()).catch(() => {});
  }

  /**
   * Play one routine, by its address.
   *
   * The state is advanced **whether or not there is an audio context**, so muting the shell
   * does not change what the next sound sounds like. That matters: the register is part of the
   * game's state, not of its output.
   */
  one(address) {
    const sound = BY_ADDRESS.get(address);
    if (!sound) return null;
    const result = play(sound, this.state);
    this.state = result.state;
    this.log.push(sound.name);
    if (this.log.length > 12) this.log.shift();
    if (!this.ctx || this.muted || !result.toggles.length) return sound.name;

    this.emit(render(result, { sampleRate: this.ctx.sampleRate, cpuHz: this.cpuHz }));
    return sound.name;
  }

  /** A pass's worth, in the order the loop asked for them. */
  enqueue(addresses) {
    const played = [];
    for (const a of addresses) {
      const name = this.one(a);
      if (name) played.push(name);
    }
    return played;
  }

  /**
    * Play a waveform straight - a list of cycle numbers and how long it runs.
    *
    * The music comes this way rather than through `one()`: `music.js` produces the same
    * shape `sound.js` does, so the same renderer turns it into samples, but it is not one
    * of the seven effects and has no parameter block.
    *
    * @param {{cycles: number, toggles: number[]}} wave
    * @returns {number} how many seconds it will take, so a caller can wait it out
    */
  waveform(wave, { name = 'music' } = {}) {
    const seconds = wave.cycles / this.cpuHz;
    this.log.push(name);
    if (this.log.length > 12) this.log.shift();
    if (!this.ctx || this.muted || !wave.toggles.length) return seconds;
    this.playing = this.emit(render(wave, { sampleRate: this.ctx.sampleRate,
      cpuHz: this.cpuHz }));
    return seconds;
  }

  /**
   * Hand a rendered waveform to the speaker, and **never throw doing it**.
   *
   * Sound is the one part of this port that cannot be allowed to stop the game. The chain runs
   * the tune through a `CALL` handler, and `chainStep` treats anything that throws out of a
   * program as fatal - so a context that has been closed, a browser that will not start one,
   * or a buffer method that is not there left the player on a dead screen with the disk half
   * booted. Worse, `flightStep` calls `enqueue` with no guard at all, so the same failure in
   * flight threw straight out of the animation frame.
   *
   * Found by a harness whose fake AudioContext was missing `copyToChannel` - which is as
   * plausible a failure as any of the real ones.
   *
   * @returns {object|null} the source that is playing, or null if nothing is
   */
  emit(samples) {
    try {
      const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      src.start();
      return src;
    } catch (e) {
      // Once, and then quietly: a speaker that fails once will fail every frame.
      if (!this.broken) {
        this.broken = e.message;
        this.log.push(`silent: ${e.message}`);
      }
      return null;
    }
  }

  /** Cut whatever is playing short, which is what a keypress does to a tune. */
  cut() {
    if (this.playing) { try { this.playing.stop(); } catch (e) { /* already done */ } }
    this.playing = null;
  }

  /** Between games. The register is not reset by the disk either, but a reload is a reload. */
  reset() {
    this.state = null;
    this.log = [];
  }
}
