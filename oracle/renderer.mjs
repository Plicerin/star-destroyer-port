/**
 * A2-3D2: the renderer, read.
 *
 * `CALL 24576` is `JSR $6000`, and $6000 is a four-entry jump table. Everything below
 * follows from reading the code behind it and from watching it run (probe_renderer.mjs).
 *
 * The shape of the thing:
 *
 *   A2-3D2 is not a subroutine that draws a scene. It is an INTERPRETER for a display-list
 *   language, and `SV DATA` is a program written in that language. The engine's entry point
 *   points a 16-bit zero-page pointer ($9B/$9C) at $80FB - where DOS loads `SV DATA` - and
 *   runs it. The program sets the graphics mode, sets the viewer's position and attitude,
 *   draws twelve objects, re-aims the viewer, draws twelve more, and ends.
 *
 *   The twelve "13-byte records" the object-table probe found are twelve instructions of
 *   this language: opcode 19 and twelve operand bytes. See probe_objtable.mjs's note.
 *
 * The four entry points:
 *
 *   | call | what |
 *   | --- | --- |
 *   | $6000 | render a frame, saving and restoring the 96 bytes of zero page it uses |
 *   | $6003 | render a frame, without saving zero page |
 *   | $6006 | cosine of a one-byte angle, A -> A/X (16-bit) |
 *   | $6009 | sine of a one-byte angle, A -> A/X (16-bit) |
 *
 *   $6000 copies zero page $60-$BF into $600C-$606B, calls $6003, and copies it back - so
 *   the 96 bytes at $600C are not code or data, they are the save area. That is the first
 *   gap in the listing, and it is self-evident from the two loops either side of the call.
 *
 * The interpreter, $6118:
 *
 *       LDA #$0A  STA $B1        ; ten clip steps allowed for this command
 *       LDY #$00
 *       LDA ($9B),Y              ; fetch the opcode
 *       BMI  end                 ; >= $80: stop
 *       CMP #$1E  BPL end        ; >= 30: stop
 *       ASL A  TAX
 *       LDA $60DC,X  ...  JMP ($A3)
 *
 *   So there are exactly THIRTY opcodes, dispatched through a table of thirty two-byte
 *   entries at $60DC - which runs to $6117 and stops precisely where the interpreter
 *   begins. That is the second gap in the listing, and it is also self-evident.
 *
 *   Each handler advances $9B/$9C itself, through $621F ("add A to the list pointer"), so
 *   an instruction's length is a property of its handler rather than of the data.
 *
 * What the engine keeps in zero page:
 *
 *   | zp | what |
 *   | --- | --- |
 *   | $60-$66 | point slot 1: X, Y, Z (16-bit each) and its clip outcode |
 *   | $68-$6E | point slot 2, same layout |
 *   | $70-$76 | the previous point, kept so opcodes 2 and 3 can continue from it |
 *   | $7C | a mode byte, set by opcode 4 |
 *   | $7D | compile flag: set by opcode 13, makes the engine emit 2-D instead of plotting |
 *   | $90-$95 | the viewer's position: X, Y, Z, 16-bit each |
 *   | $96-$98 | the viewer's attitude: pitch, bank, heading, one byte each |
 *   | $9B/$9C | the display-list pointer - the program counter of this machine |
 *   | $9D/$9E | the output pointer, when compiling |
 *   | $AB-$B0 | the point being transformed |
 *   | $B1 | clip steps remaining for this command |
 *   | $B3-$B6 | a 2-D line's x1, y1, x2, y2 |
 *   | $BB/$BC/$BD | $00, $20, $40 - the hires page bases |
 *
 * Angles are one byte for a whole turn. $6147 holds a 64-entry 16-bit quarter sine table,
 * and $61CB folds the quadrants onto it; $61C8 is the same table entered 64 units earlier,
 * which is the cosine. The port's rotations have to come off this table, not off Math.sin,
 * or nothing will land on the same pixel.
 *
 * The clipper is a bisection, not an intersection. $6A22 and $6A7B compute a four-bit
 * outcode per point by testing z+x, z-x, z+y, z-y for overflow - which is the frustum
 * |x| <= z, |y| <= z, so the field of view is exactly 90 degrees both ways. The drawing
 * code then rejects a line whose two outcodes share a bit (Cohen-Sutherland's trivial
 * reject), and otherwise walks the line inward by halving, at most ten times, counted down
 * in $B1. Ten is set at $6118 for every command.
 *
 * The perspective divide is at $6370-$63AF: divide, then scale by a constant and add a
 * centre. Both the scale and the centre are bytes INSIDE that code, patched by opcode 14 -
 * see below.
 *
 * The engine rewrites itself in four places, which is why a disassembly of the disk image
 * does not match the running machine (probe_renderer.mjs measures this):
 *
 *   | opcode | patches | effect |
 *   | --- | --- | --- |
 *   | 7 | $63E8 | the low byte of a `STA $C0nn`, so one instruction can touch any switch |
 *   | 9 | $7C2D, $79A7, $7C68, ... | the hires page base in the plotting code |
 *   | 12 | $7734, $7739, ... | `ORA (zp),Y` <-> `EOR (zp),Y`: draw or erase |
 *   | 14 | $6380, $6386, $63A3, $63A9 | the viewport's two scales and two centres |
 */
import { openDisk, DISK } from './dsk.mjs';
import { disasm1, traverse, hx } from './disasm6502.mjs';

export const ENTRY = { render: 0x6000, renderNoSave: 0x6003, cos: 0x6006, sin: 0x6009 };
export const ZP_SAVE = [0x600C, 0x606B];
export const DISPATCH = 0x60DC;          // 30 entries of 2 bytes, ending at $6117
export const OPCODES = 30;
export const INTERP = 0x6118;
export const FETCH = 0x611E;             // the LDA ($9B),Y that reads the next opcode
export const ADVANCE = 0x621F;           // add A to the list pointer
export const LIST_PTR = 0x9B;            // the interpreter's program counter
export const CLIP_STEPS = 0x0A;          // $6118 puts this in $B1 for every command
export const END = 121;                  // the terminator, written by the engine at $612A
export const SINE_TABLE = [0x6147, 0x61C6];

/** The engine's own files, laid out where DOS puts them. */
export function engineMemory(scene = 'SV DATA', shapes = 'MAIN DATA') {
  const d = openDisk(DISK);
  const mem = new Uint8Array(0x10000);
  const loaded = [];
  for (const name of ['A2-3D2', scene, shapes, 'HEADING DATA', 'MATH']) {
    const file = d.files.find((x) => x.name === name);
    if (!file) continue;
    const x = d.read(file);
    for (let i = 0; i < x.len; i++) mem[x.addr + i] = x.data[i];
    loaded.push({ name, addr: x.addr, len: x.len });
  }
  return { mem, loaded };
}

/** The thirty handler addresses, read out of the dispatch table. */
export function handlers(mem) {
  const out = [];
  for (let i = 0; i < OPCODES; i++) {
    const a = DISPATCH + i * 2;
    out.push(mem[a] | (mem[a + 1] << 8));
  }
  return out;
}

/**
 * What each opcode is, and how long.
 *
 * `len` is the number of bytes the instruction occupies, and every one of them was
 * measured in the running machine - the distance the list pointer moved between one fetch
 * and the next. `from` says how the opcode's MEANING was established: 'traced' means the
 * disk's own scene executes it and probe_renderer.mjs watched it; 'exercised' means the
 * scene never runs it and probe_opcodes.mjs made the engine run it on inputs of our
 * choosing.
 *
 * `what` is a description, not a name from a manual - no A2-3D2 documentation was used.
 * Opcode 11 has no length: it assigns the list pointer instead of advancing it.
 */
export const OPS = {
  0:  { len: 7,  from: 'exercised', what: 'POINT: plot one 3-D point' },
  1:  { len: 14, from: 'traced',    what: 'LINE: two 3-D points, a move and a draw (7 + 7)' },
  2:  { len: 7,  from: 'traced',    what: 'DRAW on: line from the previous point to this one' },
  3:  { len: 7,  from: 'exercised', what: 'DRAW back: line to the previous point, leaving it put - so a run of these is a hub with spokes' },
  4:  { len: 2,  from: 'exercised', what: 'set the mode byte $7C, which suppresses clipped lines' },
  5:  { len: 10, from: 'traced',    what: 'VIEWER: X, Y, Z (16-bit each) then pitch, bank, heading' },
  6:  { len: 5,  from: 'traced',    what: '2-D LINE in screen coordinates: x1, y1, x2, y2' },
  7:  { len: 2,  from: 'traced',    what: 'touch soft switch $C0nn (patches its own STA)' },
  8:  { len: 2,  from: 'traced',    what: 'clear a hires page (0 = $2000, else $4000)' },
  9:  { len: 2,  from: 'traced',    what: 'select the page to draw on (patches the plotters)' },
  10: { len: 3,  from: 'traced',    what: '2-D POINT in screen coordinates: x, y' },
  11: { len: null, from: 'exercised', what: 'JUMP: the list pointer becomes the operand' },
  12: { len: 2,  from: 'exercised', what: 'PLOTMODE: 0 writes ORA into the plot sites, else EOR. Only meaningful with COLOUR 0; any other colour patches the same sites with a JSR and opcode 12 then corrupts it' },
  13: { len: 3,  from: 'exercised', what: 'COMPILE: write the 2-D result to the operand address as a display list, instead of drawing' },
  14: { len: 5,  from: 'traced',    what: 'VIEWPORT: x scale, y scale, x centre, y centre' },
  15: { len: 7,  from: 'traced',    what: 'six engine constants, into $6140-$6145 - zeroing these wrecks the projection' },
  16: { len: 1,  from: 'exercised', what: 'graphics mode in one byte: mixed, hires, graphics, page 1' },
  17: { len: 1,  from: 'traced',    what: 'no-op (one byte, so it serves as patch space)' },
  18: { len: 2,  from: 'traced',    what: 'COLOUR: patches 26 sites in the plotting code. 0 is white (a plain ORA), 1-3 are the hires colours, 4-7 are all the same' },
  19: { len: 13, from: 'traced',    what: 'OBJECT: count, X, Y, Z, pitch, bank, heading, shape' },
  20: { len: 2,  from: 'exercised', what: 'VECTOR: 0 points the 2-D primitives at $771F/$7748, else at $7710/$7E3C' },
  21: { len: 7,  from: 'exercised', what: '2-D LINE with x as 16-bit at twice the scale, through the second line routine' },
  22: { len: 4,  from: 'exercised', what: 'ORIGIN for opcodes 23 and 25: x 16-bit (halved), y a byte' },
  23: { len: 5,  from: 'exercised', what: '2-D LINE relative to the origin opcode 22 set' },
  24: { len: 4,  from: 'exercised', what: '2-D POINT with x as 16-bit at twice the scale' },
  25: { len: 3,  from: 'exercised', what: '2-D POINT relative to the origin opcode 22 set' },
  26: { len: 3,  from: 'exercised', what: 'SKIP: if operand 2 is zero, skip operand 1 further bytes - the list has a conditional' },
  27: { len: 2,  from: 'exercised', what: 'WAIT: a delay loop, about 200,000 cycles (0.2s) per unit' },
  28: { len: 3,  from: 'exercised', what: 'CAPTURE TO: where opcode 29 appends transformed points, six bytes each' },
  29: { len: 2,  from: 'exercised', what: 'CAPTURE: 0 off, non-zero appends every transformed point, 2 also stops it drawing' },
  [END]: { len: 1, from: 'traced',  what: 'END: return from this list' },
};

const s16 = (lo, hi) => { const v = lo | (hi << 8); return v > 32767 ? v - 65536 : v; };

/**
 * An opcode-19 object instruction, laid out.
 *
 * From $6D07: operand 0 is a frame counter - 0 means skip the object, $FF means draw it
 * for ever, and anything else is decremented IN THE LIST and stored back, so an object
 * switched on with 30 draws itself thirty times and then turns itself off. $70E3 then
 * subtracts operands 1-6 from the viewer position at $90-$95, three 16-bit values, which
 * is the object's position; operands 7-9 go to $96-$98, which is its attitude; and
 * operands 10-11 are written straight into the list pointer, which is how the engine
 * recurses into the shape.
 */
export function object(mem, at) {
  return {
    at, count: mem[at + 1],
    x: s16(mem[at + 2], mem[at + 3]), y: s16(mem[at + 4], mem[at + 5]),
    z: s16(mem[at + 6], mem[at + 7]),
    pitch: mem[at + 8], bank: mem[at + 9], heading: mem[at + 10],
    shape: mem[at + 11] | (mem[at + 12] << 8),
  };
}

/**
 * Disassemble a display list.
 *
 * It does not follow opcode 19 into its shape or opcode 11 to its target: this prints one
 * list, and the caller decides what else to print. It stops at the terminator, at an
 * opcode the interpreter would refuse (>= 30), or at `limit`.
 */
export function disasmList(mem, start, limit = 0x10000) {
  const out = [];
  let a = start;
  for (;;) {
    if (a >= limit) return { ok: false, start, end: a, items: out, why: 'ran past the end' };
    const op = mem[a];
    if (op === END) { out.push({ at: a, op, len: 1, text: 'END' }); return { ok: true, start, end: a + 1, items: out }; }
    if (op >= OPCODES) return { ok: false, start, end: a, items: out, why: `opcode ${op} at ${hx(a, 4)} - the interpreter would stop here` };
    const spec = OPS[op];
    const len = spec.len;
    const item = { at: a, op, len, text: describe(mem, a, op) };
    out.push(item);
    if (len === null) {                                  // opcode 11: a jump
      const t = mem[a + 1] | (mem[a + 2] << 8);
      return { ok: true, start, end: a + 3, items: out, jumpedTo: t };
    }
    a += len;
  }
}

const b = (mem, a) => mem[a];
function describe(mem, a, op) {
  const o = (i) => mem[a + i];
  const pt = (i) => `${s16(o(i), o(i + 1))},${s16(o(i + 2), o(i + 3))},${s16(o(i + 4), o(i + 5))}`;
  switch (op) {
    case 0: return `POINT   ${pt(1)}`;
    case 1: return `LINE    ${pt(1)}  ->  ${pt(8)}`;
    case 2: return `DRAWON  ${pt(1)}`;
    case 3: return `DRAWBK  ${pt(1)}`;
    case 4: return `MODE    ${o(1)}`;
    case 5: return `VIEWER  at ${pt(1)}  pitch ${o(7)} bank ${o(8)} heading ${o(9)}`;
    case 6: return `LINE2D  ${o(1)},${o(2)} -> ${o(3)},${o(4)}`;
    case 7: return `SWITCH  $C0${o(1).toString(16).toUpperCase().padStart(2, '0')}`;
    case 8: return `CLEAR   page ${o(1)}`;
    case 9: return `DRAWTO  page ${o(1)}`;
    case 10: return `POINT2D ${o(1)},${o(2)}`;
    case 11: return `JUMP    ${hx(o(1) | (o(2) << 8), 4)}`;
    case 12: return `PLOTMODE ${o(1) === 0 ? 'draw' : 'erase'}`;
    case 13: return `COMPILE to ${hx(o(1) | (o(2) << 8), 4)}`;
    case 14: return `VIEWPORT xscale ${o(1)} yscale ${o(2)} xcentre ${o(3)} ycentre ${o(4)}`;
    case 15: return `CONST   ${[1, 2, 3, 4, 5, 6].map((i) => o(i)).join(' ')}`;
    case 16: return 'GRMODE';
    case 17: return 'NOP';
    case 18: return `COLOUR  ${o(1)}`;
    case 19: {
      const x = object(mem, a);
      return `OBJECT  ${x.count === 0 ? 'off' : x.count === 255 ? 'on ' : 'x' + x.count}  `
        + `at ${x.x},${x.y},${x.z}  pbh ${x.pitch},${x.bank},${x.heading}  shape ${hx(x.shape, 4)}`;
    }
    case 29: return `MODE29  ${o(1)}`;
    default: {
      const spec = OPS[op];
      const args = [];
      for (let i = 1; i < (spec.len ?? 1); i++) args.push(o(i));
      return `OP${String(op).padStart(2, '0')}    ${args.join(' ')}`;
    }
  }
}

/**
 * Where the engine's code is.
 *
 * Follows the instruction stream from the four entry points, the interpreter and the
 * thirty handlers. This finds far more than an execution trace does - a trace only sees
 * the branches that happened to be taken - but it decodes from the disk image, and the
 * engine rewrites four places in itself while it runs. probe_renderer.mjs checks the
 * traced addresses against this, and names the places where they disagree.
 */
export function engineCode(mem) {
  return traverse(mem, [
    ENTRY.render, ENTRY.renderNoSave, ENTRY.cos, ENTRY.sin, INTERP, ...handlers(mem),
  ], { lo: 0x6000, hi: 0x80FB });
}

/** The addresses worth seeing as names in a listing. */
export function symbols(mem) {
  const sym = {
    0x6000: 'RENDER', 0x6003: 'RENDER.NOSAVE', 0x6006: 'COS', 0x6009: 'SIN',
    0x6090: 'FRAME', 0x6118: 'NEXTOP', 0x611C: 'NEXTOP.Y0', 0x621F: 'ADVANCE',
    0x63B5: 'ADV2', 0x63B7: 'ADV.A', 0x61C8: 'COS.A', 0x61CB: 'SIN.A',
    0x6461: 'MUL16', 0x6480: 'MULCORE', 0x65DE: 'DIV', 0x659D: 'SCALE',
    0x684D: 'FETCHPT', 0x6A22: 'OUTCODE1', 0x6A7B: 'OUTCODE2',
    0x6AD4: 'CLIP1', 0x6AEE: 'CLIP2', 0x666E: 'SETVIEW',
    0x771C: 'PLOT2D', 0x7745: 'LINE2D', 0x7691: 'CLRPAGE', 0x70DE: 'ADV13',
    0x70E3: 'SUB16', 0x60C1: 'EMIT2', 0x6370: 'PROJECT',
    // the engine's own variables, inside its code
    0x613E: 'ANGLE', 0x6147: 'SINTAB', 0x621E: 'MODE29', 0x60DC: 'DISPATCH',
    0x600C: 'ZPSAVE',
  };
  handlers(mem).forEach((h, i) => { if (!sym[h]) sym[h] = `OP${String(i).padStart(2, '0')}`; });
  return sym;
}

/** A listing of the engine: code where code was found, bytes where it was not. */
export function listing(mem, { code, sym }) {
  const lines = [];
  let a = 0x6000;
  while (a < 0x80FB) {
    if (!code.has(a)) {
      const run = [];
      while (a < 0x80FB && !code.has(a) && run.length < 16) { run.push(mem[a]); a++; }
      const at = a - run.length;
      lines.push(`${hx(at, 4)}  ${(sym[at] ? sym[at] + ':' : '').padEnd(14)}`
        + `.byte ${run.map((v) => hx(v)).join(', ')}`);
      continue;
    }
    const x = disasm1(mem, a, sym);
    lines.push(`${hx(a, 4)}  ${(sym[a] ? sym[a] + ':' : '').padEnd(14)}`
      + `${x.bytes.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(9)}  ${x.text}`);
    a += x.len;
  }
  return lines;
}

export { hx };
