/**
 * A2-3D2's view pipeline: trig, the rotation matrix, the transform and the projection.
 *
 *     d = p - viewer
 *     v = (M . d) << 3
 *     h = div(v, z) >> 8
 *     screen = ((h * scale) >> 7) + centre
 *
 * The formulas are from `oracle/probe_projection.mjs` and `oracle/probe_transform.mjs`.
 * What those probes did not establish, and what is transliterated here, is how `M` is
 * built - and the builder turns out to matter more than it looks, because it has a bug in
 * it that a port cannot round off.
 */
import { SINTAB } from './tables.js';
import { mul, div, scale as scaleMul, s8, s16 } from './math.js';

/**
 * Sine and cosine, from the table at $6146 and the quadrant folding at $61CB.
 *
 * Angles are one byte to the whole turn. $61C8 is SINE and $61CB is COSINE - the other
 * way round from how DISK_TRUTH first labelled them, which a measurement caught: at angle
 * 0, $61CB returns 32767 and $61C8 returns 0.
 *
 * The folding is transliterated rather than computed because its negative quadrants are
 * NOT the mirror of its positive ones. `SEC LDA #0 SBC $6147,Y TAX SBC $6146,Y` negates
 * the two bytes in the wrong order, so the result is not -value: cos(128) comes back as
 * $8181, which is -32383, where a true -1.0 would be -32767. A port that negated properly
 * would be wrong by 384 at every half turn.
 */
export function cos(angle) {
  let a = angle & 0xff;
  if (a & 0x80) {                              // $61CB BMI $61ED
    a = ((a ^ 0xff) + 1) & 0xff;               // $61ED negate the angle
    if (a & 0x80) return negated(a);           // $61F4 BMI $61D7 - the $80 case
  }
  if (a < 0x40) {                              // $61CE BMI $61E4 - straight lookup
    const y = (a << 1) & 0xff;
    return s16(SINTAB[y] | (SINTAB[y + 1] << 8));
  }
  return negated((((a + 0x7f) & 0xff) ^ 0xff) & 0xff);   // $61D2
}

/** $61D7: the negated lookup, byte order and all. */
function negated(a) {
  const y = (a << 1) & 0xff;
  // SEC; LDA #$00; SBC $6147,Y -> this is the HIGH byte of the entry, and it lands in X,
  // which is the high byte of the result. Then SBC $6146,Y with the borrow gives A.
  const hi = SINTAB[y + 1], lo = SINTAB[y];
  let t = 0 - hi;
  const x = t & 0xff;
  const borrow = t < 0 ? 1 : 0;
  const acc = (x - lo - borrow) & 0xff;
  return s16(acc | (x << 8));
}

/** $61C8: sine is the same table entered a quarter turn earlier. */
export const sin = (angle) => cos((angle - 0x40) & 0xff);

/**
 * Build the rotation matrix, as $666E does, bug included.
 *
 * Returned as nine entries in the engine's own layout - a row per output axis - so it can
 * be compared with zero page $7E-$8F directly:
 *
 *     [[ $7E, $84, $8A ],
 *      [ $80, $86, $8C ],
 *      [ $82, $88, $8E ]]
 *
 * **The bug.** Each row is scaled by one of opcode 15's three constants, and for the
 * FIRST entry of each row the code reads only the constant's high byte:
 *
 *     LDX $6141        ; high byte
 *     CPX #$7F         ; the "is it 1.0, skip the whole row" test
 *     BNE $675F        ; ...which skips the LDA $6140 below
 *     LDA $6140
 *     CMP #$FF
 *     BEQ skip
 *     STA $78          ; <- A is STALE when we branched here
 *
 * So when the constant's high byte is not $7F, the multiplier becomes
 * `(high << 8) | whatever A happened to hold`, and A holds the low byte of the previous
 * multiply's result. The second and third entries of each row reload it properly.
 *
 * This is why the x scale is never quite 16000 and wanders with pitch. At all angles zero
 * the previous product is mul(cosH, cosP) = 32763, whose low byte is $FB, so the
 * multiplier is $3EFB = 16123 - which is exactly what the engine's matrix holds. A port
 * that used 16000 would be 0.8% out, and differently out at every attitude.
 */
export function buildMatrix(pitch, bank, heading, scales) {
  const sinP = sin(pitch), sinB = sin(bank), sinH = sin(heading);
  const cosP = cos(pitch), cosB = cos(bank), cosH = cos(heading);

  // $66A4-$66EB, in the engine's order. MUL16(X, Y) multiplies zp[X] by zp[Y], and
  // MULCORE is not symmetric, so the order is kept.
  const t6C = mul(cosH, cosB);
  const t6E = mul(sinH, sinB);
  const t70 = mul(cosH, sinB);
  const t72 = mul(sinH, cosB);
  const t74 = mul(sinP, t6E);
  const t76 = mul(sinP, t72);
  const tB3 = mul(t70, sinP);
  const tB5 = mul(sinP, t6C);

  const m = {};
  m[0x7E] = s16(t6C + t74);                     // $66EC
  m[0x80] = s16(t76 - t70);                     // $66F9
  m[0x82] = mul(sinH, cosP);                    // $6706
  m[0x84] = mul(sinB, cosP);                    // $670F
  m[0x86] = mul(cosP, cosB);                    // $6718
  m[0x88] = s16(0 - sinP);                      // $6721
  m[0x8A] = s16(tB3 - t72);                     // $672E
  m[0x8C] = s16(t6E + tB5);                     // $673B
  m[0x8E] = mul(cosH, cosP);                    // $6748

  // A, as the 6502 leaves it: MUL16 ends with the product's low byte in A.
  let A = m[0x8E] & 0xff;

  // $6751, $67A4, $67F7 - one block per row, each with the same stale-A hazard.
  const rows = [[0x7E, 0x84, 0x8A], [0x80, 0x86, 0x8C], [0x82, 0x88, 0x8E]];
  for (let r = 0; r < 3; r++) {
    const lo = scales[r] & 0xff, hi = (scales[r] >> 8) & 0xff;
    if (hi === 0x7f) {
      A = lo;                                   // LDA $614n happened
      if (lo === 0xff) continue;                // the whole row is skipped
    }
    const first = s16((hi << 8) | A);
    m[rows[r][0]] = mul(first, m[rows[r][0]]);
    A = m[rows[r][0]] & 0xff;
    // And the operand order is not consistent between the rows. MULCORE complements its
    // FIRST operand and adds its second, so it is not symmetric and the order shows up as
    // an off-by-one. Every block puts the constant in $78 except the x row's second and
    // third ($6772, $678B), which put the value there and the constant in $7A.
    const valueFirst = r === 0;
    for (let k = 1; k < 3; k++) {
      m[rows[r][k]] = valueFirst
        ? mul(m[rows[r][k]], s16(scales[r]))
        : mul(s16(scales[r]), m[rows[r][k]]);
      A = m[rows[r][k]] & 0xff;
    }
  }
  return [[m[0x7E], m[0x84], m[0x8A]], [m[0x80], m[0x86], m[0x8C]], [m[0x82], m[0x88], m[0x8E]]];
}

/** d = p - viewer, then v = (M . d) << 3. */
export function transform(M, point, viewer) {
  const d = [point[0] - viewer[0], point[1] - viewer[1], point[2] - viewer[2]];
  return [0, 1, 2].map((i) => (mul(d[0], M[i][0]) + mul(d[1], M[i][1]) + mul(d[2], M[i][2])) * 8);
}

/**
 * One axis of the projection, from a view-space value and the depth.
 *
 * Only defined strictly inside the frustum. On the edge itself, where the quotient is
 * exactly 1, the engine comes back one short of this - see probe_projection.mjs - and
 * outside it the divide is meaningless, so both return null rather than a number.
 */
export function project(v, z, sc, centre) {
  const q = div(v, z);
  if (q === null) return null;
  return scaleMul((q >> 8) & 0xff, sc) + s8(centre);
}

/** VIEWPORT, opcode 14: what it patches into the projection code. */
export const viewportScale = (operand) => ((operand >> 1) - 1) & 0xff;
export const viewportCentre = (operand) => operand & 0xff;

/**
 * The clip outcode, $6A22. Four bits, one per frustum plane, set when the point is
 * outside it: the test is z + x, z - x, z + y, z - y going negative.
 */
export function outcode(v) {
  const [x, y, z] = v;
  let code = 0;
  if (z + x < 0) code |= 0x40;
  if (z - x < 0) code |= 0x20;
  if (z + y < 0) code |= 0x10;
  if (z - y < 0) code |= 0x08;
  return code;
}

/**
 * $6D7C-$6F0x: putting the viewer into an object's frame.
 *
 * Opcode 19 does NOT replace the viewer's attitude and rebuild the matrix. It rotates the
 * relative position into the object's frame, and COMPOSES the object's rotation into the
 * matrix that is already there - which is what makes nesting work, and what makes an
 * object's orientation relative to the viewer's rather than absolute.
 *
 * Three rotations in order: heading on (x, z), pitch on (y, z), bank on (x, y). The
 * position and the matrix use the same pairs and the same signs, which is the check that
 * this is one transform rather than two.
 *
 * The multiply's argument order differs between the two, and MULCORE is not symmetric, so
 * it is kept: the position does mul(coordinate, trig) and the matrix does mul(trig, entry).
 */
export function objectFrame(M, pos, pitch, bank, heading) {
  const sP = sin(pitch), cP = cos(pitch);
  const sB = sin(bank), cB = cos(bank);
  const sH = sin(heading), cH = cos(heading);

  // $6D7C: the position, mul(coordinate, trig).
  let [x, y, z] = pos;
  [x, z] = [mul(x, cH) - mul(z, sH), mul(z, cH) + mul(x, sH)];      // heading
  [y, z] = [mul(y, cP) + mul(z, sP), mul(z, cP) - mul(y, sP)];      // pitch
  [x, y] = [mul(x, cB) + mul(y, sB), mul(y, cB) - mul(x, sB)];      // bank

  // $6E36: the matrix, mul(trig, entry), one rotation at a time over all three rows.
  const rot = (m, a, b, s, c, sign) => m.map((row) => {
    const u = row[a], v = row[b];
    const nu = mul(c, u) + mul(sign < 0 ? s16(0 - s) : s, v);
    const nv = mul(sign < 0 ? s : s16(0 - s), u) + mul(c, v);
    const out = row.slice();
    out[a] = nu; out[b] = nv;
    return out;
  });
  let m = rot(M, 0, 2, sH, cH, -1);        // heading: x' = cH*x - sH*z, z' = sH*x + cH*z
  m = rot(m, 1, 2, sP, cP, +1);            // pitch:   y' = cP*y + sP*z, z' = -sP*y + cP*z
  m = rot(m, 0, 1, sB, cB, +1);            // bank:    x' = cB*x + sB*y, y' = -sB*x + cB*y
  return { M: m, pos: [x, y, z] };
}
