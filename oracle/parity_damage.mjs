// The port's damage model against the real routines, in the machine.
//
// probe_damage.mjs established the model. This holds port/src/game/damage.js to it over every
// byte of the display list at $80FB-$82E5 and the state at $0900-$095F - which covers the three
// panel bars and the hit count, and leaves out only the sound engine's parameter block at
// $1D4A-$1D51, which the sounds this chain triggers are the whole of Phase 6.
//
// The shield is swept one unit at a time from empty to full, for both kinds of hit, because
// the interesting behaviour is all at the boundary: which of four shrinks lands, which of them
// gets stored, and whether the systems take it instead.
//
// Five wrong ports, three of them mistakes that a check looking only at a full shield would
// let through: a ram that stores after every shrink, a shield floor read as a clamp rather
// than an equality, and a missile hit costing a ram's sixteen.
//
// And one thing that is NOT a control, recorded as such: reading $1CFC's `CPX #$C8` as $C7
// cannot be told apart from the real thing, because the only value the two disagree on is $C7
// and $1CB1's own first test sends that to the systems either way.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { SHLD, WARP, MSL, EMPTY, HITS, FATAL, STEP, shrink, systems, shieldHeld, rammed,
  missileHit, launchSounds, applyDamage, QUIT, QUIT_VALUE }
  from '../port/src/game/damage.js';
import { RAMMED, HIT } from '../port/src/game/entities.js';
import { CLASSES } from '../port/src/game/dispatch.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const LIST = [0x80FB, 0x82E6], STATE = [0x0900, 0x0960];
/** Zero page $00, where the fourth hit leaves the byte that ends the flight. */
const QUIT_ZP = [0x0000, 0x0002];
/** Everything seeded into the port and compared afterwards. */
const RANGES = [QUIT_ZP, LIST, STATE];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  // Zero page $00 is watched because the fourth hit's only lasting effect is written there.
  // It was missing from this list, so the comparison below ran green against a port whose
  // ship could not be destroyed - the one byte that would have shown it was the one byte
  // nobody was looking at.
  const WATCH = [[0x0000, 0x0002], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.damageParity = (addr, pokes, stop) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) snap[a] = rd(a); }
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (const [a, v] of Object.entries(pokes || {})) wr(Number(a), v & 0xff);
    const seeded = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) seeded[a] = rd(a); }
    const st = cpu.getState();
    const target = stop || 0xFFFF;
    if (!stop) {
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
    }
    st.pc = addr;
    cpu.setState(st);
    let ok = false, died = false;
    cpu.stepCyclesDebug(4000000, () => {
      const pc = cpu.getPC();
      if (pc === 0x1F2B) died = true;
      if (pc === target) { ok = true; return true; }
    });
    const after = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) after[a] = rd(a); }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { ok, died, after, seeded };
  };
  return 'ok';
})()`);
const runEngine = (addr, pokes, stop = 0) => a2.ev('JSON.stringify(window.M.damageParity('
  + addr + ',' + JSON.stringify(pokes) + ',' + stop + '))').then(JSON.parse);

function toPort(seeded) {
  const mem = new Uint8Array(65536);
  for (const [lo, hi] of RANGES) {
    for (let a = lo; a < hi; a++) mem[a] = seeded[a];
  }
  return mem;
}

function diff(engine, mem) {
  const bad = [];
  for (const [lo, hi] of RANGES) {
    for (let a = lo; a < hi; a++) {
      if (engine.after[a] !== mem[a]) {
        bad.push(`${hx(a)} ${engine.after[a]} vs ${mem[a]}`);
        if (bad.length > 3) return bad;
      }
    }
  }
  return bad;
}

/** Every shield value from empty to well above it, and both system bars both ways. */
function cases() {
  const out = [];
  for (let shield = EMPTY - 2; shield <= EMPTY + 24; shield++) {
    for (const [w, m] of [[0xFF, 0xFF], [EMPTY, 0xFF], [0xFF, EMPTY], [EMPTY, EMPTY],
      [EMPTY + 2, EMPTY + 3]]) {
      for (const hits of [0, 2, 3]) {
        out.push({ [SHLD]: shield, [WARP]: w, [MSL]: m, [HITS]: hits });
      }
    }
  }
  return out;
}

// --- the primitive -----------------------------------------------------------------------------
console.log('\n=== $1C89 ===');
{
  // No memory to compare: it works in the registers, so the port's own function is held
  // against the machine's X and Y directly.
  await a2.ev(`(() => {
    window.M.shrink = (x) => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState();
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = 0x1C89; st.x = x & 0xff;
      cpu.setState(st);
      cpu.stepCyclesDebug(100000, () => (cpu.getPC() === 0xFFFF));
      const end = cpu.getState();
      cpu.setState(before);
      return { x: end.x, y: end.y };
    };
    return 'ok';
  })()`);
  const bad = [];
  for (let x = 0; x < 256; x++) {
    const r = JSON.parse(await a2.ev('JSON.stringify(window.M.shrink(' + x + '))'));
    const want = shrink(x);
    if (r.x !== want.value || r.y !== want.steps) {
      bad.push(`${x}: ${r.x}/${r.y} vs ${want.value}/${want.steps}`);
    }
  }
  check('the port\'s shrink matches all 256 inputs, including the ones that run past the floor',
    bad.length === 0, bad.slice(0, 3).join('; ') || '256 values, X and Y both');
}

// --- the two kinds of hit ----------------------------------------------------------------------
console.log('\n=== a ram and a missile hit ===');
for (const [name, addr, fn] of [['$1C99 ram', 0x1C99, rammed],
  ['$1CFC missile hit', 0x1CFC, missileHit],
  ['$1CB1 the shared second eight', 0x1CB1, shieldHeld],
  ['$1CCD the systems', 0x1CCD, systems]]) {
  const bad = [];
  let absorbed = 0, fell = 0, destroyed = 0;
  for (const pokes of cases()) {
    const engine = await runEngine(addr, pokes);
    const mem = toPort(engine.seeded);
    const r = fn(mem);
    if (r.absorbed) absorbed++; else if (r.destroyed) destroyed++; else fell++;
    // The engine's own path says whether it died, which is a branch the memory cannot show.
    if (!!r.destroyed !== engine.died) {
      bad.push(`shield ${pokes[SHLD]} hits ${pokes[HITS]}: destroyed ${r.destroyed}`
        + ` against ${engine.died}`);
    }
    const d = diff(engine, mem);
    if (d.length) bad.push(`shield ${pokes[SHLD]} hits ${pokes[HITS]}: ${d[0]}`);
  }
  check(`${name} agrees across the shield's whole boundary`,
    bad.length === 0, bad.slice(0, 2).join('; ')
      || `${cases().length} cases: ${absorbed} absorbed, ${fell} through to the systems,`
        + ` ${destroyed} fatal`);
}

// --- the flag blocks ---------------------------------------------------------------------------
console.log('\n=== the flag blocks that read them ===');
{
  // The hit count is swept as well as the shield. It used to be seeded at 0 and nothing
  // else, so no case in this file ever reached the fourth hit, and the one effect the
  // fourth hit has went unchecked for the life of the port. 2 and 3 put the ship one and
  // two hits from the end; with both flags set, a single pass can take it from 2 to 4.
  const bad = [];
  for (const [ram, miss] of [[0, 0], [1, 0], [0, 1], [1, 1], [0x5A, 0x40]]) {
    for (const shield of [EMPTY, EMPTY + 1, EMPTY + 8, EMPTY + 16, 0xFF]) {
      for (const hits of [0, 2, 3]) {
        const pokes = { [RAMMED]: ram, [HIT]: miss, [SHLD]: shield,
          [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: hits, [QUIT]: 0 };
        const engine = await runEngine(0x18BC, pokes, 0x18D6);
        const mem = toPort(engine.seeded);
        applyDamage(mem);
        const d = diff(engine, mem);
        if (d.length) {
          bad.push(`ram ${ram} miss ${miss} shield ${shield} hits ${hits}: ${d[0]}`);
        }
      }
    }
  }
  check('$18BC and $18C9 agree, including a pass in which both arrive',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || '75 cases - both flags, every shield boundary, three starting hit counts, and'
        + ' zero page $00 among the bytes compared');

  // What the sweep above now covers, stated on its own so a failure names itself.
  const fatal = await runEngine(0x18BC,
    { [RAMMED]: 1, [HIT]: 0, [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: FATAL - 1,
      [QUIT]: 0 }, 0x18D6);
  const fatalMem = toPort(fatal.seeded);
  const fatalOut = applyDamage(fatalMem);
  check('the fourth hit leaves $00 holding $4D in the port, as it does in the machine',
    fatal.after[QUIT] === QUIT_VALUE && fatalMem[QUIT] === QUIT_VALUE
      && fatalOut.ram.destroyed === true,
    `machine ${hx(fatal.after[QUIT])}, port ${hx(fatalMem[QUIT])}`
      + ' - which is the byte $18D6 reads to end the flight');

  const lived = await runEngine(0x18BC,
    { [RAMMED]: 1, [HIT]: 0, [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: FATAL - 2,
      [QUIT]: 0 }, 0x18D6);
  const livedMem = toPort(lived.seeded);
  const livedOut = applyDamage(livedMem);
  check('control: the third leaves it alone in both',
    lived.after[QUIT] === 0 && livedMem[QUIT] === 0 && livedOut.ram.destroyed === false,
    'so the check above is not passing on a byte that was always $4D');

  const flagBad = [];
  for (const set of [[0, 0, 0], [1, 1, 1], [1, 0, 0x40], [0, 0x7F, 0]]) {
    const pokes = { [RAMMED]: 0, [HIT]: 0, [SHLD]: 0xFF, [HITS]: 0 };
    CLASSES.forEach((c, i) => { pokes[c.launchSound] = set[i]; });
    const engine = await runEngine(0x186E, pokes, 0x1895);
    const mem = toPort(engine.seeded);
    launchSounds(mem, CLASSES);
    const d = diff(engine, mem);
    if (d.length) flagBad.push(`${set.join('/')}: ${d[0]}`);
  }
  check('and so do the three launch-sound flags above them',
    flagBad.length === 0, flagBad.slice(0, 2).join('; ')
      || 'four combinations, including class 3\'s flag holding a heading rather than 1');
}

// --- the wrong ports ---------------------------------------------------------------------------
console.log('\n=== controls: five plausible wrong ports, and one redundancy ===');
{
  // A ram that stores the shield after every shrink rather than after the second.
  const ramEagerStore = (mem) => {
    if (mem[SHLD] === EMPTY) return systems(mem);
    let r = shrink(mem[SHLD]);
    mem[SHLD] = r.value;
    if (r.value === EMPTY) return systems(mem);
    r = shrink(r.value);
    mem[SHLD] = r.value;
    if (r.steps !== STEP) return systems(mem);
    return shieldHeld(mem);
  };
  // A floor read as "at or below" rather than as an equality.
  const ramClampedFloor = (mem) => {
    const take = (x, n) => Math.max(EMPTY, x - n);
    if (mem[SHLD] <= EMPTY) return systems(mem);
    const after = take(mem[SHLD], 16);
    const spent = mem[SHLD] - after;
    mem[SHLD] = after;
    if (spent < 16) return systems(mem);
    return { absorbed: true, destroyed: false };
  };
  // A ram costing eight, as the missile hit does.
  const ramEight = (mem) => shieldHeld(mem);
  for (const [name, fn] of [
    ['a ram that stores the shield after every shrink', ramEagerStore],
    ['a shield floor read as a clamp rather than an equality', ramClampedFloor],
    ['a ram costing eight, like a missile hit', ramEight],
  ]) {
    let caught = 0, total = 0;
    for (const pokes of cases()) {
      const engine = await runEngine(0x1C99, pokes);
      const mem = toPort(engine.seeded);
      fn(mem);
      total++;
      if (diff(engine, mem).length) caught++;
    }
    check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
  }

  // And the one this file actually shipped: a systems block that reads $1F2B as nothing but
  // a sound and so never writes $00. It went green here for the life of the port, because
  // no case in this file reached the fourth hit and zero page was not among the bytes
  // compared. Both of those are fixed above; this is the control that proves it.
  const forgetsTheWrite = (mem) => {
    for (const bar of [MSL, WARP]) {
      if (mem[bar] !== EMPTY) mem[bar] = shrink(mem[bar]).value;
    }
    mem[HITS] = (mem[HITS] + 1) & 0xff;
    return { absorbed: false, destroyed: mem[HITS] >= FATAL };
  };
  let missed = 0, tried = 0;
  for (const hits of [FATAL - 1, FATAL, FATAL + 1]) {
    const pokes = { [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: hits, [QUIT]: 0 };
    const engine = await runEngine(0x1CCD, pokes);
    const mem = toPort(engine.seeded);
    forgetsTheWrite(mem);
    tried++;
    if (diff(engine, mem).length) missed++;
  }
  check('control: a systems block that treats $1F2B as only a sound fails',
    missed === tried,
    `${missed} of ${tried} - the defect this harness used to let through`);
}
{
  // $1CFC tests `CPX #$C8`, and reading that as $C7 turns out to be UNOBSERVABLE: the only
  // value the two disagree on is $C7 itself, and $1CB1's own first test sends that to the
  // systems anyway. So this is not a control, it is a measured redundancy - and the honest
  // way to record it is to run the wrong reading over every case and require that it agrees.
  const missileOffByOne = (mem) => {
    if (mem[SHLD] >= EMPTY) return shieldHeld(mem);
    return systems(mem);
  };
  let same = 0, total = 0;
  for (const pokes of cases()) {
    const engine = await runEngine(0x1CFC, pokes);
    const mem = toPort(engine.seeded);
    missileOffByOne(mem);
    total++;
    if (diff(engine, mem).length === 0) same++;
  }
  check('$1CFC\'s test against $C8 is redundant: reading it as $C7 cannot be told apart',
    same === total,
    `${same} of ${total} - the two differ only at $C7, and $1CB1's own guard catches that,`
      + ' so this is a redundancy rather than something the port has to get right');

  // A missile hit costing sixteen, the mirror of the ram costing eight.
  const missileSixteen = (mem) => rammed(mem);
  let caught = 0; total = 0;
  for (const pokes of cases()) {
    const engine = await runEngine(0x1CFC, pokes);
    const mem = toPort(engine.seeded);
    missileSixteen(mem);
    total++;
    if (diff(engine, mem).length) caught++;
  }
  check('control: a missile hit costing sixteen, like a ram, fails', caught > 0,
    `${caught} of ${total}`);

  // Systems damage that drains an already-empty bar instead of skipping it.
  const systemsNoGuard = (mem) => {
    for (const bar of [MSL, WARP]) mem[bar] = shrink(mem[bar]).value;
    mem[HITS] = (mem[HITS] + 1) & 0xff;
    return { absorbed: false, destroyed: mem[HITS] >= FATAL };
  };
  // A hit count that is fatal at five rather than four.
  const fatalAtFive = (mem) => {
    const r = systems(mem);
    return { ...r, destroyed: mem[HITS] >= 5 };
  };
  for (const [name, addr, fn, byMemory] of [
    ['systems damage that drains an empty bar', 0x1CCD, systemsNoGuard, true],
    ['a hit count fatal at five rather than four', 0x1CCD, fatalAtFive, false],
  ]) {
    let n = 0, m = 0;
    for (const pokes of cases()) {
      const engine = await runEngine(addr, pokes);
      const mem = toPort(engine.seeded);
      const r = fn(mem);
      m++;
      const wrong = byMemory ? diff(engine, mem).length > 0 : !!r.destroyed !== engine.died;
      if (wrong) n++;
    }
    check(`control: ${name} fails`, n > 0, `${n} of ${m}`);
  }
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
