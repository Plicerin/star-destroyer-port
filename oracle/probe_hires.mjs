// What colour does the engine draw in, and does the port's screen agree?
//
// This probe exists because the shell's first renderer was monochrome, on the reasoning that
// every Applesoft program on the disk sets `HCOLOR=7` so the game must be white lines. That
// was wrong. `HCOLOR` belongs to the BASIC's own shape-table text; the game is drawn by
// A2-3D2, which has a COLOUR opcode of its own, and the measurement that says so was already
// in DISK_TRUTH - "A cell is two bits and the colour chooses which one".
//
// So: drive the real engine with each colour in turn, read the page back, and hold the port's
// painter to it. The chain being checked is engine -> bytes -> pixels, end to end, with the
// disk at one end and what a player sees at the other.
import { openOracle } from './a2.mjs';
import { toFlight, arm, runList, op } from './exercise.mjs';
import { paint, hueAt, HUES, HGR_W } from '../port/src/platform/hgr.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hex = (b) => '$' + b.toString(16).toUpperCase().padStart(2, '0');
const name = (rgb) => Object.entries(HUES)
  .find(([, v]) => v[0] === rgb[0] && v[1] === rgb[1] && v[2] === rgb[2])?.[0] ?? String(rgb);

/** A 280x192 RGBA buffer, standing in for the canvas's ImageData. */
const imageData = () => ({ data: new Uint8ClampedArray(HGR_W * 192 * 4) });

// 2-D coordinates are signed and centred: `row = 95 - y`, and x runs either side of centre.
// Plotting at y = 0 therefore lands on row 95, which is where this reads.
const ROW = 95;
const rowOffset = (y) => (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

const a2 = await openOracle();
try {
  const f = await toFlight(a2, { difficulty: 1 });
  console.log(`at a flight, binary resident after ${f.resident.seconds}s`);
  await arm(a2);
  const head = [...op.switches(), ...op.clear(0), ...op.drawTo(0)];
  const draw = (...body) => runList(a2, [...head, ...body, ...op.end()], { page: 1 });

  /** Eight cells side by side in one colour, on row 95. */
  const cells = (colour) => {
    const body = [...op.colour(colour)];
    for (let x = 0; x < 8; x++) body.push(...op.point2d(x, 0));
    return body;
  };

  // Eight separated cells in each colour, the same experiment DISK_TRUTH recorded, re-run
  // here so this probe stands on its own measurement rather than on that sentence.
  console.log('\n=== the engine, colour by colour ===');
  const seen = {};
  for (const colour of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const r = await draw(...cells(colour));
    const base = rowOffset(ROW) + 20;             // x = 0 is the middle of the row
    const bytes = [...r.page.subarray(base, base + 2)];
    seen[colour] = { bytes, lit: r.lit.length };
    console.log(`  colour ${colour}: ${bytes.map(hex).join(' ')}`
      + `  ${r.lit.length} bits lit for 8 cells`);
  }

  // DISK_TRUTH's table, as a claim this re-measurement has to reproduce.
  check('every colour actually drew something, so the rest of this means anything at all',
    [0, 1, 2, 3, 4, 5, 6, 7].every((c) => seen[c].lit > 0),
    [0, 1, 2, 3, 4, 5, 6, 7].map((c) => `${c}:${seen[c].lit}`).join(' '));
  check('colour 0 lights both bits of every cell - it is the white one',
    seen[0].lit === 16, `${seen[0].lit} bits for 8 cells`);
  check('colours 1 to 7 light one bit of each cell, which is how hires carries colour',
    [1, 2, 3, 4, 5, 6, 7].every((c) => seen[c].lit === 8 || seen[c].lit === 9),
    [1, 2, 3, 4, 5, 6, 7].map((c) => seen[c].lit).join(','));
  check('colours 1 and 2 are the two phases of palette 0, bit 7 clear',
    (seen[1].bytes[0] & 0x80) === 0 && (seen[2].bytes[0] & 0x80) === 0
      && seen[1].bytes[0] !== seen[2].bytes[0],
    `1 is ${hex(seen[1].bytes[0])} and 2 is ${hex(seen[2].bytes[0])}`);
  check('colours 3 and above are palette 1, bit 7 set',
    [3, 4, 5, 6, 7].every((c) => (seen[c].bytes[0] & 0x80) !== 0),
    [3, 4, 5, 6, 7].map((c) => `${c}:${hex(seen[c].bytes[0])}`).join(' '));
  check('and 4, 5, 6 and 7 are the same colour - there are five, not eight',
    seen[4].lit > 0 && [5, 6, 7].every((c) =>
      seen[c].bytes.every((v, i) => v === seen[4].bytes[i])),
    `all of them ${seen[4].bytes.map(hex).join(' ')}`);

  // --- engine to pixels ------------------------------------------------------------------
  console.log('\n=== and what the port draws from those bytes ===');
  const hues = {};
  for (const colour of [0, 1, 2, 3, 4]) {
    const r = await draw(...cells(colour));
    const img = imageData();
    paint(r.page, img, { tint: 'colour' });
    const count = {};
    for (let x = 0; x < HGR_W; x++) {
      const p = (ROW * HGR_W + x) * 4;
      const rgb = [img.data[p], img.data[p + 1], img.data[p + 2]];
      if (rgb[0] || rgb[1] || rgb[2]) {
        const n = name(rgb);
        count[n] = (count[n] ?? 0) + 1;
      }
    }
    const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
    hues[colour] = { count, dominant: sorted[0]?.[0], white: count.white ?? 0,
      lit: seen[colour].lit };
    console.log(`  colour ${colour} -> `
      + (sorted.map(([n, v]) => `${v} ${n}`).join(', ') || 'nothing lit'));
  }

  check('the four colours the game uses come out as four different hues',
    new Set([1, 2, 3, 4].map((c) => hues[c].dominant)).size === 4,
    [1, 2, 3, 4].map((c) => `${c} is ${hues[c].dominant}`).join(', ')
      + ' - which is why the instrument panel has three colours in it');
  check('the two that light eight bits for eight cells are that hue and nothing else',
    [1, 4].every((c) => hues[c].lit === 8 && hues[c].white === 0
      && Object.keys(hues[c].count).length === 1),
    `colour 1 is ${hues[1].count[hues[1].dominant]} green, colour 4 is`
      + ` ${hues[4].count[hues[4].dominant]} orange`);
  // The ninth bit is not noise. 20 of the 140 cells straddle a byte boundary, and there the
  // engine ORs the mask into one byte and $01 into the next - so at x = 6, 7, 8 three pixels
  // end up lit in a row, and three in a row is three white pixels, not a pair. DISK_TRUTH
  // records the artifact; this is it arriving on screen, which it cannot do in monochrome.
  check('the two that light NINE show their hue plus a run of three white - the straddle',
    [2, 3].every((c) => hues[c].lit === 9 && hues[c].white === 3),
    `colour 2 is ${hues[2].count.violet} violet + ${hues[2].white} white,`
      + ` colour 3 is ${hues[3].count.blue} blue + ${hues[3].white} white`
      + ' - the extra bit lands beside its neighbour across the byte boundary and the three'
      + ' of them fill two cells');
  check('and colour 0 is white the whole way across, being both bits of every cell',
    hues[0].dominant === 'white' && Object.keys(hues[0].count).length === 1,
    `${hues[0].count.white} pixels, all white`);

  // The control: bit 7 is half of what makes a colour, so a painter that drops it cannot tell
  // 1 from 3 or 2 from 4. Done by actually clearing bit 7 of every byte and painting again,
  // rather than by reasoning about what would happen.
  const blind = [];
  for (const colour of [1, 2, 3, 4]) {
    const r = await draw(...cells(colour));
    const flattened = Uint8Array.from(r.page, (v) => v & 0x7F);
    const img = imageData();
    paint(flattened, img, { tint: 'colour' });
    const count = {};
    for (let x = 0; x < HGR_W; x++) {
      const p = (ROW * HGR_W + x) * 4;
      const rgb = [img.data[p], img.data[p + 1], img.data[p + 2]];
      if (rgb[0] || rgb[1] || rgb[2]) {
        const n = name(rgb);
        count[n] = (count[n] ?? 0) + 1;
      }
    }
    blind.push(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]);
  }
  check('control: with bit 7 cleared the same four pages give only two hues, not four',
    new Set(blind).size === 2 && new Set([1, 2, 3, 4].map((c) => hues[c].dominant)).size === 4,
    `${blind.join(', ')} - the palette bit is half of what makes a colour, and it is the`
      + ' half a monochrome renderer throws away');
} finally {
  await a2.close();
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
