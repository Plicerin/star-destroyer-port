// Where the game actually is.
//
// PORT_PLAN said phase 5 was "the 21 Applesoft programs and the chain between them". It
// is not. All 21 programs come to 380 lines of listing between them, and they are glue:
// they BLOAD the engine and the scene, poke a few starting values, and then
//
//     PRINT CHR$(4);"BRUN STAR DESTROYER.OBJ0"
//
// hands control to **5,890 bytes of 6502** that is the flight game. Porting the game
// means disassembling that, the way A2-3D2 was disassembled, and the Applesoft around it
// is a few hundred bytes of chaining.
//
// This probe establishes that, and two things that follow from it: how a BRUN at $08EF
// can overwrite the program that issued it, and how the game talks to the renderer.
import { openOracle } from './a2.mjs';
import { toFlight } from './exercise.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { disasm1, traverse, hx } from './disasm6502.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const file = (n) => d.read(d.files.find((x) => x.name === n));
const OVERLAY = 0x08EF;

// --- the game is the binary, not the BASIC -----------------------------------------------
console.log('\n=== where the code is ===');
{
  const basic = d.files.filter((x) => x.type === 'APPLESOFT')
    .reduce((n, f) => n + d.read(f).len, 0);
  const overlays = ['PART1.OBJ0', 'TITLE.OBJ0', 'HYPERDRIVE.OBJ0', 'STAR DESTROYER.OBJ0',
    'BASE STAR.OBJ0', 'BASE STAR DESTROYER.OBJ0'];
  const binary = overlays.reduce((n, name) => n + file(name).len, 0);
  for (const name of overlays) {
    const x = file(name);
    console.log(`  ${name.padEnd(26)} ${hx(x.addr, 4)}..${hx(x.addr + x.len - 1, 4)}  ${String(x.len).padStart(5)} bytes`);
  }
  console.log(`  all 21 Applesoft programs together: ${basic} bytes`);
  // Not "the BASIC is glue" - 12KB of Applesoft runs the title, the difficulty screen,
  // the starbase, the hyperdrive sequences, the high scores and the demo, and all of that
  // has to be ported too. What IS true, and is the thing that reframes phase 5, is that
  // the FLIGHT is not in BASIC: the program that runs it is 287 bytes long and hands over
  // to twenty times its own size in 6502.
  const runner = file('SD PART2').len, flight = file('STAR DESTROYER.OBJ0').len;
  console.log(`  SD PART2, which runs the flight, is ${runner} bytes`);
  check('the flight itself is a binary, not a BASIC program',
    flight > runner * 15, `${runner} bytes of BASIC hand over to ${flight} bytes of 6502`);
  check('and there is more 6502 in the overlays than there is Applesoft on the disk',
    binary > basic, `${binary} bytes against ${basic}`);
  check('and every overlay loads at the same address',
    overlays.every((n) => file(n).addr === OVERLAY), hx(OVERLAY, 4));
}

// --- how a BRUN can overwrite the program that issued it ------------------------------------
// DISK_TRUTH's open question 8: "$08EF is 238 bytes above Applesoft's $0801. How a BASIC
// program and a binary share that space is not understood."
console.log('\n=== $08EF, and the programs that BRUN into it ===');
{
  const part2 = file('SD PART2');
  console.log(`  SD PART2 is ${part2.len} bytes, so its text runs $0801-${hx(0x801 + part2.len, 4)}`);
  console.log(`  the overlay it BRUNs covers $08EF-${hx(OVERLAY + file('STAR DESTROYER.OBJ0').len - 1, 4)}`);
  check('the overlay really does overwrite the tail of the program that runs it',
    0x801 + part2.len > OVERLAY,
    `${0x801 + part2.len - OVERLAY} bytes of SD PART2 are inside the overlay`);
}

const a2 = await openOracle();
const flight = await toFlight(a2);
check('the oracle reaches flight', flight.difficulty === 1);
{
  const live = Uint8Array.from(await a2.readRange(0x0800, 0x2000));
  const part2 = file('SD PART2');
  let survives = 0;
  while (survives < part2.len && live[1 + survives] === part2.data[survives]) survives++;
  console.log(`  in flight, SD PART2's text matches the disk for its first ${survives} bytes`);
  check('the program survives exactly up to $08EF and no further',
    0x801 + survives === OVERLAY, `intact to ${hx(0x801 + survives, 4)}`);

  // And what survives is the part that still has to run. Line 10 is a GOSUB to the
  // subroutine at 200, which runs BEFORE the BRUN; lines 172-180 decide what to chain
  // afterwards. The author laid the program out so the tail that runs after the overlay
  // loads sits below $08EF, and let the overlay have everything above it.
  const mem = {};
  for (let i = 0; i < live.length; i++) mem[0x800 + i] = live[i];
  const lines = listProgram(mem, 0x801);
  const nums = lines.map((l) => l.num);
  console.log(`  lines still readable: ${nums.slice(0, 6).join(', ')}${nums.length > 6 ? ', ...' : ''}`);
  check('the lines that run after the BRUN are all below $08EF, and survive',
    [10, 164, 172, 175, 180].every((n) => nums.includes(n)),
    'and the subroutine at 200, which only runs before it, is clobbered');

  const obj = file('STAR DESTROYER.OBJ0');
  let resident = 0;
  for (let i = 0; i < obj.len; i++) if (live[OVERLAY - 0x800 + i] === obj.data[i]) resident++;
  check('and the overlay is the thing that is running there',
    resident > obj.len / 2, `${resident} of ${obj.len} bytes match the disk; the rest is its own state`);
}
await a2.close();

// --- what the binary is ---------------------------------------------------------------------
console.log('\n=== STAR DESTROYER.OBJ0 ===');
const mem = new Uint8Array(0x10000);
for (const n of ['A2-3D2', 'SV DATA', 'MAIN DATA', 'STAR DESTROYER.OBJ0']) {
  const x = file(n);
  for (let i = 0; i < x.len; i++) mem[x.addr + i] = x.data[i];
}
const obj = file('STAR DESTROYER.OBJ0');
const HI = OVERLAY + obj.len;
const entry = disasm1(mem, OVERLAY);
console.log(`  ${hx(OVERLAY, 4)}  ${entry.text}`);
const { starts } = traverse(mem, [OVERLAY], { lo: OVERLAY, hi: HI });
let bytes = 0;
for (const s of starts) bytes += disasm1(mem, s).len;
console.log(`  traverse from the entry: ${starts.size} instructions, ${bytes} bytes `
  + `(${(100 * bytes / obj.len).toFixed(1)}%)`);
check('it is almost entirely code, reachable from one entry point',
  bytes > obj.len * 0.9, `${(100 * bytes / obj.len).toFixed(1)}% covered`);

// --- how the game drives the renderer ----------------------------------------------------------
// This is the part that matters for the port: the binary's whole effect on what appears
// is the bytes it writes into the display list, and that list is already ported and
// verified. So the arbiter for the game logic is "did it poke the same bytes".
console.log('\n=== what it reaches into ===');
{
  const hits = new Map();
  for (const s of starts) {
    const x = disasm1(mem, s);
    if (!['abs', 'abx', 'aby'].includes(x.mode)) continue;
    const t = x.bytes[1] | (x.bytes[2] << 8);
    if (t >= 0x6000 && t < 0x8400) hits.set(t, (hits.get(t) ?? 0) + 1);
  }
  const objectFields = (t) => {
    for (let i = 0; i < 24; i++) {
      const base = (i < 12 ? 0x8123 + i * 13 : 0x8247 + (i - 12) * 13);
      if (t > base && t <= base + 12) {
        const off = t - base - 1;
        const field = off === 0 ? 'count' : off <= 6 ? 'position' : off <= 9 ? 'attitude' : 'shape';
        return `object ${i} ${field}`;
      }
    }
    return null;
  };
  const named = { 0x6000: 'CALL 24576 - render a frame', 0x8110: 'display page switch',
    0x8112: 'which page to clear', 0x8114: 'which page to draw on',
    0x8116: 'XI', 0x8117: 'XI+1', 0x811A: 'ZI', 0x811B: 'ZI+1', 0x811E: 'H1 heading',
    0x81DD: 'SHLD gauge', 0x81F3: 'WARP gauge', 0x8209: 'MSL gauge' };
  const sorted = [...hits.entries()].sort((a, b) => a[0] - b[0]);
  const interesting = sorted.filter(([t]) => named[t] || t < 0x8120);
  for (const [t, n] of interesting) console.log(`  ${hx(t, 4)}  x${String(n).padStart(3)}  ${named[t] ?? ''}`);
  const objHits = sorted.filter(([t]) => objectFields(t));
  const fields = new Set(objHits.map(([t]) => objectFields(t).split(' ').slice(2).join(' ')));
  console.log(`  ${objHits.length} more addresses are fields of object instructions: ${[...fields].join(', ')}`);

  check('the game calls the renderer', hits.has(0x6000), `${hits.get(0x6000)} call sites`);
  check('it flies the ship by poking the VIEWER instruction\'s operands',
    [0x8116, 0x811A, 0x811E].every((t) => hits.has(t)),
    'XI, ZI and H1 - position along two axes and a heading');
  check('and it moves the enemies by poking object instructions directly',
    objHits.length > 20 && fields.has('count') && fields.has('attitude'),
    `${objHits.length} field references across the two object blocks`);
  fs.mkdirSync('captured/game', { recursive: true });
  fs.writeFileSync('captured/game/golden.json', JSON.stringify({
    entry: hx(OVERLAY, 4), jumpsTo: entry.text, instructions: starts.size, codeBytes: bytes,
    references: sorted.map(([t, n]) => ({ at: hx(t, 4), count: n, what: named[t] ?? objectFields(t) })),
    results,
  }, null, 1) + '\n');
}

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `game: all ${results.length} checks passed`
  : `game: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
