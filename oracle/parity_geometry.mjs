// The port's range and bearing against the real blocks, in the machine.
//
// probe_geometry.mjs established what the two blocks are and that the seven copies really
// are copies. This holds port/src/game/geometry.js to them, and because they run over MATH's
// registers the standard is the same as parity_gamemath's: not "same answer" but "same
// machine afterwards" - ACC, B, EXT, the sign flags and all 243 table bytes.
//
// Six of the seven copies are inline, so there is nothing to call. The engine side sets the
// PC to the top of a block and steps until it reaches the instruction after it, which is
// also where the original's own jumps land: $1C88 for the range, $0D21 for the bearing in
// degrees, $0D5B for the bearing in heading units.
//
// Five wrong ports are carried alongside, each one a plausible mistake rather than a
// scrambled version of the right answer: a Euclidean range, a bearing without the increments
// at $0C5A, a quadrant fold written as an else-if chain, 270 degrees in place of 271 and 360
// in place of 359. Each is reported with the number of cases it fails on, because a control
// that fires on two cases out of sixty is not holding anything down.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Math24, wrap24 } from '../port/src/game/math.js';
import { GEOM, range, rangeFromArgs, bearing, bearingDegrees, foldQuadrant }
  from '../port/src/game/geometry.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);
const TABLE_BYTES = 0xF3;

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight, with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

/** Run a block of game code with the table set, and hand back the machine afterwards. */
await a2.ev(`(() => {
  const get24 = (at) => { const rd = window.M.rd;
    return rd(at) | (rd(at + 1) << 8) | (rd(at + 2) << 16); };
  window.M.geomBlock = (start, stop, table) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snapTab = []; for (let a = 0x9800; a < 0x98F3; a++) snapTab.push(rd(a));
    const snapZp = []; for (let a = 0; a < 0x100; a++) snapZp.push(rd(a));
    for (let a = 0; a < 0x0A; a++) wr(a, 0);
    for (let a = 0xE0; a < 0x100; a++) wr(a, 0);
    wr(0xCE, 0); wr(0xCF, 0);
    for (let i = 0; i < table.length; i++) wr(0x9800 + i, table[i]);
    const st = cpu.getState(); st.pc = start; cpu.setState(st);
    let arrived = false;
    cpu.stepCyclesDebug(4000000, () => { if (cpu.getPC() === stop) { arrived = true; return true; } });
    const out = { arrived,
      acc: get24(0xFA), b: get24(0xEB), ext: get24(0xFD),
      sign: rd(0xCE), sign2: rd(0xCF), r7: get24(7), table: [] };
    for (let i = 0; i < table.length; i++) out.table.push(rd(0x9800 + i));
    for (let a = 0x9800; a < 0x98F3; a++) wr(a, snapTab[a - 0x9800]);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return out;
  };
  return 'ok';
})()`);
const runEngine = (start, stop, table) => a2.ev('JSON.stringify(window.M.geomBlock('
  + start + ',' + stop + ',' + JSON.stringify([...table]) + '))').then(JSON.parse);

/** The same block on a port-side machine, starting from the same table and a clear zero page. */
function runPort(table, fn) {
  const m = new Math24();
  m.table.set(table.slice(0, TABLE_BYTES), 0);
  const out = fn(m);
  return { m, out: out || {} };
}

/**
 * Where the two machines disagree.
 *
 * `ignores` names what a block leaves undefined. The arctangent is the reason there is any:
 * $9C04 is a series that leaves working values in B, EXT, R3 and R7, and the port's lookup
 * reproduces only ACC. After the full bearing block the divide at $0D21 re-establishes ACC,
 * B, EXT and $CE, so only R7 and $CF stay out of scope - but the block that stops at $0D21
 * has the series' leftovers still in place, and they are named rather than quietly skipped.
 * probe_math.mjs is where "nothing reads them" is checked against the listing.
 */
function diff(engine, port, ignores = []) {
  if (!engine.arrived) return ['the block never reached its exit'];
  const bad = [];
  const skip = new Set(ignores);
  if (s24(engine.acc) !== port.m.acc) bad.push(`ACC ${s24(engine.acc)} vs ${port.m.acc}`);
  if (!skip.has('B') && s24(engine.b) !== port.m.b) bad.push(`B ${s24(engine.b)} vs ${port.m.b}`);
  if (!skip.has('EXT') && engine.ext !== port.m.ext) {
    bad.push(`EXT ${engine.ext} vs ${port.m.ext}`);
  }
  if (!skip.has('$CE') && engine.sign !== port.m.sign) {
    bad.push(`$CE ${engine.sign} vs ${port.m.sign}`);
  }
  if (!skip.has('$CF') && engine.sign2 !== port.m.sign2) {
    bad.push(`$CF ${engine.sign2} vs ${port.m.sign2}`);
  }
  if (!skip.has('R7') && s24(engine.r7) !== port.m.r7) {
    bad.push(`R7 ${s24(engine.r7)} vs ${port.m.r7}`);
  }
  for (let i = 0; i < TABLE_BYTES; i++) {
    if (engine.table[i] !== port.m.table[i]) {
      bad.push(`table[${i}] ${engine.table[i]} vs ${port.m.table[i]}`);
      break;
    }
  }
  return bad;
}

/** A deterministic generator, so any failure can be reproduced from the seed. */
let seed = 0x1C3D0C5A;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

/**
 * A table like the game's: the live capture, with four coordinates written into the slots
 * the blocks read. Random bytes everywhere would be a worse test, not a better one - the
 * blocks read five constant entries, and scrambling those tests arithmetic the game never
 * performs while losing the arithmetic it does.
 */
const liveTable = Uint8Array.from(JSON.parse(
  await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))')));
const tableWith = (values) => {
  const t = Uint8Array.from(liveTable);
  for (const [i, v] of Object.entries(values)) {
    const m = u24(v);
    t[Number(i)] = m & 0xff;
    t[Number(i) + 1] = (m >> 8) & 0xff;
    t[Number(i) + 2] = (m >> 16) & 0xff;
  }
  return t;
};
/** Coordinates the game can actually hold: inside the world, with a fraction. */
const randCoord = () => {
  const whole = Math.floor(rnd() * 6145) - 3072;
  return u24(whole * 256 + Math.floor(rnd() * 256));
};
/** And the cases worth forcing: on an axis, coincident, at the bounds, fraction $FF. */
const EDGES = [0, 1, 255, 256, -1, -255, -256, 0x7FFFFF & -1, 786432, -786432,
  409600, -344064, 65535, -65536];

// --- the range ---------------------------------------------------------------------------------
console.log('\n=== $1C3D-$1C88: the range ===');
{
  const cases = [];
  for (let i = 0; i < 60; i++) {
    cases.push([randCoord(), randCoord(), randCoord(), randCoord()]);
  }
  for (const a of EDGES) for (const b of EDGES.slice(0, 7)) cases.push([a, b, 0, 0]);
  const bad = [];
  let unmodelled = 0;
  for (const [aX, aZ, bX, bZ] of cases) {
    const t = tableWith({ [GEOM.aX]: aX, [GEOM.aZ]: aZ, [GEOM.bX]: bX, [GEOM.bZ]: bZ });
    const port = runPort(t, (m) => rangeFromArgs(m));
    // The square root's divides are in domain for every reachable separation, so an
    // out-of-domain case here would mean the sweep left the world - it is counted, not hidden.
    if (port.out.inDomain === false) unmodelled++;
    const d = diff(await runEngine(0x1C3D, 0x1C88, t),
      port, port.out.inDomain === false ? ['EXT'] : []);
    if (d.length) bad.push(`(${s24(aX)},${s24(aZ)})-(${s24(bX)},${s24(bZ)}): ${d[0]}`);
  }
  check('the subroutine form agrees, registers and all 243 table bytes',
    bad.length === 0 && cases.length > 100, bad.slice(0, 3).join('; ')
      || `${cases.length} separations, ${unmodelled} needing EXT out of scope`);
}
{
  // The three inline copies, each against its own target indices.
  const bad = [];
  const INLINE = [[0x0C0F, 0], [0x101F, 1], [0x1429, 2]];
  for (const [addr, which] of INLINE) {
    const target = GEOM.targets[which];
    for (let i = 0; i < 24; i++) {
      const t = tableWith({ [target.x]: randCoord(), [target.z]: randCoord(),
        [GEOM.shipX]: randCoord(), [GEOM.shipZ]: randCoord() });
      const port = runPort(t, (m) => range(m, target.x, target.z, GEOM.shipX, GEOM.shipZ));
      const d = diff(await runEngine(addr, addr + 0x4B, t), port);
      if (d.length) bad.push(`$${addr.toString(16)} case ${i}: ${d[0]}`);
    }
  }
  check('and so do the three inline copies, against the ship and their own target entries',
    bad.length === 0, bad.slice(0, 3).join('; ') || '72 separations across $0C0F, $101F, $1429');
}

// --- the bearing -------------------------------------------------------------------------------
console.log('\n=== $0C5A-$0D30: the bearing ===');
/** Deltas worth sweeping: all four quadrants, both axes, and the $FF fraction. */
const randDelta = () => (rnd() < 0.3 ? pick([0, 1, 2, 255, 256, 257, -1, -255, -256, -257])
  : u24((Math.floor(rnd() * 6145) - 3072) * 256 + Math.floor(rnd() * 256)));
const BEARING_CASES = [];
for (let i = 0; i < 90; i++) BEARING_CASES.push([randDelta(), randDelta()]);
for (const dx of [0, 1, 255, 256, -1, -255, -256]) {
  for (const dz of [0, 1, 255, 256, -1, -256]) BEARING_CASES.push([u24(dx), u24(dz)]);
}
{
  const bad = [];
  let unmodelled = 0;
  for (const [dx, dz] of BEARING_CASES) {
    const t = tableWith({ [GEOM.deltaX]: dx, [GEOM.deltaZ]: dz });
    const port = runPort(t, (m) => bearing(m));
    if (port.out.inDomain === false) unmodelled++;
    const d = diff(await runEngine(0x0C5A, 0x0D5B, t), port,
      ['R7', '$CF', ...(port.out.inDomain === false ? ['EXT'] : [])]);
    if (d.length) bad.push(`(${s24(dx)},${s24(dz)}): ${d[0]}`);
  }
  check('the whole block agrees, with the arctangent\'s leftovers in R7 and $CF out of scope',
    bad.length === 0 && BEARING_CASES.length > 100, bad.slice(0, 3).join('; ')
      || `${BEARING_CASES.length} separations, ${unmodelled} where the ratio saturates`);
}
{
  // Stopping at $0D21, where the original's own two jumps land. Here the arctangent's
  // leftovers are still in B, EXT and $CE, so only ACC and the table can be compared - but
  // this is the point at which a fold written as an else-if chain becomes visible.
  const bad = [];
  for (const [dx, dz] of BEARING_CASES) {
    const t = tableWith({ [GEOM.deltaX]: dx, [GEOM.deltaZ]: dz });
    const d = diff(await runEngine(0x0C5A, 0x0D21, t),
      runPort(t, (m) => bearingDegrees(m)), ['B', 'EXT', '$CE', '$CF', 'R7']);
    if (d.length) bad.push(`(${s24(dx)},${s24(dz)}): ${d[0]}`);
  }
  check('and so does the block up to $0D21, in degrees, before the rescale',
    bad.length === 0, bad.slice(0, 3).join('; ') || `${BEARING_CASES.length} separations`);
}

// --- the wrong ports ---------------------------------------------------------------------------
console.log('\n=== controls: five plausible wrong ports ===');

/** A port that squared the deltas, as a distance ought to. */
const rangeEuclidean = (m) => {
  m.sub(GEOM.bX, GEOM.aX);
  m.storeAcc(GEOM.deltaX);
  m.sub(GEOM.bZ, GEOM.aZ);
  m.storeAcc(GEOM.deltaZ);
  m.multiply(GEOM.deltaX, GEOM.deltaX);
  m.abs();
  m.storeAcc(GEOM.scratch);
  m.multiply(GEOM.deltaZ, GEOM.deltaZ);
  m.abs();
  m.add(GEOM.scratch);
  const r = m.sqrt();
  m.storeAcc(GEOM.range);
  return r;
};

/** A port that took the increments at $0C5A for cosmetics and left them out. */
const bearingNoNudge = (m) => {
  const ratio = m.divide(GEOM.deltaX, GEOM.deltaZ);
  m.atanDegrees();
  m.abs();
  m.storeAcc(GEOM.bearing);
  foldQuadrant(m);
  const units = m.divide(GEOM.degreesPerUnit, GEOM.bearing);
  m.storeAcc(GEOM.bearing);
  return { inDomain: ratio.inDomain && units.inDomain };
};

/** A port that tidied the fall-through at $0CAF into an else-if chain. */
const foldElseIf = (m) => {
  const { bearing: B, zero, deltaX, deltaZ, deg90, deg271 } = GEOM;
  if (m.compare(zero, deltaX) < 0 && m.compare(zero, deltaZ) < 0) {
    m.sub(B, deg90);
    m.storeAcc(B);
  } else if (m.compare(zero, deltaX) < 0 && m.compare(deltaZ, zero) < 0) {
    m.addFrom(deg90, B);
    m.storeAcc(B);
  } else if (m.compare(deltaX, zero) < 0 && m.compare(deltaZ, zero) < 0) {
    m.sub(B, deg271);
    m.storeAcc(B);
  } else if (m.compare(deltaX, zero) < 0 && m.compare(zero, deltaZ) < 0) {
    m.addFrom(deg271, B);
    m.storeAcc(B);
  }
};
const bearingDegreesElseIf = (m) => {
  m.table[GEOM.deltaX] = (m.table[GEOM.deltaX] + 1) & 0xff;
  m.table[GEOM.deltaZ] = (m.table[GEOM.deltaZ] + 1) & 0xff;
  const ratio = m.divide(GEOM.deltaX, GEOM.deltaZ);
  m.atanDegrees();
  m.abs();
  m.storeAcc(GEOM.bearing);
  foldElseIf(m);
  return ratio;
};

/** A port that resolved the two positive-dx quadrants against 270 degrees. */
const bearing270 = (m) => {
  const ratio = bearingDegrees(m);
  // Redo the fold's constant: wherever the original used 271, use the textbook 270.
  const dX = m.read(GEOM.deltaX), dZ = m.read(GEOM.deltaZ);
  if (dX > 0) {
    const deg = m.read(GEOM.bearing) / 256;
    const angle = dZ > 0 ? 271 - deg : deg - 271;
    m.write(GEOM.bearing, wrap24((dZ > 0 ? 270 - angle : angle + 270) * 256));
  }
  const units = m.divide(GEOM.degreesPerUnit, GEOM.bearing);
  m.storeAcc(GEOM.bearing);
  return { inDomain: ratio.inDomain && units.inDomain };
};

/** A port that divided degrees by 360, as a circle ought to be divided. */
const bearing360 = (m) => {
  const ratio = bearingDegrees(m);
  const deg = m.read(GEOM.bearing);
  m.acc = wrap24(Math.trunc(u24(deg) * 256 / 360));
  m.storeAcc(GEOM.bearing);
  return ratio;
};

{
  // Each control is run over the same cases as the thing it is a control for, and has to
  // fail on enough of them to be holding anything down.
  const rangeCases = [];
  for (let i = 0; i < 60; i++) {
    rangeCases.push([randCoord(), randCoord(), randCoord(), randCoord()]);
  }
  let caught = 0;
  for (const [aX, aZ, bX, bZ] of rangeCases) {
    const t = tableWith({ [GEOM.aX]: aX, [GEOM.aZ]: aZ, [GEOM.bX]: bX, [GEOM.bZ]: bZ });
    const engine = await runEngine(0x1C3D, 0x1C88, t);
    if (diff(engine, runPort(t, rangeEuclidean), ['EXT']).length) caught++;
  }
  check('control: a Euclidean range fails', caught >= rangeCases.length * 0.9,
    `${caught} of ${rangeCases.length}`);
}
{
  const controls = {
    'a bearing without the increments at $0C5A': {
      fn: bearingNoNudge, stop: 0x0D5B, ignores: ['R7', '$CF', 'EXT'] },
    'a quadrant fold written as an else-if chain': {
      fn: bearingDegreesElseIf, stop: 0x0D21, ignores: ['EXT', '$CF', 'R7'] },
    '270 degrees in place of 271': {
      fn: bearing270, stop: 0x0D5B, ignores: ['R7', '$CF', 'EXT'] },
    '360 in place of 359': {
      fn: bearing360, stop: 0x0D5B, ignores: ['R7', '$CF', 'EXT', 'B', '$CE'] },
  };
  for (const [name, { fn, stop, ignores }] of Object.entries(controls)) {
    let caught = 0, total = 0;
    for (const [dx, dz] of BEARING_CASES) {
      const t = tableWith({ [GEOM.deltaX]: dx, [GEOM.deltaZ]: dz });
      total++;
      if (diff(await runEngine(0x0C5A, stop, t), runPort(t, fn), ignores).length) caught++;
    }
    check(`control: ${name} fails`, caught >= total * 0.5, `${caught} of ${total}`);
  }
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
