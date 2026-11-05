// The port's weapon against the real blocks, in the machine.
//
// probe_weapon.mjs established the rules. This holds port/src/game/weapon.js to them over the
// whole machine: MATH's table, the display list at $80FB-$82E5, and the state at $0900-$095F.
//
// The slot sweep is the whole cross product of the two counts at and around the two thresholds,
// because the firing rule is stated in terms of both of them and the interesting cases are all
// at 1 and at 11.
//
// Five wrong ports, and three are the three findings: a publish that writes the shot's own Y,
// a slot 2 that costs a missile, and a rate limit read as "this slot" rather than "the other".
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24 } from '../port/src/game/math.js';
import { fire, moveShot, publishShot, SHOTS, SHOT_LIFETIME, RELOAD, SHOT_SPEED,
  PUBLISHED_Y, FIRED } from '../port/src/game/weapon.js';
import { MSL, EMPTY } from '../port/src/game/damage.js';
import { field } from '../port/src/game/objects.js';
import { VAR } from '../port/src/game/tables.js';
import { H1 } from '../port/src/game/controls.js';
import { buildStepOperands } from '../port/src/game/flight.js';
import { SAVED_HEADING } from '../port/src/game/entities.js';

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
  window.M.weaponParity = (addr, stops, pokes, table, button, sub) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) snap[a] = rd(a); }
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0; a < 0x0A; a++) wr(a, 0);
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0); wr(0xCF, 0);
    if (button === true) window.M.a2.getIO().buttonDown(0);
    if (button === false) window.M.a2.getIO().buttonUp(0);
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
    }
    st.pc = addr;
    cpu.setState(st);
    const want = new Set(sub ? [0xFFFF] : stops);
    let exit = 0, sounded = 0;
    cpu.stepCyclesDebug(8000000, () => {
      const pc = cpu.getPC();
      if (pc === 0x1FB2) sounded = pc;
      if (want.has(pc)) { exit = pc; return true; }
    });
    const after = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) after[a] = rd(a); }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { exit, sounded, after, seeded };
  };
  return 'ok';
})()`);
const runEngine = (addr, stops, pokes, table, button = null, sub = false) => a2.ev(
  'JSON.stringify(window.M.weaponParity(' + addr + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + ',' + button + ',' + sub
  + '))').then(JSON.parse);

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

let seed = 0x0ADB1B2B;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const byte = () => Math.floor(rnd() * 256);
const coord = () => u24((Math.floor(rnd() * 6145) - 3072) * 256 + byte());

/** Every combination of the two counts at and around the two thresholds, plus random. */
function slotCases() {
  const out = [];
  const edges = [0, 1, 2, 10, 11, 12, 19, 20, 21, 255];
  for (const a of edges) for (const b of edges) out.push([a, b]);
  for (let i = 0; i < 20; i++) out.push([byte(), byte()]);
  return out;
}

// --- firing -------------------------------------------------------------------------------------
console.log('\n=== $0ADB, the trigger ===');
{
  const cases = slotCases();
  const bad = [];
  let one = 0, two = 0, none = 0;
  for (const [c6, c7] of cases) {
    const pokes = {
      [field(6, 'count')]: c6, [field(7, 'count')]: c7,
      [field(18, 'count')]: byte(), [field(19, 'count')]: byte(),
      [MSL]: 200 + Math.floor(rnd() * 56), [FIRED]: 0, [H1]: byte(),
      [field(4, 'y')]: byte(), [field(4, 'y') + 1]: byte(),
      [field(5, 'y')]: byte(), [field(5, 'y') + 1]: byte(),
    };
    const table = { [VAR.posX]: coord(), [VAR.posZ]: coord() };
    const engine = await runEngine(0x0ADB, [0x0B6A], pokes, table, true);
    const port = toPort(engine.seeded);
    const r = fire(port.mem, port.math, true);
    if (r.fired === SHOTS[0]) one++; else if (r.fired === SHOTS[1]) two++; else none++;
    const d = diff(engine, port);
    if (d.length) bad.push(`${c6}/${c7}: ${d[0]}`);
  }
  // The firing rule is narrow: of the hundred edge combinations only four let slot 1 go
  // (count 6 at zero, count 7 under 11) and three let slot 2, so the bar is that every branch
  // is exercised at all rather than that many are.
  check('the trigger agrees over every combination of the two counts',
    bad.length === 0 && one > 0 && two > 0 && none > 50, bad.slice(0, 2).join('; ')
      || `${cases.length} cases: ${one} fired slot 1, ${two} slot 2, ${none} nothing`);

  // The button up, and the empty bar, which are the two early exits.
  const bad2 = [];
  for (const [label, button, msl] of [['button up', false, 244], ['bar empty', true, EMPTY]]) {
    const pokes = { [field(6, 'count')]: 0, [field(7, 'count')]: 0, [MSL]: msl, [FIRED]: 0 };
    const engine = await runEngine(0x0ADB, [0x0B6A], pokes, {}, button);
    const port = toPort(engine.seeded);
    const r = fire(port.mem, port.math, button);
    if (r.fired !== null) bad2.push(`${label}: the port fired`);
    const d = diff(engine, port);
    if (d.length) bad2.push(`${label}: ${d[0]}`);
  }
  check('and so do its two early exits, the button and the empty bar',
    bad2.length === 0, bad2.join('; ')
      || 'the empty bar reports the buzz at $1FB2 rather than playing it');
}

// --- the flight ---------------------------------------------------------------------------------
console.log('\n=== $0B6A and $0BB7, the two shots in flight ===');
{
  const bad = [];
  let moved = 0, down = 0;
  for (const shot of SHOTS) {
    const cases = [];
    for (const h of [0, 1, 32, 63, 64, 96, 128, 192, 255]) {
      cases.push({ h, count: 1 + byte(), x: coord(), z: coord() });
    }
    cases.push({ h: 64, count: 0, x: coord(), z: coord() });
    // Outside the world, where it must NOT wrap.
    cases.push({ h: 64, count: 7, x: u24(786432 + 50000), z: 0 });
    cases.push({ h: 192, count: 7, x: u24(-786432 - 50000), z: 0 });
    for (let i = 0; i < 10; i++) {
      cases.push({ h: byte(), count: rnd() < 0.2 ? 0 : 1 + byte(), x: coord(), z: coord() });
    }
    for (const k of cases) {
      const pokes = {
        [field(shot.object, 'count')]: k.count,
        [field(shot.object, 'heading')]: k.h,
        [field(shot.publishedY, 'y')]: byte(), [field(shot.publishedY, 'y') + 1]: byte(),
      };
      const table = { [shot.pos[0]]: k.x, [shot.pos[1]]: k.z };
      const engine = await runEngine(shot.moveAt, [shot.moveExit], pokes, table);
      const port = toPort(engine.seeded);
      if (moveShot(port.mem, port.math, shot)) moved++; else down++;
      const d = diff(engine, port);
      if (d.length) bad.push(`${hx(shot.moveAt)} h=${k.h} count=${k.count}: ${d[0]}`);
    }
  }
  check('both agree, including out past the edge of the world where they do not wrap',
    bad.length === 0 && moved > 30 && down > 2, bad.slice(0, 2).join('; ')
      || `${moved + down} cases: ${moved} in flight, ${down} with the slot down`);
}
{
  // The publish on its own, so a failure says which half.
  const bad = [];
  for (const shot of SHOTS) {
    for (let i = 0; i < 8; i++) {
      const pokes = {
        [field(shot.publishedY, 'y')]: byte(), [field(shot.publishedY, 'y') + 1]: byte(),
        [field(shot.object, 'y')]: byte(), [field(shot.object, 'y') + 1]: byte(),
      };
      const table = { [shot.pos[0]]: coord(), [shot.pos[1]]: coord() };
      const engine = await runEngine(shot.publishAt, [], pokes, table, null, true);
      const port = toPort(engine.seeded);
      publishShot(port.mem, port.math, shot);
      const d = diff(engine, port);
      if (d.length) bad.push(`${hx(shot.publishAt)}: ${d[0]}`);
    }
  }
  check('and so does the publish, Y and all',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || '16 runs across $1B2B and $1B60, with both Y operands pre-set to something else');
}

// --- the wrong ports ----------------------------------------------------------------------------
console.log('\n=== controls: five plausible wrong ports ===');
{
  // The publish, written as if it set the shot's own Y - which is what it looks like it does.
  const publishOwnY = (mem, math, shot) => {
    for (const offset of [0, 1]) {
      const byteX = math.table[(shot.pos[0] + 1 + offset) & 0xff];
      mem[field(shot.object, 'x') + offset] = byteX;
      mem[field(shot.twin, 'x') + offset] = byteX;
    }
    mem[field(shot.object, 'y')] = PUBLISHED_Y & 0xff;
    mem[field(shot.object, 'y') + 1] = (PUBLISHED_Y >> 8) & 0xff;
    for (const offset of [0, 1]) {
      const byteZ = math.table[(shot.pos[1] + 1 + offset) & 0xff];
      mem[field(shot.object, 'z') + offset] = byteZ;
      mem[field(shot.twin, 'z') + offset] = byteZ;
    }
  };
  let caught = 0, total = 0;
  for (const shot of SHOTS) {
    for (let i = 0; i < 4; i++) {
      const pokes = {
        [field(shot.publishedY, 'y')]: 1, [field(shot.publishedY, 'y') + 1]: 2,
        [field(shot.object, 'y')]: 3, [field(shot.object, 'y') + 1]: 4,
      };
      const engine = await runEngine(shot.publishAt, [], pokes,
        { [shot.pos[0]]: coord(), [shot.pos[1]]: coord() }, null, true);
      const port = toPort(engine.seeded);
      publishOwnY(port.mem, port.math, shot);
      total++;
      if (diff(engine, port).length) caught++;
    }
  }
  check('control: a publish that sets the shot\'s own Y fails', caught > 0, `${caught} of ${total}`);
}
{
  const cases = slotCases();
  // Slot 2 charged a missile, like slot 1.
  const bothCost = (mem, math, button) => {
    const r = fire(mem, math, button);
    if (r.fired === SHOTS[1]) mem[MSL] = (mem[MSL] - 1) & 0xff;
    return r;
  };
  // The rate limit read as "this slot must have cooled" rather than the other one.
  const ownReload = (mem, math, button) => {
    if (!button) return { fired: null };
    if (mem[MSL] === EMPTY) return { fired: null };
    if (mem[field(6, 'count')] < 1 && mem[field(6, 'count')] < RELOAD) {
      mem[FIRED] = 1;
      mem[field(18, 'count')] = SHOT_LIFETIME;
      mem[field(6, 'count')] = SHOT_LIFETIME;
      math.copy(VAR.posX, SHOTS[0].pos[0]);
      math.copy(VAR.posZ, SHOTS[0].pos[1]);
      publishShot(mem, math, SHOTS[0]);
      mem[field(6, 'heading')] = mem[H1];
      mem[MSL] = (mem[MSL] - 1) & 0xff;
      return { fired: SHOTS[0] };
    }
    return { fired: null };
  };
  // Four units off the bar, as the routine it borrows normally takes.
  const fourUnits = (mem, math, button) => {
    const before = mem[MSL];
    const r = fire(mem, math, button);
    if (r.spent) mem[MSL] = (before - 4) & 0xff;
    return r;
  };
  for (const [name, fn] of [
    ['slot 2 charged a missile too', bothCost],
    ['the rate limit read as this slot rather than the other', ownReload],
    ['four units off the bar, as $1C89 normally takes', fourUnits],
  ]) {
    let caught = 0, total = 0;
    for (const [c6, c7] of cases) {
      const pokes = { [field(6, 'count')]: c6, [field(7, 'count')]: c7,
        [MSL]: 240, [FIRED]: 0, [H1]: 0x20 };
      const engine = await runEngine(0x0ADB, [0x0B6A], pokes,
        { [VAR.posX]: coord(), [VAR.posZ]: coord() }, true);
      const port = toPort(engine.seeded);
      fn(port.mem, port.math, true);
      total++;
      if (diff(engine, port).length) caught++;
    }
    check(`control: ${name} fails`, caught > 0, `${caught} of ${total}`);
  }
}
{
  // A shot given the world wrap the ship has.
  const wrapped = (mem, math, shot) => {
    if (mem[field(shot.object, 'count')] === 0) return false;
    const heading = mem[field(shot.object, 'heading')];
    mem[SAVED_HEADING] = heading;
    buildStepOperands(math, heading);
    for (const step of [VAR.stepX, VAR.stepZ]) {
      math.divide(SHOT_SPEED, step);
      math.storeAcc(step);
    }
    for (const [step, pos] of [[VAR.stepX, shot.pos[0]], [VAR.stepZ, shot.pos[1]]]) {
      math.addFrom(step, pos);
      math.storeAcc(pos);
    }
    for (const [pos, lo, hi] of [[shot.pos[0], VAR.minX, VAR.maxX],
      [shot.pos[1], VAR.minZ, VAR.maxZ]]) {
      if (math.read(pos) < math.read(lo)) math.write(pos, math.read(hi));
      else if (math.read(pos) > math.read(hi)) math.write(pos, math.read(lo));
    }
    publishShot(mem, math, shot);
    return true;
  };
  let caught = 0, total = 0;
  for (const shot of SHOTS) {
    for (const [x, z] of [[u24(786432 + 50000), 0], [u24(-786432 - 50000), 0],
      [0, u24(409600 + 50000)], [coord(), coord()]]) {
      const engine = await runEngine(shot.moveAt, [shot.moveExit],
        { [field(shot.object, 'count')]: 7, [field(shot.object, 'heading')]: 0 },
        { [shot.pos[0]]: x, [shot.pos[1]]: z });
      const port = toPort(engine.seeded);
      wrapped(port.mem, port.math, shot);
      total++;
      if (diff(engine, port).length) caught++;
    }
  }
  check('control: a shot given the ship\'s world wrap fails', caught > 0, `${caught} of ${total}`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
