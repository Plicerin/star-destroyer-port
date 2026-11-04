// What an enemy does with a bearing: the dispatch at $0D5B, $116B and $1575.
//
// The range and bearing blocks are three copies of one thing. These three are not: they are
// the same shape with four real differences between them, and every one of the four is the
// sort of detail a port written from one copy would get wrong in the other two. So this probe
// compares them as instruction streams rather than as bytes, and then drives all three in the
// machine over the same inputs.
//
// They are inline, ending in a JMP to the next region, so they are measured by setting the PC
// and running to that region's first instruction - and because they write the display list
// and the binary's own state rather than just MATH's table, the harness here watches
// $9800-$98F2, $80FB-$82E5 and $0900-$095F together.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { VARS, VAR } from '../port/src/game/tables.js';
import { field } from '../port/src/game/objects.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
const at = (a) => obj.data[a - obj.addr];
/** A sparse image of the binary, for the disassembler. */
const image = [];
for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];

/** The three copies: where each starts and where its JMPs land. */
const COPIES = [
  { name: 'class 1', at: 0x0D5B, exit: 0x0E05, cool: 0x0938, coolDownAt: 0x0E23,
    coolDownExits: [0x0E2F, 0x0E3D], enemy: 1, twin: 13, missile: 4, missileTwin: 16,
    sound: 0x0943 },
  { name: 'class 2', at: 0x116B, exit: 0x120F, cool: 0x0939, coolDownAt: 0x122D,
    coolDownExits: [0x1239, 0x1247], enemy: 2, twin: 14, missile: 5, missileTwin: 17,
    sound: 0x0944 },
  { name: 'class 3', at: 0x1575, exit: 0x1619, cool: 0x093A, coolDownAt: 0x1637,
    coolDownExits: [0x1643, 0x1652], enemy: 3, twin: 15, missile: 5, missileTwin: 17,
    sound: 0x0945 },
];

// --- the three copies, as instruction streams --------------------------------------------------
console.log('\n=== three copies of the dispatch, and the four ways they differ ===');
const listings = COPIES.map((c) => disasmRange(image, c.at, c.exit));
{
  console.log('  lengths: ' + COPIES.map((c, i) =>
    `${c.name} ${c.exit - c.at} bytes / ${listings[i].length} instructions`).join(', '));

  // Copy 1 carries a redundant LDA/STA of the heading to itself in each turn path, which is
  // the whole of its six extra bytes.
  const redundant = listings[0].filter((l, i) => l.op === 'STA' && l.mode === 'abs'
    && listings[0][i - 1] && listings[0][i - 1].text === l.text.replace('STA', 'LDA'));
  check('class 1 is six bytes longer, and it is two stores of the heading to itself',
    COPIES[0].exit - COPIES[0].at - (COPIES[1].exit - COPIES[1].at) === 6
      && redundant.length === 2,
    redundant.map((l) => `${hx(l.addr, 4)} ${l.text}`).join(', ') || 'none found');

  // With those dropped, the three streams are the same opcodes in the same order - except
  // for one, which is the typo below.
  const stream = (ls, drop) => ls.map((l) => l.op)
    .filter((_, i) => !drop.includes(ls[i].addr)).join(' ');
  const a = stream(listings[0], redundant.map((l) => l.addr));
  const b = stream(listings[1], []);
  const c3 = stream(listings[2], []);
  const firstDiff = (x, y) => {
    const xs = x.split(' '), ys = y.split(' ');
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      if (xs[i] !== ys[i]) return `instruction ${i}: ${xs[i]} against ${ys[i]}`;
    }
    return '';
  };
  check('and then all three run the same opcodes in the same order, bar one',
    a === b && firstDiff(b, c3) === 'instruction 31: STX against STA',
    `classes 1 and 2 identical over ${a.split(' ').length} opcodes; class 3 differs at`
      + ` ${firstDiff(b, c3) || 'nowhere'}`);
}
{
  // Difference 1: the typo. LDX #$01 then STA, so the 1 never reaches the flag.
  const dead = disasmRange(image, 0x15C9, 0x15CE);
  console.log('  class 3 at $15C9: ' + dead.map((l) => l.text).join(' / '));
  check('class 3 loads 1 into X and then stores the ACCUMULATOR, so the LDX is dead code',
    dead[0].text === 'LDX #$01' && dead[1].op === 'STA' && dead[1].text === 'STA $0945'
      && at(0x0DB5) === 0xA2 && at(0x0DB7) === 0x8E && at(0x11BF) === 0xA2
      && at(0x11C1) === 0x8E,
    'classes 1 and 2 are LDX #$01 / STX; class 3 is LDX #$01 / STA');

  // Difference 2: the cooldown each class sets.
  const frames = [[0x0DBA, 0x0938], [0x11C4, 0x0939], [0x15CE, 0x093A]]
    .map(([lda]) => at(lda + 1));
  console.log('  cooldown frames: ' + COPIES.map((c, i) => `${c.name} ${frames[i]}`).join(', '));
  check('class 3 reloads for 15 frames where the other two reload for 20',
    frames[0] === 0x14 && frames[1] === 0x14 && frames[2] === 0x0F,
    `${frames.join(', ')}`);

  // Difference 3: which missile, and the sharing. The gate is where the two BEQs point, not
  // at a fixed offset - class 1 is six bytes longer before it.
  const gate = COPIES.map((c, i) => {
    // Three BEQs: one skips the cooldown branch, and TWO point at the fire label - which is
    // how the fire label is identified without counting bytes.
    const targets = listings[i].filter((l) => l.op === 'BEQ').map((l) => l.target);
    const fire = targets.find((t, k) => targets.indexOf(t) !== k);
    const instr = listings[i].find((l) => l.addr === fire);
    return instr.bytes[1] | (instr.bytes[2] << 8);
  });
  check('classes 2 and 3 gate on the same missile count, so they share object 5',
    gate[1] === gate[2] && gate[0] !== gate[1]
      && gate[0] === field(4, 'count') && gate[1] === field(5, 'count'),
    `class 1 tests ${hx(gate[0], 4)} (object 4), classes 2 and 3 both test`
      + ` ${hx(gate[1], 4)} (object 5)`);

  // Difference 4: where the cooldown branch goes. Class 1 lands on the increment path and
  // the other two on the decrement path, which is why the same code turns +2 and -3.
  const target = COPIES.map((c) => at(c.at + 6) | (at(c.at + 7) << 8));
  const downAt = [0x0D90, 0x119D, 0x15A7];
  const upAt = [0x0D7E, 0x118E, 0x1598];
  check('class 1\'s cooldown branch lands on the increment path, the other two on the decrement',
    target[0] === upAt[0] && target[1] === downAt[1] && target[2] === downAt[2],
    `JMP targets ${target.map((t) => hx(t, 4)).join(', ')}`);
}
{
  // The display-list model the port uses, checked against the addresses the code really
  // touches rather than against the symbol table that generated the listing.
  const wrong = [];
  for (const c of COPIES) {
    const want = {
      heading: field(c.enemy, 'heading'), twin: field(c.twin, 'heading'),
      count: field(c.missile, 'count'), twinCount: field(c.missileTwin, 'count'),
      mHeading: field(c.missile, 'heading'), mY: field(c.missile, 'y'),
    };
    const used = new Set(disasmRange(image, c.at, c.exit)
      .filter((l) => l.mode === 'abs' && /^(LD|ST|CMP|INC|DEC)/.test(l.op))
      .map((l) => l.bytes[1] | (l.bytes[2] << 8)));
    for (const [name, addr] of Object.entries(want)) {
      if (!used.has(addr)) wrong.push(`${c.name} ${name} ${hx(addr, 4)} is never touched`);
    }
    if (!used.has(want.mY + 1)) wrong.push(`${c.name} mY+1 is never touched`);
  }
  check('objects.js lays the records out as the code addresses them: 13 bytes, heading at +10',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'every heading, count, missile heading and missile Y the three copies name');
}

// --- the machine -------------------------------------------------------------------------------
console.log('\n=== the oracle ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

/**
 * Run a block of game code, with the table, the display list and the state all settable.
 *
 * `stops` is a list because the cooldown block has two exits. Everything inside the three
 * watched windows is restored afterwards, along with zero page and the CPU.
 */
await a2.ev(`(() => {
  const WATCH = [[0x9800, 0x98F3], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.gameBlock = (start, stops, pokes, table) => {
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
    let exit = 0, instr = 0;
    cpu.stepCyclesDebug(4000000, () => {
      instr++;
      if (stops.includes(cpu.getPC())) { exit = cpu.getPC(); return true; }
    });
    const changed = {}, after = {};
    for (const [lo, hi] of WATCH) {
      for (let a = lo; a < hi; a++) {
        const v = rd(a);
        after[a] = v;
        if (v !== seeded[a]) changed[a] = v;
      }
    }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { exit, instr, changed, after, seeded };
  };
  return 'ok';
})()`);
const run = (start, stops, pokes = {}, table = {}) => a2.ev(
  'JSON.stringify(window.M.gameBlock(' + start + ',' + JSON.stringify(stops) + ','
  + JSON.stringify(pokes) + ',' + JSON.stringify(table) + '))').then(JSON.parse);

const BEARING = VARS[0x090B - 0x08F2];
const MISSILE_SPEED = VARS[0x0919 - 0x08F2];
/** Set the bearing entry so its middle byte - what `CMP $9801,Y` reads - is `unit`. */
const bearingOf = (unit) => ({ [BEARING]: (unit & 0xff) << 8 });
/** Clear both missiles and both cooldowns, so a case starts from a known machine. */
const clear = (c, extra = {}) => ({
  [field(4, 'count')]: 0, [field(5, 'count')]: 0,
  [field(16, 'count')]: 0, [field(17, 'count')]: 0,
  [c.sound]: 0, [c.cool]: 0, ...extra,
});

// --- the turn ----------------------------------------------------------------------------------
console.log('\n=== the turn: a probe, not a comparison ===');
{
  const wrong = [];
  let fired = 0, up = 0, down = 0, kept = 0;
  for (const c of COPIES) {
    for (const t of [0, 1, 50, 100, 128, 200, 254, 255]) {
      for (const h of [0, 1, 2, 49, 50, 99, 100, 101, 127, 128, 129, 199, 254, 255]) {
        const r = await run(c.at, [c.exit],
          clear(c, { [field(c.enemy, 'heading')]: h, [field(c.twin, 'heading')]: 0x5A }),
          bearingOf(t));
        const got = r.after[field(c.enemy, 'heading')];
        const twin = r.after[field(c.twin, 'heading')];
        const launched = r.after[field(c.missile, 'count')] !== 0;
        // The closed description of the block.
        let want, wantTwin = 0x5A, wantFire = false;
        if (h === t) { want = h; wantFire = true; }
        else if (((h + 1) & 0xff) === t) { want = t; wantFire = true; kept++; }
        else if (((h + 1) & 0xff) > t) { want = (h - 2) & 0xff; wantTwin = want; }
        else { want = (h + 2) & 0xff; wantTwin = want; }
        if (wantFire) fired++; else if (want === ((h + 2) & 0xff)) up++; else down++;
        if (got !== want) wrong.push(`${c.name} h=${h} t=${t}: ${got}, expected ${want}`);
        if (twin !== wantTwin) {
          wrong.push(`${c.name} h=${h} t=${t}: twin ${twin}, expected ${wantTwin}`);
        }
        if (launched !== wantFire) {
          wrong.push(`${c.name} h=${h} t=${t}: ${launched ? 'fired' : 'did not fire'}`);
        }
      }
    }
  }
  check('the heading moves by two, in the direction the probing increment reveals',
    wrong.length === 0 && up > 50 && down > 50, wrong.slice(0, 3).join('; ')
      || `${up + down + fired} cases across all three classes: ${up} up, ${down} down,`
        + ` ${fired} aligned`);
  check('and when the probe itself lands on the bearing the enemy fires from there, keeping it',
    wrong.length === 0 && kept > 10,
    `${kept} cases where the heading was one short and came out equal to the bearing`);

  // The twin is published on a turn and NOT on a fire, which a port that always published
  // would get wrong.
  const aligned = await run(COPIES[0].at, [COPIES[0].exit],
    clear(COPIES[0], { [field(1, 'heading')]: 100, [field(13, 'heading')]: 0x5A }),
    bearingOf(100));
  check('a fire leaves the scope twin alone - only the two turn paths publish to it',
    aligned.after[field(13, 'heading')] === 0x5A
      && aligned.after[field(4, 'count')] === 0x14,
    `twin still ${aligned.after[field(13, 'heading')]} after a launch`);

  // The compare is unsigned, which only shows at the wrap.
  const wrapCase = await run(COPIES[0].at, [COPIES[0].exit],
    clear(COPIES[0], { [field(1, 'heading')]: 200 }), bearingOf(10));
  check('the comparison is unsigned, so a heading of 200 against a bearing of 10 turns down',
    wrapCase.after[field(1, 'heading')] === 198,
    `200 -> ${wrapCase.after[field(1, 'heading')]}; a signed compare would have turned up`);
}

// --- the cooldown ------------------------------------------------------------------------------
console.log('\n=== the cooldown, and the two labels it lands on ===');
{
  const wrong = [];
  for (const c of COPIES) {
    for (const v of [1, 7, 20]) {
      const r = await run(c.at, [c.exit],
        clear(c, { [c.cool]: v, [field(c.enemy, 'heading')]: 50 }), bearingOf(50));
      const got = r.after[field(c.enemy, 'heading')];
      const want = c.name === 'class 1' ? 52 : 47;
      if (got !== want) wrong.push(`${c.name} with ${v}: 50 -> ${got}, expected ${want}`);
      // And it does not fire, even though the heading equals the bearing.
      if (r.after[field(c.missile, 'count')] !== 0) wrong.push(`${c.name}: fired while cooling`);
      if (r.after[c.cool] !== v) wrong.push(`${c.name}: the dispatch changed the cooldown`);
    }
  }
  check('while it runs, class 1 turns UP by two and classes 2 and 3 turn DOWN by three',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'the same code, entered without the probing increment - 9 cases');

  // The decrements, in the next region.
  const bad = [];
  for (const c of COPIES) {
    for (const v of [0, 1, 9, 20]) {
      const r = await run(c.coolDownAt, c.coolDownExits, { [c.cool]: v });
      const got = r.after[c.cool];
      const want = v === 0 ? 0 : v - 1;
      const wantExit = v === 0 ? c.coolDownExits[0] : c.coolDownExits[1];
      if (got !== want || r.exit !== wantExit) {
        bad.push(`${c.name} ${v}: ${got} via ${hx(r.exit, 4)}`);
      }
    }
  }
  check('and the four instructions at $0E23, $122D and $1637 run it back down',
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'zero is left alone and takes the other branch, which is how the block ends');
}

// --- the launch --------------------------------------------------------------------------------
console.log('\n=== the launch ===');
{
  const wrong = [];
  for (const c of COPIES) {
    const r = await run(c.at, [c.exit],
      clear(c, { [field(c.enemy, 'heading')]: 100 }), bearingOf(100));
    const a = r.after;
    const want = {
      [field(c.missile, 'count')]: 0x14,
      [field(c.missileTwin, 'count')]: 0x14,
      [field(c.missile, 'heading')]: 100,
      [field(c.missile, 'y')]: 0xF6,
      [field(c.missile, 'y') + 1]: 0xFF,
      0x0949: 100,
      [c.cool]: c.name === 'class 3' ? 0x0F : 0x14,
      [c.sound]: c.name === 'class 3' ? 100 : 1,
    };
    for (const [addr, v] of Object.entries(want)) {
      if (a[addr] !== v) wrong.push(`${c.name} ${hx(Number(addr), 4)}: ${a[addr]}, expected ${v}`);
    }
  }
  check('a launch switches the missile and its twin on, saves the heading and parks it at -10',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'all three classes, every field the block writes');

  // The typo's one visible consequence.
  const silent = await run(COPIES[2].at, [COPIES[2].exit],
    clear(COPIES[2], { [field(3, 'heading')]: 0 }), bearingOf(0));
  check('so class 3 at heading 0 launches SILENTLY: its sound flag takes the heading, not 1',
    silent.after[field(5, 'count')] === 0x14 && silent.after[0x0945] === 0,
    'the missile is up and $0945 is still zero, which $186E reads as nothing to play');

  // The missile cannot be fired while one is up, and 2 and 3 block each other.
  const bad = [];
  for (const [c, blockedBy, notBlockedBy] of [
    [COPIES[0], field(4, 'count'), field(5, 'count')],
    [COPIES[1], field(5, 'count'), field(4, 'count')],
    [COPIES[2], field(5, 'count'), field(4, 'count')],
  ]) {
    const blocked = await run(c.at, [c.exit],
      clear(c, { [blockedBy]: 7, [field(c.enemy, 'heading')]: 100 }), bearingOf(100));
    if (Object.keys(blocked.changed).length !== 0) {
      bad.push(`${c.name}: ${Object.keys(blocked.changed).length} bytes changed anyway`);
    }
    const free = await run(c.at, [c.exit],
      clear(c, { [notBlockedBy]: 7, [field(c.enemy, 'heading')]: 100 }), bearingOf(100));
    if (free.after[field(c.missile, 'count')] !== 0x14) {
      bad.push(`${c.name}: the other class's missile blocked it`);
    }
  }
  check('one missile at a time, and classes 2 and 3 block each other because they share it',
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'a blocked launch changes nothing at all - not even the heading');
}
{
  // The step, and the two entries it goes through.
  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const ent = (t, i) => s24(t[i] | (t[i + 1] << 8) | (t[i + 2] << 16));
  const missile = ent(tab, MISSILE_SPEED), ship = ent(tab, VAR.speed);
  check('the missile has its own speed entry, and it is a divisor: 383 against the ship\'s 1280',
    missile === 383 && ship === 1280,
    `index ${MISSILE_SPEED} = ${missile}, index ${VAR.speed} = ${ship}, so a missile covers`
      + ` ${(ship / missile).toFixed(2)} times the ground per pass`);

  const r = await run(COPIES[0].at, [COPIES[0].exit],
    clear(COPIES[0], { [field(1, 'heading')]: 100 }), bearingOf(100));
  const read = (i) => s24(r.after[0x9800 + i] | (r.after[0x9800 + i + 1] << 8)
    | (r.after[0x9800 + i + 2] << 16));
  const stepX = read(VAR.stepX), stepZ = read(VAR.stepZ);
  const wrong = [];
  for (const [step, slot] of [[stepX, VARS[0x0927 - 0x08F2]], [stepZ, VARS[0x0929 - 0x08F2]]]) {
    const want = Math.trunc(Math.abs(step) * 256 / missile) * (step < 0 ? -1 : 1);
    if (read(slot) !== want) wrong.push(`slot ${slot}: ${read(slot)}, expected ${want}`);
  }
  check('and the launch runs $1AE8 then divides each component by it, into the missile\'s slots',
    wrong.length === 0, wrong.slice(0, 2).join('; ')
      || `heading 100 gives components ${stepX / 256} and ${stepZ / 256}, stepping`
        + ` ${read(VARS[0x0927 - 0x08F2])} and ${read(VARS[0x0929 - 0x08F2])}`);
  check('which means a launch overwrites the SHIP\'s step operands, because $1AE8 always does',
    r.after[0x9800 + VAR.stepX + 1] !== r.seeded[0x9800 + VAR.stepX + 1]
      || r.after[0x9800 + VAR.stepZ + 1] !== r.seeded[0x9800 + VAR.stepZ + 1],
    `$0915 and $0916 are hard-coded in $1AE8; harmless only because the movement block`
      + ' rebuilds them before every use');
}

// --- what reads the flags ----------------------------------------------------------------------
console.log('\n=== what the launch flags are for ===');
{
  const lines = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8').split(/\r?\n/)
    .map((l) => {
      const m = l.match(/^\$([0-9A-F]{4})\s+(?:\S+:\s+)?((?:[0-9A-F]{2} )+)\s*(.*)$/);
      return m ? { addr: parseInt(m[1], 16), text: m[3].trim() } : null;
    }).filter(Boolean);
  const readers = [];
  for (const addr of [0x0943, 0x0944, 0x0945]) {
    for (const l of lines) if (l.text === `LDX ${hx(addr, 4)}`) readers.push(l.addr);
  }
  // Each flag is tested for non-zero, a sound routine is called, and the flag is cleared.
  // The BEQ's target is the next flag's test, so it is not part of the shape.
  const shape = [];
  for (const start of readers) {
    const k = lines.findIndex((l) => l.addr === start);
    shape.push(lines.slice(k, k + 5)
      .map((l) => (/^BEQ /.test(l.text) ? 'BEQ past it' : l.text.replace(/\$09[0-9A-F]{2}/, 'FLAG')))
      .join(' / '));
  }
  console.log('  ' + [...new Set(shape)].join('\n  '));
  check('the three flags are sound triggers: tested for non-zero, played at $1F8E, cleared',
    readers.length === 3 && new Set(shape).size === 1 && shape[0].includes('JSR L1F8E'),
    `read at ${readers.map((a) => hx(a, 4)).join(', ')} - which is why class 3's typo only`
      + ' shows at heading 0');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
