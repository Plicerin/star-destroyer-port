// The display list's object records, as addresses.
//
// A2-3D2's list at $80FB is a program, and twenty-four of its instructions are OBJECT
// instructions: twelve for the main view at $8123 and twelve for the scope inset at $8247,
// each one an opcode byte followed by twelve operand bytes. `probe_objtable.mjs` is where the
// stride of 13 comes from, and it comes from two independent places - the author's own BASIC
// pokes at $8124, $8131, $813E, $814B and $8248, $8255, $8262, $826F, and the eight bytes in
// which `SV DATA` and `SV DATA2` differ.
//
// **An enemy is one entity with two instructions.** Object *i* draws it in the main view and
// object *i+12* in the scope, and the game switches and moves the pair together - which is
// why every block that touches an object touches two addresses thirteen records apart.
//
// What each object is, as far as the loop's own code says:
//
//   object 1 / 13   enemy class 1, gated on OBJ1.count
//   object 2 / 14   enemy class 2
//   object 3 / 15   enemy class 3
//   object 4 / 16   class 1's missile
//   object 5 / 17   the missile classes 2 and 3 SHARE - either firing blocks the other
//   object 12       turns with the ship: the controls write the heading to it as well
//
// The `count` field is the first operand and the renderer's handler treats it as a frame
// counter. The game uses it as a lifetime and a switch: zero means the object is not drawn,
// and the blocks that gate on a class all test `count >= 1`.
export const RECORD = 13;

/** Object 0's opcode byte. The operand record starts one later. */
export const MAIN_BASE = 0x8123;

/** Object 12's. */
export const SCOPE_BASE = 0x8247;

/** Operand offsets from an object's opcode byte. x, y, z and shape are 16-bit. */
export const FIELD = {
  count: 1, x: 2, y: 4, z: 6, pitch: 8, bank: 9, heading: 10, shape: 11,
};

/** Where object `i`'s opcode byte is. */
export const objectBase = (i) =>
  (i < 12 ? MAIN_BASE + i * RECORD : SCOPE_BASE + (i - 12) * RECORD);

/** The address of one field of one object. */
export const field = (i, name) => objectBase(i) + FIELD[name];

/** A 16-bit operand, signed, out of a memory image addressed absolutely. */
export const readWord = (mem, addr) => {
  const v = mem[addr] | (mem[addr + 1] << 8);
  return v > 0x7FFF ? v - 0x10000 : v;
};

/** Write a 16-bit operand. */
export const writeWord = (mem, addr, v) => {
  mem[addr] = v & 0xff;
  mem[addr + 1] = (v >> 8) & 0xff;
};
