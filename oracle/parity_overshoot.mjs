// The port's loader against the machine's memory, over the whole of what a boot loads.
//
// `probe_overshoot.mjs` established the model on one file and one sixteen-byte window. This
// holds it on all of them at once: every `BLOAD` and `BRUN` on the path from the boot to the
// flight is extracted **from the detokenised programs on the disk**, replayed in program order
// with the port's `bload`, and the resulting 64K image compared against the running machine.
//
// That is a strong form of the claim, because the overshoots interact. `A2-3D2`'s one byte
// lands on the display list's first byte and `SV DATA` is loaded after it; `MAIN DATA`'s 213
// bytes land inside `HEADING DATA` and that is loaded after it; `PART2`, loaded at an
// overridden address, lands on `HEADING DATA`'s own slack. Get the model, the order or an
// address override wrong and the comparison moves.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { toFlight, OBJ0_VARIABLES } from './exercise.mjs';
import { listProgram } from './detokenise.mjs';
import { bload, overshoot } from '../port/src/game/dos.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v) => '$' + v.toString(16).toUpperCase().padStart(4, '0');

const d = openDisk(DISK);
const listing = (name) => {
  const f = d.files.find((x) => x.name === name);
  if (!f) throw new Error(`no program called ${name}`);
  const raw = d.read(f);
  const mem = new Uint8Array(0x10000);
  for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
  return listProgram(mem, 0x801);
};

/**
 * Every BLOAD and BRUN in a program, in line order, with the `,A` override if it has one.
 *
 * The listings write the DOS command three ways - `PRINT CHR$(4);"BLOAD X"`,
 * `PRINT CHR$(4)"BLOAD X"` and `PRINT "^DBLOADX"` - and the space after the verb is
 * optional, so the pattern has to allow all of it. An override is `,A$8BD8` or `,A35275`
 * or `,A-16384`.
 */
function loadsIn(name) {
  const out = [];
  for (const line of listing(name)) {
    // The hyphen matters: A2-3D2 is a file name. Leaving it out of this class silently
    // dropped the single biggest load on the path, and the comparison below is what said so.
    const re = /B(?:LOAD|RUN)\s*([A-Z0-9 .$-]+?)(?:,\s*A\s*(\$?-?\s*[0-9A-F]+))?"/g;
    for (const m of line.text.matchAll(re)) {
      const file = m[1].trim();
      let at = null;
      if (m[2]) {
        const t = m[2].replace(/\s+/g, '');
        at = t.startsWith('$') ? parseInt(t.slice(1), 16) : parseInt(t, 10);
        if (at < 0) at += 0x10000;
      }
      out.push({ program: name, line: line.num, file, at });
    }
  }
  return out;
}

// The chain the machine walks to reach a flight, as probe_progression established it.
const PATH = ['START', 'LOGO1', 'SELECT', 'SD', 'SD START', 'SD PART2'];
const LOADS = PATH.flatMap(loadsIn);

console.log('\n=== the loads a boot performs, from the programs themselves ===');
for (const l of LOADS) {
  const f = d.files.find((x) => x.name === l.file);
  const r = f ? d.read(f) : null;
  const addr = l.at ?? r?.addr;
  console.log(`  ${l.program.padEnd(9)} ${String(l.line).padStart(4)}  ${l.file.padEnd(22)}`
    + (r ? ` ${hx(addr)}-${hx(addr + r.len - 1)}  +${overshoot(addr, r.len).bytes}` : '  MISSING')
    + (l.at === null ? '' : '  (address overridden)'));
}
{
  const missing = LOADS.filter((l) => !d.files.find((x) => x.name === l.file));
  check(`all ${LOADS.length} loads on the path to a flight name a file that is on the disk`,
    missing.length === 0,
    missing.map((m) => `${m.program} ${m.line}: ${m.file}`).join('; ')
      || `across ${PATH.length} programs - the two title pictures are gone from this image but`
        + ' their catalogue entries are not, which is why they still resolve here');
  // The two deleted pictures would break this, so it is worth saying which ones resolve.
  check('and the sequence ends with the mission binary, loaded last and overridden by nothing',
    LOADS[LOADS.length - 1].file === 'STAR DESTROYER.OBJ0'
      && LOADS[LOADS.length - 1].at === null,
    `${LOADS[LOADS.length - 1].program} line ${LOADS[LOADS.length - 1].line}`);
}

/** Replay the loads into a fresh image. */
function replay(loads, opts = {}) {
  const mem = new Uint8Array(0x10000);
  for (const l of loads) {
    const f = d.files.find((x) => x.name === l.file);
    if (!f || f.type !== 'BINARY') continue;
    bload(mem, d.read(f), { at: l.at, ...opts });
  }
  return mem;
}

// ---------------------------------------------------------------- against the machine ------
console.log('\n=== against the machine ===');
const a2 = await openOracle();
let liveImage = null;
try {
  const f = await toFlight(a2, { difficulty: 1 });
  console.log(`  at a flight, difficulty ${f.difficulty}, binary resident after`
    + ` ${f.resident.seconds}s`);
  liveImage = Uint8Array.from(JSON.parse(await a2.ev(
    'JSON.stringify(window.M.range(0x0800, 0xA000))')));
} finally {
  await a2.close();
}
const live = (a) => liveImage[a - 0x0800];

// What the running game changes, and so cannot be compared: its own variables, the display
// list it pokes every frame, both hi-res pages, and the four interface bytes the binary writes.
const MOVES = [
  ...OBJ0_VARIABLES,
  [0x80FB, 0x82E5],                       // the display list
  [0x2000, 0x5FFF],                       // the two hi-res pages
  [0x1FF5, 0x1FF5], [0x1FF9, 0x1FFB],     // $09A0's INC and the two wave DECs
  [0x0000, 0x07FF],                       // zero page, the stack, the text screen
];
const moves = (a) => MOVES.some(([lo, hi]) => a >= lo && a <= hi);

const REGIONS = [
  ['the mission binary', 0x08EF, 0x1FF0],
  ['its slack, over the interface', 0x1FF1, 0x1FFF],
  // A2-3D2's image is not here: it rewrites its own instructions as it runs, which
  // probe_renderer established and parity_frame holds. Its one byte of overshoot is below.
  ["SV DATA's slack", 0x82E6, 0x82F6],
  ['MAIN DATA', 0x83AE, 0x89D4],
  ['HEADING DATA', 0x89CB, 0x8BD2],
  ['PART2, at its overridden address', 0x8BD8, 0x8D27],
  ['MATH', 0x98F3, 0x9CF1],
];

/**
 * Slack that is **not** still there by the time the flight runs.
 *
 * The regions above are what a boot loads and the game then leaves alone. These two are the
 * exception and the reason is worth stating: both sit in memory something else goes on to
 * use, so the bytes a load leaves there are gone before anything could read them. That is
 * asserted below rather than assumed, because "it did not match so I stopped comparing it"
 * is not a measurement.
 */
const REUSED = [
  ["PART2's slack", 0x8D28, 0x8DD3],
  ["MATH's slack, which is inside DOS's own space on this disk", 0x9CF2, 0x9DEE],
];
{
  const mem = replay(LOADS);
  const bad = [];
  let compared = 0;
  const perRegion = [];
  for (const [what, lo, hi] of REGIONS) {
    let n = 0, diff = 0, first = null;
    for (let a = lo; a <= hi; a++) {
      if (moves(a)) continue;
      n++; compared++;
      if (mem[a] !== live(a)) { diff++; if (first === null) first = a; }
    }
    perRegion.push({ what, n, diff, first });
    if (diff) bad.push(`${what}: ${diff} of ${n}, first ${hx(first)}`
      + ` (port ${mem[first]}, machine ${live(first)})`);
  }
  for (const r of perRegion) {
    console.log(`  ${r.what.padEnd(34)} ${String(r.n).padStart(5)} bytes`
      + `  ${r.diff ? `${r.diff} DIFFER, first ${hx(r.first)}` : 'all agree'}`);
  }
  check(`replaying the loads reproduces ${compared} bytes of the machine's memory`,
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'every region a boot loads, the three overshoots that get repaired, and the one'
        + ' that does not');
}

{
  const mem = replay(LOADS);
  const rows = [];
  for (const [what, lo, hi] of REUSED) {
    let n = 0, diff = 0;
    for (let a = lo; a <= hi; a++) { if (moves(a)) continue; n++; if (mem[a] !== live(a)) diff++; }
    rows.push({ what, lo, hi, n, diff });
    console.log(`  ${what.padEnd(34)} ${String(n).padStart(5)} bytes  ${diff} reused`);
  }
  check('and the two slack regions that sit in memory something else uses are gone by then',
    rows.every((r) => r.diff > 0),
    rows.map((r) => `${hx(r.lo)}-${hx(r.hi)}: ${r.diff} of ${r.n} overwritten`).join('; ')
      + ' - so no part of the game can depend on what a load leaves there');
}

{
  // A2-3D2 ends at $80FA, so its last sector runs one byte over - onto $80FB, which is the
  // display list's first byte and the VIEWPORT opcode the whole scene starts with. SD START
  // line 2 loads SV DATA next, and that is the repair.
  const a23d2 = d.read(d.files.find((x) => x.name === 'A2-3D2'));
  const sv = d.read(d.files.find((x) => x.name === 'SV DATA'));
  const over = new Uint8Array(0x10000);
  bload(over, a23d2);
  const left = over[0x80FB], put = sv.data[0];
  check('A2-3D2 would leave a different byte at $80FB than SV DATA puts there',
    left !== put,
    `the overshoot writes ${left} and SV DATA writes ${put} - so the repair is observable,`
      + ' and a check that it happened can fail');
  check('and the machine has SV DATA\'s byte there, not A2-3D2\'s',
    live(0x80FB) === put,
    `$80FB = ${live(0x80FB)}, which is opcode ${put} - VIEWPORT, the instruction the scene`
      + ' starts with. Had the two loads been the other way round the display list would'
      + ' begin with a zero');
}

// ---------------------------------------------------------------- controls -----------------
console.log('\n=== controls ===');
{
  const count = (mem) => {
    let diff = 0;
    for (const [, lo, hi] of REGIONS) {
      for (let a = lo; a <= hi; a++) if (!moves(a) && mem[a] !== live(a)) diff++;
    }
    return diff;
  };

  // A loader with no overshoot at all.
  check('control: a loader that writes only each file\'s own bytes disagrees',
    count(replay(LOADS, { exact: true })) > 0,
    `${count(replay(LOADS, { exact: true }))} bytes - the slack is most of what these`
      + ' regions hold between the files');

  // The load order, reversed where it matters. MAIN DATA runs over HEADING DATA, so loading
  // HEADING DATA first leaves the damage standing.
  const swapped = LOADS.map((l) => ({ ...l }));
  const i = swapped.findIndex((l) => l.file === 'MAIN DATA');
  const j = swapped.findIndex((l) => l.file === 'HEADING DATA');
  [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
  check('control: loading HEADING DATA before MAIN DATA instead of after it disagrees',
    count(replay(swapped)) > 0,
    `${count(replay(swapped))} bytes - which is the 213 MAIN DATA runs over, and says the`
      + " order in SD START line 2 is doing work rather than being arbitrary");

  // And the address override on PART2.
  const noOverride = LOADS.map((l) => (l.file === 'PART2' ? { ...l, at: null } : l));
  check('control: loading PART2 at its catalogued address instead of $8BD8 disagrees',
    count(replay(noOverride)) > 0,
    `${count(replay(noOverride))} bytes - its entry says $2000, and SD PART2 line 164 says`
      + ' $8BD8');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
