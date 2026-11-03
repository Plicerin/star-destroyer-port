// The port's view pipeline against the engine's.
//
// Trig, the rotation matrix, the transform and the projection - every stage compared
// against the real thing rather than against the formulas the probes wrote down, because
// the formulas describe what the engine computes and this has to reproduce how.
//
// The matrix builder is the interesting one. probe_transform.mjs could only say its
// rounding was "bounded but not modelled" and that the x scale wandered with pitch by up
// to 2%. It is not rounding: $666E skips its own `LDA $6140` when the constant's high
// byte is not $7F, so the first entry of each row is scaled by the high byte joined to
// whatever the accumulator was left holding. The port reproduces that, and this harness
// is what says whether it got it right.
import { openOracle } from './a2.mjs';
import { toFlight, arm, callSub, runList, op } from './exercise.mjs';
import { sin, cos, buildMatrix, transform, project, outcode, viewportScale, viewportCentre }
  from '../port/src/a23d2/view.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const s16 = (v) => (v > 32767 ? v - 65536 : v);
const lo = (v) => v & 0xff, hi = (v) => (v >> 8) & 0xff;

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

// --- trig -----------------------------------------------------------------------------------
console.log('\n=== $61C8 and $61CB, over every angle ===');
{
  const wrongSin = [], wrongCos = [];
  for (let a = 0; a < 256; a++) {
    const s = await callSub(a2, 0x61C8, { a });
    const c = await callSub(a2, 0x61CB, { a });
    const sv = s16(s.a | (s.x << 8)), cv = s16(c.a | (c.x << 8));
    if (sv !== sin(a)) wrongSin.push(`sin(${a}): engine ${sv}, port ${sin(a)}`);
    if (cv !== cos(a)) wrongCos.push(`cos(${a}): engine ${cv}, port ${cos(a)}`);
  }
  console.log(`  sin(0) = ${sin(0)}, cos(0) = ${cos(0)}, cos(128) = ${cos(128)}`);
  check('$61C8 is sine and $61CB is cosine, over all 256 angles',
    wrongSin.length === 0 && wrongCos.length === 0,
    [...wrongSin, ...wrongCos].slice(0, 3).join('; ') || '512 values exact');
  // The control: the table's negative quadrants are not the mirror of its positive ones,
  // so a port that negated properly would be wrong. Say by how much.
  check('and the folding is not a true negation, which is why it is transliterated',
    cos(128) === -32383 && cos(0) === 32767,
    `cos(128) = ${cos(128)}, where negating cos(0) would give ${-cos(0)}`);
}

// --- the matrix -------------------------------------------------------------------------------
console.log('\n=== $666E, the matrix builder ===');
const CONSTANTS = (sx, sy, sz) => [15, lo(sx), hi(sx), lo(sy), hi(sy), lo(sz), hi(sz)];
const DEFAULT = [16000, 32767, 9541];
const head = (c) => [20, 0, 12, 0, 29, 0, ...c, ...op.switches(),
  ...op.viewport(140, 126, 0, 34), ...op.clear(0), ...op.drawTo(0)];

async function engineMatrix(pitch, bank, heading, scales = DEFAULT) {
  const r = await runList(a2, [...head(CONSTANTS(...scales)),
    ...op.viewer(0, 0, 0, pitch, bank, heading), ...op.colour(7), 121],
    { page: 1, budget: 4000000, watch: [[0x7E, 18]] });
  const w = r.watched[0], at = (a) => s16(w[a - 0x7E] | (w[a - 0x7E + 1] << 8));
  return [[at(0x7E), at(0x84), at(0x8A)], [at(0x80), at(0x86), at(0x8C)],
    [at(0x82), at(0x88), at(0x8E)]];
}

{
  const wrong = [];
  let tested = 0;
  const angles = [0, 1, 7, 16, 32, 48, 63, 64, 65, 96, 127, 128, 160, 192, 200, 255];
  for (const p of angles) {
    for (const [b, h] of [[0, 0], [32, 0], [0, 32], [37, 211], [128, 128], [255, 1]]) {
      const got = await engineMatrix(p, b, h);
      const ours = buildMatrix(p, b, h, DEFAULT);
      tested++;
      if (JSON.stringify(got) !== JSON.stringify(ours)) {
        wrong.push(`p${p} b${b} h${h}: engine ${JSON.stringify(got)} port ${JSON.stringify(ours)}`);
      }
    }
  }
  const zero = await engineMatrix(0, 0, 0);
  console.log(`  at all angles zero the diagonal is (${zero[0][0]}, ${zero[1][1]}, ${zero[2][2]})`);
  console.log(`  where the constants are (${DEFAULT.join(', ')}) - the x entry is the bug`);
  check('the matrix matches the engine at every attitude tried',
    wrong.length === 0, wrong.slice(0, 2).join(' | ') || `${tested} attitudes, nine entries each`);
  // The control. If the stale accumulator did not matter, using the constant would do.
  const naive = (() => {
    const m = buildMatrix(0, 0, 0, DEFAULT);
    return m[0][0];
  })();
  check('and the x entry is not the constant, which is what the bug costs',
    naive === zero[0][0] && naive !== 16000,
    `${naive} rather than 16000, a difference of ${naive - 16000}`);
}

// --- the scales ---------------------------------------------------------------------------------
{
  const wrong = [];
  for (const scales of [[8000, 32767, 9541], [16000, 16000, 9541], [16000, 32767, 20000],
    [32767, 32767, 32767], [4000, 8000, 12000]]) {
    const got = await engineMatrix(0, 0, 0, scales);
    const ours = buildMatrix(0, 0, 0, scales);
    if (JSON.stringify(got) !== JSON.stringify(ours)) {
      wrong.push(`${scales}: engine ${JSON.stringify(got)} port ${JSON.stringify(ours)}`);
    }
  }
  check('and at every setting of opcode 15, including when a row is skipped',
    wrong.length === 0, wrong.slice(0, 2).join(' | ') || 'five settings');
}

// --- transform and projection ----------------------------------------------------------------------
console.log('\n=== the whole pipeline, world coordinates to a pixel ===');
{
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
    [[-7, 3, 77], [1, -2, 3, 11, 22, 33]],
  ];
  const sc = [viewportScale(140), viewportCentre(0), viewportScale(126), viewportCentre(34)];
  const wrongView = [], wrongPixel = [];
  for (const [pt, viewer] of CASES) {
    const r = await runList(a2, [...head(CONSTANTS(...DEFAULT)), ...op.viewer(...viewer),
      ...op.colour(7), ...op.point3d(...pt), 121],
      { page: 1, budget: 4000000, watch: [[0x7E, 18], [0x60, 6]] });
    const w = r.watched[0], at = (a) => s16(w[a - 0x7E] | (w[a - 0x7E + 1] << 8));
    const theirM = [[at(0x7E), at(0x84), at(0x8A)], [at(0x80), at(0x86), at(0x8C)],
      [at(0x82), at(0x88), at(0x8E)]];
    const sv = r.watched[1], g = (i) => s16(sv[i] | (sv[i + 1] << 8));
    const theirView = [g(0), g(2), g(4)];

    const M = buildMatrix(viewer[3], viewer[4], viewer[5], DEFAULT);
    const ourView = transform(M, pt, viewer.slice(0, 3));
    if (JSON.stringify(theirM) !== JSON.stringify(M)) wrongView.push(`matrix for ${viewer}`);
    if (JSON.stringify(theirView) !== JSON.stringify(ourView)) {
      wrongView.push(`view for ${pt}/${viewer}: engine ${theirView} port ${ourView}`);
    }
    const px = [project(ourView[0], ourView[2], sc[0], sc[1]),
      project(ourView[1], ourView[2], sc[2], sc[3])];
    const bit = r.lit.length ? r.lit[0].bit : null, row = r.lit.length ? r.lit[0].row : null;
    const theirs = bit === null ? null : [Math.floor((bit - 140) / 2), 95 - row];
    if (theirs && (px[0] !== theirs[0] || px[1] !== theirs[1])) {
      wrongPixel.push(`${pt}/${viewer}: engine ${theirs} port ${px}`);
    }
    console.log(`  p(${pt.join(',').padEnd(12)}) viewer(${viewer.join(',').padEnd(17)})`
      + ` -> view ${JSON.stringify(ourView).padEnd(20)} -> pixel ${JSON.stringify(px).padEnd(11)}`
      + ` ${theirs ? (px.join() === theirs.join() ? 'ok' : 'DIFFERS ' + JSON.stringify(theirs)) : '(clipped)'}`);
  }
  check('the transform reproduces the engine\'s view-space point exactly',
    wrongView.length === 0, wrongView.slice(0, 2).join(' | ') || `${CASES.length} cases`);
  check('and the projection lands on the engine\'s pixel',
    wrongPixel.length === 0, wrongPixel.slice(0, 2).join(' | ') || 'every unclipped case');
}

// --- the clip outcode -----------------------------------------------------------------------------
{
  const wrong = [];
  for (const v of [[0, 0, 100], [100, 0, 100], [101, 0, 100], [-101, 0, 100],
    [0, 101, 100], [0, -101, 100], [50, 50, 100], [0, 0, -100]]) {
    const r = await callSub(a2, 0x6A22, {
      zp: { 0x60: lo(v[0]), 0x61: hi(v[0]), 0x62: lo(v[1]), 0x63: hi(v[1]),
        0x64: lo(v[2]), 0x65: hi(v[2]) }, read: [0x66],
    });
    if (r.zp[0] !== outcode(v)) wrong.push(`${v}: engine ${r.zp[0]}, port ${outcode(v)}`);
  }
  check('the clip outcode matches, so the port rejects the same lines',
    wrong.length === 0, wrong.join('; ') || 'eight points around the frustum');
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/view.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_view: all ${results.length} checks passed`
  : `parity_view: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
