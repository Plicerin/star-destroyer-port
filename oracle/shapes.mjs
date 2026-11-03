/**
 * The A2-3D2 shape format.
 *
 * A shape is a list of commands and a terminator. Nearly every command is seven bytes -
 * an opcode and then X, Y, Z as 16-bit little-endian signed - and COLOUR is two.
 *
 * | opcode | bytes | meaning |
 * | --- | --- | --- |
 * | 0 | 7 | POINT - plot the single point |
 * | 1 | 7 | MOVE - pen up, go to |
 * | 2 | 7 | DRAW - pen down, line from the last point |
 * | 3 | 7 | DRAW BACK - line from this point to the last one, leaving the last one put |
 * | 18 | 2 | COLOUR, one operand |
 * | 121 | 1 | end of shape |
 *
 * The engine itself, disassembled later (renderer.mjs), reads opcode 1 as a single
 * FOURTEEN-byte instruction: two points, a move and a draw. Parsing it here as a 7-byte
 * move followed by the 7-byte opcode 2 that always follows it gives the same geometry, so
 * this reader is left as it is - but the engine's handler is at $6265 and it is one
 * instruction, not two.
 *
 * Opcode 3 ($62C0) is the one this was wrong about. It loads the SAVED previous point as
 * the far end, reads a new point as the near end, draws between them, and - because it
 * reads through $624B, which does not update the saved point - leaves the previous point
 * where it was. So a run of opcode 3s is a hub with spokes radiating from it, which is
 * exactly what the explosions are.
 *
 * How this was arrived at, in order:
 *
 * 1. The nine-byte shapes are one command and a terminator, and the thirty-byte ones are
 *    four and a terminator: 7n + 2. Shape 4 reads as MOVE(-50,-20,40) DRAW(-50,-20,-40)
 *    MOVE(50,-20,40) DRAW(50,-20,-40), which is two parallel lines, and every 1 in the
 *    file is followed by a 2 - pen up then pen down.
 * 2. Six shapes de-synced into nonsense opcodes and five-figure coordinates. Reading the
 *    raw bytes of one, 18 is followed by a single small number and then the seven-byte
 *    pattern resumes. Taking 18 as two bytes, MAIN DATA and BASE STAR DATA parse with
 *    no opcode above 3 and no coordinate outside -140..130, which is a model.
 * 3. Opcode 3 was real but unexplained until the engine was disassembled; see above.
 *
 * STARBASE MAIN DATA is the control. It shares SV DATA's pointer table while holding
 * different shapes, so most of those pointers are stale for it - and the records STARBASE
 * switches ON (0 and 6, line 129) parse clean while the ones it explicitly zeroes
 * (1, 2, 3, line 7) de-sync. A parser that reported everything fine would be a parser
 * that cannot fail.
 */
import { openDisk, DISK } from './dsk.mjs';

const d = openDisk(DISK);
export const file = (n) => d.read(d.files.find((x) => x.name === n));

export const TABLES = [0x8124, 0x8248];
export const STRIDE = 13, COUNT = 12, PTR = 10;
export const END = 121, COLOUR = 18;
export const OPS = { 0: 'POINT', 1: 'MOVE', 2: 'DRAW', 3: 'DRAWBACK', 18: 'COLOUR' };

const s16 = (lo, hi) => { const v = lo | (hi << 8); return v > 32767 ? v - 65536 : v; };

/** The 24 shape pointers a configuration block holds, table A then table B. */
export function pointers(cfg) {
  const b = (a) => cfg.data[a - cfg.addr];
  const out = [];
  for (const t of TABLES) {
    for (let r = 0; r < COUNT; r++) {
      const at = t + r * STRIDE;
      out.push({ record: out.length, at, ptr: b(at + PTR) | (b(at + PTR + 1) << 8) });
    }
  }
  return out;
}

/**
 * Parse one shape.
 *
 * Returns ok:false rather than throwing when the bytes are not a shape, because "these
 * bytes are not a shape" is a real and useful answer - it is how a stale pointer
 * announces itself.
 */
export function parseShape(shp, start) {
  const b = (a) => shp.data[a - shp.addr];
  const limit = shp.addr + shp.len;
  const commands = [];
  let a = start;
  while (a < limit) {
    const op = b(a);
    if (op === END) return { ok: true, start, end: a + 1, commands };
    if (op === COLOUR) { commands.push({ op, colour: b(a + 1) }); a += 2; continue; }
    if (op > 3) return { ok: false, start, end: a, commands, why: `opcode ${op} at $${a.toString(16)}` };
    if (a + 7 > limit) return { ok: false, start, end: a, commands, why: 'ran off the end' };
    commands.push({
      op,
      x: s16(b(a + 1), b(a + 2)), y: s16(b(a + 3), b(a + 4)), z: s16(b(a + 5), b(a + 6)),
    });
    a += 7;
  }
  return { ok: false, start, end: a, commands, why: 'no terminator' };
}

/** Every shape a scene's configuration points at. */
export function parseScene(cfgName, shapeName) {
  const cfg = file(cfgName), shp = file(shapeName);
  return pointers(cfg).map((p) => ({ ...p, ...parseShape(shp, p.ptr) }));
}
