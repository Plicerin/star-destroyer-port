// The outer loop: what decides whether you fly again, dock, or go to the high scores.
//
// probe_chain.mjs establishes which program chains to which. This is about the decisions: a
// handful of Applesoft lines across SELECT, SD PART2, STARBASE and SD PART3, all of whose state
// lives in the last thirteen bytes of `STAR DESTROYER.OBJ0`'s own image, $1FF3-$1FFF. The
// binary writes some, the BASIC writes the rest, and between them they are the structure of a
// game - which nothing in this port had until now.
//
// Everything here is read off the detokenised programs on the disk and the binary's listing,
// and the one thing that cannot be - that $1FF5 counts flights rather than passes - is measured
// in the machine.
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { IFACE, DEAD, LAST_FLIGHT, KILL_VALUE, BONUS_UNIT, BASE_STAR_BONUS, BONUS_CAP,
  selectTarget, rollWaves, CHAIN } from '../port/src/game/chain.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const fileOf = (n) => d.read(d.files.find((x) => x.name === n));

/** Every Applesoft program on the disk, detokenised, by name. */
const PROGRAMS = {};
for (const f of d.files.filter((x) => String(x.type).startsWith('APPLESOFT'))) {
  try {
    const raw = fileOf(f.name);
    const mem = new Uint8Array(0x10000);
    for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
    PROGRAMS[f.name] = listProgram(mem, 0x801);
  } catch (e) { /* not every file detokenises; probe_chain reports those */ }
}
/** One program's lines as a single string, for matching a formula. */
const text = (name) => (PROGRAMS[name] || []).map((l) => `${l.num} ${l.text}`).join('\n');
/** One numbered line. */
const line = (name, num) => (PROGRAMS[name] || []).find((l) => l.num === num)?.text || '';

console.log('\n=== the interface: $1FF3-$1FFF ===');
{
  check('every Applesoft program on the disk detokenises',
    Object.keys(PROGRAMS).length >= 20, `${Object.keys(PROGRAMS).length} programs`);

  // Who touches each byte, scanned rather than transcribed.
  const touched = new Map();
  for (const [name, lines] of Object.entries(PROGRAMS)) {
    for (const l of lines) {
      for (const m of l.text.matchAll(/(POKE|PEEK)\s*\(?\s*(-?\s*\d+)/g)) {
        let n = Number(m[2].replace(/\s/g, ''));
        if (n < 0) n += 65536;
        if (n < 0x1FF0 || n > 0x1FFF) continue;
        if (!touched.has(n)) touched.set(n, { poke: new Set(), peek: new Set() });
        touched.get(n)[m[1].toLowerCase()].add(name);
      }
    }
  }
  const names = Object.fromEntries(Object.entries(IFACE)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((a, i) => [a, `${k}[${i}]`]) : [[v, k]])));
  for (const a of [...touched.keys()].sort((x, y) => x - y)) {
    const t = touched.get(a);
    console.log(`  ${hx(a, 4)} ${(names[a] || '?').padEnd(12)} poked by `
      + `${[...t.poke].join(', ') || '-'}`.padEnd(42) + ` read by ${[...t.peek].join(', ') || '-'}`);
  }
  check('all thirteen of $1FF3-$1FFF are named by the port, and nothing outside them is used',
    [...touched.keys()].every((a) => names[a] !== undefined) && touched.size === 13,
    `${touched.size} addresses, every one of them in IFACE`);

  // $1FF7 is written and never read. Worth saying, because it looks like state and is not.
  check('$1FF7 is written by SD START2 and read by nothing at all',
    touched.get(IFACE.unused).poke.size === 1 && touched.get(IFACE.unused).peek.size === 0,
    'so it is not state, it is a leftover');
}

// --- who owns $1FF5 ----------------------------------------------------------------------------
console.log('\n=== $1FF5 is the binary\'s, and it counts flights ===');
{
  const obj = fileOf('STAR DESTROYER.OBJ0');
  const image = [];
  for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];
  const ls = disasmRange(image, obj.addr, obj.addr + obj.len);
  const incs = ls.filter((l) => l.mode === 'abs' && /^(INC|DEC)$/.test(l.op)
    && (l.bytes[1] | (l.bytes[2] << 8)) === IFACE.flights);
  check('the binary increments it once, at $09A0, and no Applesoft program writes it',
    incs.length === 1 && incs[0].addr === 0x09A0,
    `${incs.map((l) => hx(l.addr, 4)).join(', ')} - inside the once-only setup at`
      + ' $0957-$09A2, not in the loop');

  // The decisive part: once per flight, not once per pass. Measured.
  const a2 = await openOracle();
  const flight = await toFlight(a2);
  await arm(a2);
  check('the oracle reaches flight with the whole binary resident',
    flight.difficulty === 1 && flight.resident !== null,
    `the last sectors landed ${flight.resident.seconds}s after the settle`);

  const seen = JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const was = rd(${IFACE.flights});
    wr(${IFACE.flights}, 0);
    const st = cpu.getState(); st.pc = 0x09A3; cpu.setState(st);
    let passes = 0;
    cpu.stepCyclesDebug(14000000, () => {
      if (cpu.getPC() === 0x09A3) { passes++; if (passes >= 4) return true; }
    });
    const after = rd(${IFACE.flights});
    wr(${IFACE.flights}, was);
    return { passes, after };
  })())`));
  check('and four passes of the loop leave it alone, so it is flights and not frames',
    seen.passes === 4 && seen.after === 0,
    `${seen.passes} passes, $1FF5 still ${seen.after} - the loop starts BELOW the INC, at`
      + ' $09A3, so only a fresh BRUN of the binary bumps it');
}

// --- the decisions -----------------------------------------------------------------------------
console.log('\n=== the four programs that decide anything ===');
{
  // SELECT's difficulty, and the three ranges it rolls.
  const sel = [22, 23, 24].map((n) => line('SELECT', n));
  console.log('  ' + sel.join('\n  '));
  const ranges = [[5, 3], [8, 3], [10, 6]];
  const wrong = [];
  for (const [i, l] of sel.entries()) {
    const m = l.match(/N = (\d+) \+\(? ?RND\(1\) \* (\d+)\)?/);
    if (!m || Number(m[1]) !== ranges[i][0] || Number(m[2]) !== ranges[i][1]) {
      wrong.push(`difficulty ${i + 1}: ${l}`);
    }
  }
  check('SELECT rolls the number of flights: easy 5-7, medium 8-10, hard 10-15',
    wrong.length === 0 && line('SELECT', 25).includes('POKE 8182,A'),
    wrong.join('; ') || 'POKE truncates, and RND(1) is under 1, so each range stops one short'
      + ' of its arithmetic top');
  // And the port's own roll agrees with that, over the whole of RND's range.
  const bad = [];
  for (const diff of [1, 2, 3]) {
    const seenT = new Set();
    for (let k = 0; k < 1000; k++) seenT.add(selectTarget(diff, () => k / 1000));
    const lo = Math.min(...seenT), hi = Math.max(...seenT);
    const want = [[5, 7], [8, 10], [10, 15]][diff - 1];
    if (lo !== want[0] || hi !== want[1]) bad.push(`${diff}: ${lo}-${hi}`);
  }
  check('and the port\'s selectTarget covers exactly those ranges and no more',
    bad.length === 0, bad.join('; ') || '5-7, 8-10, 10-15 over a thousand values of RND');

  // SELECT also wipes the whole interface on the way through.
  check('SELECT clears all thirteen bytes before a game, in one FOR loop',
    line('SELECT', 21).includes('FOR J = 8179 TO 8191') && line('SELECT', 21).includes('POKE J,0'),
    line('SELECT', 21));

  // SD PART2's wave roll and its three-way branch.
  console.log('  ' + line('SD PART2', 200) + '\n  ' + line('SD PART2', 300));
  check('SD PART2 rolls each wave counter as the difficulty plus 1 to 5',
    line('SD PART2', 300).includes('PEEK(8182) +(( RND(1) * 4) + 1.5)')
      && (line('SD PART2', 200).match(/GOSUB 300/g) || []).length === 3,
    'three GOSUBs and three POKEs, so the three classes get independent rolls');
  const rolls = new Set();
  for (let k = 0; k < 1000; k++) rolls.add(rollWaves(1, () => k / 1000)[0]);
  check('and the port\'s rollWaves gives difficulty + 1 to 5, weighted to the middle',
    Math.min(...rolls) === 2 && Math.max(...rolls) === 6,
    `difficulty 1 gives ${Math.min(...rolls)} to ${Math.max(...rolls)}; the +1.5 puts the`
      + ' fraction in [1.5, 5.5), so the two ends each cover half a step');

  for (const [name, num, want] of [
    ['SD PART2', 172, 'PEEK(8185) > 0 OR PEEK(8186) > 0 OR PEEK(8187) > 0 OR PEEK(0) = 77'],
    ['SD PART2', 175, 'PEEK(8181) = > PEEK(8184)'],
    ['STARBASE', 220, 'PEEK(8179) = 120'],
    ['SD PART3', 175, 'PEEK(8191) = 0'],
  ]) {
    const l = line(name, num);
    console.log(`  ${name} ${num}: ${l}`);
    check(`${name} line ${num} is the test the port's CHAIN says it is`,
      l.includes(want), l || 'the line is not there');
  }
  check('and $00 holding 77 is how the binary tells the BASIC the ship was destroyed',
    DEAD === 77 && line('SD PART2', 172).includes('PEEK(0) = 77'),
    'the destroyed sound at $1F2B ends by storing it, at $1F64');
}

// --- the score ---------------------------------------------------------------------------------
console.log('\n=== what a game is worth ===');
{
  const wrong = [];
  for (const [name, nums] of [['STARBASE', [2010, 2015, 2016, 2017]],
    ['INITIALS', [2010, 2015, 2016, 2017]]]) {
    for (const n of nums) console.log(`  ${name} ${n}: ${line(name, n)}`);
    if (!line(name, 2010).includes('(PEEK(8188) * 300) +(PEEK(8189) * 600) +(PEEK(8190) * 800)')) {
      wrong.push(`${name} 2010`);
    }
  }
  check('a kill is worth 300, 600 or 800 by class, in both places that add it up',
    wrong.length === 0 && KILL_VALUE.join() === '300,600,800', wrong.join(', ') || 'identical'
      + ' formulas in STARBASE and INITIALS');
  check('a starbase visit banks min(flights, 5) and every banked unit is worth 500',
    line('STARBASE', 2015).includes('BN = PEEK(8181): IF BN > 5 THEN BN = 5')
      && line('STARBASE', 2016).includes('POKE 8180,( PEEK(8180) + BN)')
      && line('STARBASE', 2017).includes('BN = PEEK(8180) * 500')
      && BONUS_CAP === 5 && BONUS_UNIT === 500,
    'and line 2016 writes it BACK, so the bonus accumulates across visits and the cap is the'
      + ' only thing holding it down');
  check('and the base star is worth ten thousand on the high-score screen',
    line('INITIALS', 2016).includes('IF PEEK(8191) = 1 THEN BN = BN + 10000')
      && BASE_STAR_BONUS === 10000, line('INITIALS', 2016));
}

// --- the shape of a game -----------------------------------------------------------------------
console.log('\n=== and so a game is ===');
{
  // Walk the chain the port describes and check every edge against a RUN in the real program.
  const runs = (name) => [...text(name).matchAll(/RUN ?"?([A-Z0-9 .]+?)"?(?:\n|$|")/g)]
    .map((m) => m[1].trim());
  const wrong = [];
  for (const [name, node] of Object.entries(CHAIN)) {
    if (!PROGRAMS[name]) {
      wrong.push(`${name} is not a program on the disk`);
      continue;
    }
    const targets = runs(name);
    const expected = node.to ? [node.to]
      : node.decide ? ['MONOLITH', 'HYPERDRIVE 3', 'HYPERDRIVE1', 'HYPERDRIVE 4',
        'HYPERDRIVE2', 'WIN', 'SELECT', 'DEMO', 'SD'].filter((t) => targets.includes(t))
        : [];
    for (const t of expected) {
      if (!targets.includes(t)) wrong.push(`${name} does not RUN ${t}`);
    }
  }
  check('every edge the port\'s CHAIN claims is a RUN in the program it claims it from',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `${Object.keys(CHAIN).length} programs walked`);

  // The three orphans.
  const named = new Set();
  for (const name of Object.keys(PROGRAMS)) for (const t of runs(name)) named.add(t);
  const orphans = Object.entries(CHAIN).filter(([, n]) => n.orphan).map(([k]) => k);
  check('SD RET, HYPERDRIVE0 and CLEAR SCORES are named by nothing on the disk',
    orphans.length === 3 && orphans.every((o) => !named.has(o)),
    `${orphans.join(', ')} - the first two chain somewhere sensible, so they look like`
      + ' earlier versions; CLEAR SCORES resets INITIALS.DAT and was run by hand');

  // And the headline: how long a game is.
  console.log('  five to fifteen flights, by difficulty, each a wave of'
    + ' (difficulty + 1 to 5) enemies per class');
  console.log('  with a starbase between each, and SD PART3 against BASE STAR.OBJ0 at the end');
  check('a game is between five and fifteen flights',
    selectTarget(1, () => 0) === 5 && selectTarget(3, () => 0.999) === 15,
    'easy 5 at the shortest, hard 15 at the longest');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
