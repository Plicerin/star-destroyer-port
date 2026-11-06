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
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';

export const LIST = 0x80FB;        // where $6090 points the list pointer, hard-coded
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
 *
 * It then waits for the game binary to be entirely resident, which a fixed sleep does not
 * guarantee - see settleBinary.
 */
export async function toFlight(a2, { difficulty = 1, settleMs = 20000, fill = 0x00,
  settleCode = true } = {}) {
  await a2.coldStart({ fill });
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
  const resident = settleCode ? await settleBinary(a2) : null;
  return { difficulty: chosen, resident };
}

/** The game binary, which `SD PART2` BRUNs over $08EF-$1FF0. */
export const OBJ0 = 'STAR DESTROYER.OBJ0';

/**
 * The binary's own variables, which live inside its code image and so stop matching the
 * file the moment the game runs. Measured: over a minute of flight these two windows are
 * the only addresses in $08EF-$1FF0 that ever differ from the file.
 */
export const OBJ0_VARIABLES = [[0x0933, 0x0956], [0x1D4A, 0x1D51]];

/**
 * Wait until `STAR DESTROYER.OBJ0` is entirely resident, and say how long that took.
 *
 * Needed because the settle above is a sleep, and a sleep is not the condition anyone
 * wants. Measured: with a twenty-second settle, toFlight could return with the last 2,023
 * bytes of the binary - everything from $17EB up - still holding the power-on fill, because
 * DOS had not reached those sectors. The subroutines at $1AE8, $1C3D, $1D09 and $1F67 all
 * live in that window, so a probe that read them during it would be reading nothing at all;
 * the write that finally fixes $1C3D comes from $B8D6, which is DOS's own RWTS.
 *
 * It throws rather than giving up quietly, and it names the addresses that would not settle,
 * because a wait that times out and carries on is how a probe comes to measure the fill.
 */
export async function settleBinary(a2, { tries = 60, waitMs = 500, file = OBJ0,
  variables = OBJ0_VARIABLES } = {}) {
  const disk = openDisk(DISK);
  const f = disk.read(disk.files.find((x) => x.name === file));
  const variable = (a) => variables.some(([lo, hi]) => a >= lo && a <= hi);
  let differing = [];
  for (let i = 0; i < tries; i++) {
    const live = JSON.parse(await a2.ev(
      `JSON.stringify(window.M.range(${f.addr}, ${f.addr + f.len}))`));
    differing = [];
    for (let k = 0; k < f.len; k++) {
      if (live[k] !== f.data[k] && !variable(f.addr + k)) differing.push(f.addr + k);
    }
    if (!differing.length) return { seconds: (i * waitMs) / 1000 };
    await a2.waitMs(waitMs);
  }
  throw new Error(`${file} never settled: ${differing.length} bytes still differ from the file,`
    + ` first at $${differing[0].toString(16)}`);
}

/** `SD PART3` BRUNs this over the same $08EF-$1FF0 the main mission used. */
export const FINALE = 'BASE STAR.OBJ0';

/**
 * Drive the disk all the way to the final mission, by playing the chain rather than faking it.
 *
 * The obvious shortcut - side-load `SV DATA2`, `BASE STAR DATA` and the binary and jump to
 * `$0957` - is what the first pass at this did, and it does not work. `SD START2` pokes a
 * dozen addresses on its way past, two of which (`$814B`, object 3's count, and the wave
 * counters) are read by the finale's own "is the field empty" test. Side-loaded, they are
 * zero, the mission thinks it has already been won, `$112A` increments `$1FFF` on the first
 * pass and the whole thing is over in 140 of its 1,369 addresses.
 *
 * So this walks the real route. Reaching the finale honestly means finishing a flight, and
 * the exit that leads there is `SD PART2` line 175 - flights flown at or past the target -
 * which is only tested when line 172's wave test has already passed. So the nine bytes that
 * `$18DD` reads go to zero and the flight counter goes to the target, and the machine does
 * the rest: `HYPERDRIVE 3`, `STARBASE`, `HYPERDRIVE 4`, `SD START2`, `SD PART3`. Nothing on
 * that route waits for a key.
 */
/**
 * `SD START2`'s setup, read off the disk rather than transcribed.
 *
 * It is the one program in the chain that is pure setup: four BLOADs and a run of POKEs, no
 * input, no animation, no branch that depends on anything. So its effect can be reproduced
 * exactly, and reproducing it is the difference between starting the finale's binary and
 * starting the finale.
 *
 * Variables are resolved from the program's own `NAME = number` assignments, so a POKE
 * written `POKE XI + 1,253` resolves through line 3's `XI = 33046`. The one pair it cannot
 * read literally is line 129's `POKE 33344,LO% : POKE 33345,HI%`, which lines 10-13 compute
 * from `BV% = 5000`: `HI%` is an integer variable so `5000/256` truncates to 19, and `LO%`
 * is `5000 - 19*256`.
 */
export function sdStart2Setup(disk) {
  const f = disk.files.find((x) => x.name === 'SD START2');
  const raw = disk.read(f);
  const mem = new Uint8Array(0x10000);
  for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
  const lines = listProgram(mem, 0x801);

  const vars = new Map();
  for (const l of lines) {
    for (const m of l.text.matchAll(/([A-Z][A-Z0-9]?)\s*=\s*(-?\s*\d+)(?!\s*\d)/g)) {
      if (!vars.has(m[1])) vars.set(m[1], Number(m[2].replace(/\s/g, '')));
    }
  }
  const BV = 5000;
  const HI = Math.trunc(BV / 256);
  vars.set('LO%', BV - HI * 256);
  vars.set('HI%', HI);

  const resolve = (t) => {
    const s = t.replace(/\s/g, '');
    if (/^-?\d+$/.test(s)) return Number(s);
    const m = s.match(/^([A-Z][A-Z0-9]?%?)(?:\+(\d+))?$/);
    if (m && vars.has(m[1])) return vars.get(m[1]) + (m[2] ? Number(m[2]) : 0);
    return null;
  };

  const pokes = [];
  const unresolved = [];
  for (const l of lines) {
    for (const m of l.text.matchAll(/POKE\s*([^,]+?)\s*,\s*([A-Z0-9%+\-\s]+?)(?=\s*(?::|$))/g)) {
      const addr = resolve(m[1]);
      const value = resolve(m[2]);
      if (addr === null || value === null) { unresolved.push(`${l.num}: ${m[0]}`); continue; }
      pokes.push({ line: l.num, addr: addr < 0 ? addr + 0x10000 : addr, value: value & 0xff });
    }
  }
  // Line 2's four BLOADs, with the two address overrides the line carries.
  const loads = [
    { file: 'A2-3D2', at: 0x6000 }, { file: 'SV DATA2', at: null },
    { file: 'BASE STAR DATA', at: null }, { file: 'HEADING DATA', at: 35275 },
  ];
  return { pokes, loads, unresolved, vars };
}

/**
 * Put the machine into the final mission, with the state `SD START2` and `SD PART3` leave.
 *
 * **Why not just play the chain.** The honest route is to finish a flight and let `SD PART2`
 * line 175 send it to `HYPERDRIVE 3`, `STARBASE`, `HYPERDRIVE 4`, `SD START2`, `SD PART3`.
 * That was tried first and it gets as far as `STARBASE`, where it stops: A2-3D2 enters a tight
 * loop around `$664A` during the docking scene and never leaves it, through six emulated
 * minutes against the thirty-five renders the program asks for. That is recorded as an open
 * question of its own; it is not the finale's problem and the finale should not wait for it.
 *
 * **What this does instead.** `SD START2` is the one program on that route which is pure
 * setup - four BLOADs and seventeen POKEs, no input, no animation, no branch that depends on
 * anything - so its effect can be reproduced exactly, and `sdStart2Setup` reads it off the
 * disk rather than trusting a transcription. Then `SD PART3` lines 164 and 170, which are two
 * BRUNs and nothing else.
 *
 * The difference from side-loading the files and jumping in, which is what the first pass at
 * this did, is those seventeen POKEs. Two of them are `$814B` (object 3's count) and the wave
 * counters, which the finale's own "is the field empty" test reads: left at zero the mission
 * believes it has already been won, `$112A` increments `$1FFF` on the first pass, and it is
 * over before it starts.
 *
 * `toFlight` first, because it is what gets DOS up and the machine warm; the loads below then
 * replace the main mission's files exactly as `SD START2` replaces them.
 */
export async function toFinale(a2, { difficulty = 1 } = {}) {
  const flight = await toFlight(a2, { difficulty });
  const disk = openDisk(DISK);
  const setup = sdStart2Setup(disk);
  if (setup.unresolved.length) {
    throw new Error(`SD START2 has POKEs this cannot resolve: ${setup.unresolved.join('; ')}`);
  }

  // The order is the chain's own, and it matters: SD START2's four BLOADs, then its POKEs,
  // and only then SD PART3's two BRUNs. Four of the POKEs are to $1FF7-$1FFF, which the last
  // BRUN's overshoot lands on, so applying them afterwards would keep bytes the machine
  // throws away. Written from the sector chain with the header stripped and the slack kept,
  // which is what DOS puts there - see game/dos.js.
  const image = ({ file, at }) => {
    const f = disk.read(disk.files.find((x) => x.name === file));
    return { name: file, addr: at ?? f.addr, raw: [...f.raw] };
  };
  const first = setup.loads.map(image);                                  // SD START2 line 2
  const then = [{ file: 'PART1.OBJ0', at: null }, { file: FINALE, at: null }].map(image);

  await a2.ev(`(() => {
    const wr = window.M.wr;
    const put = (set) => { for (const f of set) {
      for (let i = 4; i < f.raw.length; i++) wr(f.addr - 4 + i, f.raw[i]);
    } };
    put(${JSON.stringify(first)});
    for (const p of ${JSON.stringify(setup.pokes)}) wr(p.addr, p.value); // lines 4 to 155
    put(${JSON.stringify(then)});                                        // SD PART3 164, 170
    return 1;
  })()`);

  return { difficulty: flight.difficulty, setup, entry: FINALE_ENTRY };
}

/** `$0957` - where `BASE STAR.OBJ0` is entered, the same address the main mission uses. */
export const FINALE_ENTRY = 0x0957;

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
                                 watch = [], at = ${LIST}, spill = 0x9000, spillMax = 0x1800 } = {}) => {
      // A list longer than SV DATA goes somewhere with room, reached by a three-byte
      // opcode 11 - the engine's own JUMP - written where $6090 points. $9000 is clear:
      // HEADING DATA ends at $8BD3 and MATH starts at $98F3.
      if (bytes.length > ${LIST_LEN}) {
        if (bytes.length > spillMax) return { error: 'list longer than the spill area' };
        for (let i = 0; i < bytes.length; i++) wr(spill + i, bytes[i]);
        wr(at, 11); wr(at + 1, spill & 0xff); wr(at + 2, (spill >> 8) & 0xff);
      } else {
        for (let i = 0; i < bytes.length; i++) wr(at + i, bytes[i]);
      }
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

/**
 * Call one subroutine inside the engine, with zero page and the registers set.
 *
 * The same trick as runList - push a return address of $FFFE, set the PC, step until the
 * PC reaches $FFFF - but aimed at a single routine rather than the whole renderer. It is
 * how a routine whose arithmetic is not obvious from reading it can simply be tabulated:
 * put the inputs in, take the outputs out, and the function is whatever the table says.
 */
export async function callSub(a2, addr, { zp = {}, a = 0, x = 0, y = 0, read = [], budget = 2000000 } = {}) {
  return JSON.parse(await a2.ev(`JSON.stringify((() => {
    const cpu = window.M.cpu, wr = window.M.wr, rd = window.M.rd;
    const before = cpu.getState();
    const zp = ${JSON.stringify(zp)};
    for (const k of Object.keys(zp)) wr(Number(k), zp[k] & 0xff);
    const st = cpu.getState();
    wr(0x100 + st.sp, 0xFF); st.sp = (st.sp - 1) & 0xff;
    wr(0x100 + st.sp, 0xFE); st.sp = (st.sp - 1) & 0xff;
    st.pc = ${addr}; st.a = ${a} & 0xff; st.x = ${x} & 0xff; st.y = ${y} & 0xff;
    cpu.setState(st);
    let returned = false;
    cpu.stepCyclesDebug(${budget}, () => { if (cpu.getPC() === ${SENTINEL}) { returned = true; return true; } });
    const end = cpu.getState();
    const out = { returned, a: end.a, x: end.x, y: end.y,
      zp: ${JSON.stringify(read)}.map((addr) => rd(addr)) };
    cpu.setState(before);
    return out;
  })())`));
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
