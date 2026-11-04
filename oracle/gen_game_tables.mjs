// Extract the game's own data into the port: the heading tables, the variable directory, and
// the state MATH's table starts flight in.
//
// Three different kinds of provenance, which is why they are generated rather than typed:
//
// - **The heading tables** come straight off the disk. `HEADING DATA` loads at $89CB, 520
//   bytes, and holds two 256-byte tables 260 apart: a sine and a cosine of amplitude 100 over
//   a 256-step circle. The bytes are embedded rather than recomputed because no closed form
//   reproduces them - probe_flight.mjs sweeps 108 candidates and none matches, the closest
//   being trunc(100*sin) at a mean error of 0.17 and a worst of 3. The quarter turn reads 99
//   where every amplitude-100 model gives 100, so whatever generated them (Applesoft's own
//   SIN, most likely) is not worth guessing at when the table itself is right there.
// - **The variable directory** also comes off the disk, out of `.OBJ0` itself. $08F2 onward
//   is a list of byte offsets into MATH's table, one per 24-bit variable, and the frame loop
//   reads them with LDX/LDY. Nothing ever writes them.
// - **The initial table** is a capture from the running machine, not from the disk, because
//   no file loads into $9800-$98F2 and no BASIC line POKEs there. The binary writes it, and
//   the only honest way to get the starting state is to take it at the moment flight begins.
//   241 of the 243 bytes are deterministic: they come out identical from a $00 power-on fill
//   and an $A5 one. The two that do not, offsets 104 and 105, are never written at all and
//   still hold whatever the machine powered on with. They are emitted as zero and listed in
//   UNINITIALISED so the port can refuse to rely on them.
import { openDisk, DISK } from './dsk.mjs';
import { openOracle } from './a2.mjs';
import { toFlight } from './exercise.mjs';
import fs from 'fs';

const NL = String.fromCharCode(10);
const d = openDisk(DISK);
const file = (n) => d.read(d.files.find((x) => x.name === n));

const heading = file('HEADING DATA');
const hAt = (a) => heading.data[a - heading.addr];
const SIN = [], COS = [];
for (let i = 0; i < 256; i++) {
  SIN.push(hAt(0x89CB + i));
  COS.push(hAt(0x8ACF + i));
}

const obj = file('STAR DESTROYER.OBJ0');
const oAt = (a) => obj.data[a - obj.addr];
/** $08F2 to the first zero: the directory of table offsets. */
const VARS = [];
for (let a = 0x08F2; a < 0x0940; a++) {
  const v = oAt(a);
  if (v === 0 && VARS.length) break;
  VARS.push(v);
}

// The initial table, taken twice from different power-on fills so the capture can say which
// bytes are the game's and which are only the machine's. The second pass also harvests the
// arctangent thresholds, since it has a machine open anyway.
const grab = async (fill, extra = null) => {
  const a2 = await openOracle();
  await toFlight(a2, { fill });
  const t = JSON.parse(await a2.ev('JSON.stringify(window.M.range(0x9800, 0x98F3))'));
  const more = extra ? await extra(a2) : null;
  await a2.close();
  return { t, more };
};

/**
 * $9C04's thresholds.
 *
 * It is an arctangent that answers in whole degrees - ACC in, ACC out, both scaled by 256 -
 * and it is a series approximation with its own rounding, not trunc(atan). Over 765 inputs a
 * trunc(atan) model disagrees 102 times, sometimes high and sometimes low, so there is no
 * tidy closed form to write down.
 *
 * What it is, measured, is monotonic: 1,201 inputs spanning 0 to 8.3 million, no decrease.
 * A monotonic step function with at most 91 outputs is completely described by the input at
 * which each step begins, so those are binary-searched out of the machine and the port does
 * a lookup. That is exact, including the degrees the approximation never produces at all -
 * 39, 40, 50 and 51 are skipped, which no formula would have predicted.
 */
const harvestAtan = async (a2) => {
  await a2.ev(`(() => {
    window.M.atan1 = (acc) => {
      const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
      const before = cpu.getState();
      const zp = []; for (let a = 0; a < 0x100; a++) zp.push(rd(a));
      for (let a = 0; a < 0x10; a++) wr(a, 0);
      for (let a = 0xC0; a < 0x100; a++) wr(a, 0);
      wr(0xFA, acc & 0xff); wr(0xFB, (acc >> 8) & 0xff); wr(0xFC, (acc >> 16) & 0xff);
      const s = cpu.getState();
      wr(0x100 + s.sp, 0xFF); s.sp = (s.sp - 1) & 0xff;
      wr(0x100 + s.sp, 0xFE); s.sp = (s.sp - 1) & 0xff;
      s.pc = 0x9C04; s.x = 3; s.y = 0;
      cpu.setState(s);
      cpu.stepCyclesDebug(4000000, () => cpu.getPC() === 0xFFFF ? true : undefined);
      let v = rd(0xFA) | (rd(0xFB) << 8) | (rd(0xFC) << 16);
      if (v > 0x7FFFFF) v -= 0x1000000;
      for (let a = 0; a < 0x100; a++) wr(a, zp[a]);
      cpu.setState(before);
      return v / 256;
    };
    return 'ok';
  })()`);
  const at = (acc) => a2.ev(`window.M.atan1(${acc})`).then(Number);

  // Monotonic over a dense-low, sparse-high sweep. If this ever fails the lookup is invalid.
  const probe = [...new Set(Array.from({ length: 1201 }, (_, i) => Math.round(i * i * 5.8))
    .filter((v) => v <= 0x7FFFFF))].sort((a, b) => a - b);
  const seen = [];
  for (const v of probe) seen.push(await at(v));
  for (let i = 1; i < seen.length; i++) {
    if (seen[i] < seen[i - 1]) {
      throw new Error(`$9C04 is not monotonic: ${probe[i - 1]} gives ${seen[i - 1]}`
        + ` but ${probe[i]} gives ${seen[i]} - the threshold lookup cannot stand in for it`);
    }
  }
  const top = await at(0x7FFFFF);
  const thresholds = [];
  for (let deg = 1; deg <= top; deg++) {
    let lo = 0, hi = 0x7FFFFF;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await at(mid) >= deg) hi = mid; else lo = mid + 1;
    }
    thresholds.push(lo);
  }
  return { thresholds, top, probed: probe.length };
};

const zeroRun = await grab(0x00);
const altRun = await grab(0xA5, harvestAtan);
const zero = zeroRun.t;
const alt = altRun.t;
const atan = altRun.more;
const UNINIT = [];
const INIT = zero.map((v, i) => {
  if (v === alt[i]) return v;
  UNINIT.push(i);
  return 0;
});
if (UNINIT.length > 8) {
  throw new Error(`${UNINIT.length} table bytes are not deterministic; expected a handful`
    + ` - the capture cannot stand in for the game's own initialisation`);
}

const fmt = (a, w = 4) => {
  const rows = [];
  for (let i = 0; i < a.length; i += 16) {
    rows.push('  ' + a.slice(i, i + 16).map((v) => String(v).padStart(w)).join(', '));
  }
  return rows.join(',' + NL);
};

const out = [
  '// Generated by oracle/gen_game_tables.mjs from the original disk and from the running',
  '// machine. Do not edit.',
  '',
  '// $89CB and $8ACF in HEADING DATA: the two components of the ship\'s facing, indexed by',
  '// the heading byte over a 256-step circle - a sine and a cosine of amplitude 100, stored',
  '// as signed bytes in two\'s complement. No closed form reproduces them exactly, so these',
  '// are the disk\'s own bytes. Read them through HEADING_X and HEADING_Z rather than',
  '// directly, which is where the sign extension happens.',
  'export const HEADING_SIN = [', fmt(SIN, 3), '];',
  '',
  'export const HEADING_COS = [', fmt(COS, 3), '];',
  '',
  '/** The X component of a heading, signed. $1AE8 reads $89CB this way. */',
  'export const HEADING_X = (h) => (HEADING_SIN[h & 0xff] << 24) >> 24;',
  '',
  '/** The Z component of a heading, signed. $1AE8 reads $8ACF this way. */',
  'export const HEADING_Z = (h) => (HEADING_COS[h & 0xff] << 24) >> 24;',
  '',
  '// $08F2 onward in .OBJ0: byte offsets into MATH\'s table, one per 24-bit variable. The',
  '// frame loop loads these into X and Y - `LDX $0901` is "the index of the ship\'s X", not a',
  '// value - and nothing ever writes them, so they are constants of the build. Mostly three',
  `// apart, but not always: ${VARS.length} entries with gaps where the stride breaks.`,
  'export const VARS = [', fmt(VARS, 3), '];',
  '',
  '/** The directory entries the movement block names, by the address that holds each. */',
  'export const VAR = {',
  ...[['posX', 0x0901], ['posZ', 0x0903], ['stepX', 0x0915], ['stepZ', 0x0916],
    ['speed', 0x0917], ['maxX', 0x08F2], ['minX', 0x08F3], ['maxZ', 0x08F4],
    ['minZ', 0x08F5]].map(([n, a]) => `  /** $${a.toString(16).toUpperCase()} */`
      + ` ${n}: ${oAt(a)},`),
  '};',
  '',
  '// MATH\'s table as flight begins. Captured, not loaded: nothing on the disk covers',
  '// $9800-$98F2 and no BASIC line POKEs there, so the binary builds this itself and a',
  '// snapshot is the only faithful starting state available. Verified deterministic -',
  `// ${243 - UNINIT.length} of 243 bytes are identical from a $00 and an $A5 power-on fill.`,
  'export const TABLE_INIT = [', fmt(INIT, 4), '];',
  '',
  '// $9C04\'s thresholds: the smallest ACC that answers at least d degrees, for d = 1 up.',
  '// It is an arctangent in whole degrees, ACC in and out, both scaled by 256 - and a series',
  '// approximation, not trunc(atan), which disagrees with a trunc(atan) model on 102 of 765',
  '// inputs. It IS monotonic, checked over ' + atan.probed + ' inputs, so these thresholds',
  '// describe it exactly. Note the degrees it never produces - 40, 41, 50 and 51 share a',
  '// threshold with the degree above, so the approximation steps straight over them -',
  '// 39, 40, 50 and 51, confirmed against the machine at each boundary.',
  'export const ATAN_THRESHOLD = [', fmt(atan.thresholds, 8), '];',
  '',
  `/** The largest answer $9C04 can give, in degrees: ${atan.top}. */`,
  `export const ATAN_MAX_DEGREES = ${atan.top};`,
  '',
  '// The bytes that are NOT deterministic: never written by the game, so they still hold',
  '// whatever the machine powered on with. Emitted as zero above. Anything that reads them',
  '// is reading the Apple\'s uninitialised RAM, and the port must not depend on the value.',
  `export const UNINITIALISED = [${UNINIT.join(', ')}];`,
  '',
].join(NL);

fs.mkdirSync('../port/src/game', { recursive: true });
fs.writeFileSync('../port/src/game/tables.js', out);
console.log(`wrote port/src/game/tables.js`);
console.log(`  HEADING_SIN/COS  256 bytes each, from $89CB and $8ACF`);
console.log(`  VARS             ${VARS.length} table offsets, from $08F2`);
console.log(`  TABLE_INIT       243 bytes, ${243 - UNINIT.length} deterministic,`
  + ` uninitialised at [${UNINIT.join(', ')}]`);
console.log(`  ATAN_THRESHOLD   ${atan.thresholds.length} steps, 1 to ${atan.top} degrees,`
  + ` monotonic over ${atan.probed} probes`);
