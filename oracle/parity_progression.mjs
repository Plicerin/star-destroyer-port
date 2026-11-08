// The port's outer loop against the Applesoft that is the outer loop.
//
// There is no machine in this one, and that is the point. The four decisions that shape a game
// are four Applesoft lines on the disk, so the port is held against **the lines themselves**:
// each condition is parsed out of the detokenised program into a tiny expression tree and
// evaluated independently, and then the port's `next()` is compared against it over the whole
// of the state space those lines can see. A transcription error in chain.js cannot survive
// that, because the thing it is compared to was never transcribed.
//
// Then complete games are played in the port with a seeded generator, and their shape is
// checked against what the lines say it should be: the right number of flights, a starbase
// between each, the last one flagged, and a terminal that is MONOLITH or WIN.
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { IFACE, DEAD, LAST_FLIGHT, BONUS_CAP, BONUS_UNIT, BASE_STAR_BONUS, KILL_VALUE,
  selectTarget, rollWaves, starbaseScore, finalScore, next, CHAIN, RESETS }
  from '../port/src/game/chain.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const PROGRAMS = {};
for (const f of d.files.filter((x) => String(x.type).startsWith('APPLESOFT'))) {
  try {
    const raw = d.read(f);
    const mem = new Uint8Array(0x10000);
    for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
    PROGRAMS[f.name] = listProgram(mem, 0x801);
  } catch (e) { /* probe_chain reports the ones that do not */ }
}
const line = (name, num) => (PROGRAMS[name] || []).find((l) => l.num === num)?.text || '';

/**
 * Parse an Applesoft `IF` condition of the shape these four lines use, and return something
 * that evaluates it against a memory image.
 *
 * The grammar is small because the lines are: terms of `PEEK(n) OP x`, where OP is `>`, `=`
 * or Applesoft's `=>`, and x is a number or another PEEK, joined by OR. Anything outside that
 * throws rather than being guessed at.
 */
function condition(text) {
  const m = text.match(/^IF\s+(.+?)\s*THEN\b/);
  if (!m) throw new Error(`not an IF line: ${text}`);
  const terms = m[1].split(/\s+OR\s+/).map((t) => {
    const p = t.trim().match(/^PEEK\(\s*(\d+)\s*\)\s*(=\s*>|>|<|=)\s*(PEEK\(\s*(\d+)\s*\)|\d+)$/);
    if (!p) throw new Error(`cannot parse the term "${t.trim()}" of: ${text}`);
    const left = Number(p[1]);
    const op = p[2].replace(/\s+/g, '');
    const right = p[3].startsWith('PEEK') ? { peek: Number(p[4]) } : Number(p[3]);
    return (mem) => {
      const a = mem[left];
      const b = typeof right === 'number' ? right : mem[right.peek];
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '=') return a === b;
      return a >= b;                             // Applesoft writes >= as =>
    };
  });
  return (mem) => terms.some((t) => t(mem));
}

// --- the four decisions, against the four lines ------------------------------------------------
console.log('\n=== the four decisions, against the lines they come from ===');
const COND = {};
{
  const bad = [];
  for (const [key, name, num] of [['dead', 'SD PART2', 172], ['done', 'SD PART2', 175],
    ['last', 'STARBASE', 220], ['lost', 'SD PART3', 175]]) {
    try {
      COND[key] = condition(line(name, num));
    } catch (e) {
      bad.push(`${name} ${num}: ${e.message}`);
    }
  }
  check('all four conditions parse out of the detokenised programs',
    bad.length === 0 && Object.keys(COND).length === 4, bad.join('; ')
      || 'SD PART2 172 and 175, STARBASE 220, SD PART3 175');
}
{
  // SD PART2's two tests, over the whole of what they can see. $00 is not in the 64K image
  // the port is handed, so it comes in as a signal - which is itself worth checking, because
  // getting it from memory would be wrong.
  const bad = [];
  let toDead = 0, toLast = 0, toAgain = 0, boundary = 0, total = 0;
  for (const w0 of [0, 1, 3]) {
    for (const w1 of [0, 2]) {
      for (const w2 of [0, 5]) {
        for (const zp of [0, DEAD, 76, 78]) {
          for (const flights of [0, 4, 5, 6, 15]) {
            for (const target of [5, 6, 15]) {
              const mem = new Uint8Array(65536);
              mem[IFACE.waves[0]] = w0;
              mem[IFACE.waves[1]] = w1;
              mem[IFACE.waves[2]] = w2;
              mem[IFACE.flights] = flights;
              mem[IFACE.target] = target;
              mem[0] = zp;
              const got = next('SD PART2', mem, { zeroPage: zp });
              const want = COND.dead(mem) ? 'MONOLITH'
                : COND.done(mem) ? 'HYPERDRIVE 3' : 'HYPERDRIVE1';
              if (got !== want) {
                bad.push(`waves ${w0}/${w1}/${w2} $00 ${zp} ${flights}>=${target}:`
                  + ` ${got} not ${want}`);
              }
              total++;
              if (want === 'MONOLITH') toDead++;
              else if (want === 'HYPERDRIVE 3') toLast++;
              else toAgain++;
              // The boundary the `=>` turns on: as many flown as asked for, and nothing else
              // sending it to the scores. A strict `>` would send these to another flight.
              if (want === 'HYPERDRIVE 3' && flights === target) boundary++;
            }
          }
        }
      }
    }
  }
  check('SD PART2 agrees on every state its two lines can distinguish',
    bad.length === 0 && toDead > 0 && toLast > 0 && toAgain > 0 && boundary > 0,
    bad.slice(0, 2).join('; ')
      || `${total} states: ${toDead} to the scores, ${toLast} to the last flight,`
        + ` ${toAgain} to another - ${boundary} of them with flights exactly equal to the`
        + ' target, which is the case the => exists for');

  // The other two, likewise.
  const bad2 = [];
  for (const v of [0, 1, 2, 119, 120, 121, 255]) {
    const mem = new Uint8Array(65536);
    mem[IFACE.lastFlight] = v;
    const got = next('STARBASE', mem, {});
    const want = COND.last(mem) ? 'HYPERDRIVE 4' : 'HYPERDRIVE2';
    if (got !== want) bad2.push(`$1FF3 = ${v}: ${got} not ${want}`);
    const m2 = new Uint8Array(65536);
    m2[IFACE.baseStar] = v;
    const g2 = next('SD PART3', m2, {});
    const w2 = COND.lost(m2) ? 'MONOLITH' : 'WIN';
    if (g2 !== w2) bad2.push(`$1FFF = ${v}: ${g2} not ${w2}`);
  }
  check('and STARBASE and SD PART3 agree across the whole byte, not just the two values used',
    bad2.length === 0, bad2.slice(0, 2).join('; ')
      || '$1FF3 is an equality against 120 and $1FFF an equality against 0, so 121 and 2 go'
        + ' the other way from what "the last flight" and "lost" would suggest');
}

// --- a whole game ------------------------------------------------------------------------------
console.log('\n=== complete games, played in the port ===');
{
  /** Applesoft's RND, stood in for by something seeded so a failure can be reproduced. */
  let seed = 0x1FF31FFF;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return seed / 0x80000000;
  };

  /**
   * Play one game. `survive` decides whether each flight is cleared, and `baseStar` whether
   * the finale is won. Every transition goes through the port's own `next`.
   */
  function play(difficulty, survive, baseStar) {
    const mem = new Uint8Array(65536);
    for (const a of RESETS.SELECT()) mem[a] = 0;
    mem[IFACE.difficulty] = difficulty;
    mem[IFACE.target] = selectTarget(difficulty, rnd);
    const visited = [];
    let program = 'SD';
    let flights = 0, starbases = 0, scores = [];
    for (let guard = 0; guard < 200; guard++) {
      visited.push(program);
      if (program === 'SD START') for (const a of RESETS['SD START']()) mem[a] = 0;
      if (program === 'SD START2') for (const a of RESETS['SD START2']()) mem[a] = 0;
      // The two programs that fly: the binary bumps $1FF5 and eats the waves.
      if (program === 'SD PART2') {
        const waves = rollWaves(mem[IFACE.difficulty], rnd);
        IFACE.waves.forEach((a, i) => { mem[a] = waves[i]; });
        mem[IFACE.flights] = (mem[IFACE.flights] + 1) & 0xff;      // $09A0
        flights++;
        if (survive(flights)) {
          // A cleared wave: all three counters down to zero, and some kills banked.
          IFACE.waves.forEach((a) => { mem[a] = 0; });
          IFACE.kills.forEach((a, i) => { mem[a] = (mem[a] + waves[i]) & 0xff; });
          mem[0] = 0;
        } else {
          mem[0] = DEAD;
        }
      }
      if (program === 'SD PART3') {
        mem[IFACE.flights] = (mem[IFACE.flights] + 1) & 0xff;
        mem[IFACE.baseStar] = baseStar ? 1 : 0;
      }
      if (program === 'STARBASE') {
        starbases++;
        scores.push(starbaseScore(mem).score);
      }
      // A game ends at INITIALS. The disk does not stop there - line 6000 is `RUN START` and
      // the next game begins - so the walk has to stop itself rather than wait for a chain
      // that has no end. `probe_chainwalk.mjs` is what holds the loop closing.
      if (program === 'INITIALS') break;
      const to = next(program, mem, { zeroPage: mem[0], key: true });
      if (to === null) break;
      program = to;
    }
    return { mem, visited, flights, starbases, scores, target: mem[IFACE.target] };
  }

  // A game you win: every flight cleared, and the base star killed.
  const bad = [];
  for (const difficulty of [1, 2, 3]) {
    const g = play(difficulty, () => true, true);
    const last = g.visited[g.visited.length - 1];
    if (last !== 'INITIALS') bad.push(`difficulty ${difficulty} ended at ${last}`);
    if (g.visited[g.visited.length - 2] !== 'WIN') {
      bad.push(`difficulty ${difficulty} did not go through WIN`);
    }
    // The number of ordinary flights is the target, and the finale is one more.
    if (g.flights !== g.target) {
      bad.push(`difficulty ${difficulty}: ${g.flights} flights against a target of ${g.target}`);
    }
    // A starbase after every one of them.
    if (g.starbases !== g.target) {
      bad.push(`difficulty ${difficulty}: ${g.starbases} starbases for ${g.flights} flights`);
    }
    // And the last ordinary flight is the one that sets the flag.
    if (g.mem[IFACE.lastFlight] !== LAST_FLIGHT) {
      bad.push(`difficulty ${difficulty}: $1FF3 is ${g.mem[IFACE.lastFlight]}`);
    }
    console.log(`  difficulty ${difficulty}: ${g.target} flights, ${g.starbases} starbases,`
      + ` ${g.visited.length} programs, final score ${finalScore(g.mem)}`);
  }
  check('a won game is target flights, a starbase after each, then the base star and WIN',
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'and $1FF3 ends at 120, set by HYPERDRIVE 3 on the way to the last starbase');

  // A game you lose, at each possible point.
  const bad2 = [];
  for (const dieOn of [1, 2, 3]) {
    const g = play(2, (n) => n !== dieOn, false);
    const last = g.visited[g.visited.length - 1];
    if (last !== 'INITIALS' || g.visited[g.visited.length - 2] !== 'MONOLITH') {
      bad2.push(`dying on flight ${dieOn} ended ${g.visited.slice(-2).join(' -> ')}`);
    }
    if (g.flights !== dieOn) bad2.push(`dying on flight ${dieOn} flew ${g.flights}`);
  }
  // And losing the finale.
  const lost = play(1, () => true, false);
  if (lost.visited[lost.visited.length - 2] !== 'MONOLITH') {
    bad2.push('losing the base star did not go through MONOLITH');
  }
  check('and dying on any flight, or losing the finale, ends at the high scores',
    bad2.length === 0, bad2.slice(0, 2).join('; ')
      || 'MONOLITH then INITIALS either way - the two failures share a door');

  // The bonus accumulates, and the cap is what holds it down.
  const g = play(3, () => true, true);
  const banked = g.mem[IFACE.bonus];
  const capped = g.target * BONUS_CAP;
  check('the starbase bonus accumulates across visits, capped at five a visit',
    banked > 0 && banked <= capped && g.scores.every((v, i) => i === 0 || v >= g.scores[i - 1]),
    `${g.target} visits banked ${banked} units of ${BONUS_UNIT}, at most ${capped} -`
      + ' and the running score never goes down');
  const without = g.mem.slice();
  without[IFACE.baseStar] = 0;
  const kills = IFACE.kills.reduce((n, a, i) => n + g.mem[a] * KILL_VALUE[i], 0);
  check('and the base star is worth ten thousand on top of all of it',
    finalScore(g.mem) - finalScore(without) === BASE_STAR_BONUS
      && finalScore(without) === kills + banked * BONUS_UNIT,
    finalScore(g.mem) + ' with it, ' + finalScore(without) + ' without - and the rest of it'
      + ' is ' + kills + ' of kills and ' + banked + ' x ' + BONUS_UNIT + ' of bonus');
}

// --- the wrong ports ---------------------------------------------------------------------------
console.log('\n=== controls: four plausible wrong ports ===');
{
  const states = [];
  for (const flights of [0, 4, 5, 6]) {
    for (const target of [5, 6]) {
      for (const zp of [0, DEAD]) {
        for (const w of [0, 1]) {
          const mem = new Uint8Array(65536);
          mem[IFACE.flights] = flights;
          mem[IFACE.target] = target;
          mem[IFACE.waves[0]] = w;
          mem[0] = zp;
          states.push(mem);
        }
      }
    }
  }
  const truth = (mem) => (COND.dead(mem) ? 'MONOLITH'
    : COND.done(mem) ? 'HYPERDRIVE 3' : 'HYPERDRIVE1');
  const CONTROLS = {
    'a strict > where the line has =>': (mem) => (COND.dead(mem) ? 'MONOLITH'
      : mem[IFACE.flights] > mem[IFACE.target] ? 'HYPERDRIVE 3' : 'HYPERDRIVE1'),
    'the whole of 172 dropped': (mem) => (
      mem[IFACE.flights] >= mem[IFACE.target] ? 'HYPERDRIVE 3' : 'HYPERDRIVE1'),
    'the wave test forgotten': (mem) => (mem[0] === DEAD ? 'MONOLITH'
      : mem[IFACE.flights] >= mem[IFACE.target] ? 'HYPERDRIVE 3' : 'HYPERDRIVE1'),
    'the two branches the other way round': (mem) => (
      mem[IFACE.flights] >= mem[IFACE.target] ? 'HYPERDRIVE 3'
        : COND.dead(mem) ? 'MONOLITH' : 'HYPERDRIVE1'),
  };
  for (const [name, fn] of Object.entries(CONTROLS)) {
    let caught = 0;
    for (const mem of states) if (fn(mem) !== truth(mem)) caught++;
    check(`control: ${name} fails`, caught > 0, `${caught} of ${states.length}`);
  }
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
