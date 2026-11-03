// STAR DESTROYER.OBJ0 running, traced.
//
// probe_game.mjs established that the flight is 5,890 bytes of 6502 and that its only
// channel to the screen is the bytes it pokes into the display list. This watches it do
// that: step the 6502 through several game frames, record which of the overlay's
// instructions actually execute, find the frame loop, and snapshot the display list at
// every render so the game's per-frame output is visible as data.
//
// The same two-stage method as the renderer. A static traverse finds far more code than a
// trace does - it follows branches nobody takes - and a trace finds the code that matters
// and the order it runs in. Neither alone is the answer.
import { openOracle } from './a2.mjs';
import { toFlight } from './exercise.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { disasm1, traverse, hx } from './disasm6502.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const file = (n) => d.read(d.files.find((x) => x.name === n));
const obj = file('STAR DESTROYER.OBJ0');
const LO = obj.addr, HI = obj.addr + obj.len;
const LIST = 0x80FB, LIST_LEN = 491;

const a2 = await openOracle();
const flight = await toFlight(a2);
check('the oracle reaches flight', flight.difficulty === 1);

await a2.ev(`(() => {
  window.M.traceGame = (frames) => {
    const cpu = window.M.cpu, rd = window.M.rd;
    const cov = new Uint8Array(${HI - LO});
    const snaps = [], marks = [];
    let instr = 0, renders = 0, last = cpu.getCycles(), inGame = 0;
    // Stop when the requested number of renders have been seen, or the budget runs out.
    cpu.stepCyclesDebug(17030 * 4000, () => {
      const pc = cpu.getPC();
      instr++;
      if (pc >= ${LO} && pc < ${HI}) { cov[pc - ${LO}] = 1; inGame++; }
      if (pc === 0x6000) {
        const now = cpu.getCycles();
        marks.push({ instr, cycles: now - last, inGame });
        last = now; inGame = 0;
        const s = [];
        for (let a = ${LIST}; a < ${LIST + LIST_LEN}; a++) s.push(rd(a));
        snaps.push(s);
        if (++renders >= frames) return true;
      }
    });
    let covered = 0;
    for (const b of cov) covered += b;
    return { instr, renders, covered, marks, snaps,
      cov: Array.from(cov).map((b, i) => (b ? i + ${LO} : -1)).filter((x) => x >= 0) };
  };
  return 'ok';
})()`);

console.log('\n=== tracing six frames of the game ===');
const t = JSON.parse(await a2.ev('JSON.stringify(window.M.traceGame(7))'));
check('the trace caught the game calling the renderer', t.renders === 7, `${t.renders} renders`);

// --- the frame loop --------------------------------------------------------------------------
{
  const between = t.marks.slice(1);
  const cyc = between.map((m) => m.cycles);
  const mean = cyc.reduce((a, b) => a + b, 0) / cyc.length;
  console.log(`  one game frame: ${Math.round(mean)} cycles `
    + `(${(mean / 1020484 * 1000).toFixed(0)} ms, ${(1020484 / mean).toFixed(2)} a second)`);
  console.log(`  of which the game's own code runs ${Math.round(between.reduce((a, m) => a + m.inGame, 0) / between.length)} instructions`);
  console.log(`  frame to frame: ${cyc.map((c) => Math.round(c / 1000) + 'k').join(' ')}`);
  check('the game settles into a loop with a steady period',
    Math.max(...cyc) / Math.min(...cyc) < 1.5,
    `${Math.min(...cyc)} to ${Math.max(...cyc)} cycles`);
  // probe_renderer measured the render alone at about 316,000 cycles. Whatever is left is
  // the game thinking, and it is worth knowing which dominates.
  const render = 315753;
  console.log(`  the renderer accounts for about ${(100 * render / mean).toFixed(0)}% of a frame`);
  check('the frame is mostly the renderer, not the game logic',
    render / mean > 0.5, `${Math.round(mean - render)} cycles a frame outside the render`);
}

// --- how much of the binary runs ----------------------------------------------------------------
{
  const mem = new Uint8Array(0x10000);
  for (const n of ['A2-3D2', 'SV DATA', 'MAIN DATA', 'STAR DESTROYER.OBJ0']) {
    const x = file(n);
    for (let i = 0; i < x.len; i++) mem[x.addr + i] = x.data[i];
  }
  const { starts } = traverse(mem, [LO], { lo: LO, hi: HI });
  const executed = new Set(t.cov);
  const unknown = [...executed].filter((a) => !starts.has(a)).sort((x, y) => x - y);
  console.log(`\n=== how much of the binary runs ===`);
  console.log(`  the traverse finds ${starts.size} instructions; ${executed.size} executed in seven frames`);
  console.log(`  ${[...starts].filter((a) => !executed.has(a)).length} were never reached`);
  check('every executed address is one the traverse also found',
    unknown.length === 0,
    unknown.length ? `${unknown.length} not found: ${unknown.slice(0, 6).map((a) => hx(a, 4)).join(' ')}`
      : `${executed.size} addresses, all accounted for`);
  // Where the executing code sits says whether the frame loop is one region or scattered.
  const sorted = [...executed].sort((a, b) => a - b);
  const runs = [];
  let s = sorted[0], p = sorted[0];
  for (const a of sorted.slice(1)) {
    if (a - p > 64) { runs.push([s, p]); s = a; }
    p = a;
  }
  runs.push([s, p]);
  console.log(`  it executes in ${runs.length} regions:`);
  for (const [from, to] of runs.slice(0, 10)) {
    console.log(`     ${hx(from, 4)}-${hx(to, 4)}  ${to - from + 1} bytes`);
  }
}

// --- what it pokes, frame by frame -----------------------------------------------------------------
// The whole output channel. If the port reproduces these bytes it reproduces the game.
{
  console.log('\n=== what changes in the display list between frames ===');
  const changed = new Map();
  for (let i = 1; i < t.snaps.length; i++) {
    for (let k = 0; k < LIST_LEN; k++) {
      if (t.snaps[i][k] !== t.snaps[i - 1][k]) changed.set(LIST + k, (changed.get(LIST + k) ?? 0) + 1);
    }
  }
  const objectField = (at) => {
    for (let i = 0; i < 24; i++) {
      const base = (i < 12 ? 0x8123 + i * 13 : 0x8247 + (i - 12) * 13);
      if (at > base && at <= base + 12) {
        const off = at - base - 1;
        return `object ${String(i).padStart(2)} ${off === 0 ? 'count' : off <= 6 ? 'position' : off <= 9 ? 'attitude' : 'shape'}`;
      }
    }
    return null;
  };
  const named = { 0x8110: 'display page', 0x8112: 'clear page', 0x8114: 'draw page',
    0x8116: 'XI', 0x8117: 'XI+1', 0x8118: 'YI', 0x811A: 'ZI', 0x811B: 'ZI+1',
    0x811C: 'P1 pitch', 0x811D: 'B1 bank', 0x811E: 'H1 heading',
    0x81DD: 'SHLD gauge', 0x81F3: 'WARP gauge', 0x8209: 'MSL gauge' };
  const rows = [...changed.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (const [at, n] of rows.slice(0, 18)) {
    console.log(`  ${hx(at, 4)}  changed in ${n} of ${t.snaps.length - 1} frames   ${named[at] ?? objectField(at) ?? ''}`);
  }
  console.log(`  ${rows.length} bytes of the 491 change at all`);
  check('the game pokes the display list every frame',
    rows.length > 0 && rows[0][1] >= t.snaps.length - 2,
    `${rows.length} bytes move, the busiest in ${rows[0][1]} of ${t.snaps.length - 1} frames`);
  // Objects i and i+12 are the same thing twice: the scene draws the first block through
  // the main viewport and the second through the scope inset, so an enemy has an
  // instruction in each. $1E98 switches OBJ1 and OBJ13 on in the same breath, and if they
  // are really one entity they must move in exactly the same frames.
  {
    const fieldOf = (at) => {
      for (let i = 0; i < 24; i++) {
        const base = (i < 12 ? 0x8123 + i * 13 : 0x8247 + (i - 12) * 13);
        if (at > base && at <= base + 12) return { obj: i, off: at - base - 1 };
      }
      return null;
    };
    // frames[obj][off] = the set of frames in which that field moved
    const when = new Map();
    for (let i = 1; i < t.snaps.length; i++) {
      for (let k = 0; k < LIST_LEN; k++) {
        if (t.snaps[i][k] === t.snaps[i - 1][k]) continue;
        const f = fieldOf(LIST + k);
        if (!f) continue;
        const key = f.obj + ':' + f.off;
        if (!when.has(key)) when.set(key, []);
        when.get(key).push(i);
      }
    }
    const mismatched = [];
    let paired = 0;
    for (const [key, frames] of when) {
      const [obj, off] = key.split(':').map(Number);
      if (obj >= 12) continue;
      const twin = when.get((obj + 12) + ':' + off);
      if (!twin) { mismatched.push(`object ${obj} field ${off} moved but object ${obj + 12} did not`); continue; }
      if (twin.join() !== frames.join()) mismatched.push(`object ${obj} and ${obj + 12} field ${off} moved in different frames`);
      else paired++;
    }
    console.log(`  ${paired} fields moved identically in object i and object i+12`);
    check('an enemy is one entity with two instructions - the main view and the scope',
      paired > 0 && mismatched.length === 0,
      mismatched.slice(0, 2).join('; ') || `${paired} paired fields, none out of step`);
  }

  check('and what it pokes is the viewer, the objects and the gauges - nothing else',
    rows.every(([at]) => named[at] || objectField(at)),
    rows.filter(([at]) => !named[at] && !objectField(at)).slice(0, 4)
      .map(([at]) => hx(at, 4)).join(' ') || 'every changing byte is accounted for');

  fs.mkdirSync('captured/gameloop', { recursive: true });
  fs.writeFileSync('captured/gameloop/golden.json', JSON.stringify({
    frames: t.marks, changing: rows.map(([at, n]) => ({ at: hx(at, 4), frames: n, what: named[at] ?? objectField(at) })),
    results,
  }, null, 1) + '\n');
}

// --- the controls ---------------------------------------------------------------------------------
// Nothing moved the ship in the trace above, because nothing was driving it. The first
// guess was the keyboard, and it was wrong: $1929 reads $C000, and all it does is pause -
// if a key is pending it clears the strobe and spins until another arrives.
//
// The ship is steered by PADDLE 0, and a scan for $C0xx soft switches missed it because
// the read goes through the monitor ROM:
//
//     $09A3  LDX #$00        ; paddle 0
//     $09A5  JSR $FB1E       ; PREAD, the ROM's paddle read, returns Y
//     $09A8  CPY #$9B        ; 155 or more: heading += 3
//     $09BE  CPY #$64        ; under 100:   heading -= 3
//
// so there is a dead zone from 100 to 154 and the turn rate is three units of heading a
// frame. That is checked here by driving the paddle and watching $811E, rather than by
// trusting the disassembly.
{
  console.log('\n=== the controls ===');
  const H1 = 0x811E;
  const heading = async () => JSON.parse(await a2.ev(`window.M.rd(${H1})`));
  const hold = async (value, frames = 10) => {
    await a2.ev(`(() => { window.M.a2.getIO().paddle(0, ${value}); return 'p'; })()`);
    const before = await heading();
    await a2.waitMs(frames * 320);
    return { before, after: await heading() };
  };
  // A byte that wraps at 256 - take the signed difference the short way round.
  const turn = (r) => { let d = (r.after - r.before) & 0xff; return d > 127 ? d - 256 : d; };

  const right = await hold(1.0);
  const left = await hold(0.0);
  const centre = await hold(0.5);
  console.log(`  paddle hard right: heading ${right.before} -> ${right.after}  (${turn(right) > 0 ? '+' : ''}${turn(right)})`);
  console.log(`  paddle hard left:  heading ${left.before} -> ${left.after}  (${turn(left) > 0 ? '+' : ''}${turn(left)})`);
  console.log(`  paddle centred:    heading ${centre.before} -> ${centre.after}  (${turn(centre)})`);
  check('paddle 0 steers the ship, and the two directions turn opposite ways',
    turn(right) > 0 && turn(left) < 0,
    `right ${turn(right)}, left ${turn(left)}`);
  check('and the centre of the paddle is a dead zone, as the 100..154 window says',
    turn(centre) === 0, `the heading did not move`);
  // That one asserted `true`, which is not a check. The real test: with the paddle held
  // where it demonstrably turns, press a key. If $1929 is a pause the turn stops; if the
  // keyboard were the steering, or were ignored, it would carry on.
  const turningAgain = await hold(1.0, 6);
  await a2.key(' ');
  const whilePaused = await hold(1.0, 6);
  await a2.key(' ');
  const afterResume = await hold(1.0, 6);
  console.log(`  turning: ${turn(turningAgain)}, after a keypress: ${turn(whilePaused)}, `
    + `after a second keypress: ${turn(afterResume)}`);
  check('a keypress pauses the game - the turn stops and a second keypress resumes it',
    turn(turningAgain) > 0 && turn(whilePaused) === 0 && turn(afterResume) > 0,
    'which is what $1929 does: clear the strobe, then spin until another key arrives');
}

await a2.close();
const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `gameloop: all ${results.length} checks passed`
  : `gameloop: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
