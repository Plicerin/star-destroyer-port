// The final mission's end-of-frame block: how the base star dies, and how you do.
//
// `BASE STAR.OBJ0` is the same *engine* as the main mission - same entry at `$0957`, same
// eleven MATH entry points, same renderer, same paddle read - but it is **not the same code**.
// The two binaries share exactly 105 bytes, the MATH directory they both read through, and
// nothing else: 4% of 5,890 bytes match, and every routine the port knows by address in the
// main mission is at a different address here. So this is a transliteration, not a reuse.
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
 * `$14FB` and `$15C5` are the finale's own and are not ported. `$6000` is A2-3D2, which the
 * port has had since phase 1.
 */
export const DEBRIS_CALLS = { draw: 0x14FB, render: 0x6000, stagedWin: 0x15C5 };

/**
 * `$103E`-`$10AA` - tick the debris, render, service the flags, and test for the staged win.
 *
 * @returns {{calls: number[], won: boolean}} `won` is `$10A7`, which does **not** end the
 *   mission: `$10AA` jumps back into the frame and it carries on to the block above.
 */
export function debrisFrame(mem) {
  const calls = [];
  mem[0x8289] = 0;                                           // $1040
  mem[0x8165] = 0;                                           // $1043

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
  if (mem[DEBRIS[0]] !== 0 && mem[DEBRIS[0]] >= DEBRIS_WIN) {
    calls.push(DEBRIS_CALLS.stagedWin, DEBRIS_CALLS.stagedWin);   // $10A1, $10A4
    mem[BASE_STAR] = (mem[BASE_STAR] + 1) & 0xff;                 // $10A7
    return { calls, won: true };                                  // $10AA - and it goes on
  }
  return { calls, won: false };
}

// ---------------------------------------------------------------------------------------
// The two award blocks, $0F21-$0F61 and $0F69-$0FA9 - and a one-bit difference between them.
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
// **The second block has `ROL $0907` where the first has `LDX $0906`.** The bytes are
// `AE 06 09` against `2E 07 09` - one bit of one opcode - with identical alignment either
// side, so it is not a disassembly artefact. Measured in the machine: it rotates `$0907`
// left through carry ($12 becomes $24, or $25 with carry in; $81 becomes $02) and leaves X
// holding whatever `$0F75 LDX $0930` put there. So the second block corrupts its own operand
// every time it runs, and hands MATH the previous one twice.
//
// Whether that was a typo or bit rot is not knowable from here. What it does is measurable,
// so it is written as what it does. `$0907` is one of the bytes this file has never managed
// to name, and now there is a reason to want to: it is the one the game damages itself.

/** $1FF7 again, by the only two instructions that raise it: `$0F53` and `$0F9B`. */
export const AWARD_SITES = [0x0F53, 0x0F9B];

/** `LDA #$04` - what each block loads into its class's debris counter. */
export const DEBRIS_ON_KILL = 4;

/** `$0F64 LDX $817F / BEQ` - object 7's count, which gates the second block entirely. */
export const SECOND_GATE = 0x817F;

/** $0907 - the byte `$0F7E` rotates instead of loading. */
export const ROTATED = 0x0907;

/**
 * What each block calls when the kill lands.
 *
 * The third of each three is already written: `$1278` is `kill.js`'s `$1A8B` relocated and
 * `$12B4` is its `$1AC7` - the routine that aims the debris along the shot's heading. The
 * first two of each, `$119E`/`$120B` and `$1755`/`$175B`, are the finale's own and are not.
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
export function award(mem, which) {
  const { debris, calls } = AWARD_CALLS[which];
  mem[PROGRESS] = (mem[PROGRESS] + 1) & 0xff;          // $0F53 / $0F9B INC $1FF7
  mem[debris] = DEBRIS_ON_KILL;                        // $0F56 / $0F9E LDA #$04
  return { calls: [...calls], debris };
}

// ---------------------------------------------------------------------------------------
// The hit test above each award, $0F21-$0F51 and $0F69-$0F99.
//
// **The routine it turns on is already written.** `$142A` is the main mission's `$1C3D`
// relocated and otherwise untouched - 26 instructions, same operands, same MATH calls, same
// order, not one difference - so `geometry.js`'s `rangeFromArgs` is reused exactly. That is
// the only routine the two binaries genuinely share beyond the MATH directory and the shrink
// primitive, and it is worth saying out loud: the finale's weapons use the main mission's
// range.
//
// The idiom is `kill.js`'s, to the instruction: four `JSR $9C4B` calls to fill `$1C3D`'s
// argument slots, the range, then `LDY $090A / LDX $092F / JSR $99D2 / BPL` - the same
// `$092F` threshold an enemy rams the ship at, and the same "range <= threshold is a hit"
// including the equality.
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
 * @param {{copy: Function, compare: Function}} geom `rangeFromArgs`, passed in so this file
 *   does not reach across into the main mission's modules for anything but the arithmetic
 *   and `carry` for the flag `$0F7E` rotates in, which MATH's model does not carry
 * @returns {{hit: boolean, stale: boolean}} `stale` marks the copy the ROL spoiled
 */
export function hitTest(mem, math, which, { rangeFromArgs, GEOM, dir, carry = 0 }) {
  const shot = SHOTS[which];
  // Every operand goes through the directory at $08F2, because `JSR $9C4B` takes table
  // indices and not addresses - which is what these are written as above.
  math.copy(dir(shot.x), GEOM.aX);                  // $0F21 / $0F69
  math.copy(dir(TARGET.x), GEOM.bX);                // $0F2A / $0F72
  // $0F33 / $0F7B: block A loads $0906 here. Block B's LDX is a ROL, so X is never loaded
  // and keeps whatever the copy above left in it - and `$9C4B` walks X forward three bytes
  // as it copies, so it ends on the index *after* its source. Table entries are three bytes,
  // so "three past $0930" is exactly $0931. Measured: X is 218, which is $0931's index.
  //
  // So block B copies the target's Z into **both** points: aZ and bZ get the same value, the
  // Z delta is always zero, and the range it measures is the X distance alone. The second
  // weapon hits on how far across the target is and not on how far away.
  const stale = which === 1;
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
  // $0F4E / $0F96 - range <= threshold is a hit, equality included.
  return { hit: math.compare(GEOM.range, dir(HIT_RANGE)) >= 0, stale };
}
