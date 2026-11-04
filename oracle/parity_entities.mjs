// The port's entity blocks against the twelve real ones, in the machine.
//
// probe_entities.mjs established what the four blocks do per class and that the enemy's
// movement is the ship's with different indices. This holds port/src/game/entities.js to all
// twelve, over the whole machine: every byte of MATH's table, of the display list at
// $80FB-$82E5, and of the binary's state at $0900-$095F.
//
// The `reach` block ends in a JSR to an explosion routine this port does not provide, so the
// engine side stops at the JSR. Everything before it is compared; nothing after it is
// claimed.
//
// Six wrong ports are carried alongside. Two of them are the mistakes this probe itself made
// first: comparing a range the wrong way round at exact equality, and letting the step pull a
// position back inside before the wrap looks.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24 } from '../port/src/game/math.js';
import { CLASSES } from '../port/src/game/dispatch.js';
import { reach, hold, move, missile, RAM_RANGE, HOLD_RANGE, HIT_RANGE, RAMMED, HIT,
  SAVED_HEADING } from '../port/src/game/entities.js';
import { GEOM, rangeFromArgs } from '../port/src/game/geometry.js';
import { buildStepOperands, wrapPosition } from '../port/src/game/flight.js';
import { field } from '../port/src/game/objects.js';
import { VAR } from '../port/src/game/tables.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const LIST = [0x80FB, 0x82E6], STATE = [0x0900, 0x0960];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.entityRun = (start, stops, pokes, table) => {
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
const runEngine = (start, stops, pokes, table) => a2.ev('JSON.stringify(window.M.entityRun('
  + start + ',' + JSON.stringify(stops) + ',' + JSON.stringify(pokes) + ','
  + JSON.stringify(table) + '))').then(JSON.parse);

function toPort(seeded) {
  const mem = new Uint8Array(65536);
  for (const [lo, hi] of [LIST, STATE]) {
    for (let a = lo; a < hi; a++) mem[a] = seeded[a];
  }
  const math = new Math24();
  for (let i = 0; i < 0xF3; i++) math.table[i] = seeded[0x9800 + i];
  return { mem, math };
}

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

let seed = 0x0E3D0F83;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const byte = () => Math.floor(rnd() * 256);
/** A coordinate the game can hold: inside the world, with a fraction. */
const coord = () => u24((Math.floor(rnd() * 6145) - 3072) * 256 + byte());

// --- reach and hold ----------------------------------------------------------------------------
console.log('\n=== $0E05 reach and $0E2F hold ===');
{
  // Ranges around each threshold, including exactly on it, plus the whole span.
  const ranges = [];
  for (const base of [2814, 6400, 3328]) {
    for (const d of [-2, -1, 0, 1, 2]) ranges.push(u24(base + d));
  }
  for (let i = 0; i < 20; i++) ranges.push(u24(Math.floor(rnd() * 40000)));
  ranges.push(0, u24(0x7FFFFF), u24(-1));

  for (const [name, fn, at, exits] of [
    ['reach', (p, c) => reach(p.mem, p.math, c), 'reachAt', 'reachExits'],
    ['hold', (p) => hold(p.math), 'holdAt', 'holdExits'],
  ]) {
    const bad = [];
    let fired = 0;
    for (const c of CLASSES) {
      for (const range of ranges) {
        const engine = await runEngine(c[at], c[exits],
          { [RAMMED]: 0, [field(c.enemy, 'count')]: 3, [field(c.twin, 'count')]: 3 },
          { [GEOM.range]: range });
        const port = toPort(engine.seeded);
        const r = fn(port, c);
        const took = name === 'reach' ? r.rammed : r;
        if (took) fired++;
        // The branch the original takes is observable, and for `hold` it is the only thing
        // the block produces at all.
        const engineTook = engine.exit === c[exits][name === 'reach' ? 0 : 1];
        if (took !== engineTook) {
          bad.push(`${c.name} range ${range}: port ${took}, engine ${engineTook}`);
        }
        const d = diff(engine, port);
        if (d.length) bad.push(`${c.name} range ${range}: ${d[0]}`);
      }
    }
    check(`${name} agrees, and so does which branch it takes`,
      bad.length === 0 && fired > 10 && fired < ranges.length * 3 - 10,
      bad.slice(0, 2).join('; ') || `${ranges.length * 3} ranges, ${fired} firing -`
        + ' five of them sit exactly on a threshold, which is where the two comparisons differ');
  }
}

// --- the enemy's movement ----------------------------------------------------------------------
console.log('\n=== $0E3D the enemy\'s movement ===');
{
  const bad = [];
  let wrapped = 0;
  const cases = [];
  // Every heading that has a zero component, every heading that does not, and the bounds.
  for (const h of [0, 1, 32, 63, 64, 65, 96, 127, 128, 160, 192, 224, 255]) {
    cases.push({ h, x: coord(), z: coord() });
  }
  // Pushed past each bound, with a heading that cannot pull it back on that axis.
  for (const [h, x, z] of [
    [0, u24(-786432 - 5000), 0], [0, u24(786432 + 5000), 0],
    [64, 0, u24(-344064 - 5000)], [64, 0, u24(409600 + 5000)],
    [0, u24(-786432), 0], [0, u24(786432), 0],
    [64, 0, u24(-344064)], [64, 0, u24(409600)],
  ]) cases.push({ h, x, z });
  for (let i = 0; i < 40; i++) cases.push({ h: byte(), x: coord(), z: coord() });

  for (const c of CLASSES) {
    for (const { h, x, z } of cases) {
      const engine = await runEngine(c.moveAt, [c.moveExit],
        { [field(c.enemy, 'heading')]: h, [field(c.twin, 'heading')]: byte() },
        { [c.enemyPos[0]]: x, [c.enemyPos[1]]: z });
      const port = toPort(engine.seeded);
      move(port.mem, port.math, c);
      const d = diff(engine, port);
      if (d.length) bad.push(`${c.name} h=${h}: ${d[0]}`);
      if (engine.after[0x9800 + c.enemyPos[0] + 2] === engine.seeded[0x9800 + 0xF2]) wrapped++;
    }
  }
  check('all three move, wrap and publish exactly as the machine does',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || `${cases.length * 3} cases, including all four wraps provoked at the bounds`);
}

// --- the missile -------------------------------------------------------------------------------
console.log('\n=== $0F83 the missile\'s flight ===');
{
  const bad = [];
  let flew = 0, hits = 0, off = 0;
  const cases = [];
  for (let i = 0; i < 40; i++) {
    cases.push({ count: rnd() < 0.2 ? 0 : 1 + byte(), x: coord(), z: coord(),
      sx: u24(Math.floor(rnd() * 20000) - 10000), sz: u24(Math.floor(rnd() * 20000) - 10000),
      px: coord(), pz: coord() });
  }
  // On top of the ship, and exactly on the hit threshold's edge, which is the branch.
  for (const d of [-600, -1, 0, 1, 600]) {
    cases.push({ count: 5, x: u24(d * 16), z: 0, sx: 0, sz: 0, px: 0, pz: 0 });
  }
  cases.push({ count: 0, x: 0, z: 0, sx: 0, sz: 0, px: 0, pz: 0 });

  for (const c of CLASSES) {
    for (const k of cases) {
      const engine = await runEngine(c.missileAt, [c.missileExit],
        { [field(c.missile, 'count')]: k.count, [field(c.missileTwin, 'count')]: k.count,
          [HIT]: 0 },
        { [c.missilePos[0]]: k.x, [c.missilePos[1]]: k.z,
          [c.missileStep[0]]: k.sx, [c.missileStep[1]]: k.sz,
          [VAR.posX]: k.px, [VAR.posZ]: k.pz });
      const port = toPort(engine.seeded);
      const r = missile(port.mem, port.math, c);
      if (!r.flying) off++; else if (r.hit) hits++; else flew++;
      const d = diff(engine, port);
      if (d.length) bad.push(`${c.name} ${JSON.stringify(r)}: ${d[0]}`);
    }
  }
  check('all three fly, publish, measure the range to the ship and test for a hit',
    bad.length === 0 && flew > 20 && hits > 5 && off > 5, bad.slice(0, 2).join('; ')
      || `${cases.length * 3} cases: ${flew} in flight, ${hits} hitting, ${off} not up`);
}

// --- the wrong ports ---------------------------------------------------------------------------
console.log('\n=== controls: six plausible wrong ports ===');
{
  // The two comparisons, swapped. Both are the mistake of reading `LDY`/`LDX` as if the order
  // did not matter, and both only show at exact equality.
  const reachStrict = (mem, math, c) => {
    if (math.compare(RAM_RANGE, GEOM.range) >= 0) return { rammed: false };
    mem[RAMMED] = 1;
    mem[field(c.enemy, 'count')] = 0;
    mem[field(c.twin, 'count')] = 0;
    return { rammed: true };
  };
  const holdInclusive = (math) => math.compare(GEOM.range, HOLD_RANGE) >= 0;
  let a = 0, b = 0, total = 0;
  for (const c of CLASSES) {
    for (const range of [2814, 6400]) {
      const engine = await runEngine(c.reachAt, c.reachExits,
        { [RAMMED]: 0, [field(c.enemy, 'count')]: 3, [field(c.twin, 'count')]: 3 },
        { [GEOM.range]: u24(range) });
      const port = toPort(engine.seeded);
      reachStrict(port.mem, port.math, c);
      total++;
      if (diff(engine, port).length) a++;
      const engineHold = await runEngine(c.holdAt, c.holdExits, {},
        { [GEOM.range]: u24(range) });
      if (holdInclusive(toPort(engineHold.seeded).math)
        !== (engineHold.exit === c.holdExits[1])) b++;
    }
  }
  check('control: reach read as a strict comparison fails on the threshold itself',
    a > 0, `${a} of ${total}`);
  check('control: hold read as inclusive fails on the threshold itself',
    b > 0, `${b} of ${total}`);
}
{
  // The step runs before the wrap. A port that wrapped first would look right almost always.
  const wrapFirst = (mem, math, c) => {
    const heading = mem[field(c.enemy, 'heading')];
    mem[SAVED_HEADING] = heading;
    buildStepOperands(math, heading);
    wrapPosition(math, c.enemyPos[0], c.enemyPos[1]);
    for (const [step, pos] of [[VAR.stepX, c.enemyPos[0]], [VAR.stepZ, c.enemyPos[1]]]) {
      math.divide(VAR.speed, step);
      math.add(pos);
      math.storeAcc(pos);
    }
  };
  // The enemy's own speed, rather than the throttle entry every one of them shares.
  const ownSpeed = (mem, math, c) => {
    const heading = mem[field(c.enemy, 'heading')];
    mem[SAVED_HEADING] = heading;
    buildStepOperands(math, heading);
    for (const [step, pos] of [[VAR.stepX, c.enemyPos[0]], [VAR.stepZ, c.enemyPos[1]]]) {
      math.divide(0x86, step);        // the missile's entry, 383 - a plausible misreading
      math.add(pos);
      math.storeAcc(pos);
    }
    wrapPosition(math, c.enemyPos[0], c.enemyPos[1]);
  };
  // Publishing all three axes, which an object record invites.
  const publishY = (mem, math, c) => {
    move(mem, math, c);
    for (const o of [c.enemy, c.twin]) {
      mem[field(o, 'y')] = 0;
      mem[field(o, 'y') + 1] = 0;
    }
  };
  const cases = [];
  for (const [h, x, z] of [
    [0, u24(-786432 - 5000), 0], [0, u24(786432 + 5000), 0],
    [64, 0, u24(-344064 - 5000)], [64, 0, u24(409600 + 5000)],
    [32, coord(), coord()], [100, coord(), coord()], [200, coord(), coord()],
  ]) cases.push({ h, x, z });
  for (const [name, fn] of [['the wrap run before the step', wrapFirst],
    ['the missile\'s speed entry instead of the throttle\'s', ownSpeed],
    ['Y published alongside X and Z', publishY]]) {
    let caught = 0, total = 0;
    for (const c of CLASSES) {
      for (const { h, x, z } of cases) {
        const engine = await runEngine(c.moveAt, [c.moveExit],
          { [field(c.enemy, 'heading')]: h, [field(c.enemy, 'y')]: 0x33,
            [field(c.enemy, 'y') + 1]: 0x44 },
          { [c.enemyPos[0]]: x, [c.enemyPos[1]]: z });
        const port = toPort(engine.seeded);
        fn(port.mem, port.math, c);
        total++;
        if (diff(engine, port).length) caught++;
      }
    }
    check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
  }
}
{
  // The missile with a wrap it does not have, and with $1AE8 it does not call.
  const missileWrapped = (mem, math, c) => {
    if (mem[field(c.missile, 'count')] === 0) return;
    for (const [step, pos] of [[c.missileStep[0], c.missilePos[0]],
      [c.missileStep[1], c.missilePos[1]]]) {
      math.addFrom(step, pos);
      math.storeAcc(pos);
    }
    wrapPosition(math, c.missilePos[0], c.missilePos[1]);
    for (const [index, objs, name] of [[c.missilePos[0], [c.missile, c.missileTwin], 'x'],
      [c.missilePos[1], [c.missile, c.missileTwin], 'z']]) {
      for (const k of [1, 2]) {
        for (const o of objs) mem[field(o, name) + k - 1] = math.table[(index + k) & 0xff];
      }
    }
    math.copy(c.missilePos[0], GEOM.aX);
    math.copy(VAR.posX, GEOM.bX);
    math.copy(c.missilePos[1], GEOM.aZ);
    math.copy(VAR.posZ, GEOM.bZ);
    rangeFromArgs(math);
    if (math.compare(HIT_RANGE, GEOM.range) >= 0) return;
    mem[HIT] = 1;
    mem[field(c.missile, 'count')] = 0;
    mem[field(c.missileTwin, 'count')] = 0;
  };
  let caught = 0, total = 0;
  for (const c of CLASSES) {
    for (const [x, z] of [[u24(-786432 - 5000), 0], [u24(786432 + 5000), 0],
      [0, u24(409600 + 5000)], [coord(), coord()]]) {
      const engine = await runEngine(c.missileAt, [c.missileExit],
        { [field(c.missile, 'count')]: 5, [field(c.missileTwin, 'count')]: 5, [HIT]: 0 },
        { [c.missilePos[0]]: x, [c.missilePos[1]]: z,
          [c.missileStep[0]]: 0, [c.missileStep[1]]: 0, [VAR.posX]: 0, [VAR.posZ]: 0 });
      const port = toPort(engine.seeded);
      missileWrapped(port.mem, port.math, c);
      total++;
      if (diff(engine, port).length) caught++;
    }
  }
  check('control: a missile given the world wrap it does not have fails',
    caught > 0, `${caught} of ${total} - a missile leaves the world and keeps going`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
