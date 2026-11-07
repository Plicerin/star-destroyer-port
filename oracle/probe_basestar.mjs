// BASE STAR.OBJ0: the final mission, and how little of it is new.
//
// `SD PART3` BRUNs it after `SD START2` has loaded `SV DATA2` and `BASE STAR DATA` in place
// of the main mission's `SV DATA` and `MAIN DATA`. It is the last piece of the game that is
// gameplay rather than presentation, and the chain already reaches it and finds nothing.
//
// The headline is that it is **the same engine on a different mission**. It loads at the same
// address, enters at the same `$0957`, calls the same eleven MATH entries, reads the same
// paddle through the same `PREAD`, and calls the renderer the same three times. It is about
// two thirds the size: 1,369 instructions against 2,085.
//
// The differences that matter to a player are small and specific, and they are what this
// probe pins down - because a port that assumed the main mission's constants would get all
// of them wrong in ways no screenshot would show.
import { readFileSync } from 'node:fs';
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { traverse, disasmRange, disasm1 } from './disasm6502.mjs';
import { toFinale, FINALE_ENTRY, sdStart2Setup } from './exercise.mjs';
import { FATAL, HITS } from '../port/src/game/damage.js';
import { IFACE } from '../port/src/game/chain.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hx = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

const d = openDisk(DISK);
const read = (n) => d.read(d.files.find((x) => x.name === n));
const load = (n) => {
  const f = read(n);
  const m = new Uint8Array(0x10000);
  for (let i = 0; i < f.len; i++) m[f.addr + i] = f.data[i];
  return m;
};
const BS = read('BASE STAR.OBJ0');
const SD = read('STAR DESTROYER.OBJ0');
const bs = load('BASE STAR.OBJ0');
const sd = load('STAR DESTROYER.OBJ0');
const ENTRY = 0x0957;

// ---------------------------------------------------------------- the same engine --------
console.log('\n=== the same engine ===');
{
  check('it loads where the main mission loads, and is the same length',
    BS.addr === SD.addr && BS.len === SD.len,
    `both ${hx(BS.addr)}-${hx(BS.addr + BS.len - 1)}, ${BS.len} bytes - so SD PART3 can BRUN`
      + ' it over the top of whatever was there');

  // The shared head is MATH's directory, which both read through.
  let shared = 0;
  while (shared < BS.len && BS.data[shared] === SD.data[shared]) shared++;
  check('the first 105 bytes are identical - the MATH directory both read through',
    shared === 105 && BS.addr + shared - 1 === ENTRY,
    `identical through ${hx(BS.addr + shared - 1)} inclusive, which is the entry both`
      + ' jump to - the directory below it is MATH\'s and is read the same way by both');

  const bsCode = traverse(bs, [ENTRY], { lo: BS.addr, hi: BS.addr + BS.len });
  const sdCode = traverse(sd, [ENTRY], { lo: SD.addr, hi: SD.addr + SD.len });
  const text = (m, c) => disasmRange(m, 0x08EF, 0x1FF1, { code: c.starts })
    .map((i) => i.text).join('\n');
  const bsText = text(bs, bsCode), sdText = text(sd, sdCode);
  const entries = (t) => {
    const out = {};
    for (const m of t.matchAll(/JSR \$(9[89A-C][0-9A-F]{2})/g)) out[m[1]] = (out[m[1]] ?? 0) + 1;
    return out;
  };
  const be = entries(bsText), se = entries(sdText);
  console.log(`  ${bsCode.starts.size} instructions against the main mission's`
    + ` ${sdCode.starts.size}`);
  check('it calls the same MATH entry points, and no others',
    Object.keys(be).every((k) => se[k]) && Object.keys(be).length === 11,
    `${Object.keys(be).length} entries, ${Object.values(be).reduce((a, b) => a + b, 0)} calls`
      + ` against ${Object.values(se).reduce((a, b) => a + b, 0)} - so every piece of the`
      + " port's MATH applies unchanged");
  check('and it reads the paddle and calls the renderer exactly as the main mission does',
    (bsText.match(/JSR \$FB1E/g) ?? []).length === (sdText.match(/JSR \$FB1E/g) ?? []).length
      && (bsText.match(/JSR \$6000/g) ?? []).length === (sdText.match(/JSR \$6000/g) ?? []).length,
    '2 paddle reads and 3 render calls in each');
}

// ---------------------------------------------------------------- the scene --------------
console.log('\n=== the scene: SV DATA2 against SV DATA ===');
{
  const a = read('SV DATA'), b = read('SV DATA2');
  const diffs = [];
  for (let i = 0; i < Math.min(a.len, b.len); i++) {
    if (a.data[i] !== b.data[i]) diffs.push(a.addr + i);
  }
  // Which object, and which field of it.
  const objectOf = (addr) => {
    for (let i = 0; i < 24; i++) {
      const base = i < 12 ? 0x8123 + i * 13 : 0x8247 + (i - 12) * 13;
      if (addr >= base && addr < base + 13) return { i, off: addr - base };
    }
    return null;
  };
  const hits = diffs.map(objectOf);
  for (const [n, addr] of diffs.entries()) {
    const o = hits[n];
    console.log(`  ${hx(addr)}  object ${o ? o.i : '?'} offset ${o ? o.off : '?'}`
      + `  ${a.data[addr - a.addr]} -> ${b.data[addr - b.addr]}`);
  }
  check('the two display lists differ in eight bytes and nothing else',
    diffs.length === 8,
    `${diffs.length} of ${a.len} bytes - the finale draws the same scene with different`
      + ' models in five of its object slots');
  check('and every one of them is a shape pointer, at offsets 11 and 12 of an object',
    hits.every((o) => o && (o.off === 11 || o.off === 12)),
    'offset 11 is the shape and 12 is the byte above it, so the only thing that changes is'
      + ' which model each slot draws');
  check('objects 1 to 5 are the ones that change',
    [...new Set(hits.map((o) => o.i))].join(',') === '1,2,3,4,5',
    `objects ${[...new Set(hits.map((o) => o.i))].join(', ')}`);
}

// ---------------------------------------------------------------- the models -------------
console.log('\n=== the models: BASE STAR DATA against MAIN DATA ===');
{
  const a = read('MAIN DATA'), b = read('BASE STAR DATA');
  let same = 0;
  for (let i = 0; i < Math.min(a.len, b.len); i++) if (a.data[i] === b.data[i]) same++;
  check('the model data is substantially different, as a different mission needs',
    same < a.len * 0.8 && a.len === b.len,
    `${same} of ${a.len} bytes identical - two thirds, so the two files share a lot of`
      + ' structure and differ in the shapes themselves');
}

// ---------------------------------------------------------------- the rules --------------
console.log('\n=== the rules that differ, and would be silently wrong if assumed ===');
{
  const bsCode = traverse(bs, [ENTRY], { lo: BS.addr, hi: BS.addr + BS.len });
  // Two hits, not four. $10E5 LDX $0933 / CPX #$02 / BNE / RTS.
  const fatalHere = bs[0x10E9];
  check(`two hits end the final mission, where the main one allows ${FATAL}`,
    bs[0x10E5] === 0xAE && (bs[0x10E6] | (bs[0x10E7] << 8)) === HITS
      && bs[0x10E8] === 0xE0 && fatalHere === 2 && bs[0x10EC] === 0x60,
    `${hx(0x10E5)} reads ${hx(HITS)} and ${hx(0x10E8)} is CPX #$02 with an RTS under it -`
      + ` a port that carried ${FATAL} across would make the finale twice as survivable`);

  // $1FF7 counts to fifteen.
  check('$1FF7 is its progress counter and fifteen is the number',
    (bs[0x10EE] | (bs[0x10EF] << 8)) === IFACE.finale && bs[0x10F1] === 0x0F,
    `${hx(0x10ED)} LDX ${hx(IFACE.finale)} / CPX #$0F, and at fifteen it calls two blocks,`
      + ' resets the counter and puts 4 in $093E');

  // Two places mark the win, and they INC rather than store.
  const incSites = [];
  for (let a = BS.addr; a < BS.addr + BS.len - 2; a++) {
    if (bs[a] === 0xEE && (bs[a + 1] | (bs[a + 2] << 8)) === IFACE.baseStar) incSites.push(a);
  }
  check('two places mark the base star dead, and both INCREMENT rather than store 1',
    incSites.length === 2 && incSites.join(',') === `${0x10A7},${0x112A}`,
    incSites.map((a) => hx(a)).join(' and ') + ` - so ${hx(IFACE.baseStar)} can reach 2, and`
      + ' SD PART3 tests it against 0 while INITIALS tests it against 1; reaching both sites'
      + ' would win the game and pay no bonus');

  // The wave counts it would set - and they are not reachable from the entry.
  // LDX #imm / STX abs, three times over, starting at $1803.
  const triple = [[0x1803, 0x05, IFACE.waves[0]], [0x1808, 0x03, IFACE.waves[1]],
    [0x180D, 0x03, IFACE.waves[2]]];
  const sets = triple.every(([a, n, target]) => bs[a] === 0xA2 && bs[a + 1] === n
    && bs[a + 2] === 0x8E && (bs[a + 3] | (bs[a + 4] << 8)) === target);
  check('a routine at $1803 would set the wave counters to 5, 3 and 3',
    sets,
    triple.map(([a, n, t]) => `${hx(a)} LDX #${n} / STX ${hx(t)}`).join(', ')
      + ' - the finale has its own wave counts hardcoded, where the main mission takes'
      + ' them from SD PART2');
  check('but nothing reaches it from the entry, so it is not part of the mission as it runs',
    !bsCode.starts.has(0x1803),
    'static traversal from $0957 never arrives at $1803 - recorded as found, not as a'
      + ' mechanism, because a routine nothing calls is not one');
}

// --------------------------------------------------- how much of it is already written ----
// Three routines turned up identical to the main mission's except for the addresses their own
// branches name. That is either three coincidences or a pattern, and the difference decides
// whether the finale is 1,369 instructions to write or a much smaller number.
//
// Asking it per routine was the wrong unit, three times over. It could only see JSR targets,
// so a routine reached only by JMP - $168A is one - was neither relocated nor the finale's
// own: it was invisible. It kept a routine's absolute operands literal, so the tone generator
// did not match its twin even though the two differ in nothing but their address. And a loop
// body is not a routine at all: the finale's frame loop has no RTS, so nothing could match it.
//
// So the question is asked of instructions instead. For a candidate pair of routines the delta
// is fixed by the two entry addresses, and every instruction must then be either byte-identical
// or differ only in an absolute operand off by exactly that delta. The deltas that survive are
// then grown over every instruction they explain, in runs of four or more. A delta is never
// fitted: each one is established by a whole routine matching, or by the contiguous region it
// accounts for.
console.log('\n=== how much of the finale is the main mission, moved ===');
{
  const image = (f) => {
    const mem = [];
    for (let i = 0; i < f.len; i++) mem[f.addr + i] = f.data[i];
    const { starts } = traverse(mem, [ENTRY], { lo: f.addr, hi: f.addr + f.len });
    return { mem, lo: f.addr, hi: f.addr + f.len, starts };
  };
  const bsImg = image(BS), sdImg = image(SD);

  /** A routine's instructions, to the first RTS, or null if it does not reach one. */
  const body = (img, entry) => {
    const insts = [];
    let a = entry;
    for (let i = 0; i < 500; i++) {
      if (!img.starts.has(a)) return null;
      const l = disasm1(img.mem, a);
      insts.push({ at: a, op: l.op, len: l.len, bytes: [...l.bytes] });
      if (l.op === 'RTS') break;
      a += l.len;
    }
    return insts.length && insts[insts.length - 1].op === 'RTS' ? insts : null;
  };

  /** Is the finale's routine at `f` the main mission's at `m`, moved by m - f? */
  const sameMoved = (f, m) => {
    const A = body(bsImg, f), B = body(sdImg, m);
    if (!A || !B || A.length !== B.length || A.length < 4) return null;
    const delta = m - f;
    for (let i = 0; i < A.length; i++) {
      const x = A[i], y = B[i];
      if (x.bytes[0] !== y.bytes[0] || x.len !== y.len) return null;
      if (x.len === 2 && x.bytes[1] !== y.bytes[1]) return null;
      if (x.len === 3) {
        const ax = x.bytes[1] | (x.bytes[2] << 8), ay = y.bytes[1] | (y.bytes[2] << 8);
        if (ax !== ay && ay - ax !== delta) return null;
      }
    }
    return { count: A.length, delta };
  };

  /** Every address a JSR or a JMP names, when the target is itself an instruction. */
  const called = (img) => {
    const out = new Set();
    for (const a of img.starts) {
      if (img.mem[a] !== 0x20 && img.mem[a] !== 0x4c) continue;
      const t = img.mem[a + 1] | (img.mem[a + 2] << 8);
      if (t >= img.lo && t < img.hi && img.starts.has(t)) out.add(t);
    }
    return [...out].sort((x, y) => x - y);
  };
  const bsT = called(bsImg), sdT = called(sdImg);

  // Only an unambiguous match counts. A routine that matches two main-mission routines at two
  // different deltas has said nothing about which one it is.
  const matched = new Map();
  for (const f of bsT) {
    const hits = [];
    for (const m of sdT) {
      const r = sameMoved(f, m);
      if (r) hits.push({ m, ...r });
    }
    if (hits.length === 1) matched.set(f, hits[0]);
  }
  const fromRoutines = [...new Set([...matched.values()].map((r) => r.delta))];

  // Two more that no whole routine can establish, because what they explain is a loop body and
  // a loop body has no RTS. They are here on the regions they account for - -$0004 covers
  // $09A7-$0D31 and +$07EC covers $0E66-$0F51, both in runs broken only where the finale's own
  // code is spliced in - and the control at the end is what says those regions are not luck.
  const DELTAS = [...new Set([...fromRoutines, -0x0004, 0x07ec])].sort((a, b) => a - b);
  const sgn = (d) => `${d < 0 ? '-' : '+'}$${Math.abs(d).toString(16).padStart(4, '0')}`;

  /** Is the instruction at `a` the main mission's at `a + delta`, moved? */
  const movedAt = (a, delta) => {
    if (!bsImg.starts.has(a) || !sdImg.starts.has(a + delta)) return false;
    const x = disasm1(bsImg.mem, a), y = disasm1(sdImg.mem, a + delta);
    if (x.bytes[0] !== y.bytes[0] || x.len !== y.len) return false;
    if (x.len === 2 && x.bytes[1] !== y.bytes[1]) return false;
    if (x.len === 3) {
      const ax = x.bytes[1] | (x.bytes[2] << 8), ay = y.bytes[1] | (y.bytes[2] << 8);
      // An operand may move by any of the deltas, not only its own region's: the parameter
      // bytes a routine patches are not always in the region the routine is in. $17A0's code
      // moves +$0812 while the two bytes it pokes move +$080E.
      if (ax !== ay && !DELTAS.includes(ay - ax)) return false;
    }
    return true;
  };

  const reached = [...bsImg.starts].sort((a, b) => a - b);
  const owner = new Map();
  for (const delta of DELTAS) {
    let run = [];
    const flush = () => {
      // Four in a row at least, so a lone LDA that happens to line up is not called ported.
      if (run.length >= 4) for (const a of run) if (!owner.has(a)) owner.set(a, delta);
      run = [];
    };
    for (const a of reached) {
      if (movedAt(a, delta)) run.push(a);
      else flush();
    }
    flush();
  }
  const un = reached.filter((a) => !owner.has(a));
  console.log(`  ${reached.length} instructions reachable from ${hx(ENTRY)}:`
    + ` ${owner.size} are the main mission's, moved; ${un.length} are not`);
  for (const delta of DELTAS) {
    const n = [...owner.values()].filter((d) => d === delta).length;
    console.log(`    ${sgn(delta)}  ${n} instructions`);
  }

  check('nearly four fifths of the finale is the main mission at a different address',
    owner.size === 1070 && reached.length === 1369,
    `${owner.size} of ${reached.length} instructions, over ${DELTAS.length} deltas, none of`
      + ' them further than $08ED - one binary with blocks spliced into the other');

  // What is left divides again. Some of it the port has already transliterated from the
  // finale's own listing - those blocks were written before any of this was known, by reading
  // the finale rather than by matching it - and the rest is the work.
  const FINALE_JS = [[0x10e5, 0x112e, 'endOfFrame'], [0x1476, 0x14fa, 'damage'],
    [0x103e, 0x10e4, 'debris'], [0x0f53, 0x0fe2, 'the two awards'], [0x092f, 0x0956, 'hitTest'],
    [0x0957, 0x09a6, 'enter'], [0x0d5f, 0x0e2b, 'aimAndFire'], [0x0e2c, 0x0e47, 'reached'],
    [0x0fe3, 0x103d, 'shotAdvance']];
  const written = new Set();
  for (const a of un) for (const [lo, hi] of FINALE_JS) if (a >= lo && a <= hi) written.add(a);
  const todo = un.filter((a) => !written.has(a));
  console.log(`  of the ${un.length} that are not, ${written.size} are blocks finale.js`
    + ` already has and ${todo.length} are not written anywhere`);

  // The spans that are left are the work, and they want to be few and contiguous. A result
  // scattered over fifty one-instruction holes would mean the deltas are slightly wrong, not
  // that the finale differs in fifty places.
  const spans = [];
  for (const a of todo) {
    const last = spans[spans.length - 1], l = disasm1(bsImg.mem, a);
    if (last && a >= last.hi && a <= last.hi + 3) { last.hi = a + l.len - 1; last.n++; }
    else spans.push({ lo: a, hi: a + l.len - 1, n: 1 });
  }
  console.log(`  what is left, in ${spans.length} spans:`);
  for (const s of spans) {
    console.log(`    ${hx(s.lo)}-${hx(s.hi)}  ${s.n}  ${disasm1(bsImg.mem, s.lo).text}`);
  }
  // Every span that was a block of its own has been written. What is left is sixteen
  // instructions scattered through blocks the port already has, and each is a place the finale
  // names a different variable, constant or destination rather than a block nobody has read:
  //
  //   $0AAC  CPX #$26        the burn limit on $0956
  //   $0B2D  LDY #$03        how much a hit takes off the missiles
  //   $0C09  the "is it alive" gate, on object 3's count, skipping to the shot at $0FAC
  //   $0C22  LDY $0931       the range-and-bearing on class 3's target, not class 1's
  //   eight LDAs             which template record each display-list patcher reads
  //
  // So the finale is accounted for. What is not yet built is the frame that drives it.
  check('and what is left is sixteen operands, not blocks',
    todo.length === 16 && spans.length === 12 && Math.max(...spans.map((x) => x.n)) === 5,
    `${todo.length} instructions in ${spans.length} spans, the largest ${hx(0x0C09)} at 5 -`
      + ' the gate that names object 3; the four spans that were the work (the entry, the aim,'
      + ' the reach and the shot) are ported');

  // Eight of the singles are the two display-list patchers' LDA: 36 of each patcher's 37
  // instructions are the main mission's, and the one that differs is which template record it
  // reads. That is a parameter, not code to write.
  const singles = spans.filter((s) => s.n === 1).map((s) => s.lo);
  const patcher = singles.filter((a) => a >= 0x119e && a <= 0x125e);
  check('the single instructions are mostly which record a display-list patcher reads',
    patcher.length === 8 && patcher.every((a) => disasm1(bsImg.mem, a).op === 'LDA'),
    'eight LDAs in $119E and $120B - the other 72 instructions of those two routines are the'
      + " main mission's, so what differs is the template and not the patching");

  // Every delta has to be established by a routine, and every such routine has to be one the
  // port already holds against the machine - otherwise "moved" names code nobody has written.
  //
  // So each one names the module that has the code **and the address that module names for
  // it**, and the check reads the module to confirm. The first version of this was a map from
  // address to module name with nothing testing the name, which is how four of these came to
  // be labelled wrongly and two of the labels pointed at a module that never mentions the
  // address at all.
  //
  // Four are not named by their own address, because they are not routines of their own:
  // `$1B01` and `$1B22` are fall-through tails inside `$1AE8`, and `$1C15`/`$1C29` are the
  // three-step wrappers that fall into `$1C1E`/`$1C32`. Each matched here because it ends in
  // an `RTS` and something jumps to it, which is not the same as being a routine.
  const PORTED = {
    0x1A1E: ['kill.js', 0x1A1E], 0x1A8B: ['kill.js', 0x1A8B], 0x1ABE: ['kill.js', 0x1ABE],
    0x1AC7: ['kill.js', 0x1AC7], 0x1AE8: ['dispatch.js', 0x1AE8],
    0x1B01: ['dispatch.js', 0x1AE8], 0x1B22: ['dispatch.js', 0x1AE8],
    0x1B2B: ['kill.js', 0x1B2B], 0x1B60: ['weapon.js', 0x1B60],
    0x1B95: ['controls.js', 0x1B95], 0x1BD5: ['controls.js', 0x1BD5],
    0x1C15: ['controls.js', 0x1C1E], 0x1C1E: ['controls.js', 0x1C1E],
    0x1C29: ['controls.js', 0x1C32], 0x1C32: ['controls.js', 0x1C32],
    0x1C3D: ['geometry.js', 0x1C3D], 0x1C89: ['damage.js', 0x1C89],
    0x1C8B: ['damage.js', 0x1C8B], 0x1D09: ['kill.js', 0x1D09],
    0x1D52: ['sound.js', 0x1D52], 0x1D9F: ['sound.js', 0x1D9F],
    0x1DA2: ['sound.js', 0x1DA2], 0x1DBA: ['sound.js', 0x1DBA],
    0x1E98: ['kill.js', 0x1E98], 0x1EC9: ['kill.js', 0x1EC9], 0x1EFA: ['kill.js', 0x1EFA],
    0x1FA9: ['damage.js', 0x1FA9],
  };
  const PORT_DIR = new URL('../port/src/game/', import.meta.url);
  const names = (file, addr) => {
    let text;
    try { text = readFileSync(new URL(file, PORT_DIR), 'utf8'); } catch { return false; }
    const u = addr.toString(16).toUpperCase().padStart(4, '0');
    return text.includes(`$${u}`) || text.includes(`0x${u}`)
      || text.includes(`0x${u.toLowerCase()}`);
  };
  const unwritten = [];
  for (const r of matched.values()) {
    const entry = PORTED[r.m];
    if (!entry) { unwritten.push(`${hx(r.m)} is not claimed by any module`); continue; }
    const [file, at] = entry;
    if (!names(file, at)) unwritten.push(`${file} does not name ${hx(at)}, for ${hx(r.m)}`);
  }
  check('and every routine that fixes a delta is code the port already holds, by name',
    unwritten.length === 0 && Object.keys(PORTED).length === matched.size,
    unwritten.slice(0, 3).join('; ')
      || `${matched.size} routines across`
        + ` ${[...new Set(Object.values(PORTED).map((e) => e[0]))].sort().join(', ')} - each`
        + ' one read out of the module that has it');

  // The control: a module that stops naming its address has to break the check above, or the
  // check is reading nothing. Ask it about an address no module mentions.
  check('control: the same test fails for an address no module names',
    !names('kill.js', 0x1B01) && !names('controls.js', 0x1C15),
    '$1B01 and $1C15 appear in no module under their own names, which is why they are'
      + ' listed against the routines they fall inside');

  // The control. Sweeping every delta and keeping whichever explains the most would be fitting
  // a free parameter, so: the longest run each delta in a wide range can explain against what
  // is left, as a distribution. The two taken on their regions alone have to stand outside it.
  const unSet = new Set(un);
  const longest = (delta) => {
    let best = 0, run = 0;
    for (const a of reached) {
      if (unSet.has(a) && movedAt(a, delta)) { run++; if (run > best) best = run; }
      else run = 0;
    }
    return best;
  };
  let over20 = 0, swept = 0;
  for (let delta = -0x1800; delta <= 0x1800; delta++) {
    if (!delta || DELTAS.includes(delta)) continue;
    swept++;
    if (longest(delta) >= 20) over20++;
  }
  check('control: hardly any other delta explains a run of any length',
    swept > 3000 && over20 <= 6,
    `of ${swept} deltas swept, ${over20} reach a 20-instruction run against what is left - so`
      + ' agreement over hundreds of instructions is a correspondence, not an alignment');
}

// ------------------------------------------------- two instructions this copy has wrong ---
// `$0F7E` and `$101C` disassemble as `ROL abs`. The main mission has the same two blocks, and
// at the matching instruction in each it has `LDX abs` on the same operand - `AE` against
// `2E`, bit 7 of one byte, with the operand and everything either side identical.
//
// That alone would only say the two binaries differ. What settles it is what the operands are:
// both are entries in the directory at `$08F2`, so the instruction after each one uses the
// byte as a table index. `ROL` cannot load an index, it can only double one - and `parity_
// finale.mjs` measures the consequence in a running mission: those two bytes, and no others
// of the 65, no longer hold what the build put there. So the port reads both as `LDX`.
console.log('\n=== two instructions this copy has wrong ===');
{
  const image = (f) => {
    const mem = [];
    for (let i = 0; i < f.len; i++) mem[f.addr + i] = f.data[i];
    return mem;
  };
  const bs = image(BS), sd = image(SD);
  // at: the finale's instruction, twin: the main mission's, operand: what both name.
  const PAIRS = [
    { at: 0x0F7E, twin: 0x0F55, operand: 0x0907, what: 'the second award block\'s third copy' },
    { at: 0x101C, twin: 0x13F4, operand: 0x0914, what: 'the shot advance\'s third copy' },
  ];
  const wrong = [];
  for (const q of PAIRS) {
    const here = [bs[q.at], bs[q.at + 1] | (bs[q.at + 2] << 8)];
    const there = [sd[q.twin], sd[q.twin + 1] | (sd[q.twin + 2] << 8)];
    if (here[0] !== 0x2E || there[0] !== 0xAE || here[1] !== q.operand
      || there[1] !== q.operand) {
      wrong.push(`${hx(q.at)} is ${hx(here[0], 2)}/${hx(here[1])} and ${hx(q.twin)} is`
        + ` ${hx(there[0], 2)}/${hx(there[1])}`);
    }
  }
  check('both are $2E where the main mission has $AE, on the same operand',
    wrong.length === 0, wrong.join('; ')
      || PAIRS.map((q) => `${hx(q.at)} vs ${hx(q.twin)} on ${hx(q.operand)}`).join(', ')
        + ' - one bit each, and $AE is LDX abs');

  // The operands are directory entries, which is what makes the difference matter: three
  // apart from their neighbours, inside the 65 the frame loop loads into X and Y.
  const inDirectory = PAIRS.every((q) => {
    const i = q.operand - 0x08F2;
    return i >= 0 && i < 65 && bs[q.operand] === sd[q.operand];
  });
  check('and both operands are directory entries, which is why it cannot be a design',
    inDirectory,
    PAIRS.map((q) => `${hx(q.operand)} holds ${bs[q.operand]}`).join(', ')
      + ' in both images - a table offset, used as an index by the instruction after it');

  // The control: the matching instruction in the *other* award block is intact in both, so
  // this is two bytes and not a difference running through the whole file.
  const first = { at: 0x0F36, twin: 0x0F0D, operand: 0x0906 };
  check('control: the first award block\'s copy is $AE in both, so it is these two and no more',
    bs[first.at] === 0xAE && sd[first.twin] === 0xAE
      && (bs[first.at + 1] | (bs[first.at + 2] << 8)) === first.operand,
    `${hx(first.at)} is ${hx(bs[first.at], 2)} on ${hx(first.operand)} - the same instruction`
      + ' one block earlier, with the bit where it belongs');
}

// ---------------------------------------------------------------- the machine ------------
console.log('\n=== it runs as a mission, not as a binary ===');
// The first pass at this side-loaded the four files and jumped to $0957. That starts the
// binary; it does not start the mission. `SD START2` pokes seventeen addresses between the
// BLOADs and `SD PART3`'s BRUNs, and two of them - object 3's count at $814B, and the wave
// counters - are what the finale's own "is the field empty" test reads. Left at zero the
// mission believes it has already been won: $112A runs on the first pass, $1FFF comes back
// 1, and 140 of 1,369 addresses ever execute.
//
// `toFinale` reads those pokes off the disk and applies them in the chain's own order. The
// control below is the same run without them.
const a2 = await openOracle();
let live = null, control = null;
try {
  const arrival = await toFinale(a2);
  check('SD START2\'s setup reads cleanly off the disk, with nothing left unresolved',
    arrival.setup.unresolved.length === 0 && arrival.setup.pokes.length === 17,
    `${arrival.setup.pokes.length} pokes and ${arrival.setup.loads.length} loads, including`
      + ' $814B = 255, which is the one that matters');

  const run = (cycles) => a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, rd = window.M.rd;
    const before = []; for (let a = 0x80FB; a < 0x82E6; a++) before.push(rd(a));
    let renders = 0, won = 0; const seen = new Set();
    cpu.stepCyclesDebug(${cycles}, () => {
      const pc = cpu.getPC();
      if (pc === 0x6000) renders++;
      if (pc === 0x112A || pc === 0x10A7) won++;
      if (pc >= 0x08EF && pc <= 0x1FF0) seen.add(pc);
    });
    const after = []; for (let a = 0x80FB; a < 0x82E6; a++) after.push(rd(a));
    let moved = 0; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) moved++;
    let lit = 0; for (let a = 0x2000; a < 0x4000; a++) if (rd(a)) lit++;
    return { renders, won, covered: seen.size, moved, lit, hits: rd(0x0933),
      finale: rd(0x1FF7), baseStar: rd(0x1FFF), obj3: rd(0x814B) };
  })())`).then(JSON.parse);

  await a2.ev(`(() => { const cpu = window.M.cpu; const st = cpu.getState();
    st.pc = ${FINALE_ENTRY}; st.sp = 0xF8; cpu.setState(st); return 1; })()`);
  live = await run(20000000);
  console.log(`  ${live.covered} of 1,369 addresses, ${live.renders} renders,`
    + ` ${live.moved} display-list bytes moved, page 1 lit ${live.lit}`);
  console.log(`  $0933 hits ${live.hits}, $1FF7 ${live.finale}, $1FFF ${live.baseStar}`);

  // The control: the same files, the same entry, without SD START2's pokes.
  const files = [...sdStart2Setup(d).loads,
    { file: 'PART1.OBJ0', at: null }, { file: 'BASE STAR.OBJ0', at: null }]
    .map(({ file, at }) => {
      const f = read(file);
      return { addr: at ?? f.addr, raw: [...f.raw] };
    });
  await a2.ev(`(() => { const wr = window.M.wr;
    for (const f of ${JSON.stringify(files)}) {
      for (let i = 4; i < f.raw.length; i++) wr(f.addr - 4 + i, f.raw[i]);
    }
    const cpu = window.M.cpu; const st = cpu.getState();
    st.pc = ${FINALE_ENTRY}; st.sp = 0xF8; cpu.setState(st); return 1; })()`);
  control = await run(2000000);
} finally {
  await a2.close();
}
{
  check('the mission runs: it renders repeatedly and keeps moving its display list',
    live.renders > 20 && live.moved > 0 && live.lit > 0,
    `${live.renders} renders over 20M cycles - the main mission's idle flight looks the same`);

  check('and it does NOT think it has already been won',
    live.baseStar === 0 && live.won === 0,
    `$1FFF is ${live.baseStar} and neither $10A7 nor $112A was reached`);

  check('object 3\'s count survives into the mission, which is what SD START2 is for',
    live.obj3 === 255, `$814B = ${live.obj3}`);

  check('control: without those pokes it wins on the spot, as the first pass did',
    control.won > 0 && control.baseStar > 0 && control.covered < live.covered,
    `$1FFF came back ${control.baseStar} after ${control.covered} addresses, against`
      + ` ${live.baseStar} after ${live.covered} - so the pokes are the difference`);

  check('and the mission reaches four times the code the side-load did',
    live.covered > 500,
    `${live.covered} of 1,369 addresses against the 140 a bare side-load reaches;`
      + ' the rest needs a player, exactly as the main mission does');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
