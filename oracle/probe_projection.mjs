// The projection, derived.
//
// `$6367` turns one point in view space into two screen bytes, and it is the last thing
// in the renderer that was still a shape rather than a formula: the disassembly said
// "divide, scale by a constant, add a centre" and stopped there.
//
// It is built from two routines whose arithmetic is not obvious from reading them - a
// shift-subtract divide at `$65DE` and a shift-add multiply at `$659D`. Rather than
// decode them by eye, `exercise.mjs` can now call a single routine with the registers and
// zero page set, so each one is simply tabulated: put the inputs in, read the output, and
// the function is whatever the table says. Then the two are composed, and the composition
// is checked against the engine over a sweep.
//
// What comes out:
//
//     h      = DIV(v, z) >> 8                     a signed byte, v/z in 7 fractional bits
//     screen = ((h * scale) >> 7) + centre        both signed, both truncating downwards
//
// with DIV(n, d) = sign * floor(|n| * 16384 / |d|) * 2, defined only for |n| < |d|,
// which is exactly the frustum the clipper enforces before anything reaches here. The doubled
// fourteen-bit quotient is why 40/100 comes back as 13106 and not the 13107 that
// 0.4 * 32768 would give - the bottom bit is not computed, it is shifted in.
//
// `scale` and `centre` are bytes inside the projection code, which the VIEWPORT
// instruction patches: scale = (operand >> 1) - 1, centre = the operand as a signed byte,
// separately for x and y.
//
// This is the projection only. Getting a point from the display list into view space is a
// separate stage - subtract the viewer, rotate, and an anisotropic fixed-point scaling
// that multiplies x and y by about 3.8 and z by about 2.3 - and that stage is measured
// here but NOT derived. What is established is that the two compose: the view-space point
// the transform leaves in zero page, put through the formula above, gives the exact pixel
// the engine lights.
import { openOracle } from './a2.mjs';
import { toFlight, arm, callSub, runList, op } from './exercise.mjs';
import { hx } from './renderer.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const s8 = (v) => (v > 127 ? v - 256 : v);
const lo = (v) => v & 0xff, hi = (v) => (v >> 8) & 0xff;

const DIV = 0x65DE, SCALE = 0x659D, PROJECT = 0x6367;
const XSCALE = 0x6380, XCENTRE = 0x6386, YSCALE = 0x63A3, YCENTRE = 0x63A9;

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

// --- the divide -----------------------------------------------------------------------------
// Dividend in A:X, divisor in $7A/$7B, 16-bit result at $78/$79.
console.log('\n=== $65DE, the divide ===');
const divModel = (n, d) => {
  if (d === 0) return null;
  const m = Math.floor(Math.abs(n) * 16384 / Math.abs(d)) * 2;
  return ((n < 0) !== (d < 0)) ? -m : m;
};
const divOf = async (n, d) => {
  const r = await callSub(a2, DIV, {
    zp: { 0x7A: lo(d), 0x7B: hi(d) }, a: hi(n), x: lo(n), read: [0x78, 0x79],
  });
  const v = r.zp[0] | (r.zp[1] << 8);
  return { v: v > 32767 ? v - 65536 : v, hiByte: s8(r.zp[1]), ok: r.returned };
};
{
  // The routine has a domain, and it is not an accident: a quotient of 1 does not fit in
  // the fifteen fractional bits it produces, so it is only meaningful for |n| < |d|. That
  // is exactly the frustum - |x| <= z, |y| <= z - which the outcode test enforces before
  // anything is projected. Sweeping outside it produces numbers, and they mean nothing.
  const inDomain = [], outside = [];
  for (const d of [2, 4, 50, 100, 150, 200, 256, 400, 1000]) {
    for (const n of [0, 1, 5, 10, 20, 37, 40, 60, 99, -1, -10, -40, -99]) {
      (Math.abs(n) < Math.abs(d) ? inDomain : outside).push([n, d]);
    }
  }
  const wrong = [];
  for (const [n, d] of inDomain) {
    const got = await divOf(n, d);
    if (got.v !== divModel(n, d)) wrong.push(`${n}/${d}: got ${got.v}, model ${divModel(n, d)}`);
  }
  for (const [n, d] of [[40, 100], [50, 100], [1, 2], [-40, 100], [99, 100]]) {
    const g = await divOf(n, d);
    console.log(`  ${String(n).padStart(4)} / ${String(d).padStart(4)} = ${String(g.v).padStart(6)}`
      + `   (n/d)*32768 would be ${(n / d * 32768).toFixed(1)}`);
  }
  check('the divide is floor(|n| * 16384 / |d|) doubled and signed, for |n| < |d|',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${inDomain.length} cases`);
  // The control. If this also matched, the formula above would be describing something
  // other than what the routine does.
  const outWrong = [];
  for (const [n, d] of outside) {
    const got = await divOf(n, d);
    if (got.v === divModel(n, d)) outWrong.push(`${n}/${d}`);
  }
  const example = await divOf(5, 2);
  console.log(`  outside the domain it is meaningless, as it should be: 5 / 2 = ${example.v}`);
  check('and outside that domain it does not - so the domain is real, not a convenience',
    outWrong.length === 0, `${outside.length} out-of-range cases, none of which the formula fits`);
}

// --- the multiply ----------------------------------------------------------------------------
console.log('\n=== $659D, the scale ===');
const scaleModel = (a, m) => (s8(a) * m) >> 7;
{
  // The multiplier's domain is 0 to 127. VIEWPORT cannot produce more than 126 - it halves
  // its operand and subtracts one - so the engine never asks for anything outside it.
  const wrong = [];
  for (let m of [1, 19, 31, 62, 69, 99, 126, 127]) {
    for (let a = 0; a < 256; a += 3) {
      const r = await callSub(a2, SCALE, { a, x: m });
      if (s8(r.a) !== scaleModel(a, m)) wrong.push(`SCALE(${a},${m}) = ${s8(r.a)}, model ${scaleModel(a, m)}`);
    }
  }
  const big = await callSub(a2, SCALE, { a: 3, x: 200 });
  console.log(`  a multiplier over 127 is outside what VIEWPORT can set, and is not this: `
    + `SCALE(3, 200) = ${s8(big.a)}, not ${scaleModel(3, 200)}`);
  for (const [a, m] of [[102, 69], [128, 69], [255, 69], [200, 69]]) {
    const r = await callSub(a2, SCALE, { a, x: m });
    console.log(`  SCALE(${String(a).padStart(3)}, ${m}) = ${String(s8(r.a)).padStart(4)}`
      + `   = (${s8(a)} * ${m}) >> 7`);
  }
  check('the scale is (signed byte * multiplier) >> 7, rounding downwards, for a multiplier under 128',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || '688 cases');
}

// --- the viewport patches the constants into the code -------------------------------------------
console.log('\n=== VIEWPORT, which writes the constants into the projection ===');
const CONSTANTS = [15, 0x80, 0x3E, 0xFF, 0x7F, 0x45, 0x25];
const headWith = (vp) => [20, 0, 12, 0, 29, 0, ...CONSTANTS, ...op.switches(), ...vp,
  ...op.clear(0), ...op.drawTo(0), ...op.viewer(0, 0, 0, 0, 0, 0), ...op.colour(7)];
const constantsNow = async () => JSON.parse(await a2.ev(
  `JSON.stringify([${XSCALE}, ${XCENTRE}, ${YSCALE}, ${YCENTRE}].map((a) => window.M.rd(a)))`));
{
  const wrong = [];
  for (const [xs, ys, xc, yc] of [[140, 126, 0, 34], [65, 66, 32, 195], [40, 200, 10, 250], [254, 2, 0, 0]]) {
    await runList(a2, [...headWith(op.viewport(xs, ys, xc, yc)), 121], { page: 1, budget: 4000000 });
    const c = await constantsNow();
    const want = [(xs >> 1) - 1 & 0xff, xc, (ys >> 1) - 1 & 0xff, yc];
    if (c.join() !== want.join()) wrong.push(`viewport(${xs},${ys},${xc},${yc}) -> ${c} not ${want}`);
    console.log(`  viewport(${String(xs).padStart(3)},${String(ys).padStart(3)},${String(xc).padStart(3)},${String(yc).padStart(3)})`
      + ` -> xscale ${String(c[0]).padStart(3)} xcentre ${String(c[1]).padStart(3)}`
      + ` yscale ${String(c[2]).padStart(3)} ycentre ${String(c[3]).padStart(3)}`);
  }
  check('scale is (operand >> 1) - 1 and centre is the operand, for each axis',
    wrong.length === 0, wrong.join('; ') || '4 viewports');
}

// --- the two composed ------------------------------------------------------------------------
// The claim, and the sweep that has to hold for it: for a point already in view space,
// $6367 produces exactly this. Only inside the frustum - outside it the clipper rejects
// the line before anything is projected, and the arithmetic there means nothing.
console.log('\n=== $6367, the projection itself ===');
const project = (v, z, scale, centre) => ((divModel(v, z) >> 8) * scale >> 7) + s8(centre);
await runList(a2, [...headWith(op.viewport(140, 126, 0, 34)), 121], { page: 1, budget: 4000000 });
const C = await constantsNow();
{
  // Strictly inside: at v = +/-z exactly the quotient is 1, which does not fit in the
  // fifteen fractional bits, and the engine comes back one short - 95 where the formula
  // says 96. A point sitting exactly on the frustum edge is off by one, and a port
  // copying the formula without the clamp would differ there.
  const wrong = [];
  let tested = 0;
  for (const z of [40, 50, 100, 137, 200, 400, 1000]) {
    for (let v = -(z - 1); v < z; v += Math.max(1, Math.round(z / 11))) {
      const r = await callSub(a2, PROJECT, {
        zp: { 0x60: lo(v), 0x61: hi(v), 0x62: lo(-v), 0x63: hi(-v), 0x64: lo(z), 0x65: hi(z) },
        y: 0x60, x: 0x9F, read: [0x9F, 0xA0],
      });
      tested += 2;
      const px = project(v, z, C[0], C[1]), py = project(-v, z, C[2], C[3]);
      if (s8(r.zp[0]) !== px) wrong.push(`x: v=${v} z=${z} got ${s8(r.zp[0])} want ${px}`);
      if (s8(r.zp[1]) !== py) wrong.push(`y: v=${-v} z=${z} got ${s8(r.zp[1])} want ${py}`);
    }
  }
  for (const [v, z] of [[40, 100], [20, 100], [0, 100], [-40, 100], [60, 100]]) {
    const r = await callSub(a2, PROJECT, {
      zp: { 0x60: lo(v), 0x61: hi(v), 0x62: 0, 0x63: 0, 0x64: lo(z), 0x65: hi(z) },
      y: 0x60, x: 0x9F, read: [0x9F, 0xA0],
    });
    console.log(`  view (${String(v).padStart(4)},0,${z}) -> x ${String(s8(r.zp[0])).padStart(4)}`
      + `   = ((${divModel(v, z) >> 8} * ${C[0]}) >> 7) + ${s8(C[1])}`);
  }
  check('the projection is exactly DIV then SCALE then the centre, everywhere strictly inside the frustum',
    wrong.length === 0, wrong.slice(0, 3).join('; ') || `${tested} coordinates`);
  // And on the edge itself it is one short, which is worth pinning rather than glossing.
  const edge = await callSub(a2, PROJECT, {
    zp: { 0x60: lo(40), 0x61: hi(40), 0x62: 0, 0x63: 0, 0x64: lo(40), 0x65: hi(40) },
    y: 0x60, x: 0x9F, read: [0x9F, 0xA0],
  });
  check('on the frustum edge, where the quotient is exactly 1, it comes back one short',
    s8(edge.zp[0]) === project(40, 40, C[0], C[1]) - 1,
    `v = z = 40 gives ${s8(edge.zp[0])}, the formula says ${project(40, 40, C[0], C[1])}`);
}

// --- what it is fed ----------------------------------------------------------------------------
// The stage before it. This is measured, not derived: the numbers are pinned so a change
// would be noticed, and no formula is claimed for them.
console.log('\n=== the transform that feeds it: measured, not derived ===');
const WORLD = [[40, 10, 100], [20, 0, 100], [10, 5, 100], [40, 0, 200], [-30, 20, 150],
  [5, -5, 50], [60, -40, 300], [0, 0, 100]];
const seen = [];
{
  const wrong = [];
  for (const p of WORLD) {
    const r = await runList(a2, [...headWith(op.viewport(140, 126, 0, 34)), ...op.point3d(...p), 121],
      { page: 1, budget: 4000000, watch: [[0x60, 6]] });
    const w = r.watched[0];
    const g = (i) => { const v = w[i] | (w[i + 1] << 8); return v > 32767 ? v - 65536 : v; };
    const view = [g(0), g(2), g(4)];
    const px = project(view[0], view[2], C[0], C[1]);
    const py = project(view[1], view[2], C[2], C[3]);
    const bit = r.lit.length ? r.lit[0].bit : null, row = r.lit.length ? r.lit[0].row : null;
    const got = [bit === null ? null : Math.floor((bit - 140) / 2), row === null ? null : 95 - row];
    seen.push({ world: p, view, screen: got });
    if (got[0] !== px || got[1] !== py) wrong.push(`${p} -> predicted ${px},${py} got ${got}`);
    console.log(`  world (${p.join(',').padEnd(11)}) -> view (${view.map((v) => String(v).padStart(5)).join(',')})`
      + ` -> predicted (${String(px).padStart(4)},${String(py).padStart(4)})`
      + ` -> plotted (${String(got[0]).padStart(4)},${String(got[1]).padStart(4)})`);
  }
  // This is the load-bearing one: it says the pipeline really is these two stages, and
  // that only the first of them is still unexplained.
  check('the pipeline composes - the formula applied to the view-space point gives the pixel',
    wrong.length === 0, wrong.join('; ') || `${WORLD.length} points, x and y`);
  const ratios = seen.filter((s) => s.world[0]).map((s) => (s.view[0] / s.world[0]) / (s.view[2] / s.world[2]));
  console.log(`  the transform's x:z magnification over these points: `
    + `${Math.min(...ratios).toFixed(3)} to ${Math.max(...ratios).toFixed(3)}`);
  check('the transform is not a rigid one - it magnifies x and y against z',
    Math.min(...ratios) > 1.2, 'so the frustum is not the 90 degrees the clip test alone suggests');
}

await a2.close();
fs.mkdirSync('captured/projection', { recursive: true });
fs.writeFileSync('captured/projection/golden.json', JSON.stringify({
  formula: {
    div: 'sign * floor(|n| * 16384 / |d|) * 2, for |n| < |d| only',
    scale: '(signed8(a) * m) >> 7',
    projection: 'screen = ((DIV(v, z) >> 8) * scale >> 7) + signed8(centre)',
    viewport: 'scale = (operand >> 1) - 1, centre = operand',
  },
  constants: { xscale: C[0], xcentre: C[1], yscale: C[2], ycentre: C[3] },
  transform: seen, results,
}, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `projection: all ${results.length} checks passed`
  : `projection: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
