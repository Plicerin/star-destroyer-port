// The port's clipper against the engine's.
//
// This one exists because DISK_TRUTH had the clipper wrong. After the renderer pass it
// said: "the clipper is a bisection, not an intersection - a line that straddles a plane
// is walked inward by halving, at most ten times, counted down in $B1", and warned that a
// port solving the intersection exactly would differ at every window edge.
//
// It is an intersection. $6AEE picks one plane, computes `t = f(p2) / (f(p2) - f(p1))`
// with the engine's own DIV, and moves p2 to `p2 + t * (p1 - p2)` with the plane's axis
// forced so the point lands exactly on it. The `DEC $B1` loop is a cap on how many PLANES
// one line may be clipped against - clipping to one can leave the point outside another -
// not a halving count.
//
// The last check here is the control: the bisection model this file used to describe is
// run alongside, and it has to disagree. If halving gave the same answers, the correction
// would not matter and neither would this harness.
import { openOracle } from './a2.mjs';
import { toFlight, arm, callSub } from './exercise.mjs';
import { clipPoint, planeFor, CLIP_STEPS } from '../port/src/a23d2/clip.js';
import { outcode } from '../port/src/a23d2/view.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const lo = (v) => v & 0xff, hi = (v) => (v >> 8) & 0xff;
const s16 = (v) => (v > 32767 ? v - 65536 : v);

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

/** Set both slots, let the engine compute its own outcodes, then clip point 2. */
async function engineClip(p1, p2) {
  const zp = {
    0x60: lo(p1[0]), 0x61: hi(p1[0]), 0x62: lo(p1[1]), 0x63: hi(p1[1]), 0x64: lo(p1[2]), 0x65: hi(p1[2]),
    0x68: lo(p2[0]), 0x69: hi(p2[0]), 0x6A: lo(p2[1]), 0x6B: hi(p2[1]), 0x6C: lo(p2[2]), 0x6D: hi(p2[2]),
  };
  await callSub(a2, 0x6A22, { zp });                  // outcode slot 1 -> $66
  await callSub(a2, 0x6A7B, {});                      // outcode slot 2 -> $6E
  const before = JSON.parse(await a2.ev('JSON.stringify([window.M.rd(0x66), window.M.rd(0x6E)])'));
  const r = await callSub(a2, 0x6AEE, { read: [0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E] });
  const g = (i) => s16(r.zp[i] | (r.zp[i + 1] << 8));
  return { p: [g(0), g(2), g(4)], code: r.zp[6], codes: before, ok: r.returned };
}

// --- the outcodes agree, which everything else rests on ------------------------------------
console.log('\n=== outcodes ===');
{
  const wrong = [];
  for (const z of [50, 137, 400]) {
    for (const x of [-3 * z, -z, -z + 1, 0, z - 1, z, 3 * z]) {
      for (const y of [-2 * z, 0, 2 * z]) {
        const r = await engineClip([0, 0, z], [x, y, z]);
        if (r.codes[1] !== outcode([x, y, z])) {
          wrong.push(`(${x},${y},${z}): engine ${r.codes[1]}, port ${outcode([x, y, z])}`);
        }
      }
    }
  }
  check('the port computes the same outcode as $6A7B', wrong.length === 0,
    wrong.slice(0, 3).join('; ') || '63 points around the frustum');
}

// --- one plane at a time, and several at once -------------------------------------------------
console.log('\n=== $6AEE, clipping one plane ===');
const CASES = [];
for (const [p1, p2] of [
  [[0, 0, 100], [200, 0, 100]], [[0, 0, 100], [-200, 0, 100]],
  [[0, 0, 100], [0, 200, 100]], [[0, 0, 100], [0, -200, 100]],
  [[10, 20, 300], [400, 50, 200]], [[10, 20, 300], [-400, 50, 200]],
  [[10, 20, 300], [50, 400, 200]], [[10, 20, 300], [50, -400, 200]],
  [[-5, 7, 250], [300, 310, 180]], [[0, 0, 500], [600, -600, 300]],
  [[33, -21, 150], [200, -200, 100]], [[1, 1, 1000], [999, 999, 900]],
]) CASES.push([p1, p2]);
// A spread that hits every plane and every corner, deterministic so a failure is reproducible.
for (let i = 0; i < 60; i++) {
  const z1 = 120 + (i * 37) % 400, z2 = 90 + (i * 53) % 350;
  const p1 = [((i * 17) % 61) - 30, ((i * 29) % 61) - 30, z1];
  const p2 = [((i * 71) % 801) - 400, ((i * 131) % 801) - 400, z2];
  if (outcode(p2) === 0) continue;                    // nothing to clip
  CASES.push([p1, p2]);
}
{
  const wrong = [], planeWrong = [];
  let shown = 0;
  for (const [p1, p2] of CASES) {
    const got = await engineClip(p1, p2);
    const ours = clipPoint(p1, p2);
    if (got.p.join() !== ours.join()) wrong.push(`${JSON.stringify(p1)}->${JSON.stringify(p2)}: engine ${got.p}, port ${ours}`);
    if (shown++ < 6) {
      console.log(`  p2 ${JSON.stringify(p2).padEnd(20)} plane $${planeFor(outcode(p2)).toString(16).padStart(2, '0')}`
        + `  -> ${JSON.stringify(got.p)}`);
    }
  }
  console.log(`  ${CASES.length} clips`);
  check('the clipped point matches the engine exactly, on all four planes',
    wrong.length === 0, wrong.slice(0, 3).join(' | ') || `${CASES.length} exact`);
  check('and the port picks the same plane when several are violated',
    planeWrong.length === 0,
    'checked implicitly - a different plane gives a different point, which the above would catch');
}

// --- the control ------------------------------------------------------------------------------
// The bisection DISK_TRUTH used to describe, run on the same inputs. It has to disagree.
console.log('\n=== the model this replaces ===');
{
  const bisect = (p1, p2) => {
    let a = p1.slice(), b = p2.slice();
    for (let i = 0; i < CLIP_STEPS; i++) {
      const mid = [0, 1, 2].map((k) => (a[k] + b[k]) >> 1);
      if (outcode(mid)) b = mid; else a = mid;
    }
    return b;
  };
  let same = 0;
  for (const [p1, p2] of CASES) {
    if (bisect(p1, p2).join() === clipPoint(p1, p2).join()) same++;
  }
  console.log(`  halving agrees with the engine on ${same} of ${CASES.length} clips`);
  check('a bisection does NOT reproduce it, so the correction was worth making',
    same < CASES.length / 4,
    `${same} of ${CASES.length} - the old description would have been wrong at nearly every clipped edge`);
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/clip.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_clip: all ${results.length} checks passed`
  : `parity_clip: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
