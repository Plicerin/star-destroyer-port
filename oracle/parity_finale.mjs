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
  secondEight, debrisFrame, DEBRIS, DEBRIS_WIN, TOGGLE, ONE_SHOTS, award, rotate,
  ROTATED, hitTest }
  from '../port/src/game/finale.js';
import { shrink } from '../port/src/game/damage.js';
import { Math24 } from '../port/src/game/math.js';
import { rangeFromArgs, GEOM, dir } from '../port/src/game/geometry.js';

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
  await a2.ev(`(() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const WATCH = [0x093E, 0x093F, 0x0940, 0x0947, 0x094B, 0x0945, 0x1FFF, 0x8289, 0x8165];
    window.M.frame = (pokes) => {
      const before = cpu.getState();
      const snap = {}; for (const a of WATCH) snap[a] = rd(a);
      for (const [a, v] of Object.entries(pokes)) wr(Number(a), v & 0xff);
      const seeded = {}; for (const a of WATCH) seeded[a] = rd(a);
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = 0x103E; cpu.setState(st);
      const calls = []; let site1 = 0;
      cpu.stepCyclesDebug(8000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x10A7) site1++;
        if (pc === 0x10AD || pc === 0x10AA) return true;   // the block's two ways out
      });
      const after = {}; for (const a of WATCH) after[a] = rd(a);
      for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
      cpu.setState(before);
      return { seeded, after, calls, site1 };
    };
    return 'ok';
  })()`);
  const frame = (pokes) => a2.ev('JSON.stringify(window.M.frame('
    + JSON.stringify(pokes) + '))').then(JSON.parse);

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

  // ---------------------------------------------------- the debris block, and the two wins
  // `$103E`-`$10AA` ticks the three debris counters, renders, services two one-shot flags
  // and then tests class 1's counter. That test is the first of the two places `$1FFF` is
  // incremented, and the pair of them is how the mission is won.
  console.log('\n=== the debris block ===');
  {
    const wrong = [];
    let n = 0, wins = 0;
    for (const d1 of [0, 1, 3, 4, 255]) {
      for (const d2 of [0, 2]) {
        for (const d3 of [0, 2]) {
          for (const toggle of [0, 1, 2]) {
            for (const flags of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              const pokes = { [DEBRIS[0]]: d1, [DEBRIS[1]]: d2, [DEBRIS[2]]: d3,
                [TOGGLE]: toggle, [ONE_SHOTS[0].flag]: flags[0],
                [ONE_SHOTS[1].flag]: flags[1], [BASE_STAR]: 0 };
              const r = await frame(pokes);
              const mem = new Uint8Array(0x10000);
              for (const [a, v] of Object.entries(r.seeded)) mem[a] = v;
              const got = debrisFrame(mem);
              n++;
              if (got.won) wins++;
              const why = `debris ${d1}/${d2}/${d3} toggle ${toggle} flags ${flags}`;
              const watched = [...DEBRIS, TOGGLE, ONE_SHOTS[0].flag, ONE_SHOTS[1].flag,
                BASE_STAR];
              let said = false;
              for (const a of watched) {
                if (mem[a] !== r.after[a]) {
                  wrong.push(`${why}: ${hx(a)} port ${mem[a]} machine ${r.after[a]}`);
                  said = true; break;
                }
              }
              if (!said && got.won !== (r.site1 > 0)) {
                wrong.push(`${why}: won ${got.won} vs ${r.site1 > 0}`);
              }
            }
          }
        }
      }
    }
    check('the debris block agrees: the three ticks, the toggle, both flags and $1FFF',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} cases, ${wins} of them taking the staged win at $10A7`);
  }

  // The question this port left open, answered by running it.
  console.log('\n=== how the base star actually dies ===');
  {
    const r = JSON.parse(await a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const snap = {}; for (const a of [0x1FF7, 0x1FFF, 0x0933, 0x814B, 0x093E]) snap[a] = rd(a);
      const before = cpu.getState();
      wr(0x1FF7, 15); wr(0x1FFF, 0); wr(0x0933, 0); wr(0x814B, 0); wr(0x093E, 0);
      const st = cpu.getState(); st.pc = ${FRAME_TOP}; st.sp = 0xF8; cpu.setState(st);
      let site1 = 0, site2 = 0, frames = 0, ended = false;
      cpu.stepCyclesDebug(60000000, () => {
        const pc = cpu.getPC();
        if (pc === ${FRAME_TOP}) frames++;
        if (pc === 0x10A7) site1++;
        if (pc === 0x112A) site2++;
        if (pc === 0x112D) { ended = true; return true; }
        if (frames > 60) return true;
      });
      const out = { site1, site2, frames, ended, baseStar: rd(0x1FFF) };
      for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
      cpu.setState(before);
      return out;
    })())`));
    check('a won mission fires BOTH increments, and $1FFF ends at two',
      r.site1 === 1 && r.site2 === 1 && r.baseStar === 2 && r.ended,
      `$10A7 once and $112A once over ${r.frames} frames - the staged win does not end the`
        + ' mission, $10AA carries it on until the field empties');
    check('which means the ten thousand for the base star is never paid',
      r.baseStar !== 1,
      'SD PART3 line 175 tests = 0 so it is a win, but INITIALS line 2016 tests = 1 for the'
        + ' bonus, and the byte holds 2. Reproduced, not worked around');
  }

  // ------------------------------------------------- the awards, and the one-bit difference
  console.log('\n=== the two award blocks ===');
  {
    const run = (addr, stop, pokes) => a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const WATCH = [${PROGRESS}, 0x093F, 0x0940, ${ROTATED}];
      const before = cpu.getState();
      const snap = {}; for (const a of WATCH) snap[a] = rd(a);
      for (const [a, v] of Object.entries(${JSON.stringify(pokes)})) wr(Number(a), v & 0xff);
      const seeded = {}; for (const a of WATCH) seeded[a] = rd(a);
      const st = cpu.getState(); st.pc = ${addr}; cpu.setState(st);
      const calls = [];
      cpu.stepCyclesDebug(400000, () => {
        const pc = cpu.getPC();
        if ([0x119E, 0x1755, 0x1278, 0x120B, 0x175B, 0x12B4].includes(pc)) calls.push(pc);
        if (pc === ${stop}) return true;
      });
      const after = {}; for (const a of WATCH) after[a] = rd(a);
      for (const [a, v] of Object.entries(snap)) wr(Number(a), v);
      cpu.setState(before);
      return { seeded, after, calls };
    })())`).then(JSON.parse);

    const wrong = [];
    for (const [which, addr, stop] of [[0, 0x0F53, 0x0F64], [1, 0x0F9B, 0x0FAC]]) {
      for (const progress of [0, 1, STAGE - 1, STAGE, 255]) {
        const pokes = { [PROGRESS]: progress, 0x093F: 0, 0x0940: 0 };
        const r = await run(addr, stop, pokes);
        const mem = new Uint8Array(0x10000);
        for (const [a, v] of Object.entries(r.seeded)) mem[a] = v;
        const got = award(mem, which);
        for (const a of [PROGRESS, 0x093F, 0x0940]) {
          if (mem[a] !== r.after[a]) {
            wrong.push(`block ${which} progress ${progress}: ${hx(a)} port ${mem[a]}`
              + ` machine ${r.after[a]}`);
            break;
          }
        }
        if (got.calls.join() !== r.calls.join()) {
          wrong.push(`block ${which} progress ${progress}: calls ${got.calls} vs ${r.calls}`);
        }
      }
    }
    check('both award blocks agree: the counter, the debris load and the three calls',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || '10 cases across both, including the counter wrapping at 255');

    // The one-bit difference, run as the single instruction it is.
    const rolled = JSON.parse(await a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const out = [];
      for (const [carry, v] of [[0, 0x12], [1, 0x12], [0, 0x81], [1, 0x81], [0, 0x00]]) {
        const before = cpu.getState();
        wr(${ROTATED}, v);
        const st = cpu.getState();
        st.pc = 0x0F7E; st.x = 0x55;
        st.s = carry ? (st.s | 1) : (st.s & 0xFE);
        cpu.setState(st);
        cpu.stepCyclesDebug(20, () => cpu.getPC() !== 0x0F7E);
        const end = cpu.getState();
        out.push({ carry, v, after: rd(${ROTATED}), x: end.x });
        cpu.setState(before);
      }
      return out;
    })())`));
    const mismatched = rolled.filter((o) => rotate(o.v, o.carry).value !== o.after);
    check('$0F7E is ROL $0907, not LDX, and the port rotates the same way',
      mismatched.length === 0 && rolled.every((o) => o.x === 0x55),
      `$12 -> ${hx(rolled[0].after, 2)}, with carry in -> ${hx(rolled[1].after, 2)},`
        + ` $81 -> ${hx(rolled[2].after, 2)} - and X is left alone, so the JSR after it`
        + ' gets the previous operand');

    const bytes = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x0F36, 0x0F39))'));
    const twin = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x0F7E, 0x0F81))'));
    check('control: the mirrored instruction really is LDX, so this is one bit and not a habit',
      bytes[0] === 0xAE && twin[0] === 0x2E,
      `$0F36 is ${hx(bytes[0], 2)} (LDX abs) against $0F7E's ${hx(twin[0], 2)} (ROL abs)`);
  }

  // ----------------------------------------------------- the hit test above each award ----
  // `$142A` is `$1C3D` relocated and otherwise identical, so geometry.js's rangeFromArgs is
  // reused. What is compared here is the whole block: the four argument copies, the range,
  // and the BPL - against the machine's MATH table, byte for byte.
  console.log('\n=== the hit test ===');
  {
    const run = (from, to, award) => a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState();
      const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
      const snapR = rd(${ROTATED});
      const seeded = []; for (let i = 0; i < 0xF3; i++) seeded.push(rd(0x9800 + i));
      const st = cpu.getState(); st.pc = ${from}; cpu.setState(st);
      let hit = false, carry = 0;
      cpu.stepCyclesDebug(2000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x0F7E) carry = cpu.getState().s & 1;
        if (pc === ${award}) hit = true;
        if (pc === ${to} || pc === ${award}) return true;
      });
      const after = []; for (let i = 0; i < 0xF3; i++) after.push(rd(0x9800 + i));
      const rotated = rd(${ROTATED});
      for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
      wr(${ROTATED}, snapR);
      cpu.setState(before);
      return { seeded, after, hit, rotated, rotatedWas: snapR, carry };
    })())`).then(JSON.parse);

    const wrong = [];
    let hits = 0, n = 0;
    for (const [which, from, to, awardAt] of [[0, 0x0F21, 0x0F64, 0x0F53],
      [1, 0x0F69, 0x0FAC, 0x0F9B]]) {
      // Each pass starts from wherever the mission happens to be, so the table differs
      // every time and the comparison is against a moving target rather than one state.
      for (let i = 0; i < 6; i++) {
        await a2.ev('(() => { window.M.cpu.stepCyclesDebug(300000, () => {}); return 1; })()');
        const r = await run(from, to, awardAt);
        const math = new Math24();
        for (let k = 0; k < 0xF3; k++) math.table[k] = r.seeded[k];
        const mem = new Uint8Array(0x10000);
        mem[ROTATED] = r.rotatedWas;
        const got = hitTest(mem, math, which, { rangeFromArgs, GEOM, dir, carry: r.carry });
        n++;
        if (got.hit) hits++;
        const why = `block ${which} pass ${i}`;
        if (got.hit !== r.hit) {
          wrong.push(`${why}: port ${got.hit ? 'hit' : 'miss'}, machine`
            + ` ${r.hit ? 'hit' : 'miss'}`);
          continue;
        }
        let bad = -1;
        for (let k = 0; k < 0xF3; k++) {
          if (math.table[k] !== r.after[k]) { bad = k; break; }
        }
        if (bad >= 0) {
          wrong.push(`${why}: table[${bad}] port ${math.table[bad]} machine ${r.after[bad]}`);
        } else if (mem[ROTATED] !== r.rotated) {
          wrong.push(`${why}: $0907 port ${mem[ROTATED]} machine ${r.rotated}`);
        }
      }
    }
    check('both hit tests agree with the machine over every byte of MATH\'s table',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} passes from twelve different mission states, ${hits} of them hits`);

    // Twelve live passes and not one landed a hit, which leaves half the branch untested.
    // So the threshold is raised until everything is in range and both blocks are run again:
    // $092F's table entry set to the largest positive 24-bit value MATH holds.
    const forced = [];
    for (const [which, from, to, awardAt] of [[0, 0x0F21, 0x0F64, 0x0F53],
      [1, 0x0F69, 0x0FAC, 0x0F9B]]) {
      const idx = Number(await a2.ev('window.M.rd(0x092F)'));
      await a2.ev(`(() => { const wr = window.M.wr;
        wr(0x9800 + ${idx}, 0xFF); wr(0x9801 + ${idx}, 0xFF); wr(0x9802 + ${idx}, 0x7F);
        return 1; })()`);
      const r = await run(from, to, awardAt);
      const math = new Math24();
      for (let k = 0; k < 0xF3; k++) math.table[k] = r.seeded[k];
      const mem = new Uint8Array(0x10000);
      mem[ROTATED] = r.rotatedWas;
      const got = hitTest(mem, math, which, { rangeFromArgs, GEOM, dir, carry: r.carry });
      forced.push({ which, machine: r.hit, port: got.hit });
    }
    check('and with the threshold raised so everything is in range, both say hit',
      forced.every((f) => f.machine === true && f.port === true),
      forced.map((f) => `block ${f.which}: machine ${f.machine}, port ${f.port}`).join('; '));
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
