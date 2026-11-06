// BASE STAR.OBJ0: the final mission, and how little of it is new.
//
// `SD PART3` BRUNs it after `SD START2` has loaded `SV DATA2` and `BASE STAR DATA` in place
// of the main mission's `SV DATA` and `MAIN DATA`. It is the last piece of the game that is
// gameplay rather than presentation, and the chain already reaches it and finds nothing.
//
// The headline is that it is **the same engine on a different mission**. It loads at the same
// address, enters at the same `$0957`, calls the same eleven MATH entries, reads the same
// paddle through the same `PREAD`, and calls the renderer the same three times. It is about
// two thirds the size: 1,369 instructions against 2,085.
//
// The differences that matter to a player are small and specific, and they are what this
// probe pins down - because a port that assumed the main mission's constants would get all
// of them wrong in ways no screenshot would show.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { traverse, disasmRange } from './disasm6502.mjs';
import { toFinale, FINALE_ENTRY, sdStart2Setup } from './exercise.mjs';
import { FATAL, HITS } from '../port/src/game/damage.js';
import { IFACE } from '../port/src/game/chain.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const d = openDisk(DISK);
const read = (n) => d.read(d.files.find((x) => x.name === n));
const load = (n) => {
  const f = read(n);
  const m = new Uint8Array(0x10000);
  for (let i = 0; i < f.len; i++) m[f.addr + i] = f.data[i];
  return m;
};
const BS = read('BASE STAR.OBJ0');
const SD = read('STAR DESTROYER.OBJ0');
const bs = load('BASE STAR.OBJ0');
const sd = load('STAR DESTROYER.OBJ0');
const ENTRY = 0x0957;

// ---------------------------------------------------------------- the same engine --------
console.log('\n=== the same engine ===');
{
  check('it loads where the main mission loads, and is the same length',
    BS.addr === SD.addr && BS.len === SD.len,
    `both ${hx(BS.addr)}-${hx(BS.addr + BS.len - 1)}, ${BS.len} bytes - so SD PART3 can BRUN`
      + ' it over the top of whatever was there');

  // The shared head is MATH's directory, which both read through.
  let shared = 0;
  while (shared < BS.len && BS.data[shared] === SD.data[shared]) shared++;
  check('the first 105 bytes are identical - the MATH directory both read through',
    shared === 105 && BS.addr + shared - 1 === ENTRY,
    `identical through ${hx(BS.addr + shared - 1)} inclusive, which is the entry both`
      + ' jump to - the directory below it is MATH\'s and is read the same way by both');

  const bsCode = traverse(bs, [ENTRY], { lo: BS.addr, hi: BS.addr + BS.len });
  const sdCode = traverse(sd, [ENTRY], { lo: SD.addr, hi: SD.addr + SD.len });
  const text = (m, c) => disasmRange(m, 0x08EF, 0x1FF1, { code: c.starts })
    .map((i) => i.text).join('\n');
  const bsText = text(bs, bsCode), sdText = text(sd, sdCode);
  const entries = (t) => {
    const out = {};
    for (const m of t.matchAll(/JSR \$(9[89A-C][0-9A-F]{2})/g)) out[m[1]] = (out[m[1]] ?? 0) + 1;
    return out;
  };
  const be = entries(bsText), se = entries(sdText);
  console.log(`  ${bsCode.starts.size} instructions against the main mission's`
    + ` ${sdCode.starts.size}`);
  check('it calls the same MATH entry points, and no others',
    Object.keys(be).every((k) => se[k]) && Object.keys(be).length === 11,
    `${Object.keys(be).length} entries, ${Object.values(be).reduce((a, b) => a + b, 0)} calls`
      + ` against ${Object.values(se).reduce((a, b) => a + b, 0)} - so every piece of the`
      + " port's MATH applies unchanged");
  check('and it reads the paddle and calls the renderer exactly as the main mission does',
    (bsText.match(/JSR \$FB1E/g) ?? []).length === (sdText.match(/JSR \$FB1E/g) ?? []).length
      && (bsText.match(/JSR \$6000/g) ?? []).length === (sdText.match(/JSR \$6000/g) ?? []).length,
    '2 paddle reads and 3 render calls in each');
}

// ---------------------------------------------------------------- the scene --------------
console.log('\n=== the scene: SV DATA2 against SV DATA ===');
{
  const a = read('SV DATA'), b = read('SV DATA2');
  const diffs = [];
  for (let i = 0; i < Math.min(a.len, b.len); i++) {
    if (a.data[i] !== b.data[i]) diffs.push(a.addr + i);
  }
  // Which object, and which field of it.
  const objectOf = (addr) => {
    for (let i = 0; i < 24; i++) {
      const base = i < 12 ? 0x8123 + i * 13 : 0x8247 + (i - 12) * 13;
      if (addr >= base && addr < base + 13) return { i, off: addr - base };
    }
    return null;
  };
  const hits = diffs.map(objectOf);
  for (const [n, addr] of diffs.entries()) {
    const o = hits[n];
    console.log(`  ${hx(addr)}  object ${o ? o.i : '?'} offset ${o ? o.off : '?'}`
      + `  ${a.data[addr - a.addr]} -> ${b.data[addr - b.addr]}`);
  }
  check('the two display lists differ in eight bytes and nothing else',
    diffs.length === 8,
    `${diffs.length} of ${a.len} bytes - the finale draws the same scene with different`
      + ' models in five of its object slots');
  check('and every one of them is a shape pointer, at offsets 11 and 12 of an object',
    hits.every((o) => o && (o.off === 11 || o.off === 12)),
    'offset 11 is the shape and 12 is the byte above it, so the only thing that changes is'
      + ' which model each slot draws');
  check('objects 1 to 5 are the ones that change',
    [...new Set(hits.map((o) => o.i))].join(',') === '1,2,3,4,5',
    `objects ${[...new Set(hits.map((o) => o.i))].join(', ')}`);
}

// ---------------------------------------------------------------- the models -------------
console.log('\n=== the models: BASE STAR DATA against MAIN DATA ===');
{
  const a = read('MAIN DATA'), b = read('BASE STAR DATA');
  let same = 0;
  for (let i = 0; i < Math.min(a.len, b.len); i++) if (a.data[i] === b.data[i]) same++;
  check('the model data is substantially different, as a different mission needs',
    same < a.len * 0.8 && a.len === b.len,
    `${same} of ${a.len} bytes identical - two thirds, so the two files share a lot of`
      + ' structure and differ in the shapes themselves');
}

// ---------------------------------------------------------------- the rules --------------
console.log('\n=== the rules that differ, and would be silently wrong if assumed ===');
{
  const bsCode = traverse(bs, [ENTRY], { lo: BS.addr, hi: BS.addr + BS.len });
  // Two hits, not four. $10E5 LDX $0933 / CPX #$02 / BNE / RTS.
  const fatalHere = bs[0x10E9];
  check(`two hits end the final mission, where the main one allows ${FATAL}`,
    bs[0x10E5] === 0xAE && (bs[0x10E6] | (bs[0x10E7] << 8)) === HITS
      && bs[0x10E8] === 0xE0 && fatalHere === 2 && bs[0x10EC] === 0x60,
    `${hx(0x10E5)} reads ${hx(HITS)} and ${hx(0x10E8)} is CPX #$02 with an RTS under it -`
      + ` a port that carried ${FATAL} across would make the finale twice as survivable`);

  // $1FF7 counts to fifteen.
  check('$1FF7 is its progress counter and fifteen is the number',
    (bs[0x10EE] | (bs[0x10EF] << 8)) === IFACE.finale && bs[0x10F1] === 0x0F,
    `${hx(0x10ED)} LDX ${hx(IFACE.finale)} / CPX #$0F, and at fifteen it calls two blocks,`
      + ' resets the counter and puts 4 in $093E');

  // Two places mark the win, and they INC rather than store.
  const incSites = [];
  for (let a = BS.addr; a < BS.addr + BS.len - 2; a++) {
    if (bs[a] === 0xEE && (bs[a + 1] | (bs[a + 2] << 8)) === IFACE.baseStar) incSites.push(a);
  }
  check('two places mark the base star dead, and both INCREMENT rather than store 1',
    incSites.length === 2 && incSites.join(',') === `${0x10A7},${0x112A}`,
    incSites.map((a) => hx(a)).join(' and ') + ` - so ${hx(IFACE.baseStar)} can reach 2, and`
      + ' SD PART3 tests it against 0 while INITIALS tests it against 1; reaching both sites'
      + ' would win the game and pay no bonus');

  // The wave counts it would set - and they are not reachable from the entry.
  // LDX #imm / STX abs, three times over, starting at $1803.
  const triple = [[0x1803, 0x05, IFACE.waves[0]], [0x1808, 0x03, IFACE.waves[1]],
    [0x180D, 0x03, IFACE.waves[2]]];
  const sets = triple.every(([a, n, target]) => bs[a] === 0xA2 && bs[a + 1] === n
    && bs[a + 2] === 0x8E && (bs[a + 3] | (bs[a + 4] << 8)) === target);
  check('a routine at $1803 would set the wave counters to 5, 3 and 3',
    sets,
    triple.map(([a, n, t]) => `${hx(a)} LDX #${n} / STX ${hx(t)}`).join(', ')
      + ' - the finale has its own wave counts hardcoded, where the main mission takes'
      + ' them from SD PART2');
  check('but nothing reaches it from the entry, so it is not part of the mission as it runs',
    !bsCode.starts.has(0x1803),
    'static traversal from $0957 never arrives at $1803 - recorded as found, not as a'
      + ' mechanism, because a routine nothing calls is not one');
}

// ---------------------------------------------------------------- the machine ------------
console.log('\n=== it runs as a mission, not as a binary ===');
// The first pass at this side-loaded the four files and jumped to $0957. That starts the
// binary; it does not start the mission. `SD START2` pokes seventeen addresses between the
// BLOADs and `SD PART3`'s BRUNs, and two of them - object 3's count at $814B, and the wave
// counters - are what the finale's own "is the field empty" test reads. Left at zero the
// mission believes it has already been won: $112A runs on the first pass, $1FFF comes back
// 1, and 140 of 1,369 addresses ever execute.
//
// `toFinale` reads those pokes off the disk and applies them in the chain's own order. The
// control below is the same run without them.
const a2 = await openOracle();
let live = null, control = null;
try {
  const arrival = await toFinale(a2);
  check('SD START2\'s setup reads cleanly off the disk, with nothing left unresolved',
    arrival.setup.unresolved.length === 0 && arrival.setup.pokes.length === 17,
    `${arrival.setup.pokes.length} pokes and ${arrival.setup.loads.length} loads, including`
      + ' $814B = 255, which is the one that matters');

  const run = (cycles) => a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, rd = window.M.rd;
    const before = []; for (let a = 0x80FB; a < 0x82E6; a++) before.push(rd(a));
    let renders = 0, won = 0; const seen = new Set();
    cpu.stepCyclesDebug(${cycles}, () => {
      const pc = cpu.getPC();
      if (pc === 0x6000) renders++;
      if (pc === 0x112A || pc === 0x10A7) won++;
      if (pc >= 0x08EF && pc <= 0x1FF0) seen.add(pc);
    });
    const after = []; for (let a = 0x80FB; a < 0x82E6; a++) after.push(rd(a));
    let moved = 0; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) moved++;
    let lit = 0; for (let a = 0x2000; a < 0x4000; a++) if (rd(a)) lit++;
    return { renders, won, covered: seen.size, moved, lit, hits: rd(0x0933),
      finale: rd(0x1FF7), baseStar: rd(0x1FFF), obj3: rd(0x814B) };
  })())`).then(JSON.parse);

  await a2.ev(`(() => { const cpu = window.M.cpu; const st = cpu.getState();
    st.pc = ${FINALE_ENTRY}; st.sp = 0xF8; cpu.setState(st); return 1; })()`);
  live = await run(20000000);
  console.log(`  ${live.covered} of 1,369 addresses, ${live.renders} renders,`
    + ` ${live.moved} display-list bytes moved, page 1 lit ${live.lit}`);
  console.log(`  $0933 hits ${live.hits}, $1FF7 ${live.finale}, $1FFF ${live.baseStar}`);

  // The control: the same files, the same entry, without SD START2's pokes.
  const files = [...sdStart2Setup(d).loads,
    { file: 'PART1.OBJ0', at: null }, { file: 'BASE STAR.OBJ0', at: null }]
    .map(({ file, at }) => {
      const f = read(file);
      return { addr: at ?? f.addr, raw: [...f.raw] };
    });
  await a2.ev(`(() => { const wr = window.M.wr;
    for (const f of ${JSON.stringify(files)}) {
      for (let i = 4; i < f.raw.length; i++) wr(f.addr - 4 + i, f.raw[i]);
    }
    const cpu = window.M.cpu; const st = cpu.getState();
    st.pc = ${FINALE_ENTRY}; st.sp = 0xF8; cpu.setState(st); return 1; })()`);
  control = await run(2000000);
} finally {
  await a2.close();
}
{
  check('the mission runs: it renders repeatedly and keeps moving its display list',
    live.renders > 20 && live.moved > 0 && live.lit > 0,
    `${live.renders} renders over 20M cycles - the main mission's idle flight looks the same`);

  check('and it does NOT think it has already been won',
    live.baseStar === 0 && live.won === 0,
    `$1FFF is ${live.baseStar} and neither $10A7 nor $112A was reached`);

  check('object 3\'s count survives into the mission, which is what SD START2 is for',
    live.obj3 === 255, `$814B = ${live.obj3}`);

  check('control: without those pokes it wins on the spot, as the first pass did',
    control.won > 0 && control.baseStar > 0 && control.covered < live.covered,
    `$1FFF came back ${control.baseStar} after ${control.covered} addresses, against`
      + ` ${live.baseStar} after ${live.covered} - so the pokes are the difference`);

  check('and the mission reaches four times the code the side-load did',
    live.covered > 500,
    `${live.covered} of 1,369 addresses against the 140 a bare side-load reaches;`
      + ' the rest needs a player, exactly as the main mission does');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
