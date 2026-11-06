// How DOS 3.3 loads a binary file - which is not quite how it looks.
//
// A `BLOAD` or `BRUN` of a binary file does not write `len` bytes at `addr`. It writes the
// file's **whole sector chain**: the first sector goes through a DOS buffer, because the file
// manager has to read the load address and length out of its first four bytes before it knows
// where the file goes, and every sector after that is read **straight to the destination** -
// all 256 bytes of it, the last one included. So the sectors land on a grid that starts four
// bytes below `addr`, nothing is written below `addr` itself, and a load writes up to 255
// bytes past the end of the file. What it writes there is whatever was left in that sector on
// the disk when the file was saved.
//
// Measured, after a first version of this said DOS leaves the four header bytes at `addr - 4`.
// It does not: `$08EB`-`$08EE` hold something else entirely while the game runs. The grid is
// `addr + 252 + 256k`, which is the same thing from the second sector on, and that is the only
// part that matters.
//
// **This is a property of this particular disk, not of DOS 3.3**, and the first version of
// this comment had it backwards. Stock DOS buffers each sector and copies it out, so it never
// writes past a file's end. The routine at T0/S6 of this image walks the buffer straight
// through to the destination instead - the familiar speed patch - and that is what overshoots.
// Three other DOS 3.3 images with the same file manager at the same sector offsets do not
// have it.
//
// The port models it because it is what this image does, and an image without the patch would
// simply not overshoot. Every binary on this one does:
// one byte for A2-3D2, 253 for MATH. The game is built around it. `SD START` line 2 loads
// A2-3D2 and then SV DATA, because A2-3D2's one byte of overshoot lands on `$80FB`, the
// display list's first byte, which is exactly where SV DATA starts; and it loads MAIN DATA and
// then HEADING DATA, because MAIN DATA's 213 bytes land inside HEADING DATA. The load order is
// a repair list.
//
// One overshoot has no repair after it. `STAR DESTROYER.OBJ0` ends at `$1FF0`, so its last
// sector covers `$1FEB`-`$20EA` and runs over **`$1FF3`-`$1FFF`, the thirteen bytes the BASIC
// and the binary talk through** - and it is the last thing `SD PART2` does before the binary
// takes over. Measured on the machine: `SELECT` rolls a target of 7 and `SD PART2` rolls waves
// of 2/2/5, and by the time the binary reads them they are 217 and 32/51/51, which is a line
// of leftover high-score text. So on this image a flight spawns 134 enemies instead of 9, and
// when it ends `SD PART2` line 172 finds the counters nonzero and goes to the scores.
//
// `BASE STAR.OBJ0` loads to the same address with the same length, and 249 of its 250 slack
// bytes are zero - the one that is not falls below the interface and touches nothing.
// Same program, same overshoot, harmless. **That asymmetry is what says neither was intended**
// - and it is why this is modelled rather than worked around. The port writes the sector chain
// the way DOS does, so a clean dump whose slack is zeros gives a working game with no change
// here, exactly as a clean dump restores the title pages without a change to `START`.
//
// Measured by oracle/probe_overshoot.mjs, which predicts all sixteen bytes at $1FF0-$1FFF
// from the disk image and compares them against the running machine.

/** The load address and length DOS strips from the front of a binary file. */
export const HEADER = 4;

/** Bytes in a DOS 3.3 sector. */
export const SECTOR = 256;

/**
 * How many sectors a `BLOAD` of this length reads.
 *
 * The header counts towards it, so a file is one sector longer than its length suggests
 * whenever `len` is near a multiple of 256.
 */
export function sectorsRead(len) {
  return Math.ceil((HEADER + len) / SECTOR);
}

/**
 * The bytes a load writes **past the end of the file**.
 *
 * @param {number} addr the load address
 * @param {number} len the file's length
 * @returns {{from: number, to: number, bytes: number}} an inclusive range
 */
export function overshoot(addr, len) {
  const base = addr - HEADER;
  const to = base + SECTOR * sectorsRead(len) - 1;
  return { from: addr + len, to, bytes: to - (addr + len) + 1 };
}

/**
 * Load a binary file into a 64K image the way DOS does.
 *
 * `file.raw` is the file's sector chain as stored, header and slack included - what
 * `dsk.mjs`'s `read()` returns alongside the stripped data. Only the sectors a load actually
 * reads are written, which can be fewer than the file has allocated.
 *
 * @param {Uint8Array} mem a 64K image
 * @param {{addr: number, len: number, raw: Uint8Array}} file
 * @param {object} [opts] `at` overrides the load address, as `BLOAD ...,A$xxxx` does.
 *   `exact` writes only the file's own bytes and no slack - which is not what DOS does, and
 *   is here so a harness has something that ought to fail to compare against.
 * @returns {{from: number, to: number, overshoot: {from: number, to: number, bytes: number}}}
 */
export function bload(mem, file, { at = null, exact = false } = {}) {
  const addr = at === null ? file.addr : at;
  const n = exact ? HEADER + file.len : SECTOR * sectorsRead(file.len);
  for (let i = HEADER; i < n && i < file.raw.length; i++) {
    mem[addr - HEADER + i] = file.raw[i];
  }
  return { from: addr, to: addr - HEADER + Math.min(n, file.raw.length) - 1,
    overshoot: overshoot(addr, file.len) };
}
