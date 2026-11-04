// Range and bearing: the two idioms the frame loop asks a geometric question with.
//
// Seven of the nine places the game works out where something is are one of these two
// blocks again with different indices out of the directory at $08F2, so establishing them
// twice settles five of the big loop regions. The range appears four times, the bearing
// three, and this probe's first job is to show that those copies really are copies - that
// the port is entitled to be one function called seven ways rather than seven functions.
//
// Neither block is a subroutine except once: $1C3D is the range wrapped in an RTS. The
// other six are inline, so they are measured by setting the PC and running to the
// instruction after the block, which is also why this probe carries its own harness rather
// than reusing probe_math's `mathRun`.
//
// One hazard found while writing it, now fixed in exercise.mjs: `toFlight` could return
// while DOS was still loading the binary, with everything above $17EB - including $1C3D -
// still holding the power-on fill. Measuring in that window would have produced numbers
// from nothing at all.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0, OBJ0_VARIABLES } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import fs from 'fs';
import { ATAN_THRESHOLD, VARS } from '../port/src/game/tables.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
/** A byte of the binary as the file has it. */
const at = (a) => obj.data[a - obj.addr];
/** A run of the binary's bytes. */
const bytes = (a, n) => [...obj.data.slice(a - obj.addr, a - obj.addr + n)];

// --- the copies --------------------------------------------------------------------------------
// The whole case for one ported function per idiom rests on this, and it is a byte
// comparison, so it is the one part of this probe that needs no machine at all.
console.log('\n=== four copies of the range, three of the bearing ===');

/** $0C0F, $101F, $1429 inline and $1C3D as a subroutine. */
const RANGE = [0x0C0F, 0x101F, 0x1429, 0x1C3D];
const RANGE_LEN = 0x4B;
/** $0C5A, $106A, $1474 - each immediately after an inline range. */
const BEARING = [0x0C5A, 0x106A, 0x1474];
const BEARING_LEN = 0x101;

{
  // The four range copies take their coordinates from four index loads at the top, and that
  // is all they are allowed to differ in: the 54 bytes of arithmetic after them must match.
  const tails = RANGE.map((a) => bytes(a + 0x15, RANGE_LEN - 0x15).join(','));
  check('the four range copies have byte-identical arithmetic after their four index loads',
    new Set(tails).size === 1,
    `${RANGE_LEN - 0x15} bytes from +$15, at ${RANGE.map((a) => hx(a, 4)).join(', ')}`);

  const sources = RANGE.map((a) => [1, 4, 0x10, 0x13].map((k) =>
    hx(at(a + k) | (at(a + k + 1) << 8), 4)));
  for (const [i, a] of RANGE.entries()) {
    console.log(`  ${hx(a, 4)}: delta = (${sources[i][0]} - ${sources[i][1]},`
      + ` ${sources[i][2]} - ${sources[i][3]})`);
  }
  // Each load must be an LDY/LDX of a directory address, which is what makes the operands
  // the only thing a copy can vary.
  const wellFormed = RANGE.every((a) => [[0, 0xAC], [3, 0xAE], [0x0F, 0xAC], [0x12, 0xAE]]
    .every(([k, op]) => at(a + k) === op)
    && [1, 4, 0x10, 0x13].every((k) => {
      const v = at(a + k) | (at(a + k + 1) << 8);
      return v >= 0x08F2 && v <= 0x0932;
    }));
  check('and their differences are only which directory addresses the two points come from',
    wellFormed, 'four LDY/LDX pairs, every operand inside $08F2-$0932');

  check('$1C3D is the same block with an RTS after it, which is why nine callers can share it',
    at(0x1C88) === 0x60 && bytes(0x1C3D + 0x15, RANGE_LEN - 0x15).join(',') === tails[0],
    `$1C88 = ${hx(at(0x1C88))}`);
}

{
  // The bearing copies are longer and contain jumps, so "identical" has to mean identical
  // once the jump targets move with the copy. Anything else differing is a real difference.
  const relocated = [];
  const stray = [];
  for (let c = 1; c < BEARING.length; c++) {
    const delta = BEARING[c] - BEARING[0];
    for (let k = 0; k < BEARING_LEN; k++) {
      if (at(BEARING[0] + k) === at(BEARING[c] + k)) continue;
      const word = (base, off) => at(base + off) | (at(base + off + 1) << 8);
      const asReloc = [k, k - 1].find((off) => off >= 0
        && word(BEARING[c], off) - word(BEARING[0], off) === delta);
      if (asReloc === undefined) stray.push(`+${hx(k)} in ${hx(BEARING[c], 4)}`);
      else relocated.push(`+${hx(asReloc)}`);
    }
  }
  console.log('  relocated operands: ' + [...new Set(relocated)].join(', '));
  check('the three bearing copies are byte-identical once their jump targets move with them',
    stray.length === 0 && relocated.length > 0,
    stray.slice(0, 4).join('; ') || `${BEARING_LEN} bytes, `
      + `${new Set(relocated).size} relocated words, nothing else differs`);
}

{
  // Forty bytes at the end of each copy are jumped straight over. They are worth reading,
  // because they are the clamp that would have stopped the overshoot measured further down.
  const dead = 0xD9;
  const jmpAt = dead - 3;
  const targets = BEARING.map((a) => at(a + jmpAt + 1) | (at(a + jmpAt + 2) << 8));
  check('each copy ends with a JMP over forty bytes that are therefore never executed',
    BEARING.every((a, i) => at(a + jmpAt) === 0x4C && targets[i] === a + BEARING_LEN),
    BEARING.map((a, i) => `${hx(a + jmpAt, 4)} -> ${hx(targets[i], 4)}`).join(', '));

  console.log('  what they would have done:');
  const mem = [];
  for (let k = 0; k < 40; k++) mem[BEARING[0] + dead + k] = at(BEARING[0] + dead + k);
  const clamp = disasmRange(mem, BEARING[0] + dead, BEARING[0] + dead + 40);
  for (const line of clamp) console.log(`    ${hx(line.addr, 4)}  ${line.text}`);
  // Two compare-and-copy pairs: compare the bearing against a bound and copy the bound in
  // if it is past it. That is a clamp, and the bound in the first pair is the entry at
  // $0923, which the machine section below shows holds 256 heading units - one short of the
  // 257 the live path actually produces.
  check('they are a clamp of the bearing between the entries at $091F and $0923',
    clamp.map((l) => l.text).join('|') === ['LDY $0923', 'LDX $090B', 'JSR $99D2', 'BPL $0D47',
      'LDY $090B', 'LDX $0923', 'JSR $9C4B', 'LDY $090B', 'LDX $091F', 'JSR $99D2',
      'BPL $0D5B', 'LDY $090B', 'LDX $091F', 'JSR $9C4B'].join('|'),
    'compare against $0923 and copy it in, then compare against $091F and copy that in');
}

// --- the machine -------------------------------------------------------------------------------
console.log('\n=== the oracle, with the binary fully resident ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight and waits for the whole binary to load',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle;`
    + ` variables at ${OBJ0_VARIABLES.map(([l, h]) => `${hx(l, 4)}-${hx(h, 4)}`).join(' and ')}`);

/**
 * Run a block of game code with the table and the registers set, and read everything back.
 *
 * Not a subroutine call: the PC is set to `start` and the machine stepped until it reaches
 * `stop`, which is the address after the block. That is the only way to measure six of the
 * seven copies, since they are inline. Zero page below $0A and from $E0 up is cleared first,
 * so a block can never be read against what the last one left behind, and the table, zero
 * page and CPU state are all restored afterwards.
 */
await a2.ev(`(() => {
  const RA = 0xFA, RB = 0xEB, RE = 0xFD;
  const put24 = (at, v) => { const wr = window.M.wr;
    wr(at, v & 0xff); wr(at + 1, (v >> 8) & 0xff); wr(at + 2, (v >> 16) & 0xff); };
  const get24 = (at) => { const rd = window.M.rd;
    return rd(at) | (rd(at + 1) << 8) | (rd(at + 2) << 16); };
  window.M.blockRun = (start, stop, table, cells, regs, budget) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snapTab = []; for (let a = 0x9800; a < 0x98F3; a++) snapTab.push(rd(a));
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0; a < 0x0A; a++) wr(a, 0);
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0); wr(0xCF, 0);
    put24(RA, (regs.acc || 0) & 0xFFFFFF);
    put24(RB, (regs.b || 0) & 0xFFFFFF);
    put24(RE, (regs.ext || 0) & 0xFFFFFF);
    for (const [i, v] of Object.entries(table || {})) put24(0x9800 + Number(i), v & 0xFFFFFF);
    for (const [i, v] of Object.entries(cells || {})) wr(0x9800 + Number(i), v & 0xff);
    const st = cpu.getState(); st.pc = start; cpu.setState(st);
    let arrived = false, instr = 0;
    cpu.stepCyclesDebug(budget || 4000000, () => {
      instr++; if (cpu.getPC() === stop) { arrived = true; return true; }
    });
    const end = cpu.getState();
    const out = { arrived, instr, a: end.a, x: end.x, y: end.y,
      acc: get24(RA), b: get24(RB), ext: get24(RE),
      sign: rd(0xCE), sign2: rd(0xCF), savedX: rd(0xEE), f9: rd(0xF9),
      r3: get24(3), r7: get24(7), table: window.M.range(0x9800, 0x98F3) };
    for (let a = 0x9800; a < 0x98F3; a++) wr(a, snapTab[a - 0x9800]);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return out;
  };
  return 'ok';
})()`);
const blockRun = (start, stop, table = {}, cells = {}, regs = {}) => a2.ev(
  'JSON.stringify(window.M.blockRun(' + start + ',' + stop + ',' + JSON.stringify(table)
  + ',' + JSON.stringify(cells) + ',' + JSON.stringify(regs) + '))').then(JSON.parse);
/** A 24-bit entry out of a returned table image. */
const ent = (t, i) => s24(t[i] | (t[i + 1] << 8) | (t[i + 2] << 16));

// --- the directory and the five constants ------------------------------------------------------
console.log('\n=== the indices, and the entries that are constants of the build ===');
const dirLive = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x08F2, 0x0933))'));
const I = {};
for (const [name, address] of [['aX', 0x092B], ['aZ', 0x092C], ['bX', 0x092D], ['bZ', 0x092E],
  ['shipX', 0x0901], ['shipZ', 0x0903], ['deltaX', 0x0908], ['deltaZ', 0x0909],
  ['range', 0x090A], ['bearing', 0x090B], ['scratch', 0x090C],
  ['zero', 0x091F], ['two', 0x0920], ['deg90', 0x0921], ['deg271', 0x0922],
  ['limit', 0x0923], ['degreesPerUnit', 0x0924]]) {
  I[name] = dirLive[address - 0x08F2];
}
{
  const mismatched = dirLive.filter((v, i) => v !== VARS[i] || v !== at(0x08F2 + i)).length;
  check('the directory in the running machine is .OBJ0\'s own data, and the port\'s copy of it',
    dirLive.length === 65 && mismatched === 0 && VARS.length === 65,
    `65 entries, identical in the file, the machine and port/src/game/tables.js`);

  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const K = Object.fromEntries(['zero', 'two', 'deg90', 'deg271', 'limit', 'degreesPerUnit']
    .map((n) => [n, ent(tab, I[n])]));
  for (const [n, v] of Object.entries(K)) {
    console.log(`  ${n.padEnd(15)} index ${String(I[n]).padStart(3)} = ${String(v).padStart(6)}`
      + `  = ${v / 256}`);
  }
  check('the quadrant tests compare against an entry holding zero',
    K.zero === 0, `index ${I.zero} = ${K.zero}`);
  check('the range scales each delta by an entry holding 2.0, which is why it is not a square',
    K.two === 512, `index ${I.two} = ${K.two}, i.e. ${K.two / 256}`);
  check('two quadrants are resolved against 90 degrees', K.deg90 === 90 * 256,
    `${K.deg90} = ${K.deg90 / 256} degrees`);
  // The two oddities. Both are checks that fail if anyone tidies the port towards the
  // textbook values, which is exactly why they are here.
  check('the other two are resolved against 271 degrees, NOT 270',
    K.deg271 === 271 * 256 && K.deg271 !== 270 * 256,
    `${K.deg271} = ${K.deg271 / 256} degrees; 270 would be ${270 * 256}`);
  check('and degrees become heading units by dividing by 359, NOT 360',
    K.degreesPerUnit === 359 && K.degreesPerUnit !== 360,
    `${K.degreesPerUnit}; a full turn is 256*256/359 = ${(65536 / 359).toFixed(2)} units`
      + ` where 360 would give ${(65536 / 360).toFixed(2)}`);
  console.log(`  the clamp that is jumped over would have limited the bearing to`
    + ` ${ent(tab, I.limit) / 256} units`);

  // Nothing writes any of them, so they can be treated as constants rather than state.
  const asm = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8');
  const written = [0x091F, 0x0920, 0x0921, 0x0922, 0x0923, 0x0924]
    .filter((a) => new RegExp('ST[AXY] \\' + hx(a, 4)).test(asm));
  check('no instruction in the binary writes those directory addresses, so they are constants',
    written.length === 0,
    written.length ? written.map((a) => hx(a, 4)).join(', ')
      : '$091F-$0924 appear only as LDX and LDY operands');
}

// --- the range ---------------------------------------------------------------------------------
console.log('\n=== $1C3D: the range ===');
console.log('  nine instructions: two subtracts, two scale-and-absolute-value, an add,');
console.log('  a square root and a store');
{
  const cases = [];
  for (const dx of [0, 1, 255, 256, 1000, -1, -256, -25600, 65536, 786432, -786432]) {
    for (const dz of [0, 1, 256, 2400, -256, -12800, 409600, -344064]) cases.push([dx, dz]);
  }
  const wrong = [], euclid = [];
  for (const [dx, dz] of cases) {
    const r = await blockRun(0x1C3D, 0x1C88,
      { [I.aX]: u24(dx), [I.aZ]: u24(dz), [I.bX]: 0, [I.bZ]: 0 });
    const t = r.table;
    if (!r.arrived) { wrong.push(`(${dx},${dz}): never returned`); continue; }
    const sum = 2 * (Math.abs(dx) + Math.abs(dz));
    const model = Math.trunc(Math.sqrt(sum * 256));
    if (ent(t, I.deltaX) !== dx || ent(t, I.deltaZ) !== dz) {
      wrong.push(`(${dx},${dz}): deltas ${ent(t, I.deltaX)},${ent(t, I.deltaZ)}`);
    }
    if (ent(t, I.scratch) !== 2 * Math.abs(dx)) {
      wrong.push(`(${dx},${dz}): scratch ${ent(t, I.scratch)}, expected ${2 * Math.abs(dx)}`);
    }
    if (ent(t, I.range) !== model) wrong.push(`(${dx},${dz}): ${ent(t, I.range)} not ${model}`);
    const hyp = Math.trunc(Math.sqrt(dx * dx + dz * dz));
    if (hyp !== ent(t, I.range)) euclid.push(1);
  }
  check('the range is sqrt(2 * (|dx| + |dz|) * 256): the root of twice the L1 norm',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `${cases.length} separations, deltas and scratch checked too`);
  // The control. A hypotenuse is the obvious thing to write and it is wrong nearly always.
  check('control: it is NOT a Euclidean distance, and almost nothing agrees with one',
    euclid.length > cases.length * 0.8,
    `a hypotenuse disagrees on ${euclid.length} of ${cases.length}`);

  // What the scale means in world units, and the one place it is read.
  const far = await blockRun(0x1C3D, 0x1C88,
    { [I.aX]: u24(786432), [I.aZ]: u24(409600), [I.bX]: u24(-786432), [I.bZ]: u24(-344064) });
  const corner = ent(far.table, I.range);
  check('so it compresses hard: opposite corners of the world are only 135 units apart',
    corner === 34513, `${corner}, i.e. ${(corner / 256).toFixed(1)} units,`
      + ` where the Euclidean distance is ${Math.round(Math.hypot(1572864, 753664) / 256)}`);
  // 24-bit arithmetic, and the bound that keeps it safe.
  const widest = 2 * (1572864 + 753664);
  check('and the sum cannot overflow 24 bits, because the world is not wide enough',
    widest < 0x800000, `the widest possible sum is ${widest}, against ${0x800000}`);
}

// --- the bearing -------------------------------------------------------------------------------
console.log('\n=== $0C5A-$0D30: the bearing ===');

/** $9C04's answer in whole degrees, from the thresholds probe_math measured out of it. */
const atanDeg = (acc) => {
  const m = Math.abs(s24(u24(acc)));
  let deg = 0;
  for (let i = 0; i < ATAN_THRESHOLD.length; i++) {
    if (m >= ATAN_THRESHOLD[i]) deg = i + 1; else break;
  }
  return deg;
};
/** The nudge: one added to a delta's low byte, carry discarded. */
const nudge = (v) => {
  const m = u24(v);
  return s24((m & 0xFFFF00) | ((m + 1) & 0xff));
};
/**
 * The whole block, as a model: nudge, divide, arctangent, quadrant fold, rescale.
 *
 * The divide works on magnitudes - $9B00 strips both signs and records whether they
 * disagreed - and re-signs the quotient at the end. $9C04 then strips the sign off the angle
 * and $9A04 takes the magnitude again, so the ratio's sign never reaches the answer; the
 * quadrant comes entirely from the fold below.
 *
 * A quotient of 24 bits or more **saturates** - the quotient register fills with ones and
 * comes out $FFFFFF, exactly as it does for a zero divisor - so the model saturates too.
 * That matters here and not in the abstract: a target on an axis gives a nudged delta of 1,
 * and 409601*256 is far past 24 bits, so the game reaches it. `wrapInstead` is the same model
 * with the quotient wrapped into the register instead, which is what the port did until this
 * probe measured it, and it is carried along as a control.
 */
const bearingModel = (dx, dz, { wrapInstead = false } = {}) => {
  const nx = nudge(dx), nz = nudge(dz);
  const den = Math.abs(nx), num = Math.abs(nz) * 256;
  const exact = den === 0 ? Infinity : Math.trunc(num / den);
  const q = exact >= 0x1000000 && !wrapInstead ? 0xFFFFFF : (den === 0 ? 0xFFFFFF : exact);
  const negated = (nx < 0) !== (nz < 0);
  let deg = atanDeg(s24(u24(negated ? -q : q)));
  // The fold, on the nudged deltas, in the original's order. Zero takes neither of the
  // first two branches and neither of the last two, so it leaves the angle alone.
  if (nx < 0 && nz < 0) deg = 90 - deg;
  else if (nx < 0 && nz > 0) deg = deg + 90;
  else if (nx > 0 && nz > 0) deg = 271 - deg;
  else if (nx > 0 && nz < 0) deg = deg + 271;
  return { deg, units: Math.trunc(deg * 256 * 256 / 359), q,
    inDomain: den !== 0 && exact < 0x1000000 };
};

{
  const cases = [];
  for (const dx of [0, 1, 2, 255, 256, 257, 511, 1000, 2560, 65536, 786432,
    -1, -255, -256, -1000, -2560, -65536, -786432]) {
    for (const dz of [0, 1, 256, 1000, 2560, 65536, 409600, -1, -256, -1000, -2560, -344064]) {
      cases.push([dx, dz]);
    }
  }
  const wrongDeg = [], wrongUnits = [], degs = [];
  let saturating = 0, wrapWrong = 0;
  for (const [dx, dz] of cases) {
    const before = await blockRun(0x0C5A, 0x0D21, { [I.deltaX]: u24(dx), [I.deltaZ]: u24(dz) });
    const after = await blockRun(0x0C5A, 0x0D5B, { [I.deltaX]: u24(dx), [I.deltaZ]: u24(dz) });
    if (!before.arrived || !after.arrived) { wrongDeg.push(`(${dx},${dz}): ran away`); continue; }
    const deg = ent(before.table, I.bearing) / 256;
    const units = ent(after.table, I.bearing);
    const want = bearingModel(dx, dz);
    degs.push(deg);
    // The nudge is visible in the table the block leaves behind, whatever the divide did.
    if (ent(after.table, I.deltaX) !== nudge(dx)) {
      wrongDeg.push(`(${dx},${dz}): delta ${ent(after.table, I.deltaX)} not ${nudge(dx)}`);
    }
    if (deg !== want.deg) wrongDeg.push(`(${dx},${dz}): ${deg} not ${want.deg}`);
    if (units !== want.units) wrongUnits.push(`(${dx},${dz}): ${units} not ${want.units}`);
    if (!want.inDomain) {
      saturating++;
      const wrapped = bearingModel(dx, dz, { wrapInstead: true });
      if (wrapped.deg !== deg) wrapWrong++;
    }
  }
  check('at $0D21 the bearing is a whole number of degrees, folded into its quadrant',
    wrongDeg.length === 0 && degs.length === cases.length, wrongDeg.slice(0, 4).join('; ')
      || `all ${cases.length} separations, against the arctangent thresholds and the fold`);
  check('and $0D21 rescales it to heading units by dividing by 359',
    wrongUnits.length === 0, wrongUnits.slice(0, 4).join('; ') || `${cases.length} separations`);
  console.log(`  ${saturating} of ${cases.length} separations drive the divide past 24 bits,`
    + ` which a target near an axis does - its quotient register saturates to $FFFFFF`);
  // The control for that. A wrapping quotient is the obvious reading of a 24-bit register
  // and it is the wrong one. It does not go wrong on every saturating case, because a
  // wrapped quotient often still lands in the same whole degree; what matters is that the
  // two readings are distinguishable here and the machine follows saturation on all 216.
  check('control: a divide that wrapped its quotient instead of saturating would be wrong',
    saturating > 10 && wrapWrong >= 5,
    `${wrapWrong} of the ${saturating} saturating separations tell the two readings apart,`
      + ` and the machine agrees with saturation on every one`);
  console.log(`  degrees seen: ${Math.min(...degs)} to ${Math.max(...degs)}`);
  check('the fold runs past a full turn - 361 degrees is reachable, and 257 heading units',
    Math.max(...degs) === 361,
    `${Math.max(...degs)} degrees, which is ${Math.trunc(361 * 65536 / 359)} units`
      + ` - more than a byte, and the caller at $0D63 reads the middle byte, so it wraps to 1`);
}

// --- the nudge ---------------------------------------------------------------------------------
console.log('\n=== the increment at $0C5A, which is a guard and a bug at once ===');
{
  // What it is for: a delta of zero would divide by zero.
  const onAxis = await blockRun(0x0C5A, 0x0D5B, { [I.deltaX]: 0, [I.deltaZ]: u24(256) });
  check('a target on the axis has a delta of zero, and the increment makes it one',
    ent(onAxis.table, I.deltaX) === 1,
    `delta 0 -> ${ent(onAxis.table, I.deltaX)}, so the divide has a divisor`);

  // What it costs: a low byte of $FF wraps to zero and takes the divisor with it.
  const wrapped = await blockRun(0x0C5A, 0x0D5B, { [I.deltaX]: u24(255), [I.deltaZ]: u24(1000) });
  const unwrapped = await blockRun(0x0C5A, 0x0D5B, { [I.deltaX]: u24(254), [I.deltaZ]: u24(1000) });
  check('but a delta of 255 wraps to zero, so the increment causes the divide by zero it guards',
    ent(wrapped.table, I.deltaX) === 0 && ent(wrapped.table, I.bearing) === 0
      && ent(unwrapped.table, I.bearing) !== 0,
    `255 -> 0 and the bearing collapses to 0, where 254 -> 255 gives`
      + ` ${(ent(unwrapped.table, I.bearing) / 256).toFixed(1)} units`);

  // It is not cosmetic, but where it bites has to be stated precisely or the control is
  // worthless: the increment moves a delta by one part in its own magnitude, so it changes
  // the angle almost always when the deltas are small and almost never when they are large.
  // Both rates are measured, and the control is on the small ones.
  const rate = async (deltas) => {
    let moved = 0, total = 0;
    const sample = [];
    for (const dx of deltas) {
      for (const dz of deltas) {
        total++;
        const real = await blockRun(0x0C5A, 0x0D5B, { [I.deltaX]: u24(dx), [I.deltaZ]: u24(dz) });
        // The same block entered just past the increments, with the deltas left alone.
        const without = await blockRun(0x0C72, 0x0D5B,
          { [I.deltaX]: u24(dx), [I.deltaZ]: u24(dz) });
        if (ent(real.table, I.bearing) !== ent(without.table, I.bearing)) {
          moved++;
          if (sample.length < 3) {
            sample.push(`(${dx},${dz}): ${(ent(real.table, I.bearing) / 256).toFixed(2)}`
              + ` against ${(ent(without.table, I.bearing) / 256).toFixed(2)}`);
          }
        }
      }
    }
    return { moved, total, sample };
  };
  const small = await rate([1, 2, 3, 5, 9, -1, -2, -3, -5, -9]);
  const large = await rate([2560, 25600, -2560, -25600]);
  console.log(`  with deltas under a whole unit it changes ${small.moved} of ${small.total}`
    + ` bearings; with deltas in the thousands, ${large.moved} of ${large.total}`);
  check('control: a port that skipped the increment gets most near separations wrong',
    small.moved > small.total / 2, `${small.moved} of ${small.total} differ - `
      + small.sample.join('; '));
}

// --- the copies agree in the machine, not just in the file -------------------------------------
console.log('\n=== the three bearing copies, run ===');
{
  const wrong = [];
  for (const [dx, dz] of [[256, 256], [-256, 256], [-256, -256], [256, -256],
    [0, 1000], [1000, 0], [2560, -1000], [-65536, 409600]]) {
    const out = [];
    for (const a of BEARING) {
      const r = await blockRun(a, a + BEARING_LEN, { [I.deltaX]: u24(dx), [I.deltaZ]: u24(dz) });
      if (!r.arrived) wrong.push(`${hx(a, 4)} (${dx},${dz}): ran away`);
      out.push(ent(r.table, I.bearing));
    }
    if (new Set(out).size !== 1) wrong.push(`(${dx},${dz}): ${out.join(' / ')}`);
  }
  check('all three produce the same bearing from the same deltas, in the running machine',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `8 separations through $0C5A, $106A and $1474`);
}

// --- what the callers do with it ---------------------------------------------------------------
console.log('\n=== how the answers are read ===');
{
  const lines = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8').split(/\r?\n/)
    .map((l) => {
      const m = l.match(/^\$([0-9A-F]{4})\s+(?:\S+:\s+)?((?:[0-9A-F]{2} )+)\s*(.*)$/);
      return m ? { addr: parseInt(m[1], 16), text: m[3].trim() } : null;
    });
  const callSites = lines.map((r, i) => (r && r.text === 'JSR L1C3D' ? i : -1))
    .filter((i) => i >= 0);
  // Every caller must set all four argument slots in the instructions immediately before it.
  const unprepared = callSites.filter((i) => {
    const slots = new Set();
    for (let j = i - 1, n = 0; j >= 0 && n < 14; j--) {
      if (!lines[j]) continue;
      n++;
      const m = lines[j].text.match(/^LD[XY] \$(092[BCDE])$/);
      if (m) slots.add(m[1]);
    }
    return slots.size !== 4;
  }).map((i) => hx(lines[i].addr, 4));
  check('$1C3D is called from nine places, each of which fills all four argument slots first',
    callSites.length === 9 && unprepared.length === 0,
    unprepared.length ? `not prepared at ${unprepared.join(', ')}`
      : callSites.map((i) => hx(lines[i].addr, 4)).join(', '));

  // The range is compared against a threshold; the bearing is steered towards.
  const thresholds = new Set();
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i] && lines[i].text === 'LDY $090A' && lines[i + 1]) {
      const m = lines[i + 1].text.match(/^LDX (\$[0-9A-F]{4})$/);
      if (m) thresholds.add(m[1]);
    }
  }
  console.log('  the range at $090A is compared against ' + [...thresholds].join(', '));
  const heading = lines.filter((r) => r && r.text === 'CMP $9801,Y').length;
  check('the bearing is read back as the middle byte of its entry, which is the heading unit',
    heading >= 3, `${heading} sites compare a heading against $9801,Y`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
