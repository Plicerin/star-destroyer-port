// The player's weapon: two shots, one button, and a missile bar that only one of them spends.
//
// Four blocks, all in the stretch between the throttle and the first enemy region:
//
//     $0ADB  LDA BUTTON0 / BMI            not pressed: nothing to do
//     $0AE3  LDX MSL / CPX #$C7           none left: play $1FB2 and stop
//     $0AF0  the two slots, and which one gets to fire
//     $0B6A  slot 1 moves
//     $0BB7  slot 2 moves
//     $1B2B  the publish, and $1B60 slot 2's
//
// **Two slots, and firing one depends on the state of the other.** A slot can fire only if it
// is empty AND the other slot's count has fallen below 11. The counts start at 20 and the
// renderer takes one off per draw, so that is a rate limit expressed through the other barrel:
// hold the button and the two alternate, nine or so passes apart.
//
// **Only slot 1 spends a missile.** $0B26 takes one unit off the MSL bar; the $0B34 path that
// fires slot 2 never touches it. Measured: firing slot 1 moves MSL from 244 to 243 and firing
// slot 2 leaves it alone. So half the shots are free.
//
// **And the cost is one unit, not four, by entering the damage routine's loop one byte in.**
// `LDX MSL / LDY #$04 / JSR $1C8B` jumps past $1C89's own `LDY #$01` with Y already at 4, so
// the `CPY #$04` fires after the first `DEX` and the loop stops having decremented once. The
// same four instructions that take four off the shield take one off the missile bar, and the
// difference is the entry point. The port does not reuse `shrink` for it, because what the
// original reuses is a loop body and what the port would be reusing is a function with a
// different contract - so it is written as the single decrement it is, with this note.
//
// **The publish writes the wrong object's Y.** $1B2B puts slot 1's X and Z into objects 6 and
// 18, and then writes $FFF0 to **OBJ4.y** - class 1's missile - rather than to OBJ6.y. $1B60
// does the same to OBJ5.y. Measured directly: $1B2B changes $815B, which is OBJ4.y, and never
// touches $8175, which is OBJ6.y. So a player shot never gets a Y of its own, and publishing
// one drags the enemy missile's Y from the -10 the dispatch gave it to -16. The port keeps it.
//
// Measured by oracle/probe_weapon.mjs and held block-for-block by oracle/parity_weapon.mjs.
import { VARS, VAR } from './tables.js';
import { field } from './objects.js';
import { buildStepOperands } from './flight.js';
import { SHOTS } from './kill.js';
import { MSL, EMPTY, SOUND, shrink } from './damage.js';
import { SAVED_HEADING } from './entities.js';
import { H1 } from './controls.js';

export { SHOTS };

/** A table index, by the directory address in $08F2-$0932 that holds it. */
const dir = (address) => VARS[address - 0x08F2];

/** $0918 - the shot's speed divisor, as the throttle entry is the ship's. */
export const SHOT_SPEED = dir(0x0918);

/** `LDX #$14` - the count a fired shot gets, which the renderer then runs down. */
export const SHOT_LIFETIME = 0x14;

/** `CPX #$0B` - the other slot's count has to be below this before this one may fire. */
export const RELOAD = 0x0B;

/**
 * `$0B29 LDY #$04` - where the trigger enters `shrink`'s loop, which is what makes the cost
 * one unit rather than four. The finale's copy of this block loads 3 and so takes two.
 */
export const MISSILE_ENTRY = 4;

/** `LDA #$F0 / LDA #$FF` - the Y the publish writes, to the wrong object. */
export const PUBLISHED_Y = -16;

/** $094B - the firing sound's flag, read and cleared at $1861 in the loop's tail. */
export const FIRED = 0x094B;

/**
 * $1B2B / $1B60 - publish a shot's position, and write $FFF0 to somebody else's Y.
 *
 * The X operands go out first, then the stray Y, then the Z operands - in that order, because
 * that is the order the original has them in and the Y write sits between the two halves.
 */
export function publishShot(mem, math, shot) {
  for (const offset of [0, 1]) {
    const byte = math.table[(shot.pos[0] + 1 + offset) & 0xff];
    mem[field(shot.object, 'x') + offset] = byte;
    mem[field(shot.twin, 'x') + offset] = byte;
  }
  // $1B40 - the enemy missile's Y, not this shot's. See the header.
  mem[field(shot.publishedY, 'y')] = PUBLISHED_Y & 0xff;
  mem[field(shot.publishedY, 'y') + 1] = (PUBLISHED_Y >> 8) & 0xff;
  for (const offset of [0, 1]) {
    const byte = math.table[(shot.pos[1] + 1 + offset) & 0xff];
    mem[field(shot.object, 'z') + offset] = byte;
    mem[field(shot.twin, 'z') + offset] = byte;
  }
}

/** $0AFE / $0B42 - put a shot into the world at the ship's position, on the ship's heading. */
function launch(mem, math, shot) {
  mem[FIRED] = 1;
  mem[field(shot.twin, 'count')] = SHOT_LIFETIME;
  mem[field(shot.object, 'count')] = SHOT_LIFETIME;
  math.copy(VAR.posX, shot.pos[0]);
  math.copy(VAR.posZ, shot.pos[1]);
  publishShot(mem, math, shot);
  mem[field(shot.object, 'heading')] = mem[H1];
}

/**
 * $0ADB-$0B69 - fire, if the button is down and anything can go.
 *
 * @param {Uint8Array} mem a 64K image: the display list and the binary's state
 * @param {import('./math.js').Math24} math
 * @param {boolean} button BUTTON0, $C061, read as its sign bit
 * @returns {{fired: object|null, sound?: number}} the slot that went, and the sound asked for
 */
export function fire(mem, math, button, { cost = MISSILE_ENTRY } = {}) {
  // $0ADB - `LDA BUTTON0 / BMI`, so it is the high bit that counts.
  if (!button) return { fired: null };

  // $0AE3 - out of missiles: the empty buzz, and nothing fires. Note this is the ONLY thing
  // that looks at the bar, so slot 2 firing for free does not get checked against it either.
  if (mem[MSL] === EMPTY) return { fired: null, sound: SOUND.outOfMissiles };

  // $0AF0 - slot 1, if it is free and slot 2 has cooled below 11.
  if (mem[field(SHOTS[0].object, 'count')] < 1) {
    if (mem[field(SHOTS[1].object, 'count')] >= RELOAD) return { fired: null };
    launch(mem, math, SHOTS[0]);
    // $0B26 - `LDX MSL / LDY #$04 / JSR $1C8B`, which is `shrink`'s loop entered at the point
    // where one decrement is all it does. The finale's copy of this block enters with Y at 3
    // and takes two off, so the entry point is a parameter and the loop is what is shared.
    mem[MSL] = shrink(mem[MSL], cost).value;
    return { fired: SHOTS[0], spent: true };
  }

  // $0B34 - otherwise slot 2, on the same terms, and for nothing.
  if (mem[field(SHOTS[1].object, 'count')] >= 1) return { fired: null };
  if (mem[field(SHOTS[0].object, 'count')] >= RELOAD) return { fired: null };
  launch(mem, math, SHOTS[1]);
  return { fired: SHOTS[1], spent: false };
}

/**
 * $0B6A / $0BB7 - one pass of a shot's flight.
 *
 * The ship's movement block again, with the shot's own speed entry and no wrap - and with one
 * extra wrinkle: it stores the divided step back over $0915 and $0916, so after a shot has
 * moved, the ship's step operands hold the shot's. Harmless for the same reason the dispatch's
 * $1AE8 call is: the movement block rebuilds them.
 *
 * @returns {boolean} true if the shot was up and moved
 */
export function moveShot(mem, math, shot) {
  if (mem[field(shot.object, 'count')] === 0) return false;

  const heading = mem[field(shot.object, 'heading')];
  mem[SAVED_HEADING] = heading;
  buildStepOperands(math, heading);

  for (const step of [VAR.stepX, VAR.stepZ]) {
    math.divide(SHOT_SPEED, step);
    math.storeAcc(step);
  }
  for (const [step, pos] of [[VAR.stepX, shot.pos[0]], [VAR.stepZ, shot.pos[1]]]) {
    math.addFrom(step, pos);
    math.storeAcc(pos);
  }
  publishShot(mem, math, shot);
  return true;
}
