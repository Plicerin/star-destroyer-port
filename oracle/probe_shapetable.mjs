// The Applesoft shape table, and the two properties the game relies on.
//
// Every word on the starbase screen and the high-score screen is drawn from one table,
// `CHR$.A24576.L148`, which STARBASE, INITIALS and DEMO each load at `$1AFB` and then call
// `DRAW` against once per character. So this is not a decoration: without it those two
// screens are blank.
//
// Two things are checked here and they are different in kind. The table's shape is a fact
// about the disk and is read off it. The renderer's correctness cannot be read off anything,
// so it is held to **the two properties the programs themselves depend on**: XDRAW is its own
// inverse, which is how INITIALS erases its cursor, and a DRAW in black undoes a DRAW in
// white, which is how it erases a character. A renderer that got the vector decoding wrong
// would still satisfy those by accident only if it were wrong symmetrically, so there is a
// third check on the decoded vectors against the bytes.
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { parseTable, vectors, drawShape, UnsupportedRotation }
  from '../port/src/platform/shapes.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const SHAPES = 'CHR$.A24576.L148';
/** Where the three programs that use it put it: `POKE 232,251: POKE 233,26`. */
const BASE = 0x1AFB;

const mem = new Uint8Array(0x10000);
{
  const f = d.read(d.files.find((x) => x.name === SHAPES));
  for (let i = 0; i < f.len; i++) mem[BASE + i] = f.data[i];
  console.log(`\n${SHAPES}: ${f.len} bytes, catalogued at $${f.addr.toString(16)
    .toUpperCase()} and loaded by the game at $${BASE.toString(16).toUpperCase()}`);
}
const table = parseTable(mem, BASE);

// ---------------------------------------------------------------- the table --------------
console.log('\n=== the table ===');
console.log(`  ${table.count} shapes, offsets ${table.offsets[0]}`
  + ` to ${Math.max(...table.offsets)}`);
{
  const len = 985;
  const bad = table.offsets.filter((o) => o <= 0 || o >= len);
  check(`all ${table.count} offsets land inside the table`, bad.length === 0,
    bad.length ? `out of range: ${bad.join(', ')}` : `the largest is`
      + ` ${Math.max(...table.offsets)} of ${len}`);

  const unterminated = [];
  let totalVectors = 0;
  for (let i = 1; i <= table.count; i++) {
    const v = vectors(mem, table, i);
    totalVectors += v.length;
    // A shape that runs to the guard has no terminator.
    if (v.length >= 4000) unterminated.push(i);
    if (v.length === 0) unterminated.push(i);
  }
  check('every shape terminates, and none is empty', unterminated.length === 0,
    unterminated.length ? `shapes ${unterminated.join(', ')}`
      : `${totalVectors} vectors across ${table.count} shapes`);

  // The decoding, against the bytes, for one shape read by hand.
  const first = table.base + table.offsets[0];
  const b = mem[first];
  const v = vectors(mem, table, 1);
  const expect = [{ plot: !!(b & 4), dir: b & 3 }];
  if ((b >> 3) !== 0) expect.push({ plot: !!(b & 0x20), dir: (b >> 3) & 3 });
  if ((b >> 6) !== 0) expect.push({ plot: false, dir: (b >> 6) & 3 });
  check('the first byte of shape 1 decodes to the sections its bits say',
    v.slice(0, expect.length).every((x, i) =>
      x.plot === expect[i].plot && x.dir === expect[i].dir),
    `$${b.toString(16).toUpperCase()} gives ${expect.length} sections:`
      + ` ${expect.map((e) => `${e.plot ? 'plot ' : 'move '}${['up', 'right', 'down',
        'left'][e.dir]}`).join(', ')}`);
}

// ---------------------------------------------------------------- the renderer -----------
console.log('\n=== the two properties the programs depend on ===');

/** A page, and a plotter over it that behaves like the host's. */
function surface() {
  const page = new Uint8Array(0x2000);
  const addr = (x, y) => (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28
    + Math.floor(x / 7);
  return {
    page,
    plotter: (colourBits) => ({
      plot: (x, y) => {
        if (x < 0 || x > 279 || y < 0 || y > 191) return;
        const bit = 1 << (x % 7);
        const on = (colourBits >> (x % 7)) & 1;
        page[addr(x, y)] = on ? (page[addr(x, y)] | bit) : (page[addr(x, y)] & ~bit);
      },
      invert: (x, y) => {
        if (x < 0 || x > 279 || y < 0 || y > 191) return;
        page[addr(x, y)] ^= 1 << (x % 7);
      },
    }),
  };
}
const sum = (p) => p.reduce((a, b) => a + b, 0);

{
  // XDRAW twice is nothing: INITIALS line 169 draws its cursor and line 185 draws it again
  // to take it away.
  const bad = [];
  let moved = 0;
  for (let shape = 1; shape <= table.count; shape++) {
    const s = surface();
    const before = sum(s.page);
    drawShape(s.plotter(0x7F), mem, table, shape, 140, 90, { xor: true });
    const once = sum(s.page);
    drawShape(s.plotter(0x7F), mem, table, shape, 140, 90, { xor: true });
    const twice = sum(s.page);
    if (once !== before) moved++;
    if (twice !== before) bad.push(shape);
  }
  check(`XDRAW twice leaves the page exactly as it was, for all ${table.count} shapes`,
    bad.length === 0 && moved === table.count,
    bad.length ? `shapes ${bad.slice(0, 6).join(', ')} did not come back`
      : `and all ${moved} of them changed it the first time, so the check had something`
        + ' to undo');

  // DRAW in black undoes DRAW in white: INITIALS line 150 clears a character that way.
  const bad2 = [];
  for (let shape = 1; shape <= table.count; shape++) {
    const s = surface();
    drawShape(s.plotter(0x7F), mem, table, shape, 140, 90, {});
    const drawn = sum(s.page);
    drawShape(s.plotter(0x00), mem, table, shape, 140, 90, {});
    if (sum(s.page) !== 0 || drawn === 0) bad2.push(shape);
  }
  check('and a DRAW in HCOLOR 0 erases exactly what a DRAW in HCOLOR 7 put down',
    bad2.length === 0,
    bad2.length ? `shapes ${bad2.slice(0, 6).join(', ')}` : 'all of them, to an empty page');

  // Scale multiplies the travel, which is the only thing SCALE does.
  const a = surface(), b = surface();
  const r1 = drawShape(a.plotter(0x7F), mem, table, 2, 40, 90, { scale: 1 });
  const r2 = drawShape(b.plotter(0x7F), mem, table, 2, 40, 90, { scale: 3 });
  check('SCALE multiplies how far each vector travels, and nothing else',
    r2.steps === r1.steps * 3 && r2.plotted === r1.plotted * 3,
    `scale 1 takes ${r1.steps} steps and plots ${r1.plotted}; scale 3 takes ${r2.steps}`
      + ` and plots ${r2.plotted}`);
}

// ---------------------------------------------------------------- the subset -------------
console.log('\n=== rotation: what the disk asks for ===');
{
  const rots = new Set();
  for (const f of d.files.filter((x) => x.type === 'APPLESOFT')) {
    const raw = d.read(f);
    const m = new Uint8Array(0x10000);
    for (let i = 0; i < raw.len; i++) m[raw.addr + i] = raw.data[i];
    for (const line of listProgram(m, 0x801)) {
      for (const match of line.text.matchAll(/ROT=\s*(\d+)/g)) rots.add(Number(match[1]));
    }
  }
  console.log(`  every ROT= on the disk: ${[...rots].sort((x, y) => x - y).join(', ')}`);
  check('every rotation the disk sets is one this implements',
    [...rots].every((r) => r % 16 === 0),
    `${[...rots].join(', ')} - so the 60 intermediate angles, which need a scale-dependent`
      + ' ROM table, are not needed and are not guessed at');

  let threw = false;
  try {
    const s = surface();
    drawShape(s.plotter(0x7F), mem, table, 1, 140, 90, { rot: 8 });
  } catch (e) {
    threw = e instanceof UnsupportedRotation;
  }
  check('control: an angle it cannot do throws rather than drawing something plausible',
    threw, 'ROT=8 is refused, so the subset is visible rather than silent');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
