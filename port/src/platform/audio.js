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

    const samples = render(result, { sampleRate: this.ctx.sampleRate, cpuHz: this.cpuHz });
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start();
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
    const samples = render(wave, { sampleRate: this.ctx.sampleRate, cpuHz: this.cpuHz });
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start();
    this.playing = src;
    return seconds;
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
