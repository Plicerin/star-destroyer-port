// Does the disk boot in the oracle at all, and what does it do for the first minute?
//
// This is the go/no-go for the whole method. If apple2js cannot run this disk, nothing
// downstream can be measured against it and the port would be guesswork again.
//
// It deliberately does NOT use a2.mjs's boot(), which waits for the machine to sit in the
// Autostart ROM's KEYIN loop. That is how Space Vikings announces its first question, and
// assuming Star Destroyer does the same would be assuming the answer. This boots the slot
// 6 ROM and then just watches: the text screen, the display soft switches, the program
// that is loaded, and where the 6502 is, sampled across a minute of machine time.
import { openOracle } from './a2.mjs';
import { listProgram } from './detokenise.mjs';
import { decodeHgr, toPng } from './hgr.mjs';
import fs from 'fs';

const a2 = await openOracle();

const load = JSON.parse(await a2.ev(`(async () => {
  const io = window.M.a2.getIO();
  const disk2 = io._slot ? io._slot[6] : null;
  if (!disk2) return JSON.stringify({ ok: false, why: 'no Disk II in slot 6' });
  const data = await (await fetch('/disk.dsk')).arrayBuffer();
  await disk2.setBinary(1, 'stardestroyer', 'dsk', data);
  window.M.disk2 = disk2;
  return JSON.stringify({ ok: !!disk2.getMetadata(1), bytes: data.byteLength });
})()`));
console.log(`disk in drive 1: ${load.ok ? load.bytes + ' bytes' : 'FAILED - ' + load.why}`);
if (!load.ok) { await a2.close(); process.exit(1); }

await a2.ev(`(() => {
  window.M.a2.reset();
  const cpu = window.M.cpu, st = cpu.getState();
  st.pc = 0xC600;
  cpu.setState(st);
  return 'booting slot 6';
})()`);

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

const log = [];
const pages = {};
let lastText = '';
for (const atMs of [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 45000, 60000]) {
  const now = log.length ? log[log.length - 1].atMs : 0;
  await a2.waitMs(atMs - now);
  const st = await probe();
  const screen = await a2.screen();
  const text = screen.filter((r) => r.trim()).join(' | ');
  log.push({ atMs, ...st, text });
  // The page the machine is actually showing, for the picture below.
  const base = st.page === 2 ? 0x4000 : 0x2000;
  pages[atMs] = await a2.readRange(base, base + 0x2000);
  const mode = (st.text ? 'TEXT' : st.hires ? 'HGR' : 'LORES')
    + (st.page === 2 ? '/page2' : '') + (st.mixed ? '+mixed' : '');
  console.log(`\n--- ${(atMs / 1000).toFixed(1)}s   PC $${st.pc.toString(16).toUpperCase()}   ${mode}   `
    + `prog $${st.txttab.toString(16)}-$${st.vartab.toString(16)}   hgr ${st.hgrHash}/${st.hgr2Hash}`);
  if (text !== lastText) {
    for (const row of screen) if (row.trim()) console.log('   | ' + row);
    lastText = text;
  } else {
    console.log('   (text screen unchanged)');
  }
}

// Whatever Applesoft program is in memory at the end of the minute.
const mem = await a2.readRange(0x800, 0x9000);
const lines = listProgram([0, ...mem].slice(0), 0x801);
console.log(`\nApplesoft in memory at 60s: ${lines.length} lines`);
for (const l of lines.slice(0, 12)) console.log('   ' + l);

fs.mkdirSync('captured/boot', { recursive: true });
// And the hires pages as pictures, so "it booted" is something that can be looked at.
for (const { atMs, page } of log) {
  const mem = pages[atMs];
  if (!mem) continue;
  fs.writeFileSync(`captured/boot/${String(atMs).padStart(5, '0')}ms_page${page}.png`,
    toPng(decodeHgr(Uint8Array.from(mem))));
}
fs.writeFileSync('captured/boot/golden.json', JSON.stringify({ log, basicLines: lines }, null, 1) + '\n');
console.log(`\nwrote captured/boot/golden.json`);
if (a2.errors.length) console.log('page errors:', a2.errors.slice(0, 3));
await a2.close();
