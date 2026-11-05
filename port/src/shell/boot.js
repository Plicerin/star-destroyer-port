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
import { Game } from '../game/loop.js';
import { paint, HGR_W, HGR_H } from '../platform/hgr.js';
import { Input } from '../platform/input.js';
import { Audio } from '../platform/audio.js';
import { FRAME_MS, DISK_FPS } from './main.js';

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

    this.show = new Presentation(image, { rnd });
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
    if (now < this.holdUntil) return;
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
