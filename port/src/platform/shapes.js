// Applesoft shape tables - DRAW, XDRAW, SCALE and ROT.
//
// This is how every word on the starbase screen and the high-score screen is written. The
// disk has one table, `CHR$.A24576.L148`, which the three programs that use it load at
// `$1AFB` with `POKE 232,251: POKE 233,26` - 232/233 being the shape-table pointer - and then
// `DRAW A AT X,Y` once per character.
//
// **A table is a count, a list of offsets and a run of vectors.** Byte 0 is the number of
// shapes; byte 1 is unused; then two bytes per shape, little-endian, each an offset from the
// start of the table to that shape's vectors. Measured on this disk: 43 shapes, every offset
// inside the 985 bytes, every shape terminated.
//
// **A vector byte is three sections**, read from the bottom up:
//
//     bits 0-2   plot flag in bit 2, direction in bits 0-1
//     bits 3-5   plot flag in bit 5, direction in bits 3-4
//     bits 6-7   direction only - this section can never plot
//
// Directions are 0 up, 1 right, 2 down, 3 left. A zero byte ends the shape, and a section is
// skipped once everything above it in the byte is zero - which is why the last section being
// two bits matters: a shape that ends on a plot needs a byte whose top bits are clear.
//
// **The subset, and why.** `SCALE` and the four quadrant rotations are implemented. Applesoft
// also has 64 rotation steps, whose intermediate angles need a scale-dependent table in ROM;
// this disk sets `ROT=0` and nothing else, in all three programs, so the other 60 steps throw
// rather than being approximated. Measured, not assumed - `oracle/probe_shapetable.mjs`
// checks that no program on the disk sets a rotation this cannot do.

/** Up, right, down, left - as (dx, dy) with y increasing downwards. */
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Thrown for a rotation this subset does not cover. */
export class UnsupportedRotation extends Error {
  constructor(rot) {
    super(`ROT=${rot}: only the four quadrants (0, 16, 32, 48) are implemented`);
    this.rot = rot;
  }
}

/**
 * Read a shape table's header.
 *
 * @param {Uint8Array} mem a 64K image
 * @param {number} base where the table is - `$1AFB` for this disk
 */
export function parseTable(mem, base) {
  const count = mem[base];
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push(mem[base + 2 + i * 2] | (mem[base + 3 + i * 2] << 8));
  }
  return { base, count, offsets };
}

/**
 * The vectors of one shape, as `{plot, dir}` steps.
 *
 * @param {Uint8Array} mem
 * @param {{base: number, count: number, offsets: number[]}} table
 * @param {number} shape 1-based, the way Applesoft numbers them
 * @param {number} [limit] a guard against a table whose terminator is missing
 */
export function vectors(mem, table, shape, limit = 4096) {
  if (shape < 1 || shape > table.count) {
    throw new Error(`shape ${shape}: the table has ${table.count}`);
  }
  const out = [];
  let p = table.base + table.offsets[shape - 1];
  for (let i = 0; i < limit; i++) {
    const b = mem[p++];
    if (b === 0) break;
    out.push({ plot: !!(b & 4), dir: b & 3 });
    if ((b >> 3) === 0) continue;
    out.push({ plot: !!(b & 0x20), dir: (b >> 3) & 3 });
    if ((b >> 6) === 0) continue;
    out.push({ plot: false, dir: (b >> 6) & 3 });
  }
  return out;
}

/**
 * Draw a shape.
 *
 * @param {object} plotter something with `plot(x, y)` and, for XDRAW, `invert(x, y)`
 * @param {Uint8Array} mem
 * @param {{base: number, count: number, offsets: number[]}} table
 * @param {number} shape 1-based
 * @param {number} x
 * @param {number} y
 * @param {object} [opts] `scale` (1 or more), `rot` (0, 16, 32 or 48), `xor` for XDRAW
 * @returns {{plotted: number, steps: number}}
 */
export function drawShape(plotter, mem, table, shape, x, y,
  { scale = 1, rot = 0, xor = false } = {}) {
  const r = ((rot % 64) + 64) % 64;
  if (r % 16 !== 0) throw new UnsupportedRotation(rot);
  const quadrant = r / 16;
  const s = Math.max(1, Math.trunc(scale));
  let cx = Math.trunc(x), cy = Math.trunc(y);
  let plotted = 0, steps = 0;
  for (const v of vectors(mem, table, shape)) {
    // Rotating a shape rotates its directions: a quarter turn adds one to each.
    const [dx, dy] = STEPS[(v.dir + quadrant) & 3];
    for (let i = 0; i < s; i++) {
      if (v.plot) {
        if (xor) plotter.invert(cx, cy);
        else plotter.plot(cx, cy);
        plotted++;
      }
      cx += dx;
      cy += dy;
      steps++;
    }
  }
  return { plotted, steps, end: [cx, cy] };
}
