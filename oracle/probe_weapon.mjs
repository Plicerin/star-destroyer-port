// The player's weapon: two shots, one button, and a bar that only one of them spends.
//
// Short enough to read, and three things in it are worth measuring rather than reading: which
// slot gets to fire and on what terms, what firing costs, and which object's Y the publish
// writes - because it is not the shot's.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { SHOTS, SHOT_LIFETIME, RELOAD, SHOT_SPEED, PUBLISHED_Y, FIRED }
  from '../port/src/game/weapon.js';
import { MSL, EMPTY } from '../port/src/game/damage.js';
import { field } from '../port/src/game/objects.js';
import { VAR } from '../port/src/game/tables.js';
import { H1 } from '../port/src/game/controls.js';

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
const ls = disasmRange(image, obj.addr, obj.addr + obj.len);

// --- the one-unit cost --------------------------------------------------------------------------
console.log('\n=== the missile bar, charged one unit by a loop that usually takes four ===');
{
  const setup = disasmRange(image, 0x0B26, 0x0B31).map((l) => l.text);
  console.log('  ' + setup.join(' / '));
  check('firing enters $1C89\'s loop at $1C8B with Y already at 4, so it decrements once',
    setup[0] === 'LDX $8209' && setup[1] === 'LDY #$04' && setup[2] === 'JSR $1C8B',
    '$1C89 itself is LDY #$01 at $1C89 and the loop body at $1C8B, so the entry point is the'
      + ' whole difference between taking four and taking one');

  // And nothing else in the binary enters it that way.
  const entries = ls.filter((l) => l.op === 'JSR' && (l.target === 0x1C89 || l.target === 0x1C8B))
    .map((l) => `${hx(l.addr, 4)}->${hx(l.target, 4)}`);
  console.log('  callers: ' + entries.join(', '));
  check('and it is the only call that does - the six damage calls all go to $1C89',
    entries.filter((e) => e.endsWith('$1C8B')).length === 1,
    `${entries.length} calls to the pair, one of them to the body`);
}

// --- the publish's Y ----------------------------------------------------------------------------
console.log('\n=== the publish, and the Y it writes ===');
{
  const wrong = [];
  for (const shot of SHOTS) {
    const body = disasmRange(image, shot.publishAt, shot.publishAt + 0x35);
    const ys = body.filter((l) => l.mode === 'abs' && /^ST[AXY]$/.test(l.op))
      .map((l) => l.bytes[1] | (l.bytes[2] << 8))
      .filter((a) => a === field(shot.object, 'y') || a === field(shot.object, 'y') + 1
        || a === field(shot.publishedY, 'y') || a === field(shot.publishedY, 'y') + 1);
    const own = ys.filter((a) => a === field(shot.object, 'y')
      || a === field(shot.object, 'y') + 1).length;
    const other = ys.filter((a) => a === field(shot.publishedY, 'y')
      || a === field(shot.publishedY, 'y') + 1).length;
    console.log(`  ${hx(shot.publishAt, 4)} writes OBJ${shot.publishedY}.y`
      + ` (${hx(field(shot.publishedY, 'y'), 4)}) ${other} times and OBJ${shot.object}.y`
      + ` (${hx(field(shot.object, 'y'), 4)}) ${own} times`);
    if (own !== 0 || other !== 2) wrong.push(hx(shot.publishAt, 4));
  }
  check('each publish writes an ENEMY MISSILE\'s Y and never the shot\'s own',
    wrong.length === 0, wrong.join(', ')
      || 'object 4 for slot 1 and object 5 for slot 2 - the two the enemy dispatch launches');

  // Does anything else give the player's shots a Y? If not, they keep whatever the scene had.
  const anywhere = ls.filter((l) => l.mode === 'abs' && /^ST[AXY]$/.test(l.op))
    .map((l) => l.bytes[1] | (l.bytes[2] << 8))
    .filter((a) => [6, 7, 18, 19].some((o) => a === field(o, 'y') || a === field(o, 'y') + 1));
  check('and nothing anywhere in the binary writes a player shot\'s Y at all',
    anywhere.length === 0,
    anywhere.length ? anywhere.map((a) => hx(a, 4)).join(', ')
      : 'so a shot flies at whatever height SV DATA gave object 6 and 7');
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
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.weaponRun = (addr, stops, pokes, table, button, sub) => {
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
    return { exit, sounded, after, seeded, changed };
  };
  return 'ok';
})()`);
const run = (addr, stops, pokes = {}, table = {}, button = null, sub = false) => a2.ev(
  'JSON.stringify(window.M.weaponRun(' + addr + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + ',' + button + ',' + sub
  + '))').then(JSON.parse);
const ent = (after, i) => s24(after[0x9800 + i] | (after[0x9800 + i + 1] << 8)
  | (after[0x9800 + i + 2] << 16));

// --- which slot fires, and when -----------------------------------------------------------------
console.log('\n=== two slots, and firing one depends on the other ===');
{
  const table = [];
  const wrong = [];
  for (const [c6, c7] of [[0, 0], [0, 10], [0, 11], [0, 20], [20, 0], [11, 0], [10, 0],
    [5, 5], [20, 20], [10, 10]]) {
    const r = await run(0x0ADB, [0x0B6A],
      { [field(6, 'count')]: c6, [field(7, 'count')]: c7, [MSL]: 244, [FIRED]: 0 },
      {}, true);
    const one = r.after[field(6, 'count')] === SHOT_LIFETIME && c6 !== SHOT_LIFETIME;
    const two = r.after[field(7, 'count')] === SHOT_LIFETIME && c7 !== SHOT_LIFETIME;
    const spent = 244 - r.after[MSL];
    table.push(`${c6}/${c7} -> ${one ? 'slot 1' : two ? 'slot 2' : 'nothing'}`
      + (spent ? ` (-${spent})` : ''));
    // The rule, as the two branches spell it out.
    const wantOne = c6 < 1 && c7 < RELOAD;
    const wantTwo = !wantOne && c7 < 1 && c6 < RELOAD;
    if (one !== wantOne || two !== wantTwo) {
      wrong.push(`${c6}/${c7}: fired ${one ? 1 : two ? 2 : 0}`);
    }
    if (one && spent !== 1) wrong.push(`${c6}/${c7}: slot 1 spent ${spent}`);
    if (two && spent !== 0) wrong.push(`${c6}/${c7}: slot 2 spent ${spent}`);
  }
  console.log('  ' + table.join(', '));
  check('a slot fires only if it is empty and the OTHER is below 11',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'the counts start at 20 and the renderer runs them down, so this is a rate limit'
        + ' expressed through the other barrel');
  check('and slot 1 costs one unit of the missile bar where slot 2 costs nothing',
    wrong.length === 0,
    'measured on every combination above - half the shots are free');
}
{
  // The button, and the empty bar.
  const up = await run(0x0ADB, [0x0B6A],
    { [field(6, 'count')]: 0, [field(7, 'count')]: 0, [MSL]: 244 }, {}, false);
  check('nothing happens with the button up',
    Object.keys(up.changed).length === 0, 'not one byte');

  const empty = await run(0x0ADB, [0x0B6A],
    { [field(6, 'count')]: 0, [field(7, 'count')]: 0, [MSL]: EMPTY, [FIRED]: 0 }, {}, true);
  check('an empty bar plays $1FB2 and fires nothing',
    empty.sounded === 0x1FB2 && empty.after[field(6, 'count')] === 0
      && empty.after[FIRED] === 0,
    'the buzz is the only thing that looks at the bar, so slot 2 firing for free is never'
      + ' checked against it either');
}
{
  // What a launch actually writes.
  const r = await run(0x0ADB, [0x0B6A],
    { [field(6, 'count')]: 0, [field(7, 'count')]: 0, [MSL]: 244, [FIRED]: 0,
      [H1]: 0x3F, [field(4, 'y')]: 0, [field(4, 'y') + 1]: 0 },
    { [VAR.posX]: u24(0x123456), [VAR.posZ]: u24(0x789ABC) }, true);
  const wrong = [];
  const want = {
    [field(6, 'count')]: SHOT_LIFETIME, [field(18, 'count')]: SHOT_LIFETIME,
    [field(6, 'heading')]: 0x3F, [FIRED]: 1,
    [field(4, 'y')]: PUBLISHED_Y & 0xff, [field(4, 'y') + 1]: (PUBLISHED_Y >> 8) & 0xff,
    [field(6, 'x')]: 0x34, [field(6, 'x') + 1]: 0x12,
    [field(6, 'z')]: 0x9A, [field(6, 'z') + 1]: 0x78,
  };
  for (const [a, v] of Object.entries(want)) {
    if (r.after[a] !== v) wrong.push(`${hx(Number(a), 4)}: ${r.after[a]} not ${v}`);
  }
  if (ent(r.after, SHOTS[0].pos[0]) !== 0x123456) wrong.push('the position was not copied');
  check('a launch copies the ship\'s position, takes its heading, and publishes',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `and writes ${PUBLISHED_Y} to OBJ4.y, which is the enemy missile's`);
}

// --- the shot's flight --------------------------------------------------------------------------
console.log('\n=== a shot in flight ===');
{
  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const value = (i) => s24(tab[i] | (tab[i + 1] << 8) | (tab[i + 2] << 16));
  check('a shot has its own speed entry, faster than the ship and the enemy missiles',
    value(SHOT_SPEED) === 309 && value(VAR.speed) === 1280,
    `index ${SHOT_SPEED} = ${value(SHOT_SPEED)} against the ship's ${value(VAR.speed)}`
      + ` and a missile's 383 - all divisors, so a shot covers`
      + ` ${(value(VAR.speed) / value(SHOT_SPEED)).toFixed(1)} times the ground per pass`);

  const wrong = [];
  for (const shot of SHOTS) {
    const off = await run(shot.moveAt, [shot.moveExit], { [field(shot.object, 'count')]: 0 });
    if (Object.keys(off.changed).length !== 0) {
      wrong.push(`${hx(shot.moveAt, 4)}: ${Object.keys(off.changed).length} bytes with it down`);
    }
    for (const heading of [0, 32, 64, 128, 192]) {
      const r = await run(shot.moveAt, [shot.moveExit],
        { [field(shot.object, 'count')]: 7, [field(shot.object, 'heading')]: heading },
        { [shot.pos[0]]: u24(100 * 256), [shot.pos[1]]: u24(-200 * 256) });
      // The step goes back over $0915/$0916, which is the ship's, and the shot moves by it.
      const stepX = ent(r.after, VAR.stepX), stepZ = ent(r.after, VAR.stepZ);
      if (ent(r.after, shot.pos[0]) !== 100 * 256 + stepX
        || ent(r.after, shot.pos[1]) !== -200 * 256 + stepZ) {
        wrong.push(`${hx(shot.moveAt, 4)} h=${heading}: moved wrong`);
      }
      // And it does not wrap: nothing stops it leaving the world.
      const far = await run(shot.moveAt, [shot.moveExit],
        { [field(shot.object, 'count')]: 7, [field(shot.object, 'heading')]: 64 },
        { [shot.pos[0]]: u24(786432 + 50000), [shot.pos[1]]: 0 });
      if (ent(far.after, shot.pos[0]) < 786432) {
        wrong.push(`${hx(shot.moveAt, 4)}: it wrapped at the edge of the world`);
      }
    }
  }
  check('both shots step by their own speed, publish, and never wrap',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'and each stores its divided step back over the SHIP\'s step operands on the way');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
