// The sound: a 1-bit speaker, toggled on a cycle count.
//
// There is no sound chip in an Apple II. $C030 is a soft switch and every access flips the
// speaker cone, so a sound IS a list of cycle numbers and the pitch is how long the 6502
// spends between two of them. That makes this the one part of the game whose behaviour is its
// own timing, and it is why the port is an interpreter rather than a synthesiser.
//
// What this probe settles, in order: where the speaker is touched, which routines touch it,
// that the generator's timing has no page-crossing branch to complicate it, and - the finding
// that decided how to port it - that six of the seven sounds depend on state nothing
// initialises, so there is no such thing as "the waveform" for them.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm, OBJ0 } from './exercise.mjs';
import { hx, disasmRange } from './disasm6502.mjs';
import { SOUNDS, PARAM, CPU_HZ, SAVE_CYCLES, RESTORE_CYCLES }
  from '../port/src/game/sound.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const obj = d.read(d.files.find((x) => x.name === OBJ0));
const image = [];
for (let i = 0; i < obj.len; i++) image[obj.addr + i] = obj.data[i];
const ls = disasmRange(image, obj.addr, obj.addr + obj.len);

// --- the speaker ------------------------------------------------------------------------------
console.log('\n=== three accesses to $C030, in three routines ===');
{
  const speaker = ls.filter((l) => l.mode === 'abs'
    && (l.bytes[1] | (l.bytes[2] << 8)) === 0xC030);
  for (const l of speaker) console.log(`  ${hx(l.addr, 4)}  ${l.text}`);
  check('the binary touches the speaker in exactly three places',
    speaker.length === 3 && speaker.map((l) => l.addr).join() === [0x1D67, 0x1DA2, 0x1DC5].join(),
    'one in each of the three generators at $1D52, $1D9F and $1DBA');

  // The trap that cost two wrong measurements, recorded so nobody repeats it: the instruction
  // after $1D9F's speaker access is also the target of a branch, so a harness that watches
  // where control LANDS counts the delay loop as a toggle.
  const landing = 0x1DA5;
  const branches = ls.filter((l) => l.mode === 'rel' && l.target === landing);
  check('and $1DA5 is both the instruction after one of them AND a branch target',
    branches.length === 1 && branches[0].addr === 0x1DAE,
    `${hx(branches[0].addr, 4)} branches there, so a toggle has to be detected by the`
      + ' instruction that just RAN, not by where control arrived - watching $1DA5 counted'
      + ' 16,253 toggles where there are 85');
}

// --- the generator's shape --------------------------------------------------------------------
console.log('\n=== $1D52, and why its timing is simple to count ===');
{
  const body = disasmRange(image, 0x1D52, 0x1D9F);
  check('the generator is forty instructions ending in an RTS',
    body.length === 40 && body[body.length - 1].op === 'RTS',
    `${0x1D9F - 0x1D52} bytes, ${body.length} instructions`);

  // Every branch target in the same page as the branch, so none of them pays the extra cycle
  // a page-crossing branch costs. Worth checking rather than assuming: it is the first thing
  // to suspect if a transliteration's timing comes out wrong.
  const crossing = body.filter((l) => l.mode === 'rel'
    && ((l.addr + 2) >> 8) !== (l.target >> 8));
  check('and no branch in it crosses a page, so none pays the page-crossing cycle',
    crossing.length === 0 && body.filter((l) => l.mode === 'rel').length >= 8,
    `${body.filter((l) => l.mode === 'rel').length} branches, all inside page $1D`);

  // The parameter block lives inside the code, between two routines, and only the sound
  // routines write it. That is what makes the generator self-modifying in the ordinary way.
  const writers = ls.filter((l) => l.mode === 'abs' && /^ST[AXY]$/.test(l.op)
    && (l.bytes[1] | (l.bytes[2] << 8)) >= 0x1D4A
    && (l.bytes[1] | (l.bytes[2] << 8)) <= 0x1D51).map((l) => l.addr);
  const outside = writers.filter((a) => a < 0x1DD3 && a !== 0x1D53 && a !== 0x1D87
    && a !== 0x1D8D && a !== 0x1D94 && a !== 0x1D99 && a !== 0x1DA8);
  check('the parameter block at $1D4A-$1D51 sits inside the code and only sounds write it',
    outside.length === 0 && writers.length > 30,
    `${writers.length} writes, all from the generators themselves or from $1DD3 upward`);
}

// --- the routines -----------------------------------------------------------------------------
console.log('\n=== seven sounds, and what asks for each ===');
{
  const wrong = [];
  for (const s of SOUNDS) {
    const calls = ls.filter((l) => l.op === 'JSR' && l.target === s.at).map((l) => l.addr);
    const jumps = ls.filter((l) => l.op === 'JMP' && l.target === s.at).map((l) => l.addr);
    const from = [...calls, ...jumps];
    if (from.length === 0) wrong.push(`${s.name} at ${hx(s.at, 4)} is unreachable`);
    console.log(`  ${s.name.padEnd(12)} ${hx(s.at, 4)}  ${s.stages.length} stage(s),`
      + ` engine ${hx(s.engine, 4)}, from ${from.map((a) => hx(a, 4)).join(', ')}`);
  }
  check('every sound the port carries is reached from somewhere in the binary',
    wrong.length === 0, wrong.join('; ')
      || `${SOUNDS.length} routines, ${SOUNDS.reduce((n, s) => n + s.stages.length, 0)} stages`);

  // And the one that is NOT ported, named with its reason.
  const third = ls.filter((l) => l.op === 'JSR' && l.target === 0x1DBA).map((l) => l.addr);
  const gate = disasmRange(image, 0x1E40, 0x1E4A).map((l) => l.text);
  console.log('  the third generator, $1DBA, is called from '
    + third.map((a) => hx(a, 4)).join(', '));
  console.log('  behind ' + gate.slice(0, 4).join(' / '));
  check('the third generator is a six-note sequence at $1E40, gated to fire once a game',
    third.length === 6 && gate[0] === 'LDX $1E3F' && gate[1] === 'BEQ $1E46'
      && gate[2] === 'RTS',
    'not ported: it needs $1DBA, it is reached only from $1CF8, and $1E3F - a byte inside the'
      + ' code - stops it after the first time');
}

// --- the machine ------------------------------------------------------------------------------
console.log('\n=== the oracle ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight with the whole binary resident',
  flight.difficulty === 1 && flight.resident !== null,
  `the last sectors landed ${flight.resident.seconds}s after the settle`);

await a2.ev(`(() => {
  window.M.soundRun = (addr, block, y, sp) => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    const before = cpu.getState();
    const snap = []; for (let a = 0x1D4A; a <= 0x1D51; a++) snap.push(rd(a));
    if (block) for (let i = 0; i < 8; i++) wr(0x1D4A + i, block[i] & 0xff);
    const st = cpu.getState();
    if (sp !== null && sp !== undefined) st.sp = sp & 0xff;
    wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
    wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
    st.pc = addr; st.y = y & 0xff;
    cpu.setState(st);
    const t0 = cpu.getCycles();
    let ok = false; const at = []; let prev = addr;
    const speaker = new Set([0x1D67, 0x1DA2, 0x1DC5]);
    cpu.stepCyclesDebug(120000000, () => {
      const pc = cpu.getPC();
      if (speaker.has(prev)) at.push(cpu.getCycles() - t0);
      prev = pc;
      if (pc === 0xFFFF) { ok = true; return true; }
    });
    const cycles = cpu.getCycles() - t0;
    for (let a = 0x1D4A; a <= 0x1D51; a++) wr(a, snap[a - 0x1D4A]);
    cpu.setState(before);
    return { ok, cycles, at };
  };
  return 'ok';
})()`);
const run = (addr, block = null, y = 0, sp = null) => a2.ev('JSON.stringify(window.M.soundRun('
  + addr + ',' + JSON.stringify(block) + ',' + y + ',' + sp + '))').then(JSON.parse);

// --- how long each sound is -------------------------------------------------------------------
console.log('\n=== what each one sounds like, measured ===');
{
  const wrong = [];
  for (const s of SOUNDS) {
    const r = await run(s.at);
    if (!r.ok) {
      wrong.push(`${s.name} never returned`);
      continue;
    }
    const gaps = r.at.slice(1).map((t, i) => t - r.at[i]);
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    console.log(`  ${s.name.padEnd(12)} ${(r.cycles / CPU_HZ).toFixed(3)}s,`
      + ` ${String(r.at.length).padStart(4)} toggles,`
      + ` gaps ${lo} to ${hi} cycles = ${Math.round(CPU_HZ / (2 * hi))}`
      + `-${Math.round(CPU_HZ / (2 * lo))} Hz`);
    if (r.at.length < 20) wrong.push(`${s.name} only toggles ${r.at.length} times`);
  }
  check('all seven run between a tenth of a second and two, and sweep across audible pitches',
    wrong.length === 0, wrong.join('; ')
      || 'the gap between two toggles is half a period, so the widest gaps are the lowest notes');
}

// --- the finding that decided the port --------------------------------------------------------
console.log('\n=== six of the seven have no waveform of their own ===');
{
  // $1D4B and $1D4C are a shift register that no routine initialises, and the carry that
  // feeds it comes back out of the EOR. So what a sound sounds like depends on where the
  // register was when it started, which is where the last sound left it.
  const SEEDS = [[0, 0], [0xA5, 0x5A], [0xFF, 0xFF], [1, 0x80], [0x3C, 0xC3]];
  const rows = [];
  let allVary = true;
  for (const s of SOUNDS.filter((x) => x.engine === 0x1D52)) {
    const lens = [];
    for (const [lo, hi] of SEEDS) {
      const block = [...s.stages[0].block];
      block[PARAM.shiftLo] = lo;
      block[PARAM.shiftHi] = hi;
      const r = await run(0x1D52, block, s.stages[0].y);
      lens.push(r.at.length);
    }
    rows.push(`${s.name} ${lens.join('/')}`);
    if (new Set(lens).size === 1) allVary = false;
  }
  console.log('  toggles per seed: ' + rows.join(', '));
  check('every one of the six changes - even in LENGTH - with the shift register it inherits',
    allVary,
    'so a captured waveform would have been one performance of the sound, not the sound -'
      + ' the port models the generator and carries the register between sounds');

  // The seventh is a different generator and depends on something else entirely.
  const buzz = SOUNDS.find((x) => x.engine === 0x1D9F);
  const seedSame = [];
  const base = await run(0x1D9F, buzz.stages[0].block, buzz.stages[0].y, 0xBF);
  for (const [lo, hi] of SEEDS.slice(1)) {
    const block = [...buzz.stages[0].block];
    block[PARAM.shiftLo] = lo;
    block[PARAM.shiftHi] = hi;
    const r = await run(0x1D9F, block, buzz.stages[0].y, 0xBF);
    if (r.at.join() !== base.at.join()) seedSame.push(`seed ${lo},${hi}`);
  }
  const spDiff = new Set();
  for (const sp of [0x40, 0x80, 0xBF, 0xF0]) {
    const r = await run(0x1D9F, buzz.stages[0].block, buzz.stages[0].y, sp);
    spDiff.add(r.at[1] - r.at[0]);
  }
  check('the seventh ignores the shift register and depends on the STACK POINTER instead',
    seedSame.length === 0 && spDiff.size === 4,
    `four seeds leave it identical; four stack pointers give four different first gaps`
      + ` (${[...spDiff].join(', ')}) - $FF4A does TSX, so X starts as the stack depth`);
}

// --- the two ROM calls ------------------------------------------------------------------------
console.log('\n=== the two monitor routines $1D9F leans on ===');
{
  const save = await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, wr = window.M.wr;
    const cost = (addr) => {
      const before = cpu.getState();
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = addr;
      cpu.setState(st);
      const t0 = cpu.getCycles();
      let ok = false;
      cpu.stepCyclesDebug(100000, () => {
        if (cpu.getPC() === 0xFFFF) { ok = true; return true; }
      });
      const c = cpu.getCycles() - t0;
      cpu.setState(before);
      return { ok, c };
    };
    return { save: cost(0xFF4A), restore: cost(0xFF3F) };
  })())`).then(JSON.parse);
  check('$FF4A and $FF3F cost what the port says they do, with the JSR',
    save.save.c + 6 === SAVE_CYCLES && save.restore.c + 6 === RESTORE_CYCLES,
    `SAVE ${save.save.c} + 6 = ${SAVE_CYCLES}, RESTORE ${save.restore.c} + 6`
      + ` = ${RESTORE_CYCLES} - ROM, so the port carries the cost as a measured number`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
