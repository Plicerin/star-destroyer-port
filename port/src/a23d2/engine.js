/**
 * A2-3D2 itself: the display-list interpreter.
 *
 * `CALL 24576` is not a routine that draws a scene, it is an interpreter, and `SV DATA`
 * is a program written for it. This runs that program.
 *
 * The shape of it, from `oracle/renderer.mjs` and the probes behind it:
 *
 *   - a list pointer, the program counter of this machine, starting at $80FB
 *   - thirty opcodes, dispatched through a table; anything >= 30 stops the list
 *   - each handler advances the pointer by its own length, so lengths belong to opcodes
 *   - opcode 19 recurses into a shape by assigning the pointer, and the shape's
 *     terminator returns
 *
 * **State survives a call.** The colour, the plot mode, the primitive vectors and opcode
 * 15's constants all live in patched code rather than in zero page, so a frame inherits
 * whatever the last one left. `reset()` is the frame routine at $6090, which zeroes zero
 * page and points the list at $80FB - and deliberately does NOT touch any of those.
 */
import { Screen } from './screen.js';
import { line } from './line.js';
import { buildMatrix, transform, project, outcode, viewportScale, viewportCentre, objectFrame } from './view.js';
import { clipLine } from './clip.js';
import { s16 } from './math.js';

export const LIST_START = 0x80FB;

/** Opcode lengths, as measured in the machine by probe_opcodes.mjs. */
export const LEN = {
  0: 7, 1: 14, 2: 7, 3: 7, 4: 2, 5: 10, 6: 5, 7: 2, 8: 2, 9: 2, 10: 3,
  12: 2, 13: 3, 14: 5, 15: 7, 16: 1, 17: 1, 18: 2, 19: 13, 20: 2,
  21: 7, 22: 4, 23: 5, 24: 4, 25: 3, 26: 3, 27: 2, 28: 3, 29: 2,
};
export const END = 121;

export class Engine {
  /** @param mem a 64K byte array with the engine's data files loaded where DOS puts them */
  constructor(mem) {
    this.mem = mem;
    this.screen = new Screen();
    this.reset();
  }

  /** $6090: what the frame entry does before running the list. */
  reset() {
    this.pc = LIST_START;
    this.viewer = [0, 0, 0];              // $90-$95
    this.attitude = [0, 0, 0];            // $96-$98, pitch/bank/heading
    this.M = [[0x7FFD, 0, 0], [0, 0x7FFD, 0], [0, 0, 0x7FFD]];   // the identity $6090 writes
    this.constants = [0x7FFF, 0x7FFF, 0x7FFF];
    this.slot1 = [0, 0, 0]; this.slot2 = [0, 0, 0]; this.prev = [0, 0, 0];
    this.code1 = 0; this.code2 = 0;
    this.mode7C = 0;                      // opcode 4
    this.mode621E = 0;                    // opcode 29
    this.compileTo = null;                // opcode 13
    this.xscale = 0x45; this.xcentre = 0; // the projection's patched bytes, as the disk ships them
    this.yscale = 0x5E; this.ycentre = 0;
    this.stack = [];
  }

  byte(at) { return this.mem[at & 0xffff]; }
  word(at) { return s16(this.byte(at) | (this.byte(at + 1) << 8)); }

  /** Run the list to its terminator. Returns the number of instructions executed. */
  run(limit = 100000) {
    let n = 0;
    for (;;) {
      if (++n > limit) throw new Error('display list did not terminate');
      const op = this.byte(this.pc);
      if (op >= 30) {                      // $6120 / $6122: >= $80 or >= 30 ends the list
        if (!this.stack.length) return n;
        const frame = this.stack.pop();    // a shape's terminator returns to its object
        this.pc = frame.pc;
        Object.assign(this, frame.saved);
        continue;
      }
      this.step(op);
    }
  }

  step(op) {
    const at = this.pc;
    const o = (i) => this.byte(at + i);
    const w = (i) => this.word(at + i);
    switch (op) {
      case 0: this.pointCmd(at); return;
      case 1: this.lineCmd(at); return;
      case 2: this.drawOnCmd(at); return;
      case 3: this.drawBackCmd(at); return;
      case 4: this.mode7C = o(1); break;                     // $63B0
      case 5:                                                 // $63BD VIEWER
        this.viewer = [w(1), w(3), w(5)];
        this.attitude = [o(7), o(8), o(9)];
        this.M = buildMatrix(o(7), o(8), o(9), this.constants);
        break;
      case 6:                                                 // $63CE 2-D LINE
        line(this.screen, s8(o(1)), s8(o(2)), s8(o(3)), s8(o(4)));
        break;
      case 7: break;                                          // $63DF soft switch: no screen effect here
      case 8: this.screen.clear(o(1) ? 1 : 0); break;          // $7623
      case 9: this.screen.setDrawPage(o(1)); break;            // $7D46
      case 10: this.screen.point(s8(o(1)), s8(o(2))); break;   // $63EC 2-D POINT
      case 11: this.pc = o(1) | (o(2) << 8); return;           // $63FB JUMP
      case 12: this.screen.setPlotMode(o(1)); break;           // $8081
      case 13: this.compileTo = o(1) | (o(2) << 8); break;     // $6409
      case 14:                                                 // $642D VIEWPORT
        this.xscale = viewportScale(o(1)); this.yscale = viewportScale(o(2));
        this.xcentre = viewportCentre(o(3)); this.ycentre = viewportCentre(o(4));
        break;
      case 15:                                                 // $6452 the axis scales
        this.constants = [o(1) | (o(2) << 8), o(3) | (o(4) << 8), o(5) | (o(6) << 8)];
        break;
      case 16: break;                                          // $641A graphics mode
      case 17: break;                                          // $6428 no-op
      case 18: this.screen.setColour(o(1)); break;             // $7D74
      case 19: this.objectCmd(at); return;                     // $6D07
      case 26:                                                 // $71BF conditional skip
        this.pc += o(2) === 0 ? 3 + o(1) : 3;
        return;
      case 29: this.mode621E = o(1); break;                    // $721A
      default:
        throw new Error(`opcode ${op} is not implemented in the port yet `
          + `(it is measured in probe_opcodes.mjs; the scene on this disk never runs it)`);
    }
    this.pc += LEN[op];
  }

  // --- reading and transforming a point ------------------------------------------------
  /**
   * $684D: fetch three 16-bit operands, subtract the viewer, rotate, and shift left three.
   *
   * A delta too wide for fourteen bits halves all three first - see `halveIfWide` in view.js.
   * This port used to throw there, on the grounds that no geometry on the disk reached it;
   * parity_loop.mjs found that a respawned enemy does, every time, so it is modelled.
   */
  fetchPoint(at) {
    return transform(this.M, [this.word(at), this.word(at + 2), this.word(at + 4)],
      this.viewer, { mode29: this.mode621E });
  }

  /** $624B: read into slot 1. Does NOT touch the saved previous point. */
  readSlot1(at) {
    this.slot1 = this.fetchPoint(at + 1);
    this.code1 = outcode(this.slot1);
  }

  /** $6229: read into slot 2, and save it as the previous point. */
  readSlot2(at) {
    this.slot2 = this.fetchPoint(at + 1);
    this.code2 = outcode(this.slot2);
    this.prev = this.slot2.slice();
  }

  // --- the drawing commands ---------------------------------------------------------------
  pointCmd(at) {                                              // $62DC
    this.readSlot1(at);
    this.pc += 7;
    if (this.code1 === 0) {
      const p = this.projectPoint(this.slot1);
      if (p) this.screen.point(p[0], p[1]);
    }
  }

  lineCmd(at) {                                               // $6265
    this.readSlot1(at);
    this.readSlot2(at + 7);
    this.pc += 14;
    this.drawSegment();
  }

  drawOnCmd(at) {                                             // $629A
    this.slot1 = this.prev.slice();
    this.code1 = outcode(this.slot1);
    this.readSlot2(at);
    this.pc += 7;
    this.drawSegment();
  }

  drawBackCmd(at) {                                           // $62C0
    this.slot2 = this.prev.slice();
    this.code2 = outcode(this.slot2);
    this.readSlot1(at);
    this.pc += 7;
    this.drawSegment();
  }

  /** Trivial reject, clip, project both ends, draw. $6265's tail and $6323. */
  drawSegment() {
    if (this.mode7C && (this.code1 || this.code2)) return;    // $6278 / $6285
    const clipped = clipLine(this.slot1, this.slot2);
    if (!clipped) return;
    const a = this.projectPoint(clipped[0]), b = this.projectPoint(clipped[1]);
    if (!a || !b) return;
    line(this.screen, a[0], a[1], b[0], b[1]);
  }

  /** $6367, both axes. */
  projectPoint(v) {
    const x = project(v[0], v[2], this.xscale, this.xcentre);
    const y = project(v[1], v[2], this.yscale, this.ycentre);
    return x === null || y === null ? null : [x, y];
  }

  // --- objects -------------------------------------------------------------------------------
  /**
   * $6D07: count, position, attitude, shape pointer.
   *
   * Operand 0 is a frame counter: 0 skips the object, $FF draws it for ever, and anything
   * else is decremented IN THE LIST and written back, so an object switched on with 30
   * draws itself thirty times and then turns itself off.
   *
   * The engine pushes zero page, overrides the viewer's position and attitude with the
   * object's, and assigns the list pointer to the shape - so the shape's terminator
   * returns here through the same path that ends any list.
   */
  objectCmd(at) {
    const count = this.byte(at + 1);
    if (count === 0) { this.pc += 13; return; }
    if (count !== 0xFF) this.mem[at + 1] = count - 1;

    const saved = {
      viewer: this.viewer.slice(), attitude: this.attitude.slice(), M: this.M,
      slot1: this.slot1.slice(), slot2: this.slot2.slice(), prev: this.prev.slice(),
      code1: this.code1, code2: this.code2,
    };
    const rel = [this.viewer[0] - this.word(at + 2), this.viewer[1] - this.word(at + 4),
      this.viewer[2] - this.word(at + 6)];
    this.attitude = [this.byte(at + 8), this.byte(at + 9), this.byte(at + 10)];
    // $6D7C onwards: the position is rotated into the object's frame and the object's
    // rotation is COMPOSED into the matrix already there - not a rebuild from the
    // object's angles, which is what the first version of this did and which drew
    // nothing at all as soon as an object had a pitch.
    const framed = objectFrame(this.M, rel, this.attitude[0], this.attitude[1], this.attitude[2]);
    this.viewer = framed.pos;
    this.M = framed.M;

    this.stack.push({ pc: this.pc + 13, saved });
    this.pc = this.byte(at + 11) | (this.byte(at + 12) << 8);
  }
}

const s8 = (v) => ((v & 0xff) > 127 ? (v & 0xff) - 256 : (v & 0xff));
