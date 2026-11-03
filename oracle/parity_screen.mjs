// The port's screen against the engine's, a whole page at a time.
//
// Spot-checking a plotter is easy to pass and worth little. This draws the same points
// through both and compares **all 8,192 bytes** of the hi-res page, so a cell in the
// wrong place, a palette bit the port forgot, or a straddle that carried where it should
// have wrapped all show up as a byte that differs - and the harness says which one.
//
// Covered: every plottable x against a spread of y, all five distinct colours, both
// pages, the straddling cells on their own, the coordinates that fall outside the screen
// and wrap, and erase mode.
import { openOracle } from './a2.mjs';
import { toFlight, arm, runList, op } from './exercise.mjs';
import { Screen, bitForX, rowForY, COLOURS } from '../port/src/a23d2/screen.js';
import { ROW_HI, ROW_LO, X_BYTE, X_MASK } from '../port/src/a23d2/tables.js';
import { engineMemory } from './renderer.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

// --- the tables are the engine's, and the derived formulas still describe them ----------
// gen_tables.mjs copied these out of the disk. That makes the port exact by construction,
// which is worth nothing unless the understanding behind them is also still true - so the
// formulas probe_screen2d derived are checked against the copies here.
{
  const { mem } = engineMemory();
  const same = [[0x7223, ROW_HI], [0x7323, ROW_LO], [0x7423, X_BYTE], [0x7523, X_MASK]]
    .every(([at, t]) => t.every((v, i) => mem[at + i] === v));
  check('the embedded tables are byte-identical to $7223-$7622 on the disk', same);

  const rowAddr = (r) => (r & 7) * 0x400 + (((r >> 3) & 7) * 0x80) + ((r >> 6) * 0x28);
  let wrong = 0;
  for (let i = 0; i < 256; i++) {
    const x = i > 127 ? i - 256 : i;
    const bit = bitForX(x);
    if (bit === null) { if (X_MASK[i] !== 0) wrong++; continue; }
    const bits = [];
    for (let b = 0; b < 7; b++) if (X_MASK[i] & (1 << b)) bits.push(X_BYTE[i] * 7 + b);
    if (X_MASK[i] & 0x80) bits.push((X_BYTE[i] + 1) * 7);
    if (bits[0] !== bit) wrong++;
  }
  check('bit = 140 + 2x still describes the x tables, and nothing else plots', wrong === 0,
    `${wrong} disagreements over 256 values`);
  let yWrong = 0;
  for (let i = 0; i < 256; i++) {
    const y = i > 127 ? i - 256 : i;
    const row = rowForY(y);
    if (row === null) continue;
    const at = ((ROW_HI[i] << 8) | ((ROW_LO[i] + X_BYTE[0]) & 0xff)) - 0x2000;
    if (at < rowAddr(row) || at >= rowAddr(row) + 40) yWrong++;
  }
  check('row = 95 - y still describes the y tables, for every y on the screen', yWrong === 0,
    `${yWrong} disagreements over 192 rows`);
}

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

const CONSTANTS = [15, 0x80, 0x3E, 0xFF, 0x7F, 0x45, 0x25];
const head = (page) => [20, 0, 12, 0, 29, 0, ...CONSTANTS, ...op.switches(),
  ...op.viewport(140, 126, 0, 34), ...op.clear(page), ...op.drawTo(page)];

/**
 * Draw the same thing in both and compare the whole page.
 *
 * `script` is a list of [colour|mode|point] steps, applied to the port's Screen and
 * compiled into a display list for the engine, so the two cannot drift apart in what they
 * were asked to do.
 */
async function compare(name, script, { page = 0 } = {}) {
  const list = [...head(page)];
  const screen = new Screen();
  screen.setDrawPage(page);
  for (const step of script) {
    if (step.colour !== undefined) { list.push(...op.colour(step.colour)); screen.setColour(step.colour); }
    else if (step.mode !== undefined) { list.push(12, step.mode ? 1 : 0); screen.setPlotMode(step.mode); }
    else { list.push(...op.point2d(step.x, step.y)); screen.point(step.x, step.y); }
  }
  const r = await runList(a2, [...list, 121], { page: page ? 2 : 1, budget: 8000000 });
  const theirs = r.page, ours = screen.pages[page ? 1 : 0];
  const diffs = [];
  for (let i = 0; i < 0x2000; i++) if (theirs[i] !== ours[i]) diffs.push(i);
  if (diffs.length) {
    const d = diffs[0];
    console.log(`     first difference at $${(d + (page ? 0x4000 : 0x2000)).toString(16).toUpperCase()}: `
      + `engine ${theirs[d].toString(2).padStart(8, '0')}, port ${ours[d].toString(2).padStart(8, '0')}`);
  }
  console.log(`  ${name.padEnd(52)} ${diffs.length === 0 ? 'identical' : diffs.length + ' bytes differ'}`
    + `  (${script.filter((s) => s.x !== undefined).length} points)`);
  return diffs.length;
}

console.log('\n=== whole-page comparisons ===');
let failures = 0;

// Every x that plots, at four heights, in white.
{
  const script = [{ colour: 0 }];
  for (let x = -70; x <= 69; x++) for (const y of [-90, -30, 0, 60]) script.push({ x, y });
  failures += await compare('every plottable x at four heights, colour 0', script);
}

// Each distinct colour across a band, which is where the parity and the palette bit show.
for (const c of [0, 1, 2, 3, 4, 6]) {
  const script = [{ colour: c }];
  for (let x = -40; x <= 40; x++) for (const y of [-20, 0, 20]) script.push({ x, y });
  failures += await compare(`colour ${c} across a band`, script);
}

// The straddling cells on their own: every x whose mask has bit 7 set.
{
  const straddle = [];
  for (let i = 0; i < 256; i++) if (X_MASK[i] & 0x80) straddle.push(i > 127 ? i - 256 : i);
  for (const c of [0, 2, 4]) {
    const script = [{ colour: c }];
    for (const x of straddle) for (const y of [-50, 10]) script.push({ x, y });
    failures += await compare(`the ${straddle.length} straddling cells, colour ${c}`, script);
  }
}

// Off-screen coordinates, which wrap rather than being rejected.
{
  const script = [{ colour: 0 }];
  for (const y of [96, 100, 120, 127, -97, -110, -128]) for (const x of [-60, 0, 60]) script.push({ x, y });
  for (const x of [70, 90, 127, -71, -100, -128]) for (const y of [0, -40]) script.push({ x, y });
  failures += await compare('coordinates off the screen, which wrap', script);
}

// The second page, to prove the page byte only selects which array.
{
  const script = [{ colour: 1 }];
  for (let x = -60; x <= 60; x += 3) script.push({ x, y: x });
  failures += await compare('a diagonal on page 2', script, { page: 1 });
}

// Erase, which is only defined in colour 0.
{
  const script = [{ colour: 0 }];
  for (let x = -30; x <= 30; x++) script.push({ x, y: 10 });
  script.push({ mode: 1 });
  for (let x = -30; x <= 10; x++) script.push({ x, y: 10 });
  failures += await compare('draw a row in white, then erase part of it', script);
}

check('every comparison is byte-for-byte identical across the whole page', failures === 0,
  failures ? `${failures} differing bytes in total` : 'nine pages, no differences');

// The combination the engine corrupts: the port refuses rather than inventing an answer.
{
  const s = new Screen();
  s.setColour(4);
  s.setPlotMode(1);
  let threw = false;
  try { s.point(0, 0); } catch { threw = true; }
  check('the port refuses colour + EOR, which the original runs as corrupted code', threw,
    'measured on the engine as 7 pixels left of 61, rather than 0');
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/screen.json', JSON.stringify({
  colours: COLOURS, results,
}, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_screen: all ${results.length} checks passed`
  : `parity_screen: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
