// The outer loop: twenty Applesoft programs chaining into each other, and the thirteen bytes
// they talk to the binary through.
//
// The flight loop is `loop.js` and it is one program among twenty. What decides whether you
// fly again, dock at the starbase, go to the final mission or go to the high scores is a
// handful of Applesoft lines spread across SELECT, SD PART2, STARBASE and SD PART3 - and all
// of their state lives in **$1FF3-$1FFF**, the thirteen bytes just **above**
// `STAR DESTROYER.OBJ0`, which ends at `$1FF0`. Being outside every binary's image is what
// lets them carry state from one program in the chain to the next. The binary writes some of
// them and the BASIC writes the rest, and that is the whole interface.
//
// Except that they do not survive the `BRUN` that is supposed to read them. DOS 3.3 reads a
// file's last sector straight to the destination, all 256 bytes of it, so loading a binary
// that ends at `$1FF0` writes 250 bytes of that sector's slack over `$1FF1`-`$20EA` - the
// interface included. See `dos.js`, which models it, and `oracle/probe_overshoot.mjs`, which
// measured it: on this image `SELECT` rolls a target of 7 and `SD PART2` rolls waves of 2/2/5,
// and the binary reads 217 and 32/51/51. The port does not work around that; it loads the way
// DOS does and lets the data decide, so a dump whose slack is zeros plays correctly with no
// change here.
//
//     $1FF3  120 means "this was the last ordinary flight"   HYPERDRIVE 3 and 4 set it
//     $1FF4  the running starbase-visit bonus, in units of 500
//     $1FF5  how many flights have been flown. The BINARY increments it, at $09A0
//     $1FF6  the difficulty, 1 to 3, as SELECT read it from the keyboard
//     $1FF7  SD START2 zeroes it; BASE STAR.OBJ0 counts the final mission with it
//     $1FF8  how many flights you have to survive. SELECT rolls it from the difficulty
//     $1FF9  the class-1 wave counter. SD PART2 rolls it, the binary counts it down
//     $1FFA  the class-2 wave counter
//     $1FFB  the class-3 wave counter
//     $1FFC  class-1 kills, worth 300 each
//     $1FFD  class-2 kills, worth 600
//     $1FFE  class-3 kills, worth 800 - and the binary also bumps it on a wave clear
//     $1FFF  1 if the base star died. Worth 10,000, and SD PART3 reads it as win or lose
//
// **The structure of a game**, which nothing in this port had before:
//
//     SELECT        rolls the target: easy 5-7 flights, medium 8-10, hard 10-15
//     SD START      zeroes the counters
//     SD PART2      rolls three wave counters, flies, then decides:
//                     any counter left, or $00 = 77 (dead)   -> MONOLITH, then the scores
//                     flights >= target                      -> HYPERDRIVE 3, the last one
//                     otherwise                              -> HYPERDRIVE 1
//     STARBASE      scores, and then:
//                     $1FF3 = 120  -> HYPERDRIVE 4 -> SD START2 -> SD PART3, the base star
//                     otherwise    -> HYPERDRIVE 2 -> SD PART2, another flight
//     SD PART3      flies BASE STAR.OBJ0, then $1FFF decides MONOLITH or WIN
//
// So a game is between five and fifteen flights, each a wave of enemies that has to be cleared
// to the last one, with a starbase visit between each and a different binary for the finale.
//
// **Four programs on the disk are named by nothing**: `SD RET`, `HYPERDRIVE0`,
// `CLEAR SCORES` and `CLS DATA`. The first two chain somewhere sensible - SD RET sets up like
// SD START and HYPERDRIVE0 runs SD - so they look like earlier versions left behind;
// `CLEAR SCORES` is a two-line utility that resets `INITIALS.DAT` and was presumably run by
// hand; and `CLS DATA` is the author's build tool, which BSAVEs the `CLS` binary the
// hyperdrive animation uses out of its own DATA statements. This said three until
// probe_applesoft.mjs counted the disk's DOS commands and found an eighth.
//
// Measured by oracle/probe_chain.mjs, which extracts the graph and the interface from the
// detokenised programs on the disk rather than from this file.

/** $1FF3-$1FFF, the thirteen bytes the BASIC and the binary share. */
export const IFACE = {
  /** $1FF3 - 120 means the next starbase visit is the last. */
  lastFlight: 0x1FF3,
  /** $1FF4 - the accumulated starbase bonus, in units of 500. */
  bonus: 0x1FF4,
  /** $1FF5 - flights flown. `$09A0 INC $1FF5`, so the BINARY keeps this one. */
  flights: 0x1FF5,
  /** $1FF6 - the difficulty, 1 to 3. */
  difficulty: 0x1FF6,
  /**
    * $1FF7 - no BASIC program reads it, but the finale's binary does.
    *
    * `BASE STAR.OBJ0` zeroes it at `$0962`, increments it at `$0F53` and `$0F9B`, and at
    * `$10ED` compares it against fifteen - at which point it calls two blocks, resets it and
    * puts 4 in `$093E`. So it is that binary's own progress counter through the final
    * mission, and `SD START2`'s `POKE` is its initialisation. The last pass recorded this as
    * written-and-never-read, which was true of the twenty Applesoft programs and not of the
    * game.
    */
  finale: 0x1FF7,
  /** $1FF8 - how many flights have to be survived. */
  target: 0x1FF8,
  /** $1FF9-$1FFB - the three wave counters. */
  waves: [0x1FF9, 0x1FFA, 0x1FFB],
  /** $1FFC-$1FFE - the three kill counters. */
  kills: [0x1FFC, 0x1FFD, 0x1FFE],
  /** $1FFF - the base star. */
  baseStar: 0x1FFF,
};

/** $00 holding this is how the binary says the ship was destroyed. SD PART2 line 172. */
export const DEAD = 77;

/** HYPERDRIVE 3 and 4's `POKE 8179,120`. */
export const LAST_FLIGHT = 120;

/** What a kill of each class is worth, from STARBASE and INITIALS line 2010. */
export const KILL_VALUE = [300, 600, 800];

/** `BN = PEEK(8180) * 500` - what each unit of accumulated bonus is worth. */
export const BONUS_UNIT = 500;

/** `IF PEEK(8191) = 1 THEN BN = BN + 10000` - the base star. */
export const BASE_STAR_BONUS = 10000;

/** `IF BN > 5 THEN BN = 5` - the most one starbase visit can add. */
export const BONUS_CAP = 5;

/**
 * SELECT lines 22-24 - how many flights this difficulty has to survive.
 *
 * `N = 5 + RND(1)*3` and the two above it, then `POKE 8184,N` - and POKE truncates, so the
 * ranges are 5-7, 8-10 and 10-15. Applesoft's `RND(1)` is in [0, 1), so the top of each range
 * is one below the arithmetic maximum.
 *
 * @param {number} difficulty 1, 2 or 3
 * @param {() => number} rnd a source of [0, 1), standing in for Applesoft's RND
 */
export function selectTarget(difficulty, rnd = Math.random) {
  if (difficulty === 1) return Math.trunc(5 + rnd() * 3);
  if (difficulty === 2) return Math.trunc(8 + rnd() * 3);
  if (difficulty === 3) return Math.trunc(10 + rnd() * 6);
  return null;                                  // line 25 loops back for anything else
}

/**
 * SD PART2 lines 200 and 300 - roll the three wave counters for a flight.
 *
 * `N = PEEK(8182) + ((RND(1)*4) + 1.5)`, poked three times. The 1.5 and the truncation mean
 * each counter is the difficulty plus 1 to 5, weighted towards the middle: the fractional part
 * lands in [1.5, 5.5), so 1 and 5 each cover half as much of the range as 2, 3 and 4.
 */
export function rollWaves(difficulty, rnd = Math.random) {
  return [0, 1, 2].map(() => Math.trunc(difficulty + (rnd() * 4 + 1.5)) & 0xff);
}

/**
 * STARBASE lines 2010-2017 - score the visit, and bank the bonus.
 *
 * This one has a side effect, which is why it is not just a formula: line 2016 writes the
 * accumulated bonus back, so each visit adds the number of flights so far - capped at five -
 * to a running total that every later visit and the high-score screen then multiply by 500.
 * Visit often enough and the cap is the only thing holding it down.
 *
 * @param {Uint8Array} mem a 64K image
 * @returns {{score: number, added: number}}
 */
export function starbaseScore(mem) {
  const kills = IFACE.kills.reduce((n, a, i) => n + mem[a] * KILL_VALUE[i], 0);
  let added = mem[IFACE.flights];
  if (added > BONUS_CAP) added = BONUS_CAP;
  mem[IFACE.bonus] = (mem[IFACE.bonus] + added) & 0xff;
  return { score: kills + mem[IFACE.bonus] * BONUS_UNIT, added };
}

/** INITIALS lines 2010-2017 - the final score. No side effect; the bonus is already banked. */
export function finalScore(mem) {
  const kills = IFACE.kills.reduce((n, a, i) => n + mem[a] * KILL_VALUE[i], 0);
  let bonus = mem[IFACE.bonus] * BONUS_UNIT;
  if (mem[IFACE.baseStar] === 1) bonus += BASE_STAR_BONUS;
  return kills + bonus;
}

/**
 * The chain, as the twenty programs on the disk have it.
 *
 * `to` is where a program goes with nothing to decide. `decide` is the ones that have a
 * decision, and each is the Applesoft line it comes from. Everything here is checked against
 * the detokenised programs by probe_chain.mjs rather than trusted from this file.
 */
export const CHAIN = {
  START: { to: 'LOGO1' },
  /** LOGO1 line 33 on a key, line 42 on none - it polls $C000 for 500 BASIC iterations. */
  LOGO1: { decide: (s) => (s.key ? 'SELECT' : 'DEMO'), from: 'LOGO1 33 / 42' },
  /** SELECT line 17 reads $C000 exactly ONCE, so the press has to land inside its load. */
  SELECT: { decide: (s) => (s.key ? 'SD' : 'DEMO'), from: 'SELECT 17 / 30' },
  SD: { to: 'SD START' },
  'SD START': { to: 'SD PART2' },
  'SD PART2': {
    decide: (s, mem) => {
      // 172: any wave left, or the binary said the ship was destroyed.
      if (IFACE.waves.some((a) => mem[a] > 0) || s.zeroPage === DEAD) return 'MONOLITH';
      // 175: flown as many as the difficulty asked for.
      if (mem[IFACE.flights] >= mem[IFACE.target]) return 'HYPERDRIVE 3';
      return 'HYPERDRIVE1';                                                    // 180
    },
    from: 'SD PART2 172 / 175 / 180',
  },
  HYPERDRIVE1: { to: 'STARBASE' },
  HYPERDRIVE2: { to: 'SD PART2' },
  /** Both of these set $1FF3 to 120 on the way through, at line 40. */
  'HYPERDRIVE 3': { to: 'STARBASE', sets: { [IFACE.lastFlight]: LAST_FLIGHT } },
  'HYPERDRIVE 4': { to: 'SD START2', sets: { [IFACE.lastFlight]: LAST_FLIGHT } },
  STARBASE: {
    decide: (s, mem) =>
      (mem[IFACE.lastFlight] === LAST_FLIGHT ? 'HYPERDRIVE 4' : 'HYPERDRIVE2'),
    from: 'STARBASE 220 / 221',
  },
  'SD START2': { to: 'SD PART3' },
  'SD PART3': {
    decide: (s, mem) => (mem[IFACE.baseStar] === 0 ? 'MONOLITH' : 'WIN'),
    from: 'SD PART3 175 / 180',
  },
  MONOLITH: { to: 'INITIALS' },
  WIN: { to: 'INITIALS' },
  /** Named by nothing on the disk. */
  HYPERDRIVE0: { to: 'SD', orphan: true },
  'SD RET': { to: null, orphan: true },
  'CLEAR SCORES': { to: null, orphan: true },
  INITIALS: { to: null },
  /**
   * The attract mode, and the only place the game says what it is about. Its loop draws the
   * narration out of the shape table and leaves on its own at line 210 - or at line 144 the
   * moment a key is pressed, which is why nobody who played this ever saw it. Both exits are
   * `RUN SELECT`. Held by `probe_shapetext.mjs`.
   */
  DEMO: { to: 'SELECT', from: 'DEMO 144 / 210' },
};

/** What each program zeroes or sets on its way in, from its own first lines. */
export const RESETS = {
  /** SELECT 21 - `FOR J = 8179 TO 8191: POKE J,0`, the whole interface. */
  SELECT: () => IFACE.waves.concat(IFACE.kills, [IFACE.lastFlight, IFACE.bonus,
    IFACE.flights, IFACE.difficulty, IFACE.finale, IFACE.target, IFACE.baseStar]),
  /** SD START 4 and 165. */
  'SD START': () => [IFACE.waves[0], IFACE.waves[1], ...IFACE.kills, IFACE.baseStar,
    IFACE.lastFlight],
  /** SD START2 4 - note it does NOT clear the third wave counter or the kills. */
  'SD START2': () => [IFACE.waves[0], IFACE.waves[1], IFACE.finale, IFACE.baseStar],
};

/**
 * Where a program goes next.
 *
 * @param {string} program
 * @param {Uint8Array} mem a 64K image, for the interface bytes
 * @param {object} [signals] `key` for the two keyboard polls, `zeroPage` for $00
 */
export function next(program, mem, signals = {}) {
  const node = CHAIN[program];
  if (!node) throw new Error(`no program called ${program}`);
  if (node.sets) for (const [a, v] of Object.entries(node.sets)) mem[Number(a)] = v;
  if (node.decide) return node.decide(signals, mem);
  return node.to;
}
