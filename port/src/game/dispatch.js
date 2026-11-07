// What an enemy does with a range and a bearing: turn toward it, and fire when it lines up.
//
// This is the block that follows each inline range-and-bearing - $0D5B, $116B and $1575, one
// per enemy class - plus the four instructions at $0E23, $122D and $1637 that run the
// cooldown down again. Everything else in the three regions is still unported: the collision
// test above each cooldown ($0E05, $120F, $1619) and the enemy's own movement below it.
//
// The whole of it, in the original's own order:
//
//     $0D5B  LDX $0938 / BEQ          the cooldown: while it runs, do not even look
//     $0D63  LDY $090B / LDA OBJ1.heading / CMP $9801,Y / BEQ   aligned -> fire
//     $0D6E  INC OBJ1.heading / CMP again / BEQ                 aligned now -> fire
//     $0D79  BCS                                                past it -> turn down
//     $0D7B  DEC / $0D7E INC INC / STA OBJ13.heading            short of it -> turn up
//     $0D90  DEC DEC DEC / STA OBJ13.heading                    turn down
//     $0DA5  LDX OBJ4.count / BEQ                               one missile at a time
//     $0DAD  launch
//
// **The turn is a probe, not a comparison.** It increments the heading, *writes it*, and
// compares again - so the enemy that fires on the second test fires from the incremented
// heading and keeps it. Only if neither test hits does it decide a direction, and then from
// the already-incremented value: `BCS` goes to three decrements, which is two below where it
// started, and the other path decrements once to undo the probe and then adds two. So the
// enemy turns in steps of two, and the step it has just taken is visible in the display list
// either way.
//
// **The cooldown entry is a label, not a signed turn**, and that is why this is
// transliterated rather than written as `turn(by)`. Class 1's `BEQ` falls into the increment
// path and classes 2 and 3 jump to the decrement path - and neither entry has had the probing
// increment applied, so the same code gives +2 for class 1 and -3 for the other two, where
// the probe's own paths give +2 and -2. Measured: a cooling class 1 at heading 50 comes out
// at 52, a cooling class 2 at 47.
//
// **Three more things differ between the copies**, all measured rather than assumed:
//
//   - **Class 3's cooldown is 15**, classes 1 and 2 are 20.
//   - **Classes 2 and 3 share one missile**, object 5 and its twin 17, and share its position
//     and step entries. Either firing blocks the other; class 1 has object 4 to itself.
//   - **Class 3's launch-sound flag gets the heading instead of 1.** `$15C9` is
//     `LDX #$01` followed by `STA $0945` where the other two have `STX`, so the `LDX` is dead
//     and the flag takes whatever is in the accumulator - which, arriving by `BEQ` from the
//     compare, is the enemy's heading. The flag is only tested for non-zero at $186E, so the
//     typo is invisible except at heading 0, where class 3 launches silently.
//
// The launch itself copies the enemy's position into the missile's entries, saves the heading
// into $0949, calls $1AE8 to turn it into step components, divides each by the missile's own
// speed entry - 383, against the ship's 1280, so a missile is more than three times faster -
// and parks the missile ten units below the plane.
//
// Measured by oracle/probe_dispatch.mjs and held block-for-block by
// oracle/parity_dispatch.mjs.
import { VARS, VAR } from './tables.js';
import { buildStepOperands } from './flight.js';
import { field } from './objects.js';

/** A table index, by the directory address in $08F2-$0932 that holds it. */
const dir = (address) => VARS[address - 0x08F2];

/** $090B - the bearing entry. The heading byte is its MIDDLE byte: `CMP $9801,Y`. */
export const BEARING = dir(0x090B);

/** $0919 - the missile's speed divisor. Holds 383 where the ship's holds 1280. */
export const MISSILE_SPEED = dir(0x0919);

/** $0949 - where $1AE8 reads the heading from. */
export const SAVED_HEADING = 0x0949;

/** `LDX #$14` - the lifetime written into a missile's count, the same for all three classes. */
export const MISSILE_LIFETIME = 0x14;

/** `LDA #$F6 / LDA #$FF` - the missile's Y, ten units below the plane. */
export const MISSILE_Y = -10;

/**
 * The three enemy classes, as parameters.
 *
 * `coolingTurn` names which of the two turn labels the cooldown branch jumps to, because that
 * is what the original does - `BEQ`/`JMP` to a label, not a turn by an amount.
 *
 * The addresses are carried along because they are the port's provenance and the harnesses
 * drive the blocks by them: `at` and `exit` bracket the dispatch, `coolDownAt` the four
 * instructions that run the cooldown down, and `reachAt`, `holdAt`, `moveAt` and `missileAt`
 * the four blocks in entities.js. The rest - `shotAt`, `tickAt`, `awardAt`, `respawnAt`,
 * `debrisPlace`, `enemyOff` - belong to kill.js, and `wave`, `bump`, `score`,
 * `debrisCounter` and `cascadeTo` are the parameters those blocks differ in.
 */
export const CLASSES = [
  {
    name: 'class 1',
    at: 0x0D5B,
    exit: 0x0E05,
    enemy: 1,
    twin: 13,
    missile: 4,
    missileTwin: 16,
    /** $0938 */ cooldown: 0x0938,
    cooldownFrames: 0x14,
    /** $0943 */ launchSound: 0x0943,
    soundStoresHeading: false,
    coolingTurn: 'up',
    /** $090D, $090F */ enemyPos: [dir(0x090D), dir(0x090F)],
    /** $0911, $0913 */ missilePos: [dir(0x0911), dir(0x0913)],
    /** $0927, $0929 */ missileStep: [dir(0x0927), dir(0x0929)],
    coolDownAt: 0x0E23,
    reachAt: 0x0E05, reachExits: [0x0E20, 0x0E23],
    holdAt: 0x0E2F, holdExits: [0x0E3D, 0x0EF3],
    moveAt: 0x0E3D, moveExit: 0x0EF3,
    missileAt: 0x0F83, missileExit: 0x1014,
    explode: 0x1E98,
    debrisPlace: 0x1944, enemyOff: 0x1AAC,
    shotAt: [0x0EF3, 0x0F3B],
    debrisCounter: 0x093E, tickAt: 0x1829, tickExit: 0x1837,
    score: 0x1FFC, awardAt: 0x1895,
    wave: 0x1FF9, bump: 10, respawnAt: 0x1E98, cascadeTo: null,
  },
  {
    name: 'class 2',
    at: 0x116B,
    exit: 0x120F,
    enemy: 2,
    twin: 14,
    missile: 5,
    missileTwin: 17,
    /** $0939 */ cooldown: 0x0939,
    cooldownFrames: 0x14,
    /** $0944 */ launchSound: 0x0944,
    soundStoresHeading: false,
    coolingTurn: 'down',
    /** $090E, $0910 */ enemyPos: [dir(0x090E), dir(0x0910)],
    /** $0912, $0914 */ missilePos: [dir(0x0912), dir(0x0914)],
    /** $0928, $092A */ missileStep: [dir(0x0928), dir(0x092A)],
    coolDownAt: 0x122D,
    reachAt: 0x120F, reachExits: [0x122A, 0x122D],
    holdAt: 0x1239, holdExits: [0x1247, 0x12FD],
    moveAt: 0x1247, moveExit: 0x12FD,
    missileAt: 0x138D, missileExit: 0x141E,
    explode: 0x1EC9,
    debrisPlace: 0x19B1, enemyOff: 0x1AB5,
    shotAt: [0x12FD, 0x1345],
    debrisCounter: 0x093F, tickAt: 0x1837, tickExit: 0x1844,
    score: 0x1FFD, awardAt: 0x18A2,
    wave: 0x1FFA, bump: 20, respawnAt: 0x1EC9, cascadeTo: 2,
  },
  {
    name: 'class 3',
    at: 0x1575,
    exit: 0x1619,
    enemy: 3,
    twin: 15,
    missile: 5,
    missileTwin: 17,
    /** $093A */ cooldown: 0x093A,
    cooldownFrames: 0x0F,
    /** $0945 */ launchSound: 0x0945,
    soundStoresHeading: true,
    coolingTurn: 'down',
    /** $0930, $0931 */ enemyPos: [dir(0x0930), dir(0x0931)],
    /** $0912, $0914 */ missilePos: [dir(0x0912), dir(0x0914)],
    /** $0928, $092A */ missileStep: [dir(0x0928), dir(0x092A)],
    coolDownAt: 0x1637,
    reachAt: 0x1619, reachExits: [0x1634, 0x1637],
    holdAt: 0x1643, holdExits: [0x1652, 0x1708],
    moveAt: 0x1652, moveExit: 0x1708,
    missileAt: 0x1798, missileExit: 0x1829,
    explode: 0x1EFA,
    debrisPlace: 0x1A1E, enemyOff: 0x1ABE,
    shotAt: [0x1708, 0x1750],
    debrisCounter: 0x0940, tickAt: 0x1844, tickExit: 0x1851,
    score: 0x1FFE, awardAt: 0x18AF,
    wave: 0x1FFB, bump: 20, respawnAt: 0x1EFA, cascadeTo: null,
  },
];

/**
 * $0D7E / $118E / $1598 - two increments, then publish to the twin.
 *
 * Class 1 has a redundant `LDA OBJ1.heading / STA OBJ1.heading` in the middle that the other
 * two copies leave out. It is a no-op and is not reproduced; nothing can tell.
 */
export function turnUp(mem, c) {
  const h = field(c.enemy, 'heading');
  mem[h] = (mem[h] + 1) & 0xff;
  mem[h] = (mem[h] + 1) & 0xff;
  mem[field(c.twin, 'heading')] = mem[h];
  return { action: 'turn', direction: 'up' };
}

/** $0D90 / $119D / $15A7 - three decrements, then publish to the twin. */
export function turnDown(mem, c) {
  const h = field(c.enemy, 'heading');
  for (let k = 0; k < 3; k++) mem[h] = (mem[h] - 1) & 0xff;
  mem[field(c.twin, 'heading')] = mem[h];
  return { action: 'turn', direction: 'down' };
}

/**
 * $0DA5-$0E04 - launch a missile, if the one this class uses is not already up.
 *
 * The finale's base star fires with this same block, so two things that are constants of the
 * main mission are arguments here: `heading` is the heading the shot leaves on, which the
 * finale takes from the candidate that matched rather than from the enemy's own record, and
 * `c.alsoCool` is a second cooldown it writes and the main mission has no counterpart for.
 *
 * @param {Uint8Array} mem a 64K image: the display list and the binary's own state
 * @param {import('./math.js').Math24} math
 * @param {object} c the class
 * @param {number} heading the heading to launch on
 */
export function fire(mem, math, c, heading = mem[field(c.enemy, 'heading')]) {
  // $0DA5 - one at a time. Classes 2 and 3 test the same count, because they share object 5.
  if (mem[field(c.missile, 'count')] !== 0) return { action: 'busy' };

  // $0DAD - the missile and its scope twin come on for twenty frames.
  mem[field(c.missile, 'count')] = MISSILE_LIFETIME;
  mem[field(c.missileTwin, 'count')] = MISSILE_LIFETIME;

  // $0DB5 - the launch sound's flag, read and cleared at $186E. Class 3 stores the
  // accumulator here rather than the 1 it just loaded into X; see the header.
  mem[c.launchSound] = c.soundStoresHeading ? heading : 1;

  // $0DBA - and the enemy will not fire again until this has counted down.
  mem[c.cooldown] = c.cooldownFrames;

  // $0DE0 - the base star also drops the page toggle into class 2's cooldown, which is a
  // coupling the main mission has nothing like. Whatever it is for, it is what the code does.
  if (c.alsoCool) mem[c.alsoCool.at] = mem[c.alsoCool.from];

  // $0DBF - the missile starts where the enemy is.
  math.copy(c.enemyPos[0], c.missilePos[0]);
  math.copy(c.enemyPos[1], c.missilePos[1]);

  // $0DD1 - and flies on the heading, which $1AE8 reads out of $0949.
  mem[SAVED_HEADING] = heading;
  mem[field(c.missile, 'heading')] = heading;
  buildStepOperands(math, heading);

  // $0DDD - each component over the missile's own speed, into the missile's step entries.
  math.divide(MISSILE_SPEED, VAR.stepX);
  math.storeAcc(c.missileStep[0]);
  math.divide(MISSILE_SPEED, VAR.stepZ);
  math.storeAcc(c.missileStep[1]);

  // $0DFB - ten units below the plane, so it draws under the horizon rather than on it.
  mem[field(c.missile, 'y')] = MISSILE_Y & 0xff;
  mem[field(c.missile, 'y') + 1] = (MISSILE_Y >> 8) & 0xff;

  return { action: 'fire', heading };
}

/**
 * $0D5B-$0E04 / $116B-$120E / $1575-$1618 - the whole dispatch for one class.
 *
 * Call it with the bearing the range-and-bearing block has just left in $090B. The region
 * above it has already decided the class has at least one object alive.
 *
 * @param {Uint8Array} mem a 64K image: the display list at $80FB and the state at $0900
 * @param {import('./math.js').Math24} math
 * @param {object} c one of CLASSES
 */
export function dispatch(mem, math, c) {
  // $0D5B - while the cooldown runs the enemy does not look at the bearing at all. The two
  // entries land on different labels, which is the whole reason this is not `turn(by)`.
  if (mem[c.cooldown] !== 0) {
    const r = c.coolingTurn === 'up' ? turnUp(mem, c) : turnDown(mem, c);
    return { ...r, action: 'cooling' };
  }

  // $0D63 - the heading the fold produced, as the middle byte of the bearing entry.
  const target = math.table[(BEARING + 1) & 0xff];
  const h = field(c.enemy, 'heading');
  if (mem[h] === target) return fire(mem, math, c);

  // $0D6E - probe one unit along. The increment is written whatever happens next.
  mem[h] = (mem[h] + 1) & 0xff;
  if (mem[h] === target) return fire(mem, math, c);

  // $0D79 - BCS, unsigned, and equality has already gone: strictly past the bearing.
  if (mem[h] > target) return turnDown(mem, c);

  // $0D7B - undo the probe, then turn the other way.
  mem[h] = (mem[h] - 1) & 0xff;
  return turnUp(mem, c);
}

/**
 * $0E23 / $122D / $1637 - run the cooldown down by one, if it is running.
 *
 * Four instructions, and they sit in the next region rather than in the dispatch - after the
 * collision test and before the enemy's own movement - but the dispatch's cooldown means
 * nothing without them, so they are ported here and the rest of that region is not.
 *
 * @returns {boolean} true if it decremented, which is the branch the original takes
 */
export function coolDown(mem, c) {
  if (mem[c.cooldown] === 0) return false;
  mem[c.cooldown] = (mem[c.cooldown] - 1) & 0xff;
  return true;
}
