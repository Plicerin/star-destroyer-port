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
//   $CE            the sign flag the multiply and divide use internally
//   $EE            where $9C5C parks X across its own use of it
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

/** The table's base in Apple II memory, for cross-referencing the listing. */
export const TABLE_BASE = 0x9800;

/** Usable table bytes: MATH's own code begins at $98F3. */
export const TABLE_BYTES = 0xF3;

/** Wrap to signed 24 bits. The routines wrap; none of them saturate. */
export const wrap24 = (v) => {
  const m = v & 0xFFFFFF;
  return m > 0x7FFFFF ? m - 0x1000000 : m;
};

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

  /**
   * $999B - ACC += table[X]. It loads B and adds that, leaving ACC as whatever the previous
   * instruction put there: this is the read-modify-write half of the loop's position update.
   */
  add(x) {
    this.loadB(x);
    this.acc = wrap24(this.acc + this.b);
  }

  /** $99AB - ACC := table[Y] - table[X]. Unlike add, it loads both. */
  sub(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    this.acc = wrap24(this.acc - this.b);
  }

  /**
   * $99D2 - signed comparison of table[Y] against table[X], loading both. The call sites
   * follow it with BPL, so a non-negative answer means "table[X] is not above table[Y]".
   * @returns {number} +1 when table[X] < table[Y], -1 when greater, 0 when equal
   */
  compare(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    return this.acc > this.b ? 1 : this.acc < this.b ? -1 : 0;
  }

  /** $9A08 - ACC := -ACC. */
  negate() {
    this.acc = wrap24(-this.acc);
  }

  /**
   * $9A65 - ACC := table[Y] * 256 / table[X], remainder into EXT.
   *
   * It is a restoring division: both operands are reduced to magnitudes with the combined
   * sign kept in $CE, the dividend is shifted up one byte - which is where the * 256 comes
   * from, and makes the quotient 8.16 fixed point, so $000100 is 1.0 - then 24 rounds of
   * shift-and-trial-subtract accumulate the quotient in ACC and leave the remainder in EXT,
   * and the quotient is negated at the end if the signs differed.
   *
   * Two consequences the port keeps rather than tidying away:
   *
   * - **The remainder has no sign.** It is never negated, because the negate at the end only
   *   touches ACC. -1000/3 and 1000/3 both leave a remainder of 1.
   * - **Neither edge is guarded.** With a zero divisor every trial subtraction succeeds, so
   *   the quotient fills with ones - $FFFFFF, or +1 after the sign fix-up if the numerator
   *   was negative - and EXT keeps the shifted dividend. And the quotient register is 24 bits
   *   wide, so a quotient that does not fit wraps into it and the answer is meaningless. The
   *   domain condition is on the QUOTIENT, not the numerator: 65536*256/256 is fine, and so
   *   is 65535*256/1 at $FFFF00, but 65536*256/1 is not.
   *
   * `inDomain` reports the second case so a caller can assert on it. Over 60 frames under
   * warp the running game performs 18 divisions and every one of them is inside the domain,
   * with no zero divisors, so in practice this model is exact - but 60 frames is evidence
   * rather than a proof, which is why both edges are modelled instead of thrown on.
   *
   * @returns {{inDomain: boolean}}
   */
  divide(x, y) {
    this.loadAcc(x, y);
    this.loadB(x);
    const num = Math.abs(this.acc) * 256;
    const den = Math.abs(this.b);
    this.sign = (this.acc < 0) !== (this.b < 0) ? 1 : 0;
    // $9B00 takes the magnitudes IN PLACE, so B is left positive whatever it came in as and
    // a later instruction that reads B sees |B|. ACC is overwritten by the quotient, so only
    // B's change is observable - but it is observable, and the parity programs catch it.
    this.b = den;

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
}
