// Killing an enemy: the shot connects, three pieces of debris appear, and a new enemy spawns.
//
// Six blocks and nine small subroutines, and they are perfectly regular - two player shots
// against three enemy classes, each block four `JSR $9C4B`s to load $1C3D's argument slots,
// the range, a threshold, and then four calls:
//
//     $0EF3  LDX OBJ6.count / BEQ        is this shot up at all?
//     $0EF8  copy the shot and the enemy into $092B-$092E / JSR $1C3D
//     $0F1F  LDY $090A / LDX $092F / JSR $99D2 / BPL     range <= 11 units: a hit
//     $0F2A  STA $093E                   the debris counter, 4
//     $0F2F  JSR $1944                   put the debris where the enemy is
//     $0F32  JSR $1F67                   switch the shot off
//     $0F35  JSR $1A8B                   aim the debris along the shot's heading
//     $0F38  JSR $1AAC                   switch the enemy off
//
// **The debris is four objects and only three of them are ever drawn.** $1944 copies the
// enemy's published X and Z into objects 8, 9, 10, 11 and their scope twins 20, 21, 22, 23,
// and $1A8B copies the shot's heading into all eight. But the only code in the binary that
// writes a debris object's count is $1D09, and it writes three: 8/20, 9/21 and 10/22.
// **Nothing ever switches objects 11 and 23 on.** Their position and heading are maintained
// every kill and they are never seen. The port keeps that.
//
// **The debris is an animation driven by a counter**, one piece a pass. $1829 ticks each
// class's counter down and calls $1D09 with the value: 4 switches on the first piece, 3 the
// second, 2 the third, and **1 respawns the enemy**. Each piece gets a count of 1, so the
// renderer draws it once and switches it off again - a three-pass puff.
//
// **The respawn does an `ADC` with no `CLC` before it.** $1EAD adds the class's bump to the
// enemy's X high byte with whatever carry the caller left, so the bump is 10 or 11 for class 1
// and 20 or 21 for classes 2 and 3. Measured, both callers arrive with the carry **set**: the
// debris tick comes through $1D09's `CPY #$01`/`#$02`/`#$03` equality, and the reach block
// comes through `JSR $99D2`, and MATH's compare leaves the carry set. So in play the bump is
// always one more than the immediate says. The port takes the carry as an argument and both
// call sites pass it set, rather than hard-coding 11, so a control can show the difference.
//
// **Class 2's respawn cascades into class 3's.** $1ECC is `BEQ $1EFA`: with class 2's wave
// counter empty it does not return, it falls into class 3's respawn routine and spawns one of
// those instead. Class 1 and class 3 branch to a local `CLC`/`RTS`. Measured, not inferred.
//
// The respawn also puts the new enemy at Z high byte $96, which is 150 - and 150 * 256 is far
// outside the Z bounds the movement block wraps against, so a fresh enemy snaps to the Z edge
// on its first pass and flies in from there.
//
// Measured by oracle/probe_kill.mjs and held block-for-block by oracle/parity_kill.mjs. The
// sound this chain triggers - $1DD3 for a kill, $1F8E for a launch, both through the engine at
// $1D52 with its parameter block at $1D4A-$1D51 - is Phase 6 and is not ported; the functions
// that would call it say so and return.
import { VARS } from './tables.js';
import { field } from './objects.js';
import { GEOM, rangeFromArgs } from './geometry.js';
import { RAM_RANGE } from './entities.js';

/** A table index, by the directory address in $08F2-$0932 that holds it. */
const dir = (address) => VARS[address - 0x08F2];

/**
 * The player's two shots. Their position entries interleave rather than sitting three apart:
 * shot 1 is $0904 and $0906, shot 2 is $0905 and $0907.
 */
export const SHOTS = [
  {
    name: 'shot 1',
    object: 6,
    /** $1A8B's tail switches this off, not $1F67 - the pair is split across two routines. */
    twin: 18,
    pos: [dir(0x0904), dir(0x0906)],
    offAt: 0x1F67,
    aimAt: 0x1A8B,
    /** $1B2B - the publish, and $0B6A the movement. See weapon.js. */
    publishAt: 0x1B2B,
    moveAt: 0x0B6A,
    moveExit: 0x0BB7,
    /** The object whose Y $1B2B writes, which is NOT this shot's. See weapon.js. */
    publishedY: 4,
  },
  {
    name: 'shot 2',
    object: 7,
    twin: 19,
    pos: [dir(0x0905), dir(0x0907)],
    offAt: 0x1F6D,
    aimAt: 0x1AC7,
    publishAt: 0x1B60,
    moveAt: 0x0BB7,
    moveExit: 0x0C04,
    publishedY: 5,
  },
];

/** `LDA #$04` - what a hit puts in the class's debris counter. */
export const DEBRIS_FRAMES = 4;

/**
 * $1D09 - which debris pair each tick of the counter switches on, and the count it gets.
 *
 * Index 0 is the counter value 4. The fourth pair, objects 11 and 23, is not here because
 * nothing in the binary switches it on.
 */
export const DEBRIS = [[8, 20], [9, 21], [10, 22]];

/** The pair that is positioned and aimed every kill and never drawn. */
export const DEBRIS_UNUSED = [11, 23];

/** `LDX #$01` - a debris piece's count, so the renderer draws it once. */
export const DEBRIS_LIFETIME = 1;

/** `LDA #$96` - the Z high byte a respawned enemy gets. */
export const RESPAWN_Z = 0x96;

/** `LDX #$FF` - a respawned enemy's count: on, with no lifetime. */
export const ALWAYS_ON = 0xFF;

/** `CPX #$03` - the award fires while the debris counter is at least this. */
export const AWARD_AT = 3;

/** $1944 / $19B1 / $1A1E - put all eight debris objects where the enemy is. */
export function placeDebris(mem, c) {
  for (const name of ['x', 'z']) {
    for (const offset of [0, 1]) {
      const byte = mem[field(c.enemy, name) + offset];
      for (const [a, b] of [...DEBRIS, DEBRIS_UNUSED]) {
        mem[field(a, name) + offset] = byte;
        mem[field(b, name) + offset] = byte;
      }
    }
  }
}

/**
 * $1A8B / $1AC7 - aim all eight debris objects along the shot's heading, then switch the
 * shot's scope twin off.
 *
 * The twin's count is zeroed here and the main record's in $1F67, so switching a shot off
 * takes both routines. Nothing says why they are split; the port keeps the split because the
 * two are called separately and in that order.
 */
export function aimDebris(mem, shot) {
  const heading = mem[field(shot.object, 'heading')];
  for (const [a, b] of [...DEBRIS, DEBRIS_UNUSED]) {
    mem[field(a, 'heading')] = heading;
    mem[field(b, 'heading')] = heading;
  }
  mem[field(shot.twin, 'count')] = 0;
}

/** $1F67 / $1F6D - switch the shot's main record off. */
export function switchOffShot(mem, shot) {
  mem[field(shot.object, 'count')] = 0;
}

/** $1AAC / $1AB5 / $1ABE - switch the enemy and its scope twin off. */
export function switchOffEnemy(mem, c) {
  mem[field(c.enemy, 'count')] = 0;
  mem[field(c.twin, 'count')] = 0;
}

/**
 * $0EF3 / $0F3B and their four copies - has one of the player's shots reached this enemy?
 *
 * Gated on the shot being up. The range goes through $1C3D's argument slots, so this
 * overwrites $092B-$092E and $090A exactly as the enemy missile's hit test does, and against
 * the same threshold the enemy uses to ram the ship.
 *
 * @param {Uint8Array} mem a 64K image: the display list and the binary's state
 * @param {import('./math.js').Math24} math
 * @param {object} shot one of SHOTS
 * @param {object} c one of CLASSES
 * @returns {{up: boolean, hit?: boolean}}
 */
export function shotHit(mem, math, shot, c) {
  if (mem[field(shot.object, 'count')] === 0) return { up: false };

  // $0EF8 - the shot as the first point, the enemy as the second.
  math.copy(shot.pos[0], GEOM.aX);
  math.copy(c.enemyPos[0], GEOM.bX);
  math.copy(shot.pos[1], GEOM.aZ);
  math.copy(c.enemyPos[1], GEOM.bZ);
  rangeFromArgs(math);

  // $0F1F - `LDY $090A / LDX $092F / JSR $99D2 / BPL`, so the threshold is the X operand and
  // the range is the Y one, and `BPL` skips the kill. `BPL` is taken on zero, so **the range
  // has to be strictly inside the threshold**: a shot exactly at the threshold does not kill.
  //
  // This is NOT the comparison `reach` uses, which is what this comment used to say. `$0E05`
  // loads the same two variables the other way round *and* branches the other way, so the ram
  // includes the boundary and this does not. Written with reach's operand order, the two agree
  // everywhere except exactly on it, which is why 114 cases could not tell them apart;
  // `parity_kill.mjs` now stands one there.
  if (math.compare(RAM_RANGE, GEOM.range) >= 0) return { up: true, hit: false };

  mem[c.debrisCounter] = DEBRIS_FRAMES;
  placeDebris(mem, c);
  switchOffShot(mem, shot);
  aimDebris(mem, shot);
  switchOffEnemy(mem, c);
  return { up: true, hit: true };
}

/**
 * $1E98 / $1EC9 / $1EFA - put a fresh enemy of this class into the world, if the wave has one
 * left.
 *
 * @param {boolean} carry the carry the caller left, which the uncarried `ADC` picks up. Both
 *   real callers leave it set; `false` is what the immediate operand alone would give.
 * @param {object[]} classes the class table, so class 2 can cascade into class 3
 * @returns {{spawned: false} | {spawned: true, into: object}}
 */
export function respawn(mem, math, c, carry, classes) {
  // $1E98 - nothing left in the wave.
  if (mem[c.wave] === 0) {
    // $1ECC - class 2 does not return here, it branches into class 3's routine.
    if (c.cascadeTo !== null) {
      return respawn(mem, math, classes[c.cascadeTo], carry, classes);
    }
    return { spawned: false };
  }
  mem[c.wave] = (mem[c.wave] - 1) & 0xff;
  mem[field(c.enemy, 'count')] = ALWAYS_ON;
  mem[field(c.twin, 'count')] = ALWAYS_ON;

  // $1EAD - `ADC $9802,Y` with no CLC: the bump, the high byte, and the caller's carry.
  const high = (c.bump + math.table[(c.enemyPos[0] + 2) & 0xff] + (carry ? 1 : 0)) & 0xff;
  math.table[(c.enemyPos[0] + 2) & 0xff] = high;
  mem[field(c.enemy, 'x') + 1] = high;
  mem[field(c.twin, 'x') + 1] = high;

  // $1EB9 - and a fixed Z high byte, which is outside the Z bounds the wrap uses.
  math.table[(c.enemyPos[1] + 2) & 0xff] = RESPAWN_Z;
  mem[field(c.enemy, 'z') + 1] = RESPAWN_Z;
  mem[field(c.twin, 'z') + 1] = RESPAWN_Z;
  return { spawned: true, into: c };
}

/**
 * $1D09 - one tick of the debris animation, by the counter's value.
 *
 * Reached only from $1829, which has already checked the counter is non-zero. The carry it
 * arrives with is set, because $1D09's own `CPX`/`CPY` comparisons set it on the way in: the
 * three `CPX` tests fail by being below, which clears it, and then whichever `CPY` succeeds
 * sets it. So the respawn below always gets a set carry in play.
 */
export function debrisStage(mem, math, c, counter, classes) {
  // $1D09 - three `CPX`/`BEQ` pairs, on EQUALITY, not on a range. So a counter above 4 matches
  // none of them and falls straight through to the respawn, and so does 1 and 0. The counter
  // is only ever set to 4 and decremented, so nothing in play is above it - but the port
  // reproduces the test as written, and parity_kill.mjs caught the first version of this
  // function reading `>= 4` and respawning nothing at a counter of 5.
  for (const [stage, want] of [[0, 4], [1, 3], [2, 2]]) {
    if (counter !== want) continue;
    const [a, b] = DEBRIS[stage];
    mem[field(a, 'count')] = DEBRIS_LIFETIME;
    mem[field(b, 'count')] = DEBRIS_LIFETIME;
    return { stage };
  }
  // $1D15 - anything else falls through to the class dispatch, which is the respawn.
  return { stage: 'respawn', ...respawn(mem, math, c, true, classes) };
}

/**
 * $1829 / $1837 / $1844 - run the debris counter down by one, animating as it goes.
 *
 * @returns {object|null} what the tick did, or null if there was no debris to animate
 */
export function debrisTick(mem, math, c, classes) {
  if (mem[c.debrisCounter] === 0) return null;
  const out = debrisStage(mem, math, c, mem[c.debrisCounter], classes);
  mem[c.debrisCounter] = (mem[c.debrisCounter] - 1) & 0xff;
  return out;
}

/**
 * $1895 / $18A2 / $18AF - score the kill, while the debris counter is still high.
 *
 * `CPX #$03 / BCC` fires on 4 and 3, and the tick above runs earlier in the pass and has
 * already decremented - so across one kill the counter is 3 when this first sees it and 2 the
 * pass after, and the score goes up exactly once. The order of the two blocks is what makes
 * that true, and probe_kill.mjs traces the pass to establish it rather than reading it off the
 * addresses.
 *
 * @returns {{awarded: boolean, sound?: number}} $1DD3 is the sound, which is not ported
 */
export function award(mem, c) {
  if (mem[c.debrisCounter] < AWARD_AT) return { awarded: false };
  mem[c.score] = (mem[c.score] + 1) & 0xff;
  return { awarded: true, sound: 0x1DD3 };
}
