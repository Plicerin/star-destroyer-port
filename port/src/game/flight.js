// The ship's movement: how the frame loop turns a heading and a throttle into a position.
//
// This is the part of the loop between $09D1 and $0A60, and it is the reason MATH exists.
// Reading it in order:
//
//     $09D1  LDX H1.heading / STX $0949      the heading, taken from the display list
//     $09D7  LDX $0948 / BEQ $0A09           the warp gate - skip it all when closed
//     $09DC  JSR $1AE8                       build the two step operands
//     $09DF  LDY stepX / LDX speed
//     $09E5  JSR $9A65                       ACC := stepX * 256 / speed
//     $09E8  LDX posX / JSR $999B            ACC += posX
//     $09EE  LDY posX / JSR $9C7A            posX := ACC
//     $09F4  ... the same for Z ...
//     $0A09  four compare-and-copy pairs     wrap at the edges of the world
//     $0A63  publish the top two bytes       into XI, ZI and object 12
//
// **Position is 24-bit, the coordinate is its top two bytes.** $0A66 reads `$9801,Y` and
// `$9802,Y` - the middle and high bytes - so the lowest byte of a position is a fraction the
// display never sees. That is what lets the ship move at a fraction of a unit per frame and
// still hand the renderer whole numbers.
//
// **The throttle is a divisor, not a multiplier.** `speed` names a table entry holding 1280,
// and the step is `heading * 256 * 256 / 1280`, so a larger value there means a slower ship.
//
// **The world wraps.** Fall off one edge and you reappear at the other: X at the entries
// named maxX and minX, which hold +786432 and -786432 - coordinates +3072 and -3072 - and Z
// at maxZ and minZ, which hold +409600 and -344064, or +1600 and -1344. The Z bounds are not
// symmetric, and the port does not tidy that up.
//
// Every claim here is measured by oracle/probe_flight.mjs and held against the real frame
// loop, frame by frame, by oracle/parity_flight.mjs.
import { Math24 } from './math.js';
import { HEADING_X, HEADING_Z, TABLE_INIT, VAR } from './tables.js';

/** $0948 - the warp gate. The whole movement block is skipped when it is zero. */
export const GATE_OPEN = 0xFF;

/** $0A8D - paddle 1 engages warp below this reading. */
export const WARP_THRESHOLD = 0x5A;

/** $0A99 - WARP ($81F3) is exhausted at this value, and warp will not engage. */
export const WARP_EMPTY = 0xC7;

/** $0AA8 - frames per unit of warp burned, from `CPX #$37`. */
export const WARP_FRAMES_PER_UNIT = 0x37;

/**
 * $1AE8 - build the two step operands from a heading.
 *
 * Shared, because two blocks call it: the movement block at $09DC, and the enemy dispatch
 * when it launches a missile. The routine reads the heading out of $0949 and always writes
 * the entries named by $0915 and $0916, so a launch overwrites the ship's step operands -
 * which is harmless only because the movement block rebuilds them before every use.
 *
 * Each component is one signed byte out of HEADING DATA, written into a 3-byte entry as the
 * MIDDLE byte with a zero low byte and a sign-extended high byte. So the entry is the
 * component times 256, which is the whole-number part of a coordinate with no fraction.
 *
 * The sign extension is done by hand and the test is worth keeping exactly: `CMP #$7F` then
 * `BCC`/`BEQ` to the zero branch, otherwise $FF. That makes $7F positive and $80 negative,
 * which is the ordinary boundary - but it is spelled as two branches rather than a BMI, and
 * $7F is handled by the equality branch, so a transliteration should not collapse it into
 * something that merely agrees on these tables.
 *
 * @param {Math24} math
 * @param {number} heading the byte $1AE8 finds in $0949
 */
export function buildStepOperands(math, heading) {
  for (const [component, index] of [
    [HEADING_X(heading), VAR.stepX],
    [HEADING_Z(heading), VAR.stepZ],
  ]) {
    const byte = component & 0xff;
    math.table[(index + 1) & 0xff] = byte;
    math.table[(index + 2) & 0xff] = byte >= 0x80 ? 0xFF : 0x00;
    math.table[index & 0xff] = 0x00;
  }
}

export class Flight {
  constructor() {
    this.math = new Math24();
    this.math.table.set(TABLE_INIT, 0);
    /** $0948, the gate. */
    this.gate = 0;
    /** $0956, the counter that paces warp consumption. */
    this.burnCounter = 0;
    /** $0949, the heading as the loop saved it this frame. */
    this.heading = 0;
  }

  /** The coordinate the renderer sees: a position's top two bytes, signed. */
  coordinate(index) {
    const t = this.math.table;
    const lo = t[(index + 1) & 0xff], hi = t[(index + 2) & 0xff];
    const v = lo | (hi << 8);
    return v > 0x7FFF ? v - 0x10000 : v;
  }

  get x() { return this.coordinate(VAR.posX); }

  get z() { return this.coordinate(VAR.posZ); }

  /** The full 24-bit position, fraction included. */
  get positionX() { return this.math.read(VAR.posX); }

  get positionZ() { return this.math.read(VAR.posZ); }

  /** $09DC - `JSR $1AE8`, with the heading this pass saved into $0949. */
  buildSteps() {
    buildStepOperands(this.math, this.heading);
  }

  /**
   * $09DF-$0A06 - advance the position along the heading.
   *
   * Three MATH instructions per axis, and the accumulator is what carries the value between
   * them: divide leaves the step in ACC, add puts the current position on top of it, store
   * writes it back. Nothing is held in a local.
   */
  advance() {
    const m = this.math;
    for (const [step, pos] of [[VAR.stepX, VAR.posX], [VAR.stepZ, VAR.posZ]]) {
      m.divide(VAR.speed, step);
      m.add(pos);
      m.storeAcc(pos);
    }
  }

  /**
   * $0A09-$0A60 - wrap at the edges of the world.
   *
   * Four pairs, each a signed compare followed by a copy of the opposite bound, and each
   * pair jumps straight past the rest on success - so at most one wrap happens per frame.
   * The compare's answer is read as the original reads it: `BPL` taken means the X operand
   * is not above the Y operand.
   */
  wrap() {
    const m = this.math;
    // Below the minimum in X: come back at the maximum.
    if (!(m.compare(VAR.minX, VAR.posX) >= 0)) {
      m.copy(VAR.maxX, VAR.posX);
      return;
    }
    // Above the maximum in X: come back at the minimum.
    if (!(m.compare(VAR.posX, VAR.maxX) >= 0)) {
      m.copy(VAR.minX, VAR.posX);
      return;
    }
    if (!(m.compare(VAR.minZ, VAR.posZ) >= 0)) {
      m.copy(VAR.maxZ, VAR.posZ);
      return;
    }
    if (!(m.compare(VAR.posZ, VAR.maxZ) >= 0)) {
      m.copy(VAR.minZ, VAR.posZ);
    }
  }

  /**
   * $0A8D - the throttle, read from paddle 1.
   *
   * Warp engages when the paddle reads below the threshold AND there is warp left. While it
   * is engaged a counter ticks, and every 55 frames one unit of WARP is spent. The gate this
   * sets is read by the NEXT frame's movement block, because $09D7 comes before $0A8D in the
   * loop - so throttling on takes a frame to bite.
   *
   * @param {number} paddle the PREAD result for paddle 1
   * @param {number} warpLeft the WARP field, $81F3 in the display list
   * @returns {number} the new WARP value
   */
  throttle(paddle, warpLeft) {
    if (paddle >= WARP_THRESHOLD || warpLeft === WARP_EMPTY) {
      this.gate = 0;
      return warpLeft;
    }
    this.gate = GATE_OPEN;
    this.burnCounter = (this.burnCounter + 1) & 0xff;
    if (this.burnCounter === WARP_FRAMES_PER_UNIT) {
      this.burnCounter = 0;
      return (warpLeft - 1) & 0xff;
    }
    return warpLeft;
  }

  /**
   * One frame of the movement block, in the loop's order: take the heading, move if the gate
   * is open, then wrap whether it is or not. $0A09 is the branch target of the closed gate,
   * so the wrap runs every frame.
   *
   * @param {number} heading H1.heading, $811E in the display list
   */
  step(heading) {
    this.heading = heading & 0xff;
    if (this.gate !== 0) {
      this.buildSteps();
      this.advance();
    }
    this.wrap();
  }
}
