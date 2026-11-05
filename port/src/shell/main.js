// The shell: the thing that makes the port a game you can sit in front of.
//
// Everything under `../game` and `../a23d2` is held to the machine by the oracle. None of it
// knows about a canvas, a keyboard or a clock. This file supplies those three and nothing
// else, which is why it has no harness: there is nothing here to be right or wrong about that
// a harness could check, and the parts that *are* checkable live in `../platform`.
//
// **The cadence is the fidelity decision.** One game frame on the disk is 397,000 cycles -
// 389 ms, 2.57 a second - of which about 316,000 is the renderer, so 80% of a frame is
// drawing. That is what the original feels like, and it is slow. The shell runs at that rate
// by default and will not quietly smooth it: `rate` is a QoL switch, off meaning the disk's
// own 2.57 Hz.
//
// The display is the page the game says to show, not the page it just drew. `$8110` holds the
// low byte of a page soft switch and `selectPages` writes it, so the shell reads that and
// paints the other one - which is the double buffer working, and the reason a frame that takes
// 389 ms does not tear.
import { Game, DONE, QUIT, WAVES } from '../game/loop.js';
import { boot } from '../platform/boot.js';
import { paint, pages, shownPage, HGR_W, HGR_H, TINTS } from '../platform/hgr.js';
import { Input, HELP } from '../platform/input.js';
import { Audio } from '../platform/audio.js';
import { IFACE } from '../game/chain.js';
import { SHLD, WARP, MSL, HITS, EMPTY, STEP, FATAL } from '../game/damage.js';

/** 397,000 cycles at 1,020,484 Hz. The disk's own frame time. */
export const FRAME_MS = 389;

export class Shell {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts] `rate` a multiplier on the frame time - 1 is the disk;
   *   `tint` the phosphor; `honest` false to repair the interface DOS corrupts
   */
  constructor(canvas, { rate = 1, tint = 'green', honest = true } = {}) {
    this.canvas = canvas;
    canvas.width = HGR_W;
    canvas.height = HGR_H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.frame = this.ctx.createImageData(HGR_W, HGR_H);
    this.rate = rate;
    this.tint = tint;
    this.honest = honest;

    this.input = new Input(window).attach();
    this.audio = new Audio();
    this.game = null;
    this.mem = null;
    this.bootInfo = null;
    this.paused = false;
    this.over = null;
    this.passes = 0;
    this.accumulator = 0;
    this.last = null;
    this.raf = null;
    /** Called with a status object after every pass, for whatever the page wants to show. */
    this.onStatus = null;
  }

  /**
   * Load the disk and set a flight up.
   *
   * @param {Uint8Array|ArrayBuffer} image the .dsk
   * @param {number} difficulty 1, 2 or 3
   */
  load(image, difficulty = 1) {
    this.bootInfo = boot(image, { difficulty, honest: this.honest });
    this.mem = this.bootInfo.mem;
    this.game = new Game(this.mem);
    this.game.setup();
    this.passes = 0;
    this.over = null;
    this.paused = false;
    this.audio.reset();
    this.draw();
    return this.bootInfo;
  }

  /** Paint whichever page the game is showing. */
  draw() {
    const page = pages(this.mem)[shownPage(this.mem)];
    paint(page, this.frame, { tint: this.tint });
    this.ctx.putImageData(this.frame, 0, 0);
  }

  /** One pass, plus its sounds and its picture. */
  step() {
    const result = this.game.pass(this.input.read());
    this.passes += 1;
    this.audio.enqueue(result.sounds);
    this.draw();
    if (result.done) this.over = result.done;
    if (this.onStatus) this.onStatus(this.status());
    return result;
  }

  /** Everything the panel shows, read out of the image rather than tracked alongside it. */
  status() {
    const m = this.mem;
    const gauge = (a) => (m[a] === EMPTY ? 0 : m[a]);
    return {
      passes: this.passes,
      over: this.over,
      paused: this.paused,
      shields: gauge(SHLD),
      warp: gauge(WARP),
      missiles: gauge(MSL),
      hits: m[HITS],
      fatal: FATAL,
      empty: EMPTY,
      step: STEP,
      waves: WAVES.map((a) => m[a]),
      kills: IFACE.kills.map((a) => m[a]),
      sounds: this.audio.log.slice(-4),
      corrupted: this.bootInfo ? this.bootInfo.corrupted : false,
      repaired: this.bootInfo ? this.bootInfo.repaired : false,
      intended: this.bootInfo ? this.bootInfo.intended : null,
    };
  }

  start() {
    if (this.raf !== null) return;
    this.audio.resume();
    this.last = null;
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      if (this.input.takePause()) this.paused = !this.paused;
      if (this.last === null) { this.last = now; return; }
      const dt = Math.min(now - this.last, 1000);     // a backgrounded tab must not catch up
      this.last = now;
      if (this.paused || this.over) {
        if (this.onStatus) this.onStatus(this.status());
        return;
      }
      this.accumulator += dt;
      const period = FRAME_MS / this.rate;
      // One pass per tick at most: a pass is 389 ms of work on the original and tens of
      // milliseconds here, but catching up several at once would still stutter rather than
      // help, and the game has no notion of elapsed time to correct against.
      if (this.accumulator >= period) {
        this.accumulator = Math.min(this.accumulator - period, period);
        this.step();
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /** The loop's own way out, for a shell that wants to show why it ended. */
  reason() {
    if (this.over === DONE.destroyed) {
      return `destroyed - the binary put $${this.mem[QUIT].toString(16).toUpperCase()}`
        + ' in zero page $00, which is how it tells the BASIC above it';
    }
    if (this.over === DONE.waveClear) {
      return 'wave clear - every counter, every enemy and every piece of debris at zero';
    }
    return null;
  }
}

export { HELP, TINTS };
