/**
 * Run A2-3D2 on a display list of our own, in the real machine.
 *
 * Reading the engine says what it ought to do. This makes it do it: write a list, call
 * the engine, look at the screen. It is the difference between a reading and a
 * measurement, and it is the only way to find out what the fourteen opcodes this disk
 * never executes actually are.
 *
 * The engine is called where the game calls it. `$6003` renders without saving zero page
 * and - this is the constraint the whole module is built around - it does not take the
 * list's address as an argument. `$6090` loads `$9B`/`$9C` with `$80FB` from two immediate
 * operands in its own code, which is where DOS puts `SV DATA`. So an experiment writes
 * its list over `SV DATA`, runs, and puts `SV DATA` back.
 *
 * Calling it is the ordinary 6502 trick: push a return address, set the PC, and step until
 * control arrives at the address pushed. `$FFFE` pushed means `RTS` lands on `$FFFF`,
 * which is in ROM and nothing branches to, so it cannot be reached by accident.
 */
import { identify } from './screens.mjs';

export const LIST = 0x80FB;          // where $6090 points the list pointer, hard-coded
export const LIST_LEN = 491;         // SV DATA's length - what has to be saved and restored
export const SENTINEL = 0xFFFF;      // where the engine returns to, for us

/** Opcode shorthands, so an experiment reads as what it is testing. */
export const op = {
  switches: () => [7, 0x52, 7, 0x50, 7, 0x57, 7, 0x54],   // graphics, hires, mixed off, page 1
  // The operand is 0 for $2000 and anything else for $4000: opcode 9 does
  // `LDA operand : BEQ .. : LDA #$20 : STA $BB`, so zero means the first page. The game
  // double-buffers by poking these two operands with 0 and 1 alternately.
  clear: (page = 0) => [8, page ? 1 : 0],
  drawTo: (page = 0) => [9, page ? 1 : 0],
  colour: (c) => [18, c],
  point2d: (x, y) => [10, x & 0xff, y & 0xff],
  line2d: (x1, y1, x2, y2) => [6, x1 & 0xff, y1 & 0xff, x2 & 0xff, y2 & 0xff],
  viewport: (xs, ys, xc, yc) => [14, xs, ys, xc, yc],
  viewer: (x, y, z, p, b, h) => [5,
    x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, z & 0xff, (z >> 8) & 0xff,
    p & 0xff, b & 0xff, h & 0xff],
  point3d: (x, y, z) => [0, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, z & 0xff, (z >> 8) & 0xff],
  line3d: (x1, y1, z1, x2, y2, z2) => [1,
    x1 & 0xff, (x1 >> 8) & 0xff, y1 & 0xff, (y1 >> 8) & 0xff, z1 & 0xff, (z1 >> 8) & 0xff,
    2, x2 & 0xff, (x2 >> 8) & 0xff, y2 & 0xff, (y2 >> 8) & 0xff, z2 & 0xff, (z2 >> 8) & 0xff],
  end: () => [121],
};

/**
 * Drive the disk to flight, which is where the engine is resident and configured.
 *
 * Three probes had this copied into them. The route is read out of the BASIC rather than
 * guessed: START chains LOGO1, which polls $C000 for 500 BASIC iterations and chains
 * SELECT on a key; SELECT reads $C000 exactly once and chains DEMO if nothing is pending,
 * so the press has to land inside its picture load. Hence knocking rather than tapping.
 */
export async function toFlight(a2, { difficulty = 1, settleMs = 20000 } = {}) {
  await a2.coldStart();
  let started = false;
  for (let i = 0; i < 60 && !started; i++) {
    await a2.waitMs(500);
    started = (await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'));
  }
  if (!started) throw new Error('the disk never reached START');
  let atSelect = false;
  for (let i = 0; i < 60 && !atSelect; i++) {
    await a2.key(' ');
    await a2.waitMs(500);
    const id = identify(Uint8Array.from(await a2.readRange(0x2000, 0x4000)));
    atSelect = !!(id && id.name === 'DIFFICULTY.PIC');
  }
  if (!atSelect) throw new Error('never reached the difficulty screen');
  let chosen = 0;
  for (let i = 0; i < 40 && chosen !== difficulty; i++) {
    await a2.key(String(difficulty));
    await a2.waitMs(500);
    chosen = JSON.parse(await a2.ev('window.M.rd(0x1FF6)'));
  }
  if (chosen !== difficulty) throw new Error('the difficulty screen never took the key');
  await a2.waitMs(settleMs);
  return { difficulty: chosen };
}

/** Install the experiment harness in the page. Call once, after toFlight. */
export async function arm(a2) {
  return a2.ev(`(() => {
    const cpu = window.M.cpu, rd = window.M.rd, wr = window.M.wr;
    window.M.svData = window.M.range(${LIST}, ${LIST + LIST_LEN});
    window.M.restoreList = () => {
      window.M.svData.forEach((v, i) => wr(${LIST} + i, v));
      return 'restored';
    };
    /**
     * Write a list, call the engine, and hand back the page.
     *
     * The budget matters: an opcode nobody has run before can loop for ever, and an
     * experiment that hangs the machine costs the whole probe. It stops and says so.
     */
    window.M.runList = (bytes, { page = 1, clear = true, budget = 20000000,
                                 watch = [], at = ${LIST} } = {}) => {
      if (bytes.length > ${LIST_LEN}) return { error: 'list longer than SV DATA' };
      for (let i = 0; i < bytes.length; i++) wr(at + i, bytes[i]);
      const base = page === 2 ? 0x4000 : 0x2000;
      if (clear) for (let a = base; a < base + 0x2000; a++) wr(a, 0);
      const before = cpu.getState();
      const st = cpu.getState();
      wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
      wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
      st.pc = 0x6003;
      cpu.setState(st);
      const t0 = cpu.getCycles();
      let returned = false, instr = 0;
      // The fetch at $611E is the interpreter reading an opcode, and $9B/$9C is where it
      // read it from - so the distance between consecutive fetches is an instruction's
      // length, measured rather than reasoned about.
      const walk = [];
      cpu.stepCyclesDebug(budget, () => {
        instr++;
        const pc = cpu.getPC();
        if (pc === 0x611E) walk.push(rd(0x9B) | (rd(0x9C) << 8));
        if (pc === ${SENTINEL}) { returned = true; return true; }
      });
      const cycles = cpu.getCycles() - t0;
      const out = { returned, instr, cycles, walk,
        page: window.M.range(base, base + 0x2000),
        watched: watch.map(([a, n]) => window.M.range(a, a + n)) };
      cpu.setState(before);
      window.M.restoreList();
      return out;
    };
    return 'armed';
  })()`);
}

/** Run one list. Returns the page plus the pixels that came on. */
export async function runList(a2, bytes, opts = {}) {
  const r = JSON.parse(await a2.ev(
    `JSON.stringify(window.M.runList(${JSON.stringify([...bytes])}, ${JSON.stringify(opts)}))`));
  if (r.error) throw new Error(r.error);
  r.page = Uint8Array.from(r.page);
  r.lit = litPixels(r.page);
  return r;
}

/** Every lit bit of a hires page, as {row, bit} - bit being the 0..279 screen column. */
export function litPixels(page) {
  const out = [];
  for (let row = 0; row < 192; row++) {
    const base = (row & 7) * 0x400 + ((row >> 3) & 7) * 0x80 + (row >> 6) * 0x28;
    for (let b = 0; b < 40; b++) {
      const v = page[base + b];
      for (let i = 0; i < 7; i++) if (v & (1 << i)) out.push({ row, bit: b * 7 + i, byte: b, inByte: i, hi: !!(v & 0x80) });
    }
  }
  return out;
}

/** The address of a hires row within a page, which the engine's own tables also encode. */
export const rowAddr = (r) => (r & 7) * 0x400 + (((r >> 3) & 7) * 0x80) + ((r >> 6) * 0x28);
