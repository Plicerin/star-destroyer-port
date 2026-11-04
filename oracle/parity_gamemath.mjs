// The port's Math24 against MATH, in the machine.
//
// probe_math.mjs established what MATH is: a 24-bit accumulator machine, not a set of pure
// functions. This holds port/src/game/math.js to it, and because the registers are state,
// parity cannot be "same inputs, same output". It has to be "same sequence of instructions,
// same machine afterwards". So besides each routine on its own, this runs several hundred
// random PROGRAMS - instruction streams with indices and operands drawn at random - through
// both the port and the real $98F3, and requires ACC, B, EXT, the sign flag and all 96 table
// bytes to agree at the end of every one.
//
// Programs are what catch a routine that is individually right but wrong in combination:
// $999B adding to whatever ACC already held is only visible if something put a value there
// first, and that was exactly the mistake the first reading of this file made.
//
// Indices are named on every step, which is how the game does it - all 229 call sites in the
// binary load the registers they use immediately before the call - so the index exits are
// neither modelled nor compared. probe_math.mjs is where that is established.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24 } from '../port/src/game/math.js';
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

/** The entry points, and how the port performs each. */
const OPS = {
  load: { addr: 0x9C5C, run: (m, x, y) => m.loadAcc(x, y) },
  loadB: { addr: 0x9C6C, run: (m, x) => m.loadB(x) },
  store: { addr: 0x9C7A, run: (m, x, y) => m.storeAcc(y) },
  copy: { addr: 0x9C4B, run: (m, x, y) => m.copy(x, y) },
  add: { addr: 0x999B, run: (m, x) => m.add(x) },
  sub: { addr: 0x99AB, run: (m, x, y) => m.sub(x, y) },
  compare: { addr: 0x99D2, run: (m, x, y) => m.compare(x, y) },
  negate: { addr: 0x9A08, run: (m) => m.negate() },
  divide: { addr: 0x9A65, run: (m, x, y) => m.divide(x, y) },
  addFrom: { addr: 0x9998, run: (m, x, y) => m.addFrom(x, y) },
  multiply: { addr: 0x9A17, run: (m, x, y) => m.multiply(x, y) },
  abs: { addr: 0x9A04, run: (m) => m.abs() },
  sqrt: { addr: 0x9AD0, run: (m) => m.sqrt() },
  // $9C04's lookup reproduces ACC and nothing else: the real series leaves working values in
  // B, EXT, R3 and R7. No call site reads them, which probe_math.mjs checks, so they are out
  // of scope here - named explicitly rather than quietly skipped.
  atan: { addr: 0x9C04, run: (m) => m.atanDegrees(), ignores: ['B', 'EXT', '$CE'] },
};
const TABLE_BYTES = 0x60;

/**
 * Run a program in the machine: set the table and the registers, then JSR each entry point in
 * turn with the X and Y that step names. Returns the machine afterwards.
 */
await a2.ev(`(() => {
  const put24 = (wr, at, v) => {
    wr(at, v & 0xff); wr(at + 1, (v >> 8) & 0xff); wr(at + 2, (v >> 16) & 0xff);
  };
  const get24 = (rd, at) => rd(at) | (rd(at + 1) << 8) | (rd(at + 2) << 16);
  window.M.mathProgram = (table, regs, steps) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snapTab = []; for (let a = 0x9800; a < 0x98F3; a++) snapTab.push(rd(a));
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0);
    put24(wr, 0xFA, (regs.acc || 0) & 0xFFFFFF);
    put24(wr, 0xEB, (regs.b || 0) & 0xFFFFFF);
    put24(wr, 0xFD, 0);
    for (let i = 0; i < table.length; i++) wr(0x9800 + i, table[i]);
    let aReg = 0, returned = true;
    for (const s of steps) {
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = s.addr; st.x = s.x & 0xff; st.y = s.y & 0xff;
      cpu.setState(st);
      let ok = false;
      cpu.stepCyclesDebug(3000000, () => {
        if (cpu.getPC() === 0xFFFF) { ok = true; return true; }
      });
      if (!ok) { returned = false; break; }
      aReg = cpu.getState().a;
    }
    const out = {
      returned, a: aReg,
      acc: get24(rd, 0xFA), b: get24(rd, 0xEB), ext: get24(rd, 0xFD),
      sign: rd(0xCE), savedX: rd(0xEE), productLow: rd(0xF9), table: [],
    };
    for (let i = 0; i < table.length; i++) out.table.push(rd(0x9800 + i));
    for (let a = 0x9800; a < 0x98F3; a++) wr(a, snapTab[a - 0x9800]);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return out;
  };
  return 'ok';
})()`);
const runEngine = (table, regs, steps) => a2.ev('JSON.stringify(window.M.mathProgram('
  + JSON.stringify([...table]) + ',' + JSON.stringify(regs) + ','
  + JSON.stringify(steps) + '))').then(JSON.parse);

/** The same program against a port-side machine. `ops` lets a control substitute a routine. */
function runPort(table, regs, steps, ops = OPS) {
  const m = new Math24();
  m.table.set(table, 0);
  m.acc = s24(u24(regs.acc || 0));
  m.b = s24(u24(regs.b || 0));
  let a = 0, last = {};
  for (const s of steps) {
    const r = ops[s.op].run(m, s.x, s.y);
    if (s.op === 'compare') a = r < 0 ? 0xff : r;
    if (r && typeof r === 'object') last = r;
  }
  return { m, a, last };
}

/**
 * @param {string[]} ignores registers this program's instructions leave undefined
 * @returns {string[]} where the two machines disagree
 */
function diff(engine, port, bytes, ignores = []) {
  if (!engine.returned) return ['the engine did not return'];
  const bad = [];
  const skip = new Set(ignores);
  if (s24(engine.acc) !== port.m.acc) bad.push(`ACC ${s24(engine.acc)} vs ${port.m.acc}`);
  if (!skip.has('B') && s24(engine.b) !== port.m.b) {
    bad.push(`B ${s24(engine.b)} vs ${port.m.b}`);
  }
  if (!skip.has('EXT') && engine.ext !== port.m.ext) {
    bad.push(`EXT ${engine.ext} vs ${port.m.ext}`);
  }
  if (!skip.has('$CE') && engine.sign !== port.m.sign) {
    bad.push(`$CE ${engine.sign} vs ${port.m.sign}`);
  }
  for (let i = 0; i < bytes; i++) {
    if (engine.table[i] !== port.m.table[i]) {
      bad.push(`table[${i}] ${engine.table[i]} vs ${port.m.table[i]}`);
      break;
    }
  }
  return bad;
}

/** A deterministic generator, so any failure can be reproduced from the seed. */
let seed = 0x5D3E2A1;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const randTable = () => {
  const t = new Uint8Array(TABLE_BYTES);
  for (let i = 0; i < TABLE_BYTES; i++) t[i] = Math.floor(rnd() * 256);
  return t;
};
/** Indices the loop uses: mostly multiples of 3, sometimes not, as the real trace shows. */
const randIndex = () => (rnd() < 0.85
  ? 3 * Math.floor(rnd() * (TABLE_BYTES / 3 - 1))
  : Math.floor(rnd() * (TABLE_BYTES - 3)));
const randProgram = (len) => {
  const names = Object.keys(OPS), prog = [];
  for (let i = 0; i < len; i++) {
    const op = pick(names);
    prog.push({ op, addr: OPS[op].addr, x: randIndex(), y: randIndex() });
  }
  return prog;
};

// --- each routine on its own -------------------------------------------------------------------
console.log('\n=== one instruction at a time ===');
{
  const VALUES = [0, 1, -1, 7, -7, 1000, -1000, 32767, -32768, 0x7FFFFF, -0x800000,
    0x010000, 12345, -98765, 255, -255, 4096, -4096, 100, -100];
  for (const name of Object.keys(OPS)) {
    const bad = [];
    let n = 0, skipped = 0;
    for (const v of VALUES) {
      for (const w of [1, -3, 1000, -98765]) {
        const t = randTable();
        const put = (i, x) => {
          t[i] = x & 0xff; t[i + 1] = (x >> 8) & 0xff; t[i + 2] = (x >> 16) & 0xff;
        };
        put(0, u24(v));
        put(3, u24(w));
        const steps = [{ op: name, addr: OPS[name].addr, x: 3, y: 0 }];
        const regs = { acc: u24(v), b: u24(w) };
        const port = runPort(t, regs, steps);
        // A quotient past 24 bits saturates the quotient register to $FFFFFF, which the port
        // now reproduces - probe_geometry.mjs measured it, after this harness had spent its
        // life skipping those cases outright rather than asking what they did. What is still
        // not modelled is EXT, which ends up holding a rotation of the shifted dividend that
        // no call site reads, so the case is compared with EXT out of scope rather than
        // dropped, and the count is reported either way.
        const ignores = [...(OPS[name].ignores || [])];
        if (port.last.inDomain === false) {
          skipped++;
          ignores.push('EXT');
        }
        n++;
        const d = diff(await runEngine(t, regs, steps), port, TABLE_BYTES, ignores);
        if (d.length) bad.push(`${name} with ${v}/${w}: ${d[0]}`);
      }
    }
    check(`${name} ($${OPS[name].addr.toString(16).toUpperCase()}) agrees`,
      bad.length === 0 && n >= 40,
      bad.slice(0, 2).join('; ')
        || `${n} cases` + (skipped ? `, ${skipped} with EXT out of scope past 24 bits` : ''));
  }
}

// --- random programs ---------------------------------------------------------------------------
console.log('\n=== random programs ===');
{
  const PROGRAMS = 240;
  const bad = [];
  let instructions = 0, divides = 0, saturated = 0;
  for (let p = 0; p < PROGRAMS; p++) {
    const t = randTable();
    const regs = { acc: Math.floor(rnd() * 0x1000000), b: Math.floor(rnd() * 0x1000000) };
    const prog = randProgram(3 + Math.floor(rnd() * 8));
    instructions += prog.length;
    divides += prog.filter((s) => s.op === 'divide').length;
    const ignores = [...new Set(prog.flatMap((st) => OPS[st.op].ignores || []))];
    const port = runPort(t, regs, prog);
    // As above: a saturating divide leaves EXT holding something no call site reads.
    if (port.last.inDomain === false) {
      saturated++;
      ignores.push('EXT');
    }
    const d = diff(await runEngine(t, regs, prog), port, TABLE_BYTES, ignores);
    if (d.length) {
      bad.push(`program ${p} (${prog.map((s) => s.op).join(' ')}): ${d.slice(0, 2).join(', ')}`);
    }
  }
  check('the port and MATH end in the same state after every random program',
    bad.length === 0, bad.slice(0, 2).join(' | ')
      || `${PROGRAMS} programs, ${instructions} instructions, ${divides} divides,`
        + ` ${saturated} ending on a saturating divide`);
}

// --- controls ----------------------------------------------------------------------------------
// Three ports with one detail wrong each - the two readings this file got wrong the first
// time, plus a plausible divide. A control is only evidence if it fires reliably, so each one
// gets programs shaped to exercise the path it guards rather than fully random ones: a random
// stream often never puts a meaningful ACC in front of an add, which makes "13 of 60 caught"
// a statement about the generator rather than about the check.
console.log('');
console.log('=== controls ===');
{
  /** Put a 24-bit value at a table offset. */
  const put = (t, i, v) => {
    t[i] = v & 0xff; t[i + 1] = (v >> 8) & 0xff; t[i + 2] = (v >> 16) & 0xff;
  };
  const wrapTo24 = (v) => {
    const m = v & 0xFFFFFF;
    return m > 0x7FFFFF ? m - 0x1000000 : m;
  };
  const VARIANTS = [
    {
      label: 'the old reading of $999B, where add loads instead of accumulating',
      ops: { ...OPS, add: { addr: 0x999B, run: (m, x) => { m.loadB(x); m.acc = m.read(x); } } },
      // load a known ACC, add a different value, store it: the two readings differ unless the
      // loaded value was zero, which this never makes it.
      program: () => {
        const t = randTable();
        put(t, 0, 1 + Math.floor(rnd() * 0xFFFF));
        put(t, 3, 1 + Math.floor(rnd() * 0xFFFF));
        return { t, regs: { acc: 0, b: 0 }, prog: [
          { op: 'load', addr: OPS.load.addr, x: 9, y: 0 },
          { op: 'add', addr: OPS.add.addr, x: 3, y: 0 },
          { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
        ] };
      },
    },
    {
      label: 'the old reading of $9C7A, where store zeroes the entry',
      ops: { ...OPS, store: { addr: 0x9C7A, run: (m, x, y) => m.write(y, 0) } },
      program: () => {
        const t = randTable();
        put(t, 0, 1 + Math.floor(rnd() * 0xFFFFFE));
        return { t, regs: { acc: 0, b: 0 }, prog: [
          { op: 'load', addr: OPS.load.addr, x: 9, y: 0 },
          { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
        ] };
      },
    },
    {
      label: 'a divide that floors instead of truncating toward zero',
      ops: {
        ...OPS,
        divide: { addr: 0x9A65, run: (m, x, y) => {
          m.loadAcc(x, y);
          m.loadB(x);
          const n = m.acc * 256, d = m.b;
          if (d === 0) { m.ext = n & 0xFFFFFF; m.acc = -1; return; }
          m.acc = Math.floor(n / d) | 0;
          m.ext = Math.abs(n) % Math.abs(d);
          m.b = Math.abs(d);
        } },
      },
      // Mixed signs with a non-exact quotient, which is the only place floor and trunc differ.
      // Floor and truncate agree unless the quotient is negative AND inexact, so the signs
      // are made to disagree and the divisor is kept odd with num not a multiple of it -
      // which guarantees a remainder, since 256 is invertible modulo an odd divisor.
      program: () => {
        const t = randTable();
        const den = 3 + 2 * Math.floor(rnd() * 100);
        let num = 1 + Math.floor(rnd() * 20000);
        if (num % den === 0) num++;
        const flip = rnd() < 0.5;
        put(t, 0, u24(flip ? -num : num));
        put(t, 3, u24(flip ? den : -den));
        return { t, regs: { acc: 0, b: 0 }, prog: [
          { op: 'divide', addr: OPS.divide.addr, x: 3, y: 0 },
          { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
        ] };
      },
    },
  ];
  // The three new routines, each against the plausible model it is not.
  VARIANTS.push({
    label: 'an arctangent that truncates atan instead of running the series',
    ops: {
      ...OPS,
      atan: { addr: 0x9C04, ignores: ['B', 'EXT', '$CE'], run: (m) => {
        const t = Math.abs(m.acc) / 256;
        const deg = t <= 1 ? Math.trunc(Math.atan(t) * 180 / Math.PI)
          : 90 - Math.trunc(Math.atan(1 / t) * 180 / Math.PI);
        m.acc = (m.acc < 0 ? -deg : deg) * 256;
      } },
    },
    // The model and the series disagree on 102 of 765 inputs spread across the range, so the
    // ratios here are picked from the bands where they differ rather than at random.
    program: () => {
      const t = randTable();
      const ratio = [4, 8, 36, 88, 136, 200, 208, 212, 216, 220, 296, 300, 304, 308, 312][
        Math.floor(rnd() * 15)];
      put(t, 0, ratio);
      return { t, regs: { acc: 0, b: 0 }, prog: [
        { op: 'load', addr: OPS.load.addr, x: 9, y: 0 },
        { op: 'atan', addr: OPS.atan.addr, x: 3, y: 0 },
        { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
      ] };
    },
  });
  VARIANTS.push({
    label: 'a square root that uses the closed form instead of Newton',
    ops: {
      ...OPS,
      sqrt: { addr: 0x9AD0, run: (m) => {
        m.acc = wrapTo24(Math.trunc(Math.sqrt((m.acc & 0xFFFFFF) * 256)));
        m.b = 0;
        m.sign = 0;
      } },
    },
    // The closed form is right everywhere except ACC = 1, where the iteration's equality test
    // fires on the first halving, so that is the input to use.
    program: () => {
      const t = randTable();
      put(t, 0, 1);
      return { t, regs: { acc: 0, b: 0 }, prog: [
        { op: 'load', addr: OPS.load.addr, x: 9, y: 0 },
        { op: 'sqrt', addr: OPS.sqrt.addr, x: 3, y: 0 },
        { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
      ] };
    },
  });
  VARIANTS.push({
    label: 'a multiply that keeps the whole product instead of dividing by 256',
    ops: {
      ...OPS,
      multiply: { addr: 0x9A17, run: (m, x, y) => {
        m.loadAcc(x, y);
        m.loadB(x);
        m.magnitudes();
        const prod = (m.acc & 0xFFFFFF) * (m.b & 0xFFFFFF);
        m.productLow = prod % 256;
        m.ext = (Math.floor(prod / 0x100000000) & 0xFFFF) | (m.ext & 0xFF0000);
        m.acc = wrapTo24(m.sign ? -prod : prod);
      } },
    },
    program: () => {
      const t = randTable();
      put(t, 0, 300 + Math.floor(rnd() * 60000));
      put(t, 3, 300 + Math.floor(rnd() * 60000));
      return { t, regs: { acc: 0, b: 0 }, prog: [
        { op: 'multiply', addr: OPS.multiply.addr, x: 3, y: 0 },
        { op: 'store', addr: OPS.store.addr, x: 0, y: 6 },
      ] };
    },
  });

  for (const { label, ops, program } of VARIANTS) {
    const saved = seed;
    seed = 0x11C0FFEE;
    let caught = 0, tried = 0, goodAgrees = 0;
    for (let p = 0; p < 60; p++) {
      const { t, regs, prog } = program();
      const eng = await runEngine(t, regs, prog);
      tried++;
      const ignores = [...new Set(prog.flatMap((st) => OPS[st.op].ignores || []))];
      if (diff(eng, runPort(t, regs, prog, ops), TABLE_BYTES, ignores).length) caught++;
      if (diff(eng, runPort(t, regs, prog), TABLE_BYTES, ignores).length === 0) goodAgrees++;
    }
    seed = saved;
    // Both halves matter: the wrong port must be caught on nearly every program, and the real
    // port must still agree on all of them, or the programs prove nothing either way.
    check(`control: ${label} is caught`, caught >= tried - 2 && goodAgrees === tried,
      `${caught} of ${tried} disagree with it; the port agrees on ${goodAgrees} of ${tried}`);
  }
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/gamemath.json', JSON.stringify({ results }, null, 1)
  + String.fromCharCode(10));

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_gamemath: all ${results.length} checks passed`
  : `parity_gamemath: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
