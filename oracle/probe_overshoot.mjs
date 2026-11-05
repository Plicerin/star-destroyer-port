// What a DOS 3.3 BLOAD actually writes - and the thirteen bytes it destroys.
//
// `probe_progression.mjs` established that the BASIC and the binary talk to each other
// through $1FF3-$1FFF. This probe asks a question that unit never asked: do those bytes
// survive the `BRUN` that is supposed to read them?
//
// They do not. DOS 3.3 reads a binary file's **last sector straight to the destination**,
// all 256 bytes of it, so a BLOAD writes up to 255 bytes past the end of the file - and the
// bytes it writes there are whatever happened to be left in that sector on the disk. For
// `STAR DESTROYER.OBJ0`, which ends at $1FF0, that lands exactly on the interface.
//
// The model is one line: **a BLOAD writes the file's whole sector chain at `addr - 4`**, the
// four being the load address and length that DOS strips from the front. Everything below is
// that model checked against the machine, and then against every binary on the disk.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { identify } from './screens.mjs';
import { listProgram } from './detokenise.mjs';
import { HEADER, sectorsRead, overshoot, bload } from '../port/src/game/dos.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v) => '$' + v.toString(16).toUpperCase().padStart(4, '0');

const d = openDisk(DISK);
const bin = (name) => {
  const f = d.files.find((x) => x.name === name);
  if (!f) throw new Error(`no file called ${name}`);
  return { ...d.read(f), name, sectors: f.sectors };
};
const OBJ0 = bin('STAR DESTROYER.OBJ0');

// ---------------------------------------------------------------- the disk's arithmetic ----
console.log('\n=== what the catalogue implies ===');
{
  const bads = [];
  const binaries = d.files.filter((f) => f.type === 'BINARY');
  for (const f of binaries) {
    const r = d.read(f);
    if (r.raw.length % 256 !== 0) bads.push(`${f.name}: raw is ${r.raw.length} bytes`);
    if (4 + r.len > r.raw.length) bads.push(`${f.name}: needs ${4 + r.len} of ${r.raw.length}`);
  }
  check(`all ${binaries.length} binary files are a whole number of 256-byte sectors,`
    + ' each big enough for its own header and length', bads.length === 0,
    bads.slice(0, 3).join('; ') || 'so the file on disk is always longer than the file itself,'
      + ' and the difference is slack DOS has no reason to skip');
}

// ---------------------------------------------------------------- against the machine ------
console.log('\n=== against the machine ===');
const a2 = await openOracle();
let live = null;
try {
  await a2.coldStart({ fill: 0x00 });
  let at = false;
  for (let i = 0; i < 60 && !at; i++) {
    await a2.waitMs(500);
    at = (await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'));
  }
  if (!at) throw new Error('the disk never reached START');
  for (let i = 0; i < 60; i++) {
    await a2.key(' ');
    await a2.waitMs(500);
    const id = identify(Uint8Array.from(await a2.readRange(0x2000, 0x4000)));
    if (id && id.name === 'DIFFICULTY.PIC') break;
  }
  let chosen = 0;
  for (let i = 0; i < 40 && chosen !== 1; i++) {
    await a2.key('1');
    await a2.waitMs(500);
    chosen = await a2.read(0x1FF6);
  }
  if (chosen !== 1) throw new Error('the difficulty screen never took the key');

  // Wait for SD PART2 line 10 to have rolled the waves. That is the interface at its best:
  // everything the BASIC means the binary to read, in place, just before the BRUN.
  let rolled = null;
  for (let i = 0; i < 40 && !rolled; i++) {
    await a2.waitMs(500);
    const b = await a2.readRange(0x1FF0, 0x2000);
    if (b[8] >= 5 && b[8] <= 7 && b[9] > 0 && b[10] > 0 && b[11] > 0) rolled = b;
  }
  if (!rolled) throw new Error('SD PART2 never rolled a target and three waves');
  console.log(`  (the interface just before the BRUN: ${rolled.join(' ')})`);

  // Step until the first byte of the interface moves, and ask DOS what it is doing.
  live = JSON.parse(await a2.ev(`(() => {
    const cpu = window.M.cpu, rd = (a) => cpu.read(a);
    let prev = rd(0x1FF0), prevPC = cpu.getPC(), instr = 0, hit = null;
    cpu.stepCyclesDebug(17030 * 2400, () => {
      instr++;
      const v = rd(0x1FF0);
      if (v !== prev) {
        hit = { by: prevPC, instr,
          track: rd(0xB7EC), sector: rd(0xB7ED), command: rd(0xB7F4),
          buffer: rd(0xB7F0) | (rd(0xB7F1) << 8),
          loadAddr: rd(0xAA72) | (rd(0xAA73) << 8),
          loadLen: rd(0xAA60) | (rd(0xAA61) << 8),
          name: Array.from({length: 30}, (_, i) => String.fromCharCode(rd(0xAA75 + i) & 0x7F))
            .join('').trim(),
        };
        return true;
      }
      prevPC = cpu.getPC();
    });
    if (!hit) return JSON.stringify({ hit: null });
    // The load is finished exactly when the binary starts, and not a moment later: its own
    // first act is to touch three of these bytes. Step to its entry and read them there.
    let entered = false;
    cpu.stepCyclesDebug(17030 * 600, () => {
      if (cpu.getPC() === 0x0957) { entered = true; return true; }
    });
    const after = []; for (let a = 0x1FF0; a < 0x2000; a++) after.push(rd(a));
    const below = []; for (let a = 0x08EB; a < 0x08EF; a++) below.push(rd(a));
    return JSON.stringify({ hit, after, below, entered,
      before: ${JSON.stringify(rolled)} });
  })()`));
  if (!live.hit) throw new Error('the interface was never written - nothing to measure');

  check('DOS, not the game, is what writes over the interface',
    live.hit.by >= 0xB800 && live.hit.by < 0xB900 && live.hit.command === 1
      && live.hit.name === OBJ0.name,
    `${hx(live.hit.by)} is inside RWTS, its command is ${live.hit.command} (read), and the`
      + ` filename buffer says "${live.hit.name}"`);

  check("and it is reading that file's own last sector, into a buffer four below the grid",
    live.hit.buffer === OBJ0.addr - HEADER + 256 * (sectorsRead(OBJ0.len) - 1)
      && live.hit.loadAddr === OBJ0.addr && live.hit.loadLen === OBJ0.len,
    `buffer ${hx(live.hit.buffer)} = ${hx(OBJ0.addr)} - ${HEADER}`
      + ` + 256 x ${sectorsRead(OBJ0.len) - 1}, for a file DOS knows is`
      + ` ${live.hit.loadLen} bytes at ${hx(live.hit.loadAddr)},`
      + ` from track ${live.hit.track} sector ${live.hit.sector}`);

  // The model's whole content: raw at addr - 4. Predict the sixteen bytes, from the disk.
  const image = new Uint8Array(0x10000);
  bload(image, OBJ0);
  const predicted = [...image.subarray(0x1FF0, 0x2000)];
  check('the model predicts all sixteen bytes at $1FF0-$1FFF, from the disk image alone',
    predicted.every((v, i) => v === live.after[i]),
    `predicted ${predicted.join(' ')}`
      + (predicted.every((v, i) => v === live.after[i]) ? '' : `, measured ${live.after.join(' ')}`));

  check('the load is complete when the binary starts, which is where this was read',
    live.entered === true,
    'stepped to $0957, the binary\'s entry, rather than waiting a fixed time - its own'
      + ' first writes are to three of these very bytes');

  check('nothing is written BELOW the load address: the first sector goes through a buffer',
    !live.below.every((v, i) => v === OBJ0.raw[i]),
    `${hx(OBJ0.addr - HEADER)}-${hx(OBJ0.addr - 1)} hold ${live.below.join(' ')}, not the`
      + ` file's header ${[...OBJ0.raw.slice(0, 4)].join(' ')} - DOS has to read the address`
      + ' out of the first sector before it knows where the file goes, so only the second'
      + ' sector onwards lands on the destination');

  // The control is on the overshoot itself: a loader that writes the file and nothing else.
  const exact = new Uint8Array(0x10000);
  bload(exact, OBJ0, { exact: true });
  const wrong = [...exact.subarray(0x1FF0, 0x2000)];
  check('control: a loader that writes only the file\'s own bytes predicts them wrong',
    !wrong.every((v, i) => v === live.after[i]),
    `it would leave ${wrong.slice(2, 8).join(' ')}... at $1FF2 - the slack is the whole`
      + ' finding, so a model without it has to fail here');

  check('the interface the BASIC built does not survive its own BRUN',
    live.before.slice(3).some((v, i) => v !== live.after[i + 3]),
    `before ${live.before.slice(3).join(' ')}  ->  after ${live.after.slice(3).join(' ')}`);
} finally {
  await a2.close();
}

// ---------------------------------------------------------------- what it costs ------------
console.log('\n=== what the slack holds ===');
{
  // The three wave counters and the target, before and after, as the BASIC and the binary
  // see them. This is the whole consequence in four numbers.
  const was = { target: live.before[8], waves: live.before.slice(9, 12) };
  const now = { target: live.after[8], waves: live.after.slice(9, 12) };
  check('the three wave counters the binary counts down are the slack, not the roll',
    now.waves.some((v, i) => v !== was.waves[i]) && now.waves.reduce((a, b) => a + b, 0)
      > was.waves.reduce((a, b) => a + b, 0),
    `SD PART2 rolled ${was.waves.join('/')} - ${was.waves.reduce((a, b) => a + b, 0)} enemies;`
      + ` the binary reads ${now.waves.join('/')} - ${now.waves.reduce((a, b) => a + b, 0)}`);
  check('and the target it is compared against is the slack too',
    now.target !== was.target,
    `SELECT rolled ${was.target} flights, line 175 compares against ${now.target}`);

  // The slack is text, which is what says it is leftover rather than chosen.
  const printable = live.after.filter((v) => (v & 0x7F) >= 32 && (v & 0x7F) < 127).length;
  check('the slack is leftover text, not zeros or anything chosen',
    printable >= 12,
    `${printable} of the sixteen bytes are printable: "`
      + live.after.map((v) => ((v & 0x7F) >= 32 && (v & 0x7F) < 127
        ? String.fromCharCode(v & 0x7F) : '.')).join('') + '" - a high-score line');

  // And the proof it is an accident: the same program, the same addresses, the other file.
  const BS = bin('BASE STAR.OBJ0');
  const bsImage = new Uint8Array(0x10000);
  bload(bsImage, BS);
  const bsSlack = [...bsImage.subarray(0x1FF3, 0x2000)];
  check('the finale\'s binary loads to the same addresses and its slack is all zeros',
    BS.addr === OBJ0.addr && BS.len === OBJ0.len && bsSlack.every((v) => v === 0),
    'so the same overshoot is harmless there - one file\'s slack breaks the game and the'
      + ' other\'s does not, which is what says neither was intended');
}

// ---------------------------------------------------------------- every other file ---------
console.log('\n=== every binary on the disk ===');
const CARE = [
  ['the BASIC/binary interface', 0x1FF3, 0x1FFF],
  ['A2-3D2', 0x6000, 0x80FA],
  ['the display list', 0x80FB, 0x82E5],
  ['MAIN DATA', 0x83AE, 0x89D4],
  ['HEADING DATA', 0x89CB, 0x8BD2],
  ["MATH's table", 0x9800, 0x98F2],
  ['MATH', 0x98F3, 0x9CF1],
];
const clashes = [];
{
  const lines = [];
  for (const f of d.files.filter((x) => x.type === 'BINARY')) {
    const r = d.read(f);
    const o = overshoot(r.addr, r.len);
    lines.push(`  ${f.name.padEnd(26)} ${hx(r.addr)}-${hx(r.addr + r.len - 1)}`
      + `  also ${hx(o.from)}-${hx(o.to)}  ${String(o.bytes).padStart(3)}`);
    for (const [what, lo, hi] of CARE) {
      if (o.to < lo || o.from > hi) continue;
      clashes.push({ name: f.name, what,
        from: Math.max(o.from, lo), to: Math.min(o.to, hi) });
    }
  }
  console.log(lines.join('\n'));
  check('every binary on the disk overshoots, and the amount follows from its length alone',
    d.files.filter((x) => x.type === 'BINARY')
      .every((f) => { const r = d.read(f); return overshoot(r.addr, r.len).bytes > 0; }),
    'the smallest is A2-3D2 at one byte, the largest 253');

  console.log('\n  the overshoots that land on something the game needs:');
  for (const c of clashes) {
    console.log(`    ${c.name.padEnd(26)} ${hx(c.from)}-${hx(c.to)}  ${c.what}`);
  }
  check('only four regions the game needs are ever overshot into',
    new Set(clashes.map((c) => c.what)).size === 4,
    [...new Set(clashes.map((c) => c.what))].join(', '));
}

// ---------------------------------------------------------------- the repairs --------------
console.log('\n=== the load order is load-bearing ===');
{
  // SD START line 2 loads four files. Two of them are repairs for the overshoot of a file
  // loaded just before - which says the author knew about this, and makes the one unrepaired
  // case the more telling.
  const prog = (() => {
    const f = d.files.find((x) => x.name === 'SD START');
    const raw = d.read(f);
    const mem = new Uint8Array(0x10000);
    for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
    return listProgram(mem, 0x801);
  })();
  const line2 = prog.find((l) => l.num === 2)?.text ?? '';
  const order = [...line2.matchAll(/BLOAD\s*([A-Z0-9 .$\-]+?)(?:,A[-$]?[0-9A-F]+)?"/g)]
    .map((m) => m[1].trim());
  console.log(`  SD START 2 loads, in order: ${order.join(' -> ')}`);

  const after = (a, b) => order.indexOf(a) > order.indexOf(b)
    && order.indexOf(a) >= 0 && order.indexOf(b) >= 0;
  const a23d2 = d.read(d.files.find((x) => x.name === 'A2-3D2'));
  const mainData = d.read(d.files.find((x) => x.name === 'MAIN DATA'));
  check('A2-3D2 overshoots one byte onto the display list, and SV DATA is loaded after it',
    overshoot(a23d2.addr, a23d2.len).from === 0x80FB && after('SV DATA', 'A2-3D2'),
    `${hx(overshoot(a23d2.addr, a23d2.len).from)} is the display list's first byte, and`
      + ' SV DATA starts there - so the repair is exact');
  check('MAIN DATA overshoots 213 bytes into HEADING DATA, which is loaded after it',
    overshoot(mainData.addr, mainData.len).from === 0x89D5
      && after('HEADING DATA', 'MAIN DATA'),
    'HEADING DATA covers $89CB-$8BD2, so loading it last puts back everything MAIN DATA'
      + ' ran over');
  check('but nothing is loaded after the mission binary, so its overshoot stands',
    order.indexOf('STAR DESTROYER.OBJ0') === -1,
    'the BRUN is the last thing SD PART2 does before the binary takes over - there is no'
      + ' line after it to put the interface back');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
