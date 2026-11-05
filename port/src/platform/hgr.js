// A hi-res page, onto a canvas - in colour, because the game is in colour.
//
// The page is 8,192 bytes and its rows are interleaved three ways: row y starts at
// `(y & 7) * $400 + ((y >> 3) & 7) * $80 + (y >> 6) * $28`. Each byte carries seven pixels in
// bits 0-6, leftmost in the low bit. **Bit 7 is not a pixel**: it is the palette select, and
// it is where half the colour comes from.
//
// A first version of this file rendered monochrome, on the reasoning that every Applesoft
// program on the disk sets `HCOLOR=7` so the game must be white lines. That was wrong, and
// DISK_TRUTH already had the measurement that says so. `HCOLOR` belongs to the BASIC's own
// shape-table text; the game is drawn by A2-3D2, which has a COLOUR opcode of its own, and
// the display list **only ever uses colours 1 to 4**. Colour 0 is the white one, and the game
// never asks for it.
//
// The engine's five colours, measured by plotting eight cells in each and reading the bytes
// back (DISK_TRUTH, "A cell is two bits and the colour chooses which one"):
//
//   | 0   | $FF $7F | both bits of every cell - white        |
//   | 1   | $2A $55 | one bit, odd columns, bit 7 clear      |
//   | 2   | $55 $2B | the other bit, even columns, bit 7 clear |
//   | 3   | $D5 $AB | even columns, bit 7 SET                |
//   | 4-7 | $AA $D5 | odd columns, bit 7 set                 |
//
// So the game's four colours are the four hi-res hues: the two phases of each palette. That is
// what the screenshots show and what this now draws.
//
// **What is measured and what is convention.** Which pixels share a hue, where white appears,
// and where the palette flips are all properties of the bytes and are measured. The particular
// RGB each hue is given is a property of an NTSC television and is a convention - every
// emulator picks slightly different values. These are the usual ones. The oracle deliberately
// compares lit-or-not rather than colour, for exactly this reason, so nothing in the port's
// parity depends on the numbers below.
//
// **The artifact at the byte boundary is now visible, and that is the point.** 20 of the 140
// cells straddle a byte boundary; the engine ORs `$01` into the next byte, and bit 7 of a
// hi-res byte is the palette select - so plotting there flips that byte's colour as a side
// effect. In monochrome that is invisible. It is the engine's behaviour and the port carries
// it, so the display should show it.

export const HGR_W = 280, HGR_H = 192, HGR_BYTES = 8192;

/** Byte offset within the page of the first byte of row y. */
export function rowOffset(y) {
  return (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
}

/** The row offsets, worked out once - this runs 192 times a frame otherwise. */
const ROWS = new Uint16Array(HGR_H);
for (let y = 0; y < HGR_H; y++) ROWS[y] = rowOffset(y);

/**
 * The four hues and white, as an NTSC set.
 *
 * Indexed `[palette][parity]`, parity being the column's low bit. Palette 0 is bit 7 clear.
 */
export const HUES = {
  violet: [0xD9, 0x43, 0xFF],
  green: [0x2F, 0xE5, 0x4A],
  blue: [0x45, 0x9B, 0xFF],
  orange: [0xFF, 0x87, 0x1F],
  white: [0xFF, 0xFF, 0xFF],
  black: [0x00, 0x00, 0x00],
};

/** `[palette][x & 1]` - even columns first. Matches the measured table above. */
const PHASE = [
  [HUES.violet, HUES.green],      // bit 7 clear: colour 2 is even/violet, colour 1 odd/green
  [HUES.blue, HUES.orange],       // bit 7 set:   colour 3 is even/blue,   colour 4 odd/orange
];

/** Monochrome monitors, for anyone who had one. Not the default: the game is in colour. */
export const TINTS = {
  colour: null,
  green: [0x66, 0xFF, 0x66],
  amber: [0xFF, 0xB0, 0x00],
  white: [0xFF, 0xFF, 0xFF],
};

/**
 * Paint one hi-res page into an ImageData at 1:1.
 *
 * @param {Uint8Array} page 8,192 bytes
 * @param {ImageData} out 280 x 192
 * @param {object} [opts] `tint` 'colour' (the default) or a monochrome phosphor
 */
export function paint(page, out, { tint = 'colour' } = {}) {
  if (page.length < HGR_BYTES) {
    throw new Error(`a hi-res page is ${HGR_BYTES} bytes, got ${page.length}`);
  }
  const mono = tint === 'colour' ? null : (Array.isArray(tint) ? tint : TINTS[tint]);
  const px = out.data;
  const bits = new Uint8Array(HGR_W);
  const pal = new Uint8Array(HGR_W);

  for (let y = 0; y < HGR_H; y++) {
    const row = ROWS[y];
    // Unpack the row first: a pixel's colour depends on its neighbours, so the whole line has
    // to exist before any of it can be coloured.
    for (let byte = 0; byte < 40; byte++) {
      const v = page[row + byte];
      const palette = v >> 7;
      const base = byte * 7;
      for (let i = 0; i < 7; i++) {
        bits[base + i] = (v >> i) & 1;
        pal[base + i] = palette;
      }
    }
    let p = y * HGR_W * 4;
    for (let x = 0; x < HGR_W; x++) {
      let c = HUES.black;
      if (bits[x]) {
        if (mono) c = mono;
        // Two lit pixels side by side are white: the pair fills the cell, which is what
        // colour 0 does everywhere and what any two touching lines do here.
        else if ((x > 0 && bits[x - 1]) || (x < HGR_W - 1 && bits[x + 1])) c = HUES.white;
        else c = PHASE[pal[x]][x & 1];
      }
      px[p] = c[0];
      px[p + 1] = c[1];
      px[p + 2] = c[2];
      px[p + 3] = 255;
      p += 4;
    }
  }
  return out;
}

/**
 * Which page the game is showing.
 *
 * `$8110` is the display operand and it holds the low byte of one of the two page soft
 * switches - `$54` for `$C054`, page 1, and `$55` for `$C055`, page 2.
 */
export function shownPage(mem, { display = 0x8110 } = {}) {
  return mem[display] === 0x55 ? 1 : 0;
}

/** The two pages, as views on the image where the machine has them. */
export function pages(mem) {
  return [mem.subarray(0x2000, 0x4000), mem.subarray(0x4000, 0x6000)];
}

/**
 * Which hue a single lit pixel at this column, in a byte with this palette bit, comes out.
 *
 * Exposed so a harness can check the mapping against the engine's own COLOUR opcode rather
 * than against this file's reading of it.
 */
export function hueAt(x, paletteBit) {
  return PHASE[paletteBit ? 1 : 0][x & 1];
}
