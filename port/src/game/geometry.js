// Range and bearing: how the frame loop works out where something is relative to the ship.
//
// Two blocks of MATH instructions, and between them they account for seven of the nine
// places the game asks a geometric question. They are the reason the five big loop regions
// look so repetitive: each one is these two idioms again, with a different pair of indices
// out of the directory at $08F2.
//
// **The range appears four times.** Three of them are inline - $0C0F, $101F and $1429, one
// per enemy class, each gated on an object count - and the fourth, $1C3D, is the same
// seventy-five bytes wrapped in an RTS, called from nine places that first copy four
// coordinates into argument slots. The three inline copies differ from each other in exactly
// two bytes: the directory address the target's X and Z come from.
//
// **The bearing appears three times**, always immediately after an inline range, and the
// three copies are the same two hundred and seventeen bytes apart from their jump targets -
// including the same forty bytes of skipped-over dead code at $0D33, $1143 and $154D.
//
// **The range is not a distance.** It is
//
//     sqrt(2 * (|dx| + |dz|))
//
// in world units - the square root of twice the L1 norm, not the Euclidean length. The
// entry at index 155 holds 512, which is 2.0 in the fixed point, so the two multiplies scale
// each delta by two rather than squaring it; there is no second operand anywhere that would
// make it a square. At a separation of (1000, 2400) the Euclidean distance is 2600 and this
// is 82. The port does not improve on it, and probe_geometry.mjs carries a control that
// fails if anyone replaces it with a hypotenuse.
//
// **The bearing is a full four-quadrant arctangent in whole degrees, then rescaled** into the
// 256-unit heading the display list uses. Three things about it are measured oddities worth
// keeping:
//
//   - Before dividing, the block **increments the low byte of each delta**, with no carry.
//     That is what stops a delta of zero dividing by zero - a target on the axis gives a
//     delta of 0, which becomes 1 - but it does it by corrupting the fraction, and when a
//     delta's low byte is already $FF the increment wraps it to zero and the divide-by-zero
//     happens anyway. A delta of 255 is the case: it becomes 0, and the bearing comes out 0.
//   - The two quadrants with positive dx are resolved against **271 degrees**, not 270. The
//     entry at index 161 holds 69376, which is 271 * 256.
//   - Degrees are converted to heading units by dividing by the entry at index 167, which
//     holds **359**, not 360. So a full turn is 256 * 256 / 359 = 182.5 units rather than
//     182.04, and the two errors partly cancel: the ideal heading for a bearing of 271 would
//     be 192.7 units and this gives 193.2.
//
// Taken together the bearing runs 0 to 361 degrees, so at the corner of the fourth quadrant
// it produces 361 * 256 / 359 = 257 heading units - more than a byte. The game reads it back
// as the middle byte of the entry, which is the unit count modulo 256, so 257 wraps to 1 and
// the circle closes. The port keeps the overshoot rather than clamping, because the wrap is
// what the caller at $0D63 actually compares against.
//
// Everything above is measured by oracle/probe_geometry.mjs and held against the running
// blocks, instruction for instruction, by oracle/parity_geometry.mjs.
import { VARS } from './tables.js';

/** A directory entry, by the address in $08F2-$0932 that holds it. */
/** The directory at $08F2: an address in the binary's state to its index in MATH's table. */
export const dir = (address) => VARS[address - 0x08F2];

/**
 * The table indices these two blocks name, each through the directory at $08F2.
 *
 * Nothing in the binary ever writes $091F-$0924, so the five entries they point at are
 * constants of the build: zero, 2.0, 90 degrees, 271 degrees and 359. They are read from the
 * table rather than inlined here, so the port's arithmetic goes through the same entries the
 * original reads.
 */
export const GEOM = {
  /** $092B, $092C - the first point, for the subroutine form. */
  aX: dir(0x092B), aZ: dir(0x092C),
  /** $092D, $092E - the second point. The delta is a minus b. */
  bX: dir(0x092D), bZ: dir(0x092E),
  /** $0901, $0903 - the ship's own position, the second point for the inline copies. */
  shipX: dir(0x0901), shipZ: dir(0x0903),
  /** $0908, $0909 - where the two deltas are kept. */
  deltaX: dir(0x0908), deltaZ: dir(0x0909),
  /** $090A - the range. */
  range: dir(0x090A),
  /** $090B - the bearing, in degrees until $0D21 and in heading units after it. */
  bearing: dir(0x090B),
  /** $090C - the scratch the first scaled delta waits in. */
  scratch: dir(0x090C),
  /** $091F - an entry holding zero, the right-hand side of every quadrant test. */
  zero: dir(0x091F),
  /** $0920 - an entry holding 512, which is 2.0. */
  two: dir(0x0920),
  /** $0921 - an entry holding 90 degrees. */
  deg90: dir(0x0921),
  /** $0922 - an entry holding 271 degrees. Not 270. */
  deg271: dir(0x0922),
  /** $0924 - an entry holding 359, the degrees-per-heading-unit divisor. Not 360. */
  degreesPerUnit: dir(0x0924),
  /**
   * The target of each inline range-and-bearing, by the class whose count gates it:
   * $0C0F on OBJ1.count, $101F on OBJ2.count, $1429 on OBJ3.count.
   */
  targets: [
    { x: dir(0x090D), z: dir(0x090F) },
    { x: dir(0x090E), z: dir(0x0910) },
    { x: dir(0x0930), z: dir(0x0931) },
  ],
};

/**
 * $0C0F-$0C57 - the range, over four explicit coordinate indices.
 *
 * Nine MATH instructions. The deltas are left behind in the table on purpose: the bearing
 * block reads them straight out of $0908 and $0909 without recomputing them, and the
 * subroutine form's callers read the range out of $090A.
 *
 * `a` is the Y operand of each subtract and `b` the X operand, so the delta is a minus b.
 *
 * @param {import('./math.js').Math24} m
 * @returns {{inDomain: boolean}} false where the square root leaves what the port can model
 */
export function range(m, aX, aZ, bX, bZ) {
  m.sub(bX, aX);
  m.storeAcc(GEOM.deltaX);
  m.sub(bZ, aZ);
  m.storeAcc(GEOM.deltaZ);
  // Twice each delta's magnitude - index 155 holds 2.0, and the multiply divides by 256.
  m.multiply(GEOM.two, GEOM.deltaX);
  m.abs();
  m.storeAcc(GEOM.scratch);
  m.multiply(GEOM.two, GEOM.deltaZ);
  m.abs();
  m.add(GEOM.scratch);
  const root = m.sqrt();
  m.storeAcc(GEOM.range);
  return root;
}

/** $1C3D-$1C88 - the subroutine form, reading its four coordinates out of the argument slots. */
export function rangeFromArgs(m) {
  return range(m, GEOM.aX, GEOM.aZ, GEOM.bX, GEOM.bZ);
}

/** $0C0F / $101F / $1429 - inline, a target against the ship's own position. */
export function rangeToTarget(m, targetX, targetZ) {
  return range(m, targetX, targetZ, GEOM.shipX, GEOM.shipZ);
}

/**
 * $0C5A-$0C71 - add one to the low byte of each delta, with no carry into the rest.
 *
 * It is a guard against the divide that follows, and a crude one. Zero becomes one, which is
 * the case it was written for, but $FF becomes $00 and takes the whole entry with it, so a
 * delta whose fraction is $FF divides by zero where an unnudged one would not have.
 */
function nudgeDeltas(m) {
  m.table[GEOM.deltaX] = (m.table[GEOM.deltaX] + 1) & 0xff;
  m.table[GEOM.deltaZ] = (m.table[GEOM.deltaZ] + 1) & 0xff;
}

/**
 * $0C87-$0D1E - put the bearing in the right quadrant.
 *
 * Four blocks of two signed compares each, and the shape is transliterated rather than
 * tidied into an else-if chain. Three reasons it has to be:
 *
 *   - The second block does **not** jump away afterwards. It falls into the third, whose
 *     tests then run and cannot fire, so the extra compares happen and leave their operands
 *     in ACC and B. An else-if would skip them and diverge in the registers.
 *   - Each test is `$99D2`, which loads ACC and B from the table before comparing, so the
 *     compares are not side-effect free even when their answer is discarded.
 *   - The first block's guards are `dx >= 0` and `dz >= 0`, so a delta of exactly zero takes
 *     the skip in blocks one and two but not in three and four. Zero is not a neutral case.
 *
 * `m.compare(x, y)` answers the original's `BPL`: non-negative means table[x] is not above
 * table[y], so `< 0` is the fall-through.
 */
export function foldQuadrant(m) {
  const { bearing, zero, deltaX, deltaZ, deg90, deg271 } = GEOM;

  // $0C87 - dx < 0 and dz < 0: the bearing is 90 degrees minus the angle.
  let skip = m.compare(zero, deltaX) >= 0;
  if (!skip) skip = m.compare(zero, deltaZ) >= 0;
  if (!skip) {
    m.sub(bearing, deg90);
    m.storeAcc(bearing);
    return;                                   // JMP $0D21
  }

  // $0CAF - dx < 0 and dz > 0: plus 90. No jump: it falls into the next block.
  skip = m.compare(zero, deltaX) >= 0;
  if (!skip) skip = m.compare(deltaZ, zero) >= 0;
  if (!skip) {
    m.addFrom(deg90, bearing);
    m.storeAcc(bearing);
  }

  // $0CD4 - dx > 0 and dz > 0: 271 degrees minus the angle.
  skip = m.compare(deltaX, zero) >= 0;
  if (!skip) skip = m.compare(deltaZ, zero) >= 0;
  if (!skip) {
    m.sub(bearing, deg271);
    m.storeAcc(bearing);
    return;                                   // JMP $0D21
  }

  // $0CFC - dx > 0 and dz < 0: plus 271.
  skip = m.compare(deltaX, zero) >= 0;
  if (!skip) skip = m.compare(zero, deltaZ) >= 0;
  if (!skip) {
    m.addFrom(deg271, bearing);
    m.storeAcc(bearing);
  }
}

/**
 * $0C5A-$0D1E - the bearing in whole degrees, of whatever the deltas in $0908 and $0909
 * describe, stopping where the original's own two jumps land.
 *
 * Reads the deltas the range left behind, nudges them, takes the arctangent of their ratio
 * and folds it into the right quadrant. The answer lands back in $090B.
 *
 * @param {import('./math.js').Math24} m
 * @returns {{inDomain: boolean}} the ratio divide's, false where EXT is not modelled
 */
export function bearingDegrees(m) {
  nudgeDeltas(m);
  // $0C72 - the ratio, scaled by 256, which is also how $9C04 wants it. The angle's sign
  // never survives: the arctangent carries it and $9A04 takes it straight off again, so the
  // quadrant comes entirely from the fold.
  const ratio = m.divide(GEOM.deltaX, GEOM.deltaZ);
  m.atanDegrees();
  m.abs();
  m.storeAcc(GEOM.bearing);
  foldQuadrant(m);
  return ratio;
}

/** $0C5A-$0D30 - the whole block: degrees, then rescaled to heading units at $0D21. */
export function bearing(m) {
  const ratio = bearingDegrees(m);
  // $0D21 - degrees into heading units, through the entry holding 359.
  const units = m.divide(GEOM.degreesPerUnit, GEOM.bearing);
  m.storeAcc(GEOM.bearing);
  return { inDomain: ratio.inDomain && units.inDomain };
}

/**
 * $0C0F-$0D30 - the pair, as the three big loop regions run them: range first, then the
 * bearing off the deltas it left in the table.
 */
export function rangeAndBearing(m, targetX, targetZ) {
  const r = rangeToTarget(m, targetX, targetZ);
  const b = bearing(m);
  return { inDomain: r.inDomain && b.inDomain };
}

/** The range as a world-unit quantity, for reading rather than for the port's own use. */
export function rangeUnits(m) {
  return m.read(GEOM.range) / 256;
}

/** The heading byte the caller at $0D63 reads: the bearing entry's middle byte. */
export function bearingHeading(m) {
  return m.table[(GEOM.bearing + 1) & 0xff];
}
