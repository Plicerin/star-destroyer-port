// Everything Applesoft needs that is not Applesoft.
//
// `../game/applesoft.js` interprets the tokens and knows nothing about a screen, a disk or a
// keyboard. This is the other half: POKE and PEEK into the 64K image, the soft switches, the
// text cursor, the DOS commands, the keyboard, and the CALLs.
//
// **Unimplemented CALLs are recorded, not ignored and not fatal.** Three of the seven CALL
// targets on this disk are the port's own code and four are ROM or DOS routines that are not
// on the disk and so are not something this repository can measure. Halting the chain on one
// would make the game unreachable; pretending it ran would be the silent-failure this project
// keeps away from. So they go on a list the shell can show, and the chain continues.
import { Display } from './display.js';
import { paintText, clear as clearText, encode, COLS, ROWS, rowOffset } from './text.js';
import { bload } from '../game/dos.js';
import { IFACE } from '../game/chain.js';
import { Unsupported } from '../game/applesoft.js';
import { parseTable, drawShape } from './shapes.js';

/** $C000 is the keyboard latch and $C010 clears its strobe. */
export const KEYBOARD = 0xC000, STROBE = 0xC010;

/** $1FF3-$1FFF, the thirteen the BASIC and the binary share, in address order. */
const IFACE_BYTES = [IFACE.lastFlight, IFACE.bonus, IFACE.flights, IFACE.difficulty,
  IFACE.finale, IFACE.target, ...IFACE.waves, ...IFACE.kills, IFACE.baseStar]
  .sort((a, b) => a - b);

/** Applesoft's HCOLOR, as masks. The same five colours A2-3D2 has, named Applesoft's way. */
const HCOLORS = [
  { bits: 0x00, palette: 0 },   // 0 black
  { bits: 0x2A, palette: 0 },   // 1 green
  { bits: 0x55, palette: 0 },   // 2 violet
  { bits: 0x7F, palette: 0 },   // 3 white
  { bits: 0x00, palette: 1 },   // 4 black
  { bits: 0x55, palette: 1 },   // 5 orange
  { bits: 0x2A, palette: 1 },   // 6 blue
  { bits: 0x7F, palette: 1 },   // 7 white
];

export class Host {
  /**
   * @param {Uint8Array} mem the 64K image
   * @param {object} disk an openDisk() result
   * @param {object} [opts] `rnd`, and `call` for a map of address to handler
   */
  constructor(mem, disk, { rnd = Math.random, calls = {}, corruptInterface = false } = {}) {
    /** True skips the interface repair above, which only a harness has a use for. */
    this.corruptInterface = corruptInterface;
    this.mem = mem;
    this.disk = disk;
    this.display = new Display();
    this.rndSource = rnd;
    this.calls = calls;
    this.cursor = { row: 0, col: 0 };
    this.style = 'normal';
    this.colourIndex = 3;
    this.lastPlot = null;
    /** Set by `dos` when a RUN is seen; the driver picks it up. */
    this.chainTo = null;
    /** CALLs this host has no implementation for, with how many times each was reached. */
    this.unimplemented = new Map();
    /** A key the shell has supplied and the program has not read yet. */
    this.keyLatch = 0;
    /**
      * The open text file, and the contents of any file the game has written.
      *
      * `INITIALS` is the only program that opens one, and it reads ten records from
      * `INITIALS.DAT` and writes seven back. **Writes stay here**: the port does not modify
      * the disk image, because the image is the thing every measurement in this repository
      * is made against and a port that edits its own evidence is not one. A shell that wants
      * high scores to persist can take `files` and keep it wherever it likes.
      */
    this.file = null;
    this.files = new Map();
    /** Everything printed that was not a DOS command, newest last. */
    this.log = [];
  }

  // ---------------------------------------------------------------- memory ----------------
  poke(addr, value) {
    if (Display.isSwitch(addr)) { this.display.touch(addr); return; }
    if (addr === STROBE) { this.keyLatch &= 0x7F; return; }
    this.mem[addr] = value & 0xFF;
  }

  peek(addr) {
    if (Display.isSwitch(addr)) { this.display.touch(addr); return 0; }
    if (addr === KEYBOARD) return this.keyLatch;
    return this.mem[addr];
  }

  /** The shell calls this when the player presses something. */
  pressKey(ch) {
    const c = typeof ch === 'number' ? ch : ch.toUpperCase().charCodeAt(0);
    this.keyLatch = (c & 0x7F) | 0x80;
  }

  // ---------------------------------------------------------------- text ------------------
  /**
   * Where PRINT writes.
   *
   * **Not** `display.textBase`. The page soft switch chooses which page the video shows, and
   * the screen driver writes where its own window base says - page 1 unless something moves
   * it. Following the switch instead put PRINT at `$800` the moment the game selected hi-res
   * page 2, which is where Applesoft keeps the running program.
   */
  get writeBase() { return 0x400; }

  home() {
    clearText(this.mem, this.writeBase, 'normal');
    this.cursor = { row: 0, col: 0 };
  }

  textMode() { this.display.touch(0xC051); }
  setTextStyle(style) { this.style = style; }
  vtab(n) { this.cursor.row = Math.min(ROWS - 1, Math.max(0, Math.trunc(n) - 1)); }
  htab(n) { this.cursor.col = Math.min(COLS - 1, Math.max(0, Math.trunc(n) - 1)); }
  pos() { return this.cursor.col; }

  print(text, newline) {
    // A PRINT while a file is open for writing goes to the file, not the screen - which is
    // how INITIALS saves the high-score table.
    if (this.file && this.file.mode === 'write') {
      this.file.out.push(text);
      this.files.set(this.file.name, [...(this.files.get(this.file.name) ?? []),
        ...text.split(String.fromCharCode(10))].filter((x) => x !== ''));
      return;
    }
    if (text) this.log.push(text);
    if (this.log.length > 40) this.log.shift();
    const base = this.writeBase;
    for (const ch of text) {
      if (ch === '\n') { this.newline(); continue; }
      if (ch === '\r') { this.cursor.col = 0; continue; }
      if (ch.charCodeAt(0) < 0x20) continue;            // control codes, DOS's included
      this.mem[base + rowOffset(this.cursor.row) + this.cursor.col] = encode(ch, this.style);
      this.cursor.col++;
      if (this.cursor.col >= COLS) this.newline();
    }
    if (newline) this.newline();
  }

  newline() {
    this.cursor.col = 0;
    this.cursor.row++;
    if (this.cursor.row >= ROWS) {
      // Scroll, the way the screen driver does.
      const base = this.writeBase;
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS; c++) {
          this.mem[base + rowOffset(r) + c] = this.mem[base + rowOffset(r + 1) + c];
        }
      }
      for (let c = 0; c < COLS; c++) {
        this.mem[base + rowOffset(ROWS - 1) + c] = encode(' ', 'normal');
      }
      this.cursor.row = ROWS - 1;
    }
  }

  // ---------------------------------------------------------------- hi-res ----------------
  /** Applesoft's own HPLOT, which is not A2-3D2's plotting. */
  hplot(x, y) {
    this.plot(Math.trunc(x), Math.trunc(y));
    this.lastPlot = [Math.trunc(x), Math.trunc(y)];
  }

  hplotTo(x, y) {
    const to = [Math.trunc(x), Math.trunc(y)];
    if (this.lastPlot) this.line(this.lastPlot, to);
    else this.plot(to[0], to[1]);
    this.lastPlot = to;
  }

  plot(x, y) {
    if (x < 0 || x > 279 || y < 0 || y > 191) return;
    const base = this.display.hiresBase;
    const addr = base + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28
      + Math.floor(x / 7);
    const c = HCOLORS[this.colourIndex & 7];
    const bit = 1 << (x % 7);
    const on = (c.bits >> (x % 7)) & 1;
    let v = this.mem[addr];
    v = on ? (v | bit) : (v & ~bit);
    v = c.palette ? (v | 0x80) : (v & 0x7F);
    this.mem[addr] = v & 0xFF;
  }

  line([x0, y0], [x1, y1]) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let guard = 0; guard < 2000; guard++) {
      this.plot(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  hgr(which) {
    const base = which === 2 ? 0x4000 : 0x2000;
    this.mem.fill(0, base, base + 0x2000);
    this.display.touch(0xC050);
    this.display.touch(0xC057);
    this.display.touch(which === 2 ? 0xC055 : 0xC054);
    this.display.touch(which === 2 ? 0xC052 : 0xC053);
    this.lastPlot = null;
  }

  /** HCOLOR= . Applesoft's eight, of which five are distinct - see HCOLORS above. */
  hcolor(n) { this.colourIndex = Math.trunc(n) & 7; }

  color() { /* lo-res, which this disk sets but never draws with */ }
  hlin() { /* likewise */ }
  rot(n) { this.rotation = Math.trunc(n); }
  scale(n) { this.scaling = Math.max(1, Math.trunc(n)); }

  /**
   * DRAW and XDRAW.
   *
   * The shape-table pointer is `$E8`/`$E9`, which the three programs that draw set with
   * `POKE 232,251: POKE 233,26` - so the table is wherever those two bytes say, and this
   * reads them rather than being told where it is. XDRAW inverts instead of plotting, which
   * is how INITIALS erases its cursor and why drawing the same shape twice leaves no trace.
   */
  draw(shape, at, xor) {
    const base = this.mem[0xE8] | (this.mem[0xE9] << 8);
    if (!base) { this.note('DRAW', 'no shape table pointer at $E8/$E9'); return; }
    const table = parseTable(this.mem, base);
    if (!table.count) {
      this.note('DRAW', 'the table the pointer names is empty');
      return;
    }
    const [x, y] = at ?? this.lastPlot ?? [0, 0];
    try {
      drawShape(this.shapePlotter(), this.mem, table, Math.trunc(shape), x, y,
        { scale: this.scaling ?? 1, rot: this.rotation ?? 0, xor });
    } catch (e) {
      this.note('DRAW', e.message);
      return;
    }
    this.lastPlot = [x, y];
  }

  /** What `drawShape` draws through: the same plot as HPLOT, plus an XOR for XDRAW. */
  shapePlotter() {
    return {
      plot: (x, y) => this.plot(x, y),
      invert: (x, y) => {
        if (x < 0 || x > 279 || y < 0 || y > 191) return;
        const addr = this.display.hiresBase + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80
          + (y >> 6) * 0x28 + Math.floor(x / 7);
        this.mem[addr] ^= 1 << (x % 7);
      },
    };
  }

  // ---------------------------------------------------------------- the rest --------------
  rnd() { return this.rndSource(); }
  pdl() { return 127; }
  scrn() { return 0; }

  /**
   * Open a DOS text file.
   *
   * A text file is carriage-return delimited, and a `READ` followed by `INPUT` takes one
   * field per INPUT. If the game has written the file already this session, that is what it
   * reads back; otherwise it comes off the disk.
   */
  openFile(name) {
    if (this.files.has(name)) {
      this.file = { name, fields: [...this.files.get(name)], pos: 0, mode: null, out: [] };
      return;
    }
    let fields = [];
    try {
      const f = this.disk.file(name);
      fields = Array.from(f.data, (b) => String.fromCharCode(b & 0x7F))
        .join('').split(String.fromCharCode(13));
    } catch (e) {
      this.note(name, 'not on the disk, so it opens empty');
    }
    this.file = { name, fields, pos: 0, mode: null, out: [] };
  }

  /** INPUT: from the open file if one is being read, otherwise from whoever is watching. */
  input() {
    if (this.file && this.file.mode === 'read') {
      const v = this.file.fields[this.file.pos++];
      return v === undefined ? '' : v;
    }
    return this.pendingInput ?? '';
  }

  note(what, why) {
    const k = `${what}: ${why}`;
    this.unimplemented.set(k, (this.unimplemented.get(k) ?? 0) + 1);
  }

  call(addr) {
    const fn = this.calls[addr];
    if (fn) return fn(this) ?? null;
    this.note(`CALL $${addr.toString(16).toUpperCase()}`,
      addr >= 0xF800 ? 'a monitor ROM routine, which is not on the disk'
        : addr >= 0xD000 ? 'an Applesoft ROM routine, which is not on the disk'
          : addr >= 0x9600 ? 'a DOS routine, which is not on the disk'
            : 'not implemented');
    return null;
  }

  /**
   * A DOS command, as PRINTed with a leading Ctrl-D.
   *
   * The verb runs straight into the filename on this disk - `RUNSELECT`, `BLOADPART2` -
   * because DOS parses a keyword prefix rather than a word.
   */
  dos(command) {
    const m = command.match(
      /^(BLOAD|BRUN|BSAVE|RUN|LOAD|SAVE|OPEN|CLOSE|WRITE|READ|DELETE|APPEND|CATALOG)\s*(.*)$/i);
    if (!m) throw new Unsupported(`the DOS command "${command}"`);
    const verb = m[1].toUpperCase();
    const rest = m[2].trim();
    const [nameRaw, ...opts] = rest.split(',');
    const name = nameRaw.trim();

    if (verb === 'RUN') { this.chainTo = name; return { chain: name }; }
    if (verb === 'BLOAD' || verb === 'BRUN') {
      let at = null;
      for (const o of opts) {
        const a = o.trim().match(/^A\s*(\$?)([-0-9A-F]+)$/i);
        if (a) at = a[1] ? parseInt(a[2], 16) : parseInt(a[2], 10);
      }
      if (at !== null && at < 0) at += 0x10000;
      const f = this.loadFile(name);
      if (!f) return null;
      // **The interface repair, on the chain's side.** `STAR DESTROYER.OBJ0` ends at `$1FF0`
      // and DOS reads a file's last sector whole, so BRUNning it writes 250 bytes of that
      // sector's slack over `$1FF3`-`$1FFF` - the thirteen bytes the BASIC and the binary talk
      // through, which the BASIC has just finished poking. `platform/boot.js` has repaired
      // this since the flight shell was written; the chain, which runs the real DOS commands
      // through this host, did not - so a game played through the chain read a target of 217
      // flights and a flight counter already at 32, and could never be finished.
      //
      // Measured: both games of a two-game walk had their first flight numbered 33, which is
      // the slack's 32 plus `$09A0 INC $1FF5`.
      //
      // The load itself stays exact - `dos.js` still overshoots and `parity_overshoot.mjs`
      // still holds it - and only those thirteen bytes are put back. On a dump whose slack is
      // zeros this is a no-op. `corruptInterface` gets the disk's own behaviour back.
      const keep = this.corruptInterface ? null : IFACE_BYTES.map((a) => this.mem[a]);
      bload(this.mem, f, { at });
      if (keep) IFACE_BYTES.forEach((a, i) => { this.mem[a] = keep[i]; });
      if (verb === 'BRUN') return { run: f.addr, name };
      return null;
    }
    if (verb === 'OPEN') { this.openFile(name); return null; }
    if (verb === 'CLOSE') { this.file = null; return null; }
    if (verb === 'READ') {
      if (this.file) this.file.mode = 'read';
      return null;
    }
    if (verb === 'WRITE') {
      if (this.file) { this.file.mode = 'write'; }
      return null;
    }
    this.note(`the DOS command ${verb}`, 'not implemented');
    return null;
  }

  /**
   * A file from the disk, or null if it is not there.
   *
   * **The two title pictures are deliberately absent.** `SD.PIC1` and `SD.PIC2` exist on the
   * copy this was built from, but what they hold is not Robbins's opening art. The decision
   * for this port is that the opening is a *missing asset* rather than a removed feature:
   * `START` still asks for two pictures and the port declines to supply them, so a copy that
   * still carries them restores the opening with no change to any code. Standing anyone
   * else's art where the author's belongs would be worse than showing nothing.
   */
  loadFile(name) {
    if (MISSING.has(name)) {
      this.note(`${name}`, 'deliberately absent - the original title art has not survived on'
        + ' this copy, so the port treats it as a missing asset');
      return null;
    }
    try {
      return this.disk.file(name);
    } catch (e) {
      this.note(`${name}`, 'not on the disk');
      return null;
    }
  }

  /** Paint whatever the soft switches say is on screen. */
  paint(out, { hiresPaint, tint = 'colour', flashOn = true } = {}) {
    const s = this.display.state;
    if (!s.text) {
      const page = this.mem.subarray(this.display.hiresBase, this.display.hiresBase + 0x2000);
      hiresPaint(page, out, { tint });
    }
    if (s.textRows > 0) {
      paintText(this.mem, out, {
        base: this.writeBase,
        fromRow: s.text ? 0 : ROWS - s.textRows,
        toRow: ROWS,
        flashOn,
      });
    }
    return out;
  }
}

/** Files the port will not load, and why. See `loadFile`. */
export const MISSING = new Set(['SD.PIC1', 'SD.PIC2']);
