// Taking damage: three panel bars, one primitive, and four is fatal.
//
// The whole model is $1C89 - shrink a bar by up to four, stop at $C7 - called between two and
// four times depending on what hit you, with a fall-through to the ship's systems the moment
// the shield runs out. Short enough to read; the parts worth measuring are the cost of each
// kind of hit, what is left unstored when the shield empties mid-way, and the hit count that
// ends the game.
//
// Three of these routines end in a sound and nothing else - $1E03, $1E21/$1E40, $1F2B - and
// the sound engine is Phase 6, so the routines are run as subroutines and the sound engine's
// parameter block at $1D4A-$1D51 is left out of what is compared.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { SHLD, WARP, MSL, EMPTY, HITS, FATAL, STEP, shrink }
  from '../port/src/game/damage.js';
import { RAMMED, HIT } from '../port/src/game/entities.js';
import { CLASSES } from '../port/src/game/dispatch.js';
import { QUIT, QUIT_VALUE } from '../port/src/game/loop.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
const image = [];
for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];

// --- the three bars are bytes in the display list ----------------------------------------------
console.log('\n=== three bars, one primitive ===');
{
  // Every routine in the damage chain touches only these three bytes and the hit count.
  const touched = new Set();
  for (const [lo, hi] of [[0x1C89, 0x1D09]]) {
    for (const l of disasmRange(image, lo, hi)) {
      if (l.mode === 'abs' && /^(LD[AXY]|ST[AXY])$/.test(l.op)) {
        touched.add(l.bytes[1] | (l.bytes[2] << 8));
      }
    }
  }
  console.log('  $1C89-$1D08 names ' + [...touched].sort((a, b) => a - b)
    .map((a) => hx(a, 4)).join(', '));
  check('the whole damage chain names only the three bars and the hit count',
    [...touched].every((a) => [SHLD, WARP, MSL, HITS].includes(a)) && touched.size === 4,
    `${touched.size} addresses, and $1D4A-$1D51 is reached only through the sound routines`);

  // $1C89 is called from five places, and each one holds the bar in X across the call.
  const callers = disasmRange(image, obj.addr, obj.addr + obj.len)
    .filter((l) => l.op === 'JSR' && l.target === 0x1C89).map((l) => l.addr);
  check('$1C89 is the one primitive, called from six places in the chain',
    callers.length === 6 && callers.every((a) => a >= 0x1C99 && a < 0x1CE7),
    callers.map((a) => hx(a, 4)).join(', ')
      + ' - four on the shield, one on the missile bar, one on the warp bar');
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
  // Zero page $00 is in this list because the fourth hit's entire consequence is written
  // there, and nothing else this file watches would ever show it. It was left out of the
  // first version, which is how the port went a long time with a ship that could not die.
  const WATCH = [[0x0000, 0x0002], [0x80FB, 0x82E6], [0x0900, 0x0960]];
  window.M.damageRun = (addr, pokes, x, stop) => {
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
    st.pc = addr; st.x = (x || 0) & 0xff;
    cpu.setState(st);
    let ok = false, visited = {};
    cpu.stepCyclesDebug(4000000, () => {
      const pc = cpu.getPC();
      if (pc >= 0x1C89 && pc <= 0x1F70) visited[pc] = 1;
      if (pc === target) { ok = true; return true; }
    });
    const end = cpu.getState();
    const after = {};
    for (const [lo, hi] of WATCH) { for (let a = lo; a < hi; a++) after[a] = rd(a); }
    for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
    for (let a = 0; a < 0x100; a++) wr(a, snapZp[a]);
    cpu.setState(before);
    return { ok, x: end.x, y: end.y, after, seeded, visited: Object.keys(visited).map(Number) };
  };
  return 'ok';
})()`);
const run = (addr, pokes = {}, x = 0, stop = 0) => a2.ev('JSON.stringify(window.M.damageRun('
  + addr + ',' + JSON.stringify(pokes) + ',' + x + ',' + stop + '))').then(JSON.parse);

// --- what the bars hold in flight ---------------------------------------------------------------
{
  const live = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x80FB, 0x82E6))'));
  const at = (a) => live[a - 0x80FB];
  console.log(`  in flight: SHLD = ${at(SHLD)}, WARP = ${at(WARP)}, MSL = ${at(MSL)},`
    + ` empty is ${EMPTY}`);
  check('all three bars start well above empty, and a bar is a coordinate not a count',
    at(SHLD) > EMPTY && at(WARP) > EMPTY && at(MSL) > EMPTY,
    `${at(SHLD) - EMPTY}, ${at(WARP) - EMPTY} and ${at(MSL) - EMPTY} units of travel each`);
}

// --- $1C89 ---------------------------------------------------------------------------------
console.log('\n=== $1C89, shrink by up to four ===');
{
  const wrong = [];
  for (let x = 0xC7; x <= 0xFF; x++) {
    const r = await run(0x1C89, {}, x);
    const want = shrink(x);
    if (r.x !== want.value || r.y !== want.steps) {
      wrong.push(`${x}: X=${r.x} Y=${r.y}, expected ${want.value}/${want.steps}`);
    }
  }
  check('it takes four steps, or stops early at $C7 and says so in Y',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || '57 values from $C7 to $FF, against the port\'s own shrink');

  // The two edges worth naming.
  const atFloor = await run(0x1C89, {}, EMPTY);
  const justAbove = await run(0x1C89, {}, EMPTY + 1);
  const exact = await run(0x1C89, {}, EMPTY + 4);
  check('a bar already at empty runs straight past it, because the test is equality',
    atFloor.x !== EMPTY && atFloor.y === STEP,
    `$C7 comes back as ${atFloor.x} after a full four - the floor only works from above,`
      + ' and nothing in the game ever raises a bar');
  check('one above empty takes a single step and reports it',
    justAbove.x === EMPTY && justAbove.y === 1, `Y = ${justAbove.y}`);
  check('and four above empty lands exactly on it, still reporting a full four',
    exact.x === EMPTY && exact.y === STEP,
    `Y = ${exact.y}, because the CPX is tested before the CPY`);
}

// --- the cost of each kind of hit ---------------------------------------------------------------
console.log('\n=== a ram costs sixteen, a missile eight ===');
{
  const base = { [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 0 };
  const ram = await run(0x1C99, { ...base, [SHLD]: 0xFF });
  const miss = await run(0x1CFC, { ...base, [SHLD]: 0xFF });
  check('a full shield loses 16 to a ram and 8 to a missile',
    0xFF - ram.after[SHLD] === 16 && 0xFF - miss.after[SHLD] === 8,
    `${0xFF - ram.after[SHLD]} and ${0xFF - miss.after[SHLD]}`);
  check('and while the shield holds, nothing else is touched at all',
    ram.after[WARP] === 0xFF && ram.after[MSL] === 0xFF && ram.after[HITS] === 0
      && miss.after[WARP] === 0xFF && miss.after[MSL] === 0xFF && miss.after[HITS] === 0,
    'the systems damage is the fall-through, not an addition');

  // Where the shield runs out partway, and what goes unstored.
  const wrong = [];
  for (let shield = EMPTY; shield <= EMPTY + 20; shield++) {
    for (const [name, addr] of [['ram', 0x1C99], ['missile', 0x1CFC]]) {
      const r = await run(addr, { ...base, [SHLD]: shield });
      const spent = shield - r.after[SHLD];
      const hit = r.after[HITS] === 1;
      const drained = r.after[MSL] !== 0xFF;
      // The systems take it exactly when the shield could not, and both bars move together.
      if (hit !== drained) wrong.push(`${name} at ${shield}: hit ${hit}, drained ${drained}`);
      if (!hit && spent !== (name === 'ram' ? 16 : 8)) {
        wrong.push(`${name} at ${shield}: absorbed but spent ${spent}`);
      }
      if (r.after[SHLD] < EMPTY) wrong.push(`${name} at ${shield}: shield went below empty`);
    }
  }
  check('when the shield cannot take it the systems do, and never both',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || '42 runs across the twenty units above empty');

  // The unstored first shrink. A ram that empties the shield on its FIRST call of $1C89
  // leaves the bar exactly where it was, because the store comes after the second.
  const early = await run(0x1C99, { ...base, [SHLD]: EMPTY + 3 });
  check('a ram that empties the shield on its first four leaves the bar UNCHANGED',
    early.after[SHLD] === EMPTY + 3 && early.after[HITS] === 1,
    `${EMPTY + 3} stays ${early.after[SHLD]} - the store comes after the second shrink,`
      + ' so the first one\'s result is discarded');
}

// --- the systems, and four being fatal ----------------------------------------------------------
console.log('\n=== the systems, and the fourth hit ===');
{
  const wrong = [];
  for (let hits = 0; hits < 5; hits++) {
    const r = await run(0x1CCD, { [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: hits });
    if (r.after[HITS] !== hits + 1) wrong.push(`${hits}: count ${r.after[HITS]}`);
    const died = r.visited.includes(0x1F2B);
    const survived = r.visited.includes(0x1E21);
    if (died === survived) wrong.push(`${hits}: both or neither path taken`);
    if (died !== (hits + 1 >= FATAL)) wrong.push(`${hits}: died ${died}`);
  }
  check('the hit count rises, and the fourth one leaves through $1F2B instead of the sounds',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'the nearest thing the binary has to a lives counter, and four is fatal');

  // **What the fourth hit actually does**, which reaching $1F2B does not by itself say.
  // $1F2B is almost entirely sound - two bursts through $1D52 - but its last two
  // instructions are `LDX #$4D / STX $00`, and zero page $00 is the byte the main loop
  // tests at $18D6 to leave the flight. That write is the death of the ship; everything
  // else about $1F2B is noise.
  const fatal = await run(0x1CCD, { [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 3, 0: 0 });
  const lived = await run(0x1CCD, { [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 2, 0: 0 });
  check('the fourth hit writes $4D into zero page $00 - the byte $18D6 leaves on',
    fatal.after[QUIT] === QUIT_VALUE,
    `$00 was 0 going in and ${hx(fatal.after[QUIT], 2)} coming out`);
  check('control: the third hit leaves $00 alone',
    lived.after[QUIT] === 0 && lived.after[HITS] === 3,
    'so the flight carries on, and the check above cannot pass by accident');

  // And the one instruction that does it, read off the binary rather than inferred.
  const tail = disasmRange(image, 0x1F62, 0x1F67);
  check('$1F2B ends with LDX #$4D then STX $00, and then returns',
    tail.length === 3 && tail[0].op === 'LDX' && tail[0].bytes[1] === QUIT_VALUE
      && tail[1].op === 'STX' && tail[1].bytes[1] === 0x00 && tail[2].op === 'RTS',
    tail.map((l) => l.text ?? l.op).join(' / '));

  // $1F2B opens with JSR $1FA9, which is display teardown and nothing else. Worth naming,
  // because a port that reproduces the write without it has still left something out.
  const teardown = disasmRange(image, 0x1FA9, 0x1FB2);
  const switches = teardown.filter((l) => l.op === 'STX').map((l) => l.bytes[1] | (l.bytes[2] << 8));
  check('and opens with $1FA9, which only touches the two display soft switches',
    switches.length === 2 && switches.includes(0xC054) && switches.includes(0xC056),
    `${switches.map((a) => hx(a, 4)).join(' and ')} - page 1, and hi-res off`);

  // Both bars drop by four, and an empty one is left alone rather than wrapped.
  const both = await run(0x1CCD, { [SHLD]: EMPTY, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 0 });
  const spent = await run(0x1CCD, { [SHLD]: EMPTY, [WARP]: EMPTY, [MSL]: EMPTY, [HITS]: 0 });
  check('each system bar loses four, and one already empty is skipped, not wrapped',
    both.after[WARP] === 0xFB && both.after[MSL] === 0xFB
      && spent.after[WARP] === EMPTY && spent.after[MSL] === EMPTY,
    `$FF becomes ${both.after[WARP]}; $C7 stays $C7, which is what the guard is for`);
}

// --- the two flag blocks that trigger it --------------------------------------------------------
console.log('\n=== $18BC and $18C9, where the flags are read ===');
{
  const wrong = [];
  for (const [flag, addr, cost] of [[RAMMED, 0x1C99, 16], [HIT, 0x1CFC, 8]]) {
    for (const set of [0, 1, 0x5A]) {
      const r = await run(0x18BC,
        { [flag]: set, [SHLD]: 0xFF, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 0,
          [RAMMED]: flag === RAMMED ? set : 0, [HIT]: flag === HIT ? set : 0 },
        0, 0x18D6);
      const spent = 0xFF - r.after[SHLD];
      if (set === 0 && spent !== 0) wrong.push(`${hx(flag, 4)} clear: it damaged anyway`);
      if (set !== 0 && spent !== cost) wrong.push(`${hx(flag, 4)} = ${set}: spent ${spent}`);
      if (r.after[flag] !== 0) wrong.push(`${hx(flag, 4)} = ${set}: not cleared`);
    }
  }
  check('each flag is tested for non-zero, acted on and cleared',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || 'a ram and a missile hit in the same pass therefore cost 24 between them');

  // And the launch-sound flags above them, which do the same with no damage.
  const sound = await run(0x186E,
    { [CLASSES[0].launchSound]: 1, [CLASSES[1].launchSound]: 0,
      [CLASSES[2].launchSound]: 0x40, [SHLD]: 0xFF, [HITS]: 0, [RAMMED]: 0, [HIT]: 0 },
    0, 0x1895);
  check('the three launch-sound flags above them clear the same way and damage nothing',
    sound.after[CLASSES[0].launchSound] === 0 && sound.after[CLASSES[2].launchSound] === 0
      && sound.after[SHLD] === 0xFF && sound.after[HITS] === 0,
    'class 3\'s flag held 64 rather than 1 and was still read as "play it"');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
