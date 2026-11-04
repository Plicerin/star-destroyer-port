// The port's dispatch against the three real blocks, in the machine.
//
// probe_dispatch.mjs established what the blocks do and the four ways the three copies differ.
// This holds port/src/game/dispatch.js to them, and the standard is the whole machine: every
// byte of MATH's table, of the display list at $80FB-$82E5, and of the binary's own state at
// $0900-$095F. Not just the heading - a launch writes fourteen bytes across three regions, and
// a port that got thirteen of them right would pass a check that only looked at the obvious
// one.
//
// Seven wrong ports are carried alongside: one for each of the four differences between the
// copies, and three for the turn itself. Each is a mistake a reader of one copy would make,
// and each is reported with the number of cases it fails on.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24 } from '../port/src/game/math.js';
import { CLASSES, dispatch, coolDown, BEARING, MISSILE_SPEED, SAVED_HEADING,
  MISSILE_LIFETIME, MISSILE_Y } from '../port/src/game/dispatch.js';
import { field } from '../port/src/game/objects.js';
import { buildStepOperands } from '../port/src/game/flight.js';
import { VAR } from '../port/src/game/tables.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

/** The three windows a dispatch can touch. */
const TABLE = [0x9800, 0x98F3], LIST = [0x80FB, 0x82E6], STATE = [0x0900, 0x0960];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

/** Run a block with the three windows set, and hand all three back. */
await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.dispatchBlock = (start, stops, pokes) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) snap[a] = rd(a); }
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0; a < 0x0A; a++) wr(a, 0);
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0); wr(0xCF, 0);
    for (const [a, v] of Object.entries(pokes || {})) wr(Number(a), v & 0xff);
    const seeded = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) seeded[a] = rd(a); }
    const st = cpu.getState(); st.pc = start; cpu.setState(st);
    let exit = 0;
    cpu.stepCyclesDebug(4000000, () => {
      if (stops.includes(cpu.getPC())) { exit = cpu.getPC(); return true; }
    });
    const after = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) after[a] = rd(a); }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { exit, seeded, after };
  };
  return 'ok';
})()`);
const runEngine = (start, stops, pokes) => a2.ev('JSON.stringify(window.M.dispatchBlock('
  + start + ',' + JSON.stringify(stops) + ',' + JSON.stringify(pokes) + '))').then(JSON.parse);

/**
 * A port-side machine seeded from the engine's own starting state.
 *
 * `mem` is a 64K image holding the display list and the binary's state; MATH's table stays in
 * the Math24, as it does everywhere else in this port, and the two are compared separately.
 */
function toPort(seeded) {
  const mem = new Uint8Array(65536);
  for (const [lo, hi] of [LIST, STATE]) {
    for (let a = lo; a < hi; a++) mem[a] = seeded[a];
  }
  const math = new Math24();
  for (let i = 0; i < 0xF3; i++) math.table[i] = seeded[0x9800 + i];
  return { mem, math };
}

/** Where the engine and the port disagree, over all three windows. */
function diff(engine, port) {
  const bad = [];
  for (const [lo, hi] of [LIST, STATE]) {
    for (let a = lo; a < hi; a++) {
      if (engine.after[a] !== port.mem[a]) {
        bad.push(`${hx(a)} ${engine.after[a]} vs ${port.mem[a]}`);
        if (bad.length > 3) return bad;
      }
    }
  }
  for (let i = 0; i < 0xF3; i++) {
    if (engine.after[0x9800 + i] !== port.math.table[i]) {
      bad.push(`table[${i}] ${engine.after[0x9800 + i]} vs ${port.math.table[i]}`);
      if (bad.length > 3) return bad;
    }
  }
  return bad;
}

/** A deterministic generator, so any failure can be reproduced from the seed. */
let seed = 0x0D5B116B;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const byte = () => Math.floor(rnd() * 256);

/**
 * The cases. Every class, with the heading swept against the bearing through all four
 * outcomes - aligned, one short, above, below - and the cooldown and both missiles both ways,
 * because those are the four things the copies disagree about.
 */
function cases(c) {
  const out = [];
  const set = (pokes) => ({
    [field(4, 'count')]: 0, [field(5, 'count')]: 0,
    [field(16, 'count')]: 0, [field(17, 'count')]: 0,
    [0x0943]: 0, [0x0944]: 0, [0x0945]: 0,
    [c.cooldown]: 0, ...pokes,
  });
  // Every interesting relation between the heading and the bearing, at the wrap too.
  for (const t of [0, 1, 2, 50, 100, 128, 200, 254, 255]) {
    for (const h of [t, (t - 1) & 0xff, (t + 1) & 0xff, (t - 2) & 0xff, (t + 2) & 0xff,
      (t + 128) & 0xff, 0, 255]) {
      out.push(set({
        [field(c.enemy, 'heading')]: h,
        [field(c.twin, 'heading')]: byte(),
        [BEARING + 1]: t,
      }));
    }
  }
  // Cooling, with the heading irrelevant.
  for (const v of [1, 2, 15, 20, 255]) {
    out.push(set({ [c.cooldown]: v, [field(c.enemy, 'heading')]: byte(),
      [field(c.twin, 'heading')]: byte(), [BEARING + 1]: byte() }));
  }
  // A missile already up, either the class's own or the other class's.
  for (const which of [field(4, 'count'), field(5, 'count')]) {
    for (const t of [0, 100, 255]) {
      out.push(set({ [which]: 7, [field(c.enemy, 'heading')]: t, [BEARING + 1]: t }));
    }
  }
  // And random, over every byte the block reads.
  for (let i = 0; i < 40; i++) {
    out.push(set({
      [field(c.enemy, 'heading')]: byte(), [field(c.twin, 'heading')]: byte(),
      [BEARING + 1]: byte(), [c.cooldown]: rnd() < 0.4 ? byte() : 0,
      [field(4, 'count')]: rnd() < 0.3 ? byte() : 0,
      [field(5, 'count')]: rnd() < 0.3 ? byte() : 0,
    }));
  }
  return out;
}

// --- the dispatch ------------------------------------------------------------------------------
console.log('\n=== the three dispatch blocks ===');
const ALL = CLASSES.map((c) => ({ c, list: cases(c) }));
for (const { c, list } of ALL) {
  const bad = [];
  let fires = 0, turns = 0, cools = 0, busy = 0;
  for (const pokes of list) {
    const engine = await runEngine(c.at, [c.exit], pokes);
    const port = toPort(engine.seeded);
    const r = dispatch(port.mem, port.math, c);
    if (r.action === 'fire') fires++;
    else if (r.action === 'cooling') cools++;
    else if (r.action === 'busy') busy++;
    else turns++;
    const d = diff(engine, port);
    if (d.length) bad.push(`${JSON.stringify(r)}: ${d[0]}`);
  }
  check(`${c.name} (${hx(c.at)}) agrees, over the display list, the state and the table`,
    bad.length === 0 && fires > 10 && turns > 20 && cools > 3 && busy >= 2,
    bad.slice(0, 2).join('; ') || `${list.length} cases: ${turns} turns, ${fires} launches,`
      + ` ${cools} cooling, ${busy} blocked`);
}
{
  // Where each decrement leaves by. These are addresses in the region BELOW the dispatch, so
  // they live here rather than in the port: $0E2F / $1239 / $1643 is the zero branch, and
  // $0E3D / $1247 / $1652 is where the JMP goes after a decrement.
  const EXITS = { 0x0E23: [0x0E2F, 0x0E3D], 0x122D: [0x1239, 0x1247], 0x1637: [0x1643, 0x1652] };
  const bad = [];
  for (const c of CLASSES) {
    const exits = EXITS[c.coolDownAt];
    for (const v of [0, 1, 2, 15, 20, 255]) {
      const engine = await runEngine(c.coolDownAt, exits, { [c.cooldown]: v });
      const port = toPort(engine.seeded);
      const ticked = coolDown(port.mem, c);
      const d = diff(engine, port);
      if (d.length) bad.push(`${c.name} ${v}: ${d[0]}`);
      // The branch the original takes is observable: zero leaves by the other exit.
      if (ticked !== (engine.exit === exits[1])) {
        bad.push(`${c.name} ${v}: took the wrong branch`);
      }
    }
  }
  check('and the three cooldown decrements agree, including which branch they leave by',
    bad.length === 0, bad.slice(0, 2).join('; ') || '18 cases across $0E23, $122D and $1637');
}

// --- the wrong ports ---------------------------------------------------------------------------
console.log('\n=== controls: seven plausible wrong ports ===');

// Written out rather than parameterised, because each one is meant to be a port someone
// actually wrote, not a flag on the right one.
const turnUp = (mem, c) => {
  const h = field(c.enemy, 'heading');
  mem[h] = (mem[h] + 2) & 0xff;
  mem[field(c.twin, 'heading')] = mem[h];
};
const turnDown = (mem, c) => {
  const h = field(c.enemy, 'heading');
  mem[h] = (mem[h] - 3) & 0xff;
  mem[field(c.twin, 'heading')] = mem[h];
};
const launch = (mem, math, c, { soundIsOne = false, frames = null, missile = null } = {}) => {
  const m = missile === null ? c.missile : missile;
  if (mem[field(m, 'count')] !== 0) return;
  mem[field(m, 'count')] = MISSILE_LIFETIME;
  mem[field(c.missileTwin, 'count')] = MISSILE_LIFETIME;
  mem[c.launchSound] = (soundIsOne || !c.soundStoresHeading)
    ? 1 : mem[field(c.enemy, 'heading')];
  mem[c.cooldown] = frames === null ? c.cooldownFrames : frames;
  math.copy(c.enemyPos[0], c.missilePos[0]);
  math.copy(c.enemyPos[1], c.missilePos[1]);
  const heading = mem[field(c.enemy, 'heading')];
  mem[SAVED_HEADING] = heading;
  mem[field(m, 'heading')] = heading;
  buildStepOperands(math, heading);
  math.divide(MISSILE_SPEED, VAR.stepX);
  math.storeAcc(c.missileStep[0]);
  math.divide(MISSILE_SPEED, VAR.stepZ);
  math.storeAcc(c.missileStep[1]);
  mem[field(m, 'y')] = MISSILE_Y & 0xff;
  mem[field(m, 'y') + 1] = (MISSILE_Y >> 8) & 0xff;
};

/** The shape all six share, with one thing wrong each. */
const variant = (opts) => (mem, math, c) => {
  const h = field(c.enemy, 'heading');
  if (mem[c.cooldown] !== 0) {
    // The mistake a reader of one copy makes: one cooling turn for all three classes.
    if (opts.coolingAlwaysUp) return turnUp(mem, c);
    if (opts.coolingAlwaysDown) return turnDown(mem, c);
    return c.coolingTurn === 'up' ? turnUp(mem, c) : turnDown(mem, c);
  }
  const target = math.table[(BEARING + 1) & 0xff];
  if (mem[h] === target) return launch(mem, math, c, opts);
  mem[h] = (mem[h] + 1) & 0xff;
  if (mem[h] === target) {
    // A port that treats the probe as a look-ahead and puts the heading back first.
    if (opts.undoProbeBeforeFiring) mem[h] = (mem[h] - 1) & 0xff;
    return launch(mem, math, c, opts);
  }
  // A signed comparison, which only differs across the wrap.
  const a = opts.signedCompare ? (mem[h] > 127 ? mem[h] - 256 : mem[h]) : mem[h];
  const b = opts.signedCompare ? (target > 127 ? target - 256 : target) : target;
  if (a > b) return turnDown(mem, c);
  mem[h] = (mem[h] - 1) & 0xff;
  return turnUp(mem, c);
};

const CONTROLS = {
  'one cooling direction for all three classes': variant({ coolingAlwaysUp: true }),
  'the other one cooling direction': variant({ coolingAlwaysDown: true }),
  'class 3 cooling for 20 frames like the others': variant({ frames: 0x14 }),
  'class 3 storing 1 in its sound flag, as the dead LDX intends': variant({ soundIsOne: true }),
  'class 3 given its own missile instead of sharing object 5': variant({ missile: 6 }),
  'a signed heading comparison': variant({ signedCompare: true }),
  'the probe undone before firing': variant({ undoProbeBeforeFiring: true }),
};
for (const [name, fn] of Object.entries(CONTROLS)) {
  let caught = 0, total = 0;
  for (const { c, list } of ALL) {
    for (const pokes of list) {
      const engine = await runEngine(c.at, [c.exit], pokes);
      const port = toPort(engine.seeded);
      fn(port.mem, port.math, c);
      total++;
      if (diff(engine, port).length) caught++;
    }
  }
  check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
