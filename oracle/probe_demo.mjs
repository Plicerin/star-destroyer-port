// The attract mode, which is the only place this game ever says what it is about.
//
// `LOGO1` polls `$C000` five hundred times. A key chains `SELECT`; the loop running out chains
// `DEMO` - so the branch nobody takes is the one with the story in it, and the text screen
// before it actively invites you past: PRESS ANY KEY TO SKIP TITLE PAGE.
//
// `DEMO` is an animation with three blocks of text cut into it. The text is `XDRAW`n from the
// shape table at line 400, and line 412 is
//
//     412 FOR J = 1 TO 2000: NEXT :RETURN
//
// an empty Applesoft loop, which is how long you get to read it. **That delay is the whole
// question.** In the port an empty `FOR`/`NEXT` costs nothing at all, so all three blocks are
// drawn and overwritten inside a single frame and the page is nearly empty by the end - which
// is open question 16, and the reason to finally walk `DEMO` in the machine.
//
// What is measured here, per video frame, is Applesoft's own current line number at `$75`/`$76`
// together with the cycle counter, which gives the attract's whole shape in one pass: when it
// is animating, when it is drawing text, how long it then sits on it, and where it goes. The
// number the port actually needs is one division: the cost of one iteration of an empty
// Applesoft loop.
import { openOracle } from './a2.mjs';
import { decodeHgr, toPng } from './hgr.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};

/** 17,030 cycles a frame at 1.0205 MHz, which is what `frames()` steps. */
const HZ = 1020500;
const ms = (cycles) => (cycles / HZ) * 1000;

const a2 = await openOracle();
fs.mkdirSync('captured/demo', { recursive: true });

console.log('=== the attract mode ===');

await a2.coldStart();

// --- wait for START, and then keep your hands off the keyboard -----------------------------
let sawMessage = false;
for (let i = 0; i < 60 && !sawMessage; i++) {
  await a2.waitMs(500);
  sawMessage = (await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'));
}
check('the disk boots to START without being touched', sawMessage);

/**
 * Step the machine a frame at a time, recording where Applesoft is.
 *
 * The loop runs inside the page rather than out here: `frames()` is synchronous, so a
 * thousand samples are one round trip instead of a thousand. `$75`/`$76` is CURLIN, the line
 * number Applesoft is executing, which is the cheapest possible window into a running BASIC
 * program - no screen to identify, no guessing from the video mode.
 */
const walk = (frames) => a2.ev(`JSON.stringify((() => {
  const M = window.M, out = [];
  for (let i = 0; i < ${frames}; i++) {
    M.frames(1);
    out.push([M.cpu.getCycles(), M.rd(0x75) | (M.rd(0x76) << 8)]);
  }
  return out;
})())`).then(JSON.parse);

// Long enough for LOGO1's five hundred iterations and the whole of the attract after it.
const samples = [];
for (let chunk = 0; chunk < 8; chunk++) samples.push(...await walk(900));
console.log(`  ${samples.length} frames walked, `
  + `${(ms(samples[samples.length - 1][0] - samples[0][0]) / 1000).toFixed(1)}s of machine time`);

/** The samples as runs of one line number, with the cycles spent on each. */
const runs = [];
for (const [cycles, line] of samples) {
  const last = runs[runs.length - 1];
  if (last && last.line === line) { last.to = cycles; last.frames += 1; continue; }
  runs.push({ line, from: cycles, to: cycles, frames: 1 });
}

// --- it reaches DEMO on its own ------------------------------------------------------------
// DEMO's animation loop is 140-186 and nothing else on this disk uses those line numbers in
// that order; its text routine is 400-412.
// Line 9 ends `GOTO 127`, so 127 is DEMO's first real line and it is reached once.
const firstDemo = runs.findIndex((r) => r.line === 127);
check('left alone, LOGO1 runs out and the attract starts',
  firstDemo >= 0,
  firstDemo >= 0
    ? `DEMO's line 127 at ${(ms(runs[firstDemo].from - samples[0][0]) / 1000).toFixed(1)}s - `
      + 'everything before it is START and LOGO1 loading pictures off the disk'
    : 'never reached DEMO');

// --- the three blocks of text --------------------------------------------------------------
// `GOSUB 400` draws a block and line 412 is the pause on it. A block is a contiguous stretch
// of line numbers in 400-412; the pause inside it is the stretch at 412 alone.
const blocks = [];
for (const r of runs) {
  if (r.line < 400 || r.line > 412) { if (blocks.length && blocks[blocks.length - 1].open) blocks[blocks.length - 1].open = false; continue; }
  const last = blocks[blocks.length - 1];
  if (last && last.open) { last.to = r.to; if (r.line === 412) last.pause += r.to - r.from; continue; }
  blocks.push({ from: r.from, to: r.to, pause: r.line === 412 ? r.to - r.from : 0, open: true });
}
check('the attract stops three times to put words on the screen',
  blocks.length === 3,
  blocks.map((b, i) => `block ${i + 1}: ${ms(b.to - b.from).toFixed(0)}ms`).join(', ')
    || 'none found');

const pauses = blocks.map((b) => b.pause);
const spread = pauses.length ? (Math.max(...pauses) - Math.min(...pauses)) / Math.max(...pauses) : 1;
check('and each one then sits there for the same length of time',
  pauses.length === 3 && spread < 0.05,
  pauses.map((p) => `${ms(p).toFixed(0)}ms`).join(' / ')
    + ` - line 412's FOR J = 1 TO 2000, which is the whole of how long you get to read it`);

// --- the number the port needs ---------------------------------------------------------------
const perIteration = pauses.length ? (pauses.reduce((a, b) => a + b, 0) / pauses.length) / 2000 : 0;
check('an empty Applesoft loop costs about a millisecond an iteration',
  perIteration > 900 && perIteration < 1300,
  `${perIteration.toFixed(0)} cycles, ${ms(perIteration).toFixed(2)}ms - so line 412 is `
    + `${(ms(perIteration * 2000) / 1000).toFixed(1)}s, LOGO1's FOR J = 1 TO 500 is `
    + `${(ms(perIteration * 500) / 1000).toFixed(1)}s and SELECT's 1500 is `
    + `${(ms(perIteration * 1500) / 1000).toFixed(1)}s`);

// --- and where it goes ------------------------------------------------------------------------
// Line 153 leaves the animation for 200, and 210 is `RUN SELECT`. The listing says so; this
// says the machine does it, rather than looping the attract forever.
const ran = runs.findIndex((r, i) => i > firstDemo && r.line === 210);
check('the attract ends by running SELECT rather than looping',
  ran > firstDemo,
  ran > firstDemo
    ? `line 210 at ${(ms(runs[ran].from - runs[firstDemo].from) / 1000).toFixed(1)}s after the`
      + ' attract started, which answers open question 16'
    : 'line 210 was never reached');

const attract = runs.slice(firstDemo, ran > firstDemo ? ran + 1 : undefined);
const renders = attract.filter((r) => r.line === 186).length;
const total = ms(attract[attract.length - 1].to - attract[0].from);
check('the attract is three quarters of a minute, and mostly the renderer',
  total > 30000 && total < 90000,
  `${(total / 1000).toFixed(1)}s in total: ${renders} visits to line 186, the CALL 24576 that`
    + ` renders, at about 0.31s each, and ${(ms(pauses.reduce((a, b) => a + b, 0)) / 1000)
      .toFixed(1)}s of reading time`);

fs.writeFileSync('captured/demo/timeline.json', JSON.stringify(
  runs.map((r) => ({ line: r.line, ms: +ms(r.to - r.from).toFixed(1),
    at: +(ms(r.from - samples[0][0]) / 1000).toFixed(2) })), null, 1));
const shown = Uint8Array.from(await a2.readRange(0x2000, 0x4000));
fs.writeFileSync('captured/demo/last_page1.png', toPng(decodeHgr(shown)));

await a2.close();
console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
