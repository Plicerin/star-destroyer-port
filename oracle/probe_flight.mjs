// How the ship moves: the heading tables, the variable directory, the world's bounds.
//
// MATH is the arithmetic; this is what the frame loop asks it for. The block runs between
// $09D1 and $0A60 and comes to three things - build two step operands from the heading,
// divide each by a throttle and add it to the position, then wrap at the edge of the world.
//
// The constants it uses live in three different places, which is why this probe exists: the
// heading tables are a file on the disk, the variable directory is data inside `.OBJ0`, and
// the bounds and the throttle are entries in a table nothing on the disk writes. Each is
// established here and then held by parity_flight.mjs.
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { openOracle } from './a2.mjs';
import { toFlight, arm } from './exercise.mjs';
import { hx } from './disasm6502.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const s8 = (v) => (v > 127 ? v - 256 : v);
const s24 = (v) => (v > 0x7FFFFF ? v - 0x1000000 : v);

const d = openDisk(DISK);
const file = (n) => d.read(d.files.find((x) => x.name === n));

// --- HEADING DATA ------------------------------------------------------------------------------
console.log('\n=== HEADING DATA ===');
let SIN = [], COS = [];
{
  const h = file('HEADING DATA');
  const at = (a) => h.data[a - h.addr];
  check('HEADING DATA loads at $89CB and is long enough for two 256-byte tables',
    h.addr === 0x89CB && h.len >= 0x104 + 256,
    `${hx(h.addr, 4)}, ${h.len} bytes, ending ${hx(h.addr + h.len - 1, 4)}`);
  for (let i = 0; i < 256; i++) {
    SIN.push(s8(at(0x89CB + i)));
    COS.push(s8(at(0x8ACF + i)));
  }
  console.log('  $1AE8 reads $89CB for the X component and $8ACF for the Z, both indexed by');
  console.log('  the heading byte - 260 apart, so the second table starts 4 bytes after the first');

  /** Mean and worst absolute error of a table against a model. */
  const err = (t, f) => {
    let sum = 0, worst = 0;
    t.forEach((v, i) => {
      const e = Math.abs(v - f(i));
      sum += e;
      worst = Math.max(worst, e);
    });
    return { mean: sum / 256, worst };
  };
  const ang = (i) => 2 * Math.PI * i / 256;

  // The shape is a sinusoid of amplitude 100 - the entries run -100 to 99 and peak at the
  // quarter turn - but NO simple closed form reproduces the bytes. A sweep of amplitudes from
  // 96 to 104 in halves, each with round, trunc and floor and with and without a half-step
  // phase, leaves trunc(100*sin) the closest at a mean error of 0.17, and even that is wrong
  // by up to 3. SIN[64] is 99 where every amplitude-100 model gives 100, so the generator was
  // something else - Applesoft's own SIN, most likely, with its limited precision.
  //
  // That is the whole reason the port embeds these 512 bytes instead of computing them, and
  // it is the same reason gen_tables.mjs embeds the engine's plotting tables. So the useful
  // checks are the shape, and the fact that nothing closed-form will do.
  const best = { sin: err(SIN, (i) => Math.trunc(100 * Math.sin(ang(i)))),
    cos: err(COS, (i) => Math.trunc(100 * Math.cos(ang(i)))) };
  check('$89CB and $8ACF are a sine and cosine pair of amplitude 100, to within a count or two',
    best.sin.mean < 0.3 && best.cos.mean < 0.3 && best.sin.worst <= 3 && best.cos.worst <= 3,
    `closest model trunc(100*sin): mean ${best.sin.mean.toFixed(3)}/${best.cos.mean.toFixed(3)},`
      + ` worst ${best.sin.worst}/${best.cos.worst}; ranges ${Math.min(...SIN)}..${Math.max(...SIN)}`
      + ` and ${Math.min(...COS)}..${Math.max(...COS)}`);

  let exact = 0, searched = 0;
  for (let amp = 96; amp <= 104; amp += 0.5) {
    for (const r of [Math.round, Math.trunc, Math.floor]) {
      for (const half of [0, 0.5]) {
        searched++;
        if (err(SIN, (i) => r(amp * Math.sin(ang(i + half)))).worst === 0
          && err(COS, (i) => r(amp * Math.cos(ang(i + half)))).worst === 0) exact++;
      }
    }
  }
  check('but no closed form reproduces them, which is why the port embeds the bytes',
    exact === 0 && searched > 100,
    `${searched} models swept (amplitude 96-104 by halves, round/trunc/floor, two phases),`
      + ` ${exact} exact`);
  check('concretely: the quarter turn reads 99, where any amplitude-100 model gives 100',
    SIN[64] === 99 && COS[0] === 99, `SIN[64] = ${SIN[64]}, COS[0] = ${COS[0]}`);

  // Control: the two tables are different functions, a quarter turn apart.
  check('control: they are not the same table - matching each against the other fails badly',
    err(SIN, (i) => Math.trunc(100 * Math.cos(ang(i)))).mean > 10
      && err(COS, (i) => Math.trunc(100 * Math.sin(ang(i)))).mean > 10,
    `sin against cos: ${err(SIN, (i) => Math.trunc(100 * Math.cos(ang(i)))).mean.toFixed(1)},`
      + ` cos against sin: ${err(COS, (i) => Math.trunc(100 * Math.sin(ang(i)))).mean.toFixed(1)}`);

  // $1AF4's sign test. Worth recording that it cannot be reached by real data.
  const extremes = [...SIN, ...COS];
  const boundary = extremes.filter((v) => v === 127 || v === -128).length;
  check('the sign test at $1AF4 separates $7F from $80, but no table entry reaches either',
    boundary === 0 && Math.max(...extremes) === 99 && Math.min(...extremes) === -100,
    `components run -100 to 99, so the $7F/$80 boundary is unreachable in play`);
}

// --- the variable directory --------------------------------------------------------------------
console.log('\n=== the variable directory at $08F2 ===');
let VARS = [];
{
  const obj = file('STAR DESTROYER.OBJ0');
  const at = (a) => obj.data[a - obj.addr];
  check('.OBJ0 starts with a jump to the setup at $0957',
    at(0x08EF) === 0x4C && at(0x08F0) === 0x57 && at(0x08F1) === 0x09,
    `${hx(at(0x08EF))} ${hx(at(0x08F0))} ${hx(at(0x08F1))}`);
  for (let a = 0x08F2; a < 0x0940; a++) {
    const v = at(a);
    if (v === 0 && VARS.length) break;
    VARS.push(v);
  }
  const gaps = [];
  for (let i = 1; i < VARS.length; i++) if (VARS[i] - VARS[i - 1] !== 3) gaps.push(i);
  console.log(`  ${VARS.length} byte offsets into MATH's table, from ${VARS[0]} to`
    + ` ${VARS[VARS.length - 1]}`);
  console.log('  the stride breaks at ' + gaps.map((i) =>
    `${VARS[i - 1]}->${VARS[i]}`).join(', '));
  check('the directory is a run of table offsets, mostly three apart',
    VARS.length > 50 && gaps.length <= 4,
    `${VARS.length} entries, ${gaps.length} breaks in the stride`);
  check('and not every offset is a multiple of three, which is why the table is byte-indexed',
    VARS.some((v) => v % 3 !== 0),
    `off-grid: ${VARS.filter((v) => v % 3 !== 0).join(', ')}`);

  // Nothing writes them: the listing only ever loads an index register from these addresses.
  const asm = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8');
  const writes = [...asm.matchAll(/ST[AXY] \$(09[01][0-9A-F]|08F[2-9A-F])/g)].map((m) => m[1]);
  const movement = ['0901', '0903', '0915', '0916', '0917', '08F2', '08F3', '08F4', '08F5'];
  const written = movement.filter((a) => writes.includes(a));
  check('the movement block never writes its own indices, so they are constants of the build',
    written.length === 0, written.length ? `written: ${written.join(', ')}` : movement.join(' '));
}

// --- the table nothing on the disk writes ------------------------------------------------------
console.log('\n=== MATH\'s table at $9800-$98F2 ===');
{
  const covering = d.files.filter((f) => {
    try {
      const x = d.read(f);
      return x.addr !== undefined && x.addr <= 0x98F2 && x.addr + x.len > 0x9800;
    } catch (e) { return false; }
  });
  check('no file on the disk loads into the table - MATH itself starts just above it, at $98F3',
    covering.length === 0, covering.map((f) => f.name).join(', ')
      || `${d.files.length} files checked`);

  let poked = [];
  for (const f of d.files.filter((x) => String(x.type).startsWith('APPLESOFT'))) {
    let lines;
    try { lines = listProgram(asMemoryOf(d.read(f)), 0x801); } catch (e) { continue; }
    for (const l of lines) {
      for (const m of l.text.matchAll(/POKE\s*([0-9]+)/gi)) {
        const n = Number(m[1]);
        if (n >= 0x9800 && n <= 0x98F2) poked.push(`${f.name}:${l.num}`);
      }
    }
  }
  check('and no BASIC line POKEs into it either, so the binary builds it itself',
    poked.length === 0, poked.slice(0, 3).join(', ') || 'every Applesoft program checked');

  const asm = fs.readFileSync('listing/STAR_DESTROYER.asm', 'utf8');
  const stores = [...asm.matchAll(/ST[AXY] \$980[012],Y/g)].length;
  check('the binary writes it through indexed stores, which is the only writer found',
    stores >= 15, `${stores} store sites in .OBJ0`);
}

// --- the bounds and the throttle, in the running machine ---------------------------------------
console.log('\n=== the world, in flight ===');
const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight', flight.difficulty === 1);
{
  const tab = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const obj = file('STAR DESTROYER.OBJ0');
  const idx = (a) => obj.data[a - obj.addr];
  const ent = (i) => s24(tab[i] | (tab[i + 1] << 8) | (tab[i + 2] << 16));
  const maxX = ent(idx(0x08F2)), minX = ent(idx(0x08F3));
  const maxZ = ent(idx(0x08F4)), minZ = ent(idx(0x08F5));
  const speed = ent(idx(0x0917));
  console.log(`  the position is 24-bit and the coordinate is its top two bytes, so a bound of`);
  console.log(`  ${maxX} is a coordinate of ${maxX / 256}`);
  check('X wraps symmetrically at plus and minus 3072',
    maxX === 786432 && minX === -786432, `${maxX} and ${minX}, i.e. ${maxX / 256} and ${minX / 256}`);
  check('Z does not - the bounds are asymmetric, and the port keeps them that way',
    maxZ === 409600 && minZ === -344064,
    `${maxZ} and ${minZ}, i.e. ${maxZ / 256} and ${minZ / 256}`);

  const maxStep = Math.trunc(100 * 256 * 256 / speed);
  check('the throttle is a divisor, so a larger value means a slower ship', speed === 1280,
    `speed entry = ${speed}; the largest step is 100*256*256/${speed} = ${maxStep},`
      + ` which is ${(maxStep / 256).toFixed(1)} coordinate units a pass`);
  check('and one pass of travel is smaller than the world, or the ship could skip a bound',
    maxStep < Math.abs(maxX - minX) / 2, `${maxStep} against a world ${maxX - minX} wide`);
}

// --- how fast the loop actually runs -----------------------------------------------------------
// Not a movement fact, but every harness that traces the loop has to size itself by this, and
// the first version of parity_flight.mjs sized itself by video frames and traced one pass.
console.log('\n=== the loop\'s period ===');
{
  const out = JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu;
    window.M.a2.getIO().paddle(0, 127);
    window.M.a2.getIO().paddle(1, 0);
    let hits = 0, instrs = 0, last = 0;
    const gaps = [];
    cpu.stepCyclesDebug(17030 * 4000, () => {
      instrs++;
      if (cpu.getPC() === 0x09D1) {
        hits++;
        gaps.push(instrs - last);
        last = instrs;
        if (hits >= 8) return true;
      }
    });
    return { hits, gaps: gaps.slice(1) };
  })())`));
  const mean = Math.round(out.gaps.reduce((a, b) => a + b, 0) / out.gaps.length);
  console.log(`  ${out.gaps.length} intervals between passes: ${out.gaps.join(' ')}`);
  check('one pass of the loop is far more than a video frame - the game runs at roughly 3Hz',
    out.hits >= 8 && mean > 50000,
    `${mean} instructions a pass, against 17030 cycles in a video frame`);
}

await a2.close();
fs.mkdirSync('captured/flight', { recursive: true });
fs.writeFileSync('captured/flight/movement.json', JSON.stringify({
  headingTables: { x: '$89CB, 100*sin', z: '$8ACF, 100*cos', steps: 256, amplitude: 100 },
  directory: { at: '$08F2', entries: VARS.length, offsets: VARS },
  results,
}, null, 1) + String.fromCharCode(10));

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `flight: all ${results.length} checks passed`
  : `flight: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);

/** listProgram wants a memory image; a loaded file is an address and bytes. */
function asMemoryOf(x) {
  const mem = new Uint8Array(0x10000);
  for (let i = 0; i < x.len; i++) mem[x.addr + i] = x.data[i];
  return mem;
}
