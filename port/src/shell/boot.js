// The whole game, from the boot to the high scores.
//
// `Shell` in `main.js` runs a flight. This runs the disk: the Applesoft chain for every screen
// between flights, and the flight loop when the chain reaches a `BRUN` of a mission binary.
// The two share one 64K image, which is the point - the BASIC pokes the interface, the binary
// reads it, and the handover is the same memory rather than an argument.
//
// The clock has two speeds because the game does. A presentation screen is Applesoft and runs
// as fast as Applesoft did, which for these programs is "faster than anyone notices"; a flight
// is 389 ms a pass. So the chain is stepped until it needs something, and a flight is paced.
import { Presentation, WAITING } from './presentation.js';
import { YIELD } from '../game/applesoft.js';

const YIELD_CALL = YIELD.call;
import { Game } from '../game/loop.js';
import { paint, HGR_W, HGR_H } from '../platform/hgr.js';
import { Input } from '../platform/input.js';
import { Audio } from '../platform/audio.js';
import { FRAME_MS, DISK_FPS } from './main.js';
import { play as playTune } from '../game/music.js';

/** How long a screen that is only a picture stays up before the chain moves on. */
export const PAUSE_MS = 2500;

export class Boot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array} image the .dsk
   * @param {object} [opts] `fps` for the flight, `tint`, `rnd`
   */
  constructor(canvas, image, { fps = DISK_FPS, tint = 'colour', rnd = Math.random } = {}) {
    canvas.width = HGR_W;
    canvas.height = HGR_H;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.frame = this.ctx.createImageData(HGR_W, HGR_H);
    this.fps = fps;
    this.tint = tint;

    this.show = new Presentation(image, { rnd, calls: {
      /**
       * `CALL 768` - PLAYER.MODULE. The three programs that play music BLOAD a tune at
       * $6000 and point $1E/$1F at it, so the tune is read from the image rather than
       * being passed in.
       *
       * The original blocks until the tune ends or a key is pressed, so this does too:
       * it returns how long the tune takes and the chain holds there. That is why the
       * key test at $0371 exists, and why the difficulty screen is bearable.
       */
      0x0300: (host) => {
        const at = host.mem[0x1E] | (host.mem[0x1F] << 8);
        if (!at) { host.note('CALL $300', 'no tune pointer at $1E/$1F'); return null; }
        const wave = playTune(host.mem.subarray(at, at + 4096));
        const seconds = this.audio.waveform(wave, { name: 'tune' });
        return { async: true, seconds };
      },
    } });
    this.input = new Input(window).attach();
    this.audio = new Audio();
    this.game = null;
    this.raf = null;
    this.last = null;
    this.accumulator = 0;
    this.holdUntil = 0;
    this.state = 'idle';
    this.onStatus = null;
    this.flights = 0;
  }

  start() {
    this.show.load('START');
    this.state = 'chain';
    this.audio.resume();
    if (this.raf === null) this.raf = requestAnimationFrame((t) => this.tick(t));
    return this;
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.input.detach();
  }

  /** Whatever the soft switches say is on screen. */
  draw() {
    this.show.host.paint(this.frame, {
      hiresPaint: paint,
      tint: this.tint,
      flashOn: Math.floor(Date.now() / 250) % 2 === 0,
    });
    this.ctx.putImageData(this.frame, 0, 0);
  }

  tick(now) {
    this.raf = requestAnimationFrame((t) => this.tick(t));
    if (this.last === null) { this.last = now; this.draw(); return; }
    const dt = Math.min(now - this.last, 1000);
    this.last = now;

    // The player's keys go to the latch whether anything is looking or not, which is what
    // the hardware does - and is why holding a key through the title works.
    const held = this.input.read();
    if (this.input.down('fire')) this.show.host.pressKey(' ');
    for (const [code, ch] of DIGITS) {
      if (this.input.held.has(code)) this.show.host.pressKey(ch);
    }

    if (this.state === 'chain') this.chainStep(now);
    else if (this.state === 'flight') this.flightStep(dt, held);

    this.draw();
    if (this.onStatus) this.onStatus(this.status());
  }

  chainStep(now) {
    if (now < this.holdUntil) {
      // A key cuts a tune short, as it does on the machine.
      if (this.musicUntil && this.input.held.size > 0) {
        this.audio.cut();
        this.holdUntil = 0;
        this.musicUntil = 0;
      }
      return;
    }
    this.musicUntil = 0;
    let r;
    try {
      // Zero, not one: run() chains internally before it reports, so maxChains 1 walked
      // two programs per call and every picture screen flashed past in a single frame.
      r = this.show.run({ maxChains: 0 });
    } catch (e) {
      this.state = 'stopped';
      this.error = e.message;
      return;
    }
    if (r.waiting === WAITING.flight) {
      this.beginFlight();
      return;
    }
    if (r.waiting === WAITING.key) {
      // The program is asking; the latch is filled from the keyboard above, so just wait.
      return;
    }
    if (r.yield === YIELD_CALL && r.seconds) {
      // A tune is playing. Hold the chain where the machine would hold it, and let a key
      // cut it short the way $0371 does.
      this.holdUntil = now + r.seconds * 1000;
      this.musicUntil = this.holdUntil;
      return;
    }
    if (r.next) {
      // A screen that is only a picture would otherwise flash past in one frame.
      this.holdUntil = now + PAUSE_MS;
      this.show.load(r.next);
      return;
    }
    if (r.waiting === WAITING.ended) this.state = 'stopped';
  }

  beginFlight() {
    this.game = new Game(this.show.mem);
    this.game.setup();
    this.flights++;
    this.accumulator = 0;
    this.state = 'flight';
  }

  flightStep(dt, input) {
    this.accumulator += dt;
    const period = 1000 / this.fps;
    if (this.accumulator < period) return;
    this.accumulator = Math.min(this.accumulator - period, period);
    const r = this.game.pass(input);
    this.audio.enqueue(r.sounds);
    if (!r.done) return;
    this.game = null;
    this.show.flightDone();
    this.state = 'chain';
    this.holdUntil = 0;
  }

  status() {
    const s = this.show.status();
    return {
      ...s,
      state: this.state,
      flights: this.flights,
      error: this.error ?? null,
      fps: this.fps,
    };
  }
}

/** The difficulty screen wants a digit, so the digits reach the latch too. */
const DIGITS = [['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'],
  ['Numpad1', '1'], ['Numpad2', '2'], ['Numpad3', '3']];
