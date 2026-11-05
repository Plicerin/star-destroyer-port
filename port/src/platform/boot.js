// Build the 64K image a flight runs in, by doing what the disk does.
//
// `Game` wants an image with A2-3D2 at $6000, SV DATA at $80FB, MAIN DATA at $83AE and
// STAR DESTROYER.OBJ0 at $08EF - "the same set DOS leaves resident in flight". The honest way
// to produce that is not to place four files at four addresses; it is to replay the loads the
// BASIC performs, in the order it performs them, through the loader in `../game/dos.js`.
//
// The order is not decoration. `SD START` line 2 is
//
//     BLOAD A2-3D2,A$6000 : BLOAD SV DATA : BLOAD MAIN DATA : BLOAD HEADING DATA,A35275
//
// and two of those four are repairs: A2-3D2's load runs one byte past its end onto `$80FB`,
// the display list's first byte, and SV DATA starts exactly there; MAIN DATA's runs 213 bytes
// into HEADING DATA, which is loaded after it. Place the files instead of loading them and the
// display list begins with a zero instead of the VIEWPORT opcode.
//
// And `SD PART2` line 164's `BRUN STAR DESTROYER.OBJ0` runs 250 bytes over `$1FF3`-`$1FFF` -
// the thirteen bytes the BASIC and the binary talk through - with slack from the file's own
// last sector, which on this image is a line of leftover high-score text. Nothing is loaded
// after it, so that stands. The port does not work around it: `seedInterface` below writes
// what the BASIC wrote *before* the BRUN, and then the BRUN runs over it, exactly as measured.
// A disk whose slack is zeros gives a working game here with no change.
//
// See oracle/probe_overshoot.mjs (17 checks) and oracle/parity_overshoot.mjs (9), which hold
// this against the machine over 9,328 bytes.
import { openDisk } from './dsk.js';
import { bload } from '../game/dos.js';
import { IFACE, selectTarget, rollWaves } from '../game/chain.js';

/**
 * `SD START` line 2 and `SD PART2` line 164, in order, with the address overrides the lines
 * carry. `PART1.OBJ0` and `PART2` are loaded too because the real sequence loads them, and
 * `PART1.OBJ0` in particular is written over by the mission binary - which only matters
 * because doing it in the wrong order would leave its tail behind.
 */
export const FLIGHT_LOADS = [
  { file: 'A2-3D2', at: 0x6000 },              // SD START 2
  { file: 'SV DATA', at: null },
  { file: 'MAIN DATA', at: null },
  { file: 'HEADING DATA', at: 35275 },
  { file: 'PART1.OBJ0', at: null },            // SD PART2 164
  { file: 'PART2', at: 0x8BD8 },
  { file: 'STAR DESTROYER.OBJ0', at: null },
];

/** The same, for the final mission: `SD START2` line 2 and `SD PART3` line 164-170. */
export const FINALE_LOADS = [
  { file: 'A2-3D2', at: 0x6000 },
  { file: 'SV DATA2', at: null },
  { file: 'BASE STAR DATA', at: null },
  { file: 'HEADING DATA', at: 35275 },
  { file: 'PART1.OBJ0', at: null },
  { file: 'BASE STAR.OBJ0', at: null },
];

/** `SD` line 130. MATH is loaded once, before `SD START`, and nothing reloads it. */
export const MATH_LOAD = { file: 'MATH', at: null };

/**
 * What `SELECT` and `SD PART2` poke into the interface before the flight.
 *
 * `SELECT` line 21 zeroes all thirteen, line 17 takes the difficulty and lines 22-24 roll the
 * target. `SD START` line 4 zeroes the counters. `SD PART2` line 10 rolls the three waves.
 * Then line 164 loads the binary over the lot of it.
 *
 * @param {Uint8Array} mem
 * @param {number} difficulty 1, 2 or 3
 * @param {() => number} rnd
 */
export function seedInterface(mem, difficulty, rnd = Math.random) {
  for (const a of [IFACE.lastFlight, IFACE.bonus, IFACE.flights, IFACE.difficulty,
    IFACE.finale, IFACE.target, IFACE.baseStar, ...IFACE.waves, ...IFACE.kills]) {
    mem[a] = 0;
  }
  mem[IFACE.difficulty] = difficulty;
  mem[IFACE.target] = selectTarget(difficulty, rnd) ?? 0;
  const waves = rollWaves(difficulty, rnd);
  IFACE.waves.forEach((a, i) => { mem[a] = waves[i]; });
  return { target: mem[IFACE.target], waves };
}

/**
 * A 64K image loaded for a flight, and what the interface held on either side of the BRUN.
 *
 * @param {Uint8Array|ArrayBuffer} image the .dsk
 * @param {object} [opts] `difficulty` 1-3, `rnd` a source of [0,1), `loads` to run the
 *   finale's sequence instead, `honest` false to put the interface back after the BRUN -
 *   which is the first QoL switch and defaults to off, because the baseline is the disk
 */
export function boot(image, { difficulty = 1, rnd = Math.random, loads = FLIGHT_LOADS,
  honest = true } = {}) {
  const disk = openDisk(image);
  const mem = new Uint8Array(0x10000);

  // SD line 130, before anything else.
  bload(mem, disk.file(MATH_LOAD.file), { at: MATH_LOAD.at });

  const intended = seedInterface(mem, difficulty, rnd);

  const loaded = [];
  for (const l of loads) {
    const f = disk.file(l.file);
    const where = bload(mem, f, { at: l.at });
    loaded.push({ name: l.file, at: l.at ?? f.addr, len: f.len, ...where });
  }

  const actual = {
    target: mem[IFACE.target],
    waves: IFACE.waves.map((a) => mem[a]),
  };
  if (!honest) {
    // The one departure, and it is off by default: put back what the BASIC meant the binary
    // to read. See oracle/DISK_TRUTH.md - on a clean dump this switch would be a no-op.
    mem[IFACE.target] = intended.target;
    IFACE.waves.forEach((a, i) => { mem[a] = intended.waves[i]; });
    mem[IFACE.difficulty] = difficulty;
    for (const a of [IFACE.flights, IFACE.bonus, IFACE.lastFlight, IFACE.baseStar,
      IFACE.finale, ...IFACE.kills]) {
      mem[a] = 0;
    }
  }

  // `corrupted` is a fact about the load and stays true whether or not the switch put the
  // numbers back; `repaired` says which of the two the image now holds.
  return { mem, disk, loaded, intended, actual, repaired: !honest,
    corrupted: actual.target !== intended.target
      || actual.waves.some((v, i) => v !== intended.waves[i]) };
}
