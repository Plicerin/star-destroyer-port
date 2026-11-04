// The enemies move, their missiles fly, and the loop asks twice whether anything has arrived.
//
// Four blocks per enemy class, and together with the dispatch they are the whole of the three
// big enemy regions bar the explosion routines and the player's own shots:
//
//     $0E05  reach      range <= 11 units: the enemy has rammed the ship
//     $0E2F  hold       range < 25 units: the enemy stops moving and holds station
//     $0E3D  move       step along its heading, wrap at the world's edge, publish
//     $0F83  missile    step by the precomputed step, publish, range to the ship, hit test
//
// with the copies at $120F/$1239/$1247/$138D for class 2 and $1619/$1643/$1652/$1798 for
// class 3.
//
// **The enemy's movement is the ship's movement with different indices.** $0E3D is $09D1
// without the warp gate: the same `JSR $1AE8`, the same divide-add-store per axis over the
// same throttle entry, and the same four compare-and-copy pairs against the same four bound
// entries. probe_entities.mjs checks that the ship's wrap and the three enemies' wraps are
// one instruction stream, which is why `wrapPosition` is shared with flight.js rather than
// written out again here.
//
// So **an enemy moves at the ship's warp speed**, always, because it divides by the same entry
// the throttle uses - and the ship only moves that fast with warp engaged. An enemy under
// warp is matched; an enemy against an unwarped ship closes.
//
// **The missile does not wrap and does not call $1AE8.** Its step was worked out once at
// launch and stored, so its flight is two adds, a publish, and a range. It also has no
// lifetime of its own in this code: nothing in the binary decrements an object's count. The
// renderer does, at $6D18, once per time it draws that object - so the 20 the dispatch writes
// is twenty renders, and the missile's expiry is the renderer's business, not the loop's.
//
// **The missile's hit test overwrites the range.** It copies its own position and the ship's
// into $1C3D's four argument slots and calls it, which leaves a new range in $090A on top of
// the one the dispatch region computed. Nothing reads the old one by then, but the order is
// not interchangeable.
//
// **Three thresholds, and they are not all the same comparison.** `reach` fires on
// `range <= 11`; `hold` and the missile's hit test fire on `range < 25` and `range < 13`. The
// difference is which way round the compare's operands are loaded, and it shows at exact
// equality. Remember too that the range is `sqrt(2 * (|dx| + |dz|))`, so 11 units of range is
// an L1 separation of about 60 and 25 units is about 312.
//
// What the two arrivals do beyond this port: `reach` sets $0942, which $18BC reads to call the
// shield damage at $1C99, and the missile sets $0941, which $18C9 reads to call $1CFC. Both
// also switch the entity off and - for `reach` - call an explosion routine, $1E98, $1EC9 or
// $1EFA, which is not ported. `reach` returns the address so a caller can see which.
//
// Measured by oracle/probe_entities.mjs and held block-for-block by
// oracle/parity_entities.mjs.
import { VARS, VAR } from './tables.js';
import { buildStepOperands, wrapPosition } from './flight.js';
import { field } from './objects.js';
import { GEOM, rangeFromArgs } from './geometry.js';

/** A table index, by the directory address in $08F2-$0932 that holds it. */
const dir = (address) => VARS[address - 0x08F2];

/** $092F - an enemy at or inside this range has rammed the ship. Holds 11 units. */
export const RAM_RANGE = dir(0x092F);

/** $0926 - an enemy inside this range stops moving. Holds 25 units. */
export const HOLD_RANGE = dir(0x0926);

/** $0932 - a missile inside this range has hit the ship. Holds 13 units. */
export const HIT_RANGE = dir(0x0932);

/** $0942 - set when an enemy reaches the ship. $18BC reads it and damages the shields. */
export const RAMMED = 0x0942;

/** $0941 - set when an enemy missile reaches the ship. $18C9 reads it. */
export const HIT = 0x0941;

/** $0949 - where $1AE8 reads the heading from. */
export const SAVED_HEADING = 0x0949;

/**
 * $0EC9 / $0FAB - publish a position's top two bytes into an object pair's operand.
 *
 * The position is 24-bit and the coordinate the renderer sees is `$9801,Y` and `$9802,Y` - the
 * middle and high bytes - so the lowest byte is a fraction the display never sees. That is
 * what lets an entity move a fraction of a unit a pass and still hand the renderer whole
 * numbers. The low byte is not published and the Y operand is not touched at all.
 */
function publish(mem, math, index, objects, name) {
  for (const [k, offset] of [[1, 0], [2, 1]]) {
    const byte = math.table[(index + k) & 0xff];
    for (const o of objects) mem[field(o, name) + offset] = byte;
  }
}

/**
 * $0E05-$0E22 - has the enemy reached the ship?
 *
 * `BPL` is taken when the threshold is not below the range, so this fires on
 * `range <= threshold` - the only one of the three tests that includes equality.
 *
 * @returns {{rammed: boolean, explode?: number}} the explosion routine's address, which this
 *   port does not provide
 */
export function reach(mem, math, c) {
  if (math.compare(GEOM.range, RAM_RANGE) < 0) return { rammed: false };
  mem[RAMMED] = 1;
  mem[field(c.enemy, 'count')] = 0;
  mem[field(c.twin, 'count')] = 0;
  return { rammed: true, explode: c.explode };     // JSR $1E98 / $1EC9 / $1EFA
}

/**
 * $0E2F-$0E3C - is the enemy close enough to stop moving?
 *
 * The operands are loaded the other way round from `reach`, so `BPL` is taken when the
 * threshold is not above the range and this fires on `range < threshold`.
 *
 * @returns {boolean} true if the enemy holds station and the movement block is skipped
 */
export function hold(math) {
  return math.compare(HOLD_RANGE, GEOM.range) < 0;
}

/**
 * $0E3D-$0EF2 - the enemy's own movement.
 *
 * The ship's movement block with the enemy's position entries and no warp gate: save the
 * heading, build the step operands from it, divide each by the throttle entry and add it to
 * the position, wrap, publish. Only X and Z - an enemy's Y is set when it spawns and this
 * never touches it.
 */
export function move(mem, math, c) {
  // $0E3D - $1AE8 reads the heading out of $0949, so it goes there first.
  const heading = mem[field(c.enemy, 'heading')];
  mem[SAVED_HEADING] = heading;
  buildStepOperands(math, heading);

  // $0E46 - three MATH instructions an axis, with the accumulator carrying the value.
  for (const [step, pos] of [[VAR.stepX, c.enemyPos[0]], [VAR.stepZ, c.enemyPos[1]]]) {
    math.divide(VAR.speed, step);
    math.add(pos);
    math.storeAcc(pos);
  }

  // $0E70 - the same four pairs the ship wraps with, over the same four bounds.
  wrapPosition(math, c.enemyPos[0], c.enemyPos[1]);

  // $0EC9 - into the main view's record and the scope's together.
  publish(mem, math, c.enemyPos[0], [c.enemy, c.twin], 'x');
  publish(mem, math, c.enemyPos[1], [c.enemy, c.twin], 'z');
}

/**
 * $0F83-$1013 - one pass of an enemy missile's flight.
 *
 * Gated on the missile's count, which is the renderer's frame counter: zero means it is not
 * up and the whole block is skipped.
 *
 * @returns {{flying: boolean, hit?: boolean}}
 */
export function missile(mem, math, c) {
  // $0F83 - `LDA count / CMP #$00 / BNE`, which is the same as a BEQ on the load.
  if (mem[field(c.missile, 'count')] === 0) return { flying: false };

  // $0F8D - position += step, for each axis. The step was computed once, at launch.
  for (const [step, pos] of [[c.missileStep[0], c.missilePos[0]],
    [c.missileStep[1], c.missilePos[1]]]) {
    math.addFrom(step, pos);
    math.storeAcc(pos);
  }

  // $0FAB - publish to the missile and its scope twin.
  publish(mem, math, c.missilePos[0], [c.missile, c.missileTwin], 'x');
  publish(mem, math, c.missilePos[1], [c.missile, c.missileTwin], 'z');

  // $0FD5 - the range from the missile to the ship, through $1C3D's argument slots. This
  // leaves a new range in $090A, on top of the one the dispatch region worked out.
  math.copy(c.missilePos[0], GEOM.aX);
  math.copy(VAR.posX, GEOM.bX);
  math.copy(c.missilePos[1], GEOM.aZ);
  math.copy(VAR.posZ, GEOM.bZ);
  rangeFromArgs(math);

  // $0FFC - and the hit test, which fires on range < threshold.
  if (math.compare(HIT_RANGE, GEOM.range) >= 0) return { flying: true, hit: false };
  mem[HIT] = 1;
  // Class 3 zeroes the twin's count first and the missile's second; the other two the other
  // way round. Nothing can tell, so the order is not reproduced.
  mem[field(c.missile, 'count')] = 0;
  mem[field(c.missileTwin, 'count')] = 0;
  return { flying: true, hit: true };
}
