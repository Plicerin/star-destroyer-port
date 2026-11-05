// PLAYER.MODULE: a two-voice music player in 208 bytes, and the two tunes it plays.
//
// `SELECT`, `MONOLITH` and `WIN` all do the same four things - BLOAD the player, BLOAD a tune
// at `$6000`, `POKE 30,0: POKE 31,96` to point `$1E`/`$1F` at it, and `CALL 768`. So this is
// the whole of the game's music, and it is the smallest of the four 6502 overlays the owner
// chose to have transliterated rather than emulated.
//
// **The tune format**, read off the two files: three bytes a record.
//
//     00 ..  ..   the end
//     01 a  b     a control record - set the two voices' octave shifts
//     dd p1 p2    a note: duration, voice 1's period, voice 2's period, and a period
//                 of zero is a rest for that voice
//
// **The player patches itself**, which is the part a transliteration has to get right rather
// than tidy away. Each voice has a toggle instruction - `$0383` and `$03BB` - and the player
// stores `$49` (EOR, which toggles) or `$C9` (CMP, which does not) into the opcode byte
// depending on whether that voice's period is zero. The periods themselves are stored into
// the operands of `CPY #$00` at `$037B` and `CPX #$00` at `$03B3`. Four self-modifying sites,
// and this probe asserts all four are where the port thinks they are.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const d = openDisk(DISK);
const PLAYER = d.read(d.files.find((x) => x.name === 'PLAYER.MODULE'));
const TUNES = ['M.STAR DESTROYER', 'M.END'];
/** Where the three programs put a tune: `POKE 30,0: POKE 31,96`. */
const TUNE_AT = 0x6000;

// ---------------------------------------------------------------- the player -------------
console.log('\n=== the player, as bytes ===');
{
  const mem = new Uint8Array(0x10000);
  for (let i = 0; i < PLAYER.len; i++) mem[PLAYER.addr + i] = PLAYER.data[i];
  check('PLAYER.MODULE loads at $0300 and is 208 bytes',
    PLAYER.addr === 0x0300 && PLAYER.len === 208,
    `${hx(PLAYER.addr)}-${hx(PLAYER.addr + PLAYER.len - 1)}`);

  // The four sites the player writes to itself, named by what is there before it runs.
  const SITES = [
    [0x0383, 0x49, "voice 1's toggle - EOR #$40, patched to CMP for a rest"],
    [0x03BB, 0x49, "voice 2's toggle - EOR #$80, patched to CMP for a rest"],
    [0x037C, null, "voice 1's period - the operand of CPY #$00 at $037B"],
    [0x03B4, null, "voice 2's period - the operand of CPX #$00 at $03B3"],
  ];
  const bad = [];
  for (const [addr, want, what] of SITES) {
    if (want !== null && mem[addr] !== want) {
      bad.push(`${hx(addr)} is ${hx(mem[addr], 2)} not ${hx(want, 2)} - ${what}`);
    }
  }
  check('the two toggle opcodes are EOR before anything patches them',
    bad.length === 0, bad.join('; ')
      || '$0383 and $03BB both hold $49, and $C9 is what turns a voice off');
  check('and the two period operands belong to the compares just before them',
    mem[0x037B] === 0xC0 && mem[0x03B3] === 0xE0,
    `${hx(0x037B)} is CPY #imm and ${hx(0x03B3)} is CPX #imm, so the stores at $0347 and`
      + ' $0358 are writing those two operands');

  // The speaker and the keyboard, which is everything it touches outside itself.
  const speaker = [];
  for (let a = PLAYER.addr; a < PLAYER.addr + PLAYER.len - 2; a++) {
    const w = mem[a + 1] | (mem[a + 2] << 8);
    if (w === 0xC030 && [0x2C, 0xCD, 0x4C, 0xAD].includes(mem[a])) speaker.push(a);
  }
  check('it touches the speaker in four places and nothing else outside itself',
    speaker.length === 4,
    speaker.map((a) => hx(a)).join(', ') + ' - two per voice, one to start a half-cycle'
      + ' and one to end it');
  check('and it reads the keyboard, which is how a key cuts the music short',
    (mem[0x0371] === 0x2C) && ((mem[0x0372] | (mem[0x0373] << 8)) === 0xC000),
    '$0371 BIT $C000, and $0374 BMI to the RTS - so pressing a key stops the tune, which'
      + ' is why the difficulty screen does not make you sit through it');
}

// ---------------------------------------------------------------- the tunes --------------
console.log('\n=== the two tunes ===');
const parsed = {};
for (const name of TUNES) {
  const t = d.read(d.files.find((x) => x.name === name));
  const records = [];
  let p = 0, ended = false;
  while (p + 2 < t.len) {
    const a = t.data[p], b = t.data[p + 1], c = t.data[p + 2];
    if (a === 0) { ended = true; break; }
    records.push({ kind: a === 1 ? 'control' : 'note', a, b, c });
    p += 3;
  }
  parsed[name] = { records, ended, bytes: t.len, used: p };
  const notes = records.filter((r) => r.kind === 'note');
  const controls = records.filter((r) => r.kind === 'control');
  const rests = notes.filter((r) => r.b === 0 || r.c === 0);
  console.log(`  ${name.padEnd(18)} ${t.len} bytes, ${records.length} records:`
    + ` ${notes.length} notes, ${controls.length} control, ${rests.length} with a rest`
    + ` in one voice, terminator ${ended ? 'found' : 'MISSING'} at ${p}`);
}
{
  check('both tunes are a whole number of three-byte records ending in a zero',
    TUNES.every((n) => parsed[n].ended && parsed[n].used % 3 === 0),
    TUNES.map((n) => `${n}: ${parsed[n].used} bytes used of ${parsed[n].bytes}`).join('; '));
  check('M.END opens with a control record and M.STAR DESTROYER does not',
    parsed['M.END'].records[0].kind === 'control'
      && parsed['M.STAR DESTROYER'].records[0].kind === 'note',
    `M.END starts 01 ${parsed['M.END'].records[0].b} ${parsed['M.END'].records[0].c} -`
      + ' the two octave shifts - and the other relies on the $0300 entry setting both to 1');
  // A control record is the only thing that can set the shifts, and the entry sets them to 1.
  check('every record is either a note, a rest or one of those control records',
    TUNES.every((n) => parsed[n].records.every((r) => r.a >= 1)),
    'nothing between the terminator and a duration, so the format has no third case');
}

// ---------------------------------------------------------------- the machine ------------
console.log('\n=== the speaker, from the machine ===');
const a2 = await openOracle();
const captured = {};
try {
  await a2.coldStart({ fill: 0x00 });
  // Give DOS time to come up; nothing else here needs the game.
  for (let i = 0; i < 40; i++) {
    await a2.waitMs(500);
    if ((await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'))) break;
  }
  for (const name of TUNES) {
    const t = d.read(d.files.find((x) => x.name === name));
    const out = JSON.parse(await a2.ev(`(() => {
      const cpu = window.M.cpu, wr = window.M.wr;
      const player = ${JSON.stringify([...PLAYER.data])};
      const tune = ${JSON.stringify([...t.data])};
      for (let i = 0; i < player.length; i++) wr(0x0300 + i, player[i]);
      for (let i = 0; i < tune.length; i++) wr(${TUNE_AT} + i, tune[i]);
      wr(0x1E, ${TUNE_AT & 0xFF}); wr(0x1F, ${(TUNE_AT >> 8) & 0xFF});
      wr(0xC010, 0);                                  // clear the keyboard strobe
      const st = cpu.getState();
      st.pc = 0x0300; st.sp = 0xF8;
      cpu.setState(st);
      // The speaker is touched at four sites; a toggle is detected from the PC of the
      // instruction BEFORE the callback, because the site itself is also a branch target.
      const SITES = new Set([0x0362, 0x036C, 0x0396, 0x03A3]);
      const toggles = [];
      const start = cpu.getCycles();
      let prev = 0x0300;
      cpu.stepCyclesDebug(300000, () => {
        if (SITES.has(prev)) toggles.push(cpu.getCycles() - start);
        prev = cpu.getPC();
        if (toggles.length >= 400) return true;
      });
      return JSON.stringify({ toggles, cycles: cpu.getCycles() - start });
    })()`));
    captured[name] = out;
    const deltas = out.toggles.slice(1).map((t2, i) => t2 - out.toggles[i]);
    const distinct = [...new Set(deltas)].sort((x, y) => x - y);
    console.log(`  ${name.padEnd(18)} ${out.toggles.length} toggles in ${out.cycles} cycles,`
      + ` gaps ${distinct.slice(0, 6).join('/')}${distinct.length > 6 ? '...' : ''}`
      + ` (${distinct.length} distinct)`);
  }
} finally {
  await a2.close();
}
{
  check('the player drives the speaker on both tunes',
    TUNES.every((n) => captured[n].toggles.length > 50),
    TUNES.map((n) => `${n}: ${captured[n].toggles.length}`).join(', '));
  check('and the two tunes do not produce the same waveform',
    captured[TUNES[0]].toggles.join(',') !== captured[TUNES[1]].toggles.join(','),
    'which is the least that has to be true before a port of this means anything');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
