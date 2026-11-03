// The fourteen opcodes this disk never executes.
//
// A2-3D2 has thirty. `SV DATA` uses sixteen, so for the rest the renderer pass could give
// a length - the `LDA #n` in the handler - and nothing else. Reading a handler tells you
// what it stores where. It does not tell you what the instruction is for, and a reading
// that cannot be wrong is not worth much.
//
// So this runs them. exercise.mjs writes a display list of our own over `SV DATA`, calls
// the engine, and reads back the screen, the engine's own code, and any buffer the
// instruction was pointed at. Every claim below is something the machine did.
//
// Two things this had to learn the hard way, both recorded because they would bite anyone
// doing the same:
//
// The engine keeps state in its own code. Opcode 20's vectors, opcode 12's plot mode and
// opcode 29's capture mode all survive a call, so an experiment inherits whatever the last
// one left. The first version of this measured opcode 6 drawing 41 pixels where it draws
// 21, because an earlier line had re-vectored the plotter and never put it back. Every
// list here opens by setting all three.
//
// And opcode 12's patch does not survive drawing a line. Its five target bytes read $20
// afterwards, not the $11 or $51 it wrote, because the line routine rewrites them as it
// goes. Watching the bytes right after the opcode shows the patch; watching after a line
// shows the line's. Which is why the check below is on behaviour, not on the bytes alone.
import { openOracle } from './a2.mjs';
import { OPS, OPCODES, hx } from './renderer.mjs';
import { toFlight, arm, runList, op, LIST } from './exercise.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const w16 = (v) => [v & 0xff, (v >> 8) & 0xff];

const a2 = await openOracle();
const flight = await toFlight(a2);
await arm(a2);
check('the oracle reaches flight, where the engine is resident', flight.difficulty === 1);

// Opcodes 20, 12 and 29 are reset first, because the engine remembers them. So is
// opcode 15, whose six bytes go into the engine's own code at $6140-$6145 and are never
// reset by anything: the length sweep below runs every opcode with zero operands, and
// opcode 15 with zeros writes zeros over those six constants and wrecks the projection
// for every experiment after it. These are SV DATA's own values, from $8100.
const CONSTANTS = [15, 0x80, 0x3E, 0xFF, 0x7F, 0x45, 0x25];
// COLOUR belongs here too. FRAME zeroes the engine's state, and the line routines do not
// survive being asked to draw in a colour that was never set - they run away rather than
// drawing nothing, which cost an afternoon. SV DATA sets a colour before its first line
// as well.
const HEAD = [20, 0, 12, 0, 29, 0, ...CONSTANTS, ...op.switches(),
  ...op.viewport(140, 126, 0, 34), ...op.clear(0), ...op.drawTo(0),
  ...op.viewer(0, 0, 0, 0, 0, 0), ...op.colour(7)];
const run = (body, opts = {}) => runList(a2, [...HEAD, ...body], { page: 1, budget: 4000000, ...opts });
const lit = (r) => r.lit.length;
const span = (r) => (r.lit.length
  ? `rows ${Math.min(...r.lit.map((p) => p.row))}-${Math.max(...r.lit.map((p) => p.row))}, `
    + `bits ${Math.min(...r.lit.map((p) => p.bit))}-${Math.max(...r.lit.map((p) => p.bit))}`
  : 'nothing lit');

// --- every length, measured ---------------------------------------------------------------
// The interpreter's fetch at $611E says where it read an opcode from; the distance to the
// next fetch is that instruction's length. Opcodes 11, 13 and 28 are left out because they
// redirect the list pointer or a buffer pointer rather than stepping over operands - they
// are exercised on their own below.
console.log('\n=== every opcode\'s length, measured in the machine ===');
const REDIRECTS = [11, 13, 28];
// Two things make an operand dangerous rather than neutral. Zeros look safe and are not:
// a line from a point to itself, or a 3-D point at the viewer's own position, is a
// degenerate case the clipper does not come back from. And the padding after the
// instruction is itself executed - zeros decode as opcode 0, a point at the origin, which
// is that same degenerate case, so a sweep padded with zeros hangs on the opcode AFTER
// the one being measured. The padding here is opcode 17, which is the engine's own
// one-byte no-op.
//
// The operand count comes from the table being tested, which is not circular: if an
// opcode's real length differed, the next fetch would land on a pad byte and the measured
// distance would still be the true one - and would then disagree with the table, which is
// the check.
const OPERANDS = {
  0: [10, 0, 10, 0, 100, 0],
  1: [10, 0, 10, 0, 100, 0, 2, 0xF6, 0xFF, 10, 0, 100, 0],
  2: [0xF6, 0xFF, 10, 0, 100, 0],
  3: [0xF6, 0xFF, 10, 0, 100, 0],
  6: [0xF6, 0, 10, 0],
};
const NOP = 17;
const measured = {}, didNotReturn = [];
for (let o = 0; o < OPCODES; o++) {
  if (REDIRECTS.includes(o)) continue;
  const want = OPS[o].len - 1;
  const operands = [...(OPERANDS[o] ?? []), ...new Array(want).fill(0)].slice(0, want);
  // Opcodes 2 and 3 continue from a point the pen is already at, so give them one.
  const prelude = (o === 2 || o === 3) ? op.line3d(0, 0, 100, 10, 10, 100) : [];
  const r = await run([...prelude, NOP, o, ...operands, ...new Array(8).fill(NOP), 121]);
  const start = LIST + HEAD.length + prelude.length + 1;
  const i = r.walk.indexOf(start);
  const next = r.walk[i + 1];
  measured[o] = (i >= 0 && next > start) ? next - start : null;
  if (!r.returned) didNotReturn.push(o);
}
const rows = Object.entries(measured).map(([o, len]) =>
  `op ${String(o).padStart(2)} ${String(len).padStart(2)}`);
for (let i = 0; i < rows.length; i += 7) console.log('  ' + rows.slice(i, i + 7).join('   '));
const disagree = Object.entries(measured)
  .filter(([o, len]) => len !== OPS[o].len)
  .map(([o, len]) => `op ${o}: measured ${len}, table says ${OPS[o].len}`);
check('every measured length is the one the handler advances by',
  disagree.length === 0, disagree.join('; ') || `${Object.keys(measured).length} opcodes`);
check('and every one of them handed control back',
  didNotReturn.length === 0, didNotReturn.length ? 'ran away: ' + didNotReturn.join(', ') : '');
const neverRun = [0, 3, 12, 16, 20, 21, 22, 23, 24, 25, 26, 27, 29];
check('including all thirteen the disk never runs, which were read off the code only',
  neverRun.every((o) => measured[o] === OPS[o].len),
  neverRun.map((o) => `${o}=${measured[o]}`).join(' '));

// --- the 3-D drawing opcodes ---------------------------------------------------------------
console.log('\n=== opcodes 0 and 3: the two the shape format uses and the scene does not ===');
const p0 = await run([...op.colour(7), ...op.point3d(0, 0, 100)]);
const p1 = await run([...op.colour(7), ...op.point3d(20, 0, 100)]);
console.log(`  POINT (0,0,100): ${span(p0)}`);
console.log(`  POINT (20,0,100): ${span(p1)}`);
check('opcode 0 plots one point, and +x moves it right',
  lit(p0) === 1 && lit(p1) === 1 && p1.lit[0].bit > p0.lit[0].bit
    && p1.lit[0].row === p0.lit[0].row,
  `bit ${p0.lit[0]?.bit} -> ${p1.lit[0]?.bit} on row ${p0.lit[0]?.row}`);

const l1 = await run([...op.colour(7), ...op.line3d(-20, 0, 100, 20, 0, 100)]);
check('opcode 1 draws a line between its two points',
  lit(l1) > 20 && new Set(l1.lit.map((p) => p.row)).size === 1, span(l1));

// Opcode 3 draws back to the point the pen is already at and leaves it there, so two of
// them after one line make a fan from a single hub - which is what the explosions are.
const hub = [...op.colour(7), ...op.line3d(0, -30, 100, 0, 30, 100)];
const fan = await run([...hub, 3, ...w16(-30), ...w16(-30), ...w16(100),
  3, ...w16(30), ...w16(-30), ...w16(100)]);
const justHub = await run(hub);
check('opcode 3 draws back to the previous point without moving it, so spokes share a hub',
  lit(fan) > lit(justHub) * 2, `${lit(justHub)} lit for the line alone, ${lit(fan)} with two spokes`);

// --- control flow ---------------------------------------------------------------------------
console.log('\n=== opcodes 11 and 26: the list has control flow ===');
{
  const skipped = [...op.colour(7), ...op.point2d(-60, 0)];
  const target = LIST + HEAD.length + 3 + skipped.length;
  const r = await run([11, ...w16(target), ...skipped, ...op.colour(7), ...op.point2d(60, 0), ...op.end()]);
  check('opcode 11 is a jump: the instruction it jumps over does not run',
    lit(r) === 1 && r.lit[0].bit > 200, `${lit(r)} lit at bit ${r.lit[0]?.bit} (the far point, not the near one)`);
}
{
  const body = [...op.colour(7), ...op.point2d(-60, 0)];
  const on = await run([26, body.length, 1, ...body, ...op.end()]);
  const off = await run([26, body.length, 0, ...body, ...op.end()]);
  check('opcode 26 is a conditional skip: operand 2 zero skips operand 1 bytes',
    lit(on) === 1 && lit(off) === 0, `flag 1 -> ${lit(on)} lit, flag 0 -> ${lit(off)} lit`);
}

// --- the plotting modes -----------------------------------------------------------------------
console.log('\n=== opcodes 12, 16 and 20: how the primitives are configured ===');
{
  const SITES = [0x7734, 0x7739, 0x7740, 0x77F0, 0x7823];
  const watch = SITES.map((a) => [a, 1]);
  const ora = await run([12, 0, ...op.end()], { watch });
  const eor = await run([12, 1, ...op.end()], { watch });
  const flat = (r) => r.watched.map((w) => w[0]);
  console.log(`  PLOTMODE 0 writes ${flat(ora).map((v) => hx(v)).join(' ')} - ORA (zp),Y`);
  console.log(`  PLOTMODE 1 writes ${flat(eor).map((v) => hx(v)).join(' ')} - EOR (zp),Y`);
  check('opcode 12 rewrites five instructions from ORA to EOR',
    flat(ora).every((v) => v === 0x11) && flat(eor).every((v) => v === 0x51));
  const pt = [...op.colour(7), ...op.point2d(10, 10)];
  const twiceOra = await run([...pt, ...pt, ...op.end()]);
  const twiceEor = await run([12, 1, ...pt, ...pt, ...op.end()]);
  check('and in EOR a point drawn twice erases itself',
    lit(twiceOra) === 1 && lit(twiceEor) === 0,
    `ORA twice -> ${lit(twiceOra)} lit, EOR twice -> ${lit(twiceEor)} lit`);
  // The line routine rewrites the same five bytes as it draws, so it is not affected and
  // it clobbers the mode for whatever comes after.
  const ln = [...op.colour(7), ...op.line2d(-30, -20, 30, 20)];
  const lineTwice = await run([12, 1, ...ln, ...ln, ...op.end()], { watch: [[0x7734, 1]] });
  check('a line is not, and leaves those bytes holding its own value',
    lit(lineTwice) > 20 && lineTwice.watched[0][0] === 0x20,
    `${lit(lineTwice)} lit after drawing it twice in EOR; $7734 = ${hx(lineTwice.watched[0][0])}`);
}
{
  const z = await run([20, 0, ...op.end()], { watch: [[0x771C, 3], [0x7745, 3]] });
  const o = await run([20, 1, ...op.end()], { watch: [[0x771C, 3], [0x7745, 3]] });
  const vec = (r, i) => (r.watched[i][1] | (r.watched[i][2] << 8));
  console.log(`  opcode 20 operand 0: point -> ${hx(vec(z, 0), 4)}, line -> ${hx(vec(z, 1), 4)}`);
  console.log(`  opcode 20 operand 1: point -> ${hx(vec(o, 0), 4)}, line -> ${hx(vec(o, 1), 4)}`);
  check('opcode 20 re-vectors both 2-D primitives to a second pair of routines',
    vec(z, 0) === 0x771F && vec(z, 1) === 0x7748 && vec(o, 0) === 0x7710 && vec(o, 1) === 0x7E3C);
}
{
  await a2.ev('(() => { window.M.rd(0xC051); return 0; })()');   // put it in text mode first
  await run([16, ...op.end()]);
  const v = JSON.parse(await a2.ev('JSON.stringify(window.M.a2.vm.getState())'));
  check('opcode 16 is the whole graphics-mode sequence in one byte',
    !v.textMode && v.hiresMode && v.mixedMode,
    `text ${v.textMode}, hires ${v.hiresMode}, mixed ${v.mixedMode}`);
}

// --- the second set of 2-D primitives -----------------------------------------------------------
console.log('\n=== opcodes 21 to 25: 2-D again, at twice the resolution and with an origin ===');
{
  const six = await run([...op.colour(7), ...op.line2d(-10, 10, 10, 10), ...op.end()]);
  const twentyone = await run([...op.colour(7), 21, ...w16(-20), 10, ...w16(20), 10, ...op.end()]);
  const rowsOf = (r) => [...new Set(r.lit.map((p) => p.row))];
  const extent = (r) => [Math.min(...r.lit.map((p) => p.bit)), Math.max(...r.lit.map((p) => p.bit))];
  console.log(`  opcode 6  line2d(-10,10,10,10):        ${span(six)}`);
  console.log(`  opcode 21 the same, x given doubled:   ${span(twentyone)}`);
  check('opcode 21 is a 2-D line whose x is 16-bit at twice the scale',
    rowsOf(twentyone).join() === rowsOf(six).join()
      && Math.abs(extent(twentyone)[0] - extent(six)[0]) <= 1
      && Math.abs(extent(twentyone)[1] - extent(six)[1]) <= 1,
    `same row and the same span to within a bit`);
  check('and it draws through the other routine, which lights both bits of a cell',
    lit(twentyone) > lit(six) * 1.5, `${lit(six)} bits against ${lit(twentyone)}`);
}
{
  const at00 = await run([...op.colour(7), 22, ...w16(0), 0, 23, 0xEC, 10, 0x14, 10, ...op.end()]);
  const moved = await run([...op.colour(7), 22, ...w16(40), 20, 23, 0xEC, 10, 0x14, 10, ...op.end()]);
  const r0 = at00.lit[0].row, r1 = moved.lit[0].row;
  const b0 = Math.min(...at00.lit.map((p) => p.bit)), b1 = Math.min(...moved.lit.map((p) => p.bit));
  console.log(`  opcode 23 with origin 0,0:     ${span(at00)}`);
  console.log(`  opcode 23 with origin 40,20:   ${span(moved)}`);
  check('opcode 22 sets an origin that opcode 23 draws relative to',
    r1 === r0 - 20 && b1 === b0 + 40,
    `moved up ${r0 - r1} rows and right ${b1 - b0} bits for an origin of (40 halved, 20)`);
  const pt = await run([...op.colour(7), 22, ...w16(0), 0, 25, 20, 10, ...op.end()]);
  check('opcode 25 is the point to opcode 23\'s line', lit(pt) === 1, span(pt));
  const wide = await run([...op.colour(7), 24, ...w16(40), 10, ...op.end()]);
  check('opcode 24 is a point whose x is 16-bit at twice the scale',
    lit(wide) === 1 && wide.lit[0].row === 85, span(wide));
}

// --- compiling, capturing, and waiting ------------------------------------------------------------
console.log('\n=== opcodes 13, 27, 28 and 29: the engine as a service ===');
{
  // Opcode 13 says "do not draw this, write it down" - and what it writes is a display
  // list in the same language, holding the 2-D result of the 3-D work.
  const r = await run([13, 0x00, 0x90, ...op.colour(7),
    ...op.point3d(0, 0, 100), ...op.point3d(20, 0, 100), ...op.end()],
    { watch: [[0x9000, 10]] });
  const emitted = r.watched[0];
  console.log(`  compiled to $9000: ${emitted.map((v) => hx(v)).join(' ')}`);
  console.log(`     = COLOUR ${emitted[1]}, POINT2D ${emitted[3]},${emitted[4]}, `
    + `POINT2D ${emitted[6]},${emitted[7]}, END`);
  check('opcode 13 compiles 3-D into a 2-D display list instead of drawing it',
    emitted[0] === 18 && emitted[2] === 10 && emitted[5] === 10 && emitted[8] === 121
      && lit(r) === 0,
    `${lit(r)} pixels drawn, and the buffer holds COLOUR, two POINT2D and the terminator`);
}
{
  // Opcodes 28 and 29 are the other direction: run the transform and hand back the
  // numbers. $621E non-zero appends every transformed point to the buffer; 2 also
  // abandons the drawing. With the viewer at the origin and no rotation the numbers that
  // come back are the points themselves, which is what makes this readable at all.
  const r = await run([28, 0x00, 0x91, 29, 2, ...op.colour(7),
    ...op.point3d(11, 22, 33), ...op.point3d(-1, -2, -3), 29, 0, ...op.end()],
    { watch: [[0x9100, 12]] });
  const b = r.watched[0];
  const rd16 = (i) => { const v = b[i] | (b[i + 1] << 8); return v > 32767 ? v - 65536 : v; };
  console.log(`  captured at $9100: ${b.map((v) => hx(v)).join(' ')}`);
  console.log(`     = (${rd16(0)},${rd16(2)},${rd16(4)}) and (${rd16(6)},${rd16(8)},${rd16(10)})`);
  check('opcodes 28 and 29 hand back transformed points instead of drawing them',
    rd16(0) === 11 && rd16(2) === 22 && rd16(4) === 33
      && rd16(6) === -1 && rd16(8) === -2 && rd16(10) === -3 && lit(r) === 0,
    `six bytes a point, and ${lit(r)} pixels drawn`);
}
{
  const a = await run([27, 0, ...op.end()]);
  const b = await run([27, 3, ...op.end()]);
  const per = (b.cycles - a.cycles) / 3;
  console.log(`  opcode 27: ${a.cycles} cycles for operand 0, ${b.cycles} for operand 3`);
  check('opcode 27 is a delay, and it is a long one',
    b.cycles > a.cycles * 3 && per > 100000,
    `${Math.round(per)} cycles a unit, about ${(per / 1020484 * 1000).toFixed(0)} ms`);
}

await a2.close();
fs.mkdirSync('captured/opcodes', { recursive: true });
fs.writeFileSync('captured/opcodes/golden.json',
  JSON.stringify({ measuredLengths: measured, results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `opcodes: all ${results.length} checks passed`
  : `opcodes: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
