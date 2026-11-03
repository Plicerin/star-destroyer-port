// A2-3D2, the renderer: read statically and then watched running.
//
// Two halves that have to agree.
//
// Statically: the dispatch table at $60DC, the thirty handlers behind it, and the operand
// length each handler advances the list pointer by. From those, `SV DATA` reads as a
// program - and the test of the whole reading is that the program decodes end to end and
// lands on its terminator. 491 bytes with variable-length instructions is not something a
// wrong length table gets right by luck.
//
// Dynamically: the same engine traced in the oracle while the game flies, which answers
// what a static read cannot. Which opcodes actually run. How many cycles a frame costs.
// And - the reason a static disassembly of this binary is not enough on its own - the
// four places the engine rewrites itself, where the bytes on the disk are not the bytes
// that execute.
//
// The two halves cross-check each other: every instruction the trace executed must be an
// instruction the static traverse also found, and every operand length the trace measured
// must be the one the handler says. Where either fails, this probe names the address.
import { openOracle } from './a2.mjs';
import { identify } from './screens.mjs';
import {
  engineMemory, handlers, disasmList, engineCode, symbols, listing, object,
  OPS, ENTRY, DISPATCH, INTERP, FETCH, ZP_SAVE, OPCODES, END, hx,
} from './renderer.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const { mem: disk, loaded } = engineMemory();
const H = handlers(disk);
const eng = loaded.find((x) => x.name === 'A2-3D2');
const cfg = loaded.find((x) => x.name === 'SV DATA');

// --- the shape of the engine, from the disk ---------------------------------------------
console.log(`\n=== A2-3D2 ${hx(eng.addr, 4)}-${hx(eng.addr + eng.len - 1, 4)}, ${eng.len} bytes ===`);
console.log(`  four entries: ${Object.entries(ENTRY).map(([k, v]) => `${hx(v, 4)} ${k}`).join(', ')}`);

// The dispatch table is bounded by the interpreter that reads it. If there were a
// thirty-first opcode the table would run into $6118, and if there were twenty-nine there
// would be two spare bytes - so this is the whole instruction set, not a guess at it.
check('the dispatch table ends exactly where the interpreter begins',
  DISPATCH + OPCODES * 2 === INTERP, `${hx(DISPATCH, 4)} + 30*2 = ${hx(INTERP, 4)}`);
check('all thirty handlers point inside the engine',
  H.every((h) => h >= eng.addr && h < eng.addr + eng.len),
  `${hx(Math.min(...H), 4)}..${hx(Math.max(...H), 4)}`);

const { starts } = engineCode(disk);
console.log(`  the traverse finds ${starts.size} instructions from those entries and the handlers`);

// --- the scene is a program ------------------------------------------------------------
// This is the load-bearing check. If any operand length were wrong the decode would
// de-synchronise and either hit an opcode the interpreter refuses or run past the end of
// the file; it cannot drift back into phase.
console.log('\n=== the scene programs ===');
const lists = {};
for (const scene of ['SV DATA', 'SV DATA2']) {
  const { mem, loaded: l } = engineMemory(scene);
  const f = l.find((x) => x.name === scene);
  const r = disasmList(mem, f.addr, f.addr + f.len);
  lists[scene] = { r, mem, f };
  const spare = f.addr + f.len - r.end;
  console.log(`  ${scene}: ${r.items.length} instructions, ${hx(f.addr, 4)} to ${hx(r.end - 1, 4)}, `
    + `${spare} spare bytes (${[...mem.slice(r.end, f.addr + f.len)].map((v) => hx(v)).join(' ')})`);
  check(`${scene} decodes end to end and reaches its terminator`,
    r.ok && r.items[r.items.length - 1].op === END, r.ok ? '' : r.why);
  check(`${scene} leaves no unexplained tail`, spare <= 2, `${spare} bytes after the END`);
}

// The twelve-record "object table" probe_objtable.mjs found: here it is as instructions.
const objs = lists['SV DATA'].r.items.filter((i) => i.op === 19);
check('the scene holds twenty-four object instructions', objs.length === 24, `${objs.length}`);
check('and they sit on the two addresses the BASIC pokes',
  objs[0].at + 1 === 0x8124 && objs[12].at + 1 === 0x8248,
  `ST1 = ${hx(objs[0].at + 1, 4)}, TS1 = ${hx(objs[12].at + 1, 4)} - operand 0 of the opcode before`);

// What actually differs between the two scenes, in the language rather than in bytes.
{
  const a = lists['SV DATA'].r.items, b = lists['SV DATA2'].r.items;
  const differ = a.filter((x, i) => x.text !== b[i]?.text);
  console.log(`\n  SV DATA vs SV DATA2: ${differ.length} instructions differ, all of them objects:`);
  for (const x of differ) {
    const y = b[a.indexOf(x)];
    console.log(`    ${hx(x.at, 4)}  shape ${hx(object(lists['SV DATA'].mem, x.at).shape, 4)}`
      + ` -> ${hx(object(lists['SV DATA2'].mem, x.at).shape, 4)}`);
  }
  check('the two scenes differ only in which shapes their objects point at',
    differ.length > 0 && differ.every((x) => x.op === 19), `${differ.length} object instructions`);
}

// --- now watch it run ------------------------------------------------------------------
const a2 = await openOracle();
await a2.ev(`(async () => {
  const disk2 = window.M.a2.getIO()._slot[6];
  await disk2.setBinary(1, 'stardestroyer', 'dsk', await (await fetch('/disk.dsk')).arrayBuffer());
  window.M.a2.reset();
  const cpu = window.M.cpu, st = cpu.getState(); st.pc = 0xC600; cpu.setState(st);
  return 'booting';
})()`);

console.log('\n=== driving to flight ===');
let started = false;
for (let i = 0; i < 60 && !started; i++) {
  await a2.waitMs(500);
  started = (await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'));
}
let atSelect = false;
for (let i = 0; i < 60 && !atSelect; i++) {
  await a2.key(' ');
  await a2.waitMs(500);
  const id = identify(Uint8Array.from(await a2.readRange(0x2000, 0x4000)));
  atSelect = !!(id && id.name === 'DIFFICULTY.PIC');
}
let difficulty = 0;
for (let i = 0; i < 40 && !(difficulty >= 1 && difficulty <= 3); i++) {
  await a2.key('1');
  await a2.waitMs(500);
  difficulty = JSON.parse(await a2.ev('window.M.rd(0x1FF6)'));
}
check('the oracle reaches flight', started && atSelect && difficulty === 1,
  `difficulty ${difficulty}`);
await a2.waitMs(20000);

// One whole `CALL $6000`, instruction by instruction.
//
// stepCyclesDebug's callback runs AFTER each instruction, so the PC it sees is the address
// of the next one - which is the next instruction to execute, so the sequence of PCs is
// the sequence of executed addresses, short of the first. A frame is over when control is
// back at $607F, the entry wrapper's restore loop.
await a2.ev(`(() => {
  window.M.traceFrame = () => {
    const cpu = window.M.cpu, rd = window.M.rd;
    let entry = 0;
    cpu.stepCyclesDebug(17030 * 2000, () => {
      const p = cpu.getPC();
      if (p === ${ENTRY.render} || p === ${ENTRY.renderNoSave}) { entry = p; return true; }
    });
    if (!entry) return { error: 'the game never called the engine' };
    const memIn = window.M.range(0x6000, 0x9400);
    const t0 = cpu.getCycles();
    const cov = new Uint8Array(0x2100);
    const walk = [];
    let instr = 0, done = false;
    cpu.stepCyclesDebug(17030 * 2000, () => {
      const pc = cpu.getPC();
      instr++;
      if (pc >= 0x6000 && pc < 0x8100) cov[pc - 0x6000] = 1;
      if (pc === ${FETCH}) walk.push(rd(0x9B) | (rd(0x9C) << 8));
      if (pc === 0x607F) { done = true; return true; }
      if (instr > 4000000) { done = 'overrun'; return true; }
    });
    return { entry, done, instr, cycles: cpu.getCycles() - t0, walk, memIn,
      cov: Array.from(cov).map((b, i) => (b ? i + 0x6000 : -1)).filter((x) => x >= 0) };
  };
  return 'ok';
})()`);

console.log('\n=== tracing ===');
const frames = [];
for (let i = 0; i < 3; i++) {
  const t = JSON.parse(await a2.ev('JSON.stringify(window.M.traceFrame())'));
  if (t.error) { console.log('  ' + t.error); break; }
  console.log(`  frame ${i}: ${t.instr} instructions, ${t.cycles} cycles `
    + `(${(t.cycles / 17030).toFixed(2)} video frames, ${(t.cycles / 1020484 * 1000).toFixed(0)} ms), `
    + `${t.walk.length} display-list fetches`);
  frames.push(t);
}
check('three frames traced to completion', frames.length === 3 && frames.every((f) => f.done === true));
await a2.close();
if (!frames.length) { report(); }

const live = new Uint8Array(0x10000);
frames[0].memIn.forEach((v, i) => { live[0x6000 + i] = v; });

// --- the frame cadence -----------------------------------------------------------------
// The number a port has to hit. The Apple II runs at 1.0205 MHz, so cycles are time.
const cyc = frames.map((f) => f.cycles);
const mean = cyc.reduce((a, b) => a + b, 0) / cyc.length;
console.log(`\n=== cadence ===`);
console.log(`  ${Math.round(mean)} cycles a frame, ${(mean / 1020484 * 1000).toFixed(0)} ms, `
  + `${(1020484 / mean).toFixed(2)} renders a second`);
check('the three frames agree to within 2% - the engine is not frame-synced, it just runs',
  (Math.max(...cyc) - Math.min(...cyc)) / mean < 0.02,
  `${Math.min(...cyc)} to ${Math.max(...cyc)} cycles`);

// --- the engine rewrites itself ---------------------------------------------------------
// $600C-$606B is the zero-page save area, so it differs by design. Everything else that
// differs is the engine having patched its own instructions, and these are the four
// mechanisms in renderer.mjs's table. A port that treats the disk image as read-only code
// is porting something that never ran.
const patched = [];
for (let a = eng.addr; a < eng.addr + eng.len; a++) {
  if (a >= ZP_SAVE[0] && a <= ZP_SAVE[1]) continue;
  if (disk[a] !== live[a]) patched.push(a);
}
const runs = (arr) => {
  const out = []; let s = arr[0], p = arr[0];
  for (const a of arr.slice(1)) { if (a !== p + 1) { out.push([s, p]); s = a; } p = a; }
  if (arr.length) out.push([s, p]);
  return out;
};
console.log(`\n=== the engine's own code, as found vs as running ===`);
console.log(`  ${patched.length} bytes outside the save area differ, in ${runs(patched).length} runs`);
const VIEWPORT_PATCH = [0x6380, 0x6386, 0x63A3, 0x63A9];
check('opcode 14 patched the four viewport bytes in the projection code',
  VIEWPORT_PATCH.every((a) => patched.includes(a)),
  VIEWPORT_PATCH.map((a) => `${hx(a, 4)}=${disk[a]}->${live[a]}`).join(' '));
const plotPatches = runs(patched).filter(([a]) => a >= 0x7700 && a < 0x7D00);
check('and the plotting code was patched where opcodes 9 and 12 say it would be',
  plotPatches.length > 10, `${plotPatches.length} runs between $7700 and $7D00`);
check('the engine never rewrote its own dispatch table',
  !patched.some((a) => a >= DISPATCH && a < INTERP));

// --- static and dynamic have to agree ---------------------------------------------------
const executed = new Set(frames.flatMap((f) => f.cov));
const unknown = [...executed].filter((a) => !starts.has(a)).sort((x, y) => x - y);
console.log(`\n=== static traverse vs the trace ===`);
console.log(`  traverse found ${starts.size} instruction starts; the trace executed ${executed.size}`);
console.log(`  ${[...starts].filter((a) => !executed.has(a)).length} were never reached by this scene`);
// The disagreements are exactly in the self-patched stretch: the patched bytes change the
// instruction boundaries, so a disassembly of the disk image is off phase there. That is
// the finding, not a defect in the traverse - which is why this check names a region
// rather than demanding zero.
console.log(`  ${unknown.length} executed addresses the traverse did not find: `
  + unknown.map((a) => hx(a, 4)).join(' '));
check('every executed address the traverse missed lies in the self-patched plotting code',
  unknown.every((a) => a >= 0x7700 && a < 0x7D00), `${unknown.length} addresses`);

// --- the operand lengths ----------------------------------------------------------------
// The pointer between one fetch and the next IS the instruction's length, measured rather
// than reasoned about. Nesting shows up as a jump, forwards into a shape or back out of
// one, and those gaps are not lengths.
const measured = new Map();
for (const f of frames) {
  for (let i = 0; i < f.walk.length - 1; i++) {
    const at = f.walk[i], next = f.walk[i + 1], op = live[at], d = next - at;
    if (d > 0 && d < 32) {
      if (!measured.has(op)) measured.set(op, new Set());
      measured.get(op).add(d);
    }
  }
}
console.log(`\n=== operand lengths ===`);
let agree = 0, disagree = [];
for (const op of [...measured.keys()].sort((a, b) => a - b)) {
  const seen = [...measured.get(op)];
  const want = OPS[op]?.len;
  const ok = seen.length === 1 && seen[0] === want;
  if (ok) agree++; else disagree.push(`op ${op}: measured ${seen.join('/')}, table says ${want}`);
  console.log(`  op ${String(op).padStart(3)} @ ${hx(H[op] ?? 0, 4)}  measured ${seen.join('/')} `
    + `${ok ? '=' : '!='} ${want}   ${OPS[op]?.what ?? ''}`);
}
check('every length the trace measured is the length the handler advances by',
  disagree.length === 0, disagree.join('; ') || `${agree} opcodes`);
const untraced = Object.keys(OPS).map(Number).filter((o) => o < OPCODES && !measured.has(o));
console.log(`  never executed by this scene, so their lengths are read off the handler only: `
  + untraced.join(', '));

// --- the walk is the program --------------------------------------------------------------
// The trace walked SV DATA and then walked into MAIN DATA and back. Those excursions must
// be exactly the shape addresses the decoded program points at, or one of the two readings
// is wrong.
const walk = frames[0].walk;
const intoShapes = [];
for (let i = 0; i < walk.length - 1; i++) {
  const d = walk[i + 1] - walk[i];
  if (live[walk[i]] === 19 && (d <= 0 || d >= 32)) intoShapes.push({ from: walk[i], to: walk[i + 1] });
}
const shapesOf = new Map(objs.map((o) => [o.at, object(lists['SV DATA'].mem, o.at).shape]));
const mismatched = intoShapes.filter((x) => shapesOf.get(x.from) !== x.to);
console.log(`\n=== the walk ===`);
console.log(`  ${walk.length} fetches; ${intoShapes.length} objects were switched on and recursed into`);
check('each recursion went to the shape its object instruction names',
  intoShapes.length > 0 && mismatched.length === 0,
  mismatched.length ? mismatched.map((x) => `${hx(x.from, 4)}->${hx(x.to, 4)}`).join(' ')
    : intoShapes.map((x) => hx(x.to, 4)).join(' '));
check('the walk ends on the terminator the program ends with',
  live[walk[walk.length - 1]] === END
    && walk[walk.length - 1] === lists['SV DATA'].r.items[lists['SV DATA'].r.items.length - 1].at,
  hx(walk[walk.length - 1], 4));

// Objects with a count between 1 and 254 tick down in the list itself, so the same byte
// read twice in two frames is a live counter, not configuration.
const countsFell = frames.length > 1 && (() => {
  const a = new Uint8Array(0x10000), b = new Uint8Array(0x10000);
  frames[0].memIn.forEach((v, i) => { a[0x6000 + i] = v; });
  frames[2].memIn.forEach((v, i) => { b[0x6000 + i] = v; });
  return objs.filter((o) => a[o.at + 1] !== b[o.at + 1] && a[o.at + 1] !== 0xFF).length;
})();
console.log(`  object counters that changed between frame 0 and frame 2: ${countsFell}`);

// --- the listings ------------------------------------------------------------------------
// Two listings, because there are two: the engine's 6502, and the scene's display list.
// The engine listing is of the RUNNING image, with the patched bytes in place, since those
// are the instructions that execute.
fs.mkdirSync('listing', { recursive: true });
const sym = symbols(disk);
const runningImage = new Uint8Array(disk);
for (const a of patched) runningImage[a] = live[a];
const { starts: liveStarts } = engineCode(runningImage);
fs.writeFileSync('listing/A2-3D2.asm',
  `; A2-3D2, $6000-$80FA, 8443 bytes, as it is while the game flies.\n`
  + `; Produced by probe_renderer.mjs. The bytes are the resident image, which differs\n`
  + `; from the disk file in ${patched.length} places the engine patched into itself.\n`
  + `; Gaps printed as .byte are bytes nothing reaches from the entry points: the\n`
  + `; zero-page save area ${hx(ZP_SAVE[0], 4)}-${hx(ZP_SAVE[1], 4)}, the dispatch table at\n`
  + `; ${hx(DISPATCH, 4)}, the sine table at $6147, and the engine's own variables.\n;\n`
  + listing(runningImage, { code: liveStarts, sym }).join('\n') + '\n');
for (const scene of ['SV DATA', 'SV DATA2']) {
  const { r, mem } = lists[scene];
  const out = [`; ${scene}: the scene, disassembled as a display-list program.`,
    `; ${r.items.length} instructions. Opcode and operands, then what the handler does with them.`, ';'];
  for (const i of r.items) {
    out.push(`${hx(i.at, 4)}  ${[...mem.slice(i.at, i.at + (i.len ?? 3))]
      .map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(41)}  ${i.text}`);
  }
  fs.writeFileSync(`listing/${scene.replace(/ /g, '_')}.list`, out.join('\n') + '\n');
}
console.log(`\nwrote listing/A2-3D2.asm, listing/SV_DATA.list, listing/SV_DATA2.list`);

fs.mkdirSync('captured/renderer', { recursive: true });
fs.writeFileSync('captured/renderer/golden.json', JSON.stringify({
  entries: ENTRY, dispatch: DISPATCH, handlers: H, ops: OPS,
  cadence: { cycles: cyc, meanCycles: Math.round(mean), ms: +(mean / 1020484 * 1000).toFixed(1),
    rendersPerSecond: +(1020484 / mean).toFixed(2), instructions: frames.map((f) => f.instr) },
  patched: runs(patched).map(([a, b]) => [hx(a, 4), hx(b, 4)]),
  lengths: [...measured.entries()].map(([op, s]) => [op, [...s]]),
  walk: walk.map((a) => hx(a, 4)),
  program: lists['SV DATA'].r.items.map((i) => ({ at: hx(i.at, 4), op: i.op, text: i.text })),
  results,
}, null, 1) + '\n');

report();

function report() {
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(failed === 0 ? `renderer: all ${results.length} checks passed`
    : `renderer: ${failed} of ${results.length} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
