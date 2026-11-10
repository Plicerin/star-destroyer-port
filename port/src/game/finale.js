// The final mission's end-of-frame block: how the base star dies, and how you do.
//
// `BASE STAR.OBJ0` is the same *engine* as the main mission - same entry at `$0957`, same
// eleven MATH entry points, same renderer, same paddle read - and it is very largely the same
// code. **1,070 of the 1,369 instructions reachable from `$0957` are the main mission's at a
// different address**, over six offsets between `-$0004` and `+$08ED`: one binary with blocks
// spliced into the other, not a second program.
//
// That is the opposite of what this file said when it was written. The figure then was 105
// bytes, 4% - but that came of comparing the two images byte for byte *at the same address*,
// which is the one arrangement under which moved code cannot match. `probe_basestar.mjs` now
// compares a candidate pair under the offset its two entry addresses imply, which is what
// "the same code, moved" means, and the deltas it uses are each established by a whole routine
// matching rather than fitted to the result.
//
// So most of what follows is a transliteration of the blocks that are genuinely the finale's
// own, and the rest reaches back into the main mission's modules - `dispatch.js` for the
// launch, `damage.js` for the shield, `loop.js` for the frame the finale runs at `$09A7`,
// which is `Game.pass`'s `$09A3` four bytes along.
//
// This is the block the frame ends on, `$10E5`-`$112E`, and it is the finale's answer to the
// main mission's `$18D6`/`$18DD`. Four things happen in it and three of them differ from the
// main mission in ways nothing on screen would show:
//
//     $10E5  LDX $0933 / CPX #$02 / BNE $10ED / RTS      two hits, and it leaves
//     $10ED  LDX $1FF7 / CPX #$0F / BNE $1107            fifteen, and a stage is done
//     $1107  the pause - CPX #$7F, not the main mission's #$80
//     $1120  LDX $814B / BNE / LDX $093E / BNE / INC $1FFF / RTS
//     $112E  JMP $09A7                                   round again
//
// **Two hits is an equality test, not a threshold.** `CPX #$02 / BNE` leaves only when the
// count is exactly 2, where the main mission's `CPX #$04 / BCC` leaves at four *or more*.
// Nothing in the mission increments the count by more than one at a time, so the two agree in
// play - but a port that wrote `>= 2` would be writing a different program, and if anything
// ever double-counted, the finale would sail past its own death and the main mission would
// not. Kept as the equality it is.
//
// **It does not use zero page $00.** The main mission ends a flight by writing `$4D` into
// `$00` and testing it at `$18D6`; the finale simply `RTS`es out of the mission from inside
// the frame. There is no quit flag here at all.
//
// **The win is the field being empty, and it is two bytes.** `$814B` is object 3's count and
// `$093E` is class 1's debris counter; both zero means nothing is left alive or dying, and
// the base star is marked dead. That is why the mission has to be *set up* before it is run:
// `SD START2` pokes `$814B` to 255, and side-loading the binary without that poke makes the
// mission win on its first pass. See `oracle/exercise.mjs`'s `toFinale`.
//
// Measured and held by `oracle/probe_basestar.mjs` and `oracle/parity_finale.mjs`.
import { field } from './objects.js';
import { BEARING, fire, turnUp, turnDown, coolDown } from './dispatch.js';
import { selectPages, publishShip, PAGE, XI, GATE, BURN } from './loop.js';
import { Math24 } from './math.js';
import { TABLE_INIT } from './tables.js';
import { Flight } from './flight.js';
import { Engine } from '../a23d2/engine.js';
import { steer, turnDirection, panStars, H1, OBJ12_HEADING } from './controls.js';
import { GEOM, rangeToTarget, bearing, rangeFromArgs, dir } from './geometry.js';
import { hold, move, missile } from './entities.js';
import { SHOTS as PLAYER_SHOTS, placeDebris, switchOffShot, aimDebris, respawn }
  from './kill.js';
import { fire as pullTrigger, moveShot } from './weapon.js';
import { shrink } from './damage.js';

/** $0933 - the same hit count the main mission keeps, read by a different test. */
export const HITS = 0x0933;

/** `CPX #$02` at `$10E8`, and the branch under it is `BNE` - equality, not a threshold. */
export const FATAL = 2;

/** $1FF7 - the finale's progress counter. `SD START2` zeroes it; nothing else reads it. */
export const PROGRESS = 0x1FF7;

/** `CPX #$0F` at `$10F0`. */
export const STAGE = 15;

/** $1FFF - incremented, not set, so it can reach 2. `SD PART3` tests it against zero. */
export const BASE_STAR = 0x1FFF;

/** $814B - object 3's count, the first half of "is the field empty". */
export const OBJ3_COUNT = 0x814B;

/** $093E - class 1's debris counter, the second half. */
export const DEBRIS1 = 0x093E;

/** `$09A7` - the top of the finale's frame, where the main mission's is `$09A3`. */
export const FRAME_TOP = 0x09A7;

/**
 * The two subroutines the fifteenth stage calls - **and both are already written.**
 *
 * `$1131` is `kill.js`'s `$1A1E` relocated and `$12AB` is its `$1ABE`, identical but for the
 * addresses their own branches name. Fourteen of the finale's thirty-three routines turn out
 * to be main-mission routines moved, and every one of them is a module the port already holds
 * against the machine; `probe_basestar.mjs` derives that mapping and checks it. These were
 * listed here as gaps before anyone looked.
 */
export const STAGE_CALLS = [0x1131, 0x12AB];

/** Where each of those lives in the main mission, and so in the port. */
export const STAGE_CALLS_ARE = { 0x1131: 0x1A1E, 0x12AB: 0x1ABE };

/** What the block did, and why it stopped. */
export const DONE = { running: null, destroyed: 'destroyed', won: 'won' };

/**
 * `$1107`-`$111F` - the pause, and the one byte that is not the main mission's.
 *
 * `CPX #$7F / BCC` where `$1929` has `CPX #$80 / BCC`, so this reads the latch as holding a
 * key one value lower. The keyboard sets bit 7 while a key is pending, so in ordinary play
 * the two agree; they part only on exactly `$7F`, which is a cleared latch whose last key was
 * DEL. Recorded as a difference rather than smoothed over, because smoothing it over is how
 * a transliteration quietly becomes a rewrite.
 *
 * @param {number} latch what `$C000` holds
 * @returns {boolean} true if this frame pauses
 */
export function pauses(latch) {
  return (latch & 0xff) >= 0x7F;
}

/**
 * `$10E5`-`$112E` - the finale's end of frame.
 *
 * @param {Uint8Array} mem
 * @param {object} [io] `latch` for `$C000`; omit it and the frame never pauses
 * @returns {{done: string|null, paused: boolean, calls: number[], stage: boolean}}
 */
export function endOfFrame(mem, { latch = 0 } = {}) {
  const calls = [];

  // $10E5 - two, exactly, and the mission is over. The RTS is the whole of it.
  if (mem[HITS] === FATAL) return { done: DONE.destroyed, paused: false, calls, stage: false };

  // $10ED - every fifteenth, two routines run, the counter resets and class 1's debris is
  // reloaded with four. That reload is what keeps the win test below from firing.
  let stage = false;
  if (mem[PROGRESS] === STAGE) {
    stage = true;
    calls.push(...STAGE_CALLS);                              // $10F4, $10F7
    mem[PROGRESS] = 0;                                       // $10FA
    mem[DEBRIS1] = 4;                                        // $10FF
    return { done: DONE.running, paused: false, calls, stage };  // $1104 JMP $112E
  }

  // $1107 - the pause, which is not reached on a stage frame.
  const paused = pauses(latch);

  // $1120 - nothing alive and nothing dying means the base star is dead. INC, not a store,
  // so a mission that reached both this and $10A7 would leave $1FFF at 2.
  if (mem[OBJ3_COUNT] === 0 && mem[DEBRIS1] === 0) {
    mem[BASE_STAR] = (mem[BASE_STAR] + 1) & 0xff;            // $112A
    return { done: DONE.won, paused, calls, stage };         // $112D RTS
  }
  return { done: DONE.running, paused, calls, stage };       // $112E JMP $09A7
}

// ---------------------------------------------------------------------------------------
// The damage block, $1476-$14FA.
//
// The shrink primitive at `$1476` is logic-identical to the main mission's `$1C89` -
// `LDY #$01 / DEX / CPX #$C7 / BEQ / CPY #$04 / BEQ / INY / JMP` - same floor, same four
// steps, so `damage.js`'s `shrink` is reused rather than rewritten. Everything around it is
// at different addresses and two pieces of it behave differently.
//
// **The shield comes off in two blocks of eight, and the ram only ever gets the first.**
// `$1486` shrinks twice, stores, and then tests `CPY #$0A` before falling into `$149E` for
// the second eight. `$1476` returns Y between 1 and 4 and can return nothing else, so that
// test is never equal and the ram always branches away to the systems instead. The main
// mission's twin test is `CPY #$04`, which is exactly what the primitive can return. One
// digit, and it is the difference between a ram costing sixteen and a ram costing eight.
//
// `$149E` is not dead, though: **the missile path jumps straight into it** - `$14EE` tests
// the shield against `$C8` and `$14F8` is `JMP $149E`. So the second eight is the missile's,
// not the ram's second helping.
//
// **And the missile sets the hit count rather than raising it.** `$14B2 LDA #$01 / STA
// $0933`, unconditionally, in the middle of `$149E`. A missile landing on a healthy shield
// therefore puts the count at exactly 1 - which knocks a count of 2 back down to 1, and the
// mission ends at exactly 2. Nothing in the main mission does this. It is written here as
// the store it is.
//
// **Two fatal tests, doing different jobs.** `$14E0 CPX #$02 / BCC` is a threshold: at two
// or more the systems block jumps to `$171D`, which is `JSR $1797` (display teardown through
// `$C054` and `$C056`), two sound bursts and an `RTS` - no state at all, not even a quit
// flag. The mission actually ends at `$10E8 CPX #$02 / BNE` in the frame block above. So the
// damage block plays the death and the frame ends the mission.

/** The three panel bars, at the same addresses as the main mission's: `SV DATA2` differs
 *  from `SV DATA` in eight bytes and all eight are shape pointers, so the panel does not
 *  move. */
export const SHLD = 0x81DD;
export const WARP = 0x81F3;
export const MSL = 0x8209;

/** `CPX #$C7` - the same floor the main mission uses. */
export const EMPTY = 0xC7;

/** `CPX #$02 / BCC` at `$14E0`. A threshold, unlike the frame's equality test. */
export const FATAL_DAMAGE = 2;

/** `$149A CPY #$0A`, against a primitive that returns at most 4. */
export const RAM_SECOND_STAGE = 0x0A;

/** `$14B7 CPY #$04` - this one the primitive can return, so this branch is live. */
export const MISSILE_FULL = 0x04;

/** `LDA #$01` at `$14B2`: what the missile path puts in the hit count. */
export const MISSILE_SETS = 1;

/** What each outcome would have called. None of these is ported. */
export const CALLS = {
  /** $171D - teardown then two bursts, and no state. */
  destroyed: 0x171D,
  /** $1613 and $1632 - a systems hit that was not fatal. */
  systems: [0x1613, 0x1632],
  /** $15F5 - the missile block's own sound, when its second shrink took a full four. */
  missileHeld: 0x15F5,
};

/** `$14BF` - the systems take it: four off the missile bar, four off warp, then the count. */
export function systems(mem, shrink) {
  for (const bar of [MSL, WARP]) {                           // $14BF, $14CC
    if (mem[bar] !== EMPTY) mem[bar] = shrink(mem[bar]).value;
  }
  mem[HITS] = (mem[HITS] + 1) & 0xff;                        // $14D9 LDX / INX / STX
  if (mem[HITS] >= FATAL_DAMAGE) {                           // $14E0 CPX #$02 / BCC
    return { absorbed: false, fatal: true, calls: [CALLS.destroyed] };  // $14E4 JMP $171D
  }
  return { absorbed: false, fatal: false, calls: [...CALLS.systems] };  // $14E7, $14EA
}

/** `$149E` - the second eight, which only the missile reaches. */
export function secondEight(mem, shrink) {
  if (mem[SHLD] === EMPTY) return systems(mem, shrink);      // $14A1
  const first = shrink(mem[SHLD]);
  if (first.value === EMPTY) return systems(mem, shrink);    // $14A8
  const second = shrink(first.value);
  mem[SHLD] = second.value;                                  // $14AF
  mem[HITS] = MISSILE_SETS;                                  // $14B2-$14B4, unconditional
  if (second.steps !== MISSILE_FULL) return systems(mem, shrink);        // $14B7
  return { absorbed: true, fatal: false, calls: [CALLS.missileHeld] };   // $14BB, $14BE RTS
}

/** `$1486` - an enemy reached the ship. Eight off the shield, then the systems. */
export function rammed(mem, shrink) {
  if (mem[SHLD] === EMPTY) return systems(mem, shrink);      // $1489
  const first = shrink(mem[SHLD]);
  if (first.value === EMPTY) return systems(mem, shrink);    // $1490
  const second = shrink(first.value);
  mem[SHLD] = second.value;                                  // $1497
  // $149A CPY #$0A against a Y of 1 to 4. Never equal, so this always goes to the systems
  // and never falls into the second eight. Written as the comparison it is.
  if (second.steps !== RAM_SECOND_STAGE) return systems(mem, shrink);
  return secondEight(mem, shrink);
}

/** `$14EE` - a missile reached the ship. `CPX #$C8 / BCS`, then `$14F8 JMP $149E`. */
export function missileHit(mem, shrink) {
  if (mem[SHLD] >= EMPTY + 1) return secondEight(mem, shrink);  // $14F1 / $14F8
  return systems(mem, shrink);                                  // $14F5
}

// ---------------------------------------------------------------------------------------
// The debris block, $103E-$10AA - and how the base star actually dies.
//
// Three debris counters tick down a frame at a time, the scene renders, two one-shot flags
// are serviced, and then class 1's counter is tested. That last test is the first of the two
// places `$1FFF` is incremented, and between them they answer a question this port left open:
// **both of them fire, in every winning mission, four frames apart.**
//
// The sequence, measured in the machine by setting the progress counter to fifteen and
// letting it run:
//
//     frame 1   $1FF7 reaches 15, so $10FF sets $093E to 4 and resets the counter
//     frame 2   the tick takes $093E to 3; $109D CPX #$03 / BCC does not branch;
//               $10A7 INC $1FFF  ->  1, and $10AA JMP $10CB keeps the mission running
//     frame 3   $093E to 2
//     frame 4   $093E to 1, then 0 - and with the field empty, $112A INC $1FFF  ->  2,
//               and $112D RTS ends the mission
//
// **So a won mission leaves `$1FFF` holding 2, and that is a bug in the original.**
// `SD PART3` line 175 is `IF PEEK(8191) = 0 THEN RUN MONOLITH`, so 2 is a win. But
// `INITIALS` line 2016 is `IF PEEK(8191) = 1 THEN BN = BN + 10000` - an equality - so the
// ten thousand points for killing the base star are **never paid**. Winning the game and
// being paid for it needed that byte to be 1, and the only way it stays at 1 is for the
// mission to end before the field empties. The port reproduces it.

/** $093E, $093F, $0940 - the three debris counters, one per enemy class. */
export const DEBRIS = [0x093E, 0x093F, 0x0940];

/** `$109D CPX #$03 / BCC` - what class 1's counter has to reach to kill the base star. */
export const DEBRIS_WIN = 3;

/** $0947 - a 0/1 toggle, `INX / CPX #$02 / BNE / LDX #$00`. */
export const TOGGLE = 0x0947;

/** The two one-shot flags the block services and clears, with what each would have called. */
export const ONE_SHOTS = [
  { flag: 0x094B, call: 0x1761 },   // $107E
  { flag: 0x0945, call: 0x177C },   // $108B
];

/**
 * The debris drawer, the renderer and the two bursts the staged win plays.
 *
 * `$14FB` is the main mission's `$1D09`, moved; `$15C5` is `$1DBA`, the click generator.
 * `$6000` is A2-3D2, which the port has had since phase 1.
 */
export const DEBRIS_CALLS = { draw: 0x14FB, render: 0x6000, stagedWin: 0x15C5 };

/**
 * `$10CB` and `$10D8` - the two flags that say the ship was hit, and what each one calls.
 *
 * Nothing in the main mission sets either. They are written by the base star's own aim-and-fire
 * block at `$0DE0` and by its launch at `$1039` - which is to say by the only enemy in this
 * game that shoots back. Each is serviced once and then cleared.
 */
export const DAMAGE_FLAGS = [
  { flag: 0x0942, at: 0x1486, hit: rammed },        // $10CB - something reached the ship
  { flag: 0x0941, at: 0x14EE, hit: missileHit },    // $10D8 - a missile did
];

/**
 * `$1046`-`$10E4` - tick the debris, render, service the flags, and test for the staged win.
 *
 * **It starts at `$1046`, not `$103E`.** `$1037 BPL $1046` jumps over `$1039`-`$1045`, and so
 * does `$0FB3 JMP $1046` when the shot is not up, so those four instructions are not the head
 * of this block at all: they are the shot's hit path - the flag, and then zeroing object 5's
 * count and its twin's to take the shot off the screen. `entities.js`'s `missile` already does
 * both, at the same two addresses. This block had them at its head, which zeroed the counts on
 * every frame and would have taken the base star's shot away the moment it launched. A trace
 * of one real frame is what found it: `$103E` is never reached in a frame where nothing hits.
 *
 * The block runs past `$10AA` in both directions. `$10AA JMP $10CB` takes the winning path
 * straight to the damage flags, skipping the other two classes; the losing path falls out of
 * `$109F BCC $10AD` into those two and reaches the flags after them. An earlier reading had
 * `$10AD` down as a second way out of the block, which cost it everything from there to
 * `$10E4` - including both calls into the damage code. The parity harness could not catch
 * that, because it only ever gave classes 2 and 3 counters below the threshold.
 *
 * @returns {{calls: number[], won: boolean}} `won` is `$10A7`, which does **not** end the
 *   mission: it carries on to the block above.
 */
export function debrisFrame(mem, shrink) {
  const calls = [];
  for (const [i, counter] of DEBRIS.entries()) {             // $1047, $1054, $1061
    if (mem[counter] === 0) continue;
    calls.push(DEBRIS_CALLS.draw);                           // JSR $14FB, Y = the class
    mem[counter] = (mem[counter] - 1) & 0xff;
  }
  calls.push(DEBRIS_CALLS.render);                           // $106E JSR $6000

  mem[TOGGLE] = (mem[TOGGLE] + 1) & 0xff;                    // $1071 INX
  if (mem[TOGGLE] === 2) mem[TOGGLE] = 0;                    // $1075 CPX #$02

  for (const { flag, call } of ONE_SHOTS) {                  // $107E, $108B
    if (mem[flag] === 0) continue;
    calls.push(call);
    mem[flag] = 0;
  }

  // $1098 - class 1's counter at three or more kills the base star. Note what it is not:
  // there is no test of the other two counters here, and no test of anything else.
  let won = false;
  if (mem[DEBRIS[0]] !== 0 && mem[DEBRIS[0]] >= DEBRIS_WIN) {
    calls.push(DEBRIS_CALLS.stagedWin, DEBRIS_CALLS.stagedWin);   // $10A1, $10A4
    mem[BASE_STAR] = (mem[BASE_STAR] + 1) & 0xff;                 // $10A7
    won = true;                                                   // $10AA JMP $10CB
  } else {
    // $10AD, $10BC - classes 2 and 3, on the same threshold but not the same terms: one
    // burst instead of two, the counter is zeroed, and `$1FFF` is not touched. Only class 1
    // pays progress, which is why killing the base star is the only thing that stages.
    for (const counter of [DEBRIS[1], DEBRIS[2]]) {
      if (mem[counter] < DEBRIS_WIN) continue;                    // CPX #$03 / BCC
      calls.push(DEBRIS_CALLS.stagedWin);
      mem[counter] = 0;
    }
  }

  // $10CB, $10D8 - and now the damage the base star did this frame.
  for (const { flag, at, hit } of DAMAGE_FLAGS) {
    if (mem[flag] === 0) continue;
    calls.push(at);
    hit(mem, shrink);
    mem[flag] = 0;
  }
  return { calls, won };                                          // and it falls into $10E5
}

// ---------------------------------------------------------------------------------------
// The two award blocks, $0F21-$0F61 and $0F69-$0FA9 - and an instruction this copy has wrong.
//
// Each is the same seven steps: four `JSR $9C4B` calls that hand MATH its operands, a
// `JSR $142A`, a `JSR $99D2` compare, and a `BPL` that skips everything when the answer is
// positive. When it is not, the enemy died: the progress counter goes up by one, that class's
// debris counter is loaded with four, and three routines run.
//
// **$1FF7 is only ever incremented here.** Fifteen of these is what fires the staged win in
// the debris block, so these two sites are the whole of the finale's scoring. There is no
// third: class 1's counter at `$093E` is written by nothing but `$10FF`, the staged win
// itself, which is why class 1 is the base star rather than an enemy.
//
// **The second block has `ROL $0907` where it should have `LDX $0907`.** `AE` against `2E` -
// bit 7 of one opcode byte - and the operand and the alignment either side are identical, so
// it is not a disassembly artefact. Measured in the machine, it rotates `$0907` left through
// carry and leaves X holding whatever `$0F75 LDX $0930` put there, so the block hands MATH
// the previous operand twice and damages `$0907` on its way past.
//
// This file once said that whether that was intended was not knowable from here. It is. The
// same block exists in the main mission, at `$0F40`, and `$0F55` is `LDX $0907` - the same
// operand, the same place in the sequence, the opcode intact. And `$0907` is not an ordinary
// byte: it is a **directory entry**, one of the 65 at `$08F2` that hold table offsets, so the
// next instruction uses it as an index. Rotating it cannot do anything but aim the copy
// somewhere else, and after enough passes it reaches zero and the copy lands on table[0].
// There is no reading of that as a design.
//
// There are two of them, and the other is in the shot's advance block at `$101C ROL $0914`,
// against `LDX $0914` at the main mission's `$13F4`. Same single bit, same shape of damage:
// `$0914` is a directory entry too, class 3's missile Z.
//
// **So both are repaired, and the repair is the default.** `ROTATED_INDICES` below is the
// evidence and `rotatedIndices: true` reproduces what this copy does, which is what the
// parity harness compares against the machine - the machine is running the same copy. On an
// undamaged image the repair is a no-op, which is the argument for doing it by default.

/** $1FF7 again, by the only two instructions that raise it: `$0F53` and `$0F9B`. */
export const AWARD_SITES = [0x0F53, 0x0F9B];

/** `LDA #$04` - what each block loads into its class's debris counter. */
export const DEBRIS_ON_KILL = 4;

/** `$0F64 LDX $817F / BEQ` - object 7's count, which gates the second block entirely. */
export const SECOND_GATE = 0x817F;

/** $0907 - the byte `$0F7E` rotates instead of loading. */
export const ROTATED = 0x0907;

/**
 * The two `ROL abs` that should be `LDX abs`, and the main-mission instruction that says so.
 *
 * `twin` is an address in `STAR DESTROYER.OBJ0`. Each one holds `AE` with the same operand
 * where this file's copy of the finale holds `2E`, which is the single bit.
 */
export const ROTATED_INDICES = [
  /** The second award block's third operand - the shot's Z. */
  { at: 0x0F7E, operand: 0x0907, twin: 0x0F55 },
  /** The shot advance's third operand - the same axis, a different variable. */
  { at: 0x101C, operand: 0x0914, twin: 0x13F4 },
];

/**
 * What each block calls when the kill lands - and **all six are `kill.js`'s**.
 *
 * This file had the first two of each three down as the finale's own, and `$1755`/`$175B` as
 * sounds, on no better evidence than their sitting in the sound region. They are not:
 *
 *     $119E / $120B   `placeDebris`, with the SHOT's scope twin as the source rather than the
 *                     enemy - 36 of each routine's 37 instructions are the main mission's
 *     $1755 / $175B   `switchOffShot`, byte for byte the main mission's $1F67 and $1F6D:
 *                     `LDA #$00 / STA $8172 / RTS`, three instructions
 *     $1278 / $12B4   `aimDebris`, which is $1A8B and $1AC7
 *
 * So the finale's award is `kill.js`'s `shotHit` tail without `switchOffEnemy` - which makes
 * sense, because the thing the shot hit is the base star and the base star does not die here.
 *
 * `switchOffShot` is why the relocation census missed these two: it is three instructions and
 * the matcher needs four, a guard against coincidence that excluded a real match. Found by
 * tracing which instruction took the player's shot off the screen - `$1757` - after the
 * whole-frame check disagreed about it for two passes.
 */
export const AWARD_CALLS = [
  { debris: 0x093F, calls: [0x119E, 0x1755, 0x1278] },   // $0F5B, $0F5E, $0F61
  { debris: 0x0940, calls: [0x120B, 0x175B, 0x12B4] },   // $0FA3, $0FA6, $0FA9
];

/** The ones above that are main-mission routines moved, by where they came from. */
export const AWARD_CALLS_ARE = { 0x1278: 0x1A8B, 0x12B4: 0x1AC7 };

/**
 * `$0F7E ROL $0907` - rotate left through carry, as the 6502 does it.
 *
 * @returns {{value: number, carry: number}} the byte and the bit that fell out of the top
 */
export function rotate(value, carry = 0) {
  const out = (value >> 7) & 1;
  return { value: ((value << 1) | (carry & 1)) & 0xff, carry: out };
}

/**
 * `$0F53`-`$0F61` and `$0F9B`-`$0FA9` - what an award does.
 *
 * The test above it is MATH's and is not ported; this is the consequence, which is the part
 * the rest of the mission reads.
 *
 * @param {Uint8Array} mem
 * @param {number} which 0 for the first block, 1 for the second
 */
export function award(mem, which, { placeDebris, switchOffShot, aimDebris, SHOTS } = {}) {
  const { debris, calls } = AWARD_CALLS[which];
  mem[PROGRESS] = (mem[PROGRESS] + 1) & 0xff;          // $0F53 / $0F9B INC $1FF7
  mem[debris] = DEBRIS_ON_KILL;                        // $0F56 / $0F9E LDA #$04

  // $0F5B, $0F5E, $0F61 - the three, in the order the block calls them. The middle one takes
  // the player's shot off the screen, which is the whole of what it does.
  //
  // They are optional only so the award can still be measured on its own, as the first
  // version of it was: without them it reports the calls instead of making them.
  if (placeDebris && switchOffShot && aimDebris && SHOTS) {
    placeDebris(mem, SHOTS[which].twin);               // $119E / $120B
    switchOffShot(mem, SHOTS[which]);                  // $1755 / $175B
    aimDebris(mem, SHOTS[which]);                      // $1278 / $12B4
  }
  return { calls: [...calls], debris };
}

// ---------------------------------------------------------------------------------------
// The hit test above each award, $0F21-$0F51 and $0F69-$0F99.
//
// **The routine it turns on is already written.** `$142A` is the main mission's `$1C3D`
// relocated and otherwise untouched - 26 instructions, same operands, same MATH calls, same
// order, not one difference - so `geometry.js`'s `rangeFromArgs` is reused exactly. (This
// once said it was the only routine the two binaries genuinely share. It is one of twenty-
// seven; see the head of this file.)
//
// The idiom is `kill.js`'s, to the instruction: four `JSR $9C4B` calls to fill `$1C3D`'s
// argument slots, the range, then `LDY $090A / LDX $092F / JSR $99D2 / BPL` - the same `$092F`
// byte an enemy rams the ship at, read the same way round. **And like the main mission's shot
// hit, it is strict**: `BPL` skips the award and is taken on zero, so a range exactly at the
// threshold does not score. It is the ram at `$0E2C` that includes the boundary, by loading
// the two operands the other way round and branching the other way.
//
// **What the ROL costs, concretely.** `JSR $9C4B` is `table[Y] := table[X]`, so the copies
// are destination-then-source, and block B's third one never loads its source:
//
//     block A   aX := $0904   bX := $0930   aZ := $0906   bZ := $0931
//     block B   aX := $0905   bX := $0930   aZ := $0931   bZ := $0931
//                                                ^ never loaded
//
// where the second row's aZ reads $0931 because `$9C4B` leaves X three bytes past its
// source, and table entries are three bytes. So block B puts the target's Z into **both**
// points: the Z delta is always zero and the range it measures is the X distance alone. The
// second weapon hits on how far across the target is, never on how far away. The port does
// the same copy.

/**
 * `$092F` - the ram range, and the hit threshold, as in the main mission.
 *
 * The address, not the table index. Everything that reaches MATH goes through the directory
 * at `$08F2` first, which is what `dir` is for - writing the address straight into a compare
 * reads a slot that has nothing to do with it, and the comparison then answers confidently
 * about the wrong bytes.
 */
export const HIT_RANGE = 0x092F;

/** The two shots' position entries, and the target's. */
export const SHOTS = [{ x: 0x0904, z: 0x0906 }, { x: 0x0905, z: 0x0907 }];
export const TARGET = { x: 0x0930, z: 0x0931 };

/**
 * `$0F21`-`$0F51` / `$0F69`-`$0F99` - fill the argument slots, take the range, compare.
 *
 * @param {Uint8Array} mem
 * @param {import('./math.js').Math24} math
 * @param {number} which 0 or 1
 * @param {object} geom `rangeFromArgs`, `GEOM` and `dir`, passed in so this file does not
 *   reach across into the main mission's modules for anything but the arithmetic; `carry` is
 *   the flag `$0F7E` rotates in, which MATH's model does not carry, and `rotatedIndices`
 *   turns the repair off
 * @returns {{hit: boolean, stale: boolean}} `stale` marks the copy the ROL spoiled, and is
 *   false whenever the repair is in force
 */
export function hitTest(mem, math, which, { rangeFromArgs, GEOM, dir, carry = 0,
  rotatedIndices = false }) {
  const shot = SHOTS[which];
  // Every operand goes through the directory at $08F2, because `JSR $9C4B` takes table
  // indices and not addresses - which is what these are written as above.
  math.copy(dir(shot.x), GEOM.aX);                  // $0F21 / $0F69
  math.copy(dir(TARGET.x), GEOM.bX);                // $0F2A / $0F72

  // $0F33 / $0F7B - the shot's own Z, which is what both blocks mean to copy.
  //
  // As found, block B's LDX is a ROL, so X is never loaded and keeps whatever the copy above
  // left in it - and `$9C4B` walks X forward three bytes as it copies, so it ends on the
  // index *after* its source. Table entries are three bytes, so "three past $0930" is exactly
  // $0931. Measured: X is 218, which is $0931's index. Block B then copies the target's Z into
  // **both** points, the Z delta is always zero, and the range it measures is the X distance
  // alone - the second weapon hitting on how far across the target is rather than how far
  // away. That is the behaviour `rotatedIndices` asks for.
  const stale = rotatedIndices && which === 1;
  math.copy(dir(stale ? TARGET.z : shot.z), GEOM.aZ);
  math.copy(dir(TARGET.z), GEOM.bZ);                // $0F3C / $0F84
  if (stale) {
    // $0F7E ROL $0907. The bit rotated in is the carry, and the carry here is whatever the
    // `JSR $9C4B` above left - which is data-dependent and which `math.js` does not model,
    // because nothing else in the port has ever needed MATH's flags. So it is an input
    // rather than an assumption; `parity_finale.mjs` supplies the machine's.
    mem[ROTATED] = rotate(mem[ROTATED], carry).value;
  }
  rangeFromArgs(math);                              // $0F45 / $0F8D JSR $142A
  // $0F4E / $0F96 - `LDY $090A / LDX $092F / JSR $99D2 / BPL`, so the threshold is the X
  // operand and the range is the Y operand, and `BPL` skips the award. `BPL` is taken on
  // zero, so **the range has to be strictly inside the threshold**: equality is not a hit.
  //
  // This read `compare(GEOM.range, dir(HIT_RANGE)) >= 0` and called equality a hit, which is
  // the two operands the wrong way round. The swap cancels itself everywhere except on the
  // boundary, which is why thirteen cases agreed with the machine and none of them could
  // tell. `parity_finale.mjs` now stands a case exactly on it.
  return { hit: math.compare(dir(HIT_RANGE), GEOM.range) < 0, stale };
}

// ---------------------------------------------------------------------------------------
// $0D5F-$0E2B - the base star takes aim and shoots back.
//
// This is the only enemy in either binary that fires at the ship, and it is the main mission's
// own dispatch doing it: `$0D5F` is `dispatch.js`'s `$0D5B` four bytes along, reached from the
// same place in the frame, on class 3's fields - object 3's heading, object 5 as the shot,
// `$093A` as the cooldown. Four things differ, and the first of them is the one that can be
// seen from the cockpit.
//
// **It tests four candidate headings where the main mission tests two.** Both try the heading
// it is on and one unit past; the finale then tries `h + $7F + C` and one past *that*. A
// heading is a byte and the circle is 256 units, so `+$80` is the reciprocal bearing: the base
// star will shoot at you when you are dead astern exactly as readily as dead ahead. Nothing
// else in the game can.
//
// The carry in `h + $7F + C` is not an unknown. `$0D86 ADC #$7F` follows `$0D7B CMP`, which
// compared the second candidate against the bearing, so `C` is `(h + 1) >= target` and the
// third candidate is the reciprocal when that compare went one way and one short of it when
// it went the other.
//
// **It aims in scratch.** The main mission walks object 3's live heading with `INC` and `DEC`
// and has to undo the probe before turning; the finale copies the heading into `$8147` -
// object 2's heading operand, which it is not otherwise using - and leaves object 3 alone. So
// the shot leaves on the candidate that matched, which can be the reciprocal, while the base
// star itself goes on pointing where it was.
//
// **It decides which way to turn from the heading itself.** `$0D9E CMP` compares `$8154`,
// where the main mission's `$1593 BCS` is still carrying the flags from its probe at `h + 1`.
// One unit, and it only shows on the frame where the two straddle the bearing.
//
// **Its cooldown is twelve frames, not fifteen** - and firing also writes the page toggle into
// class 2's cooldown at `$0939`, which has no counterpart in the main mission at all.

/** $8147 - object 2's heading operand, which the aim test borrows as scratch. */
export const AIM_SCRATCH = field(2, 'heading');

/**
 * The base star, as one of `dispatch.js`'s classes.
 *
 * Class 3's fields throughout, because that is whose block this is, with the two values the
 * finale changed. `twin`, `missile` and `missileTwin` are objects 15, 5 and 17 exactly as in
 * the main mission: the shot the base star fires is the same display-list record that classes
 * 2 and 3 share there.
 */
export const BASE_STAR_CLASS = {
  name: 'the base star',
  at: 0x0D5F,
  enemy: 3,
  twin: 15,
  missile: 5,
  missileTwin: 17,
  /** $093A, and `$0DDB LDX #$0C` where the main mission loads 15. */
  cooldown: 0x093A,
  cooldownFrames: 0x0C,
  /** $0945, stored from the accumulator, which holds the candidate that matched. */
  launchSound: 0x0945,
  soundStoresHeading: true,
  coolingTurn: 'down',
  /** $0DE0 LDX $0947 / STX $0939 - the page toggle into class 2's cooldown. */
  alsoCool: { at: 0x0939, from: TOGGLE },
  enemyPos: [0x0930, 0x0931],
  missilePos: [0x0912, 0x0914],
  missileStep: [0x0928, 0x092A],
  /** $0FD4 - three increments of the shot's bank a frame, so it rolls as it flies. */
  bankSpin: 3,
  // What `$16EC` - class 3's respawn at `$1EFA`, moved - reads when the ram puts the base
  // star back. `cascadeTo` is null because there is no class 2 here to fall through from.
  /** $1FFB, which `WAVE3` below names too - declared after this, so written out here. */
  wave: 0x1FFB,
  bump: 20,
  cascadeTo: null,
};

/** `BASE_STAR_CLASS` with its variable addresses turned into table indices. */
export const baseStarClass = (dir) => ({
  ...BASE_STAR_CLASS,
  enemyPos: BASE_STAR_CLASS.enemyPos.map(dir),
  missilePos: BASE_STAR_CLASS.missilePos.map(dir),
  missileStep: BASE_STAR_CLASS.missileStep.map(dir),
});

/**
 * `$0D5F`-`$0E2B` - aim at the ship, and fire if any of four headings matches.
 *
 * The class's `enemyPos`, `missilePos` and `missileStep` have to be table indices rather than
 * addresses, so pass them through `dir`; `BASE_STAR_CLASS` carries the addresses as the
 * listing writes them.
 *
 * @param {Uint8Array} mem a 64K image: the display list at $80FB and the state at $0900
 * @param {import('./math.js').Math24} math
 * @param {(address: number) => number} dir the directory at $08F2
 * @returns {{action: string, candidate?: number, direction?: string}}
 */
export function aimAndFire(mem, math, dir) {
  const c = baseStarClass(dir);

  // $0D5F - cooling, and it turns without looking at the bearing at all.
  if (mem[c.cooldown] !== 0) return { ...turnDown(mem, c), action: 'cooling' };

  const target = math.table[(BEARING + 1) & 0xff];     // $0D67 LDY $090B
  const h = field(3, 'heading');                       // $8154

  // $0D6D-$0D99 - the four candidates, every one of them tested in scratch.
  mem[AIM_SCRATCH] = mem[h];                                     // $0D6D STA $8147
  if (mem[AIM_SCRATCH] === target) return shoot(mem, math, c);   // $0D70 / $0D73
  mem[AIM_SCRATCH] = (mem[h] + 1) & 0xff;                        // $0D75 INC
  if (mem[AIM_SCRATCH] === target) return shoot(mem, math, c);   // $0D7B / $0D7E
  // The carry the compare at $0D7B just left: CMP sets it when A is at or above the operand,
  // and A was the candidate above. $0D83 LDA does not disturb it, so the ADC takes it in.
  const carry = mem[AIM_SCRATCH] >= target ? 1 : 0;
  mem[AIM_SCRATCH] = (mem[h] + 0x7F + carry) & 0xff;             // $0D80 DEC / $0D86 ADC #$7F
  if (mem[AIM_SCRATCH] === target) return shoot(mem, math, c);   // $0D8B / $0D8E
  mem[AIM_SCRATCH] = (mem[AIM_SCRATCH] + 1) & 0xff;              // $0D90 INC
  if (mem[AIM_SCRATCH] === target) return shoot(mem, math, c);   // $0D96 / $0D99

  // $0D9B - and otherwise turn, on the heading itself rather than on the probe.
  return mem[h] >= target ? turnDown(mem, c) : turnUp(mem, c);   // $0DA1 BCS
}

/** `$0DC6`-`$0E2B` - the launch, on whichever candidate matched. */
function shoot(mem, math, c) {
  const candidate = mem[AIM_SCRATCH];                  // $0DF8 LDY $8147
  return { ...fire(mem, math, c, candidate), candidate };
}

/**
 * `$0FAC`-`$103D` - one frame of the base star's shot in flight.
 *
 * `entities.js`'s `missile` is this block: the only differences are the bank spin, which
 * `BASE_STAR_CLASS` carries, and `$101C`, which `rotatedIndices` turns back on.
 *
 * `$1039 STA $0941` is `missile`'s own `mem[HIT] = 1` - the same address - so a hit here is
 * already recorded by the time this returns, and `debrisFrame` picks it up at `$10D8`.
 *
 * @param {Uint8Array} mem
 * @param {import('./math.js').Math24} math
 * @param {(address: number) => number} dir the directory at $08F2
 * @param {object} opts `missile` is `entities.js`'s, passed in so this file keeps its one
 *   direction of dependency; `rotatedIndices` reproduces what this copy does, and `carry` is
 *   the bit that rotation takes in - the flag `$1016 JSR $9C4B` left, which MATH's model does
 *   not carry, so the harness supplies the machine's
 */
export function shotAdvance(mem, math, dir, { missile, rotatedIndices = false, carry = 0 }) {
  const r = missile(mem, math, baseStarClass(dir), { staleZ: rotatedIndices });
  // `flying` is the gate at `$0FAC`: with the shot not up, `$0FB3` leaves the block and
  // `$101C` never runs, so the byte is only damaged on the frames the shot is in the air.
  if (rotatedIndices && r.flying) {
    // $101C ROL $0914 - the other half of what the rotation does. The substituted index is
    // what the block uses this frame; this is the damage it leaves for the next one, and it
    // is applied after the fact because nothing between $101C and the end of the block reads
    // the byte again.
    const at = ROTATED_INDICES[1].operand;
    mem[at] = rotate(mem[at], carry).value;
  }
  return r;
}

// ---------------------------------------------------------------------------------------
// $0957-$09A6 - the entry, which is everything before the frame starts.
//
// Thirty instructions, and nothing in them is a surprise once the rest of the file is read:
// the hit range is set, the stage counter cleared, the keyboard strobe cleared, both hi-res
// pages primed, the page toggle cleared, and the viewer's X published. Then `$09A7` begins
// the frame, which is `loop.js`'s `Game.pass` at `$09A3`, four bytes along.
//
// **The hit range is fifteen, and it is set here rather than built into the data.** `$0958
// LDY $092F / LDA #$0F / STA $9801,Y` writes the *middle* byte of the entry, which is the
// integer part - the table is byte-indexed little-endian, so the low byte is a fraction this
// leaves alone. `$092F` is the same threshold an enemy rams the ship at in the main mission.
//
// **The two renders prime both pages.** `$8110` takes $54 then $55, the low bytes of the two
// page soft switches, and the clear and draw operands take 1 then 0 - which is `selectPages`
// with the toggle at 0 and then at 1. Running the renderer once for each means neither page
// is showing whatever was left in it when the mission before this one ended.

/** `$0958` - fifteen, into the middle byte of `$092F`'s entry. */
export const ENTRY_HIT_RANGE = 0x0F;

/** $C010 - the keyboard strobe, cleared at `$096A` by a write of any value. */
export const STROBE = 0xC010;

/**
 * `$0957`-`$09A6` - set the mission up, and leave the frame to run.
 *
 * @param {Uint8Array} mem a 64K image: the display list at $80FB and the state at $0900
 * @param {import('./math.js').Math24} math
 * @param {(address: number) => number} dir the directory at $08F2
 * @param {object} [opts] `render` is called for each of the two priming passes
 * @returns {{renders: number}}
 */
export function enter(mem, math, dir, { render = () => {} } = {}) {
  // $0958 - the middle byte only. The other two are whatever the data file left.
  math.table[(dir(HIT_RANGE) + 1) & 0xff] = ENTRY_HIT_RANGE;

  mem[PROGRESS] = 0;                        // $0960 LDA #$00 / STA $1FF7
  mem[STROBE] = 0;                          // $096A STX $C010

  // $096D, $097D - once with the toggle at 0 and once at 1, so both pages are drawn.
  let renders = 0;
  for (const toggle of [0, 1]) {
    mem[PAGE] = toggle;
    selectPages(mem);
    render();                               // $097A, $098A JSR $6000
    renders += 1;
  }

  // $098D - and the toggle starts the frame at zero, whatever the priming left it.
  // `TOGGLE` and `loop.js`'s `PAGE` are the same byte under two names.
  mem[TOGGLE] = 0;

  // $0992 - the viewer's X, into the VIEWER instruction and object 12's record. This is
  // `publishShip` with the Z half left out: the entry publishes one axis, and the frame
  // publishes both from $0A63 onward.
  publishShip(mem, math, { axes: ['x'] });

  return { renders };
}

// ---------------------------------------------------------------------------------------
// $0E2C-$0E47 - the base star reaches the ship, and does not die for it.
//
// Ten instructions, and the main mission has the same ten at `$0E05` with the last three
// different - which is the whole difference between an enemy and the base star:
//
//     main    LDX #$01 / STX $0942      the ram flag
//             LDX #$00 / STX $8131 / STX $8255      object 1's count and its twin's: dead
//     finale  LDX #$01 / STX $0942      the same flag
//                        STX $814B / STX $826F      object 3's count and its twin's: ONE
//             DEC $1FFB                 and the third wave counter goes down
//
// **Ramming the ship kills a main-mission enemy and does not kill the base star.** Its count
// goes to 1 rather than 0, so it is still there next frame - and `$814B` at 1 is also what
// keeps `endOfFrame`'s "is the field empty" test from ending the mission.
//
// **The compare is the award block's compare with the branch the other way up.** `LDY $092F /
// LDX $090A / JSR $99D2 / BPL` - the same threshold and the same range, but here `BPL` is the
// branch that *acts* rather than the one that skips. `BPL` is taken on zero either way, so a
// range exactly equal to the threshold **is** a ram and **is not** an award.

/** $1FFB - the third wave counter, which only this block decrements in the finale. */
export const WAVE3 = 0x1FFB;

/**
 * `$0E2C`-`$0E47` - is the base star on top of the ship?
 *
 * @param {Uint8Array} mem
 * @param {import('./math.js').Math24} math
 * @param {object} geom `GEOM` and `dir`
 * @returns {{reached: boolean}}
 */
export function reached(mem, math, { GEOM, dir }) {
  // $0E32 - the threshold is the Y operand here and the range is the X one, so this is the
  // award block's comparison with its arguments swapped as well as its branch.
  if (math.compare(GEOM.range, dir(HIT_RANGE)) < 0) return { reached: false };  // $0E37

  mem[DAMAGE_FLAGS[0].flag] = 1;                      // $0E3C STX $0942
  mem[OBJ3_COUNT] = 1;                                // $0E3F STX $814B
  mem[field(15, 'count')] = 1;                        // $0E42 STX $826F
  mem[WAVE3] = (mem[WAVE3] - 1) & 0xff;               // $0E45 DEC $1FFB
  return { reached: true };
}

// ---------------------------------------------------------------------------------------
// $0957-$112E - the mission, as one class.
//
// This is `loop.js`'s `Game` with a handful of substitutions, and that is the shape of it: the
// frame at `$09A7` is `Game.pass`'s `$09A3` four bytes along, and `probe_basestar.mjs` accounts
// for 1,070 of the finale's 1,369 instructions as the main mission's at a different address.
// The two missions are the same port, driven differently.
//
// **One enemy, not three.** The finale's frame has a single enemy region, and the objects its
// code touches say which: object 3 and its twin 15 as the enemy, 5 and 17 as its shot, 6 and 7
// as the player's two shots, 8-11 and 20-23 for debris, 12 for the thing that turns with the
// ship. Objects 1, 4, 13, 14 and 16 are **never touched** - there is no class 1 or class 2
// here, and no class-1 missile. Which is why `BASE_STAR_CLASS` is class 3's descriptor and
// nothing new was needed.
//
// **The tail is a different shape.** `Game.pass` ends with the debris ticks, the render, the
// page toggle, the sound flags, the three awards, `applyDamage` and two ways out. The finale
// ends with `debrisFrame` - which holds its own render and toggle, services the two one-shot
// sound flags and then the two damage flags the base star set - and `endOfFrame`, which has
// four ways out rather than two. Its awards are not in the tail at all: they are inside the
// enemy region, fired by the shot-hit tests, which is what makes a kill score once.
//
// **Two numbers differ, and both matter in play.** Warp burns a unit every 38 frames instead
// of 55, and pulling the trigger takes two off the missile bar instead of one. The second is
// not an immediate: both missions enter `shrink`'s four-instruction loop partway in, and the
// finale enters one step earlier. Measured in the machine, both of them.

/** `$0AAC CPX #$26` - frames per unit of warp, against the main mission's `$37`. */
export const BURN_FRAMES = 0x26;

/** `$0B2D LDY #$03` - where the trigger enters `shrink`, against the main mission's `#$04`. */
export const FINALE_MISSILE_ENTRY = 3;

export class Finale {
  /**
   * @param {Uint8Array} mem a 64K image with A2-3D2 at $6000, SV DATA2 at $80FB, BASE STAR
   *   DATA at $83AE and BASE STAR.OBJ0 at $08EF - what `SD START2` leaves resident
   * @param {object} [options]
   * @param {boolean} [options.render] false drives the frame with no renderer, which means no
   *   object ever expires, because the count is the renderer's to decrement
   * @param {boolean} [options.rotatedIndices] true reproduces the two instructions this copy
   *   of the binary has wrong instead of repairing them
   */
  constructor(mem, { render = true, rotatedIndices = false } = {}) {
    this.mem = mem;
    this.rotatedIndices = rotatedIndices;
    this.math = new Math24();
    this.math.table.set(TABLE_INIT, 0);
    this.flight = new Flight(this.math, { burnFrames: BURN_FRAMES });
    // The hi-res pages are memory, so the renderer draws into the image rather than a buffer.
    this.engine = render
      ? new Engine(mem, {
        pages: [mem.subarray(0x2000, 0x4000), mem.subarray(0x4000, 0x6000)],
      })
      : null;
    /** What the frame asked the sound to play, in order. Phase 6 is not wired up. */
    this.sounds = [];
  }

  /** The renderer, where `$106E` and the entry call it. */
  render() {
    if (!this.engine) return;
    this.engine.reset();
    this.engine.run();
  }

  /** `$0957`-`$09A6` - once, before the frame. */
  enter() {
    return enter(this.mem, this.math, dir, { render: () => this.render() });
  }

  /**
   * `$0C08`-`$103D` - the one enemy region: the base star, and its shot.
   *
   * `$0C09 LDX $814B / CPX #$01 / BCS` is the gate and `$0C10 JMP $0FAC` is where it goes when
   * the base star is not there - straight to the shot, which keeps flying either way.
   */
  enemy() {
    const { mem, math } = this;
    const c = baseStarClass(dir);

    if (mem[field(BASE_STAR_CLASS.enemy, 'count')] >= 1) {       // $0C09
      const target = GEOM.targets[2];                            // $0C13, on $0930/$0931
      rangeToTarget(math, target.x, target.z);
      bearing(math);                                             // $0C5E

      aimAndFire(mem, math, dir);                                // $0D5F

      // $0E2C, and $0E48 - **the ram does not finish the base star off.** It sets the damage
      // flag, puts object 3's count to 1, takes the third wave counter down, and then falls
      // into `JSR $16EC`, which is class 3's respawn: the count goes straight back to 255 and
      // the base star reappears a bump further out. Measured by watching $814B through a real
      // frame - $0E3F puts it to 1 and $16F6 puts it back - which is how this call was found
      // missing in the first place.
      if (reached(mem, math, { GEOM, dir }).reached) {
        respawn(mem, math, c, true, [c]);                        // $0E48 JSR $16EC
      }

      // $0E48 - a cooling base star jumps past the hold test, so it always moves.
      if (coolDown(mem, c) || !hold(math)) move(mem, math, c);    // $0E66

      // $0F1C, $0F64 - the player's two shots, each gated on its own count. The award scores,
      // loads a debris counter, and then runs `kill.js`'s three: the debris placed where the
      // SHOT is rather than where the enemy is, the shot switched off, and the debris aimed.
      for (const [which, shot] of PLAYER_SHOTS.entries()) {
        if (mem[field(shot.object, 'count')] === 0) continue;
        const r = hitTest(mem, math, which, {
          rangeFromArgs, GEOM, dir, rotatedIndices: this.rotatedIndices,
        });
        if (!r.hit) continue;
        award(mem, which,
          { placeDebris, switchOffShot, aimDebris, SHOTS: PLAYER_SHOTS });
      }
    }

    // $0FAC - and the base star's shot moves whether the base star is there or not.
    return shotAdvance(mem, math, dir, { missile, rotatedIndices: this.rotatedIndices });
  }

  /**
   * `$09A7`-`$112E` - one pass of the frame.
   *
   * @param {object} input
   * @param {number} input.paddle0 what PREAD would return for the steering paddle
   * @param {number} input.paddle1 and for the throttle
   * @param {boolean} input.button0 BUTTON0, the trigger
   * @param {number} input.latch $C000, which `$1107` reads to decide whether to pause
   * @returns {{done: string|null, paused: boolean, stage: boolean, sounds: number[]}}
   */
  pass({ paddle0 = 128, paddle1 = 255, button0 = false, latch = 0 } = {}) {
    const { mem, math } = this;
    this.sounds = [];

    // $09A7 - the controls, which are `controls.js`'s and held against the machine already.
    const heading = steer(mem[H1], paddle0);
    const turn = turnDirection(paddle0);
    mem[H1] = heading;
    mem[OBJ12_HEADING] = heading;
    if (turn !== 0) panStars(mem, turn);

    this.flight.step(heading);                                   // $09D5
    publishShip(mem, math);                                      // $0A67

    mem[WARP] = this.flight.throttle(paddle1, mem[WARP]);        // $0A96
    mem[GATE] = this.flight.gate;
    mem[BURN] = this.flight.burnCounter;
    selectPages(mem);                                            // $0AC0

    // $0ADF - the trigger, and two off the bar rather than one.
    const shot = pullTrigger(mem, math, button0, { cost: FINALE_MISSILE_ENTRY });
    if (shot.sound) this.sounds.push(shot.sound);
    for (const s of PLAYER_SHOTS) moveShot(mem, math, s);        // $0B6E, $0BBB

    this.enemy();                                                // $0C08-$103D

    // $1046 - the debris, the render, the toggle, the sound flags and the damage. The render
    // is inside this block in the finale, where the main mission has it in the frame's tail.
    const debris = debrisFrame(mem, shrink);
    for (const call of debris.calls) {
      if (call === DEBRIS_CALLS.render) this.render();
      else if (call !== DEBRIS_CALLS.draw) this.sounds.push(call);
    }

    // $10E5 - and the four ways out.
    return { ...endOfFrame(mem, { latch }), sounds: this.sounds };
  }
}
