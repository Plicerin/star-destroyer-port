// MATH ($98F3) - a 24-bit signed accumulator machine.
//
// The renderer has its own arithmetic ($6480 multiply, $65DE divide, Q15 over 16-bit values).
// This is a separate, wider set, and it is not a library of pure functions: it is a little
// machine with registers in zero page, driven by the frame loop one instruction at a time.
// A typical sequence out of the loop at $09E5 reads
//
//     JSR $9A65     ; ACC := table[Y] * 256 / table[X]
//     JSR $999B     ; ACC += table[X]
//     JSR $9C7A     ; table[Y] := ACC
//
// which only makes sense once ACC is seen as a register that persists between calls.
//
// **The registers**, all 24-bit little-endian in zero page:
//   ACC  $FA-$FC   the accumulator, signed
//   B    $EB-$ED   the operand, signed
//   EXT  $FD-$FF   the extension: the divide's remainder, the multiply's high half
//   R3   $03-$05   a spare, through $9C9A / $9CB8 / $9CC2
//   R7   $07-$09   a spare, through $9C90 / $9CA4 / $9CAE
//   $CE            the sign flag the multiply and divide use internally
//   $CF            a second sign, saved across $9C04
//   $EE            where $9C5C parks X across its own use of it
//   $F9            the byte the multiply shifts off the bottom of its product
//
// **Entries and bodies.** Most entry points are a couple of loads followed by a body, and the
// bodies are entered directly from elsewhere in the file - $9AD0 calls $999E (add), $99D8
// (compare) and $9A6E (divide) without any loads, because it is driving them in a loop over
// registers it has already arranged. So the port is split the same way: `addB`, `subB`,
// `compareB`, `multiplyBody`, `divideBody` and `magnitudes` act on the registers, and the
// public entries compose them. Keeping that split is what lets the square root below be a
// transliteration rather than a model of one.
//
// **The table** is byte-indexed from $9800, not entry-indexed: an index is a byte offset and
// a value is the three bytes at it. Entries are conventionally 3 apart, so most indices are
// multiples of 3, but the frame loop uses others too - a trace of 60 frames under warp shows
// X and Y at 66, 69, 75, 121, 124 and 167 - so the table is modelled as bytes. The usable
// extent is $9800-$98F2, 243 bytes, because MATH's own code starts at $98F3.
//
// **No index bookkeeping.** The real routines advance X and Y - $9C5C adds 3 to Y, $9C6C
// leaves X at zero, $99D2 exits its compare loop with both holding whatever the data led to -
// and none of that is modelled, because nothing reads it. All 229 MATH call sites in the
// binary set every index they use immediately before the call; probe_math.mjs checks that,
// and the frame loop at $09E5 shows the style: LDY, LDX, JSR, LDX, JSR, LDY, JSR. Modelling
// the exits would be modelling a measurement no caller consumes.
//
// Everything here is read off the disassembly and then held against the real thing by
// oracle/parity_gamemath.mjs. Two earlier black-box readings of this file were wrong in a way
// worth recording: $999B looked like "return the entry's high byte" and $9C7A like "zero the
// entry", both measured repeatably across a sweep of inputs. They are add and
// store-accumulator; the measurements only looked like that because ACC happened to be zero
// in the machine state the harness restored. A sweep over inputs cannot see a register it
// never varies.

import { ATAN_THRESHOLD } from './tables.js';

/** The table's base in Apple II memory, for cross-referencing the listing. */
export const TABLE_BASE = 0x9800;

/** Usable table bytes: MATH's own code begins at $98F3. */
export const TABLE_BYTES = 0xF3;

/** Wrap to signed 24 bits. The routines wrap; none of them saturate. */
export const wrap24 = (v) => {
  const m = v & 0xFFFFFF;
  return m > 0x7FFFFF ? m - 0x1000000 : m;
};

/**
 * The 24-bit pattern a register holds, as an unsigned number.
 *
 * The bodies need this because they do unsigned arithmetic on bit patterns, not signed
 * arithmetic on values. $9B00 is supposed to leave a magnitude, but it negates in place and
 * the negate wraps - so $800000, the most negative value there is, comes out as itself and a
 * body that read it as signed would run with a negative dividend. The 6502 never sees a sign
 * there; it sees three bytes.
 */
const u24 = (v) => v & 0xFFFFFF;

export class Math24 {
  constructor() {
    /** The $9800 table, byte-addressed. */
    this.table = new Uint8Array(0x100);
    /** ACC, $FA-$FC. */
    this.acc = 0;
    /** B, $EB-$ED. */
    this.b = 0;
    /** EXT, $FD-$FF - the divide's remainder. Unsigned: it is a magnitude. */
    this.ext = 0;
    /** $CE, the sign flag the divide sets and then acts on. */
    this.sign = 0;
    /** $EE, where $9C5C parks X. Modelled because the game can read it back. */
    this.savedX = 0;
    /** $CF, the sign $9C04 saves across its own work. */
    this.sign2 = 0;
    /** R3, $03-$05. */
    this.r3 = 0;
    /** R7, $07-$09. */
    this.r7 = 0;
    /** $F9, the low byte the multiply discards. The game can read it, so it is kept. */
    this.productLow = 0;
  }

  /** Read the three bytes at a byte offset as a signed 24-bit value. */
  read(i) {
    return wrap24(this.table[i & 0xff]
      | (this.table[(i + 1) & 0xff] << 8)
      | (this.table[(i + 2) & 0xff] << 16));
  }

  /** Write a signed 24-bit value as three bytes at a byte offset. */
  write(i, v) {
    const m = v & 0xFFFFFF;
    this.table[i & 0xff] = m & 0xff;
    this.table[(i + 1) & 0xff] = (m >> 8) & 0xff;
    this.table[(i + 2) & 0xff] = (m >> 16) & 0xff;
  }

  /** $9C5C - ACC := table[Y]. X is preserved, parked in $EE on the way. */
  loadAcc(x, y) {
    this.savedX = x & 0xff;
    this.acc = this.read(y);
  }

  /** $9C6C - B := table[X]. */
  loadB(x) {
    this.b = this.read(x);
  }

  /** $9C7A - table[Y] := ACC. */
  storeAcc(y) {
    this.write(y, this.acc);
  }

  /** $9C4B - table[Y] := table[X], three bytes. */
  copy(x, y) {
    for (let k = 0; k < 3; k++) this.table[(y + k) & 0xff] = this.table[(x + k) & 0xff];
  }

  /** $999E - the add body: ACC += B, 24-bit with carry. */
  addB() {
    this.acc = wrap24(this.acc + this.b);
  }

  /** $99B1 - the subtract body: ACC -= B. */
  subB() {
    this.acc = wrap24(this.acc - this.b);
  }

  /**
   * $99D8 - the compare body: ACC against B, signed.
   * @returns {number} +1 when B < ACC, -1 when greater, 0 when equal
   */
  compareB() {
    return this.b < this.acc ? 1 : this.b > this.acc ? -1 : 0;
  }

  /**
   * $9B00 - take both magnitudes in place and record whether the signs disagreed.
   *
   * It counts rather than tests: Y starts at zero, decrements if ACC was negative and
   * increments if B was, so $CE ends non-zero exactly when one of the two was negative. Both
   * registers are left positive, which is observable - a later instruction that reads B after
   * a multiply or divide sees the magnitude.
   */
  magnitudes() {
    let y = 0;
    if (this.acc < 0) {
      this.acc = wrap24(-this.acc);
      y -= 1;
    }
    if (this.b < 0) {
      y += 1;
      this.b = wrap24(-this.b);
    }
    this.sign = y & 0xff;
  }

  /**
   * $9A6E - the divide body, on registers already arranged: ACC := ACC * 256 / B, remainder
   * into EXT, then negate ACC if $CE says the signs disagreed.
   *
   * A restoring division. The dividend is shifted up one byte, which is where the * 256 comes
   * from and makes the quotient 8.16 fixed point, so $000100 is 1.0. Then 24 rounds of
   * shift-and-trial-subtract, the quotient accumulating in ACC and the remainder left in EXT.
   *
   * Neither edge is guarded and the port keeps it that way. With a zero divisor every trial
   * subtraction succeeds, so the quotient fills with ones - $FFFFFF, or +1 after the sign
   * fix-up - and EXT keeps the shifted dividend. And the quotient register is 24 bits, so a
   * quotient that does not fit wraps into it and the answer is meaningless. The domain
   * condition is on the QUOTIENT: 65535*256/1 is fine at $FFFF00 and 65536*256/256 is fine,
   * but 65536*256/1 is not.
   *
   * @returns {{inDomain: boolean}} false where the original produces something this does not
   */
  divideBody() {
    const num = u24(this.acc) * 256, den = u24(this.b);
    if (den === 0) {
      this.ext = num & 0xFFFFFF;
      this.acc = wrap24(this.sign ? -0xFFFFFF : 0xFFFFFF);
      return { inDomain: true };
    }
    const q = Math.trunc(num / den);
    this.ext = num % den;
    this.acc = wrap24(this.sign ? -q : q);
    return { inDomain: q < 0x1000000 };
  }

  /**
   * $9A20 - the multiply body: ACC := ACC * B / 256, then negate if the signs disagreed.
   *
   * The mirror of the divide. A 48-bit shift-add product is built across $F9-$FE and ACC is
   * bytes $FA-$FC of it, which is the product's bits 8 to 31 - so the result is the product
   * divided by 256, truncated, with the discarded low byte left in $F9. Together with the
   * divide's * 256 that makes a consistent fixed point: a stored value is its quantity times
   * 256 throughout.
   */
  multiplyBody() {
    const p = u24(this.acc) * u24(this.b);
    this.productLow = p % 256;
    const q = Math.trunc(p / 256);
    // The product is 48 bits across $F9-$FE. ACC takes bytes 1 to 3; bytes 4 and 5 land in
    // $FD and $FE, which are the low two bytes of EXT. $FF is not part of the chain and keeps
    // whatever it held, so EXT's top byte survives a multiply.
    this.ext = (Math.floor(p / 0x100000000) & 0xFFFF) | (this.ext & 0xFF0000);
    this.acc = wrap24(this.sign ? -q : q);
  }

  /**
   * $999B - ACC += table[X]. It loads B and adds that, leaving ACC as whatever the previous
   * instruction put there: this is the read-modify-write half of the loop's position update.
   */
  add(x) {
    this.loadB(x);
    this.addB();
  }

  /** $9998 - ACC := table[Y] + table[X]. The whole add, where $999B is only its tail. */
  addFrom(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    this.addB();
  }

  /** $99AB - ACC := table[Y] - table[X]. */
  sub(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    this.subB();
  }

  /**
   * $99D2 - signed comparison of table[Y] against table[X], loading both. The call sites
   * follow it with BPL, so a non-negative answer means "table[X] is not above table[Y]".
   * @returns {number} +1 when table[X] < table[Y], -1 when greater, 0 when equal
   */
  compare(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    return this.compareB();
  }

  /**
   * $9A17 - ACC := table[Y] * table[X] / 256, signed.
   * @see multiplyBody
   */
  multiply(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    this.magnitudes();
    this.multiplyBody();
  }

  /**
   * $9A65 - ACC := table[Y] * 256 / table[X], remainder into EXT.
   * @see divideBody
   * @returns {{inDomain: boolean}}
   */
  divide(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    this.magnitudes();
    return this.divideBody();
  }

  /**
   * $9A04 - ACC := |ACC|, by testing the high byte's sign bit and falling into the negate.
   *
   * Not quite an absolute value: the negate wraps, so $800000 - the most negative value -
   * comes back unchanged and still negative. The port keeps that.
   */
  abs() {
    if (this.acc < 0) this.negate();
  }

  /**
   * $9AD0 - ACC := the square root of ACC * 256, by Newton's method.
   *
   * Transliterated rather than modelled, because the iteration's own edges matter. It stashes
   * n in R7, clears B and the sign, then loops: ACC += B, halve ACC, stop if ACC now equals
   * B, otherwise B := ACC, ACC := n, ACC := ACC * 256 / B, round again - at most sixteen
   * times. That is x := (n * 256 / x + x) / 2 with x starting at n.
   *
   * The halving is a logical shift with the carry cleared, not an arithmetic one, and the
   * termination test is an equality rather than a tolerance. Both show at the bottom of the
   * range: ACC = 1 halves to 0, which already equals B, so it returns **0** where the true
   * answer is 16. A closed-form `trunc(sqrt(n * 256))` model agrees on 209 of 210 inputs and
   * disagrees on exactly that one, which is the reason this is a loop.
   *
   * It never calls $9B00, so a negative input is not turned into a magnitude - it is simply
   * worked on as a 24-bit pattern. ACC = -1 is $FFFFFF, and the answer is the root of
   * $FFFFFF * 256, which is 65535.
   */
  sqrt() {
    this.r7 = this.acc;                       // $9C90
    let rounds = 0x10;                        // $EE
    this.sign = 0;
    this.b = 0;
    for (;;) {
      this.addB();                            // $999E
      // CLC then ROR through $FC, $FB, $FA: a logical shift right of the 24-bit pattern,
      // not an arithmetic one, so a negative ACC becomes a large positive.
      this.acc = wrap24(u24(this.acc) >>> 1);
      if (this.compareB() === 0) return { inDomain: true };   // $99D8 / BEQ
      if (--rounds === 0) return { inDomain: true };
      this.b = this.acc;                      // $9C86
      this.acc = this.r7;                     // $9CA4
      const d = this.divideBody();            // $9A6E, with $CE still zero
      if (!d.inDomain) return { inDomain: false };
    }
  }

  /**
   * $9C04 - ACC := the arctangent of ACC, in whole degrees, scaled by 256.
   *
   * Input and output are both fixed point, so ACC = 256 means a ratio of 1.0 and comes back
   * as 45 * 256. The routine is a series approximation with a reflection above 1.0 - it
   * computes the small angle and subtracts from 90 - and it has its own rounding: a
   * `trunc(atan)` model disagrees with it on 102 of 765 inputs, sometimes high and sometimes
   * low. There is no tidy formula to write down.
   *
   * What there is, measured, is monotonicity, over 1,201 inputs spanning zero to 8.3 million.
   * A monotonic step function with 91 possible answers is completely described by where each
   * step begins, so ATAN_THRESHOLD holds those 90 inputs and this is a lookup. Exact,
   * including the four degrees the approximation never produces at all - 39, 40, 50 and 51
   * share a threshold with the degree above, so it steps straight over them.
   *
   * **Only ACC is modelled.** The real routine runs a series through B, EXT, R3 and R7 and
   * leaves all four holding working values this lookup does not reproduce. That is allowed
   * because nothing reads them: all three call sites are the same four instructions -
   * `JSR $9A65 / JSR $9C04 / JSR $9A04 / JSR $9C7A` - and $9A04 and $9C7A touch only ACC,
   * with the next instruction after them a $99D2 that reloads both registers.
   * probe_math.mjs checks that against the listing rather than taking it on trust.
   */
  atanDegrees() {
    const neg = this.acc < 0;
    const m = Math.abs(this.acc);
    let deg = 0;
    for (let i = 0; i < ATAN_THRESHOLD.length; i++) {
      if (m >= ATAN_THRESHOLD[i]) deg = i + 1; else break;
    }
    this.sign2 = neg ? 0xff : 0;
    this.acc = wrap24((neg ? -deg : deg) * 256);
  }

  /** $9C90 - R7 := ACC. */
  saveR7() { this.r7 = this.acc; }

  /** $9CA4 - ACC := R7. */
  loadR7() { this.acc = this.r7; }

  /** $9CAE - B := R7. */
  loadBFromR7() { this.b = this.r7; }

  /** $9C9A - R3 := ACC. */
  saveR3() { this.r3 = this.acc; }

  /** $9CB8 - ACC := R3. */
  loadR3() { this.acc = this.r3; }

  /** $9CC2 - B := R3. */
  loadBFromR3() { this.b = this.r3; }

  /** $9C86 - B := ACC. */
  accToB() { this.b = this.acc; }

  /** $9A08 - ACC := -ACC. */
  negate() {
    this.acc = wrap24(-this.acc);
  }

}
