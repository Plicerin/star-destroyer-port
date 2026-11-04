// The port's kill chain against the real blocks, in the machine.
//
// probe_kill.mjs established the chain and the three things in it that are not what they look
// like. This holds port/src/game/kill.js to it over the whole machine: MATH's table, the
// display list at $80FB-$82E5, the state at $0900-$095F, and the wave and score counters at
// $1FF9-$1FFE.
//
// The sound the chain triggers is not ported, and that is visible rather than hidden: the
// award block's `JSR $1DD3` and the debris pieces' sounds run in the engine and leave their
// marks in the sound engine's parameter block at $1D4A-$1D51, which is outside every window
// compared here. Nothing else the blocks touch is outside them.
//
// Six wrong ports, and three of them are the three traps: a respawn that trusts its immediate
// operand instead of the caller's carry, a class-2 respawn that returns instead of cascading,
// and a debris animation that switches on all four pieces.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24 } from '../port/src/game/math.js';
import { CLASSES } from '../port/src/game/dispatch.js';
import { SHOTS, DEBRIS, DEBRIS_UNUSED, DEBRIS_FRAMES, DEBRIS_LIFETIME, ALWAYS_ON,
  RESPAWN_Z, shotHit, debrisTick, respawn, award, placeDebris, aimDebris, switchOffShot,
  switchOffEnemy } from '../port/src/game/kill.js';
import { field } from '../port/src/game/objects.js';
import { GEOM, rangeFromArgs } from '../port/src/game/geometry.js';
import { RAM_RANGE } from '../port/src/game/entities.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const LIST = [0x80FB, 0x82E6], STATE = [0x0900, 0x0960], WAVE = [0x1FF9, 0x1FFF];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960], [0x1FF9, 0x1FFF]];
  window.M.killRun = (start, stops, pokes, table, carry, sub) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) snap[a] = rd(a); }
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0; a < 0x0A; a++) wr(a, 0);
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0); wr(0xCF, 0);
    for (const [i, v] of Object.entries(table || {})) {
      const n = Number(i);
      wr(0x9800 + n, v & 0xff);
      wr(0x9801 + n, (v >> 8) & 0xff);
      wr(0x9802 + n, (v >> 16) & 0xff);
    }
    for (const [a, v] of Object.entries(pokes || {})) wr(Number(a), v & 0xff);
    const seeded = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) seeded[a] = rd(a); }
    const st = cpu.getState();
    if (sub) {
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      stops = [0xFFFF];
    }
    st.pc = start;
    if (carry !== null) st.s = carry ? (st.s | 1) : (st.s & ~1);
    cpu.setState(st);
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
const runEngine = (start, stops, pokes, table, carry = null, sub = false) => a2.ev(
  'JSON.stringify(window.M.killRun(' + start + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + ',' + carry + ',' + sub
  + '))').then(JSON.parse);

function toPort(seeded) {
  const mem = new Uint8Array(65536);
  for (const [lo, hi] of [LIST, STATE, WAVE]) {
    for (let a = lo; a < hi; a++) mem[a] = seeded[a];
  }
  const math = new Math24();
  for (let i = 0; i < 0xF3; i++) math.table[i] = seeded[0x9800 + i];
  return { mem, math };
}

function diff(engine, port) {
  const bad = [];
  for (const [lo, hi] of [LIST, STATE, WAVE]) {
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

let seed = 0x0EF31944;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const byte = () => Math.floor(rnd() * 256);
const coord = () => u24((Math.floor(rnd() * 6145) - 3072) * 256 + byte());

/** Everything the six shot blocks read, settable. */
const shotCase = (c, shot, over = {}) => ({
  [field(shot.object, 'count')]: 1 + byte(),
  [field(shot.twin, 'count')]: 1 + byte(),
  [field(shot.object, 'heading')]: byte(),
  [field(c.enemy, 'count')]: ALWAYS_ON,
  [field(c.twin, 'count')]: ALWAYS_ON,
  [field(c.enemy, 'x')]: byte(), [field(c.enemy, 'x') + 1]: byte(),
  [field(c.enemy, 'z')]: byte(), [field(c.enemy, 'z') + 1]: byte(),
  [c.debrisCounter]: 0,
  ...Object.fromEntries([...DEBRIS.flat(), ...DEBRIS_UNUSED]
    .map((o) => [field(o, 'count'), 0])),
  ...over,
});

// --- the six shot blocks ------------------------------------------------------------------------
console.log('\n=== the six shot blocks ===');
{
  const bad = [];
  let hits = 0, misses = 0, off = 0;
  for (const c of CLASSES) {
    for (const [s, shot] of SHOTS.entries()) {
      const at = c.shotAt[s];
      const cases = [];
      // On top of the enemy, near it, far from it, and not up at all.
      cases.push({ pokes: shotCase(c, shot, { [field(shot.object, 'count')]: 0 }),
        table: {} });
      for (const d of [0, 16, 32, 100, 4000, 100000]) {
        cases.push({ pokes: shotCase(c, shot),
          table: { [shot.pos[0]]: u24(d), [shot.pos[1]]: 0,
            [c.enemyPos[0]]: 0, [c.enemyPos[1]]: 0 } });
      }
      for (let i = 0; i < 12; i++) {
        cases.push({ pokes: shotCase(c, shot),
          table: { [shot.pos[0]]: coord(), [shot.pos[1]]: coord(),
            [c.enemyPos[0]]: coord(), [c.enemyPos[1]]: coord() } });
      }
      for (const { pokes, table } of cases) {
        const engine = await runEngine(at, [at + 0x48], pokes, table);
        const port = toPort(engine.seeded);
        const r = shotHit(port.mem, port.math, shot, c);
        if (!r.up) off++; else if (r.hit) hits++; else misses++;
        const d = diff(engine, port);
        if (d.length) bad.push(`${hx(at)} ${JSON.stringify(r)}: ${d[0]}`);
      }
    }
  }
  check('all six agree, over the display list, the state and the table',
    bad.length === 0 && hits > 5 && misses > 20 && off > 3, bad.slice(0, 2).join('; ')
      || `114 cases: ${hits} hits, ${misses} misses, ${off} with the shot not up`);
}
{
  // The four subroutines on their own, so a failure says which one.
  const bad = [];
  const SUBS = [
    ['$1944 place', (c, shot) => [c.debrisPlace, (p) => placeDebris(p.mem, c)]],
    ['$1A8B aim', (c, shot) => [shot.aimAt, (p) => aimDebris(p.mem, shot)]],
    ['$1F67 shot off', (c, shot) => [shot.offAt, (p) => switchOffShot(p.mem, shot)]],
    ['$1AAC enemy off', (c, shot) => [c.enemyOff, (p) => switchOffEnemy(p.mem, c)]],
  ];
  for (const [name, make] of SUBS) {
    for (const c of CLASSES) {
      for (const shot of SHOTS) {
        const [at, apply] = make(c, shot);
        const engine = await runEngine(at, [], shotCase(c, shot), {}, null, true);
        const port = toPort(engine.seeded);
        apply(port);
        const d = diff(engine, port);
        if (d.length) bad.push(`${name} ${c.name} ${shot.name}: ${d[0]}`);
      }
    }
  }
  check('and so do the four subroutines a hit calls, taken one at a time',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || '24 runs across three placers, two aims, two shot-offs and three enemy-offs');
}

// --- the debris tick ----------------------------------------------------------------------------
console.log('\n=== the debris animation and the respawn under it ===');
{
  const bad = [];
  let staged = 0, spawned = 0, idle = 0;
  for (const c of CLASSES) {
    for (const counter of [0, 1, 2, 3, 4, 5, 255]) {
      for (const wave of [0, 1, 5]) {
        const pokes = {
          [c.debrisCounter]: counter, [c.wave]: wave,
          0x1FFA: wave, 0x1FFB: wave,
          [field(c.enemy, 'count')]: 0, [field(c.twin, 'count')]: 0,
          [field(2, 'count')]: 0, [field(3, 'count')]: 0,
          [field(14, 'count')]: 0, [field(15, 'count')]: 0,
          ...Object.fromEntries([...DEBRIS.flat()].map((o) => [field(o, 'count'), 0])),
        };
        const table = { [c.enemyPos[0]]: coord(), [c.enemyPos[1]]: coord(),
          [CLASSES[2].enemyPos[0]]: coord(), [CLASSES[2].enemyPos[1]]: coord() };
        const engine = await runEngine(c.tickAt, [c.tickExit], pokes, table, false);
        const port = toPort(engine.seeded);
        const r = debrisTick(port.mem, port.math, c, CLASSES);
        if (r === null) idle++;
        else if (r.stage === 'respawn') spawned++;
        else staged++;
        const d = diff(engine, port);
        if (d.length) bad.push(`${c.name} counter ${counter} wave ${wave}: ${d[0]}`);
      }
    }
  }
  check('the three tick blocks agree, animation and respawn alike',
    bad.length === 0 && staged > 15 && spawned > 5 && idle > 2, bad.slice(0, 2).join('; ')
      || `63 cases: ${staged} pieces switched on, ${spawned} respawns, ${idle} with no debris`);
}
{
  // The respawn called directly, both carries, and the cascade.
  const bad = [];
  const EXITS = [0x1EC7, 0x1EF8, 0x1F29];
  for (const [i, c] of CLASSES.entries()) {
    for (const carry of [false, true]) {
      for (const [w2, w3] of [[5, 5], [0, 5], [0, 0], [1, 0]]) {
        const pokes = { 0x1FF9: 5, 0x1FFA: w2, 0x1FFB: w3,
          [field(c.enemy, 'count')]: 0, [field(c.twin, 'count')]: 0,
          [field(3, 'count')]: 0, [field(15, 'count')]: 0 };
        const table = {};
        for (const k of CLASSES) {
          table[k.enemyPos[0]] = coord();
          table[k.enemyPos[1]] = coord();
        }
        const engine = await runEngine(c.respawnAt, EXITS, pokes, table, carry);
        const port = toPort(engine.seeded);
        respawn(port.mem, port.math, c, carry, CLASSES);
        const d = diff(engine, port);
        if (d.length) bad.push(`${c.name} carry ${carry} waves ${w2}/${w3}: ${d[0]}`);
      }
    }
  }
  check('and the respawn agrees on both carries, and on class 2\'s cascade into class 3',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || '24 runs: three classes, two carries, four wave states');
}

// --- the award ----------------------------------------------------------------------------------
console.log('\n=== the score ===');
{
  const bad = [];
  let awarded = 0;
  for (const c of CLASSES) {
    for (const counter of [0, 1, 2, 3, 4, 5, 255]) {
      const engine = await runEngine(c.awardAt, [c.awardAt + 0x0D],
        { [c.debrisCounter]: counter, [c.score]: byte() }, {});
      const port = toPort(engine.seeded);
      if (award(port.mem, c).awarded) awarded++;
      const d = diff(engine, port);
      if (d.length) bad.push(`${c.name} counter ${counter}: ${d[0]}`);
    }
  }
  check('the three award blocks agree, including the wrap when a score is at 255',
    bad.length === 0 && awarded > 5, bad.slice(0, 2).join('; ')
      || `21 cases, ${awarded} awarding - the sound at $1DD3 runs in the engine and leaves`
        + ' its mark in $1D4A-$1D51, outside every window compared here');
}

// --- the wrong ports ----------------------------------------------------------------------------
console.log('\n=== controls: six plausible wrong ports ===');
{
  const EXITS = [0x1EC7, 0x1EF8, 0x1F29];
  const respawnNoCarry = (mem, math, c, carry, classes) => respawn(mem, math, c, false, classes);
  const respawnNoCascade = (mem, math, c, carry) => {
    if (mem[c.wave] === 0) return;
    mem[c.wave] = (mem[c.wave] - 1) & 0xff;
    mem[field(c.enemy, 'count')] = ALWAYS_ON;
    mem[field(c.twin, 'count')] = ALWAYS_ON;
    const high = (c.bump + math.table[(c.enemyPos[0] + 2) & 0xff] + (carry ? 1 : 0)) & 0xff;
    math.table[(c.enemyPos[0] + 2) & 0xff] = high;
    mem[field(c.enemy, 'x') + 1] = high;
    mem[field(c.twin, 'x') + 1] = high;
    math.table[(c.enemyPos[1] + 2) & 0xff] = RESPAWN_Z;
    mem[field(c.enemy, 'z') + 1] = RESPAWN_Z;
    mem[field(c.twin, 'z') + 1] = RESPAWN_Z;
  };
  // A respawn that writes the whole position rather than only the high byte.
  const respawnWholeZ = (mem, math, c, carry, classes) => {
    respawn(mem, math, c, carry, classes);
    math.write(c.enemyPos[1], RESPAWN_Z * 65536);
  };
  for (const [name, fn] of [
    ['a respawn that trusts its immediate instead of the carry', respawnNoCarry],
    ['a class-2 respawn that returns instead of cascading', respawnNoCascade],
    ['a respawn that writes the whole Z entry rather than its high byte', respawnWholeZ],
  ]) {
    let caught = 0, total = 0;
    for (const c of CLASSES) {
      for (const [w2, w3] of [[5, 5], [0, 5]]) {
        const pokes = { 0x1FF9: 5, 0x1FFA: w2, 0x1FFB: w3,
          [field(c.enemy, 'count')]: 0, [field(c.twin, 'count')]: 0,
          [field(3, 'count')]: 0, [field(15, 'count')]: 0 };
        const table = {};
        for (const k of CLASSES) {
          table[k.enemyPos[0]] = coord();
          table[k.enemyPos[1]] = coord();
        }
        const engine = await runEngine(c.respawnAt, EXITS, pokes, table, true);
        const port = toPort(engine.seeded);
        fn(port.mem, port.math, c, true, CLASSES);
        total++;
        if (diff(engine, port).length) caught++;
      }
    }
    check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
  }
}
{
  // The debris, done three plausible wrong ways.
  const tickAllFour = (mem, math, c) => {
    if (mem[c.debrisCounter] === 0) return;
    const counter = mem[c.debrisCounter];
    const pairs = [...DEBRIS, DEBRIS_UNUSED];
    if (counter >= 1 && counter <= 4) {
      const [a, b] = pairs[4 - counter];
      mem[field(a, 'count')] = DEBRIS_LIFETIME;
      mem[field(b, 'count')] = DEBRIS_LIFETIME;
    }
    mem[c.debrisCounter] = (mem[c.debrisCounter] - 1) & 0xff;
  };
  const tickNoDecrement = (mem, math, c, classes) => {
    debrisTick(mem, math, c, classes);
    mem[c.debrisCounter] = (mem[c.debrisCounter] + 1) & 0xff;
  };
  const tickPermanent = (mem, math, c) => {
    if (mem[c.debrisCounter] === 0) return;
    const counter = mem[c.debrisCounter];
    if (counter >= 2 && counter <= 4) {
      const [a, b] = DEBRIS[4 - counter];
      mem[field(a, 'count')] = ALWAYS_ON;
      mem[field(b, 'count')] = ALWAYS_ON;
    }
    mem[c.debrisCounter] = (mem[c.debrisCounter] - 1) & 0xff;
  };
  for (const [name, fn] of [
    ['a debris animation that switches on all four pieces', tickAllFour],
    ['a tick that leaves the counter alone', tickNoDecrement],
    ['debris given $FF instead of a count of 1', tickPermanent],
  ]) {
    let caught = 0, total = 0;
    for (const c of CLASSES) {
      for (const counter of [1, 2, 3, 4]) {
        const pokes = { [c.debrisCounter]: counter, [c.wave]: 5, 0x1FFA: 5, 0x1FFB: 5,
          [field(c.enemy, 'count')]: 0, [field(c.twin, 'count')]: 0,
          ...Object.fromEntries([...DEBRIS.flat(), ...DEBRIS_UNUSED]
            .map((o) => [field(o, 'count'), 0])) };
        const engine = await runEngine(c.tickAt, [c.tickExit], pokes,
          { [c.enemyPos[0]]: coord(), [c.enemyPos[1]]: coord() }, false);
        const port = toPort(engine.seeded);
        fn(port.mem, port.math, c, CLASSES);
        total++;
        if (diff(engine, port).length) caught++;
      }
    }
    check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
  }
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
