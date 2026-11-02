// Can the oracle drive the game, not just boot it?
//
// Booting proves the disk runs. Porting needs more: that a script can answer the game's
// questions and reach the thing being ported - the 3-D flight. The route, read out of the
// BASIC rather than guessed: START draws its message and chains LOGO1; LOGO1 BLOADs
// TITLE.OBJ0 and spins 500 times watching $C000, and a key inside that window chains
// SELECT; SELECT shows DIFFICULTY.PIC, wants 1, 2 or 3, writes the difficulty to $1FF6
// and the enemy count to $1FF8, and chains SD.
//
// Every "are we there yet" below is answered by comparing the screen with the picture
// files on the disk, not by guessing from the video mode.
import { openOracle } from './a2.mjs';
import { decodeHgr, toPng } from './hgr.mjs';
import { identify } from './screens.mjs';
import fs from 'fs';

const a2 = await openOracle();
fs.mkdirSync('captured/play', { recursive: true });

await a2.ev(`(async () => {
  const disk2 = window.M.a2.getIO()._slot[6];
  await disk2.setBinary(1, 'stardestroyer', 'dsk', await (await fetch('/disk.dsk')).arrayBuffer());
  window.M.a2.reset();
  const cpu = window.M.cpu, st = cpu.getState(); st.pc = 0xC600; cpu.setState(st);
  return 'booting';
})()`);

const vm = () => a2.ev(`JSON.stringify((() => {
  const v = window.M.a2.vm.getState();
  return { pc: window.M.cpu.getPC(), text: v.textMode, hires: v.hiresMode, page: v.pageMode };
})())`).then(JSON.parse);

/** The displayed page, and which disk picture it is. */
async function look() {
  const s = await vm();
  const base = s.page === 2 ? 0x4000 : 0x2000;
  const page = Uint8Array.from(await a2.readRange(base, base + 0x2000));
  return { ...s, page_: page, is: identify(page) };
}
async function shot(name, l) {
  fs.writeFileSync(`captured/play/${name}.png`, toPng(decodeHgr(l.page_)));
  const rows = (await a2.screen()).filter((r) => r.trim());
  console.log(`${name.padEnd(16)} PC $${l.pc.toString(16).toUpperCase().padStart(4, '0')}  `
    + `${l.text ? 'TEXT' : l.hires ? 'HGR' : 'LORES'}/page${l.page}  `
    + `screen: ${l.is ? l.is.name + (l.is.diff ? ` (${l.is.diff} bytes over)` : ' exactly') : 'not a disk picture'}`);
  for (const r of rows.slice(0, 3)) console.log('    | ' + r);
}

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

// --- the title -----------------------------------------------------------------------
// START's message on the text screen is what says START is running.
let sawMessage = false;
for (let i = 0; i < 60 && !sawMessage; i++) {
  await a2.waitMs(500);
  sawMessage = (await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'));
}
check('the disk boots to START', sawMessage);
await a2.waitMs(2000);
const title = await look();
await shot('01_title', title);

// --- the difficulty screen -------------------------------------------------------------
// LOGO1's window is 500 iterations of a BASIC FOR loop, which is not long, so this knocks
// rather than taps, and stops on the picture rather than on the video mode.
let select = null;
for (let i = 0; i < 60 && !select; i++) {
  await a2.key(' ');
  await a2.waitMs(500);
  const l = await look();
  if (l.is && l.is.name === 'DIFFICULTY.PIC') select = l;
}
check('a key reaches the difficulty screen', !!select, select ? '' : 'never showed DIFFICULTY.PIC');
if (select) await shot('02_select', select);

// --- into the game -----------------------------------------------------------------------
if (select) {
  // SELECT does not wait for a key: line 16 reloads the art and the music, and line 17
  // reads $C000 once, the moment that returns. No key pending and it chains DEMO instead.
  // So the press has to land inside that load, and the probe knocks until $1FF6 says the
  // choice was taken rather than sleeping a guessed interval and reading once - which is
  // what the first version did, and it read the uninitialised 0 and 255 sitting there.
  let chosen = { difficulty: 0, enemies: 0 };
  for (let i = 0; i < 40; i++) {
    await a2.key('1');
    await a2.waitMs(500);
    chosen = JSON.parse(await a2.ev(`JSON.stringify({
      difficulty: window.M.rd(0x1FF6), enemies: window.M.rd(0x1FF8) })`));
    if (chosen.difficulty >= 1 && chosen.difficulty <= 3) break;
  }
  // SELECT line 22: HARD is 1, and N = 5 + RND(1)*3, so 5 to 7 inclusive.
  check('HARD writes difficulty 1', chosen.difficulty === 1, `$1FF6 = ${chosen.difficulty}`);
  check('and an enemy count in 5-7', chosen.enemies >= 5 && chosen.enemies <= 7,
    `$1FF8 = ${chosen.enemies}`);

  let flight = null;
  for (const atMs of [5000, 10000, 15000, 25000, 40000, 60000]) {
    await a2.waitMs(atMs - (flight?.atMs ?? 0));
    const l = await look();
    l.atMs = atMs;
    await shot(`03_game_${atMs / 1000}s`, l);
    flight = l;
    // The flight is drawn, not loaded: a screen that is no disk picture and is hires.
    if (!l.is && l.hires) break;
  }
  check('the game draws a screen of its own', !!flight && !flight.is && flight.hires,
    flight?.is ? 'still showing ' + flight.is.name : 'hires, not a stored picture');
}

fs.writeFileSync('captured/play/golden.json', JSON.stringify({ results }, null, 1) + '\n');
if (a2.errors.length) console.log('page errors:', a2.errors.slice(0, 3));
await a2.close();
const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `play: all ${results.length} checks passed` : `play: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
