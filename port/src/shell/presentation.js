// The chain, running.
//
// `chain.js` knows which program follows which and why. `applesoft.js` runs a program.
// `host.js` gives it a machine to run on. This is the driver that keeps handing one to the
// other: load a program where Applesoft keeps it, run it until it stops for a reason, act on
// the reason, repeat.
//
// A program stops for four reasons and they are the whole interface: it chained (`RUN`), it
// wants a key (`GET`, or the `PEEK($C000)` that `SELECT` and `LOGO1` use), it ran a `BRUN`
// that hands control to 6502, or it ended.
import { Applesoft, YIELD } from '../game/applesoft.js';
import { Host } from '../platform/host.js';
import { openDisk } from '../platform/dsk.js';
import { Engine } from '../a23d2/engine.js';

/** Where Applesoft keeps a program. */
export const TXTTAB = 0x801;

/** The program the boot starts with. DOS's HELLO on this disk. */
export const FIRST = 'START';

/**
 * What one `CALL 24576` costs, measured: 316,000 cycles at 1.0205 MHz.
 *
 * Three frames within 0.8% of each other, 18.6 video frames each - about 95,000 6502
 * instructions to render the whole scene. See *The cadence* in `oracle/DISK_TRUTH.md`.
 */
export const RENDER_SECONDS = 316000 / 1020500;

/** `SD PART2` BRUNs this one: an ordinary flight, which `loop.js`'s `Game` runs. */
export const FLIGHT_BINARY = 'STAR DESTROYER.OBJ0';

/** `SD PART3` BRUNs this one: the final mission, which `finale.js`'s `Finale` runs. */
export const FINALE_BINARY = 'BASE STAR.OBJ0';

/** The binaries that are the game rather than setup for it. */
export const MISSIONS = new Set([FLIGHT_BINARY, FINALE_BINARY]);

/** What the driver is waiting for, when it is waiting. */
export const WAITING = { nothing: null, key: 'key', flight: 'flight', ended: 'ended' };

export class Presentation {
  /**
   * @param {Uint8Array|ArrayBuffer} image the .dsk
   * @param {object} [opts] `rnd`, `calls` for CALL handlers the shell supplies, `store`
   *   for where a written file is kept - see `platform/saves.js`
   */
  constructor(image, { rnd = Math.random, calls = {}, corruptInterface = false,
    store = null } = {}) {
    this.disk = openDisk(image);
    this.mem = new Uint8Array(0x10000);
    /**
     * A2-3D2, over the two hi-res pages where the machine has them.
     *
     * `CALL 24576` is not the flight loop's alone: `STARBASE` makes 33 of them to draw the
     * docking scene and `DEMO` uses it too. Leaving it to the flight meant the starbase
     * screen came up with its text and no starbase, which is what checking rather than
     * assuming turned up.
     */
    this.engine = new Engine(this.mem, {
      pages: [this.mem.subarray(0x2000, 0x4000), this.mem.subarray(0x4000, 0x6000)],
    });
    this.host = new Host(this.mem, this.disk, {
      rnd,
      corruptInterface,
      store,
      calls: {
        /**
         * `CALL 24576` - A2-3D2 renders a frame, and takes a third of a second doing it.
         *
         * Measured at 316,000 cycles, three frames within 0.8% of each other, which is 309ms
         * and 18.6 video frames: the engine is synchronised to nothing and runs until it is
         * done. In the port it is a function call and costs nothing, so a BASIC program that
         * animates - `DEMO`'s 110 renders, `STARBASE`'s 33 - played its whole animation
         * inside one frame of the page. The time is handed to the caller to wait out, the
         * same way an empty `FOR`/`NEXT` is.
         */
        0x6000: () => {
          this.engine.reset();
          this.engine.run();
          return { async: true, wait: true, seconds: RENDER_SECONDS };
        },
        ...calls,
      },
    });
    this.basic = new Applesoft(this.mem, this.host);
    this.program = null;
    this.waiting = WAITING.nothing;
    /** Set when a BRUN hands control to something that is not BASIC. */
    this.handoff = null;
    /** Every program entered, in order. */
    this.visited = [];
  }

  /**
   * Load a program and start it.
   *
   * The program goes into the image at `$801` exactly as DOS would put it, so `PEEK`s into
   * the program's own text - which this disk does not do, but which would work - and the
   * interpreter's own walk of the linked list both see the same bytes.
   */
  load(name) {
    let f;
    try {
      f = this.disk.file(name);
    } catch (e) {
      throw new Error(`the chain asked for "${name}", which is not on this disk`);
    }
    if (f.type !== 'APPLESOFT') {
      throw new Error(`"${name}" is ${f.type}, not an Applesoft program`);
    }
    // **Nothing is cleared here.** An earlier version wiped $801 up to $2801 before writing
    // the program, to be tidy about the one before it. That range covers $1FF3-$1FFF - the
    // thirteen bytes the BASIC and the binary talk through - so every chain threw away the
    // difficulty and the target that SELECT had just set, and the whole game ran on zeros.
    // DOS does not clear anything either: it writes the program and sets the pointers, and
    // the program's own terminator is what ends the list.
    for (let i = 0; i < f.len; i++) this.mem[TXTTAB + i] = f.data[i];
    this.basic = new Applesoft(this.mem, this.host).load(this.mem, TXTTAB);
    this.program = name;
    this.visited.push(name);
    this.host.chainTo = null;
    this.waiting = WAITING.nothing;
    return this;
  }

  /**
   * Run until the program needs something.
   *
   * @param {object} [opts] `maxSteps` a guard, `maxChains` how many programs one call may
   *   walk through before returning - 1 keeps the caller in control of every screen
   */
  run({ maxSteps = 500000, maxChains = 1 } = {}) {
    let chains = 0;
    for (;;) {
      if (this.waiting === WAITING.key) return { waiting: this.waiting, program: this.program };
      const r = this.basic.run({ maxSteps });
      if (r.yield === YIELD.chain) {
        if (++chains > maxChains) {
          this.pending = r.program;
          return { waiting: this.waiting, program: this.program, next: r.program };
        }
        // A chain to the game's own binary is not a program this can run.
        this.load(r.program);
        continue;
      }
      if (r.yield === YIELD.key) {
        this.waiting = WAITING.key;
        return { waiting: this.waiting, program: this.program };
      }
      if (r.yield === YIELD.end) {
        this.waiting = WAITING.ended;
        return { waiting: this.waiting, program: this.program };
      }
      if (r.yield === YIELD.run) {
        // The two mission binaries are the game itself; everything else BRUN loads is setup
        // the port has no need to execute. The caller runs the flight and then calls `run`
        // again, and the BASIC continues at the line after the BRUN.
        if (MISSIONS.has(r.program)) {
          this.waiting = WAITING.flight;
          return { waiting: this.waiting, program: this.program, flight: r.program };
        }
        continue;
      }
      // Anything else - a CALL the host wants waited on, for instance - goes back as it is.
      return { waiting: this.waiting, program: this.program, ...r };
    }
  }

  /** The flight is over; the BASIC resumes at the line after the BRUN. */
  flightDone() {
    this.waiting = WAITING.nothing;
  }

  /** The shell supplies a keypress; the program carries on. */
  key(ch) {
    this.host.pressKey(ch);
    if (this.basic.pendingKeyVar) {
      this.basic.supplyKey(typeof ch === 'string' ? ch : String.fromCharCode(ch));
    }
    this.waiting = WAITING.nothing;
  }

  /** What the shell shows, and what it should worry about. */
  status() {
    return {
      program: this.program,
      waiting: this.waiting,
      display: this.host.display.toString(),
      visited: this.visited.slice(-8),
      unimplemented: [...this.host.unimplemented].map(([what, n]) => ({ what, n })),
      printed: this.host.log.slice(-6),
    };
  }
}
