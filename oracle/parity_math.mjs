// The port's arithmetic against the engine's, in the machine.
//
// This is the first parity harness, and the pattern every later one follows: run the
// port's code and the original's over the same inputs and require them to agree exactly.
// The probes established what the engine does; a parity harness is what stops the port
// drifting away from it afterwards.
//
// $6480 is the one that matters. It is not `(a * b) >> 15` - it agrees with that about
// 70% of the time - so port/src/a23d2/math.js transliterates it instruction by
// instruction, and the only way to know the transliteration is right is to run both.
// Thousands of products, no disagreements allowed.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { mul, div, scale } from '../port/src/a23d2/math.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight, with the engine resident', flight.difficulty === 1);

/**
 * Call one of the engine's routines over many inputs in a single round trip.
 *
 * Each call pushes a return address of $FFFE and steps until the PC reaches $FFFF, the
 * same way exercise.mjs calls anything else - but batched, because a parity sweep is
 * thousands of calls and one evaluate each would take all day.
 */
async function batch(addr, inputs, { setup, result }) {
  return JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, wr = window.M.wr, rd = window.M.rd;
    const before = cpu.getState(), out = [];
    const setup = ${setup};
    const result = ${result};
    for (const input of ${JSON.stringify(inputs)}) {
      const regs = setup(input, wr);
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = ${addr};
      st.a = (regs.a || 0) & 0xff; st.x = (regs.x || 0) & 0xff; st.y = (regs.y || 0) & 0xff;
      cpu.setState(st);
      cpu.stepCyclesDebug(400000, () => cpu.getPC() === 0xFFFF);
      out.push(result(cpu.getState(), rd));
    }
    cpu.setState(before);
    return out;
  })())`));
}

const s16 = (v) => (v > 32767 ? v - 65536 : v);

// --- the multiply ---------------------------------------------------------------------------
console.log('\n=== $6480, the multiply the port transliterates ===');
{
  // The multiplicands a port actually meets: matrix entries, which are rotations times
  // the axis scales, plus the extremes.
  const bs = [16123, 32765, 9539, 23167, 23166, -6746, 6745, 11399, 11311, -23167, 11310,
    -11311, 6876, -15998, 9725, 30271, 12537, -3650, 8813, 1, -1, 32767, -32768, 255, -255];
  const as = [];
  for (let v = -2000; v <= 2000; v += 37) as.push(v);
  as.push(0, 1, -1, 2, -2, 32767, -32768, 128, -128, 256, -256);
  const inputs = [];
  for (const b of bs) for (const a of as) inputs.push([a, b]);
  const got = await batch(0x6480, inputs, {
    setup: `(([a, b], wr) => { wr(0x78, a & 0xff); wr(0x79, (a >> 8) & 0xff);
      wr(0x7A, b & 0xff); wr(0x7B, (b >> 8) & 0xff); return {}; })`,
    result: `((st) => st.a | (st.x << 8))`,
  });
  const wrong = [];
  inputs.forEach(([a, b], i) => {
    const engine = s16(got[i]), ours = mul(a, b);
    if (engine !== ours) wrong.push(`mul(${a}, ${b}): engine ${engine}, port ${ours}`);
  });
  console.log(`  ${inputs.length} products over ${bs.length} multiplicands`);
  check('the transliteration of $6480 matches the engine on every product',
    wrong.length === 0, wrong.slice(0, 4).join('; ') || `${inputs.length} exact`);

  // The control: if a native multiply would do, this file would not need to exist.
  const naive = inputs.filter(([a, b], i) => Math.trunc(a * b / 32768) !== s16(got[i])).length;
  check('and a native (a * b) >> 15 would not - which is why it is transliterated',
    naive > 0, `${naive} of ${inputs.length} products differ from the arithmetic shortcut`);
}

// --- the divide -------------------------------------------------------------------------------
console.log('\n=== $65DE, the divide ===');
{
  const inputs = [];
  for (const d of [2, 3, 7, 16, 50, 100, 137, 200, 256, 400, 1000, 4096, 20000, -100, -1000]) {
    const step = Math.max(1, Math.floor(Math.abs(d) / 23));
    for (let n = -(Math.abs(d) - 1); n < Math.abs(d); n += step) inputs.push([n, d]);
  }
  const got = await batch(0x65DE, inputs, {
    setup: `(([n, d], wr) => { wr(0x7A, d & 0xff); wr(0x7B, (d >> 8) & 0xff);
      return { a: (n >> 8) & 0xff, x: n & 0xff }; })`,
    result: `((st, rd) => rd(0x78) | (rd(0x79) << 8))`,
  });
  const wrong = [];
  inputs.forEach(([n, d], i) => {
    const engine = s16(got[i]), ours = div(n, d);
    if (engine !== ours) wrong.push(`div(${n}, ${d}): engine ${engine}, port ${ours}`);
  });
  console.log(`  ${inputs.length} quotients, all strictly inside |n| < |d|`);
  check('the divide formula matches the engine everywhere in its domain',
    wrong.length === 0, wrong.slice(0, 4).join('; ') || `${inputs.length} exact`);
  check('and the port refuses outside that domain rather than inventing a value',
    div(5, 2) === null && div(1, 0) === null);
}

// --- the scale ---------------------------------------------------------------------------------
console.log('\n=== $659D, the scale ===');
{
  const inputs = [];
  for (let m = 0; m < 128; m += 3) for (let a = 0; a < 256; a += 1) inputs.push([a, m]);
  const got = await batch(0x659D, inputs, {
    setup: `(([a, m]) => ({ a, x: m }))`,
    result: `((st) => st.a)`,
  });
  const wrong = [];
  inputs.forEach(([a, m], i) => {
    const engine = (got[i] > 127 ? got[i] - 256 : got[i]), ours = scale(a, m);
    if (engine !== ours) wrong.push(`scale(${a}, ${m}): engine ${engine}, port ${ours}`);
  });
  console.log(`  ${inputs.length} products across every byte and 43 multipliers`);
  check('the scale formula matches the engine over the whole byte range',
    wrong.length === 0, wrong.slice(0, 4).join('; ') || `${inputs.length} exact`);
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/math.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_math: all ${results.length} checks passed`
  : `parity_math: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
