/**
 * A2-3D2's arithmetic.
 *
 * Everything the renderer puts on screen passes through these three routines, so they are
 * where a port either matches the original or does not. `oracle/parity_math.mjs` runs each
 * one against the real engine in the oracle over a wide sweep; nothing here is trusted
 * because it looks right.
 *
 * Two of them are formulas, established and checked over their whole domain by
 * `oracle/probe_projection.mjs`. The third is not, and that is the interesting one.
 */

const s16 = (v) => ((v & 0xffff) > 32767 ? (v & 0xffff) - 65536 : (v & 0xffff));
const s8 = (v) => ((v & 0xff) > 127 ? (v & 0xff) - 256 : (v & 0xff));

/**
 * The 16x16 multiply at $6480, as a transliteration rather than as arithmetic.
 *
 * It is NOT `(a * b) >> 15`. It agrees with that about 70% of the time and is one low
 * otherwise, because it is a shift-add loop that throws away the low half of its
 * accumulator part way through: for the first six multiplier bits it adds only the HIGH
 * byte of |b|, and at $64EA the low accumulator is reset to zero and the partial sums
 * collected so far in $78 are discarded. That is the whole source of the discrepancy, and
 * it is not a rounding rule that can be written down - it depends on the bit pattern.
 *
 * So this is written as the 6502 wrote it, with the accumulator, the carry and the three
 * zero-page bytes explicit. It is slower than a native multiply and it is the point: a
 * port that reaches for `Math.round(a * b / 32768)` here drifts from the original by a
 * pixel in places, and those places are not predictable.
 *
 * Reading it against `oracle/listing/A2-3D2.asm` from $6480 should be line for line.
 */
export function mul(a, b) {
  let z78 = a & 0xff, z79 = (a >> 8) & 0xff;          // the multiplier
  let z7A = b & 0xff, z7B = (b >> 8) & 0xff;          // the multiplicand
  let A, C, zA5 = 0;

  // $6480  either operand zero, answer zero
  if ((z78 | z79) === 0 || (z7A | z7B) === 0) return 0;

  // $6491  the sign of the result, kept in Y for the end
  const Y = (z79 ^ z7B) & 0xff;

  // $6496  make the multiplier ~|a|: complement it when positive, decrement when
  // negative, which comes to the same thing. The loop then tests for ZERO bits, which is
  // why every test below is "skip the add when the carry is set".
  if ((z79 & 0x80) === 0) {
    z78 = ~z78 & 0xff;
    z79 = ~z79 & 0xff;
  } else {
    if (z78 === 0) z79 = (z79 - 1) & 0xff;
    z78 = (z78 - 1) & 0xff;
  }

  // $64B0  make the multiplicand |b|. A is left holding its high byte either way, and
  // that is deliberate - it becomes the first partial product.
  if (z7B & 0x80) {
    const n = (-((z7B << 8) | z7A)) & 0xffff;
    z7A = n & 0xff;
    z7B = (n >> 8) & 0xff;
  }
  A = z7B;

  // $64C1  the first multiplier bit, which selects whether that partial product stands
  C = z78 & 1; z78 >>= 1;
  if (C) A = 0;

  // $64C7-$64E9  five rounds against the high byte of |b| only. The accumulator's low
  // half is $78, which is also what is left of the multiplier.
  const shiftInto78 = () => {
    const out = A & 1; A >>= 1;
    const next = z78 & 1;
    z78 = ((out << 7) | (z78 >> 1)) & 0xff;
    C = next;
  };
  for (let i = 0; i < 5; i++) {
    shiftInto78();
    if (!C) A = (A + z7B) & 0xff;                     // ADC with the carry known clear
  }

  // $64EA  one more shift, and then the low accumulator moves to $A5 - starting at zero,
  // so everything accumulated in $78 below the current bit is thrown away. This is where
  // the precision goes.
  A >>= 1;
  zA5 = 0;

  // $64EF-$6586  nine rounds against the full 16 bits of |b|: two more bits out of $78,
  // then seven out of $79.
  const add16 = () => {
    const t = zA5 + z7A;
    zA5 = t & 0xff;
    A = (A + z7B + (t > 255 ? 1 : 0)) & 0xff;
  };
  const shiftIntoA5 = () => {
    const out = A & 1; A >>= 1;
    zA5 = ((out << 7) | (zA5 >> 1)) & 0xff;
  };
  for (let i = 0; i < 9; i++) {
    if (i < 2) { C = z78 & 1; z78 >>= 1; } else { C = z79 & 1; z79 >>= 1; }
    if (!C) add16();
    shiftIntoA5();
  }

  // $6588  apply the sign, then the result comes back as X:A - high byte in X.
  if (Y & 0x80) {
    const v = (-(((A << 8) | zA5))) & 0xffff;
    zA5 = v & 0xff;
    A = (v >> 8) & 0xff;
  }
  return s16((A << 8) | zA5);
}

/**
 * The divide at $65DE, which is a formula.
 *
 * Fifteen fractional bits, but only fourteen of them are computed - the bottom one is
 * shifted in - so 40/100 comes back as 13106 where `0.4 * 32768` would give 13107.
 *
 * Defined only for |n| < |d|, because a quotient of 1 does not fit. That is exactly the
 * frustum the clipper enforces before anything is projected, so the engine never asks
 * outside it. Outside the domain the original returns numbers that fit no formula; this
 * returns null rather than inventing one.
 */
export function div(n, d) {
  if (d === 0 || Math.abs(n) >= Math.abs(d)) return null;
  const m = Math.floor(Math.abs(n) * 16384 / Math.abs(d)) * 2;
  return (n < 0) !== (d < 0) ? -m : m;
}

/** The scale at $659D: a signed byte times a multiplier under 128, rounding downwards. */
export function scale(a, m) {
  return (s8(a) * m) >> 7;
}

export { s8, s16 };
