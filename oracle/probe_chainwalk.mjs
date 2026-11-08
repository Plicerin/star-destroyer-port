// Can the disk be walked from its boot program to its high-score screen?
//
// Every other harness here holds one block against the machine. This one asks the question
// those cannot: **does the whole thing join up?** It runs the disk's own twenty Applesoft
// programs through `presentation.js`, runs a mission when one is `BRUN`ed, and checks the route
// the chain takes - against `chain.js`'s graph, which `parity_progression.mjs` has already held
// against the machine's BASIC line by line.
//
// So there is no emulator in here. The subject is the disk's programs and the port's driver,
// and what is new is that the two are run end to end rather than a block at a time.
//
// **It is also where the finale's binary gets dispatched.** `SD PART2` BRUNs
// `STAR DESTROYER.OBJ0` and `SD PART3` BRUNs `BASE STAR.OBJ0`, and they are different
// programs - `loop.js`'s `Game` and `finale.js`'s `Finale`. The shell ran a `Game` for both
// until this check existed.
import { readFileSync } from 'node:fs';
import { Presentation, WAITING, FLIGHT_BINARY, FINALE_BINARY }
  from '../port/src/shell/presentation.js';
import { Game, WAVES } from '../port/src/game/loop.js';
import { Finale } from '../port/src/game/finale.js';
import { IFACE } from '../port/src/game/chain.js';
import { CLASSES } from '../port/src/game/dispatch.js';
import { field } from '../port/src/game/objects.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};

const DISK = '../STAR_DESTROYER.dsk';
const image = readFileSync(new URL(DISK, import.meta.url));

/** A fixed generator, so a run is the same run every time. */
const source = (s) => () => {
  s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
  return s / 0x80000000;
};

/** The nine bytes `waveClear` reads, cleared - a flight won rather than survived. */
function winTheWave(mem) {
  for (const a of WAVES) mem[a] = 0;
  for (const c of CLASSES) {
    mem[field(c.enemy, 'count')] = 0;
    mem[field(c.twin, 'count')] = 0;
    mem[c.debrisCounter] = 0;
  }
}

/** `$1120`'s two bytes, cleared - the base star dead. */
function winTheFinale(mem) {
  mem[0x814B] = 0;
  mem[0x093E] = 0;
}

/**
 * Walk the chain and report the route.
 *
 * @param {object} opts `win` true to hand the player each flight, `winFinale` for the last
 *   one; `missionFor` decides which class drives a binary, so a wrong one can be tried
 */
function walk({ win, winFinale, missionFor, games = 1, corruptInterface = false } = {}) {
  const show = new Presentation(image, { rnd: source(12345), corruptInterface });
  show.load('START');
  const route = [];
  const outcomes = [];
  let threw = null, keys = 0;
  for (let step = 0; step < 200; step++) {
    // The hardware fills the latch whether a program is looking or not, and `SELECT` line 17
    // reads $C000 exactly once - a key that is not already there sends it to DEMO. '1' is the
    // easy difficulty its digit prompt wants.
    show.host.pressKey('1');
    let r;
    try {
      r = show.run({ maxChains: 0 });
    } catch (e) {
      threw = `${show.program}: ${e.message}`;
      break;
    }
    if (route[route.length - 1] !== show.program) {
      route.push(show.program);
      // START after the first one is a new game. `INITIALS` line 6000 is `RUN START`.
      if (show.program === 'START' && route.length > 1
        && route.filter((x) => x.startsWith('START')).length > games) break;
    }

    if (r.waiting === WAITING.flight) {
      const isFinale = r.flight === FINALE_BINARY;
      const m = missionFor(r.flight, show.mem);
      let done = null;
      for (let pass = 0; pass < 2000 && !done; pass++) {
        if (pass === 3) {
          if (isFinale && winFinale) winTheFinale(show.mem);
          if (!isFinale && win) winTheWave(show.mem);
        }
        done = m.pass({ paddle0: 128, paddle1: 255, button0: true, latch: 0 }).done;
      }
      outcomes.push({ binary: r.flight, done, klass: m.constructor.name,
        // `$09A0 INC $1FF5` has already run by now, so this is the count including this one.
        flights: show.mem[IFACE.flights] });
      // Push the counter to the target so the next starbase visit is the last one. Surviving
      // five to fifteen real flights is a player's job, not a harness's.
      if (!isFinale && win) show.mem[IFACE.flights] = show.mem[IFACE.target];
      show.flightDone();
      continue;
    }
    if (r.waiting === WAITING.key) {
      // INITIALS wants three letters and then RETURN - line 183 is `IF A(I) = 13 THEN ...
      // GOTO 300`. A walker that presses space for ever just types spaces and never leaves,
      // which is what the first one did and why this looked like a hang.
      keys += 1;
      show.key(show.program === 'INITIALS'
        ? (keys % 4 === 3 ? String.fromCharCode(13) : 'A')
        : ' ');
      continue;
    }
    if (r.waiting === WAITING.ended) break;
    if (r.next) { show.load(r.next); continue; }
  }
  return { route, outcomes, threw, mem: show.mem, host: show.host };
}

/** The class the shell picks for a binary, which is the thing being checked. */
const dispatch = (binary, mem) => {
  if (binary === FINALE_BINARY) {
    const f = new Finale(mem);
    f.enter();
    return f;
  }
  const g = new Game(mem);
  g.setup();
  return g;
};

console.log('=== the chain, walked ===');

// ---------------------------------------------------------------- a game that is won -------
{
  const r = walk({ win: true, winFinale: true, missionFor: dispatch });
  console.log(`  ${r.route.join(' -> ')}`);
  check('the chain walks from the boot program to the high scores without stopping',
    r.threw === null && r.route[0] === 'START' && r.route.includes('INITIALS'),
    r.threw ?? `${r.route.length} programs, through INITIALS`);

  // And out the other side. `INITIALS` line 6000 is `RUN START` on both of its paths - line
  // 130 when the score missed the table, line 380 after the initials are entered - so a game
  // ending starts the next one and the disk never stops. `chain.js` had `INITIALS: to: null`
  // until this was walked, and `parity_progression.mjs` asserted the walk *ended* there, so
  // the model agreed with itself and with nothing else.
  check('and a game ending starts another one, which is what line 6000 does',
    r.route[r.route.length - 1] === 'START' && r.route.indexOf('START') === 0,
    `the route comes back to START after INITIALS - ${r.route.length} programs for one whole`
      + ' game and the first step of the next');

  // The route a won game takes, from chain.js's own graph.
  const WON = ['START', 'LOGO1', 'SELECT', 'SD', 'SD START', 'SD PART2', 'HYPERDRIVE 3',
    'STARBASE', 'HYPERDRIVE 4', 'SD START2', 'SD PART3', 'WIN', 'INITIALS'];
  check('and it takes the route the graph says, through the starbase and the last flight',
    WON.every((p) => r.route.includes(p)),
    `${WON.filter((p) => !r.route.includes(p)).join(', ') || 'every one of them'} - and`
      + ' STARBASE is in it, which is worth saying: the machine never finishes that scene');

  check('two missions run, and the second one is the finale\'s own binary',
    r.outcomes.length === 2 && r.outcomes[0].binary === FLIGHT_BINARY
      && r.outcomes[1].binary === FINALE_BINARY,
    r.outcomes.map((o) => `${o.binary} -> ${o.done}`).join(', '));

  check('and each binary is driven by its own class, not one for both',
    r.outcomes[0].klass === 'Game' && r.outcomes[1].klass === 'Finale',
    `${r.outcomes[0].klass} for the flight and ${r.outcomes[1].klass} for the finale`);

  check('the base star dies and SD PART3 routes to WIN',
    r.outcomes[1].done === 'won' && r.route.includes('WIN')
      && !r.route.includes('MONOLITH'),
    `$1FFF came out at ${r.mem[IFACE.baseStar]}, which SD PART3 line 175 reads as the win`);
}

// ---------------------------------------------------------------- and one that is lost -----
{
  const r = walk({ win: false, winFinale: false, missionFor: dispatch });
  console.log(`\n  ${r.route.join(' -> ')}`);
  check('a lost flight routes to MONOLITH and the scores, without reaching the finale',
    r.threw === null && r.route.includes('MONOLITH') && r.route.includes('INITIALS')
      && !r.route.includes('SD PART3'),
    `the ship was ${r.outcomes[0]?.done} and the chain went to MONOLITH - so both endings`
      + ' are reachable, which is the whole of the outer loop');
}

// ---------------------------------------------------------------- and a second game --------
// The risk in a second game is stale state: the thirteen interface bytes live above every
// binary and survive each `BRUN`, so a game that did not clear them would start with the last
// one's kills, waves and flight counter. `SELECT` line 21 is `FOR J = 8179 TO 8191: POKE J,0`,
// and this is what says the port runs it.
{
  const r = walk({ win: false, winFinale: false, missionFor: dispatch, games: 2 });
  const starts = r.route.filter((p) => p === 'START').length;
  const endings = r.route.filter((p) => p === 'MONOLITH' || p === 'WIN').length;
  check('two games run back to back, each reaching an ending of its own',
    r.threw === null && starts === 3 && endings === 2,
    r.threw ?? `${starts - 1} games played and a third booted, ${endings} endings`);

  // And the second game starts from scratch rather than carrying the first one's state.
  // `$1FF5` is the counter the binary itself keeps, and `SELECT` line 21 is the only thing
  // that clears it, so a second game whose first flight is numbered 2 would mean the clear
  // never happened. Each of these games is one flight long, so both should read 1.
  const counts = r.outcomes.map((o) => o.flights);
  check('and the second game counts its flights from scratch, not from the first game',
    r.outcomes.length === 2 && counts.every((n) => n === 1),
    `the two games' flights were numbered ${counts.join(' and ')} - SELECT line 21 zeroes`
      + ' all thirteen interface bytes, and this is what says the port runs it');
}

// -------------------------------------------------- the interface the chain loads over -----
// The repair that makes any of the above finishable. `STAR DESTROYER.OBJ0` ends at `$1FF0`
// and DOS reads a file's last sector whole, so the `BRUN` writes 250 bytes of slack over the
// thirteen bytes `SELECT` and `SD PART2` have just poked. The flight shell has repaired that
// since it was written; the chain did not, because it runs the real DOS commands through the
// host - so a game played the honest way read a target of 217 flights.
{
  const fixed = walk({ win: false, missionFor: dispatch, games: 1 });
  const asFound = walk({ win: false, missionFor: dispatch, games: 1, corruptInterface: true });
  const f = fixed.outcomes[0], a = asFound.outcomes[0];
  check('without the repair the chain hands the binary the slack, and with it the BASIC',
    f && a && f.flights === 1 && a.flights !== 1,
    `the first flight is numbered ${f?.flights} repaired and ${a?.flights} as the disk loads`
      + " - the second is the slack's 32 plus $09A0's increment, and $1FF8 is 217 the same way");
}

// ---------------------------------------------------------------- the control --------------
// Driving the finale's binary with `Game` has to produce a different mission, or dispatching
// on the binary's name is not doing anything - and a `Game` for both is exactly what the shell
// had.
{
  const wrong = walk({
    win: true,
    winFinale: false,
    missionFor: (binary, mem) => { const g = new Game(mem); g.setup(); return g; },
  });
  const right = walk({ win: true, winFinale: false, missionFor: dispatch });
  const a = wrong.outcomes[1], b = right.outcomes[1];
  check('control: a Game driving the finale\'s binary does not do what a Finale does',
    a && b && (a.done !== b.done || a.klass !== b.klass),
    `${a?.klass} left the last mission ${a?.done} where ${b?.klass} left it ${b?.done}`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
