/**
 * A2-3D2's screen: two hi-res pages, and the point plotter that writes to them.
 *
 * The coordinate system, established by `oracle/probe_screen2d.mjs`:
 *
 *   x is a signed byte, one unit = two hi-res bits, x = 0 at the centre of the 280.
 *   y is a signed byte, row = 95 - y, so positive is up.
 *
 * Both fit the screen exactly - the 140 x values from -70 to 69 cover all 280 bits once
 * each, the 192 y values from -96 to 95 cover all 192 rows - and outside those ranges the
 * tables wrap to real addresses that are the wrong rows. The original plots there
 * happily, so this does too, by using its tables rather than the formulas.
 *
 * **Colour is not a parameter here, because it is not one in the engine.** `COLOUR`
 * ($7D74) patches a four-byte sequence into twenty-six sites inside the plotting code:
 * `ORA ($99),Y / STA ($99),Y` for white, or `JSR $7D26 / NOP` for everything else.
 * `PLOTMODE` ($8081) then writes a single byte - `$11` for ORA, `$51` for EOR - over the
 * first of those four at a subset of the same sites. So the two collide, and the order
 * decides which survives.
 *
 * That is modelled here as `mode`, a combination rather than two independent settings,
 * because the combinations are not all meaningful:
 *
 *   white + ORA     the default. OR the mask in.
 *   white + EOR     erase. This is the one the engine is built for.
 *   colour + ORA    the colour routine at $7D26: clear the cell, set the palette bit, OR
 *                   the colour pattern for this byte's parity.
 *   colour + EOR    NOT A MODE. Opcode 12 stamps $51 over the JSR's opcode and the engine
 *                   runs corrupted instructions. Measured: a line drawn twice leaves 7
 *                   pixels rather than 0. This throws rather than guessing at it.
 *
 * The game never reaches that fourth case - `SV DATA` never executes opcode 12 at all -
 * so refusing it costs nothing and hides nothing.
 */
import { ROW_HI, ROW_LO, X_BYTE, X_MASK } from './tables.js';

export const PAGE_BYTES = 0x2000;

/**
 * The colour table, from the four-byte sequences COLOUR writes and the two bytes it puts
 * in $BE/$BF and the operand it patches into $7D2C.
 *
 *   even/odd   the pattern ANDed with the mask, chosen by the byte offset's parity
 *   palette    what happens to bit 7 of the byte under the cell: $7F clears it (AND),
 *              $80 sets it (ORA)
 *
 * Colours 4 to 7 are all the same as each other - there are five colours, not eight.
 */
export const COLOURS = {
  0: null,                                             // white: no colour routine at all
  1: { even: 0x2A, odd: 0x55, palette: 'clear' },
  2: { even: 0x55, odd: 0x2A, palette: 'clear' },
  3: { even: 0x55, odd: 0x2A, palette: 'set' },
  4: { even: 0x2A, odd: 0x55, palette: 'set' },
};
const colourOf = (c) => (c >= 4 ? COLOURS[4] : COLOURS[c]);

export class Screen {
  constructor() {
    this.pages = [new Uint8Array(PAGE_BYTES), new Uint8Array(PAGE_BYTES)];
    this.drawPage = 0;        // opcode 9 - 0 is $2000, anything else is $4000
    this.colour = 0;          // opcode 18
    this.eor = false;         // opcode 12
    this.lastPatch = 'colour';  // which of the two wrote the shared sites most recently
  }

  /** Opcode 8. */
  clear(page = this.drawPage) { this.pages[page ? 1 : 0].fill(0); }

  /** Opcode 9. */
  setDrawPage(operand) { this.drawPage = operand ? 1 : 0; }

  /** Opcode 18. Overwrites all four bytes, so it wins over any earlier PLOTMODE. */
  setColour(c) { this.colour = c & 0xff; this.lastPatch = 'colour'; }

  /** Opcode 12. Overwrites one byte of whatever COLOUR last left. */
  setPlotMode(operand) { this.eor = !!operand; this.lastPatch = 'mode'; }

  /**
   * Plot one cell, exactly as $771F does.
   *
   * The address is assembled out of the tables with the pointer's low byte held at zero,
   * which is why the row's low byte and the x byte offset are simply added: the sum is
   * the index, and it is allowed to carry into the high byte.
   */
  /**
   * One cell.
   *
   * `how` picks between three callers that treat a straddling cell differently. This is
   * not tidiness - each was forced by a whole-page comparison that failed.
   *
   *   'point'  $771F. ORs the table's mask whole, so for a straddling cell that is $C0:
   *            bit 6, the pixel, AND bit 7, the palette select. Its straddle half at
   *            $7740 is NOT a COLOUR site, so that bit 0 is a plain ORA or EOR.
   *   'run'    the shallow line at $7796. Combines a run of cells inside one byte into a
   *            single mask, and those masks top out at $7F - the pixel without the
   *            palette bit. The straddle half arrives as bit 0 of the next byte's run
   *            mask, so it DOES go through the colour routine.
   *   'cell'   the steep line at $7BFA. Never has a run to combine, so it uses the
   *            table's mask whole like the point plotter - but $7C52 puts its straddle
   *            half through the colour routine, unlike the point plotter.
   *
   * Each difference showed up as a byte: `01000000` against `11000000` for the first,
   * `10000000` against `00000001` for the third.
   */
  point(x, y, how = 'point') {
    const page = this.pages[this.drawPage];
    const xi = x & 0xff, yi = y & 0xff;
    const mask = X_MASK[xi];
    if (mask === 0) return;                       // off the side of the screen: no cell

    // $771F assembles the address as ($99 = 0, $9A = ROW_HI + page) indexed by Y, where
    // Y = ROW_LO + X_BYTE. That add is `CLC ADC ... TAY`, so its carry is DISCARDED - the
    // index stays a byte. The page byte only selects which 8K array, since it shifts both
    // halves of the pair equally.
    const at = ((ROW_HI[yi] << 8) | ((ROW_LO[yi] + X_BYTE[xi]) & 0xff)) - 0x2000;

    // The engine gets to the second byte with INY, so it wraps inside the 256-byte window
    // rather than carrying into the high byte.
    const next = (at & 0xff00) | ((at + 1) & 0xff);
    this.write(page, at, how === 'run' ? mask & 0x7f : mask);
    if (mask & 0x80) {
      if (how === 'point') {
        // $7740 is patched by PLOTMODE but NOT by COLOUR - opcode 12's site list has it
        // and opcode 18's does not - so it follows the plot mode and ignores the colour.
        page[next] = this.eor ? (page[next] ^ 0x01) & 0xff : (page[next] | 0x01) & 0xff;
      } else {
        this.write(page, next, 0x01);
      }
    }
  }

  /** One patched site: what the four bytes at $7734 and its twenty-five siblings do. */
  write(page, at, mask) {
    const colour = colourOf(this.colour);
    if (colour && this.eor && this.lastPatch === 'mode') {
      throw new Error('PLOTMODE after a colour other than 0 corrupts the engine\'s own '
        + 'instruction stream - the original does not define this. See probe_opcodes.mjs.');
    }
    if (colour && this.lastPatch === 'colour') {
      // $7D26: clear the cell's bits, apply the palette bit, then OR in the colour
      // pattern for this byte's parity. Note it STORES - a coloured plot can turn a
      // pixel of the other phase off.
      const kept = page[at] & ~mask & 0xff;
      const base = colour.palette === 'set' ? (kept | 0x80) : (kept & 0x7f);
      const pattern = (at & 1) ? colour.odd : colour.even;
      page[at] = (base | (mask & pattern)) & 0xff;
      return;
    }
    // White, or a colour that PLOTMODE has overwritten back to a plain ORA/EOR.
    page[at] = this.eor ? (page[at] ^ mask) & 0xff : (page[at] | mask) & 0xff;
  }

  /** Every lit bit of the drawing page, as {row, bit} with bit the 0..279 column. */
  lit(page = this.drawPage) {
    const p = this.pages[page ? 1 : 0];
    const out = [];
    for (let row = 0; row < 192; row++) {
      const base = (row & 7) * 0x400 + (((row >> 3) & 7) * 0x80) + ((row >> 6) * 0x28);
      for (let b = 0; b < 40; b++) {
        const v = p[base + b];
        for (let i = 0; i < 7; i++) if (v & (1 << i)) out.push({ row, bit: b * 7 + i });
      }
    }
    return out;
  }
}

/** The derived mapping, kept so it can be checked against the tables rather than trusted. */
export const bitForX = (x) => (x >= -70 && x <= 69 ? 140 + 2 * x : null);
export const rowForY = (y) => (y >= -96 && y <= 95 ? 95 - y : null);
