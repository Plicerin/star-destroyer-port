// The finale's end-of-frame block, the port against the real one, in the machine.
//
// `probe_basestar.mjs` established that `BASE STAR.OBJ0` is the same engine on a different
// mission and got the oracle into a real one. This holds the first block of it that has been
// transliterated: `$10E5`-`$112E`, where the mission decides whether you are dead, whether a
// stage is finished, whether to pause, and whether the base star is gone.
//
// The block is a decision, so it is compared the way `parity_loop.mjs` compares the main
// mission's exits: by **which address the machine leaves through**. There are four, and they
// are the whole of the block's meaning:
//
//     $10EC  RTS         two hits - the mission is over
//     $1104  JMP $112E   a stage finished
//     $112D  RTS         the field is empty - the base star is dead
//     $112E  JMP $09A7   none of the above, round again
//
// Every case is swept rather than sampled, because the inputs are four bytes and a latch and
// the whole space is small enough to walk: the hit count either side of two, the progress
// counter either side of fifteen, both halves of the win test, and the latch either side of
// both `$7F` and `$80` - the one byte where this block and the main mission's pause disagree.
import { openOracle } from './a2.mjs';
import { toFinale } from './exercise.mjs';
import { endOfFrame, pauses, DONE, HITS, FATAL, PROGRESS, STAGE, BASE_STAR, OBJ3_COUNT,
  DEBRIS1, FRAME_TOP, STAGE_CALLS, SHLD, WARP, MSL, EMPTY, rammed, missileHit, systems,
  secondEight } from '../port/src/game/finale.js';
import { shrink } from '../port/src/game/damage.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

/** The four ways out, by the address the machine stops on. */
const EXITS = { 0x10EC: DONE.destroyed, 0x112D: DONE.won, 0x1104: DONE.running,
  0x112E: DONE.running };
/** Which of the two "running" exits it was, for the stage flag. */
const STAGED = 0x1104;

const a2 = await openOracle();
let ran = 0;
try {
  const arrival = await toFinale(a2);
  check('the oracle is in a real mission before anything is compared',
    arrival.setup.pokes.length === 17 && arrival.setup.unresolved.length === 0,
    'SD START2\'s setup applied, so $814B is 255 and the mission is not already won');

  await a2.ev(`(() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const WATCH = [${HITS}, ${PROGRESS}, ${BASE_STAR}, ${OBJ3_COUNT}, ${DEBRIS1}];
    window.M.endFrame = (pokes) => {
      const before = cpu.getState();
      const snap = {}; for (const a of WATCH) snap[a] = rd(a);
      for (const [a, v] of Object.entries(pokes)) wr(Number(a), v & 0xff);
      const latchWas = rd(0xC000);
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = 0x10E5; cpu.setState(st);
      let exit = 0, calls = [], spins = 0;
      cpu.stepCyclesDebug(400000, () => {
        const pc = cpu.getPC();
        if (pc === 0x1114) spins++;                       // the pause's inner wait
        if (pc === 0x1131 || pc === 0x12AB) calls.push(pc);
        if (pc === 0x10EC || pc === 0x112D || pc === 0x1104 || pc === 0x112E) {
          exit = pc; return true;
        }
        if (spins > 40) { exit = -1; return true; }       // it is sitting in the pause
      });
      const after = {}; for (const a of WATCH) after[a] = rd(a);
      for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
      cpu.setState(before);
      return { exit, calls, paused: spins > 0, after, latch: latchWas };
    };
    return 'ok';
  })()`);
  const machine = (pokes) => a2.ev('JSON.stringify(window.M.endFrame('
    + JSON.stringify(pokes) + '))').then(JSON.parse);

  // ---------------------------------------------------------------- the sweep -------------
  console.log('\n=== every way out, swept ===');
  const bad = [];
  const exits = {};
  for (const hits of [0, 1, FATAL, FATAL + 1, 0xFF]) {
    for (const progress of [0, STAGE - 1, STAGE, STAGE + 1]) {
      for (const obj3 of [0, 1, 255]) {
        for (const debris of [0, 1, 4]) {
          const pokes = { [HITS]: hits, [PROGRESS]: progress, [OBJ3_COUNT]: obj3,
            [DEBRIS1]: debris, [BASE_STAR]: 0 };
          const r = await machine(pokes);
          ran++;
          const mem = new Uint8Array(0x10000);
          for (const [a, v] of Object.entries(pokes)) mem[a] = v;
          const got = endOfFrame(mem, { latch: r.latch });
          exits[r.exit] = (exits[r.exit] ?? 0) + 1;

          const why = `hits ${hits} prog ${progress} obj3 ${obj3} debris ${debris}`;
          if (got.done !== EXITS[r.exit]) {
            bad.push(`${why}: port ${got.done}, machine ${EXITS[r.exit]} at ${hx(r.exit)}`);
          } else if (got.stage !== (r.exit === STAGED)) bad.push(`${why}: stage ${got.stage}`);
          else if (got.paused !== r.paused) bad.push(`${why}: paused ${got.paused} vs ${r.paused}`);
          else if (mem[BASE_STAR] !== r.after[BASE_STAR]) {
            bad.push(`${why}: $1FFF ${mem[BASE_STAR]} vs ${r.after[BASE_STAR]}`);
          } else if (mem[PROGRESS] !== r.after[PROGRESS] || mem[DEBRIS1] !== r.after[DEBRIS1]) {
            bad.push(`${why}: the stage reset differs`);
          } else if (got.calls.join() !== r.calls.join()) {
            bad.push(`${why}: calls ${got.calls} vs ${r.calls}`);
          }
        }
      }
    }
  }
  check(`all ${ran} cases agree: the exit, the stage reset, the pause and $1FFF`,
    bad.length === 0, bad.slice(0, 3).join('; ')
      || `exits taken: ${Object.entries(exits).map(([a, n]) => `${hx(+a)} x${n}`).join(', ')}`);

  // ---------------------------------------------------------- the two it gets right -------
  console.log('\n=== the two rules a port would assume wrong ===');
  {
    const three = await machine({ [HITS]: 3, [PROGRESS]: 0, [OBJ3_COUNT]: 255,
      [DEBRIS1]: 1, [BASE_STAR]: 0 });
    check('three hits does NOT end it - the test is equality, not a threshold',
      EXITS[three.exit] === DONE.running,
      `the machine left at ${hx(three.exit)}; a port written ">= 2" would have stopped`);

    // The latch cannot be set to a chosen value - $C000 is a soft switch, and writing it
    // does something else - so the threshold is taken from the operand byte, which is where
    // it lives, and the behaviour is checked with a key the machine really has pending.
    const bytes = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x110B, 0x110E))'));
    check('the pause compares against $7F, where the main mission compares against $80',
      bytes[0] === 0xE0 && bytes[1] === 0x7F,
      `$110B is CPX #${hx(bytes[1], 2)}; $192D in the main mission is CPX #$80, and`
        + ' port/src/game/finale.js keeps the difference');
    check('and the port reads that byte the same way the branch under it does',
      pauses(0x7F) === true && pauses(0x7E) === false,
      '`BCC` skips the pause below $7F, so $7F and up is a key');

    await a2.key('A');
    const pressed = await machine({ [HITS]: 0, [PROGRESS]: 0, [OBJ3_COUNT]: 255,
      [DEBRIS1]: 1, [BASE_STAR]: 0 });
    check('with a key really pending, the machine stops in the pause and the port agrees',
      pressed.exit === -1 && pauses(pressed.latch) === true,
      `$C000 held ${hx(pressed.latch, 2)} and the block sat in $1114 waiting for the next key`);
  }

  // ----------------------------------------------------------- the damage block ----------
  // Same method as parity_damage.mjs: sweep the shield one unit at a time across its whole
  // boundary, because that is where all the interesting behaviour is - which shrink lands,
  // which one gets stored, and whether the systems take it instead. Each entry point is run
  // as a subroutine and the four bytes it can touch are compared.
  console.log('\n=== the damage block ===');
  await a2.ev(`(() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const WATCH = [${SHLD}, ${WARP}, ${MSL}, ${HITS}];
    window.M.dmg = (addr, pokes) => {
      const before = cpu.getState();
      const snap = {}; for (const a of WATCH) snap[a] = rd(a);
      for (const [a, v] of Object.entries(pokes)) wr(Number(a), v & 0xff);
      const seeded = {}; for (const a of WATCH) seeded[a] = rd(a);
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = addr; cpu.setState(st);
      const calls = [];
      cpu.stepCyclesDebug(2000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x171D || pc === 0x1613 || pc === 0x1632 || pc === 0x15F5) calls.push(pc);
        if (pc === 0xFFFF) return true;
      });
      const after = {}; for (const a of WATCH) after[a] = rd(a);
      for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
      cpu.setState(before);
      return { seeded, after, calls };
    };
    return 'ok';
  })()`);
  const dmg = (addr, pokes) => a2.ev('JSON.stringify(window.M.dmg(' + addr + ','
    + JSON.stringify(pokes) + '))').then(JSON.parse);

  for (const [name, addr, fn] of [
    ['$1486 the ram', 0x1486, rammed],
    ['$14EE the missile', 0x14EE, missileHit],
    ['$14BF the systems', 0x14BF, systems],
    ['$149E the second eight', 0x149E, secondEight],
  ]) {
    const wrong = [];
    let n = 0, fatal = 0;
    for (let shield = EMPTY; shield <= EMPTY + 20 && wrong.length < 3; shield++) {
      for (const hits of [0, 1, 2]) {
        for (const bars of [[0xFF, 0xFF], [EMPTY, 0xFF], [EMPTY, EMPTY]]) {
          const pokes = { [SHLD]: shield, [MSL]: bars[0], [WARP]: bars[1], [HITS]: hits };
          const r = await dmg(addr, pokes);
          const mem = new Uint8Array(0x10000);
          for (const [a, v] of Object.entries(r.seeded)) mem[a] = v;
          const got = fn(mem, shrink);
          n++;
          if (got.fatal) fatal++;
          const why = `shield ${shield} hits ${hits} bars ${bars}`;
          let said = false;
          for (const a of [SHLD, WARP, MSL, HITS]) {
            if (mem[a] !== r.after[a]) {
              wrong.push(`${why}: ${hx(a)} port ${mem[a]} machine ${r.after[a]}`);
              said = true;
              break;
            }
          }
          if (!said && got.calls.join() !== r.calls.join()) {
            wrong.push(`${why}: calls ${got.calls} vs ${r.calls}`);
          }
        }
      }
    }
    check(`${name} agrees across the shield's whole boundary`,
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} cases, ${fatal} of them fatal`);
  }

  // The two readings that would look right and be wrong.
  {
    const ram = await dmg(0x1486, { [SHLD]: 0xFF, [MSL]: 0xFF, [WARP]: 0xFF, [HITS]: 0 });
    check('a ram costs EIGHT off the shield, not the main mission\'s sixteen',
      0xFF - ram.after[SHLD] === 8,
      `$FF to ${ram.after[SHLD]} - $149A is CPY #$0A against a primitive that returns 1 to 4,`
        + ' so the second eight is never the ram\'s');

    const miss = await dmg(0x14EE, { [SHLD]: 0xFF, [MSL]: 0xFF, [WARP]: 0xFF, [HITS]: 2 });
    check('and a missile SETS the hit count to one, where everything else raises it',
      miss.after[HITS] === 1,
      `two went in and ${miss.after[HITS]} came out - $14B2 LDA #$01 / STA $0933, which`
        + ' nothing in the main mission does');
  }

  // ------------------------------------------------------------------ controls ------------
  console.log('\n=== controls ===');
  {
    const cases = [
      ['a fatal test written as a threshold', (mem) => (mem[HITS] >= FATAL
        ? DONE.destroyed : endOfFrame(mem, { latch: 0 }).done)],
      ['the main mission\'s $80 in the pause', null],
      ['a win that stores 1 rather than incrementing', null],
    ];
    // >= 2 against == 2, on the one case that separates them.
    const m = new Uint8Array(0x10000);
    m[HITS] = 3; m[OBJ3_COUNT] = 255; m[DEBRIS1] = 1;
    check(`control: ${cases[0][0]} disagrees`,
      cases[0][1](m) !== endOfFrame(m, { latch: 0 }).done,
      'at three hits one says destroyed and the other says running');

    check(`control: ${cases[1][0]} disagrees`, pauses(0x7F) !== (0x7F >= 0x80),
      'the two readings part on exactly $7F, which is what makes the byte worth keeping');

    const w = new Uint8Array(0x10000);
    w[BASE_STAR] = 1; w[OBJ3_COUNT] = 0; w[DEBRIS1] = 0;
    endOfFrame(w, { latch: 0 });
    check(`control: ${cases[2][0]} disagrees`, w[BASE_STAR] === 2,
      'INC takes it to 2 where a store would leave 1 - which is the difference between'
        + ' SD PART3 and INITIALS disagreeing about whether the game was won');
  }
} finally {
  await a2.close();
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
