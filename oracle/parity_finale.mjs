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
  secondEight, debrisFrame, DEBRIS, DEBRIS_WIN, TOGGLE, ONE_SHOTS, DAMAGE_FLAGS, award,
  rotate, ROTATED, ROTATED_INDICES, hitTest, AIM_SCRATCH, aimAndFire, shotAdvance,
  enter, ENTRY_HIT_RANGE, reached, WAVE3 }
  from '../port/src/game/finale.js';
import { shrink } from '../port/src/game/damage.js';
import { Math24 } from '../port/src/game/math.js';
import { field } from '../port/src/game/objects.js';
import { VARS } from '../port/src/game/tables.js';
import { BEARING, dispatch, CLASSES } from '../port/src/game/dispatch.js';
import { publishShip } from '../port/src/game/loop.js';
import { VAR } from '../port/src/game/tables.js';
import { missile } from '../port/src/game/entities.js';
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
    // The two damage flags and the four bytes their calls reach are watched too, because the
    // block does not end at $10AD: it runs on to $10E4 and services them there.
    const WATCH = [0x093E, 0x093F, 0x0940, 0x0947, 0x094B, 0x0945, 0x1FFF, 0x8289, 0x8165,
      0x0942, 0x0941, 0x81DD, 0x81F3, 0x8209, 0x0933, 0x0000];
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
        // $10E5 is the way out - the first instruction of the block above. $10AD was listed
        // here once, which stopped the run 22 instructions early and took both calls into the
        // damage code out of scope.
        if (pc === 0x10E5) return true;
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
  //
  // Classes 2 and 3 used to be given 0 and 2 only, both under the threshold of three, so
  // nothing here ever ran past `$10AD` and the port's missing tail went unnoticed for it. The
  // counters now straddle the threshold and both damage flags are set, so every branch of the
  // block is reached by something.
  console.log('\n=== the debris block ===');
  {
    const wrong = [];
    let n = 0, wins = 0, hits = 0, resets = 0;
    for (const d1 of [0, 1, 3, 4, 255]) {
      for (const d2 of [0, 2, 3]) {
        for (const d3 of [0, 4]) {
          for (const toggle of [0, 1]) {
            for (const flags of [[0, 0], [1, 1]]) {
              for (const hurt of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const pokes = { [DEBRIS[0]]: d1, [DEBRIS[1]]: d2, [DEBRIS[2]]: d3,
                  [TOGGLE]: toggle, [ONE_SHOTS[0].flag]: flags[0],
                  [ONE_SHOTS[1].flag]: flags[1], [BASE_STAR]: 0,
                  [DAMAGE_FLAGS[0].flag]: hurt[0], [DAMAGE_FLAGS[1].flag]: hurt[1],
                  // Shield, warp and missiles full and the hit count clear, so the ordinary
                  // damage path runs rather than the fatal one - the three checks above
                  // already drive that directly.
                  [SHLD]: 0xFF, [WARP]: 0xFF, [MSL]: 0xFF, [HITS]: 0 };
                const r = await frame(pokes);
                const mem = new Uint8Array(0x10000);
                for (const [a, v] of Object.entries(r.seeded)) mem[a] = v;
                const got = debrisFrame(mem, shrink);
                n++;
                if (got.won) wins++;
                if (hurt[0] || hurt[1]) hits++;
                if (d2 >= DEBRIS_WIN || d3 >= DEBRIS_WIN) resets++;
                const why = `debris ${d1}/${d2}/${d3} toggle ${toggle} flags ${flags}`
                  + ` hurt ${hurt}`;
                const watched = [...DEBRIS, TOGGLE, ONE_SHOTS[0].flag, ONE_SHOTS[1].flag,
                  BASE_STAR, DAMAGE_FLAGS[0].flag, DAMAGE_FLAGS[1].flag, SHLD, WARP, MSL,
                  HITS];
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
    }
    check('the debris block agrees, all the way to $10E4',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} cases: ${wins} take the staged win at $10A7, ${resets} clear a counter at`
          + ` $10AD or $10BC, and ${hits} carry damage into $1486 or $14EE`);
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
        // `rotatedIndices` because the machine is running the damaged copy: $0F7E is a ROL
        // there. The repair is the port's default and the check below is what holds it.
        const got = hitTest(mem, math, which,
          { rangeFromArgs, GEOM, dir, carry: r.carry, rotatedIndices: true });
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

  // ---------------------------------------------------------- the two rotated indices ------
  // `$0F7E` and `$101C` are `ROL abs` where the main mission has `LDX abs` on the same
  // operand, and both operands are directory entries - table offsets that the instruction
  // after them uses as an index. So each pass rotates the index instead of loading it, and
  // what that does is measurable: after a mission has been running, those two bytes and only
  // those two no longer hold what the build put there.
  console.log('\n=== the two rotated indices ===');
  let intact = null;
  {
    const live = JSON.parse(await a2.ev(`JSON.stringify((() => {
      const rd = window.M.rd;
      const out = []; for (let i = 0; i < 65; i++) out.push(rd(0x08F2 + i));
      return out;
    })())`));
    const off = live.map((v, i) => ({ at: 0x08F2 + i, is: v, want: VARS[i] }))
      .filter((x) => x.is !== x.want);
    check('the directory is damaged at exactly the two bytes the ROLs name',
      off.length === ROTATED_INDICES.length
        && ROTATED_INDICES.every((r) => off.some((x) => x.at === r.operand)),
      off.map((x) => `${hx(x.at)} is ${x.is} not ${x.want}`).join(', ')
        + ' - and the other 63 entries are what the build holds, so it is these instructions'
        + ' and not the mission writing over its own variables');

    // And the other side of it: the main mission has the instruction intact, same operand.
    const bytes = JSON.parse(await a2.ev('JSON.stringify(['
      + ROTATED_INDICES.map((r) => `window.M.rd(${r.at})`).join(',') + '])'));
    check('each one is a ROL here and an LDX in the main mission, on the same operand',
      bytes.every((b) => b === 0x2E),
      ROTATED_INDICES.map((r, i) => `${hx(r.at)} is ${hx(bytes[i], 2)} against`
        + ` ${hx(r.twin)}'s $AE`).join(', ')
        + ' - one bit, and probe_basestar.mjs reads the twins off the disk');

    // Putting the two bytes back is the repair, and it is what the port does by default.
    intact = () => a2.ev('(() => { const wr = window.M.wr; '
      + ROTATED_INDICES.map((r) => `wr(${r.operand}, ${VARS[r.operand - 0x08F2]});`).join('')
      + ' return 1; })()');
  }

  // --------------------------------------------- the base star taking aim and shooting back
  // `$0D5F`-`$0E2B` is `dispatch.js`'s `$0D5B` four bytes along, on class 3's fields, with
  // four candidate headings instead of two and the probe done in scratch. What is compared is
  // the whole block: every display-list operand it writes, both cooldowns, and the MATH table
  // byte for byte, since firing copies the base star's position and divides out its step.
  //
  // The block holds no ROL, so this runs with the directory put back - the port's own
  // configuration on both sides. The check above is what says the two bytes needed it.
  console.log('\n=== the base star shoots back ===');
  {
    const HEADING = field(3, 'heading');
    const SITES = [HEADING, field(15, 'heading'), AIM_SCRATCH, field(5, 'count'),
      field(17, 'count'), 0x0945, 0x093A, 0x0939, 0x0949, field(5, 'heading'),
      field(5, 'y'), field(5, 'y') + 1, TOGGLE];
    await a2.ev(`(() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const SITES = ${JSON.stringify(SITES)};
      window.M.aim = (pokes) => {
        const before = cpu.getState();
        const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
        const snapS = {}; for (const a of SITES) snapS[a] = rd(a);
        for (const [a, v] of Object.entries(pokes)) wr(Number(a), v & 0xff);
        const seededT = []; for (let i = 0; i < 0xF3; i++) seededT.push(rd(0x9800 + i));
        const seededS = {}; for (const a of SITES) seededS[a] = rd(a);
        const st = cpu.getState();
        st.pc = 0x0D5F; cpu.setState(st);
        let fired = false, out = false;
        cpu.stepCyclesDebug(2000000, () => {
          const pc = cpu.getPC();
          if (pc === 0x0DCE) fired = true;          // past the "already up" test
          if (pc === 0x0E2C) { out = true; return true; }   // the block's one way out
        });
        const afterT = []; for (let i = 0; i < 0xF3; i++) afterT.push(rd(0x9800 + i));
        const afterS = {}; for (const a of SITES) afterS[a] = rd(a);
        for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
        for (const [a, v] of Object.entries(snapS)) wr(Number(a), v);
        cpu.setState(before);
        return { seededT, seededS, afterT, afterS, fired, out };
      };
      return 'ok';
    })()`);
    const aim = (pokes) => a2.ev('JSON.stringify(window.M.aim('
      + JSON.stringify(pokes) + '))').then(JSON.parse);

    // `LDY $090B` reads the bearing's table index out of the directory, so the byte the block
    // compares against is table[index + 1] - the middle byte, as every other publish uses.
    const bearingAt = 0x9801 + BEARING;

    const wrong = [];
    let n = 0, fires = 0, reciprocal = 0, turns = 0, stalls = 0;
    for (const h of [0x00, 0x40, 0x7F, 0xC3]) {
      // The four candidates for each carry, so every exit of the block is reached by
      // something, plus two bearings that match none of them.
      const cands = new Set([h, (h + 1) & 0xff, (h + 0x7F) & 0xff, (h + 0x80) & 0xff,
        (h + 0x81) & 0xff, (h + 0x40) & 0xff, (h + 0xC0) & 0xff]);
      for (const b of cands) {
        for (const cooldown of [0, 3]) {
          for (const alive of [0, 20]) {
            await intact();
            const pokes = { [HEADING]: h, [bearingAt]: b, 0x093A: cooldown,
              [field(5, 'count')]: alive, [TOGGLE]: 1, 0x0939: 0, 0x0945: 0 };
            const r = await aim(pokes);
            const math = new Math24();
            for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
            const mem = new Uint8Array(0x10000);
            for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
            const got = aimAndFire(mem, math, dir);
            n++;
            if (got.action === 'fire') fires++;
            if (got.action === 'busy') stalls++;
            if (got.action === 'turn' || got.action === 'cooling') turns++;
            if (got.action === 'fire' && got.candidate === ((h + 0x80) & 0xff)) reciprocal++;
            const why = `h ${h} bearing ${b} cooldown ${cooldown} alive ${alive}`;
            let bad = r.out ? null : 'the machine never reached $0E2C';
            for (const a of SITES) {
              if (bad) break;
              if (mem[a] !== r.afterS[a]) {
                bad = `${hx(a)} port ${mem[a]} machine ${r.afterS[a]}`;
              }
            }
            for (let k = 0; k < 0xF3 && !bad; k++) {
              if (math.table[k] !== r.afterT[k]) {
                bad = `table[${k}] port ${math.table[k]} machine ${r.afterT[k]}`;
              }
            }
            if (!bad && (got.action === 'fire') !== r.fired) {
              bad = `port ${got.action}, machine ${r.fired ? 'fired' : 'did not'}`;
            }
            if (bad) wrong.push(`${why}: ${bad}`);
          }
        }
      }
    }
    check('the base star agrees: four candidates, the scratch probe, the turn and the launch',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} cases: ${fires} fire, ${turns} turn and ${stalls} find the shot already up`);
    check('and it fires on the reciprocal bearing, which no enemy in the main mission can',
      reciprocal > 0,
      `${reciprocal} of the ${fires} launches left on h + $80 - the base star shooting at a`
        + ' ship dead astern, which two candidates cannot reach');

    // The control: the main mission's dispatch, given the same inputs, has to disagree
    // somewhere - otherwise "four candidates" is not measuring anything.
    {
      let differed = 0;
      for (const h of [0x00, 0x40, 0x7F, 0xC3]) {
        for (const b of [(h + 0x80) & 0xff, (h + 0x7F) & 0xff]) {
          await intact();
          const pokes = { [HEADING]: h, [bearingAt]: b, 0x093A: 0,
            [field(5, 'count')]: 0, [TOGGLE]: 1, 0x0939: 0, 0x0945: 0 };
          const r = await aim(pokes);
          const math = new Math24();
          for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
          const mem = new Uint8Array(0x10000);
          for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
          const two = dispatch(mem, math, CLASSES[2]);
          if ((two.action === 'fire') !== r.fired) differed++;
        }
      }
      check('control: the main mission\'s two candidates disagree with the machine here',
        differed > 0,
        `${differed} of 8 bearings where class 3's dispatch does not fire and the base star`
          + ' does - the reciprocal pair, which is the difference between the two blocks');
    }
  }

  // ------------------------------------------------------- the shot, one frame at a time ---
  // `$0FAC`-`$103D` is `entities.js`'s missile block with the bank spin added and `$101C`
  // rotating `$0914` instead of loading it. The machine executes that ROL whatever the byte
  // holds, so this is the one place the port has to be asked for what the copy does.
  console.log('\n=== the base star\'s shot in flight ===');
  {
    const SITES = [field(5, 'count'), field(17, 'count'), field(5, 'bank'), field(5, 'x'),
      field(5, 'x') + 1, field(5, 'z'), field(5, 'z') + 1, field(17, 'x'), field(17, 'x') + 1,
      field(17, 'z'), field(17, 'z') + 1, 0x0941, 0x0914];
    await a2.ev(`(() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const SITES = ${JSON.stringify(SITES)};
      window.M.shot = (pokes) => {
        const before = cpu.getState();
        const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
        const snapS = {}; for (const a of SITES) snapS[a] = rd(a);
        for (const [a, v] of Object.entries(pokes)) wr(Number(a), v & 0xff);
        const seededT = []; for (let i = 0; i < 0xF3; i++) seededT.push(rd(0x9800 + i));
        const seededS = {}; for (const a of SITES) seededS[a] = rd(a);
        const st = cpu.getState();
        st.pc = 0x0FAC; cpu.setState(st);
        let out = false, carry = 0;
        cpu.stepCyclesDebug(2000000, () => {
          const pc = cpu.getPC();
          // The bit $101C rotates in, read where the ROL is about to run.
          if (pc === 0x101C) carry = cpu.getState().s & 1;
          if (pc === 0x1046 || pc === 0x103E) { out = true; return true; }
        });
        const afterT = []; for (let i = 0; i < 0xF3; i++) afterT.push(rd(0x9800 + i));
        const afterS = {}; for (const a of SITES) afterS[a] = rd(a);
        for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
        for (const [a, v] of Object.entries(snapS)) wr(Number(a), v);
        cpu.setState(before);
        return { seededT, seededS, afterT, afterS, out, carry };
      };
      return 'ok';
    })()`);
    const shot = (pokes) => a2.ev('JSON.stringify(window.M.shot('
      + JSON.stringify(pokes) + '))').then(JSON.parse);

    const wrong = [];
    let n = 0, flew = 0, spun = 0;
    for (const alive of [0, 1, 20]) {
      for (const bank of [0, 0xFE]) {
        // Each pass starts from wherever the mission is, so the step and the position differ
        // every time rather than being one state dressed up as several.
        for (let i = 0; i < 3; i++) {
          await a2.ev('(() => { window.M.cpu.stepCyclesDebug(200000, () => {}); return 1; })()');
          await intact();
          const r = await shot({ [field(5, 'count')]: alive, [field(5, 'bank')]: bank,
            0x0941: 0 });
          const math = new Math24();
          for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
          const mem = new Uint8Array(0x10000);
          for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
          const got = shotAdvance(mem, math, dir,
            { missile, rotatedIndices: true, carry: r.carry });
          n++;
          if (got.flying) flew++;
          if (got.flying && mem[field(5, 'bank')] !== r.seededS[field(5, 'bank')]) spun++;
          const why = `alive ${alive} bank ${bank} pass ${i}`;
          let bad = r.out ? null : 'the machine never left the block';
          for (const a of SITES) {
            if (bad) break;
            if (mem[a] !== r.afterS[a]) {
              bad = `${hx(a)} port ${mem[a]} machine ${r.afterS[a]}`;
            }
          }
          for (let k = 0; k < 0xF3 && !bad; k++) {
            if (math.table[k] !== r.afterT[k]) {
              bad = `table[${k}] port ${math.table[k]} machine ${r.afterT[k]}`;
            }
          }
          if (bad) wrong.push(`${why}: ${bad}`);
        }
      }
    }
    check('the shot agrees: the step, the roll, both publishes and the hit test',
      wrong.length === 0, wrong.slice(0, 2).join('; ')
        || `${n} cases, ${flew} with the shot up and ${spun} of those turning its bank`);

    // The control: the repaired reading has to disagree, or `rotatedIndices` is not a switch
    // between two different programs and the repair is not a repair.
    {
      let differed = 0, n2 = 0;
      for (let i = 0; i < 4; i++) {
        await a2.ev('(() => { window.M.cpu.stepCyclesDebug(200000, () => {}); return 1; })()');
        await intact();
        const r = await shot({ [field(5, 'count')]: 20, 0x0941: 0 });
        const mk = () => {
          const math = new Math24();
          for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
          const mem = new Uint8Array(0x10000);
          for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
          return { math, mem };
        };
        const asFound = mk(), repaired = mk();
        shotAdvance(asFound.mem, asFound.math, dir,
          { missile, rotatedIndices: true, carry: r.carry });
        shotAdvance(repaired.mem, repaired.math, dir, { missile, rotatedIndices: false });
        n2++;
        if ([...asFound.math.table].some((v, k) => v !== repaired.math.table[k])) differed++;
      }
      check('control: the repaired reading of $101C gives a different answer',
        differed > 0,
        `${differed} of ${n2} passes where putting LDX back changes MATH's table - the shot's`
          + ' own Z going into the range instead of a value belonging to the ship');
    }
  }

  // ------------------------------------------------------------------- the entry -----------
  // `$0957`-`$09A6`, which runs once before the frame does: the hit range, the stage counter,
  // the keyboard strobe, both hi-res pages, the toggle, and the viewer's X. The renderer is
  // counted rather than run - the oracle's A2-3D2 is the real one and draws into the real
  // pages, so what is compared is the state the entry leaves and how many times it rendered.
  console.log('\n=== the entry ===');
  {
    // $811A/$811B and object 12's Z are in here so the control below has the machine's own
    // values for them, not an empty image's.
    const SITES = [0x1FF7, 0x8110, 0x8112, 0x8114, TOGGLE, 0x8116, 0x8117, 0x8249, 0x824A,
      0x811A, 0x811B, field(12, 'z'), field(12, 'z') + 1];
    const r = JSON.parse(await a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const SITES = ${JSON.stringify(SITES)};
      const before = cpu.getState();
      const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
      const snapS = {}; for (const a of SITES) snapS[a] = rd(a);
      const seededT = []; for (let i = 0; i < 0xF3; i++) seededT.push(rd(0x9800 + i));
      const seededS = {}; for (const a of SITES) seededS[a] = rd(a);
      const st = cpu.getState();
      st.pc = 0x0957; cpu.setState(st);
      let renders = 0, out = false;
      cpu.stepCyclesDebug(20000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x6000) renders++;
        if (pc === 0x09A7) { out = true; return true; }   // the frame starts here
      });
      const afterT = []; for (let i = 0; i < 0xF3; i++) afterT.push(rd(0x9800 + i));
      const afterS = {}; for (const a of SITES) afterS[a] = rd(a);
      for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
      for (const [a, v] of Object.entries(snapS)) wr(Number(a), v);
      cpu.setState(before);
      return { seededT, seededS, afterT, afterS, renders, out };
    })())`));

    const math = new Math24();
    for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
    const mem = new Uint8Array(0x10000);
    for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
    let renders = 0;
    const got = enter(mem, math, dir, { render: () => { renders += 1; } });

    const bad = [];
    for (const a of SITES) {
      if (mem[a] !== r.afterS[a]) bad.push(`${hx(a)} port ${mem[a]} machine ${r.afterS[a]}`);
    }
    for (let k = 0; k < 0xF3; k++) {
      if (math.table[k] !== r.afterT[k]) {
        bad.push(`table[${k}] port ${math.table[k]} machine ${r.afterT[k]}`);
      }
    }
    check('the entry agrees: the hit range, both pages, the toggle and the viewer\'s X',
      r.out && bad.length === 0 && renders === r.renders && got.renders === r.renders,
      bad.slice(0, 3).join('; ')
        || `${r.renders} renders, and it leaves the machine on $09A7 - the frame's first`
          + ' instruction, which is loop.js\'s $09A3');

    check('and it is fifteen it writes, into the middle byte of $092F\'s entry',
      r.afterT[(dir(0x092F) + 1) & 0xff] === ENTRY_HIT_RANGE
        && r.afterT[dir(0x092F)] === r.seededT[dir(0x092F)],
      `table[${(dir(0x092F) + 1) & 0xff}] is ${r.afterT[(dir(0x092F) + 1) & 0xff]} and the low`
        + ` byte is still ${r.afterT[dir(0x092F)]} - the integer part set and the fraction`
        + ' left alone');

    // The control: publishing both axes rather than X alone has to disagree, or "X alone" is
    // not a reading of $0992 - it is just what the code happens to do with Z.
    //
    // The ship's Z entry is moved first, because the live mission has already published Z
    // this frame: republishing the same value writes the same bytes, so without the nudge
    // this control could not fail whatever the entry did.
    {
      const zSites = [0x811A, 0x811B, field(12, 'z'), field(12, 'z') + 1];
      const nudge = (m) => { m.table[(VAR.posZ + 1) & 0xff] ^= 0x55; };
      const image = () => {
        const m = new Math24();
        for (let k = 0; k < 0xF3; k++) m.table[k] = r.seededT[k];
        nudge(m);
        const w = new Uint8Array(0x10000);
        for (const [a, v] of Object.entries(r.seededS)) w[a] = v;
        return { m, w };
      };
      const xOnly = image();
      enter(xOnly.w, xOnly.m, dir, { render: () => {} });
      const both = image();
      enter(both.w, both.m, dir, { render: () => {} });
      publishShip(both.w, both.m);

      const machineLeftAlone = zSites.every((a) => r.afterS[a] === r.seededS[a]);
      const entryLeftAlone = zSites.every((a) => xOnly.w[a] === r.seededS[a]);
      const moved = zSites.filter((a) => both.w[a] !== xOnly.w[a]);
      check('control: publishing Z as well disagrees with the machine',
        machineLeftAlone && entryLeftAlone && moved.length > 0,
        `the machine and the entry both leave ${zSites.map((a) => hx(a)).join(', ')} as they`
          + ` found them, and publishing Z moves ${moved.map((a) => hx(a)).join(', ')}`);
    }
  }

  // ------------------------------------------------------------ the hit test's boundary ----
  // `$0F96 JSR $99D2 / BPL` is the whole decision, and `BPL` is taken when the answer is
  // zero - so **a range exactly equal to the threshold is not a hit**. Every case above is
  // well clear of the boundary, so none of them can tell the difference between that and
  // "equality included", which is what this file claimed for the first version of `hitTest`.
  //
  // The range is computed inside the block, so the way to stand on the boundary is to let the
  // block compute it and then set the threshold to the answer.
  console.log('\n=== the hit test at exactly the threshold ===');
  {
    const HIT = dir(0x092F), RANGE = dir(0x090A);
    const once = (threshold) => a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState();
      const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
      const t = ${JSON.stringify(threshold)};
      if (t) for (let k = 0; k < 3; k++) wr(0x9800 + ${HIT} + k, t[k]);
      const seeded = []; for (let i = 0; i < 0xF3; i++) seeded.push(rd(0x9800 + i));
      const st = cpu.getState(); st.pc = 0x0F21; cpu.setState(st);
      let hit = false;
      cpu.stepCyclesDebug(2000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x0F53) hit = true;
        if (pc === 0x0F64 || pc === 0x0F53) return true;
      });
      const range = [rd(0x9800 + ${RANGE}), rd(0x9801 + ${RANGE}), rd(0x9802 + ${RANGE})];
      const after = []; for (let i = 0; i < 0xF3; i++) after.push(rd(0x9800 + i));
      for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
      cpu.setState(before);
      return { seeded, after, hit, range };
    })())`).then(JSON.parse);

    // First pass: learn what range the block computes from where the mission is.
    const probe = await once(null);
    // Second pass: the same state, with the threshold set to exactly that range.
    const edge = await once(probe.range);

    const math = new Math24();
    for (let k = 0; k < 0xF3; k++) math.table[k] = edge.seeded[k];
    const mem = new Uint8Array(0x10000);
    const got = hitTest(mem, math, 0, { rangeFromArgs, GEOM, dir, rotatedIndices: true });

    const equal = [0, 1, 2].every((k) => edge.seeded[HIT + k] === probe.range[k]);
    check('the threshold really is set to the range the block computes',
      equal, `table[${HIT}..] is ${probe.range.join(',')} - the same three bytes $090A`
        + ' came back with, so the compare stands exactly on zero');
    check('and equality is NOT a hit: the machine takes the BPL',
      edge.hit === false && got.hit === edge.hit,
      `machine ${edge.hit ? 'hit' : 'missed'}, port ${got.hit ? 'hit' : 'missed'} - BPL is`
        + ' taken on zero, so the award needs the range strictly inside the threshold');
  }

  // ------------------------------------------------- the base star on top of the ship -------
  // `$0E2C`-`$0E47`. The interesting parts are that the base star survives the ram, and that
  // the compare here includes the boundary where the award block's excludes it - the same two
  // variables, the same `BPL`, opposite senses. So this is driven with the threshold set
  // deliberately above, below and exactly on the range the mission has.
  console.log('\n=== the base star reaches the ship ===');
  {
    const HIT = dir(0x092F), RANGE = dir(0x090A);
    const SITES = [DAMAGE_FLAGS[0].flag, OBJ3_COUNT, field(15, 'count'), WAVE3,
      0x8131, 0x8255];
    const run = (threshold) => a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const SITES = ${JSON.stringify(SITES)};
      const before = cpu.getState();
      const snapT = []; for (let i = 0; i < 0xF3; i++) snapT.push(rd(0x9800 + i));
      const snapS = {}; for (const a of SITES) snapS[a] = rd(a);
      const t = ${JSON.stringify(threshold)};
      if (t) for (let k = 0; k < 3; k++) wr(0x9800 + ${HIT} + k, t[k]);
      const seededT = []; for (let i = 0; i < 0xF3; i++) seededT.push(rd(0x9800 + i));
      const seededS = {}; for (const a of SITES) seededS[a] = rd(a);
      const st = cpu.getState(); st.pc = 0x0E2C; cpu.setState(st);
      let rammed = false, out = false;
      cpu.stepCyclesDebug(1000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x0E3A) rammed = true;
        if (pc === 0x0E4B || pc === 0x0E48) { out = true; return true; }
      });
      const afterS = {}; for (const a of SITES) afterS[a] = rd(a);
      const range = [rd(0x9800 + ${RANGE}), rd(0x9801 + ${RANGE}), rd(0x9802 + ${RANGE})];
      for (let i = 0; i < 0xF3; i++) wr(0x9800 + i, snapT[i]);
      for (const [a, v] of Object.entries(snapS)) wr(Number(a), v);
      cpu.setState(before);
      return { seededT, seededS, afterS, rammed, out, range };
    })())`).then(JSON.parse);

    // What range the mission currently has, so the three thresholds can be placed around it.
    const now = (await run(null)).range;
    const bump = (d) => {
      const v = (now[0] | (now[1] << 8) | (now[2] << 16)) + d;
      return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
    };
    const wrong = [];
    let rams = 0, n = 0;
    for (const [name, threshold] of [['below', bump(-0x100)], ['exactly on', now],
      ['above', bump(0x100)]]) {
      const r = await run(threshold);
      const math = new Math24();
      for (let k = 0; k < 0xF3; k++) math.table[k] = r.seededT[k];
      const mem = new Uint8Array(0x10000);
      for (const [a, v] of Object.entries(r.seededS)) mem[a] = v;
      const got = reached(mem, math, { GEOM, dir });
      n++;
      if (got.reached) rams++;
      if (!r.out) { wrong.push(`${name}: the machine never left the block`); continue; }
      if (got.reached !== r.rammed) {
        wrong.push(`${name}: port ${got.reached}, machine ${r.rammed}`);
        continue;
      }
      for (const a of SITES) {
        if (mem[a] !== r.afterS[a]) {
          wrong.push(`${name}: ${hx(a)} port ${mem[a]} machine ${r.afterS[a]}`);
          break;
        }
      }
    }
    check('the reach test agrees on both sides of the threshold and exactly on it',
      wrong.length === 0 && rams === 2, wrong.slice(0, 2).join('; ')
        || `${n} thresholds, ${rams} of them a ram - so equality counts here, where the award`
          + ' block\'s identical compare rejects it');

    // And the part that makes it the base star rather than an enemy.
    {
      const r = await run(now);
      check('and the ram leaves the base star alive, where it would kill an enemy',
        r.afterS[OBJ3_COUNT] === 1 && r.afterS[field(15, 'count')] === 1
          && r.afterS[0x8131] === r.seededS[0x8131],
        `$814B and $826F come out at 1, not 0, and object 1's count at ${hx(0x8131)} is`
          + ' untouched - the main mission\'s $0E18 zeroes its enemy here');
    }
  }
} finally {
  await a2.close();
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
