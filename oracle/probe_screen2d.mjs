// What a 2-D coordinate means.
//
// The display list is full of them - every instrument-panel line, every blip, and the
// output of the engine's own 3-D projection - and nothing so far said what they map to.
// The panel's y values run past 192 and its x values past 140, so they are plainly not
// pixel coordinates.
//
// They are not. The answer is in four 256-byte tables at $7223-$7622, the 1,024 bytes the
// renderer disassembly could only call "a table", which the point plotter at $771F indexes
// directly:
//
//     CLC
//     LDA $7223,Y   ADC $BB   STA $9A      ; y -> the row's address, high byte (+ page)
//     LDA $7323,Y   CLC   ADC $7423,X   TAY ; y -> the row's low byte, + x's byte offset
//     LDA $7523,X                           ; x -> a two-bit mask
//     BMI straddle
//     ORA ($99),Y   STA ($99),Y
//
// $99 is zero, so the whole address is assembled out of the tables. Which means the
// mapping can be read off them exactly, with no inference at all - and then checked by
// making the real engine plot real points, which is what the second half of this does.
//
// The straddle: a mask with bit 7 set is a cell whose two bits fall either side of a byte
// boundary, and the engine ORs the mask into this byte and $01 into the next. Bit 7 of a
// hires byte is not a pixel, it is the palette select - so a point at such a cell flips
// that byte's colour as a side effect. That is the engine's behaviour, not a mistake in
// reading it, and a port has to reproduce it.
import { openOracle } from './a2.mjs';
import { engineMemory, hx } from './renderer.mjs';
import { toFlight, arm, runList, op, rowAddr } from './exercise.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const ROWHI = 0x7223, ROWLO = 0x7323, XBYTE = 0x7423, XMASK = 0x7523;
const { mem } = engineMemory();
const s8 = (v) => (v > 127 ? v - 256 : v);

// --- read the mapping off the tables ----------------------------------------------------
// For x, the byte offset and the mask together say which screen bit a cell owns.
const cells = [];
for (let i = 0; i < 256; i++) {
  const mask = mem[XMASK + i], byte = mem[XBYTE + i];
  if (!mask) { cells.push({ x: s8(i), mask, byte, bits: [] }); continue; }
  const bits = [];
  for (let b = 0; b < 7; b++) if (mask & (1 << b)) bits.push(byte * 7 + b);
  // bit 7 is the palette select, and the straddle path lights bit 0 of the next byte
  if (mask & 0x80) bits.push((byte + 1) * 7);
  cells.push({ x: s8(i), mask, byte, bits, straddles: !!(mask & 0x80) });
}
// For y, the two table bytes are the row's address with the x=0 offset folded in.
const rowOf = new Map();
for (let r = 0; r < 192; r++) rowOf.set(rowAddr(r), r);
// The address the plotter assembles for x = 0: the two table bytes, with x's byte offset
// added to the low one and allowed to carry. rowAddr() is relative to the page, and $BB is
// zero for the first page, so the $2000 comes off to compare them.
const yRow = [];
for (let i = 0; i < 256; i++) {
  const lo = mem[ROWLO + i] + mem[XBYTE + 0];
  const full = (mem[ROWHI + i] << 8) + (lo & 0xff) + (lo > 255 ? 0x100 : 0) - 0x2000;
  let row = null;
  for (let r = 0; r < 192; r++) if (full >= rowAddr(r) && full < rowAddr(r) + 40) { row = r; break; }
  yRow.push({ y: s8(i), row });
}

console.log('\n=== the mapping, read off the engine\'s own tables ===');
const live = cells.filter((c) => c.mask);
const xs = live.map((c) => c.x);
console.log(`  x: ${live.length} of 256 values plot, running ${Math.min(...xs)} to ${Math.max(...xs)}`);
console.log(`     every cell is two adjacent screen bits; masks seen: `
  + [...new Set(cells.map((c) => c.mask))].sort((a, b) => a - b).map((v) => hx(v)).join(' '));
check('one x unit is two hires bits, and x = 0 is the centre of the 280',
  cells[0].bits[0] === 140 && cells[1].bits[0] === 142 && cells[255].bits[0] === 138,
  `x=0 -> bit ${cells[0].bits[0]}, x=1 -> ${cells[1].bits[0]}, x=-1 -> ${cells[255].bits[0]}`);
const allBits = new Set(live.flatMap((c) => c.bits));
check('the plottable x values cover the screen exactly once, with nothing left over',
  live.length === 140 && allBits.size === 280
    && Math.min(...allBits) === 0 && Math.max(...allBits) === 279,
  `${live.length} cells, ${allBits.size} distinct bits, ${Math.min(...xs)}..${Math.max(...xs)}`);
const onScreenY = yRow.filter((v) => v.y >= -96 && v.y <= 95);
check('row = 95 - y, exactly, for every y from -96 to 95',
  onScreenY.every((v) => v.row === 95 - v.y),
  `y=0 -> row ${yRow[0].row}, y=95 -> ${yRow[95].row}, y=-96 -> ${yRow[(256 - 96)].row}`);
check('and that is all 192 rows, so y is a signed byte with 0 three-quarters up',
  new Set(onScreenY.map((v) => v.row)).size === 192);
const straddlers = cells.filter((c) => c.straddles);
console.log(`  ${straddlers.length} of the 140 cells straddle a byte boundary and set the palette bit`
  + ` as a side effect: x = ${straddlers.map((c) => c.x).slice(0, 6).join(', ')}, ...`);

// --- now make the engine do it -----------------------------------------------------------
// Predictions above, measurements below. A reading of a lookup table is only a reading.
const a2 = await openOracle();
console.log('\n=== driving to flight, where the engine is resident ===');
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight and the engine can be called directly', flight.difficulty === 1);

const head = [...op.switches(), ...op.clear(0), ...op.drawTo(0)];
const draw = (...body) => runList(a2, [...head, ...body, ...op.end()], { page: 1 });

console.log('\n=== points: predicted from the tables, then plotted ===');
const PROBE_POINTS = [[0, 0], [1, 0], [-1, 0], [3, 0], [-70, 0], [69, 0],
  [0, 95], [0, -96], [-57, -83], [-12, -83], [-20, 80]];
const wrong = [];
for (const [x, y] of PROBE_POINTS) {
  const r = await draw(...op.colour(7), ...op.point2d(x, y));
  const want = { row: 95 - y, bits: cells[(x + 256) % 256].bits };
  const got = { row: r.lit[0]?.row, bits: r.lit.map((p) => p.bit) };
  const ok = got.row === want.row && got.bits.every((b) => want.bits.includes(b)) && got.bits.length > 0;
  if (!ok) wrong.push(`(${x},${y})`);
  console.log(`  point2d(${String(x).padStart(4)},${String(y).padStart(4)})  `
    + `predicted row ${String(want.row).padStart(3)} in bits ${want.bits.join('/')}  ->  `
    + (r.lit.length ? `row ${got.row}, bit ${got.bits.join(',')}` : 'NOTHING LIT'));
}
check('every point lands on the row and inside the cell the tables predict',
  wrong.length === 0, wrong.length ? 'wrong: ' + wrong.join(' ') : `${PROBE_POINTS.length} points`);

// One bit of the two, not both: the cell is the pixel and the colour chooses the bit.
console.log('\n=== colour: what gets ORed into the page ===');
const colours = [];
for (let c = 0; c < 8; c++) {
  const body = [...op.colour(c)];
  for (let x = 0; x < 8; x++) body.push(...op.point2d(x, 0));
  const r = await draw(...body);
  const base = rowAddr(95);
  const pattern = [r.page[base + 20], r.page[base + 21]];
  colours.push({ colour: c, pattern, lit: r.lit.length });
  console.log(`  colour ${c}: bytes 20,21 = ${pattern.map((v) => v.toString(2).padStart(8, '0')).join(' ')}`
    + `  (${hx(pattern[0])} ${hx(pattern[1])})  ${r.lit.length} bits lit of 8 cells`);
}
check('colour 0 lights both bits of every cell - it is white',
  colours[0].lit === 16, `${colours[0].lit} bits for 8 cells`);
check('colours 1 to 7 light one bit of each cell, which is how hires carries colour',
  colours.slice(1).every((c) => c.lit === 8 || c.lit === 9),
  colours.slice(1).map((c) => c.lit).join(','));
check('the palette bit tracks the colour: 1 and 2 leave it clear, 3 upwards set it',
  !(colours[1].pattern[1] & 0x80) && !(colours[2].pattern[1] & 0x80)
    && (colours[3].pattern[1] & 0x80) && (colours[7].pattern[1] & 0x80));
const distinct = new Set(colours.map((c) => c.pattern.join(',')));
check('there are five distinct colours, not eight - 4, 5, 6 and 7 are the same',
  distinct.size === 5, `${distinct.size} distinct patterns`);

// --- lines ---------------------------------------------------------------------------------
console.log('\n=== 2-D lines ===');
const h = await draw(...op.colour(7), ...op.line2d(-10, 10, 10, 10));
const hrows = [...new Set(h.lit.map((p) => p.row))];
check('a horizontal line is one row and includes both endpoints',
  hrows.length === 1 && hrows[0] === 85 && h.lit.length === 21,
  `row ${hrows.join(',')}, ${h.lit.length} cells for x -10..10`);
const v = await draw(...op.colour(7), ...op.line2d(5, -20, 5, 20));
const vbits = [...new Set(v.lit.map((p) => p.bit))];
check('a vertical line is one column and includes both endpoints',
  vbits.length === 1 && vbits[0] === cells[5].bits[1] && v.lit.length === 41,
  `bit ${vbits.join(',')}, ${v.lit.length} rows for y -20..20`);

// The instrument panel, drawn on its own, has to come out where the panel is.
const panel = await draw(...op.colour(1),
  ...op.line2d(199, 173, 244, 173), ...op.line2d(199, 211, 244, 211), ...op.line2d(199, 192, 244, 192));
const prows = [...new Set(panel.lit.map((p) => p.row))].sort((a, b) => a - b);
// y = 173, 192 and 211 are -83, -64 and -45 signed, so rows 178, 159 and 140.
check('the three gauge bars from SV DATA land where 95 - y puts them, low on the screen',
  prows.join(',') === '140,159,178', `rows ${prows.join(', ')}`);

await a2.close();
fs.mkdirSync('captured/screen2d', { recursive: true });
fs.writeFileSync('captured/screen2d/golden.json', JSON.stringify({
  mapping: { bitForX: '140 + 2x, for x in -70..69', rowForY: '95 - y, for y in -96..95' },
  cells: cells.filter((c) => c.mask).map((c) => ({ x: c.x, byte: c.byte, mask: hx(c.mask), bits: c.bits })),
  colours: colours.map((c) => ({ colour: c.colour, pattern: c.pattern.map((v) => hx(v)), bitsLit: c.lit })),
  results,
}, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `screen2d: all ${results.length} checks passed`
  : `screen2d: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
