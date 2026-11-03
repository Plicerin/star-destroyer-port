/**
 * A2-3D2's clipper, $6AD4 and $6AEE.
 *
 * **It computes exact intersections.** DISK_TRUTH said for a while that it was a
 * bisection - "a line straddling a plane is walked inward by halving, at most ten times"
 * - which was wrong, and wrong in the direction that would have made a port differ at
 * every window edge for no reason. The `DEC $B1` loop with its limit of ten is not a
 * halving count: it is a cap on how many planes a single line may be clipped against,
 * because clipping to one plane can leave the point outside another.
 *
 * What $6AEE actually does, for the one plane it picks:
 *
 *     t   = f(p2) / (f(p2) - f(p1))        a Q15 parameter, via the engine's DIV
 *     p2' = p2 + t * (p1 - p2)             two axes interpolated with the engine's MULCORE
 *     and the plane's own axis forced equal, so the point lands exactly on it
 *
 * where f is the plane's distance function and the four planes are the frustum's:
 *
 *   | outcode bit | set when | plane |
 *   | --- | --- | --- |
 *   | $40 | z + x < 0 | x = -z |
 *   | $20 | z - x < 0 | x =  z |
 *   | $10 | z + y < 0 | y = -z |
 *   | $08 | z - y < 0 | y =  z |
 *
 * $6AD4 clips the OTHER endpoint, by swapping the two slots ($6ADE), clipping, and
 * swapping back - so there is one clip routine, not two.
 */
import { mul, div } from './math.js';
import { outcode } from './view.js';

/** Which plane $6AEE picks, given an outcode: the lowest bit present. */
export function planeFor(code) {
  if ((code & ~0x40 & 0xff) === 0) return 0x40;
  if ((code & ~0x60 & 0xff) === 0) return 0x20;
  if ((code & ~0x70 & 0xff) === 0) return 0x10;
  return 0x08;
}

const F = {
  0x40: (p) => p[2] + p[0],
  0x20: (p) => p[2] - p[0],
  0x10: (p) => p[2] + p[1],
  0x08: (p) => p[2] - p[1],
};

/**
 * Clip p2 against one plane, returning the new p2. p1 is left alone.
 *
 * The order of the two interpolations is the engine's, and it matters: MULCORE is lossy,
 * so interpolating x before z is not the same arithmetic as the other way round.
 */
export function clipPoint(p1, p2, plane = null) {
  const bit = plane ?? planeFor(outcode(p2));
  const f = F[bit];
  const num = f(p2);
  const den = f(p2) - f(p1);
  const t = div(num, den);
  if (t === null) return p2.slice();            // |num| >= |den|: the divide is undefined

  const out = p2.slice();
  if (bit === 0x40 || bit === 0x20) {
    // An x plane: interpolate y and z, then force x from z.
    out[1] = p2[1] + mul(t, p1[1] - p2[1]);
    out[2] = p2[2] + mul(t, p1[2] - p2[2]);
    out[0] = bit === 0x20 ? out[2] : -out[2];
  } else {
    // A y plane: interpolate x and z, then force y from z.
    out[0] = p2[0] + mul(t, p1[0] - p2[0]);
    out[2] = p2[2] + mul(t, p1[2] - p2[2]);
    out[1] = bit === 0x08 ? out[2] : -out[2];
  }
  return out;
}

/** The clip limit $6118 reloads for every command. */
export const CLIP_STEPS = 10;

/**
 * The draw path's clipping, $6265 and its neighbours.
 *
 * Trivial reject first - if the two outcodes share a bit, the line is wholly outside one
 * plane and nothing is drawn. Then whichever endpoint is outside is clipped, repeatedly,
 * until both are in or the budget runs out. Returns null when there is nothing to draw.
 */
export function clipLine(p1, p2) {
  let a = p1.slice(), b = p2.slice();
  let ca = outcode(a), cb = outcode(b);
  if (ca & cb) return null;                      // $626B, Cohen-Sutherland trivial reject
  let budget = CLIP_STEPS;
  while (ca || cb) {
    if (ca) {
      a = clipPoint(b, a);                       // $6289, via the slot swap
      ca = outcode(a);
      if (ca & cb) return null;                  // $6290
    } else {
      b = clipPoint(a, b);                       // $627C
      cb = outcode(b);
    }
    if (--budget === 0) return null;             // $627F / $6294
  }
  return [a, b];
}
