// The enemies move, their missiles fly, and the loop asks twice whether anything has arrived.
//
// Four blocks per class, twelve in all, and the first job here is to show how little of it is
// new: the enemy's movement is the SHIP's movement block with different indices, down to the
// four compare-and-copy pairs that wrap it at the world's edge, so the port shares one
// function rather than writing it four times. That is checked as an instruction stream, not
// taken on the strength of it reading the same.
//
// The second job is the three thresholds, which are not all the same comparison, and the
// object count, which this probe settles: nothing in the binary decrements it, the RENDERER
// does, at $6D18. DISK_TRUTH recorded the handler's decrement as never seen to happen.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { VARS, VAR } from '../port/src/game/tables.js';
import { field } from '../port/src/game/objects.js';
import { CLASSES } from '../port/src/game/dispatch.js';
import { RAM_RANGE, HOLD_RANGE, HIT_RANGE, RAMMED, HIT } from '../port/src/game/entities.js';
import { GEOM } from '../port/src/game/geometry.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
const image = [];
for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];

// --- the enemy's movement is the ship's ---------------------------------------------------------
console.log('\n=== $0E3D is $09D1 without the gate ===');
{
  // The wrap. Four places, four identical instruction streams over the same four bounds, and
  // only the position indices and the jump targets differ.
  const WRAPS = [
    { name: 'the ship $0A09', at: 0x0A09, end: 0x0A63 },
    { name: 'class 1 $0E70', at: 0x0E70, end: 0x0EC9 },
    { name: 'class 2 $127A', at: 0x127A, end: 0x12D3 },
    { name: 'class 3 $1685', at: 0x1685, end: 0x16DE },
  ];
  const raw = WRAPS.map((w) => disasmRange(image, w.at, w.end));
  console.log('  ' + WRAPS.map((w, i) =>
    `${w.name}: ${w.end - w.at} bytes, ${raw[i].length} instructions`).join('\n  '));
  // The ship's copy has one instruction more than the other three: a stray CLC between the
  // first branch and the copy it guards. It affects nothing - the next instruction is a JSR
  // into MATH, which sets the carry itself - so it is named here and not reproduced.
  const strays = raw.map((ls) => ls.filter((l) => l.op === 'CLC'));
  check('the ship\'s copy has one stray CLC that the three enemy copies do not',
    strays[0].length === 1 && strays.slice(1).every((x) => x.length === 0),
    `${hx(strays[0][0].addr, 4)}, between the first BPL and the copy it guards`);
  const streams = raw.map((ls) => ls.filter((l) => l.op !== 'CLC').map((l) => l.op).join(' '));
  check('and with it set aside, all four wrap with the same instruction stream',
    new Set(streams).size === 1,
    `${streams[0].split(' ').length} opcodes, identical in all four - which is why the port`
      + ' shares wrapPosition rather than writing it out four times');

  // And they compare against the same four bound entries, not copies of them.
  const bounds = WRAPS.map((w) => [...new Set(disasmRange(image, w.at, w.end)
    .filter((l) => l.mode === 'abs' && /^(LD[XY])$/.test(l.op))
    .map((l) => l.bytes[1] | (l.bytes[2] << 8))
    .filter((a) => a >= 0x08F2 && a <= 0x08F5))].sort());
  check('and against the same four bound entries, $08F2-$08F5',
    bounds.every((b) => b.length === 4 && b.join() === '2290,2291,2292,2293'),
    bounds[0].map((a) => hx(a, 4)).join(', '));

  // The whole movement block, ship against enemy, once the wrap is set aside.
  const ship = disasmRange(image, 0x09DC, 0x0A09).map((l) => l.op).join(' ');
  const enemy = disasmRange(image, 0x0E43, 0x0E70).map((l) => l.op).join(' ');
  check('the step-and-add above it is the same too, so an enemy moves exactly as the ship does',
    ship === enemy, `${ship.split(' ').length} opcodes from $09DC and from $0E43`);

  // Which means the throttle entry is shared, so an enemy always moves at warp speed. The
  // divisor is whatever the LDX immediately before each JSR $9A65 names, found rather than
  // counted off: the first attempt at this read a fixed offset and got the add's operand.
  const divisors = [[0x09DC, 0x0A09], [0x0E43, 0x0E70], [0x124D, 0x127A], [0x1658, 0x1685]]
    .flatMap(([from, to]) => {
      const ls = disasmRange(image, from, to);
      return ls.filter((l, i) => l.text === 'JSR $9A65' && ls[i - 1].op === 'LDX')
        .map((l, k) => {
          const prev = ls[ls.indexOf(l) - 1];
          return prev.bytes[1] | (prev.bytes[2] << 8);
        });
    });
  check('every one of them divides by the SAME throttle entry, so enemies fly at warp speed',
    divisors.length === 8 && new Set(divisors).size === 1 && divisors[0] === 0x0917,
    `${divisors.length} divides across the ship and the three enemies, all naming`
      + ` ${hx(divisors[0], 4)} - the entry the throttle reads`);

  // The difference: the gate, and that the enemy has no equivalent.
  const gated = disasmRange(image, 0x09D7, 0x09DC).map((l) => l.text);
  check('the only difference is the warp gate, which the enemy blocks do not have',
    gated[0] === 'LDX $0948' && !enemy.includes('LDX $0948'),
    `${gated.join(' / ')} has no counterpart at $0E3D`);
}

// --- the machine -------------------------------------------------------------------------------
console.log('\n=== the oracle ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.entityBlock = (start, stops, pokes, table) => {
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
    const after = {}, changed = {};
    for (const [lo, hi] of WATCH) {
      for (let a = lo; a < hi; a++) {
        after[a] = rd(a);
        if (after[a] !== seeded[a]) changed[a] = after[a];
      }
    }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { exit, after, seeded, changed };
  };
  return 'ok';
})()`);
const run = (start, stops, pokes = {}, table = {}) => a2.ev(
  'JSON.stringify(window.M.entityBlock(' + start + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + '))').then(JSON.parse);
const ent = (after, i) => s24(after[0x9800 + i] | (after[0x9800 + i + 1] << 8)
  | (after[0x9800 + i + 2] << 16));

// --- the three thresholds ----------------------------------------------------------------------
console.log('\n=== the three arrival tests, and the comparison each uses ===');
{
  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const value = (i) => s24(tab[i] | (tab[i + 1] << 8) | (tab[i + 2] << 16));
  for (const [name, i] of [['ram $092F', RAM_RANGE], ['hold $0926', HOLD_RANGE],
    ['hit $0932', HIT_RANGE]]) {
    console.log(`  ${name.padEnd(12)} index ${String(i).padStart(3)} = ${value(i)}`
      + `  = ${(value(i) / 256).toFixed(2)} units, an L1 separation of`
      + ` ${Math.round((value(i) / 256) ** 2 / 2)}`);
  }
  check('the three thresholds are 11, 25 and 13 units of range',
    value(RAM_RANGE) === 2814 && value(HOLD_RANGE) === 6400 && value(HIT_RANGE) === 3328,
    `${value(RAM_RANGE)}, ${value(HOLD_RANGE)}, ${value(HIT_RANGE)}`);

  // Exact equality is the one input that tells the two comparisons apart, so it is the one
  // worth driving. `reach` loads the threshold as Y and the range as X; `hold` and the
  // missile's test load them the other way round.
  const wrong = [];
  for (const c of CLASSES) {
    for (const [delta, label] of [[-1, 'inside'], [0, 'exactly on it'], [1, 'outside']]) {
      const reach = await run(c.reachAt, c.reachExits,
        { [RAMMED]: 0, [field(c.enemy, 'count')]: 3, [field(c.twin, 'count')]: 3 },
        { [GEOM.range]: u24(value(RAM_RANGE) + delta) });
      const rammed = reach.after[RAMMED] === 1;
      if (rammed !== (delta <= 0)) {
        wrong.push(`${c.name} reach ${label}: ${rammed ? 'rammed' : 'not'}`);
      }
      const hold = await run(c.holdAt, c.holdExits, {},
        { [GEOM.range]: u24(value(HOLD_RANGE) + delta) });
      const held = hold.exit === c.holdExits[1];
      if (held !== (delta < 0)) wrong.push(`${c.name} hold ${label}: ${held ? 'held' : 'moved'}`);
    }
  }
  check('reach fires at or inside its threshold; hold only strictly inside its own',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'the difference is which operand is loaded as Y, and equality is what shows it');
}
{
  // What reach does, and what it leaves for someone else to do.
  const wrong = [];
  for (const c of CLASSES) {
    const r = await run(c.reachAt, c.reachExits,
      { [RAMMED]: 0, [field(c.enemy, 'count')]: 5, [field(c.twin, 'count')]: 5 },
      { [GEOM.range]: 0 });
    if (r.exit !== c.reachExits[0]) wrong.push(`${c.name}: left by ${hx(r.exit, 4)}`);
    if (r.after[RAMMED] !== 1) wrong.push(`${c.name}: $0942 = ${r.after[RAMMED]}`);
    if (r.after[field(c.enemy, 'count')] !== 0 || r.after[field(c.twin, 'count')] !== 0) {
      wrong.push(`${c.name}: the pair is still on`);
    }
  }
  check('a ram sets $0942, switches the enemy pair off, and then calls an explosion routine',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `stopped at the JSR, which is ${CLASSES.map((c) => hx(c.explode, 4)).join(', ')}`
        + ' - not ported, so the harness stops before it');
}

// --- the enemy's movement ----------------------------------------------------------------------
console.log('\n=== the enemy\'s movement ===');
{
  const wrong = [];
  let moved = 0;
  for (const c of CLASSES) {
    for (const heading of [0, 32, 64, 100, 128, 192, 255]) {
      for (const [x, z] of [[0, 0], [100 * 256, -200 * 256], [700000, 300000]]) {
        const r = await run(c.moveAt, [c.moveExit],
          { [field(c.enemy, 'heading')]: heading },
          { [c.enemyPos[0]]: u24(x), [c.enemyPos[1]]: u24(z) });
        if (r.after[0x0949] !== heading) wrong.push(`${c.name}: $0949 = ${r.after[0x0949]}`);
        // The coordinate the renderer sees is the position's top two bytes, in both records.
        for (const [index, name] of [[c.enemyPos[0], 'x'], [c.enemyPos[1], 'z']]) {
          for (const o of [c.enemy, c.twin]) {
            const lo = r.after[field(o, name)], hi = r.after[field(o, name) + 1];
            if (lo !== r.after[0x9800 + index + 1] || hi !== r.after[0x9800 + index + 2]) {
              wrong.push(`${c.name} ${name} on object ${o}: ${lo},${hi}`);
            }
          }
        }
        if (ent(r.after, c.enemyPos[0]) !== x || ent(r.after, c.enemyPos[1]) !== z) moved++;
      }
    }
  }
  check('it saves the heading, steps, wraps, and publishes X and Z to both records',
    wrong.length === 0 && moved > 40, wrong.slice(0, 3).join('; ')
      || `${moved} of 63 cases actually moved - the rest are headings whose component is zero`);

  // Y is never touched, which is what makes an enemy's altitude a spawn-time property.
  const before = await run(CLASSES[0].moveAt, [CLASSES[0].moveExit],
    { [field(1, 'heading')]: 64, [field(1, 'y')]: 0x11, [field(1, 'y') + 1]: 0x22 });
  check('and never touches Y, so an enemy\'s altitude is whatever its spawn set',
    before.after[field(1, 'y')] === 0x11 && before.after[field(1, 'y') + 1] === 0x22,
    'only the X and Z operands are published');

  // The wrap, provoked. One pair per pass at most, which the shared function relies on.
  const bounds = {};
  for (const [name, a] of [['maxX', 0x08F2], ['minX', 0x08F3], ['maxZ', 0x08F4],
    ['minZ', 0x08F5]]) bounds[name] = VARS[a - 0x08F2];
  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const bv = (i) => s24(tab[i] | (tab[i + 1] << 8) | (tab[i + 2] << 16));
  // The step runs BEFORE the wrap, so a heading with a component on the axis under test can
  // pull the position back inside and the wrap never fires - which is how the first version
  // of this check "found" the Z wrap missing. Heading 0 has no X component and heading 64 no
  // Z component, so each axis is driven with the other one's heading.
  const wraps = [];
  for (const [label, heading, x, z, want, at] of [
    ['below minX', 0, bv(bounds.minX) - 5000, 0, bv(bounds.maxX), CLASSES[0].enemyPos[0]],
    ['above maxX', 0, bv(bounds.maxX) + 5000, 0, bv(bounds.minX), CLASSES[0].enemyPos[0]],
    ['below minZ', 64, 0, bv(bounds.minZ) - 5000, bv(bounds.maxZ), CLASSES[0].enemyPos[1]],
    ['above maxZ', 64, 0, bv(bounds.maxZ) + 5000, bv(bounds.minZ), CLASSES[0].enemyPos[1]],
  ]) {
    const r = await run(CLASSES[0].moveAt, [CLASSES[0].moveExit],
      { [field(1, 'heading')]: heading },
      { [CLASSES[0].enemyPos[0]]: u24(x), [CLASSES[0].enemyPos[1]]: u24(z) });
    wraps.push(ent(r.after, at) === want ? label : `${label} FAILED (${ent(r.after, at)})`);
  }
  check('all four wraps fire in the machine, at the same bounds the ship uses',
    wraps.every((w) => !w.includes('FAILED')), wraps.join(', '));
}

// --- the missile -------------------------------------------------------------------------------
console.log('\n=== the missile\'s flight ===');
{
  const wrong = [];
  for (const c of CLASSES) {
    // Not up: the whole block is skipped and nothing at all changes.
    const off = await run(c.missileAt, [c.missileExit], { [field(c.missile, 'count')]: 0 });
    if (Object.keys(off.changed).length !== 0) {
      wrong.push(`${c.name}: ${Object.keys(off.changed).length} bytes changed with it off`);
    }
    // Up: it steps by the stored step, with no $1AE8 and no wrap.
    const stepX = 3 * 256, stepZ = -7 * 256;
    const r = await run(c.missileAt, [c.missileExit],
      { [field(c.missile, 'count')]: 5, [HIT]: 0 },
      { [c.missilePos[0]]: u24(400 * 256), [c.missilePos[1]]: u24(900 * 256),
        [c.missileStep[0]]: u24(stepX), [c.missileStep[1]]: u24(stepZ),
        [VAR.posX]: 0, [VAR.posZ]: 0 });
    if (ent(r.after, c.missilePos[0]) !== 400 * 256 + stepX
      || ent(r.after, c.missilePos[1]) !== 900 * 256 + stepZ) {
      wrong.push(`${c.name}: stepped to ${ent(r.after, c.missilePos[0])},`
        + ` ${ent(r.after, c.missilePos[1])}`);
    }
    if (r.after[0x0949] !== r.seeded[0x0949]) wrong.push(`${c.name}: it touched $0949`);
    // It is a long way from the ship, so no hit, and the missile stays up.
    if (r.after[HIT] !== 0 || r.after[field(c.missile, 'count')] !== 5) {
      wrong.push(`${c.name}: a distant missile registered a hit`);
    }
  }
  check('a missile adds its stored step - no $1AE8, no wrap - and publishes to both records',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'its step was worked out once, at launch');

  // The hit, and what it overwrites on the way.
  const bad = [];
  for (const c of CLASSES) {
    const r = await run(c.missileAt, [c.missileExit],
      { [field(c.missile, 'count')]: 5, [field(c.missileTwin, 'count')]: 5, [HIT]: 0 },
      { [c.missilePos[0]]: 0, [c.missilePos[1]]: 0,
        [c.missileStep[0]]: 0, [c.missileStep[1]]: 0,
        [VAR.posX]: 0, [VAR.posZ]: 0, [GEOM.range]: u24(0x7FFFFF) });
    if (r.after[HIT] !== 1) bad.push(`${c.name}: $0941 = ${r.after[HIT]}`);
    if (r.after[field(c.missile, 'count')] !== 0
      || r.after[field(c.missileTwin, 'count')] !== 0) {
      bad.push(`${c.name}: the missile is still up after a hit`);
    }
    if (ent(r.after, GEOM.range) === 0x7FFFFF) bad.push(`${c.name}: it did not recompute $090A`);
    // And the argument slots now hold the missile and the ship, not whatever was there.
    if (ent(r.after, GEOM.bX) !== 0 || ent(r.after, GEOM.bZ) !== 0) {
      bad.push(`${c.name}: $092D/$092E are not the ship`);
    }
  }
  check('a missile on top of the ship sets $0941 and switches itself off',
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'and it overwrites $090A and all four of $1C3D\'s argument slots on the way');
}

// --- the count nothing in the binary decrements ------------------------------------------------
console.log('\n=== the object count, settled ===');
{
  // DISK_TRUTH had the handler's decrement as read off the code and never seen to happen.
  // It happens. Watching one address and noting the PC at the moment it moves says where.
  await a2.ev(`(() => {
    window.M.whoWrites = (addr, value, hits, table) => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const was = rd(addr);
      const snapTab = []; for (let a = 0x9800; a < 0x98F3; a++) snapTab.push(rd(a));
      for (const [i, v] of Object.entries(table || {})) {
        const n = Number(i);
        wr(0x9800 + n, v & 0xff);
        wr(0x9801 + n, (v >> 8) & 0xff);
        wr(0x9802 + n, (v >> 16) & 0xff);
      }
      wr(addr, value);
      let prev = value; const events = [];
      for (let slice = 0; slice < 40000 && events.length < hits; slice++) {
        cpu.stepCyclesDebug(120, () => {
          const v = rd(addr);
          if (v !== prev) { events.push([prev, v, cpu.getPC()]); prev = v; return true; }
        });
      }
      wr(addr, was);
      for (let a = 0x9800; a < 0x98F3; a++) wr(a, snapTab[a - 0x9800]);
      return events;
    };
    return 'ok';
  })()`);
  // Object 4 is a missile, and a missile that is up flies: the block above would reach the
  // ship on the second pass and store a zero over the count, which is how two earlier
  // versions of this check ended after two events. So it is parked a long way out with a
  // zero step, where its own hit test cannot fire and only the renderer touches it.
  const far = { [CLASSES[0].missilePos[0]]: u24(2000 * 256),
    [CLASSES[0].missilePos[1]]: u24(1200 * 256),
    [CLASSES[0].missileStep[0]]: 0, [CLASSES[0].missileStep[1]]: 0 };
  const events = JSON.parse(await a2.ev(
    `JSON.stringify(window.M.whoWrites(${field(4, 'count')}, 20, 10,`
    + ` ${JSON.stringify(far)}))`));
  console.log('  a count of 20 on object 4: '
    + events.map(([o, n, pc]) => `${o} to ${n} at ${hx(pc, 4)}`).join(', '));
  const where = [...new Set(events.map(([, , pc]) => pc))];
  check('a count comes down by one per render, from inside A2-3D2 and nowhere in .OBJ0',
    events.length >= 8 && events.every(([o, n]) => n === o - 1)
      && where.length === 1 && where[0] >= 0x6000 && where[0] <= 0x80FA,
    `${events.length} steps, every one a decrement at ${hx(where[0], 4)} - so the 20 the`
      + ' dispatch writes is twenty RENDERS, and expiry is the renderer\'s business');

  // But $FF is not a lifetime. The objects that are permanently drawn sit at 255 and the
  // handler leaves them there, which is how a count serves as both a switch and a timer.
  const held = [];
  for (let p = 0; p < 6; p++) {
    const row = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x80FB, 0x82E6))'));
    held.push([1, 2, 12, 13, 14].map((i) => row[field(i, 'count') - 0x80FB]).join(','));
    await a2.ev('(() => { window.M.cpu.stepCyclesDebug(340000, () => {}); return 1; })()');
  }
  check('except $FF, which the handler leaves alone - that is how a count is also a switch',
    new Set(held).size === 1 && held[0] === '255,255,255,255,255',
    `the five objects drawn every pass hold ${held[0]} over six passes, undecremented`);

  // And the binary never decrements a count, which the listing confirms: the INC and DEC it
  // does contain are the dispatch's turns, which are headings.
  const touched = disasmRange(image, obj.addr, obj.addr + obj.len)
    .filter((l) => l.mode === 'abs' && /^(DEC|INC)$/.test(l.op))
    .map((l) => l.bytes[1] | (l.bytes[2] << 8))
    .filter((a) => (a >= 0x8123 && a < 0x81C0) || (a >= 0x8247 && a < 0x82E4));
  const counts = [...Array(24).keys()].map((i) => field(i, 'count'));
  const headings = [...Array(24).keys()].map((i) => field(i, 'heading'));
  check('and the binary never increments or decrements a count - only headings',
    touched.length > 0 && touched.every((a) => headings.includes(a))
      && !touched.some((a) => counts.includes(a)),
    `${touched.length} sites, all of them object headings`
      + ` (${[...new Set(touched)].map((a) => hx(a, 4)).join(', ')}), which is the dispatch`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
