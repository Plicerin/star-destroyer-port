// The attract mode, in the port, against what the machine does.
//
// `probe_demo.mjs` walked the real one and timed it: three blocks of text, each held for a
// `FOR J = 1 TO 2000: NEXT` that measured 1836, 1852 and 1836 ms. This holds the port to that
// - and to the thing underneath it, which is that an empty Applesoft loop is a wait and has
// to cost what the machine charges for it.
//
// No emulator here. The subject is the disk's own `DEMO`, run through the port's interpreter,
// with the measurement from the probe as the standard.
import { readFileSync } from 'node:fs';
import { Presentation } from '../port/src/shell/presentation.js';
import { Applesoft, YIELD, DELAY_CYCLES } from '../port/src/game/applesoft.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};

const image = readFileSync(new URL('../STAR_DESTROYER.dsk', import.meta.url));

/** What `probe_demo.mjs` measured on the machine, in milliseconds. */
const MEASURED = { blocks: [1836, 1852, 1836], iterations: 2000 };

/** How much of the displayed hi-res page has anything on it. */
const litBytes = (mem, display) => {
  const base = /page 2/.test(display) ? 0x4000 : 0x2000;
  let n = 0;
  for (let a = base; a < base + 0x2000; a++) if (mem[a]) n++;
  return n;
};

/**
 * Walk the chain until `DEMO` has been through once, recording every wait.
 *
 * @param {object} [opts] `plain` to put the old rule back - a delay loop iterated rather
 *   than charged for, which is what the port did before this was measured
 */
function attract({ plain = false } = {}) {
  const original = Applesoft.prototype.emptyLoop;
  if (plain) Applesoft.prototype.emptyLoop = () => null;
  try {
    const s = new Presentation(image);
    s.load('START');
    const waits = [];
    let seenDemo = false;
    for (let i = 0; i < 20000; i++) {
      const r = s.run({ maxChains: 0 });
      if (r.program === 'DEMO') seenDemo = true;
      // `iterations` is what separates the author counting from the renderer taking its
      // third of a second; both come back as waits, and both are measured.
      if (r.yield === YIELD.wait && r.iterations && r.program === 'DEMO') {
        waits.push({ ms: r.seconds * 1000, iterations: r.iterations,
          lit: litBytes(s.mem, s.status().display), display: s.status().display });
      }
      if (r.next) {
        // One visit is enough: with no key, SELECT chains DEMO again forever.
        if (seenDemo && r.next === 'SELECT') return { waits, show: s };
        s.load(r.next);
        continue;
      }
      if (r.waiting === 'key' || r.waiting === 'ended' || r.waiting === 'flight') break;
    }
    return { waits, show: null };
  } finally {
    Applesoft.prototype.emptyLoop = original;
  }
}

console.log('=== the attract mode, against the machine ===');

// ---------------------------------------------------------------- the three pauses ---------
const { waits } = attract();
check('the attract stops three times, for as long as the machine stops',
  waits.length === 3
    && waits.every((w, i) => Math.abs(w.ms - MEASURED.blocks[i]) < 30),
  waits.map((w) => `${w.ms.toFixed(0)}ms`).join(' / ')
    + ` against the machine's ${MEASURED.blocks.join(' / ')}`);

check('and each one is the author\'s two thousand iterations, not a number chosen here',
  waits.length === 3 && waits.every((w) => w.iterations === MEASURED.iterations),
  `${waits[0]?.iterations} iterations at ${DELAY_CYCLES} cycles each, which is line 412`);

// ---------------------------------------------------------------- and there is something to read
// A pause with an empty screen behind it is just a pause. `GOSUB 400` switches the display to
// page 1 and XDRAWs the block there, so the page the player is looking at has to have gained
// something by the time the wait is handed over.
check('there are words on the screen the player is looking at while it waits',
  waits.length === 3 && waits.every((w) => /page 1/.test(w.display) && w.lit > 150),
  waits.map((w) => `${w.lit} bytes on ${w.display}`).join(', '));

// ---------------------------------------------------------------- the control ---------------
// Put the old rule back - iterate the loop instead of charging for it - and play the same
// attract through it. This is what the page did: the story was drawn and painted over inside
// one frame, and nobody ever saw it.
const plain = attract({ plain: true });
check('control: iterating the loop instead costs nothing, and the attract never pauses',
  plain.waits.length === 0,
  'all three blocks drawn and overwritten in a single frame, which is what open question 16'
    + ' was about - the port ran the author\'s code correctly and still did not show the game');

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
