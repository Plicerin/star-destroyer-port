// The world-to-view transform, derived.
//
// This was the last stage of the renderer left as a measurement rather than a formula.
// probe_projection.mjs established what happens to a point once it is in view space, and
// that the two stages compose - but getting a point INTO view space was recorded as "an
// anisotropic fixed-point scaling that multiplies x and y by about 3.8 and z by about
// 2.3, at a ratio that is not even constant". That description was true and useless.
//
// What it actually is:
//
//     d  = p - viewer                       16-bit, per axis
//     v  = (M . d) << 3                     M a 3x3 matrix, the shift applied to the sum
//
// M lives in zero page at $7E-$8F, nine 16-bit entries in Q15, laid out by output axis:
//
//     out x:  $7E (x term)  $84 (y term)  $8A (z term)
//     out y:  $80           $86           $8C
//     out z:  $82           $88           $8E
//
// `$6090` initialises $7E, $86 and $8E - the diagonal - to $7FFD, which is the identity.
// `$666E` rebuilds the whole matrix from the pitch, bank and heading bytes at $96-$98
// whenever a VIEWER instruction runs.
//
// The shift of 3 is the part that makes the earlier description look strange. The
// multiply returns a Q15 product, so M alone scales a point DOWN - the diagonal at zero
// angles is (16123, 32765, 9539), which is (0.49, 1.00, 0.29). The `<< 3` then multiplies
// by eight, giving 3.9, 8.0 and 2.3. That is the whole of the "anisotropic scaling": a
// per-axis constant times eight.
//
// And those per-axis constants are **opcode 15's operands**. Its six bytes are three
// 16-bit values, `SV DATA` ships (16000, 32767, 9541), and they land on the diagonal.
// Halve the first and the x diagonal halves. That is what opcode 15 is for, and it is why
// zeroing it flattens the projection - a fact probe_opcodes.mjs had to work around
// without knowing why.
//
// The matrix BUILDER at `$666E` is not derived here. The rotation it produces is a real
// one - the rows keep their length as the angles change - and the y and z scales land on
// the diagonal within a few units. The x entry comes out high by between 0.2% and 2.3%,
// and moves with pitch although nothing in the mathematics says it should, which is
// rounding inside the builder. So a port reimplements `$666E` and `$6480` from the
// listing and checks them against the engine; it does not re-derive them from geometry.
//
// One piece is deliberately not reduced to arithmetic. The multiply at `$6480` is a
// shift-add loop that truncates its partial sums, so it is not `(a * b) >> 15`: it agrees
// with that about four times in five and is one low otherwise. There is no point writing
// a formula that is wrong 20% of the time, so this probe uses the ENGINE'S OWN multiply
// to predict the engine's transform, and pins a golden table of it for a port to check a
// reimplementation of `$6480` against. A port that reaches for a native multiply here
// will drift from the original.
import { openOracle } from './a2.mjs';
import { toFlight, arm, callSub, runList, op } from './exercise.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const lo = (v) => v & 0xff, hi = (v) => (v >> 8) & 0xff;
const s16 = (v) => (v > 32767 ? v - 65536 : v);
const s8 = (v) => (v > 127 ? v - 256 : v);

const MUL = 0x6480, MATRIX = 0x7E, VIEWER_ZP = 0x90, SLOT = 0x60;
const DEFAULT_SCALES = [16000, 32767, 9541];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

const constants = (sx, sy, sz) => [15, lo(sx), hi(sx), lo(sy), hi(sy), lo(sz), hi(sz)];
const head = (c = constants(...DEFAULT_SCALES)) => [20, 0, 12, 0, 29, 0, ...c,
  ...op.switches(), ...op.viewport(140, 126, 0, 34), ...op.clear(0), ...op.drawTo(0)];

/** Run one point through the engine and bring back the matrix, the viewer and the result. */
async function transform(pt, viewer = [0, 0, 0, 0, 0, 0], c) {
  const r = await runList(a2, [...head(c), ...op.viewer(...viewer), ...op.colour(7),
    ...op.point3d(...pt), 121],
    { page: 1, budget: 4000000, watch: [[MATRIX, 18], [SLOT, 6], [VIEWER_ZP, 6]] });
  const m = r.watched[0], at = (a) => s16(m[a - MATRIX] | (m[a - MATRIX + 1] << 8));
  const w = r.watched[1], g = (i) => s16(w[i] | (w[i + 1] << 8));
  const vz = r.watched[2], gv = (i) => s16(vz[i] | (vz[i + 1] << 8));
  return {
    M: [[at(0x7E), at(0x84), at(0x8A)], [at(0x80), at(0x86), at(0x8C)], [at(0x82), at(0x88), at(0x8E)]],
    view: [g(0), g(2), g(4)], viewerZp: [gv(0), gv(2), gv(4)],
    pixel: r.lit.length ? [Math.floor((r.lit[0].bit - 140) / 2), 95 - r.lit[0].row] : null,
  };
}

/** Many multiplies in one round trip - the engine's own $6480, which is the point. */
async function muls(pairs) {
  return JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, wr = window.M.wr;
    const before = cpu.getState(), out = [];
    for (const [a, b] of ${JSON.stringify(pairs)}) {
      wr(0x78, a & 0xff); wr(0x79, (a >> 8) & 0xff);
      wr(0x7A, b & 0xff); wr(0x7B, (b >> 8) & 0xff);
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = ${MUL}; cpu.setState(st);
      cpu.stepCyclesDebug(200000, () => cpu.getPC() === 0xFFFF);
      const e = cpu.getState();
      const v = e.a | (e.x << 8);
      out.push(v > 32767 ? v - 65536 : v);
    }
    cpu.setState(before);
    return out;
  })())`));
}

// --- the matrix ------------------------------------------------------------------------------
console.log('\n=== the matrix at $7E-$8F ===');
{
  const zero = await transform([40, 10, 100]);
  console.log('  at pitch 0, bank 0, heading 0:');
  for (const row of zero.M) console.log('    [' + row.map((v) => String(v).padStart(7)).join(' ') + ' ]');
  check('with no rotation the matrix is diagonal',
    zero.M[0][1] === 0 && zero.M[0][2] === 0 && zero.M[1][0] === 0 && zero.M[1][2] === 0
      && zero.M[2][0] === 0 && zero.M[2][1] === 0,
    `diagonal (${zero.M[0][0]}, ${zero.M[1][1]}, ${zero.M[2][2]})`);

  // Which entries move with which angle says the layout is by output axis, not by input.
  const pitched = await transform([40, 10, 100], [0, 0, 0, 32, 0, 0]);
  const banked = await transform([40, 10, 100], [0, 0, 0, 0, 32, 0]);
  const headed = await transform([40, 10, 100], [0, 0, 0, 0, 0, 32]);
  const moved = (A, B) => A.flat().map((v, i) => v !== B.flat()[i]);
  console.log(`  pitch moves the y and z rows:   ${moved(zero.M, pitched.M).map((b) => (b ? 'x' : '.')).join('')}`);
  console.log(`  bank moves the x and y rows:    ${moved(zero.M, banked.M).map((b) => (b ? 'x' : '.')).join('')}`);
  console.log(`  heading moves the x and z rows: ${moved(zero.M, headed.M).map((b) => (b ? 'x' : '.')).join('')}`);
  check('pitch leaves the x row alone, bank the z row, heading the y row',
    pitched.M[0][1] === 0 && pitched.M[0][2] === 0
      && banked.M[2][0] === 0 && banked.M[2][1] === 0
      && headed.M[1][0] === 0 && headed.M[1][2] === 0,
    'which is the layout: a row per output axis');
  // A rotation matrix's rows are unit vectors, scaled here by the axis constants.
  const norm = (r) => Math.sqrt(r.reduce((s, v) => s + (v / 32768) ** 2, 0));
  const got = [norm(pitched.M[1]), norm(pitched.M[2])];
  const want = [DEFAULT_SCALES[1] / 32768, DEFAULT_SCALES[2] / 32768];
  check('and the rotated rows keep their length, so it is a rotation times a scale',
    got.every((g, i) => Math.abs(g - want[i]) < 0.01),
    `pitched row lengths ${got.map((v) => v.toFixed(4)).join(', ')} against ${want.map((v) => v.toFixed(4)).join(', ')}`);
}

// --- opcode 15 is the axis scales ---------------------------------------------------------------
console.log('\n=== what opcode 15 is for ===');
{
  const base = [16000, 32767, 9541];
  const rows = [];
  for (const scales of [base, [8000, 32767, 9541], [16000, 16000, 9541], [16000, 32767, 20000]]) {
    const r = await transform([40, 10, 100], [0, 0, 0, 0, 0, 0], constants(...scales));
    const diag = [r.M[0][0], r.M[1][1], r.M[2][2]];
    rows.push({ scales, diag, view: r.view });
    console.log(`  op 15 = (${scales.map((v) => String(v).padStart(5)).join(',')})`
      + `  -> diagonal (${diag.map((v) => String(v).padStart(6)).join(',')})`
      + `  -> view (${r.view.join(',')})`);
  }
  // Each constant moves its own entry and leaves the other two alone. That is the claim
  // worth making, and it is exact.
  const only = (i) => rows.slice(1).every((r, k) => {
    const changedAxis = [0, 1, 2].find((j) => r.scales[j] !== base[j]);
    return [0, 1, 2].every((j) => (j === changedAxis) === (r.diag[j] !== rows[0].diag[j]));
  });
  check('each of opcode 15\'s three values moves its own diagonal entry and no other',
    only(), 'so they are per-axis scales, not a shared one');
  // y and z land on their constant almost exactly. x does not, and that is $666E's
  // rounding rather than anything about opcode 15 - see the note below.
  const yz = rows.every((r) => Math.abs(r.diag[1] - r.scales[1]) <= 5 && Math.abs(r.diag[2] - r.scales[2]) <= 5);
  check('the y and z scales land on the diagonal exactly, give or take truncation',
    yz, rows.map((r) => `${r.diag[1]}/${r.scales[1]}`).join(' '));
  check('and the x scale lands within a few percent, high, by an amount that is not derived',
    rows.every((r) => r.diag[0] >= r.scales[0] && r.diag[0] < r.scales[0] * 1.03),
    rows.map((r) => `${r.diag[0]}/${r.scales[0]}`).join(' '));
}

// How far from derived the matrix BUILDER is, stated as a number rather than a worry.
// With bank and heading at zero the x row is mathematically [scale, 0, 0] whatever the
// pitch - the pitch rotation does not touch it. It moves anyway, by up to 1.6%, which is
// the fixed-point rounding inside $666E. $666E is not modelled here.
{
  const xs = [];
  for (const pitch of [0, 16, 32, 48, 64, 96, 128]) {
    const r = await transform([40, 10, 100], [0, 0, 0, pitch, 0, 0]);
    xs.push(r.M[0][0]);
  }
  const spread = Math.max(...xs) - Math.min(...xs);
  console.log(`  the x row should not depend on pitch at all; across seven pitches it reads `
    + `${Math.min(...xs)} to ${Math.max(...xs)}`);
  check('$666E\'s rounding is real and bounded - the x row wanders by under 2% with pitch',
    spread > 0 && spread < 16000 * 0.02,
    `${spread} out of ~16000, so the builder is not modelled but the error is small and measured`);
}

// --- the composition ------------------------------------------------------------------------------
// The claim: subtract the viewer, multiply by the matrix with the engine's own multiply,
// shift the sum left by three. Exactly, with no slack.
console.log('\n=== v = (M . (p - viewer)) << 3 ===');
const CASES = [
  [[40, 10, 100], [0, 0, 0, 0, 0, 0]],
  [[20, 0, 100], [0, 0, 0, 0, 0, 0]],
  [[40, 10, 100], [10, 5, 20, 0, 0, 0]],
  [[40, 10, 100], [0, 0, 0, 32, 0, 0]],
  [[40, 10, 100], [0, 0, 0, 0, 32, 0]],
  [[40, 10, 100], [0, 0, 0, 0, 0, 32]],
  [[33, -21, 150], [-5, 7, -9, 16, 8, 24]],
  [[-60, 45, 200], [12, -30, 55, 200, 100, 50]],
  [[5, -5, 50], [0, 0, 0, 96, 0, 0]],
  [[300, -120, 900], [0, 0, 0, 0, 0, 160]],
];
{
  const wrong = [];
  let shown = 0;
  for (const [pt, viewer] of CASES) {
    const r = await transform(pt, viewer);
    const d = [pt[0] - viewer[0], pt[1] - viewer[1], pt[2] - viewer[2]];
    check_viewer: {
      if (r.viewerZp.join() !== viewer.slice(0, 3).join()) wrong.push(`viewer zp ${r.viewerZp} not ${viewer.slice(0, 3)}`);
    }
    const pairs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pairs.push([d[j], r.M[i][j]]);
    const products = await muls(pairs);
    const pred = [0, 1, 2].map((i) => (products[i * 3] + products[i * 3 + 1] + products[i * 3 + 2]) * 8);
    if (pred.join() !== r.view.join()) wrong.push(`p${pt} v${viewer}: predicted ${pred}, measured ${r.view}`);
    if (shown++ < 5) {
      console.log(`  p(${pt.join(',').padEnd(12)}) viewer(${viewer.join(',').padEnd(16)})`
        + ` -> predicted ${JSON.stringify(pred).padEnd(20)} measured ${JSON.stringify(r.view)}`);
    }
  }
  check('the viewer position is simply subtracted, and it is the three 16-bit words at $90',
    !wrong.some((w) => w.startsWith('viewer zp')), wrong.filter((w) => w.startsWith('viewer zp')).join('; '));
  check('the transform is the matrix product, shifted left by three, exactly',
    wrong.length === 0, wrong.slice(0, 2).join('; ') || `${CASES.length} cases, three axes each`);
}

// --- the multiply is the engine's, not arithmetic ------------------------------------------------
console.log('\n=== $6480, which has to be reimplemented rather than replaced ===');
const golden = [];
{
  const pairs = [];
  for (const b of [16123, 32765, 9539, 23167, -9540, 11310]) {
    for (const a of [1, 2, 5, 17, 40, 61, 100, 137, 224, 696, 1000, -40, -100, -224]) pairs.push([a, b]);
  }
  const got = await muls(pairs);
  let agree = 0;
  pairs.forEach(([a, b], i) => {
    const naive = Math.trunc(a * b / 32768);
    if (naive === got[i]) agree++;
    golden.push({ a, b, result: got[i] });
  });
  const pct = (100 * agree / pairs.length).toFixed(0);
  console.log(`  of ${pairs.length} products, ${agree} match (a * b) >> 15 and ${pairs.length - agree} do not (${pct}%)`);
  for (const [a, b] of [[61, 16123], [100, 16123], [40, 16123]]) {
    const i = pairs.findIndex(([x, y]) => x === a && y === b);
    console.log(`    ${String(a).padStart(5)} x ${b} = ${String(got[i]).padStart(5)}`
      + `   exact ${(a * b / 32768).toFixed(3)}`);
  }
  // The point of this check is that it must FAIL for the naive formula. If the engine's
  // multiply were just (a*b)>>15, a port could use one and this probe would be pointless.
  check('the engine\'s multiply is not (a * b) >> 15 - it truncates its partial sums',
    agree < pairs.length && agree > pairs.length / 2,
    `${pct}% agreement, so a native multiply is close enough to look right and wrong often enough to drift`);
}

// --- the whole pipeline, world to pixel -------------------------------------------------------------
// With the transform derived, a point can finally be placed from world coordinates. This
// is the thing none of the earlier probes could do.
console.log('\n=== world coordinates to a pixel, the whole chain ===');
{
  const C = JSON.parse(await a2.ev(
    'JSON.stringify([0x6380, 0x6386, 0x63A3, 0x63A9].map((a) => window.M.rd(a)))'));
  const divModel = (n, d) => {
    const m = Math.floor(Math.abs(n) * 16384 / Math.abs(d)) * 2;
    return ((n < 0) !== (d < 0)) ? -m : m;
  };
  const project = (v, z, scale, centre) => ((divModel(v, z) >> 8) * scale >> 7) + s8(centre);
  const wrong = [];
  for (const [pt, viewer] of CASES) {
    const r = await transform(pt, viewer);
    if (!r.pixel) continue;                       // clipped, and the clipper is not this probe's subject
    const d = [pt[0] - viewer[0], pt[1] - viewer[1], pt[2] - viewer[2]];
    const pairs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pairs.push([d[j], r.M[i][j]]);
    const products = await muls(pairs);
    const v = [0, 1, 2].map((i) => (products[i * 3] + products[i * 3 + 1] + products[i * 3 + 2]) * 8);
    const px = [project(v[0], v[2], C[0], C[1]), project(v[1], v[2], C[2], C[3])];
    if (px.join() !== r.pixel.join()) wrong.push(`p${pt} v${viewer}: predicted ${px}, plotted ${r.pixel}`);
    console.log(`  p(${pt.join(',').padEnd(12)}) viewer(${viewer.join(',').padEnd(16)})`
      + ` -> view ${JSON.stringify(v).padEnd(20)} -> predicted ${JSON.stringify(px).padEnd(11)}`
      + ` plotted ${JSON.stringify(r.pixel)}`);
  }
  check('transform then projection predicts the exact pixel, from world coordinates',
    wrong.length === 0, wrong.slice(0, 2).join('; ') || 'every unclipped case');
}

await a2.close();
fs.mkdirSync('captured/transform', { recursive: true });
fs.writeFileSync('captured/transform/golden.json', JSON.stringify({
  formula: {
    transform: 'v = (M . (p - viewer)) << 3',
    matrix: 'zp $7E-$8F, Q15, a row per output axis: x at $7E/$84/$8A, y at $80/$86/$8C, z at $82/$88/$8E',
    built: '$666E, from pitch/bank/heading at $96-$98 - a real rotation, but its fixed-point rounding is not modelled',
    scales: 'opcode 15 writes three 16-bit per-axis scales onto the diagonal',
    multiply: '$6480, a shift-add loop that truncates its partial sums - NOT (a * b) >> 15',
  },
  multiplyGolden: golden, results,
}, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `transform: all ${results.length} checks passed`
  : `transform: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
