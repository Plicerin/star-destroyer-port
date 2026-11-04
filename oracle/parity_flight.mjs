// The port's movement against the real frame loop, frame by frame.
//
// The loop is sampled at $09D1, the top of the movement block, where the heading has just
// been read and the position still holds last frame's result. Each sample is therefore the
// input to one step and the sample after it is the answer. Seed the port from the first
// sample and it has to reproduce every one that follows - exactly, all 24 bits, fraction
// included, for as long as the trace runs.
//
// That is a strict test and a cheap one to get wrong in a flattering direction. Two things
// keep it honest. The port is seeded ONCE, from the first sample, and never resynchronised,
// so a single wrong step puts it off for the rest of the run and the failure count says how
// long it survived. And the trace has to contain the interesting events - a heading that
// changes, and a wrap at the edge of the world - or it is only testing that nothing moved.
// Both are asserted before the comparison is believed.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { Flight, GATE_OPEN } from '../port/src/game/flight.js';
import { TABLE_INIT, UNINITIALISED, VAR } from '../port/src/game/tables.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

// Sample counts. Each one costs about 133,000 emulated instructions, so these are chosen to
// exercise the thing under test and no more.
const STRAIGHT = 24, TURN = 24, WRAP = 6, IDLE = 10, BURN = 14;

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);

// --- the generated capture ---------------------------------------------------------------------
{
  const live = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const skip = new Set(UNINITIALISED);
  const wrong = [];
  for (let i = 0; i < 243; i++) {
    if (skip.has(i)) continue;
    if (live[i] !== TABLE_INIT[i]) wrong.push(`${i}: live ${live[i]}, generated ${TABLE_INIT[i]}`);
  }
  check('the generated TABLE_INIT matches the machine at the start of flight',
    wrong.length === 0, wrong.slice(0, 3).join('; ')
      || `${243 - skip.size} bytes, ${skip.size} skipped as uninitialised`);
  check('and the uninitialised bytes are the two the generator found',
    UNINITIALISED.length === 2 && UNINITIALISED[0] === 104 && UNINITIALISED[1] === 105,
    `[${UNINITIALISED.join(', ')}]`);
}

/**
 * Trace the movement block, sampling at $09D1 - the heading has just been read and the
 * position still holds last frame's result, so each sample is the input to one step and the
 * sample after it is the answer.
 *
 * Traces are counted in SAMPLES, not cycles. One iteration of the game's loop is about
 * 133,000 instructions - it renders the whole scene and then the scope inset, so the game
 * runs at roughly 3Hz - and a budget of 17030 cycles, one video frame, gets nowhere near the
 * next pass. Sizing this by cycles produced ninety-frame traces holding a single sample.
 */
await a2.ev(`(() => {
  window.M.traceFlight = (want, poke) => {
    const cpu = window.M.cpu, rd = window.M.rd;
    const g24 = (i) => {
      const v = rd(0x9800 + i) | (rd(0x9801 + i) << 8) | (rd(0x9802 + i) << 16);
      return v > 0x7FFFFF ? v - 0x1000000 : v;
    };
    const out = [];
    let table0 = null;
    cpu.stepCyclesDebug(17030 * 40000, () => {
      if (cpu.getPC() !== 0x09D1) return;
      if (table0 === null) {
        // The poke goes in here, at the top of the movement block, so that sample 0 holds the
        // value and whatever it provokes happens between sample 0 and sample 1.
        if (poke) {
          const wr = window.M.wr, v = poke.value & 0xFFFFFF, b = 0x9800 + poke.index;
          wr(b, v & 0xff); wr(b + 1, (v >> 8) & 0xff); wr(b + 2, (v >> 16) & 0xff);
        }
        table0 = [];
        for (let a = 0x9800; a < 0x98F3; a++) table0.push(rd(a));
      }
      out.push({
        heading: rd(0x811E), gate: rd(0x0948), burn: rd(0x0956), warp: rd(0x81F3),
        posX: g24(${VAR.posX}), posZ: g24(${VAR.posZ}),
        xi: rd(0x8116) | (rd(0x8117) << 8), zi: rd(0x811A) | (rd(0x811B) << 8),
      });
      if (out.length >= want) return true;
    });
    return { table0, samples: out, complete: out.length >= want };
  };
  return 'ok';
})()`);
const traceFlight = (samples, poke = null) => a2.ev(
  `JSON.stringify(window.M.traceFlight(${samples}, ${JSON.stringify(poke)}))`).then(JSON.parse);
const setPaddle = (n, v) => a2.ev(`(() => { window.M.a2.getIO().paddle(${n}, ${v}); return 'p'; })()`);

/**
 * Seed a port-side Flight from a sample and replay the rest of the trace through it.
 * @returns {{first: number, mismatches: number, total: number, detail: string[]}}
 */
function replay(table0, samples) {
  const f = new Flight();
  f.math.table.set(table0, 0);
  const detail = [];
  let mismatches = 0, first = -1;
  for (let i = 0; i < samples.length - 1; i++) {
    f.gate = samples[i].gate;
    f.step(samples[i].heading);
    const want = samples[i + 1];
    if (f.positionX !== want.posX || f.positionZ !== want.posZ) {
      mismatches++;
      if (first < 0) first = i;
      if (detail.length < 3) {
        detail.push(`frame ${i} (heading ${samples[i].heading}, gate ${samples[i].gate}): `
          + `port ${f.positionX}/${f.positionZ}, machine ${want.posX}/${want.posZ}`);
      }
    }
  }
  return { first, mismatches, total: samples.length - 1, detail };
}

// --- flying straight under warp ----------------------------------------------------------------
console.log('');
console.log('=== warp engaged, paddle 0 centred ===');
let straight;
{
  await setPaddle(0, 127);
  await setPaddle(1, 0);
  const { table0, samples } = await traceFlight(STRAIGHT);
  straight = samples;
  check('the trace sampled the movement block on every pass', samples.length === STRAIGHT,
    `${samples.length} of ${STRAIGHT} samples`);
  const open = samples.filter((s) => s.gate === GATE_OPEN).length;
  check('and the gate is open, so the block actually ran',
    open >= STRAIGHT - 2, `${open} of ${samples.length} frames open`);
  const moved = new Set(samples.map((s) => s.posX)).size;
  check('and the ship moved, so there is something to get wrong', moved >= STRAIGHT - 2,
    `${moved} distinct X positions across ${samples.length} frames`);

  // XI and ZI are what the renderer actually reads, so the published coordinate is held as
  // well as the 24-bit position behind it.
  {
    const f = new Flight();
    f.math.table.set(table0, 0);
    const bad = [];
    for (let i = 0; i < samples.length - 1; i++) {
      f.gate = samples[i].gate;
      f.step(samples[i].heading);
      const want = samples[i + 1];
      const xi = want.xi > 0x7FFF ? want.xi - 0x10000 : want.xi;
      const zi = want.zi > 0x7FFF ? want.zi - 0x10000 : want.zi;
      if (f.x !== xi || f.z !== zi) bad.push(`frame ${i}: port ${f.x}/${f.z}, XI/ZI ${xi}/${zi}`);
    }
    check('and the coordinate it publishes matches XI and ZI in the display list',
      bad.length === 0 && samples.length > 1, bad.slice(0, 2).join('; ')
        || `${samples.length - 1} frames of XI and ZI`);
  }

  const r = replay(table0, samples);
  check('the port reproduces every position in the trace, seeded once and never resynced',
    r.mismatches === 0 && r.total >= STRAIGHT - 1, r.detail.join(' | ')
      || `${r.total} steps, 24 bits each, fraction included`);
}

// --- turning -----------------------------------------------------------------------------------
console.log('');
console.log('=== warp engaged, paddle 0 hard over ===');
{
  await setPaddle(0, 255);
  const { table0, samples } = await traceFlight(TURN);
  const headings = new Set(samples.map((s) => s.heading));
  check('the heading changes during the trace, so the heading tables are exercised',
    samples.length === TURN && headings.size >= 8,
    `${headings.size} distinct headings over ${samples.length} frames`);
  const r = replay(table0, samples);
  check('the port follows the turn exactly', r.mismatches === 0 && r.total >= TURN - 1,
    r.detail.join(' | ') || `${r.total} steps across ${headings.size} headings`);

  // A control: the same replay with the heading held at the first sample's value. If the
  // trace did not really turn, this would pass too.
  const flat = samples.map((s, i) => (i ? { ...s, heading: samples[0].heading } : s));
  const control = replay(table0, flat);
  check('control: replaying it with the heading frozen does not match',
    control.mismatches > 0, `${control.mismatches} of ${control.total} steps differ`);
}

// --- the wrap ----------------------------------------------------------------------------------
// The edges are 3072 units away, which the ship does not reach in a 90-frame trace. Rather
// than fly there, the position is moved close to the boundary and the loop is let run across
// it, so the wrap is exercised in the machine rather than only in the port.
console.log('');
console.log('=== crossing the edge of the world ===');
{
  await setPaddle(0, 127);
  // The margin matters. One pass moves the ship up to 100 * 256 * 256 / 1280 = 5120, and the
  // step is applied BEFORE the bound is tested, so a poke that clears the bound by less than
  // that can be pulled back inside and never wrap. 790000 - only 3568 past the X bound - did
  // exactly that whenever the heading pointed the other way.
  for (const [label, index, value] of [
    ['X past the maximum', VAR.posX, 800000],
    ['X past the minimum', VAR.posX, -800000],
    ['Z past the maximum', VAR.posZ, 424000],
    ['Z past the minimum', VAR.posZ, -358000],
  ]) {
    const { table0, samples } = await traceFlight(WRAP, { index, value });
    // A wrap shows up as the position jumping the full width of the world in one pass, and
    // because the poke lands at the top of the block it has to be the very first one.
    const jump = (i) => Math.abs(samples[i + 1].posX - samples[i].posX) > 1000000
      || Math.abs(samples[i + 1].posZ - samples[i].posZ) > 700000;
    const r = replay(table0, samples);
    check(`${label}: the machine wraps on the next pass and the port wraps with it`,
      samples.length === WRAP && jump(0) && r.mismatches === 0,
      `${samples.length} samples, wrapped on step 0: ${samples.length > 1 ? jump(0) : 'n/a'}`
        + `, ${r.total} steps` + (r.mismatches ? '; ' + r.detail.join(' | ') : ''));
  }
}

// --- the throttle ------------------------------------------------------------------------------
console.log('');
console.log('=== the throttle ===');
{
  // Closed gate: the block is skipped, so the position must not move at all.
  await setPaddle(1, 255);
  const idle = await traceFlight(IDLE);
  const still = idle.samples.every((s) => s.posX === idle.samples[0].posX
    && s.posZ === idle.samples[0].posZ);
  check('with the paddle at rest the gate closes and the ship stops dead',
    idle.samples.length === IDLE && idle.samples.every((s) => s.gate === 0) && still,
    `${idle.samples.length} frames, position unchanged: ${still}`);
  const r = replay(idle.table0, idle.samples);
  check('and the port stands still too, running the wrap but not the move',
    r.mismatches === 0 && r.total >= IDLE - 1, r.detail.join(' | ') || `${r.total} steps`);

  // The burn counter and WARP. A unit is spent every $37 - 55 - passes, and at 133,000
  // instructions a pass that is a long wait, so the counter is put near its limit first. The
  // mechanism under test is the crossing, not the counting up to it.
  await setPaddle(1, 0);
  await a2.ev(`(() => { window.M.wr(0x0956, 0x31); return 'set'; })()`);
  const burn = await traceFlight(BURN);
  const spent = burn.samples[0].warp - burn.samples[burn.samples.length - 1].warp;
  check('warp fuel is spent while engaged', spent > 0,
    `WARP went from ${burn.samples[0].warp} to ${burn.samples[burn.samples.length - 1].warp}`);

  const f = new Flight();
  f.math.table.set(burn.table0, 0);
  f.burnCounter = burn.samples[0].burn;
  let warp = burn.samples[0].warp, bad = 0;
  for (let i = 0; i < burn.samples.length - 1; i++) {
    warp = f.throttle(0, warp);
    if (warp !== burn.samples[i + 1].warp) bad++;
  }
  check('the port spends it on the same frames, from the same counter',
    bad === 0, bad ? `${bad} of ${burn.samples.length - 1} frames differ`
      : `${burn.samples.length - 1} frames, ${spent} unit${spent === 1 ? '' : 's'} spent`);
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/flight.json', JSON.stringify({
  results, straightSamples: straight.length,
}, null, 1) + String.fromCharCode(10));

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_flight: all ${results.length} checks passed`
  : `parity_flight: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
