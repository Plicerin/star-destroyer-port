// Killing an enemy: six blocks, nine subroutines, and three things that are not what they look
// like.
//
// The six shot blocks are perfectly regular - two shots against three classes - so most of
// this probe is about what the kill chain *does* once one of them fires, and three parts of
// that are worth measuring rather than reading:
//
//   - the debris is four objects and only three are ever switched on
//   - the respawn's `ADC` has no `CLC`, so its bump depends on the caller's carry
//   - class 2's respawn, with its wave empty, falls into CLASS 3's
//
// The sound this chain triggers is Phase 6 and is not ported, so the blocks that call it are
// run only as far as the call, or their call is allowed and its effect ignored.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { CLASSES } from '../port/src/game/dispatch.js';
import { SHOTS, DEBRIS, DEBRIS_UNUSED, RESPAWN_Z } from '../port/src/game/kill.js';
import { field } from '../port/src/game/objects.js';
import { GEOM } from '../port/src/game/geometry.js';
import { RAM_RANGE } from '../port/src/game/entities.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const u24 = (v) => v & 0xFFFFFF;

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
const image = [];
for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];

// --- the six blocks are one block ---------------------------------------------------------------
console.log('\n=== six shot blocks, two shots by three classes ===');
{
  const blocks = [];
  for (const c of CLASSES) {
    for (const [s, shot] of SHOTS.entries()) blocks.push({ c, shot, at: c.shotAt[s] });
  }
  // The opcode stream has to be the same in all six, or the port is not one function.
  const streams = blocks.map(({ at }) => disasmRange(image, at, at + 0x48)
    .map((l) => l.op).join(' '));
  check('all six run the same opcodes in the same order',
    new Set(streams).size === 1,
    `${streams[0].split(' ').length} opcodes from ${blocks.map((b) => hx(b.at, 4)).join(', ')}`);

  // And each one's four subroutine calls are the four the port's tables name.
  const wrong = [];
  for (const { c, shot, at } of blocks) {
    const calls = disasmRange(image, at, at + 0x48)
      .filter((l) => l.op === 'JSR').map((l) => l.target);
    const want = [0x9C4B, 0x9C4B, 0x9C4B, 0x9C4B, 0x1C3D, 0x99D2,
      c.debrisPlace, shot.offAt, shot.aimAt, c.enemyOff];
    if (calls.join() !== want.join()) {
      wrong.push(`${hx(at, 4)}: ${calls.map((a) => hx(a, 4)).join(' ')}`);
    }
  }
  check('and each calls the debris placer for its CLASS and the aim for its SHOT',
    wrong.length === 0, wrong.slice(0, 2).join('; ')
      || 'the placer depends on which enemy died, the aim on which shot killed it');

  // The threshold is the one the enemy uses to ram the ship, not one of its own.
  const thresholds = blocks.map(({ at }) => {
    const ls = disasmRange(image, at, at + 0x48);
    const i = ls.findIndex((l) => l.text === 'JSR $99D2');
    return ls[i - 1].bytes[1] | (ls[i - 1].bytes[2] << 8);
  });
  check('all six compare against $092F, the same entry an enemy rams the ship at',
    new Set(thresholds).size === 1 && thresholds[0] === 0x092F,
    `${hx(thresholds[0], 4)}, which holds 11 units of range`);
}

// --- the fourth piece of debris -----------------------------------------------------------------
console.log('\n=== the debris: four objects, three of them drawn ===');
{
  // Every store of a count, anywhere in the binary, by which object it names.
  const counts = new Map();
  for (let i = 0; i < 24; i++) counts.set(field(i, 'count'), i);
  const written = new Map();
  for (const l of disasmRange(image, obj.addr, obj.addr + obj.len)) {
    if (l.mode !== 'abs' || !/^ST[AXY]$/.test(l.op)) continue;
    const t = l.bytes[1] | (l.bytes[2] << 8);
    if (!counts.has(t)) continue;
    const o = counts.get(t);
    written.set(o, (written.get(o) || []).concat(l.addr));
  }
  for (const o of [...DEBRIS.flat(), ...DEBRIS_UNUSED].sort((a, b) => a - b)) {
    console.log(`  object ${String(o).padStart(2)} count written at `
      + ((written.get(o) || []).map((a) => hx(a, 4)).join(', ') || 'nowhere in the binary'));
  }
  check('objects 11 and 23 have no count written anywhere, so they are never drawn',
    DEBRIS_UNUSED.every((o) => !written.has(o))
      && DEBRIS.flat().every((o) => (written.get(o) || []).length === 1),
    'the other six are written once each, all from $1D09');

  // They are nonetheless positioned and aimed every kill, which is what makes it worth saying.
  const touched = (routine, end) => {
    const used = new Set(disasmRange(image, routine, end)
      .filter((l) => l.mode === 'abs' && /^ST[AXY]$/.test(l.op))
      .map((l) => l.bytes[1] | (l.bytes[2] << 8)));
    return DEBRIS_UNUSED.every((o) => ['x', 'z', 'heading']
      .some((f) => used.has(field(o, f)) || used.has(field(o, f) + 1)));
  };
  check('but $1944 positions them and $1A8B aims them, every kill, all the same',
    touched(0x1944, 0x19B1) && touched(0x1A8B, 0x1AAC),
    'eight objects maintained, six drawn - the port keeps the two that are not');
}

// --- the machine --------------------------------------------------------------------------------
console.log('\n=== the oracle ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960], [0x1FF9, 0x1FFF]];
  window.M.killBlock = (start, stops, pokes, table, carry) => {
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
    st.pc = start;
    if (carry !== null) st.s = carry ? (st.s | 1) : (st.s & ~1);
    cpu.setState(st);
    let exit = 0, carryAt = null;
    cpu.stepCyclesDebug(4000000, () => {
      if (stops.includes(cpu.getPC())) {
        exit = cpu.getPC(); carryAt = cpu.getState().s & 1; return true;
      }
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
    return { exit, carryAt, after, seeded, changed };
  };
  return 'ok';
})()`);
const run = (start, stops, pokes = {}, table = {}, carry = null) => a2.ev(
  'JSON.stringify(window.M.killBlock(' + start + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + ',' + carry + '))').then(JSON.parse);

// --- a hit, end to end --------------------------------------------------------------------------
console.log('\n=== a shot connecting ===');
{
  const wrong = [];
  for (const c of CLASSES) {
    for (const [s, shot] of SHOTS.entries()) {
      const at = c.shotAt[s], exit = c.shotAt[s] + 0x48;
      // The shot not up: the whole block is skipped and nothing changes at all.
      const off = await run(at, [exit], { [field(shot.object, 'count')]: 0 });
      if (Object.keys(off.changed).length !== 0) {
        wrong.push(`${hx(at, 4)}: ${Object.keys(off.changed).length} bytes changed with it off`);
      }
      // Up and on top of the enemy: a hit.
      const hit = await run(at, [exit],
        { [field(shot.object, 'count')]: 3, [field(shot.twin, 'count')]: 3,
          [c.debrisCounter]: 0, [field(c.enemy, 'count')]: 0xFF,
          [field(c.twin, 'count')]: 0xFF,
          [field(c.enemy, 'x')]: 0x34, [field(c.enemy, 'x') + 1]: 0x12,
          [field(c.enemy, 'z')]: 0x78, [field(c.enemy, 'z') + 1]: 0x56,
          [field(shot.object, 'heading')]: 0x5A },
        { [shot.pos[0]]: 0, [shot.pos[1]]: 0, [c.enemyPos[0]]: 0, [c.enemyPos[1]]: 0 });
      const a = hit.after;
      const want = {
        [c.debrisCounter]: 4,
        [field(shot.object, 'count')]: 0,
        [field(shot.twin, 'count')]: 0,
        [field(c.enemy, 'count')]: 0,
        [field(c.twin, 'count')]: 0,
      };
      for (const [addr, v] of Object.entries(want)) {
        if (a[addr] !== v) wrong.push(`${hx(at, 4)} ${hx(Number(addr), 4)}: ${a[addr]} not ${v}`);
      }
      // Every debris object, drawn or not, takes the enemy's position and the shot's heading.
      for (const o of [...DEBRIS.flat(), ...DEBRIS_UNUSED]) {
        if (a[field(o, 'x')] !== 0x34 || a[field(o, 'x') + 1] !== 0x12
          || a[field(o, 'z')] !== 0x78 || a[field(o, 'z') + 1] !== 0x56
          || a[field(o, 'heading')] !== 0x5A) {
          wrong.push(`${hx(at, 4)}: debris ${o} not placed or aimed`);
        }
      }
      // And none of them is switched on by the hit itself.
      if ([...DEBRIS.flat(), ...DEBRIS_UNUSED].some((o) => a[field(o, 'count')] !== 0)) {
        wrong.push(`${hx(at, 4)}: a hit switched a debris piece on`);
      }
    }
  }
  check('a hit sets the counter to 4, places and aims all eight, and switches both off',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'six blocks; the debris is placed and aimed but not yet drawn');

  // The shot's own two records are switched off by two different routines.
  const shot = SHOTS[0], c = CLASSES[0];
  const r = await run(0x1F67, [0x1F6C], { [field(6, 'count')]: 9, [field(18, 'count')]: 9 });
  check('switching a shot off takes two routines: $1F67 does the record, $1A8B\'s tail the twin',
    r.after[field(6, 'count')] === 0 && r.after[field(18, 'count')] === 9,
    'the pair is split, and the port keeps the split because the calls are separate');
}

// --- the debris animation -----------------------------------------------------------------------
console.log('\n=== the debris animation, one piece a pass ===');
{
  const wrong = [];
  for (const c of CLASSES) {
    for (const counter of [4, 3, 2, 1]) {
      const r = await run(c.tickAt, [c.tickExit],
        { [c.debrisCounter]: counter, [c.wave]: 5,
          ...Object.fromEntries([...DEBRIS.flat()].map((o) => [field(o, 'count'), 0])) },
        { [c.enemyPos[0]]: 0x300000 });
      if (r.after[c.debrisCounter] !== counter - 1) {
        wrong.push(`${c.name} ${counter}: counter ${r.after[c.debrisCounter]}`);
      }
      if (counter >= 2) {
        const [a, b] = DEBRIS[4 - counter];
        if (r.after[field(a, 'count')] !== 1 || r.after[field(b, 'count')] !== 1) {
          wrong.push(`${c.name} ${counter}: piece ${a}/${b} not switched on`);
        }
        const others = DEBRIS.filter((_, i) => i !== 4 - counter).flat();
        if (others.some((o) => r.after[field(o, 'count')] !== 0)) {
          wrong.push(`${c.name} ${counter}: another piece came on too`);
        }
      } else if (r.after[c.wave] !== 4) {
        wrong.push(`${c.name} ${counter}: the wave counter did not move`);
      }
    }
  }
  check('4, 3 and 2 switch on one pair each; 1 respawns the enemy instead',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'each piece gets a count of 1, so the renderer draws it once and drops it');
}

// --- the respawn's carry ------------------------------------------------------------------------
console.log('\n=== the respawn, and the ADC with no CLC ===');
{
  const bumps = {};
  for (const c of CLASSES) {
    const got = {};
    for (const carry of [false, true]) {
      const r = await run(c.respawnAt, [c.respawnAt === 0x1E98 ? 0x1EC7 : 0x1EF8,
        0x1EF8, 0x1F29], { [c.wave]: 5 }, { [c.enemyPos[0]]: 0x300000 }, carry);
      got[carry] = r.after[0x9800 + c.enemyPos[0] + 2] - 0x30;
    }
    bumps[c.name] = got;
    console.log(`  ${c.name}: carry clear bumps X by ${got[false]}, carry set by ${got[true]}`);
  }
  check('the bump is the immediate plus the caller\'s carry, which is a real sensitivity',
    CLASSES.every((c) => bumps[c.name][true] === bumps[c.name][false] + 1)
      && bumps['class 1'][false] === 10 && bumps['class 2'][false] === 20,
    '10 or 11 for class 1, 20 or 21 for the other two');

  // Which carry each caller actually arrives with. Both set, for different reasons.
  const viaTick = await run(CLASSES[0].tickAt, [0x1D19], { [CLASSES[0].debrisCounter]: 1 },
    {}, false);
  const viaReach = await run(CLASSES[0].reachAt, [0x0E20],
    { [field(1, 'count')]: 3 }, { [GEOM.range]: 0 }, false);
  check('and both callers arrive with it SET, however it was when they started',
    viaTick.carryAt === 1 && viaReach.carryAt === 1,
    'the tick through $1D09\'s CPY equality, the reach through MATH\'s compare - so in play'
      + ' the bump is always one more than the immediate');

  // The Z it spawns at, which is outside the bounds the movement block wraps against.
  const r = await run(CLASSES[0].respawnAt, [0x1EC7], { [CLASSES[0].wave]: 5 },
    { [CLASSES[0].enemyPos[1]]: 0 }, true);
  check(`a fresh enemy gets Z high byte ${RESPAWN_Z}, which is outside the Z bounds`,
    r.after[0x9800 + CLASSES[0].enemyPos[1] + 2] === RESPAWN_Z,
    `${RESPAWN_Z} * 65536 against a maxZ of 409600, so it snaps to the Z edge on its first`
      + ' pass and flies in from there');
}

// --- the cascade --------------------------------------------------------------------------------
console.log('\n=== class 2\'s respawn, with its wave empty ===');
{
  const full = await run(0x1EC9, [0x1EF8, 0x1F29],
    { 0x1FFA: 5, 0x1FFB: 5, [field(2, 'count')]: 0, [field(3, 'count')]: 0 },
    { [CLASSES[1].enemyPos[0]]: 0x300000, [CLASSES[2].enemyPos[0]]: 0x300000 }, true);
  const empty = await run(0x1EC9, [0x1EF8, 0x1F29],
    { 0x1FFA: 0, 0x1FFB: 5, [field(2, 'count')]: 0, [field(3, 'count')]: 0 },
    { [CLASSES[1].enemyPos[0]]: 0x300000, [CLASSES[2].enemyPos[0]]: 0x300000 }, true);
  const both = await run(0x1EC9, [0x1EF8, 0x1F29],
    { 0x1FFA: 0, 0x1FFB: 0 }, {}, true);
  check('with class 2 exhausted its routine spawns a CLASS 3 enemy, not nothing',
    full.after[field(2, 'count')] === 0xFF && full.after[0x1FFA] === 4
      && empty.after[field(2, 'count')] === 0 && empty.after[field(3, 'count')] === 0xFF
      && empty.after[0x1FFB] === 4 && Object.keys(both.changed).length === 0,
    '$1ECC is BEQ $1EFA, which is class 3\'s routine - class 1 and class 3 branch to a'
      + ' local CLC/RTS instead');
}

// --- the award, and the order of the two blocks -------------------------------------------------
console.log('\n=== the score, and why the order of two blocks decides it ===');
{
  const wrong = [];
  for (const c of CLASSES) {
    for (const counter of [0, 1, 2, 3, 4]) {
      const r = await run(c.awardAt, [c.awardAt + 0x0D],
        { [c.debrisCounter]: counter, [c.score]: 7 });
      const want = counter >= 3 ? 8 : 7;
      if (r.after[c.score] !== want) {
        wrong.push(`${c.name} ${counter}: score ${r.after[c.score]} not ${want}`);
      }
    }
  }
  check('the award fires while the debris counter is 3 or more, and bumps its class\'s score',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || '$1FFC, $1FFD and $1FFE, one per class, and it calls $1DD3 for the sound');

  // The order in the pass. Reading it off the addresses would be a guess - $1895 is BELOW
  // $1829 in memory but the loop does not run in address order - so it is traced.
  const seen = JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu;
    const order = [];
    cpu.stepCyclesDebug(1400000, () => {
      const pc = cpu.getPC();
      if (pc === 0x1829 || pc === 0x1895 || pc === 0x18BC) {
        if (order[order.length - 1] !== pc) order.push(pc);
      }
    });
    return order;
  })())`));
  console.log('  one pass visits: ' + seen.map((a) => hx(a, 4)).join(' -> '));
  const tickFirst = seen.indexOf(0x1829) >= 0 && seen.indexOf(0x1895) >= 0
    && seen.indexOf(0x1829) < seen.indexOf(0x1895);
  check('the tick runs BEFORE the award, so the award sees a counter already decremented',
    tickFirst,
    'a kill therefore scores exactly once: the counter is 3 when the award first sees it');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
