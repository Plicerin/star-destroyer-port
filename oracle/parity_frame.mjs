// A whole frame: the port's renderer against the engine's, all 8,192 bytes.
//
// This is what the port has been building towards. Every stage underneath has its own
// harness - the multiply, the screen, the line, the trig, the matrix, the projection, the
// clipper - and each of those compares one thing at a time. This runs the real display
// list through both and compares the finished page, which is the only check that can
// catch a mistake in how the stages fit together rather than in a stage.
//
// Three scenes. The one the disk ships, which draws the instrument panel and nothing
// else because every object is switched off; the same program with objects switched on,
// which puts real shapes through the transform, the clipper and the projection; and one
// with the viewer moved and rotated, which is where the matrix and the clip planes earn
// their keep.
import { openOracle } from './a2.mjs';
import { toFlight, arm, runList, op, LIST, LIST_LEN } from './exercise.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { Engine } from '../port/src/a23d2/engine.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const fileOf = (n) => d.read(d.files.find((x) => x.name === n));

/** A 64K image with the engine's files where DOS puts them, for the port to run from. */
function memory(scene = 'SV DATA', shapes = 'MAIN DATA') {
  const mem = new Uint8Array(65536);
  for (const name of ['A2-3D2', scene, shapes]) {
    const f = fileOf(name);
    for (let i = 0; i < f.len; i++) mem[f.addr + i] = f.data[i];
  }
  return mem;
}

/** The object instructions, as probe_renderer.mjs found them: two runs of twelve. */
const OBJECTS = [];
for (let i = 0; i < 12; i++) OBJECTS.push(0x8123 + i * 13);
for (let i = 0; i < 12; i++) OBJECTS.push(0x8247 + i * 13);

/** Switch an object on at a position and attitude, in a copy of the scene. */
function withObjects(base, list) {
  const mem = base.slice();
  for (const { index, x, y, z, pitch, bank, heading, count } of list) {
    const at = OBJECTS[index];
    mem[at + 1] = count ?? 0xFF;
    mem[at + 2] = x & 0xff; mem[at + 3] = (x >> 8) & 0xff;
    mem[at + 4] = y & 0xff; mem[at + 5] = (y >> 8) & 0xff;
    mem[at + 6] = z & 0xff; mem[at + 7] = (z >> 8) & 0xff;
    mem[at + 8] = pitch & 0xff; mem[at + 9] = bank & 0xff; mem[at + 10] = heading & 0xff;
  }
  return mem;
}

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

// The engine keeps the colour, the plot mode and the primitive vectors in patched code,
// so a frame inherits whatever the last one left. Put all three somewhere known before
// comparing anything, so the port's fresh state and the machine's agree.
await runList(a2, [20, 0, 12, 0, 29, 0, 121], { page: 1, budget: 4000000 });

/**
 * Run one scene through both and compare the whole page.
 *
 * The scene's 491 bytes are written where $6090 points, so the engine runs exactly the
 * program the port is given - not the copy the live game has been poking at.
 */
async function frame(name, mem) {
  const scene = [...mem.slice(LIST, LIST + LIST_LEN)];
  // SV DATA draws to page 2 - its CLEAR and DRAWTO both carry operand 1, and operand 1
  // means $4000. Comparing page 1 compares two blank pages and passes for nothing, which
  // is what the first version of this harness did until the non-zero byte count gave it
  // away. Both pages are compared now, so a scene that draws to either is covered.
  // The shapes live at $83AE and runList only writes the scene, so a frame that uses a
  // different shape file has to put it there too - otherwise the engine renders the new
  // scene's pointers against whatever shapes were already resident, which is exactly what
  // the first version of this did for the BASE STAR DATA case.
  const shapes = [...mem.slice(0x83AE, 0x83AE + 1575)];
  await a2.ev(`(() => { const b = ${JSON.stringify(shapes)};
    for (let i = 0; i < b.length; i++) window.M.wr(0x83AE + i, b[i]); return 'shapes'; })()`);
  const r = await runList(a2, scene, { page: 2, budget: 40000000 });
  const r1 = { page: Uint8Array.from(await a2.readRange(0x2000, 0x4000)) };
  const engine = new Engine(mem.slice());
  const instructions = engine.run();
  const theirs = r.page, ours = engine.screen.pages[1];
  const diffs = [];
  for (let i = 0; i < 0x2000; i++) if (theirs[i] !== ours[i]) diffs.push(i);
  for (let i = 0; i < 0x2000; i++) if (r1.page[i] !== engine.screen.pages[0][i]) diffs.push(i + 0x2000);
  if (diffs.length) {
    const first = diffs[0];
    const row = (() => {
      for (let q = 0; q < 192; q++) {
        const b = (q & 7) * 0x400 + (((q >> 3) & 7) * 0x80) + ((q >> 6) * 0x28);
        if (first >= b && first < b + 40) return `row ${q} byte ${first - b}`;
      }
      return '?';
    })();
    console.log(`     first difference at $${(first + 0x2000).toString(16).toUpperCase()} (${row}): `
      + `engine ${theirs[first].toString(2).padStart(8, '0')}, port ${ours[first].toString(2).padStart(8, '0')}`);
  }
  const lit = ours.reduce((n, b) => n + (b ? 1 : 0), 0);
  if (lit === 0) throw new Error(`${name}: nothing was drawn, so this comparison proves nothing`);
  console.log(`  ${name.padEnd(46)} ${diffs.length === 0 ? 'identical' : diffs.length + ' bytes differ'}`
    + `   (${instructions} instructions, ${lit} non-zero bytes)`);
  return diffs.length;
}

console.log('\n=== whole frames ===');
let failures = 0;
const base = memory();

// 1. The scene exactly as the disk ships it. Every object is off, so this is the
//    instrument panel: the 2-D lines and points, and the program flow around them.
failures += await frame('SV DATA as shipped - the instrument panel', base);

// 2. Objects on. Shapes 1 and 2 of MAIN DATA are the swept-wing craft; 8 to 11 are the
//    explosion starbursts. Positions chosen to put some wholly inside the frustum and
//    some across its edges, which is what makes the clipper matter.
failures += await frame('one craft ahead', withObjects(base, [
  { index: 1, x: 0, y: 0, z: 300, pitch: 0, bank: 0, heading: 0 },
]));
failures += await frame('three craft at different attitudes', withObjects(base, [
  { index: 1, x: -60, y: 20, z: 400, pitch: 0, bank: 0, heading: 0 },
  { index: 2, x: 80, y: -30, z: 250, pitch: 32, bank: 0, heading: 64 },
  { index: 3, x: 0, y: 0, z: 150, pitch: 0, bank: 48, heading: 16 },
]));
failures += await frame('objects straddling the frustum edges', withObjects(base, [
  { index: 1, x: 140, y: 0, z: 150, pitch: 0, bank: 0, heading: 0 },
  { index: 2, x: -140, y: 0, z: 150, pitch: 0, bank: 0, heading: 0 },
  { index: 4, x: 0, y: 120, z: 130, pitch: 16, bank: 16, heading: 16 },
  { index: 5, x: 0, y: -120, z: 130, pitch: 0, bank: 0, heading: 200 },
]));
failures += await frame('an explosion starburst up close', withObjects(base, [
  { index: 9, x: 10, y: -5, z: 90, pitch: 11, bank: 22, heading: 33 },
]));

// 3. The second block of twelve objects, which the scene draws from its second viewpoint.
failures += await frame('objects in the second block, second viewport', withObjects(base, [
  { index: 12, x: 0, y: 0, z: 200, pitch: 0, bank: 0, heading: 0 },
  { index: 14, x: 40, y: 40, z: 300, pitch: 64, bank: 0, heading: 0 },
]));

// 4. A crowd, to catch anything that depends on how much has already been drawn.
failures += await frame('eight objects at once', withObjects(base, [
  { index: 1, x: -80, y: 10, z: 200 }, { index: 2, x: 80, y: -10, z: 220 },
  { index: 3, x: 0, y: 60, z: 180 }, { index: 4, x: 0, y: -60, z: 190 },
  { index: 6, x: -40, y: 0, z: 140 }, { index: 7, x: 40, y: 0, z: 160 },
  { index: 13, x: 0, y: 0, z: 400 }, { index: 15, x: 20, y: 20, z: 350 },
].map((o) => ({ pitch: 0, bank: 0, heading: 0, ...o }))));

// 5. The other scene file, which points the same object table at different shapes.
failures += await frame('BASE STAR DATA through SV DATA2',
  withObjects(memory('SV DATA2', 'BASE STAR DATA'), [
    { index: 1, x: 0, y: 0, z: 260, pitch: 0, bank: 0, heading: 0 },
    { index: 3, x: -50, y: 30, z: 300, pitch: 32, bank: 32, heading: 32 },
  ]));

check('every frame is byte-for-byte identical across the whole page', failures === 0,
  failures ? `${failures} differing bytes in total` : 'eight frames, no differences');

// The object counter ticks down in the list itself, which is state the port has to carry.
{
  const mem = withObjects(base, [{ index: 1, x: 0, y: 0, z: 300, count: 3 }]);
  const engine = new Engine(mem.slice());
  engine.run();
  const after = engine.mem[OBJECTS[1] + 1];
  check('an object with a count of 3 decrements itself in the list', after === 2,
    `the counter reads ${after} after one frame`);
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/frame.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_frame: all ${results.length} checks passed`
  : `parity_frame: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
