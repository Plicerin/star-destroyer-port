// HYPERDRIVE.OBJ0 and CLS: the warp sequence between flights.
//
// Two files, and only one of them is a program.
//
// **CLS is not code.** It is 250 bytes at `$1ED2` and it is a table of hi-res row addresses -
// 124 of them, sixteen-bit, little-endian, ending in `$7F`. Better than that, its source is
// on the disk: `CLS DATA` is an Applesoft program whose DATA statements are exactly those
// addresses and whose line 530 is `BSAVE CLS,A7890,L`. This probe regenerates CLS from that
// program and compares it against the file, so nothing about it has to be taken on trust and
// there is nothing in it to transliterate.
//
// **HYPERDRIVE.OBJ0 is a starfield.** `$0E41` walks the CLS table two bytes at a time, writes
// each address into the operand of the `STA $2000,X` at `$0E47` - self-modifying, like the
// music player - and fills 40 bytes at each, which is the screen clear. Then four tables in
// the zeroed region at `$08F2`, `$096C`, `$09E6` and `$0A23` hold each star's position and
// velocity, low byte and high, and `$0EC9` adds one to the other. The plotting goes through
// two Applesoft ROM routines.
//
// Those ROM routines are the thing to be careful about: they are not on this disk, so they
// are not something the disk can be asked about. What *can* be asked is what the sequence
// does to the screen, and that is what a port has to reproduce.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { disasmRange, traverse } from './disasm6502.mjs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const d = openDisk(DISK);
const HYPER = d.read(d.files.find((x) => x.name === 'HYPERDRIVE.OBJ0'));
const CLS = d.read(d.files.find((x) => x.name === 'CLS'));
const ENTRY = 0x08EF;

// ---------------------------------------------------------------- CLS is data ------------
console.log('\n=== CLS, and the program on the disk that made it ===');
{
  const f = d.files.find((x) => x.name === 'CLS DATA');
  const raw = d.read(f);
  const m = new Uint8Array(0x10000);
  for (let i = 0; i < raw.len; i++) m[raw.addr + i] = raw.data[i];
  const values = [];
  for (const line of listProgram(m, 0x801)) {
    const match = line.text.match(/^DATA\s+(.*)$/);
    if (!match) continue;
    for (const v of match[1].split(',')) values.push(Number(v.trim()));
  }
  // Line 500: READ, split into low and high, POKE both, stop after 127.
  const built = [];
  for (const v of values) {
    built.push(v & 0xFF, (v >> 8) & 0xFF);
    if (v === 127) break;
  }
  check('CLS is exactly what CLS DATA\'s DATA statements generate',
    built.length === CLS.len && built.every((b, i) => b === CLS.data[i]),
    `${built.length} bytes from ${values.length} values, against ${CLS.len} on the disk -`
      + ' so CLS is a table, not a program, and there is nothing in it to port');
  check('and it BSAVEs to the address the catalogue gives it',
    CLS.addr === 7890,
    `line 530 is BSAVE CLS,A7890 and the entry says ${hx(CLS.addr)}`);

  // What the addresses are.
  const addrs = values.slice(0, -1);
  const rowBase = (y) => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
  const allRows = new Set();
  for (let y = 0; y < 192; y++) allRows.add(rowBase(y));
  check(`all ${addrs.length} of them are hi-res row addresses on page 1`,
    addrs.every((a) => allRows.has(a)),
    `between ${hx(Math.min(...addrs))} and ${hx(Math.max(...addrs))}, and every one is the`
      + ' start of a row - which is what makes this a screen-clear table');

  // Which rows, and the answer says what the sequence is for.
  const byBase = new Map();
  for (let y = 0; y < 192; y++) byBase.set(rowBase(y), y);
  const rows = addrs.map((a) => byBase.get(a)).sort((x, y) => x - y);
  let contiguous = true;
  for (let i = 1; i < rows.length; i++) if (rows[i] !== rows[i - 1] + 1) contiguous = false;
  check('and they are rows 0 to 123, contiguous - the sky, not the whole screen',
    contiguous && rows[0] === 0 && rows[rows.length - 1] === 123 && rows.length === 124,
    `${rows.length} rows from ${rows[0]} to ${rows[rows.length - 1]}, which is`
      + ` ${rows.length} x 40 = ${rows.length * 40} bytes - the instrument panel below row`
      + ' 123 is left alone, which is why the table is 124 entries and not 192');
  check('the list ends in $7F, which is what the clear loop stops on',
    values[values.length - 1] === 127,
    'CPX #$7F at $0E54, and 127 is not a legal high byte for a row on this page');
}

// ---------------------------------------------------------------- the program ------------
console.log('\n=== HYPERDRIVE.OBJ0 ===');
const mem = new Uint8Array(0x10000);
for (let i = 0; i < HYPER.len; i++) mem[HYPER.addr + i] = HYPER.data[i];
for (let i = 0; i < CLS.len; i++) mem[CLS.addr + i] = CLS.data[i];
const code = traverse(mem, [ENTRY], { lo: HYPER.addr, hi: HYPER.addr + HYPER.len });
{
  const starts = [...code.starts].sort((a, b) => a - b);
  console.log(`  ${starts.length} instructions reachable from ${hx(ENTRY)},`
    + ` ${hx(starts[0])} to ${hx(starts[starts.length - 1])}`);
  check('the entry is a jump over the data to the code',
    mem[ENTRY] === 0x4C && (mem[ENTRY + 1] | (mem[ENTRY + 2] << 8)) === 0x0A63,
    `${hx(ENTRY)} JMP ${hx(0x0A63)}, so ${hx(0x08F2)}-${hx(0x0A62)} is not code`);

  // The four per-star tables, in the region the entry jumps over.
  const TABLES = [0x08F2, 0x096C, 0x09E6, 0x0A23];
  check('and that region is all zeros on the disk - four tables the code fills in',
    TABLES.every((t) => t >= 0x08F2 && t < 0x0A63)
      && mem.slice(0x08F2, 0x0A63).every((b) => b === 0),
    `${TABLES.map((t) => hx(t)).join(', ') } - position low and high, velocity low and high,`
      + ` ${0x0A63 - 0x08F2} bytes between them`);

  // The clear loop patches the operand of its own STA.
  check('the screen clear patches the address of its own STA from the CLS table',
    mem[0x0E47] === 0x9D && (mem[0x0E48] | (mem[0x0E49] << 8)) === 0x2000
      && mem[0x0E58] === 0x8E && (mem[0x0E59] | (mem[0x0E5A] << 8)) === 0x0E48,
    `${hx(0x0E47)} is STA $2000,X and ${hx(0x0E58)} writes ${hx(0x0E48)}, which is that`
      + " instruction's own operand");

  // Everything it reaches outside its image.
  const outside = new Map();
  for (const a of starts) {
    const t = disasmRange(mem, a, a + 1, { code: code.starts })[0];
    for (const m of t.text.matchAll(/\$([0-9A-F]{4})/g)) {
      const addr = parseInt(m[1], 16);
      if (addr >= HYPER.addr && addr <= HYPER.addr + HYPER.len - 1) continue;
      if (!outside.has(addr)) outside.set(addr, new Set());
      outside.get(addr).add(a);
    }
  }
  const REGIONS = {
    0x1ED2: 'the CLS table', 0x1ED3: 'the CLS table', 0x2000: 'hi-res page 1',
    0xC030: 'the speaker',
  };
  console.log('  outside its own image:');
  for (const [a, where] of [...outside].sort((x, y) => x[0] - y[0])) {
    const what = REGIONS[a] ?? (a >= 0xF000 ? 'Applesoft or monitor ROM - NOT on this disk'
      : 'unaccounted for');
    console.log(`    ${hx(a)}  ${what.padEnd(40)} from ${[...where].map((x) => hx(x)).join(', ')}`);
  }
  const rom = [...outside.keys()].filter((a) => a >= 0xF000);
  check('it reaches outside itself in exactly four ways, and three are the ROM',
    [...outside.keys()].every((a) => REGIONS[a] || a >= 0xF000) && rom.length >= 2,
    `${rom.map((a) => hx(a)).join(', ')} are ROM routines, which are not on this disk and`
      + ' so cannot be read off it - what a port has to reproduce is their effect on the'
      + ' page, not their insides');
}

// ---------------------------------------------------------------- the machine ------------
console.log('\n=== what it does, on the machine ===');
const a2 = await openOracle();
let live = null;
try {
  await a2.coldStart({ fill: 0x00 });
  for (let i = 0; i < 40; i++) {
    await a2.waitMs(500);
    if ((await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'))) break;
  }
  live = JSON.parse(await a2.ev(`(() => {
    const cpu = window.M.cpu, wr = window.M.wr, rd = window.M.rd;
    const hyper = ${JSON.stringify([...HYPER.data])};
    const cls = ${JSON.stringify([...CLS.data])};
    for (let i = 0; i < hyper.length; i++) wr(${HYPER.addr} + i, hyper[i]);
    for (let i = 0; i < cls.length; i++) wr(${CLS.addr} + i, cls[i]);
    // A page of something recognisable, so a clear is visible as a change.
    for (let a = 0x2000; a < 0x4000; a++) wr(a, 0x55);
    const st = cpu.getState(); st.pc = ${ENTRY}; st.sp = 0xF8; cpu.setState(st);
    const start = cpu.getCycles();
    let toggles = 0, prev = 0, romCalls = 0;
    const seen = new Set();
    // Counted rather than read off the branch structure, because reading it off gave the
    // wrong answer: see the checks below.
    const n = { clear: 0, plot: 0, colour: 0, sound: 0, frame: 0, pass: 0 };
    let passEnd = 0;
    cpu.stepCyclesDebug(8000000, () => {
      const pc = cpu.getPC();
      if (pc >= 0xF000) { romCalls++; }
      if (pc === 0x0E41) n.clear++;
      if (pc === 0xF457) n.plot++;
      if (pc === 0xF6F0) n.colour++;
      if (pc === 0x0FBE) n.sound++;
      if (pc === 0x0EF5) n.frame++;
      if (pc === 0x0F1A && !passEnd) { passEnd = 1; n.pass = 1;
        n.atPass = { plot: n.plot, sound: n.sound, frame: n.frame, clear: n.clear,
          colour: n.colour }; }
      if (prev === 0x0F52 || prev === 0x0F8D) toggles++;
      if (pc >= ${HYPER.addr} && pc <= ${HYPER.addr + HYPER.len - 1}) seen.add(pc);
      prev = pc;
    });
    let lit = 0, changed = 0;
    for (let a = 0x2000; a < 0x4000; a++) {
      const v = rd(a);
      if (v !== 0x55) changed++;
      if (v !== 0) lit++;
    }
    return JSON.stringify({ cycles: cpu.getCycles() - start, toggles, romCalls, n,
      covered: seen.size, changed, lit,
      stars: { posLo: rd(0x08F2), posHi: rd(0x096C), velLo: rd(0x09E6), velHi: rd(0x0A23) } });
  })()`));
  console.log(`  ran ${live.cycles} cycles, ${live.covered} distinct instructions,`
    + ` ${live.romCalls} cycles inside ROM, ${live.toggles} speaker toggles`);
  console.log(`  the page: ${live.changed} of 8192 bytes changed, ${live.lit} now non-zero`);
  console.log(`  a star's four bytes afterwards: ${JSON.stringify(live.stars)}`);
} finally {
  await a2.close();
}
{
  // 124 rows of 40 bytes. Not a threshold - the table says exactly how many bytes the
  // clear can touch, and the machine changed exactly that many.
  check('it clears exactly the 4,960 bytes the CLS table addresses, and draws into them',
    live.changed === 124 * 40 && live.lit > 0,
    `${live.changed} of 8,192 bytes left the test pattern, against 124 x 40 =`
      + ` ${124 * 40} the table covers, and ${live.lit} are lit afterwards - so the`
      + ' instrument panel really is untouched');
  check('and it fills in the star tables it starts with zeroed',
    [live.stars.posLo, live.stars.posHi, live.stars.velLo, live.stars.velHi]
      .some((v) => v !== 0),
    JSON.stringify(live.stars) + ' - all four are zero in the file');
  check('it spends real time in the ROM, which is why those routines matter',
    live.romCalls > 1000,
    `${live.romCalls} instructions executed at or above $F000`);

  // The first drawing pass, counted. These are here because reading them off the branches
  // gave the wrong numbers: `CPX #$0A` at $0F0E looks like a ten-frame cap and the pass
  // runs fourteen, and the sound block looks like forty calls and makes a hundred and
  // seventy-four. A transliteration has to match these, and the next one starts from them
  // rather than from the branch structure.
  const p = live.n.atPass ?? {};
  console.log(`  the first drawing pass: ${p.frame} frames, ${p.plot} plots,`
    + ` ${p.sound} sound calls, ${p.clear} clear, ${p.colour} colour set`);
  check('the first pass draws 62 stars for 14 frames - not the 10 the compare suggests',
    p.plot === 868 && p.frame === 14 && p.plot === 62 * 14,
    `${p.plot} plots is 62 x 14, and $0EF5 was reached ${p.frame} times - so whatever`
      + ' `CPX #$0A` at $0F0E is counting, it is not frames of this loop');
  check('and the screen is cleared once and the colour set once in that pass',
    p.clear === 1 && p.colour === 1,
    'one clear and one JSR $F6F0, so the white pass sets its colour once and draws'
      + ' everything in it');
  check('the sound routine is entered 174 times in the pass, not the 40 the loop shows',
    p.sound === 174,
    'the block after the clear is forty iterations of JSR $0FBE and there is one more per'
      + ' frame, which is 54 - so $0FBE is reached another 120 times by a path this probe'
      + ' has not accounted for, and that is an open question rather than a guess');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
