// Does the disk boot in the oracle at all, and what does it do for the first minute?
//
// This is the go/no-go for the whole method. If apple2js cannot run this disk, nothing
// downstream can be measured against it and the port would be guesswork again.
//
// It deliberately does NOT use a2.mjs's boot(), which waits for the machine to sit in the
// Autostart ROM's KEYIN loop. That is how Space Vikings announces its first question, and
// assuming Star Destroyer does the same would be assuming the answer. This cold-starts
// and then just watches: the text screen, the display soft switches, the program that is
// loaded, and where the 6502 is, sampled across a minute of machine time.
//
// Two things were wrong with the first version of this file, and both are worth naming
// because neither announced itself.
//
// It had no checks. It printed a narrative, wrote a golden and exited 0 whatever the disk
// did; the only way it could fail was the drive refusing the image. A probe that cannot
// fail is not evidence of anything, and this one was the go/no-go for all the others.
//
// And its golden drifted. apple2js models power-on RAM as `s & 2 ? 0 : 255` with four
// random bytes every 512, which is faithful to a real machine and means any reading taken
// before the disk has overwritten that address differs on every run. The samples at 0.5s,
// 1s, 2s and 5s changed every time the probe ran, so a third of the golden recorded
// nothing but the random number generator. a2.mjs's coldStart() now fills RAM
// deterministically, and the determinism is itself checked below.
import { openOracle } from './a2.mjs';
import { listProgram } from './detokenise.mjs';
import { decodeHgr, toPng } from './hgr.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const a2 = await openOracle();

// What the machine is showing.
//
// Not from `getIO().getState()`, which carries annunciators and cards and no display
// flags at all - asking it for `.hires` returns undefined, and the first version of this
// probe duly reported "TEXT" for all sixty seconds while the hires pages were visibly
// churning. Nor from the read-only status switches at $C01A-$C01D: apple2js answers 0 to
// all four whatever the mode, so peeking them is a reading that cannot be anything but
// zero. The video modes live on the VideoModes object, which has a real getState().
const probe = () => a2.ev(`JSON.stringify((() => {
  const a = window.M.a2, rd = window.M.rd;
  const v = a.vm.getState();
  return {
    pc: window.M.cpu.getPC(),
    // TXTTAB/VARTAB say whether a BASIC program is loaded and how big it is.
    txttab: rd(0x67) | (rd(0x68) << 8),
    vartab: rd(0x69) | (rd(0x6a) << 8),
    hgrHash: window.M.hash(0x2000, 0x4000),
    hgr2Hash: window.M.hash(0x4000, 0x6000),
    textHash: window.M.hash(0x400, 0x800),
    text: v.textMode, mixed: v.mixedMode, hires: v.hiresMode, page: v.pageMode,
  };
})())`).then(JSON.parse);

/** Cold-start, then sample the machine at each of `atMs`. */
async function watch(atMs, { fill = 0x00, pictures = false } = {}) {
  const loaded = await a2.coldStart({ fill });
  const log = [], pages = {};
  let now = 0;
  for (const at of atMs) {
    await a2.waitMs(at - now);
    now = at;
    const st = await probe();
    const screen = await a2.screen();
    log.push({ atMs: at, ...st, text: screen.filter((r) => r.trim()).join(' | ') });
    if (pictures) {
      const base = st.page === 2 ? 0x4000 : 0x2000;
      pages[at] = await a2.readRange(base, base + 0x2000);
    }
  }
  return { loaded, log, pages };
}

// --- the minute ------------------------------------------------------------------------
const SAMPLES = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 45000, 60000];
const run = await watch(SAMPLES, { pictures: true });
console.log(`\ndisk in drive 1: ${run.loaded.bytes} bytes`);
let lastText = '';
for (const st of run.log) {
  const mode = (st.text ? 'TEXT' : st.hires ? 'HGR' : 'LORES')
    + (st.page === 2 ? '/page2' : '') + (st.mixed ? '+mixed' : '');
  console.log(`\n--- ${(st.atMs / 1000).toFixed(1)}s   PC $${st.pc.toString(16).toUpperCase()}   ${mode}   `
    + `prog $${st.txttab.toString(16)}-$${st.vartab.toString(16)}   hgr ${st.hgrHash}/${st.hgr2Hash}`);
  if (st.text !== lastText) {
    for (const row of st.text.split(' | ')) if (row.trim()) console.log('   | ' + row);
    lastText = st.text;
  } else {
    console.log('   (text screen unchanged)');
  }
}

// Whatever Applesoft program is in memory at the end of the minute.
const mem = await a2.readRange(0x800, 0x9000);
const lines = listProgram([0, ...mem].slice(0), 0x801);
console.log(`\nApplesoft in memory at 60s: ${lines.length} lines`);
for (const l of lines.slice(0, 12)) console.log('   ' + l);

// --- what that minute has to have shown ---------------------------------------------------
console.log('');
const at = (ms) => run.log.find((x) => x.atMs === ms);
const any = (f) => run.log.some(f);

// Booting means leaving the boot ROM. A machine still in $C600-$C6FF never read the disk.
check('the 6502 leaves the slot 6 boot ROM',
  any((x) => x.pc < 0xC600 || x.pc > 0xC6FF),
  'PCs ' + [...new Set(run.log.map((x) => '$' + x.pc.toString(16).toUpperCase()))].join(' '));
// DOS 3.3 loads a program and runs it; VARTAB above the empty-BASIC $803 is a program.
check('a BASIC program is loaded and running',
  any((x) => x.vartab > 0x803 && x.txttab === 0x801),
  'VARTAB reaches $' + Math.max(...run.log.map((x) => x.vartab)).toString(16));
check('that program is START, which says so on the text screen',
  any((x) => x.text.includes('STARSHIP BATTLE')));
check('the machine reaches hires graphics',
  any((x) => x.hires && !x.text));
// START BLOADs SD.PIC1 to $2000 and SD.PIC2 to $4000, so both pages have to fill.
check('both hires pages are written, as START BLOADing two pictures requires',
  new Set(run.log.map((x) => x.hgrHash)).size > 1
    && new Set(run.log.map((x) => x.hgr2Hash)).size > 1,
  `${new Set(run.log.map((x) => x.hgrHash)).size} distinct page 1, `
  + `${new Set(run.log.map((x) => x.hgr2Hash)).size} distinct page 2`);
check('and it is still running at 60s rather than stopped at a prompt',
  at(60000).vartab > 0x803);

// --- the golden has to be a golden ----------------------------------------------------------
// The check the first version could not have made, because it was failing it. Cold-start
// again from the same power-on RAM and require every sample to be identical. If this
// fails, nothing captured anywhere in this directory means quite what it says.
console.log('');
const REPEAT = [500, 1000, 2000, 5000, 10000];
const again = await watch(REPEAT);
const first = run.log.filter((x) => REPEAT.includes(x.atMs));
const drifted = again.log.filter((x, i) => JSON.stringify(x) !== JSON.stringify(first[i]));
check('two cold starts from the same power-on RAM are identical',
  drifted.length === 0,
  drifted.length ? 'differs at ' + drifted.map((x) => x.atMs + 'ms').join(', ')
    : `${again.log.length} samples`);

// The other half of that bargain: a fixed fill is only honest if the game does not depend
// on which fill it is. Real power-on RAM is arbitrary, so if $A5 took the machine
// somewhere else, the oracle would be measuring a coincidence rather than the disk.
//
// Compared against `again` rather than against the minute-long run, because the two must
// be sampled on the SAME schedule. waitMs rounds to whole frames, so reaching 10s in five
// steps lands on frame 600 and reaching it in one step lands on frame 599 - and the first
// version of this check compared those two and reported that the game reads power-on RAM.
// The clock here is frames; the schedule is part of the measurement.
// What this cannot ask for is identity from the first sample. Early on, most of what the
// probe hashes IS the power-on fill, not yet overwritten, so two fills differ there by
// definition and that says nothing about the game. The question is whether they CONVERGE:
// once the disk has loaded and START is running, a machine that seeded nothing from
// power-on RAM is in the same state whatever it woke up holding.
const other = await watch(REPEAT, { fill: 0xA5 });
const keys = ['pc', 'txttab', 'vartab', 'hgrHash', 'hgr2Hash', 'textHash'];
const differsAt = REPEAT.map((ms, i) =>
  ({ ms, fields: keys.filter((k) => other.log[i][k] !== again.log[i][k]) }));
const converged = differsAt.find((x) => !x.fields.length);
for (const x of differsAt) {
  console.log(`  fill $00 vs $A5 at ${String(x.ms).padStart(5)}ms: `
    + (x.fields.length ? 'differs in ' + x.fields.join(', ') : 'identical'));
}
check('two different power-on fills converge on the same machine',
  !!converged && differsAt[differsAt.length - 1].fields.length === 0,
  converged ? `identical from ${converged.ms}ms on - the game seeds nothing from power-on RAM`
    : 'never converge, so the disk reads uninitialised memory');

// --- captures --------------------------------------------------------------------------------
fs.mkdirSync('captured/boot', { recursive: true });
// And the hires pages as pictures, so "it booted" is something that can be looked at.
for (const { atMs, page } of run.log) {
  const m = run.pages[atMs];
  if (!m) continue;
  fs.writeFileSync(`captured/boot/${String(atMs).padStart(5, '0')}ms_page${page}.png`,
    toPng(decodeHgr(Uint8Array.from(m))));
}
fs.writeFileSync('captured/boot/golden.json',
  JSON.stringify({ log: run.log, basicLines: lines, results }, null, 1) + '\n');
console.log(`\nwrote captured/boot/golden.json`);
if (a2.errors.length) console.log('page errors:', a2.errors.slice(0, 3));
await a2.close();

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `boot: all ${results.length} checks passed`
  : `boot: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
