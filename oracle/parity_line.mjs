// The port's 2-D line against the engine's, a whole page at a time.
//
// The line routine is the one piece of the 2-D layer that is a conclusion rather than a
// copy - port/src/a23d2/line.js is Bresenham because the engine was measured to be
// Bresenham, not because line routines usually are. So this sweeps it hard: every slope
// from flat to vertical, both signs on each axis, endpoints at odd and even positions,
// the degenerate cases, and lines that run off the screen.
//
// Whole-page comparison again. A line that is right except for one pixel at one
// threshold is exactly the failure a sampled check misses, and exactly the failure that
// would make a frame of the real scene differ later for no visible reason.
import { openOracle } from './a2.mjs';
import { toFlight, arm, runList, op } from './exercise.mjs';
import { Screen } from '../port/src/a23d2/screen.js';
import { line, lineCells } from '../port/src/a23d2/line.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

const CONSTANTS = [15, 0x80, 0x3E, 0xFF, 0x7F, 0x45, 0x25];
const head = [20, 0, 12, 0, 29, 0, ...CONSTANTS, ...op.switches(),
  ...op.viewport(140, 126, 0, 34), ...op.clear(0), ...op.drawTo(0)];

/** Draw a batch of lines through both and compare all 8,192 bytes. */
async function compare(name, lines, colour = 0) {
  const list = [...head, ...op.colour(colour)];
  const screen = new Screen();
  screen.setColour(colour);
  for (const [x1, y1, x2, y2] of lines) {
    list.push(...op.line2d(x1, y1, x2, y2));
    line(screen, x1, y1, x2, y2);
  }
  const r = await runList(a2, [...list, 121], { page: 1, budget: 20000000 });
  const theirs = r.page, ours = screen.pages[0];
  const diffs = [];
  for (let i = 0; i < 0x2000; i++) if (theirs[i] !== ours[i]) diffs.push(i);
  if (diffs.length) {
    const d = diffs[0];
    console.log(`     first difference at $${(d + 0x2000).toString(16).toUpperCase()}: `
      + `engine ${theirs[d].toString(2).padStart(8, '0')}, port ${ours[d].toString(2).padStart(8, '0')}`);
  }
  console.log(`  ${name.padEnd(50)} ${diffs.length === 0 ? 'identical' : diffs.length + ' bytes differ'}`
    + `  (${lines.length} lines)`);
  return diffs.length;
}

console.log('\n=== whole-page comparisons ===');
let failures = 0;

// A fan from the centre: every slope, every quadrant, drawn one batch at a time so a
// failure says which fan it was in.
for (const [name, from] of [['centre', [0, 0]], ['off-centre odd', [-23, 17]]]) {
  const lines = [];
  for (let a = 0; a < 360; a += 5) {
    const r = 60;
    const x = Math.round(from[0] + r * Math.cos(a * Math.PI / 180));
    const y = Math.round(from[1] + r * Math.sin(a * Math.PI / 180) * 1.3);
    lines.push([from[0], from[1], Math.max(-70, Math.min(69, x)), Math.max(-96, Math.min(95, y))]);
  }
  failures += await compare(`a 72-spoke fan from ${name}`, lines);
}

// Every shallow slope at one length, which is where the error threshold bites.
{
  const lines = [];
  for (let dy = -39; dy <= 39; dy++) lines.push([-40, 0, 0, dy]);
  failures += await compare('every shallow slope over dx = 40', lines);
}
// Every steep slope.
{
  const lines = [];
  for (let dx = 0; dx <= 39; dx++) lines.push([0, -40, dx, 39]);
  failures += await compare('every steep slope over dy = 79', lines);
}
// Odd and even endpoints, where floor(dx/2) and the straddling cells interact.
{
  const lines = [];
  for (let x1 = -9; x1 <= 9; x1++) for (let x2 = 20; x2 <= 29; x2++) lines.push([x1, -60, x2, -20]);
  failures += await compare('odd and even endpoints, 190 lines', lines);
}
// Degenerate: a point, a horizontal, a vertical, an exact diagonal (which goes steep).
{
  const lines = [[0, 0, 0, 0], [-50, 20, 50, 20], [10, -80, 10, 80],
    [-40, -40, 40, 40], [40, -40, -40, 40], [-1, -1, 1, 1], [5, 5, 5, 6], [5, 5, 6, 5]];
  failures += await compare('degenerate and exactly diagonal lines', lines);
}
// Reversed endpoints: the engine swaps on x, so these must match their mirrors exactly.
{
  const lines = [];
  for (let dy = -30; dy <= 30; dy += 3) { lines.push([-50, 0, 30, dy]); lines.push([30, dy, -50, 0]); }
  failures += await compare('each line drawn both ways round', lines);
}
// In colour, where the plot routine stores rather than ORs.
for (const c of [1, 3]) {
  const lines = [];
  for (let a = 0; a < 360; a += 15) {
    const x = Math.round(55 * Math.cos(a * Math.PI / 180));
    const y = Math.round(70 * Math.sin(a * Math.PI / 180));
    lines.push([0, 0, x, y]);
  }
  failures += await compare(`a 24-spoke fan in colour ${c}`, lines, c);
}
// Running off the screen, where the tables wrap.
{
  const lines = [[-70, 90, 69, -95], [0, 95, 0, -96], [-70, 0, 69, 0], [69, 95, -70, -96]];
  failures += await compare('lines spanning the whole screen corner to corner', lines);
}

check('every line comparison is byte-for-byte identical across the whole page',
  failures === 0, failures ? `${failures} differing bytes in total` : 'ten pages, no differences');

// The two properties the routine's shape rests on, checked directly rather than implied.
{
  const a = lineCells(-50, 0, 30, 17), b = lineCells(30, 17, -50, 0);
  check('drawing a line backwards gives the identical cells, because the engine swaps on x',
    JSON.stringify(a) === JSON.stringify(b), `${a.length} cells each way`);
  const diag = lineCells(0, 0, 20, 20);
  check('the exact diagonal takes the steep path and steps both axes every cell',
    diag.length === 21 && diag.every(([x, y], i) => x === i && y === i) && !diag.run,
    `${diag.length} cells, ${diag.run ? 'shallow' : 'steep'}`);
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/line.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_line: all ${results.length} checks passed`
  : `parity_line: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
