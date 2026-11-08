// The whole frame loop, the port against the disk, pass for pass.
//
// Every other parity harness holds one block. This holds the thing that calls them: twelve
// modules composed in the loop's own order, which is a claim nothing else checks. If the order
// is wrong - the cooldown before the hold test, the debris before the awards, the throttle's
// gate read a pass late - no per-block harness can see it and this one cannot miss it.
//
// **The input is captured, not synthesised.** The loop reads its paddles through PREAD, whose
// answer comes out of a timing loop, so rather than model that the harness watches what PREAD
// actually returned - Y at $09A8 and at $0A92 - and replays those exact bytes into the port.
// Same for the trigger, read at $0ADB. Nothing about paddle timing has to be reproduced for
// the loop's behaviour to be compared.
//
// Two shapes of check. **Synced each pass**, over many different machine states, which says
// every pass is right from wherever it starts; and **seeded once**, running both forward
// together for many passes without resynchronising, which is the only way an error that
// accumulates shows up.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Game, publishShip, selectPages, waveClear, PAGE, QUIT, QUIT_VALUE, XI, ZI,
  FLIGHTS,
  DISPLAY_PAGE, CLEAR_PAGE, DRAW_PAGE, WAVES, SCORES } from '../port/src/game/loop.js';
import { CLASSES } from '../port/src/game/dispatch.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

/** The loop's top, its two exits, and the data windows that say whether a pass agreed. */
const TOP = 0x09A3;
const EXITS = [0x18DC, 0x1928];
// $1FF3-$1FFF, the whole interface, not $1FF9-$1FFE: the old window left out the flight
// counter, the difficulty, the target and the bonus, and its upper bound excluded $1FFF. The
// missing `INC $1FF5` in `setup` lived in that hole.
const WINDOWS = [[0x0900, 0x0960], [0x80FB, 0x82E6], [0x9800, 0x98F3], [0x1FF3, 0x2000]];

const d = openDisk(DISK);
const fileOf = (n) => d.read(d.files.find((x) => x.name === n));

/** A 64K image with the engine's files where DOS puts them, for the port to render from. */
function baseImage() {
  const mem = new Uint8Array(65536);
  for (const name of ['A2-3D2', 'SV DATA', 'MAIN DATA']) {
    const f = fileOf(name);
    for (let i = 0; i < f.len; i++) mem[f.addr + i] = f.data[i];
  }
  return mem;
}

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

/**
 * Run the machine from the top of the loop to the top of the loop, capturing what it read.
 *
 * `inject` sets the paddles and the button first. The keyboard strobe is cleared on the way in,
 * because $1929 will spin for ever on a pending key - that is the pause, and it is not what is
 * being compared here.
 */
await a2.ev(`(() => {
  window.M.loopPass = (paddle0, paddle1, button, windows, wantPage) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const io = window.M.a2.getIO();
    io.paddle(0, paddle0);
    io.paddle(1, paddle1);
    if (button) io.buttonDown(0); else io.buttonUp(0);
    wr(0xC010, 0);
    const st = cpu.getState();
    st.pc = ${TOP};
    cpu.setState(st);
    let read0 = null, read1 = null, trigger = null, exit = 0;
    cpu.stepCyclesDebug(6000000, () => {
      const pc = cpu.getPC();
      if (pc === 0x09A8 && read0 === null) read0 = cpu.getState().y;
      if (pc === 0x0A92 && read1 === null) read1 = cpu.getState().y;
      if (pc === 0x0ADE && trigger === null) trigger = cpu.getState().a;
      if (pc === ${TOP} || pc === 0x18DC || pc === 0x1928) { exit = pc; return true; }
    });
    const out = {};
    for (const [lo, hi] of windows) { for (let a = lo; a < hi; a++) out[a] = rd(a); }
    out[0] = rd(0);
    const page = wantPage ? window.M.range(0x2000, 0x6000) : null;
    return { exit, read0, read1, trigger, out, page };
  };
  window.M.snapshot = (windows) => {
    const rd = window.M.rd;
    const out = {};
    for (const [lo, hi] of windows) { for (let a = lo; a < hi; a++) out[a] = rd(a); }
    out[0] = rd(0);
    return { out, page: window.M.range(0x2000, 0x6000) };
  };
  return 'ok';
})()`);
const machinePass = (p0, p1, button, wantPage = false) => a2.ev(
  'JSON.stringify(window.M.loopPass(' + p0 + ',' + p1 + ',' + button + ','
  + JSON.stringify(WINDOWS) + ',' + wantPage + '))').then(JSON.parse);
const snapshot = () => a2.ev('JSON.stringify(window.M.snapshot('
  + JSON.stringify(WINDOWS) + '))').then(JSON.parse);

/** How far apart the two renders of the page this pass drew came out, and where. */
function pageReport(engine, game) {
  const drawn = game.mem[DRAW_PAGE] === 0 ? 0x2000 : 0x4000;
  const rows = new Map();
  let total = 0;
  for (let row = 0; row < 192; row++) {
    const at = drawn + (row & 7) * 0x400 + ((row >> 3) & 7) * 0x80 + (row >> 6) * 0x28;
    let n = 0;
    for (let b = 0; b < 40; b++) {
      if (engine.page[at - 0x2000 + b] !== game.mem[at + b]) n++;
    }
    if (n) {
      rows.set(row, n);
      total += n;
    }
  }
  return { drawn, total, rows };
}

/** Build a Game whose memory and table are the machine's, right now. */
function sync(snap, { render = true } = {}) {
  const mem = baseImage();
  for (const [lo, hi] of WINDOWS) {
    for (let a = lo; a < hi; a++) mem[a] = snap.out[a];
  }
  mem[0] = snap.out[0];
  for (let i = 0; i < 0x4000; i++) mem[0x2000 + i] = snap.page[i];
  const game = new Game(mem, { render });
  for (let i = 0; i < 0xF3; i++) game.math.table[i] = snap.out[0x9800 + i];
  // Flight's own two bytes of state live in the object, not in memory, so they come across
  // from where the binary keeps them.
  game.flight.gate = mem[0x0948];
  game.flight.burnCounter = mem[0x0956];
  game.flight.heading = mem[0x0949];
  return game;
}

/**
 * Where a pass disagreed, as a sentence - with what the byte held before the pass, because
 * which side MOVED is usually the whole diagnosis.
 */
function diff(engine, game, { page = false, was = null } = {}) {
  const bad = [];
  const say = (a, label) => {
    const before = was ? was.out[a] : null;
    bad.push(`${label} ${hx(a)}: machine ${engine.out[a]}, port ${game.mem[a]}`
      + (before === null ? '' : ` (was ${before})`));
  };
  for (const [lo, hi] of WINDOWS) {
    for (let a = lo; a < hi; a++) {
      if (a >= 0x9800 && a < 0x98F3) continue;
      if (engine.out[a] !== game.mem[a]) {
        say(a, 'at');
        if (bad.length > 5) return bad;
      }
    }
  }
  for (let i = 0; i < 0xF3; i++) {
    const a = 0x9800 + i;
    if (engine.out[a] !== game.math.table[i]) {
      const before = was ? was.out[a] : null;
      bad.push(`table index ${i} (${hx(a)}): machine ${engine.out[a]},`
        + ` port ${game.math.table[i]}` + (before === null ? '' : ` (was ${before})`));
      if (bad.length > 5) return bad;
    }
  }
  // Both hi-res pages, every byte. The port's renderer draws into views on $2000 and $4000
  // of the same image, exactly as the machine does, so there is nothing to split out.
  if (page && engine.page) {
    for (let a = 0x2000; a < 0x6000; a++) {
      if (engine.page[a - 0x2000] !== game.mem[a]) {
        bad.push(`${hx(a)} on the hi-res page: machine ${engine.page[a - 0x2000]},`
          + ` port ${game.mem[a]}`);
        return bad;
      }
    }
  }
  return bad;
}

// --- the three small blocks the driver added ----------------------------------------------------
console.log('\n=== the ship\'s publish, the page select, and the wave test ===');
{
  const snap = await snapshot();
  const bad = [];
  // $0A63 and $0ABC, run as blocks, against the port's own two functions.
  for (const [name, start, stop, apply] of [
    ['$0A63 the ship\'s publish', 0x0A63, 0x0A8D, (g) => publishShip(g.mem, g.math)],
    ['$0ABC the page select', 0x0ABC, 0x0ADB, (g) => selectPages(g.mem)],
  ]) {
    for (const toggle of [0, 1]) {
      const r = JSON.parse(await a2.ev(`JSON.stringify((() => {
        const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
        const before = cpu.getState();
        const snapW = {};
        for (const [lo, hi] of ${JSON.stringify(WINDOWS)}) {
          for (let a = lo; a < hi; a++) snapW[a] = rd(a);
        }
        wr(${PAGE}, ${toggle});
        const seeded = {};
        for (const [lo, hi] of ${JSON.stringify(WINDOWS)}) {
          for (let a = lo; a < hi; a++) seeded[a] = rd(a);
        }
        const st = cpu.getState(); st.pc = ${start}; cpu.setState(st);
        cpu.stepCyclesDebug(200000, () => (cpu.getPC() === ${stop}));
        const out = {};
        for (const [lo, hi] of ${JSON.stringify(WINDOWS)}) {
          for (let a = lo; a < hi; a++) out[a] = rd(a);
        }
        out[0] = rd(0);
        for (const [a, v] of Object.entries(snapW)) wr(Number(a), v);
        cpu.setState(before);
        return { out, seeded };
      })())`));
      const game = sync({ out: r.seeded, page: snap.page }, { render: false });
      apply(game);
      const d = diff({ out: r.out }, game);
      if (d.length) bad.push(`${name} toggle ${toggle}: ${d[0]}`);
    }
  }
  check('both agree, on each setting of the page toggle',
    bad.length === 0, bad.slice(0, 2).join('; ')
      || '$8116 and $811A plus object 12 for the publish; $8110, $8112 and $8114 for the pages');

  // The wave test is a predicate, so it is compared by which exit the machine takes.
  const cases = [];
  for (const w of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]]) {
    for (const e of [[0, 0, 0], [0xFF, 0, 0], [0, 0, 0xFF]]) {
      for (const dbg of [[0, 0, 0], [0, 0, 1], [4, 0, 0]]) cases.push({ w, e, dbg });
    }
  }
  const wrong = [];
  for (const { w, e, dbg } of cases) {
    const pokes = {};
    WAVES.forEach((a, i) => { pokes[a] = w[i]; });
    CLASSES.forEach((c, i) => { pokes[field2(c.enemy)] = e[i]; pokes[c.debrisCounter] = dbg[i]; });
    const r = JSON.parse(await a2.ev(`JSON.stringify((() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState();
      const snapW = {};
      for (const a of Object.keys(${JSON.stringify(pokes)})) snapW[a] = rd(Number(a));
      for (const [a, v] of Object.entries(${JSON.stringify(pokes)})) wr(Number(a), v);
      const seeded = {};
      for (const [lo, hi] of ${JSON.stringify(WINDOWS)}) {
        for (let a = lo; a < hi; a++) seeded[a] = rd(a);
      }
      const st = cpu.getState(); st.pc = 0x18DD; cpu.setState(st);
      let exit = 0;
      cpu.stepCyclesDebug(200000, () => {
        const pc = cpu.getPC();
        if (pc === 0x1929 || pc === 0x1925) { exit = pc; return true; }
      });
      for (const [a, v] of Object.entries(snapW)) wr(Number(a), v);
      cpu.setState(before);
      return { exit, seeded };
    })())`));
    const game = sync({ out: r.seeded, page: snap.page }, { render: false });
    const got = waveClear(game.mem);
    if (got !== (r.exit === 0x1925)) {
      wrong.push(`waves ${w} enemies ${e} debris ${dbg}: ${got} against ${r.exit === 0x1925}`);
    }
  }
  check('and the wave-complete test agrees on all thirty-six combinations',
    wrong.length === 0, wrong.slice(0, 2).join('; ')
      || 'nine bytes, all of them zero, and two of the three tests short-circuit on the third');
}

// --- the other way out, which had no check at all ----------------------------------------------
// $18D6 is `LDX $00 / CPX #$4D / BNE $18DD`, so the ship's death is one byte and one branch,
// and the port spells it `mem[QUIT] === QUIT_VALUE`. The wave-clear exit above has been held
// since this file was written; this one never was, which is part of how the port shipped with
// a ship that could not die - nothing wrote the byte and nothing noticed the exit was cold.
{
  const wrong = [];
  for (const v of [0x00, 0x01, 0x4C, QUIT_VALUE, 0x4E, 0xFF]) {
    const exit = Number(await a2.ev(`(() => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState(), was = rd(${QUIT});
      wr(${QUIT}, ${v});
      const st = cpu.getState(); st.pc = 0x18D6; cpu.setState(st);
      let where = 0;
      cpu.stepCyclesDebug(10000, () => {
        const pc = cpu.getPC();
        if (pc === 0x18DC || pc === 0x18DD) { where = pc; return true; }
      });
      wr(${QUIT}, was); cpu.setState(before);
      return where;
    })()`));
    const machineDied = exit === 0x18DC;
    const mem = new Uint8Array(0x10000);
    mem[QUIT] = v;
    const portDied = mem[QUIT] === QUIT_VALUE;
    if (machineDied !== portDied) wrong.push(`$00 = ${v}: machine ${machineDied}`);
  }
  check('and the destroyed exit agrees - $4D and nothing else ends the flight',
    wrong.length === 0, wrong.slice(0, 2).join('; ')
      || 'six values either side of $4D, including $4C and $4E');
}
function field2(i) {
  const RECORD = 13;
  return (i < 12 ? 0x8123 + i * RECORD : 0x8247 + (i - 12) * RECORD) + 1;
}

// --- the setup block, which nothing drove until the chain needed it ---------------------------
// `$0957`-`$09A2` runs once before the loop: prime both hi-res pages, clear the page toggle,
// spawn a class-1 and a class-2 enemy, publish the ship, and **increment `$1FF5`**.
//
// No harness drove `setup` at all before this one, and `$1FF5` sat outside the window the
// checks above compared, so the missing increment was invisible twice over. It matters because
// `$1FF5` is the flight counter and **no Applesoft program writes it** - `SD PART2` line 175
// compares it with the target `SELECT` rolled, so a port that does not increment it can never
// reach its last flight and can never reach the base star.
console.log('\n=== the setup block ===');
{
  await a2.ev(`(() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    window.M.setupRun = (windows) => {
      const before = cpu.getState();
      const out0 = {};
      for (const [lo, hi] of windows) { for (let a = lo; a < hi; a++) out0[a] = rd(a); }
      out0[0] = rd(0);
      const page0 = window.M.range(0x2000, 0x6000);
      const st = cpu.getState();
      st.pc = 0x0957; cpu.setState(st);
      let renders = 0, out = false;
      cpu.stepCyclesDebug(20000000, () => {
        const pc = cpu.getPC();
        if (pc === 0x6000) renders++;
        if (pc === 0x09A3) { out = true; return true; }     // the frame begins here
      });
      const after = {};
      for (const [lo, hi] of windows) { for (let a = lo; a < hi; a++) after[a] = rd(a); }
      after[0] = rd(0);
      const page = window.M.range(0x2000, 0x6000);
      // Put it all back: this is the live mission and the checks above run on from here.
      for (const [a, v] of Object.entries(out0)) wr(Number(a), v);
      cpu.setState(before);
      return { was: { out: out0, page: page0 }, out: after, page, renders, out_: out };
    };
    return 'ok';
  })()`);
  const r = await a2.ev('JSON.stringify(window.M.setupRun('
    + JSON.stringify(WINDOWS) + '))').then(JSON.parse);

  const game = sync(r.was);
  let renders = 0;
  const realRender = game.render.bind(game);
  game.render = () => { renders += 1; realRender(); };
  game.setup();

  const d = diff({ out: r.out, page: r.page }, game, { page: true, was: r.was });
  check('the setup block agrees: both pages, the two spawns, the publish and $1FF5',
    r.out_ && d.length === 0 && renders === r.renders && renders === 2,
    d.slice(0, 2).join('; ')
      || `${renders} renders, and it leaves the machine on $09A3 - the frame's first`
        + ' instruction');

  check('and it is the BINARY that counts flights: $1FF5 went up on both sides',
    r.out[FLIGHTS] === ((r.was.out[FLIGHTS] + 1) & 0xff)
      && game.mem[FLIGHTS] === r.out[FLIGHTS],
    `${r.was.out[FLIGHTS]} -> ${r.out[FLIGHTS]} in the machine and ${game.mem[FLIGHTS]} in the`
      + ' port - $09A0 INC $1FF5, which no BASIC program in the chain touches');

  // The control: a setup that leaves the counter alone has to disagree, or the increment is
  // not being tested - it was absent for weeks with every check green.
  {
    const g2 = sync(r.was);
    g2.render = () => {};
    g2.setup();
    g2.mem[FLIGHTS] = (g2.mem[FLIGHTS] - 1) & 0xff;        // undo it
    check('control: without the increment the port and the machine part company',
      g2.mem[FLIGHTS] !== r.out[FLIGHTS],
      `${g2.mem[FLIGHTS]} against the machine's ${r.out[FLIGHTS]} - which is the state this`
        + ' port was in, and why a game could never reach its last flight');
  }
}

// --- one pass, from wherever the machine happens to be -----------------------------------------
console.log('\n=== one pass, synced each time ===');
{
  const SCRIPT = [
    { p0: 128, p1: 255, b: false },
    { p0: 255, p1: 255, b: false },
    { p0: 0, p1: 255, b: false },
    { p0: 128, p1: 0, b: false },
    { p0: 200, p1: 0, b: true },
    { p0: 50, p1: 255, b: true },
    { p0: 128, p1: 255, b: true },
    { p0: 128, p1: 0, b: true },
  ];
  const bad = [];
  const pages = [];
  let passes = 0, fired = 0, warped = 0;
  for (const [i, input] of SCRIPT.entries()) {
    // Let the machine move on between samples, so each pass starts somewhere different.
    await a2.ev('(() => { window.M.cpu.stepCyclesDebug(700000, () => {}); return 1; })()');
    const snap = await snapshot();
    const engine = await machinePass(input.p0, input.p1, input.b, true);
    const game = sync(snap);
    const r = game.pass({
      paddle0: engine.read0 === null ? 128 : engine.read0,
      paddle1: engine.read1 === null ? 255 : engine.read1,
      button0: engine.trigger !== null && (engine.trigger & 0x80) !== 0,
    });
    passes++;
    if (r.sounds.includes(0x1F73)) fired++;
    if (game.flight.gate !== 0) warped++;
    const d = diff(engine, game, { page: true, was: snap });
    if (d.length) bad.push(`pass ${i} (${JSON.stringify(input)}): ${d[0]}`);
    pages.push(pageReport(engine, game));
  }
  check('every pass agrees: the display list, the state and the table',
    bad.length === 0 && passes === SCRIPT.length, bad.slice(0, 2).join('; ')
      || `${passes} passes over a scripted input, ${fired} firing, ${warped} under warp`);

  // And the page it drew, reported rather than asserted. This is the one thing the whole
  // suite does not have green, and it is the renderer's, not the loop's: the game state
  // agrees to the byte on every pass above. parity_frame.mjs holds the renderer on three
  // scenes and passes; the live list in flight is a fourth it does not cover.
  const drew = pages.reduce((n, p) => n + p.total, 0);
  check('and so does every byte of both hi-res pages, on every pass',
    drew === 0,
    `16,384 bytes of screen compared ${pages.length} times, ${drew} differing - the renderer`
      + ' draws into views on $2000 and $4000 of the same image, as the machine does');
}

// --- seeded once, and left to run ---------------------------------------------------------------
console.log('\n=== seeded once, then run forward together ===');
{
  const PASSES = 24;
  await a2.ev('(() => { window.M.cpu.stepCyclesDebug(400000, () => {}); return 1; })()');
  const snap = await snapshot();
  const game = sync(snap);
  const bad = [];
  let ran = 0, fired = 0, exits = 0;
  let prev = snap;
  for (let i = 0; i < PASSES; i++) {
    // A scripted input that does something: sweep the stick, hold warp, fire in bursts.
    const p0 = [128, 255, 255, 128, 0, 0, 128][i % 7];
    const p1 = i % 4 === 0 ? 255 : 0;
    const b = i % 3 !== 0;
    const engine = await machinePass(p0, p1, b, true);
    const r = game.pass({
      paddle0: engine.read0 === null ? 128 : engine.read0,
      paddle1: engine.read1 === null ? 255 : engine.read1,
      button0: engine.trigger !== null && (engine.trigger & 0x80) !== 0,
    });
    ran++;
    if (r.sounds.includes(0x1F73)) fired++;
    if (engine.exit !== 0x09A3) exits++;
    const d = diff(engine, game, { page: true, was: prev });
    if (d.length) {
      bad.push(`pass ${i}: ${d.join(' | ')}`);
      break;
    }
    prev = engine;
  }
  check('and they stay together, with nothing resynchronised after the first pass',
    bad.length === 0 && ran === PASSES, bad.slice(0, 2).join('; ')
      || `${ran} passes, ${fired} of them firing, ${exits} that left the loop early -`
        + ' every byte of the display list, the state, the table AND both hi-res pages,'
        + ' after every one');
}

// --- the controls -------------------------------------------------------------------------------
console.log('\n=== what the loop does with its input ===');
{
  // The heading follows the stick, and the gate follows the throttle a pass late.
  const snap = await snapshot();
  const game = sync(snap, { render: false });
  const before = game.mem[0x811E];
  game.pass({ paddle0: 255, paddle1: 255 });
  const up = game.mem[0x811E];
  game.pass({ paddle0: 0, paddle1: 255 });
  const down = game.mem[0x811E];
  check('the heading turns three units a pass and both operands get it',
    up === ((before + 3) & 0xff) && down === ((up - 3) & 0xff)
      && game.mem[0x8251] === down,
    `${before} -> ${up} -> ${down}, and object 12's heading follows`);

  const g2 = sync(snap, { render: false });
  g2.mem[0x0948] = 0;
  g2.flight.gate = 0;
  const x0 = g2.math.read(0x2D);
  g2.pass({ paddle0: 128, paddle1: 0 });
  const x1 = g2.math.read(0x2D);
  g2.pass({ paddle0: 128, paddle1: 0 });
  const x2 = g2.math.read(0x2D);
  check('and the throttle takes a pass to bite, because the gate is read before it is set',
    x1 === x0 && x2 !== x1,
    `the ship does not move on the pass warp is asked for and does on the next`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
