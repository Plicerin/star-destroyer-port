// The port's sound generator against $1D52, in the machine.
//
// The comparison is the whole waveform: every cycle number at which the speaker flipped, in
// order, for the entire run. Not a count, not a duration - the thing the port has to reproduce
// IS the timing, so anything less than the complete list would be comparing a summary.
//
// That makes this the strictest harness in the suite and the easiest to read when it fails:
// the first disagreement names the toggle, and a toggle that is right but one cycle late means
// exactly one instruction's cost is wrong.
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { generate, generateTone, play, render, SOUNDS, PARAM, CPU_HZ }
  from '../port/src/game/sound.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  window.M.runEngine = (addr, block, y, after, sp) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = []; for (let a = 0x1D4A; a <= 0x1D51; a++) snap.push(rd(a));
    for (let i = 0; i < 8; i++) wr(0x1D4A + i, block[i] & 0xff);
    const st = cpu.getState();
    // The stack pointer goes first: $1D9F's period starts from whatever $FF4A finds there,
    // so setting it after pushing the return address would leave the RTS popping nothing.
    if (sp !== null && sp !== undefined) st.sp = sp & 0xff;
    wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
    wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
    st.pc = addr; st.y = y & 0xff;
    cpu.setState(st);
    const t0 = cpu.getCycles();
    const set = new Set(after);
    let ok = false; const at = []; let prev = addr; let firstX = null;
    cpu.stepCyclesDebug(120000000, () => {
      const pc = cpu.getPC();
      // The callback fires AFTER an instruction, so the speaker was touched by the one that
      // just ran - which is the previous callback's PC. $1DA5 is also a branch target, so
      // watching where control lands would count the loop as well.
      if (set.has(prev)) at.push(cpu.getCycles() - t0);
      // And $1D9F's period counter, read where it is used rather than reasoned about.
      if (firstX === null && prev === 0x1DA2 && pc === 0x1DA5) firstX = cpu.getState().x;
      prev = pc;
      if (pc === 0xFFFF) { ok = true; return true; }
    });
    const cycles = cpu.getCycles() - t0;
    const end = cpu.getState();
    const out = [];
    for (let a = 0x1D4A; a <= 0x1D51; a++) out.push(rd(a));
    for (let a = 0x1D4A; a <= 0x1D51; a++) wr(a, snap[a - 0x1D4A]);
    cpu.setState(before);
    return { ok, cycles, at, block: out, y: end.y, firstX };
  };
  return 'ok';
})()`);
/** The three speaker accesses in the binary: $1D52's, $1D9F's and $1DBA's. */
const AFTER = [0x1D67, 0x1DA2, 0x1DC5];
const runEngine = (addr, block, y, sp = null) => a2.ev('JSON.stringify(window.M.runEngine('
  + addr + ',' + JSON.stringify([...block]) + ',' + y + ',' + JSON.stringify(AFTER) + ','
  + sp + '))').then(JSON.parse);

/** Where the two waveforms first disagree, as a sentence. */
function firstDiff(engine, port) {
  if (engine.cycles !== port.cycles) {
    return `the run is ${engine.cycles} cycles and the port makes it ${port.cycles}`;
  }
  if (engine.at.length !== port.toggles.length) {
    return `${engine.at.length} toggles against ${port.toggles.length}`;
  }
  for (let i = 0; i < engine.at.length; i++) {
    if (engine.at[i] !== port.toggles[i]) {
      return `toggle ${i} at cycle ${engine.at[i]}, the port says ${port.toggles[i]}`
        + ` (${port.toggles[i] - engine.at[i]} out)`;
    }
  }
  return '';
}

// --- the generator, over the blocks the game uses ----------------------------------------------
console.log('\n=== $1D52 against the port, every toggle ===');
{
  const bad = [];
  let runs = 0, toggles = 0;
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52)) {
    for (const [i, stage] of s.stages.entries()) {
      const engine = await runEngine(0x1D52, stage.block, stage.y);
      if (!engine.ok) {
        bad.push(`${s.name} stage ${i}: the engine never returned`);
        continue;
      }
      const port = generate(stage.block, stage.y);
      runs++;
      toggles += engine.at.length;
      const d = firstDiff(engine, port);
      if (d) bad.push(`${s.name} stage ${i}: ${d}`);
      // And the state it leaves, which the next stage and the next sound inherit.
      if (engine.block[PARAM.shiftLo] !== port.shift[0]
        || engine.block[PARAM.shiftHi] !== port.shift[1]
        || engine.block[PARAM.period] !== port.period || engine.y !== port.y) {
        bad.push(`${s.name} stage ${i}: the carried state differs -`
          + ` shift ${engine.block[1]},${engine.block[2]} against ${port.shift.join(',')}`);
      }
    }
  }
  check('all eight stages of the six sounds agree, cycle for cycle',
    bad.length === 0 && runs === 8, bad.slice(0, 2).join('; ')
      || `${runs} runs, ${toggles} toggles, and the shift register and Y it leaves behind`);
}
{
  // The state dependence is the point, so it gets swept: the same block from many seeds.
  const bad = [];
  let runs = 0, lengths = new Set();
  const SEEDS = [[0, 0], [0xA5, 0x5A], [0xFF, 0xFF], [1, 0x80], [0x3C, 0xC3], [0x10, 0x01]];
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52)) {
    const stage = s.stages[0];
    for (const [lo, hi] of SEEDS) {
      const block = [...stage.block];
      block[PARAM.shiftLo] = lo;
      block[PARAM.shiftHi] = hi;
      const engine = await runEngine(0x1D52, block, stage.y);
      const port = generate(block, stage.y);
      runs++;
      lengths.add(engine.at.length);
      const d = firstDiff(engine, port);
      if (d) bad.push(`${s.name} seed ${lo},${hi}: ${d}`);
    }
  }
  check('and from every shift-register seed, which is what the waveform really depends on',
    bad.length === 0 && lengths.size > 10, bad.slice(0, 2).join('; ')
      || `${runs} runs over six seeds, producing ${lengths.size} distinct toggle counts`);
}
{
  // Y matters too, because the sweep decrements it and nothing sets it.
  const bad = [];
  let varied = 0;
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52)) {
    const stage = s.stages[0];
    const base = await runEngine(0x1D52, stage.block, stage.y);
    for (const y of [0, 1, 2, 64, 128, 200, 255]) {
      const engine = await runEngine(0x1D52, stage.block, y);
      const port = generate(stage.block, y);
      const d = firstDiff(engine, port);
      if (d) bad.push(`${s.name} Y=${y}: ${d}`);
      if (engine.at.length !== base.at.length) varied++;
    }
  }
  check('and from every entry value of Y, which the sweep decrements and nobody sets',
    bad.length === 0 && varied > 5, bad.slice(0, 2).join('; ')
      || `42 runs, ${varied} of them a different length from what the game happened to pass`);
}
{
  // The whole parameter space, not just the blocks this game picked.
  let seed = 0x1D521FB2;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return seed / 0x80000000;
  };
  const byte = () => Math.floor(rnd() * 256);
  const bad = [];
  let runs = 0, silent = 0, swept = 0;
  for (let i = 0; i < 90; i++) {
    const block = [byte(), byte(), byte(),
      1 + Math.floor(rnd() * 24), 1 + Math.floor(rnd() * 3),
      Math.floor(rnd() * 40), rnd() < 0.4 ? 0 : byte(), byte()];
    const y = byte();
    const engine = await runEngine(0x1D52, block, y);
    if (!engine.ok) { bad.push(`random ${i}: never returned`); continue; }
    const port = generate(block, y);
    runs++;
    if (engine.at.length === 0) silent++;
    if (block[PARAM.sweep] !== 0) swept++;
    const d = firstDiff(engine, port);
    if (d) bad.push(`random ${i} block ${block.join(',')} Y=${y}: ${d}`);
  }
  check('and over random parameter blocks the game never uses, sweep and all',
    bad.length === 0 && runs > 80 && swept > 30, bad.slice(0, 2).join('; ')
      || `${runs} blocks, ${swept} with the sweep on, ${silent} that never toggle at all`);
}

// --- the other generator -----------------------------------------------------------------------
console.log('\n=== $1D9F, which $1FB2 drives ===');
{
  const buzz = SOUNDS.find((x) => x.engine === 0x1D9F);
  const bad = [];
  let runs = 0, toggles = 0;
  for (const [i, stage] of buzz.stages.entries()) {
    const engine = await runEngine(0x1D9F, stage.block, stage.y, stage.sp);
    if (!engine.ok) {
      bad.push(`stage ${i}: never returned`);
      continue;
    }
    const port = generateTone(stage.block, engine.firstX, stage.y);
    runs++;
    toggles += engine.at.length;
    const d = firstDiff(engine, port);
    if (d) bad.push(`stage ${i}: ${d}`);
  }
  check('all three stages of $1FB2 agree, cycle for cycle',
    bad.length === 0 && runs === 3, bad.slice(0, 2).join('; ')
      || `${runs} stages, ${toggles} toggles - periods `
        + buzz.stages.map((s) => s.block[PARAM.other]).join(', ') + ' and durations '
        + buzz.stages.map((s) => s.block[PARAM.duration]).join(', '));

  // The two pieces of carried state nothing sets, swept. This is why the first version of
  // this port embedded a captured waveform and was wrong to: there is no one waveform.
  const swept = [];
  const varied = new Set();
  for (const stage of buzz.stages) {
    for (const sp of [0x40, 0x80, 0xBF, 0xF0, 0xFF]) {
      for (const y of [0, 1, 64, 127, 200, 255]) {
        const engine = await runEngine(0x1D9F, stage.block, y, sp);
        const port = generateTone(stage.block, engine.firstX, y);
        varied.add(engine.at.length);
        const d = firstDiff(engine, port);
        if (d) swept.push(`sp ${sp} y ${y}: ${d}`);
      }
    }
  }
  check('and from every stack pointer and Y, which is what it really depends on',
    swept.length === 0 && varied.size > 3, swept.slice(0, 2).join('; ')
      || `90 runs over five stack pointers and six values of Y, giving ${varied.size} distinct`
        + ' toggle counts - so a captured waveform would have been one of them, not the sound');

  // The first period is the stack pointer, not the entry at $1D4A, and here is the difference
  // anyone can see.
  const a = generateTone(buzz.stages[0].block, 0x3C, 127);
  const b = generateTone(buzz.stages[0].block, 0xEC, 127);
  check('and the FIRST gap is the stack pointer, where every gap after it is the period',
    a.toggles[1] - a.toggles[0] !== b.toggles[1] - b.toggles[0]
      && a.toggles[2] - a.toggles[1] === b.toggles[2] - b.toggles[1],
    `first gap ${a.toggles[1] - a.toggles[0]} against ${b.toggles[1] - b.toggles[0]};`
      + ` the second is ${a.toggles[2] - a.toggles[1]} either way`);
}

// --- the sounds as the game plays them ---------------------------------------------------------
console.log('\n=== a sound, through all its stages, with the state carried ===');
{
  // `play` is the port composing the stages, and what has to hold is that the state one stage
  // leaves is the state the next one starts from. The absolute cycle numbers cannot be
  // compared against the whole routine, because the routine's own stores and its $1FA9 calls
  // cost cycles the engine does not and this port does not run them - so instead each stage is
  // run in the machine from the state the port predicts, and the toggles compared.
  const bad = [];
  let stages = 0, toggles = 0;
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52)) {
    const port = play(s, { shift: [0, 0], y: s.stages[0].y });
    let shift = [0, 0], y = s.stages[0].y, cursor = 0;
    for (const [i, stage] of s.stages.entries()) {
      const block = [...stage.block];
      block[PARAM.shiftLo] = shift[0];
      block[PARAM.shiftHi] = shift[1];
      const engine = await runEngine(0x1D52, block, y);
      stages++;
      toggles += engine.at.length;
      // The port's own run of this stage sits at `cursor` within its combined timeline.
      const mine = port.toggles.slice(cursor, cursor + engine.at.length)
        .map((t) => t - (cursor ? port.toggles[cursor - 1] - engine.at[0] + engine.at[0] : 0));
      const offset = cursor === 0 ? 0 : port.toggles[cursor] - engine.at[0];
      const got = port.toggles.slice(cursor, cursor + engine.at.length).map((t) => t - offset);
      if (got.join() !== engine.at.join()) {
        const k = got.findIndex((v, j) => v !== engine.at[j]);
        bad.push(`${s.name} stage ${i}: toggle ${k} at ${engine.at[k]}, the port has ${got[k]}`);
      }
      cursor += engine.at.length;
      shift = [engine.block[PARAM.shiftLo], engine.block[PARAM.shiftHi]];
      y = engine.y;
    }
    if (cursor !== port.toggles.length) {
      bad.push(`${s.name}: the port produced ${port.toggles.length} toggles, the stages ${cursor}`);
    }
  }
  check('play composes the stages, carrying the shift register and Y from one to the next',
    bad.length === 0 && stages === 8, bad.slice(0, 2).join('; ')
      || `${stages} stages, ${toggles} toggles, every stage starting where the last one left off`);

  // And the chain is real, not an artifact of how the port is driven: the block the SECOND
  // stage of a two-stage sound was captured with already holds what the first one leaves.
  const chained = [];
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52 && x.stages.length > 1)) {
    const first = await runEngine(0x1D52, s.stages[0].block, s.stages[0].y);
    const want = [s.stages[1].block[PARAM.shiftLo], s.stages[1].block[PARAM.shiftHi]];
    const got = [first.block[PARAM.shiftLo], first.block[PARAM.shiftHi]];
    chained.push(`${s.name}: ${got.join(',')} ${got.join() === want.join() ? '==' : '!='}`
      + ` ${want.join(',')}`);
  }
  check('and the two multi-stage sounds were captured with exactly that carried over',
    chained.length === 2 && chained.every((c) => c.includes('==')), chained.join('; '));
}

// --- the renderer ------------------------------------------------------------------------------
console.log('\n=== rendering a toggle list to audio ===');
{
  // The renderer is the port's own, not the disk's, so what can be checked is that it is
  // faithful to the toggle list: the right length, the right range, and a level that changes
  // sign exactly where the toggles are.
  const wave = { cycles: 1000, toggles: [100, 200, 300, 900] };
  const samples = render(wave, { sampleRate: CPU_HZ, amplitude: 1 });
  const signs = [...samples].map((v) => Math.sign(v));
  const flips = signs.reduce((n, v, i) => n + (i && v !== signs[i - 1] ? 1 : 0), 0);
  check('at one sample per cycle the level flips exactly once per toggle',
    samples.length === 1000 && flips === wave.toggles.length,
    `${samples.length} samples, ${flips} sign changes for ${wave.toggles.length} toggles`);
  check('and it starts in the position the speaker was left in, not at zero',
    samples[0] === -1 && samples[150] === 1,
    'one bit, so there is no zero to start from - only the other position');

  // At an audio rate each sample averages its own span, so nothing exceeds the amplitude and
  // a run with no toggles is flat.
  const real = render(play(SOUNDS[1], { shift: [0, 0], y: SOUNDS[1].stages[0].y }));
  const peak = Math.max(...[...real].map(Math.abs));
  check('at 44.1kHz the averaged samples stay inside the amplitude',
    peak <= 0.5 + 1e-9 && real.length > 1000,
    `${real.length} samples for ${SOUNDS[1].name}, peak ${peak.toFixed(3)}`
      + ` - ${(real.length / 44100).toFixed(2)}s`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
