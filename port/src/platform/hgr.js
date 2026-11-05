// A hi-res page, onto a canvas.
//
// The page is 8,192 bytes and its rows are interleaved three ways: row y starts at
// `(y & 7) * $400 + ((y >> 3) & 7) * $80 + (y >> 6) * $28`. Each byte carries seven pixels in
// bits 0-6, leftmost in the low bit. Bit 7 picks the colour palette and is not a pixel.
// 40 bytes x 7 = 280 across, 192 down.
//
// **Monochrome, and that is a decision rather than a shortcut.** Every program on the disk
// sets `HCOLOR=7` - white - and the game is a wireframe, so what the author drew is white
// lines on black. A real Apple II on a colour television would also show fringing on them,
// because hi-res colour is an artefact of how the signal is clocked rather than something the
// program asks for, and reproducing that is a display question this file does not answer. The
// oracle compares lit-or-not for the same reason, so what is on the canvas is what parity is
// measured on.
//
// The phosphor colour is the monitor's, not the game's. Green is the default because that is
// what the machine on the box was, and `tint` changes it.

export const HGR_W = 280, HGR_H = 192, HGR_BYTES = 8192;

/** Byte offset within the page of the first byte of row y. */
export function rowOffset(y) {
  return (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
}

/** The row offsets, worked out once - this runs 192 times a frame otherwise. */
const ROWS = new Uint16Array(HGR_H);
for (let y = 0; y < HGR_H; y++) ROWS[y] = rowOffset(y);

export const TINTS = {
  green: [0x66, 0xFF, 0x66],
  amber: [0xFF, 0xB0, 0x00],
  white: [0xFF, 0xFF, 0xFF],
};

/**
 * Paint one hi-res page into an ImageData at 1:1.
 *
 * The canvas is then scaled up by the browser, which keeps this loop small - 53,760 pixels a
 * frame rather than four times that.
 *
 * @param {Uint8Array} page 8,192 bytes
 * @param {ImageData} out 280 x 192
 * @param {object} [opts] `tint` a name from TINTS or an [r,g,b]
 */
export function paint(page, out, { tint = 'green' } = {}) {
  if (page.length < HGR_BYTES) {
    throw new Error(`a hi-res page is ${HGR_BYTES} bytes, got ${page.length}`);
  }
  const [r, g, b] = Array.isArray(tint) ? tint : (TINTS[tint] ?? TINTS.green);
  const px = out.data;
  for (let y = 0; y < HGR_H; y++) {
    const row = ROWS[y];
    let p = y * HGR_W * 4;
    for (let byte = 0; byte < 40; byte++) {
      let bits = page[row + byte];
      for (let i = 0; i < 7; i++) {
        const lit = bits & 1;
        bits >>= 1;
        px[p] = lit ? r : 0;
        px[p + 1] = lit ? g : 0;
        px[p + 2] = lit ? b : 0;
        px[p + 3] = 255;
        p += 4;
      }
    }
  }
  return out;
}

/**
 * Which page the game is showing.
 *
 * `$8110` is the display operand, and it holds the low byte of one of the two page soft
 * switches - `$54` for `$C054`, page 1, and `$55` for `$C055`, page 2. `selectPages` in
 * `../game/loop.js` is what writes it.
 */
export function shownPage(mem, { display = 0x8110 } = {}) {
  return mem[display] === 0x55 ? 1 : 0;
}

/** The two pages, as views on the image where the machine has them. */
export function pages(mem) {
  return [mem.subarray(0x2000, 0x4000), mem.subarray(0x4000, 0x6000)];
}
