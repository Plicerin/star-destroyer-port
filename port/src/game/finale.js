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
 * The two subroutines the fifteenth stage calls, which are not ported.
 *
 * Named rather than dropped, the same way `damage.js` names its sounds, so the chain through
 * this block is complete and the gap is visible.
 */
export const STAGE_CALLS = [0x1131, 0x12AB];

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
