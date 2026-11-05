// Taking damage: the shield absorbs, and when it cannot, the ship's systems pay.
//
// Three instrument-panel bars - SHLD at $81DD, WARP at $81F3 and MSL at $8209 - are single
// bytes in the display list, and they are coordinates: the bar's end. **$C7 is empty**, and a
// bar shrinks towards it. `Flight.throttle` already knows that value, because warp will not
// engage at it.
//
// $1C89 is the one primitive: shrink a bar by up to four.
//
//     $1C89  LDY #$01
//     $1C8B  DEX / CPX #$C7 / BEQ    bottomed out
//            CPY #$04 / BEQ          did four
//            INY / JMP $1C8B
//
// It takes the bar in X and gives it back in X, with Y saying how far it got. Four steps
// always leave Y at 4, because the `CPX` is checked first; an early exit leaves 1, 2 or 3. The
// floor only works from above - a bar already below $C7 would step straight past it and keep
// going - which cannot happen in play because nothing ever raises one.
//
// **A ram costs sixteen and a missile costs eight.** $1C99 shrinks the shield four times over,
// storing after the second and the fourth, and $1CFC jumps into the middle of it at $1CB1 for
// the last eight. Either way, the moment the shield bottoms out, control falls to $1CCD - the
// systems damage - and the rest of the shield damage is abandoned.
//
//     $1C99  ram:       SHLD -= 4, -= 4, store, -= 4, -= 4, store, sound $1E03
//     $1CFC  missile:   SHLD >= $C8 ? ( -= 4, -= 4, store, sound ) : systems
//     $1CCD  systems:   MSL -= 4, WARP -= 4, and $0933 += 1
//
// **$0933 is how many times the systems have been hit, and four is fatal.** `CPX #$04 / BCC`
// at $1CEE, so the fourth one jumps to $1F2B and does not come back to this block. That is the
// nearest thing the binary has to a lives counter.
//
// The sounds - $1E03 when the shield holds, $1E21 and $1E40 when it does not, $1F2B when the
// ship is destroyed, $1F8E for an enemy launch - are Phase 6 and not ported. Every function
// here returns the address it would have called instead, so the chain is complete and the gap
// is named.
//
// Measured by oracle/probe_damage.mjs and held block-for-block by oracle/parity_damage.mjs.
import { RAMMED, HIT } from './entities.js';

/** $81DD - the shield bar. */
export const SHLD = 0x81DD;

/** $81F3 - the warp bar, which `Flight.throttle` also reads. */
export const WARP = 0x81F3;

/** $8209 - the missile bar. */
export const MSL = 0x8209;

/** `CPX #$C7` - the value a bar is empty at. */
export const EMPTY = 0xC7;

/** $0933 - how many times the systems have taken a hit. */
export const HITS = 0x0933;

/** `CPX #$04 / BCC` - the hit count that destroys the ship. */
export const FATAL = 4;

/** `CPY #$04` - the most steps one call of $1C89 will take. */
export const STEP = 4;

/** The sound each outcome asks for. None of them is ported. */
export const SOUND = {
  shieldHeld: 0x1E03,
  systems: [0x1E21, 0x1E40],
  destroyed: 0x1F2B,
  enemyLaunch: 0x1F8E,
  /** $1FB2 - the three-note buzz $0AEA plays when the trigger finds the bar empty. */
  outOfMissiles: 0x1FB2,
  /** $1F73 - the player's own shot, from $1866 in the loop's tail. */
  playerShot: 0x1F73,
};

/**
 * $1C89 - shrink a bar by up to four, stopping at empty.
 *
 * Takes and returns the value rather than the address, because the two calls $1C99 makes in a
 * row chain through the X register and only the second one's result is stored.
 *
 * @returns {{value: number, steps: number}} steps is Y: 4 for a full four, less if it bottomed
 */
export function shrink(x) {
  let value = x & 0xff;
  let steps = 1;
  for (;;) {
    value = (value - 1) & 0xff;
    if (value === EMPTY) return { value, steps };
    if (steps === STEP) return { value, steps };
    steps += 1;
  }
}

/**
 * $1CCD-$1CFB - the shield could not take it, so the systems do.
 *
 * Four off the missile bar and four off the warp bar, each only if it has anything left, and
 * then the hit count. The fourth hit leaves through $1F2B and never returns here.
 */
export function systems(mem) {
  for (const bar of [MSL, WARP]) {
    if (mem[bar] !== EMPTY) mem[bar] = shrink(mem[bar]).value;
  }
  mem[HITS] = (mem[HITS] + 1) & 0xff;
  if (mem[HITS] >= FATAL) {
    return { absorbed: false, destroyed: true, sound: SOUND.destroyed };
  }
  return { absorbed: false, destroyed: false, sounds: SOUND.systems };
}

/**
 * $1CB1-$1CCC - eight off the shield, or the systems if it runs out.
 *
 * A real entry point, not a helper: $1C99 falls into it and $1CFC jumps to it.
 *
 * The test after the second shrink is `CPY #$04`, not `CPX #$C7`, so a shield that bottoms out
 * exactly on the fourth step continues here rather than branching away - and then the read at
 * the top sends it to the systems anyway. The port keeps the two steps because the original
 * has them.
 */
export function shieldHeld(mem) {
  if (mem[SHLD] === EMPTY) return systems(mem);
  const first = shrink(mem[SHLD]);
  if (first.value === EMPTY) return systems(mem);
  const second = shrink(first.value);
  mem[SHLD] = second.value;
  if (second.steps !== STEP) return systems(mem);
  return { absorbed: true, destroyed: false, sound: SOUND.shieldHeld };
}

/**
 * $1C99 - an enemy reached the ship. Sixteen off the shield.
 *
 * Note what is NOT stored: the first shrink's result goes nowhere if the second one bottoms
 * the bar out, because the store comes after both. So a ram that empties the shield leaves it
 * at whatever the second call reached, and a ram that empties it on the FIRST call leaves the
 * bar untouched and goes straight to the systems.
 */
export function rammed(mem) {
  if (mem[SHLD] === EMPTY) return systems(mem);
  const first = shrink(mem[SHLD]);
  if (first.value === EMPTY) return systems(mem);
  const second = shrink(first.value);
  mem[SHLD] = second.value;
  if (second.steps !== STEP) return systems(mem);
  return shieldHeld(mem);
}

/**
 * $1CFC - an enemy missile reached the ship. Eight off the shield.
 *
 * `CPX #$C8 / BCS` rather than a comparison against $C7, so the test is "strictly above
 * empty" written as "at least one more than empty".
 */
export function missileHit(mem) {
  if (mem[SHLD] >= EMPTY + 1) return shieldHeld(mem);
  return systems(mem);
}

/**
 * $186E-$1894's first three blocks - the enemy launch sounds.
 *
 * Each class's flag, tested for non-zero, played and cleared. Class 3's holds its enemy's
 * heading rather than 1, which is the typo recorded in dispatch.js, and it makes no difference
 * here because the test is only for non-zero.
 *
 * @returns {object[]} one entry per sound that would have played
 */
export function launchSounds(mem, classes) {
  const played = [];
  for (const c of classes) {
    if (mem[c.launchSound] === 0) continue;
    played.push({ sound: SOUND.enemyLaunch, from: c.name, flag: mem[c.launchSound] });
    mem[c.launchSound] = 0;
  }
  return played;
}

/**
 * $18BC-$18D5 - apply whatever reached the ship this pass, and clear the flags.
 *
 * The ram is handled first and the missile second, so a pass in which both arrive takes
 * sixteen off the shield and then eight, and can tick the hit count twice.
 *
 * @returns {{ram: object|null, missile: object|null}}
 */
export function applyDamage(mem) {
  let ram = null, missile = null;
  if (mem[RAMMED] !== 0) {
    ram = rammed(mem);
    mem[RAMMED] = 0;
  }
  if (mem[HIT] !== 0) {
    missile = missileHit(mem);
    mem[HIT] = 0;
  }
  return { ram, missile };
}
