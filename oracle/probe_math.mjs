// MATH ($98F3, 1,023 bytes) - a 24-bit signed accumulator machine.
//
// The frame loop moves the ship through this file. The first attempt to establish it treated
// its entry points as pure functions of a table and swept inputs through them, the way $6480
// and $65DE in the engine were settled. That was the wrong shape, and it produced two
// confident, repeatable, wrong answers: $999B looked like "return the entry's high byte" and
// $9C7A like "zero the entry". Both passed sweeps of eighteen values.
//
// They are add and store-accumulator. The sweeps varied the table and never varied the
// registers, and ACC happened to be zero in the machine state the harness restored, so
// `ACC + entry` read as `entry` and `store ACC` read as `store 0`. **A sweep over inputs
// cannot see a register it never varies**, however many inputs it uses. What settled it was
// reading the code; what keeps it settled is varying ACC and B below, plus the two regression
// checks that fail if either old reading is ever true again.
//
// **The registers**, 24-bit little-endian in zero page:
//   ACC  $FA-$FC   the accumulator        B    $EB-$ED   the operand
//   EXT  $FD-$FF   remainder / high half  $CE  the divide's sign flag
//   $EE            where $9C5C parks X
//
// **The table** is byte-indexed from $9800: an index is a byte offset, a value is the three
// bytes at it. Entries sit 3 apart by convention, but the loop uses other offsets too.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { hx } from './disasm6502.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight, with MATH resident', flight.difficulty === 1);

/**
 * Call a MATH routine with the table AND the registers set, and read both back.
 *
 * `regs` takes acc, b, ext and sign; anything left out is zeroed, so a routine can never be
 * read against whatever the previous call happened to leave behind. Everything is restored
 * afterwards. `calls` repeats the routine without resetting in between, which is how the
 * accumulator's persistence gets tested at all.
 */
await a2.ev(`(() => {
  const RA = 0xFA, RB = 0xEB, RE = 0xFD;
  const put24 = (wr, at, v) => {
    wr(at, v & 0xff); wr(at + 1, (v >> 8) & 0xff); wr(at + 2, (v >> 16) & 0xff);
  };
  const get24 = (rd, at) => rd(at) | (rd(at + 1) << 8) | (rd(at + 2) << 16);
  window.M.mathRun = (addr, x, y, table, regs, calls, hold) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snapTab = []; for (let a = 0x9800; a < 0x98F3; a++) snapTab.push(rd(a));
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, (regs.sign || 0) & 0xff);
    put24(wr, RA, (regs.acc || 0) & 0xFFFFFF);
    put24(wr, RB, (regs.b || 0) & 0xFFFFFF);
    put24(wr, RE, (regs.ext || 0) & 0xFFFFFF);
    for (const [i, v] of Object.entries(table)) put24(wr, 0x9800 + Number(i), v & 0xFFFFFF);
    let cx = x & 0xff, cy = y & 0xff, returned = true, aReg = 0;
    for (let n = 0; n < (calls || 1); n++) {
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = addr; st.x = cx; st.y = cy;
      cpu.setState(st);
      let ok = false;
      cpu.stepCyclesDebug(3000000, () => {
        if (cpu.getPC() === 0xFFFF) { ok = true; return true; }
      });
      if (!ok) returned = false;
      const end = cpu.getState();
      aReg = end.a;
      if (hold) { cx = x & 0xff; cy = y & 0xff; } else { cx = end.x; cy = end.y; }
    }
    const out = {
      returned, a: aReg, x: cx, y: cy,
      acc: get24(rd, RA), b: get24(rd, RB), ext: get24(rd, RE),
      sign: rd(0xCE), savedX: rd(0xEE), table: {},
    };
    for (let i = 0; i < 0xF0; i += 3) out.table[i] = get24(rd, 0x9800 + i);
    for (let a = 0x9800; a < 0x98F3; a++) wr(a, snapTab[a - 0x9800]);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return out;
  };
  return 'ok';
})()`);
const run = (addr, x, y, table = {}, regs = {}, calls = 1, hold = false) => a2.ev(
  'JSON.stringify(window.M.mathRun(' + addr + ',' + x + ',' + y + ','
  + JSON.stringify(table) + ',' + JSON.stringify(regs) + ',' + calls + ',' + hold
  + '))').then(JSON.parse);

const VALUES = [0, 1, -1, 7, -7, 100, -100, 1000, -1000, 4096, -4096, 32767, -32768,
  255, -255, 0x7FFFFF, -0x800000, 0x010000, 12345, -98765];

// --- the loaders and the store -----------------------------------------------------------------
console.log('\n=== $9C5C load ACC, $9C6C load B, $9C7A store ACC, $9C4B copy ===');
{
  // ACC is pre-set to something else every time, so a routine that added instead of loading,
  // or that ignored the table, would be caught.
  const wrong = [];
  for (const v of VALUES) {
    const r = await run(0x9C5C, 9, 3, { 3: u24(v) }, { acc: u24(0x5A5A5A) });
    if (s24(r.acc) !== s24(u24(v))) wrong.push(`${v}: ACC=${s24(r.acc)}`);
    if (r.y !== 6) wrong.push(`${v}: Y=${r.y}, expected 6`);
    if (r.x !== 9) wrong.push(`${v}: X=${r.x}, should be preserved`);
    if (r.savedX !== 9) wrong.push(`${v}: $EE=${r.savedX}, expected the saved X`);
  }
  check('$9C5C loads ACC from table[Y], advances Y by 3 and parks X in $EE',
    wrong.length === 0,
    wrong.slice(0, 3).join('; ') || `${VALUES.length} values, ACC pre-set each time`);
}
{
  const wrong = [];
  for (const v of VALUES) {
    const r = await run(0x9C6C, 3, 99, { 3: u24(v) }, { b: u24(0x5A5A5A) });
    if (s24(r.b) !== s24(u24(v))) wrong.push(`${v}: B=${s24(r.b)}`);
    if (r.x !== 0 || r.y !== 6) wrong.push(`${v}: X/Y = ${r.x}/${r.y}, expected 0/6`);
  }
  check('$9C6C loads B from table[X], and leaves X at zero with Y at X+3',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${VALUES.length} values`);
}
{
  const wrong = [];
  for (const v of VALUES) {
    const r = await run(0x9C7A, 7, 3, { 3: u24(0x5A5A5A) }, { acc: u24(v) });
    if (s24(r.table[3]) !== s24(u24(v))) wrong.push(`${v}: table[3]=${s24(r.table[3])}`);
    if (r.x !== 0 || r.y !== 6) wrong.push(`${v}: X/Y = ${r.x}/${r.y}, expected 0/6`);
  }
  check('$9C7A stores ACC into table[Y] and advances Y by 3',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${VALUES.length} values of ACC`);

  // The regression. The first reading of this routine was "it zeroes the entry", which is
  // what it looks like whenever ACC is zero. One non-zero ACC refutes it.
  const r = await run(0x9C7A, 0, 3, { 3: u24(0x5A5A5A) }, { acc: 0x123456 });
  check('and it does not zero the entry - that reading only held because ACC was zero',
    s24(r.table[3]) === 0x123456,
    `ACC = $123456 leaves table[3] = ${hx(u24(r.table[3]), 6)}, not $000000`);
}
{
  const wrong = [];
  for (const v of VALUES) {
    const r = await run(0x9C4B, 3, 0, { 0: u24(0x5A5A5A), 3: u24(v) }, { acc: 0x7F7F7F });
    if (s24(r.table[0]) !== s24(u24(v))) wrong.push(`${v}: table[0]=${s24(r.table[0])}`);
    if (s24(r.table[3]) !== s24(u24(v))) wrong.push(`${v}: the source moved`);
    if (r.x !== 6 || r.y !== 3) wrong.push(`${v}: X/Y = ${r.x}/${r.y}`);
    if (s24(r.acc) !== 0x7F7F7F) wrong.push(`${v}: it disturbed ACC`);
  }
  check('$9C4B copies table[X] to table[Y] without touching ACC, advancing both by 3',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${VALUES.length} copies`);
}

// --- add, subtract, negate ---------------------------------------------------------------------
console.log('\n=== $999B add, $99AB subtract, $9A08 negate ===');
{
  const wrong = [];
  for (const acc of VALUES) {
    for (const v of [1, -1, 1000, -1000, 0x7FFFFF]) {
      const r = await run(0x999B, 3, 0, { 3: u24(v) }, { acc: u24(acc) });
      const want = s24(u24(s24(u24(acc)) + s24(u24(v))));
      if (s24(r.acc) !== want) wrong.push(`${acc}+${v}: ACC=${s24(r.acc)}, expected ${want}`);
    }
  }
  check('$999B adds table[X] to ACC, wrapping at 24 bits',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${VALUES.length * 5} sums`);

  // The regression, and the one check here that a pure function could not pass: call it twice
  // with the same arguments and the answer must change, because ACC carries over.
  // X is held across the repeats: $999B leaves X at zero, so letting it chain would make the
  // second call read table[0] and test index advancement instead of ACC's persistence.
  const once = await run(0x999B, 3, 0, { 3: 1000 }, { acc: 0 }, 1, true);
  const twice = await run(0x999B, 3, 0, { 3: 1000 }, { acc: 0 }, 2, true);
  const thrice = await run(0x999B, 3, 0, { 3: 1000 }, { acc: 0 }, 3, true);
  check('it accumulates across calls, which is why reading it as a function of the table failed',
    s24(once.acc) === 1000 && s24(twice.acc) === 2000 && s24(thrice.acc) === 3000,
    `1, 2 and 3 calls give ${s24(once.acc)}, ${s24(twice.acc)}, ${s24(thrice.acc)}`);
  const hi = await run(0x999B, 3, 0, { 3: u24(0x123456) }, { acc: 0x010000 });
  check('and the A register it leaves is not the entry high byte once ACC is non-zero',
    hi.a !== 0x12 && s24(hi.acc) === 0x133456,
    `ACC $010000 + $123456 = ${hx(u24(hi.acc), 6)}, A register ${hx(hi.a)} not $12`);
}
{
  const wrong = [];
  for (const ey of [0, 1000, -1000, 32767, -32768]) {
    for (const ex of [1, -1, 7, 1000, -98765]) {
      const r = await run(0x99AB, 3, 0, { 0: u24(ey), 3: u24(ex) }, { acc: u24(0x5A5A5A) });
      const want = s24(u24(ey - ex));
      if (s24(r.acc) !== want) wrong.push(`${ey}-${ex}: ACC=${s24(r.acc)}, expected ${want}`);
    }
  }
  check('$99AB loads both and leaves ACC = table[Y] - table[X]',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || '25 differences, ACC pre-set each time');
}
{
  const wrong = [];
  for (const v of VALUES) {
    const r = await run(0x9A08, 0, 0, {}, { acc: u24(v) });
    const want = s24(u24(-s24(u24(v))));
    if (s24(r.acc) !== want) wrong.push(`${v}: ${s24(r.acc)}, expected ${want}`);
  }
  check('$9A08 negates ACC in place', wrong.length === 0,
    wrong.slice(0, 3).join('; ') || `${VALUES.length} values`);
}

// --- compare -----------------------------------------------------------------------------------
console.log('\n=== $99D2 compare ===');
{
  const wrong = [];
  const PAIRS = [[0, 0], [100, 200], [200, 100], [-5, 5], [5, -5], [0x7FFFFF, -1],
    [-0x800000, 0x7FFFFF], [1000, 1000], [-1, -2], [-2, -1], [0x010000, 0xFFFF]];
  for (const [ey, ex] of PAIRS) {
    const r = await run(0x99D2, 3, 0, { 0: u24(ey), 3: u24(ex) }, { acc: u24(0x5A5A5A) });
    const sign = r.a === 0 ? 0 : (r.a & 0x80) ? -1 : 1;
    const want = ex < ey ? 1 : ex > ey ? -1 : 0;
    if (sign !== want) wrong.push(`${ex} vs ${ey}: ${sign}, expected ${want}`);
  }
  console.log('  it loads both operands itself, so this one really is a function of the table');
  console.log('  the call sites follow it with BPL: "table[X] is not above table[Y]"');
  check('$99D2 compares table[Y] against table[X] as signed 24-bit',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${PAIRS.length} pairs`);
  const crossing = PAIRS.filter(([a, b]) => (a < 0) !== (b < 0));
  check('and it is signed - these pairs would come out the other way unsigned',
    crossing.length >= 3, `${crossing.length} of the pairs cross zero`);
}

// --- divide ------------------------------------------------------------------------------------
console.log('\n=== $9A65 divide ===');
console.log('  ACC := table[Y] * 256 / table[X], remainder in EXT');
console.log('  restoring division: magnitudes with the sign in $CE, dividend shifted up a byte,');
console.log('  24 rounds of shift-and-trial-subtract, then negate ACC if the signs differed');
{
  const NUM = [0, 1, -1, 7, -7, 100, -100, 1000, -1000, 4096, -4096, 32767, -32768, 255, -255];
  const DEN = [1, -1, 2, -2, 3, -3, 7, -7, 256, -256, 1000, -1000, 4096, 32767, -32768];
  const wrongQ = [], wrongR = [];
  let tested = 0, outside = 0;
  for (const num of NUM) {
    for (const den of DEN) {
      const mag = Math.abs(num) * 256, q = Math.trunc(mag / Math.abs(den));
      if (q >= 0x1000000) { outside++; continue; }
      const r = await run(0x9A65, 3, 0, { 0: u24(num), 3: u24(den) }, { acc: u24(0x5A5A5A) });
      tested++;
      const wantQ = s24(u24((num < 0) !== (den < 0) ? -q : q));
      if (s24(r.acc) !== wantQ) wrongQ.push(`${num}/${den}: ${s24(r.acc)}, expected ${wantQ}`);
      if (r.ext !== mag % Math.abs(den)) {
        wrongR.push(`${num}/${den}: EXT=${r.ext}, expected ${mag % Math.abs(den)}`);
      }
    }
  }
  check('$9A65 divides table[Y]*256 by table[X] into ACC', wrongQ.length === 0,
    wrongQ.slice(0, 3).join('; ')
      || `${tested} pairs over the whole sign square, ${outside} outside 24 bits`);
  check('and leaves the remainder in EXT as a magnitude, never negated',
    wrongR.length === 0, wrongR.slice(0, 3).join('; ') || `${tested} remainders`);

  const neg = await run(0x9A65, 3, 0, { 0: u24(-1000), 3: 3 }, {});
  const pos = await run(0x9A65, 3, 0, { 0: 1000, 3: 3 }, {});
  check('concretely: -1000/3 and 1000/3 leave the same remainder with opposite quotients',
    neg.ext === pos.ext && s24(neg.acc) === -s24(pos.acc) && neg.ext === 1,
    `quotients ${s24(neg.acc)} and ${s24(pos.acc)}, both remainder ${neg.ext}`);
  check('the sign flag $CE records whether the operands disagreed',
    neg.sign !== 0 && pos.sign === 0, `$CE = ${neg.sign} for -1000/3, ${pos.sign} for 1000/3`);

  // Controls: three variants that agree on every positive input and must match nothing.
  const CTRL = [[-7, 1000], [7, -1000], [-1000, 3], [1000, -3], [-5, 7], [5, -7],
    [-100, 7], [100, -7], [-32768, 3], [32767, -3]];
  let floored = 0, signedRem = 0, saturating = 0, discriminating = 0;
  for (const [num, den] of CTRL) {
    const mag = Math.abs(num) * 256, q = Math.trunc(mag / Math.abs(den));
    if (q >= 0x1000000) continue;
    const r = await run(0x9A65, 3, 0, { 0: u24(num), 3: u24(den) }, {});
    const n = num * 256;
    const trunc = Math.trunc(n / den), floor = Math.floor(n / den);
    const sr = u24(n - trunc * den), mr = mag % Math.abs(den);
    const sat = Math.max(-0x800000, Math.min(0x7FFFFF, trunc));
    if (floor !== trunc || sr !== mr || sat !== s24(u24(trunc))) discriminating++;
    if (floor !== trunc && s24(r.acc) === s24(u24(floor))) floored++;
    if (sr !== mr && r.ext === sr) signedRem++;
    if (sat !== s24(u24(trunc)) && s24(r.acc) === sat) saturating++;
  }
  check('the control cases are ones where these three variants actually differ',
    discriminating >= 8, `${discriminating} of ${CTRL.length} tell them apart`);
  check('control: it does not floor', floored === 0, `${floored} matches`);
  check('control: nor use a signed remainder', signedRem === 0, `${signedRem} matches`);
  check('control: nor saturate', saturating === 0, `${saturating} matches`);

  // The unguarded edges.
  const z = await run(0x9A65, 3, 0, { 0: 5, 3: 0 }, {});
  const zn = await run(0x9A65, 3, 0, { 0: u24(-5), 3: 0 }, {});
  check('a zero divisor is not checked: every trial subtraction succeeds, so ACC fills with ones',
    s24(z.acc) === -1 && z.ext === 5 * 256 && s24(zn.acc) === 1,
    `5/0 gives ACC=${hx(u24(z.acc), 6)} EXT=${z.ext}; -5/0 gives ${hx(u24(zn.acc), 6)}`);

  const edge = [[65535, 1, true], [32768, 1, true], [65536, 1, false], [65536, 256, true]];
  const bad = [];
  for (const [num, den, inside] of edge) {
    const mag = Math.abs(num) * 256, q = Math.trunc(mag / Math.abs(den));
    if ((q < 0x1000000) !== inside) bad.push(`${num}/${den}: the domain test disagrees`);
    const r = await run(0x9A65, 3, 0, { 0: u24(num), 3: u24(den) }, {});
    if (inside && s24(r.acc) !== s24(u24(q))) {
      bad.push(`${num}/${den}: ${s24(r.acc)} vs ${s24(u24(q))}`);
    }
    if (!inside && s24(r.acc) === s24(u24(q))) {
      bad.push(`${num}/${den}: expected garbage, got the answer`);
    }
  }
  check('the domain is the QUOTIENT fitting 24 bits, not the numerator', bad.length === 0,
    bad.slice(0, 3).join('; ')
      || '65535/1, 32768/1 and 65536/256 are exact; 65536/1 is not');
}

// --- what the running game actually asks for ---------------------------------------------------
// Whether the unguarded domain matters is a question about the game, not the routine, so it
// gets measured rather than assumed. $0948 gates the movement block, and paddle 1 under $5A
// is what opens it - with the paddle at rest MATH is never called at all.
console.log('\n=== MATH under warp ===');
{
  const trace = async (paddle) => {
    await a2.ev(`(() => { window.M.a2.getIO().paddle(1, ${paddle}); return 'p'; })()`);
    return JSON.parse(await a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd;
      const seen = {}, hits = [];
      for (let f = 0; f < 60; f++) {
        cpu.stepCyclesDebug(17030, () => {
          const pc = cpu.getPC();
          if (pc === 0x9A65 || pc === 0x999B || pc === 0x99D2 || pc === 0x9C4B
            || pc === 0x9C7A || pc === 0x9C5C || pc === 0x9C6C || pc === 0x99AB) {
            seen[pc] = (seen[pc] || 0) + 1;
            if (pc === 0x9A65) {
              const st = cpu.getState();
              const g = (b) => rd(b) | (rd(b + 1) << 8) | (rd(b + 2) << 16);
              hits.push({ x: st.x, y: st.y, num: g(0x9800 + st.y), den: g(0x9800 + st.x) });
            }
          }
        });
      }
      return { seen, gate: rd(0x0948), warp: rd(0x81F3), hits: hits.slice(0, 500) };
    })())`));
  };
  const idle = await trace(255);
  check('with paddle 1 at rest the $0948 gate stays closed and MATH is never entered',
    idle.gate === 0 && Object.keys(idle.seen).length === 0,
    `$0948 = ${idle.gate}, ${Object.keys(idle.seen).length} entry points reached in 60 frames`);

  const warp = await trace(0);
  const total = Object.values(warp.seen).reduce((a, b) => a + b, 0);
  console.log('  calls per entry point over 60 frames under warp: '
    + Object.entries(warp.seen).map(([p, n]) => hx(Number(p), 4) + ' x' + n).join(', '));
  check('paddle 1 below $5A opens the gate and the loop starts driving MATH',
    warp.gate === 0xFF && total > 50, `$0948 = ${hx(warp.gate)}, ${total} calls`);

  // Whether the unguarded divide is a practical problem. An earlier pass answered "yes, 6 of
  // 18", using the wrong domain condition - it tested whether the NUMERATOR times 256 fits in
  // 24 bits, when what has to fit is the quotient. Under the right condition every division
  // the running game performs is inside, which is the opposite conclusion.
  const outside = warp.hits.filter(({ num, den }) => {
    const d = Math.abs(s24(den));
    return d !== 0 && Math.trunc(Math.abs(s24(num)) * 256 / d) >= 0x1000000;
  });
  const zeroDen = warp.hits.filter(({ den }) => s24(den) === 0);
  check('every division the game actually performs stays inside the domain, over 60 frames',
    warp.hits.length >= 10 && outside.length === 0 && zeroDen.length === 0,
    `${warp.hits.length} divisions, ${outside.length} past 24 bits, ${zeroDen.length}`
      + ' by zero - 60 frames is evidence, not a proof, so the port still models both edges');
}

// --- what the call sites rely on ---------------------------------------------------------------
// The routines advance X and Y, and $99D2 in particular leaves both holding whatever its
// compare loop happened to reach. None of that is worth modelling if nothing reads it, so
// rather than assume either way, every call site in the binary gets checked: does it set the
// indices it needs, or inherit them? The answer decides how much of the port there has to be.
console.log('\n=== the call sites ===');
{
  const asm = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8').split(/\r?\n/);
  const USES = { '9C5C': 'Y', '9C6C': 'X', '9C7A': 'Y', '9C4B': 'XY', '999B': 'X',
    '99AB': 'XY', '99D2': 'XY', '9A08': '', '9A65': 'XY' };
  const rows = asm.map((l) => {
    const m = l.match(/^\$([0-9A-F]{4})\s+(?:\S+:\s+)?((?:[0-9A-F]{2} )+)\s*(.*)$/);
    return m ? { addr: m[1], text: m[3].trim() } : null;
  });
  let sites = 0;
  const inherits = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    const m = rows[i].text.match(/^JSR \$(9C5C|9C6C|9C7A|9C4B|999B|99AB|99D2|9A08|9A65)$/);
    if (!m) continue;
    sites++;
    const have = new Set();
    for (let j = i - 1, n = 0; j >= 0 && n < 6; j--) {
      if (!rows[j]) continue;
      n++;
      if (/^(JSR|JMP|RTS|B[A-Z]{2})\b/.test(rows[j].text)) break;
      const lx = rows[j].text.match(/^LD([XY]) /);
      if (lx) have.add(lx[1]);
      const t = rows[j].text.match(/^TA([XY])$/);
      if (t) have.add(t[1]);
    }
    const missing = [...USES[m[1]]].filter((c) => !have.has(c));
    if (missing.length) inherits.push(`${rows[i].addr} ${rows[i].text} needs ${missing.join('')}`);
  }
  console.log(`  ${sites} call sites, each checked against the registers its routine reads`);
  check('the listing is present and holds enough call sites to conclude anything',
    sites > 150, `${sites} found`);
  check('every call site sets the indices it uses, so the index exits are not a contract',
    inherits.length === 0, inherits.slice(0, 3).join('; ')
      || `0 of ${sites} inherit an index - the port models no index bookkeeping`);
}

await a2.close();
fs.mkdirSync('captured/math', { recursive: true });
fs.writeFileSync('captured/math/routines.json', JSON.stringify({
  shape: 'a 24-bit signed accumulator machine over a byte-indexed table at $9800',
  registers: {
    ACC: '$FA-$FC', B: '$EB-$ED', EXT: '$FD-$FF',
    '$CE': "the divide's sign flag", '$EE': 'where $9C5C parks X',
  },
  routines: {
    '$999B': 'ACC += table[X]  (loads B, keeps ACC)',
    '$99AB': 'ACC := table[Y] - table[X]',
    '$99D2': 'compare table[Y] against table[X]: A register +1 / 0 / -1, signed',
    '$9A08': 'ACC := -ACC',
    '$9A65': 'ACC := table[Y] * 256 / table[X], |remainder| in EXT; no guard on either edge,'
      + ' and the domain is the quotient fitting 24 bits',
    '$9C4B': 'table[Y] := table[X]; X += 3; Y += 3',
    '$9C5C': 'ACC := table[Y]; Y += 3; X preserved via $EE',
    '$9C6C': 'B := table[X]; X := 0; Y := X + 3',
    '$9C7A': 'table[Y] := ACC; Y += 3',
  },
  gate: 'the movement block is gated on $0948, set by paddle 1 below $5A while WARP ($81F3)'
    + ' is not exhausted; at rest MATH is never called',
  results,
}, null, 1) + String.fromCharCode(10));

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `math: all ${results.length} checks passed`
  : `math: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
