// Applesoft BASIC, enough of it to run this disk.
//
// The presentation is twelve Applesoft programs and 380 lines between them. They could be
// transliterated one by one, the way the flight loop was, but there is a better option here
// that was not available there: **run the programs themselves**. The flight loop is 6502 and
// had to be reimplemented; these are source, they are on the disk, and an interpreter cannot
// drift from them the way twelve hand-translations would.
//
// So this reads the tokenised program out of a memory image exactly where Applesoft keeps it -
// a linked list from `$801`, each line a 2-byte pointer to the next, a 2-byte line number, the
// tokens, and a zero - and executes it. Nothing is detokenised to text and re-parsed; the
// tokens are the program.
//
// **It is a subset and it says so.** Anything this disk does not use throws rather than being
// quietly skipped, because a presentation screen that silently does nothing is worse than one
// that stops with a reason. `oracle/probe_applesoft.mjs` walks all twelve programs and checks
// that every token in them is one of the implemented ones, so the subset is measured against
// the disk rather than guessed at.
//
// The side effects all go through a host object - POKE and PEEK, CALL, the DOS commands that
// PRINT emits, the text screen, the keyboard, the shape table. Nothing here knows what a
// canvas is.

/** Tokens $80-$EA, in order. Duplicated from the disk's own layout, not from the oracle. */
export const TOKENS = ('END,FOR,NEXT,DATA,INPUT,DEL,DIM,READ,GR,TEXT,PR#,IN#,CALL,PLOT,HLIN,'
  + 'VLIN,HGR2,HGR,HCOLOR=,HPLOT,DRAW,XDRAW,HTAB,HOME,ROT=,SCALE=,SHLOAD,TRACE,NOTRACE,'
  + 'NORMAL,INVERSE,FLASH,COLOR=,POP,VTAB,HIMEM:,LOMEM:,ONERR,RESUME,RECALL,STORE,SPEED=,'
  + 'LET,GOTO,RUN,IF,RESTORE,&,GOSUB,RETURN,REM,STOP,ON,WAIT,LOAD,SAVE,DEF,POKE,PRINT,CONT,'
  + 'LIST,CLEAR,GET,NEW,TAB(,TO,FN,SPC(,THEN,AT,NOT,STEP,+,-,*,/,^,AND,OR,>,=,<,SGN,INT,ABS,'
  + 'USR,FRE,SCRN(,PDL,POS,SQR,RND,LOG,EXP,COS,SIN,TAN,ATN,PEEK,LEN,STR$,VAL,ASC,CHR$,LEFT$,'
  + 'RIGHT$,MID$').split(',');

/** By name, for readability below. */
const T = {};
TOKENS.forEach((name, i) => { T[name] = 0x80 + i; });

/**
 * The program as a list of lines, read where Applesoft keeps it.
 *
 * @param {Uint8Array} mem a 64K image with the program loaded
 * @param {number} [start] TXTTAB, $801 unless something moved it
 * @returns {{num: number, bytes: number[]}[]}
 */
export function parseProgram(mem, start = 0x801) {
  const lines = [];
  let p = start;
  const seen = new Set();
  for (;;) {
    const next = mem[p] | (mem[p + 1] << 8);
    if (next === 0 || seen.has(p)) break;
    seen.add(p);
    const num = mem[p + 2] | (mem[p + 3] << 8);
    const bytes = [];
    let q = p + 4;
    while (q < 0xC000 && mem[q] !== 0) bytes.push(mem[q++]);
    lines.push({ num, bytes });
    p = next;
    if (p < start || p >= 0xC000) break;
  }
  return lines;
}

/** Applesoft keeps two characters of a name, plus the type sigil. */
function varKey(name, sigil) {
  return name.slice(0, 2) + sigil;
}

/** Thrown for anything the subset does not cover, so a gap is loud. */
export class Unsupported extends Error {
  constructor(what, line) {
    super(`Applesoft: ${what}${line === undefined ? '' : ` (line ${line})`}`);
    this.what = what;
    this.line = line;
  }
}

/** What a statement did, when it is something the caller has to act on. */
export const YIELD = {
  none: 0,
  /** A DOS `RUN`: the host chains to another program. */
  chain: 1,
  /** `GET`: the host must supply a key before the next step. */
  key: 2,
  /** `END` or falling off the last line. */
  end: 3,
  /** A `CALL` the host runs asynchronously - music, an animation. */
  call: 4,
};

export class Applesoft {
  /**
   * @param {Uint8Array} mem the 64K image. POKE and PEEK go straight into it.
   * @param {object} host the side effects - see the methods called on `this.host` below
   */
  constructor(mem, host) {
    this.mem = mem;
    this.host = host;
    this.lines = [];
    this.index = new Map();
    this.vars = new Map();
    this.arrays = new Map();
    this.stack = [];                  // GOSUB return points and FOR frames
    this.dataPtr = { line: 0, item: 0 };
    this.pc = { line: 0, at: 0 };
    this.done = false;
    this.pendingKeyVar = null;
    /** Everything PRINTed that was not a DOS command, for a host that wants to see it. */
    this.output = '';
  }

  /** Load a tokenised program and start at its first line. */
  load(programMem, start = 0x801) {
    this.lines = parseProgram(programMem, start);
    this.index = new Map(this.lines.map((l, i) => [l.num, i]));
    this.pc = { line: 0, at: 0 };
    this.done = this.lines.length === 0;
    this.dataPtr = { line: 0, item: 0 };
    return this;
  }

  // ---------------------------------------------------------------- the cursor -------------
  get line() { return this.lines[this.pc.line]; }
  peekByte() { return this.line ? this.line.bytes[this.pc.at] : undefined; }
  nextByte() { return this.line.bytes[this.pc.at++]; }
  atEnd() { return !this.line || this.pc.at >= this.line.bytes.length; }

  skipSpaces() {
    while (!this.atEnd() && this.line.bytes[this.pc.at] === 0x20) this.pc.at++;
  }

  /** Move to the next line, or finish. */
  nextLine() {
    this.pc = { line: this.pc.line + 1, at: 0 };
    if (this.pc.line >= this.lines.length) this.done = true;
  }

  goto(num) {
    const i = this.index.get(num);
    if (i === undefined) throw new Unsupported(`GOTO ${num}, which is not a line`, this.lineNo);
    this.pc = { line: i, at: 0 };
  }

  get lineNo() { return this.line ? this.line.num : -1; }

  // ---------------------------------------------------------------- running ----------------
  /**
   * One statement.
   *
   * Statement at a time rather than line at a time, so the host can stop on a `GET`, on a
   * `CALL` that animates, or on a DOS `RUN`, without the interpreter needing to know why.
   *
   * @returns {{yield: number, [key: string]: any}}
   */
  step() {
    if (this.done) return { yield: YIELD.end };
    this.skipSpaces();
    while (this.atEnd()) {
      this.nextLine();
      if (this.done) return { yield: YIELD.end };
      this.skipSpaces();
    }
    const b = this.peekByte();
    // A statement separator left over from the one before.
    if (b === 0x3A) { this.pc.at++; return { yield: YIELD.none }; }
    return this.statement();
  }

  /** Run until something needs the host, or the program ends. */
  run({ maxSteps = 2000000 } = {}) {
    for (let i = 0; i < maxSteps; i++) {
      const r = this.step();
      if (r.yield !== YIELD.none) return r;
    }
    throw new Unsupported('ran for a very long time without stopping', this.lineNo);
  }

  /** Finish a `GET` the host has answered. */
  supplyKey(ch) {
    if (this.pendingKeyVar === null) return;
    const { name, sigil } = this.pendingKeyVar;
    this.setVar(name, sigil, sigil === '$' ? ch : (ch.charCodeAt(0) || 0));
    this.pendingKeyVar = null;
  }

  // ---------------------------------------------------------------- statements -------------
  statement() {
    const b = this.nextByte();
    switch (b) {
      case T.REM: this.pc.at = this.line.bytes.length; return { yield: YIELD.none };
      case T.END: case T.STOP: this.done = true; return { yield: YIELD.end };
      case T.HOME: this.host.home(); return { yield: YIELD.none };
      case T.TEXT: this.host.textMode(); return { yield: YIELD.none };
      case T.NORMAL: this.host.setTextStyle('normal'); return { yield: YIELD.none };
      case T.INVERSE: this.host.setTextStyle('inverse'); return { yield: YIELD.none };
      case T.FLASH: this.host.setTextStyle('flash'); return { yield: YIELD.none };
      case T.HGR: this.host.hgr(1); return { yield: YIELD.none };
      case T.HGR2: this.host.hgr(2); return { yield: YIELD.none };
      case T.RETURN: return this.doReturn();
      case T.RESTORE: this.dataPtr = { line: 0, item: 0 }; return { yield: YIELD.none };
      case T.PRINT: return this.doPrint();
      case T.POKE: return this.doPoke();
      case T.CALL: return this.doCall();
      case T.GOTO: this.goto(this.num()); return { yield: YIELD.none };
      case T.GOSUB: return this.doGosub();
      case T.IF: return this.doIf();
      case T.FOR: return this.doFor();
      case T.NEXT: return this.doNext();
      case T.DATA: this.pc.at = this.line.bytes.length; return { yield: YIELD.none };
      case T.READ: return this.doRead();
      case T.DIM: return this.doDim();
      case T.GET: return this.doGet();
      case T.INPUT: return this.doInput();
      case T.ON: return this.doOn();
      case T['HCOLOR=']: this.host.hcolor(this.num()); return { yield: YIELD.none };
      case T['COLOR=']: this.host.color(this.num()); return { yield: YIELD.none };
      case T['ROT=']: this.host.rot(this.num()); return { yield: YIELD.none };
      case T['SCALE=']: this.host.scale(this.num()); return { yield: YIELD.none };
      case T.HPLOT: return this.doHplot();
      case T.DRAW: return this.doDraw(false);
      case T.XDRAW: return this.doDraw(true);
      case T.HLIN: return this.doHlin();
      case T.VTAB: this.host.vtab(this.num()); return { yield: YIELD.none };
      case T.HTAB: this.host.htab(this.num()); return { yield: YIELD.none };
      case T.LET: return this.doAssign();
      default:
        if (b >= 0x80) {
          throw new Unsupported(`the statement ${TOKENS[b - 0x80]}`, this.lineNo);
        }
        this.pc.at--;
        return this.doAssign();
    }
  }

  doAssign() {
    const { name, sigil } = this.varName();
    let subs = null;
    this.skipSpaces();
    if (this.peekByte() === 0x28) {                 // (
      this.pc.at++;
      subs = [this.num()];
      while (this.peekByte() === 0x2C) { this.pc.at++; subs.push(this.num()); }
      this.expect(0x29);
    }
    this.skipSpaces();
    if (this.nextByte() !== T['=']) {
      throw new Unsupported('an assignment without =', this.lineNo);
    }
    const v = sigil === '$' ? this.str() : this.num();
    if (subs) this.setArray(name, sigil, subs, v);
    else this.setVar(name, sigil, v);
    return { yield: YIELD.none };
  }

  doPoke() {
    const addr = this.num();
    this.expect(0x2C);
    const value = this.num();
    this.host.poke(addr < 0 ? addr + 0x10000 : addr, value & 0xFF);
    return { yield: YIELD.none };
  }

  doCall() {
    const addr = this.num();
    const r = this.host.call(addr < 0 ? addr + 0x10000 : addr);
    return r && r.async ? { yield: YIELD.call, addr, ...r } : { yield: YIELD.none };
  }

  doGosub() {
    const target = this.num();
    this.stack.push({ kind: 'gosub', pc: { ...this.pc } });
    this.goto(target);
    return { yield: YIELD.none };
  }

  doReturn() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === 'gosub') {
        this.pc = { ...this.stack[i].pc };
        this.stack.length = i;
        return { yield: YIELD.none };
      }
    }
    throw new Unsupported('RETURN with nothing to return to', this.lineNo);
  }

  doIf() {
    const cond = this.num();
    this.skipSpaces();
    const b = this.peekByte();
    if (b === T.THEN) this.pc.at++;
    this.skipSpaces();
    if (!cond) { this.pc.at = this.line.bytes.length; return { yield: YIELD.none }; }
    // `THEN 100` is a GOTO; `THEN <statement>` runs it.
    const c = this.peekByte();
    if (c !== undefined && c >= 0x30 && c <= 0x39) {
      this.goto(this.num());
      return { yield: YIELD.none };
    }
    if (c === T.GOTO) { this.pc.at++; this.goto(this.num()); return { yield: YIELD.none }; }
    return { yield: YIELD.none };                   // fall into the rest of the line
  }

  doFor() {
    const { name, sigil } = this.varName();
    this.skipSpaces();
    if (this.nextByte() !== T['=']) throw new Unsupported('FOR without =', this.lineNo);
    const from = this.num();
    if (this.nextByte() !== T.TO) throw new Unsupported('FOR without TO', this.lineNo);
    const to = this.num();
    let step = 1;
    this.skipSpaces();
    if (this.peekByte() === T.STEP) { this.pc.at++; step = this.num(); }
    this.setVar(name, sigil, from);
    this.stack.push({ kind: 'for', name, sigil, to, step, pc: { ...this.pc } });
    return { yield: YIELD.none };
  }

  doNext() {
    this.skipSpaces();
    let name = null;
    if (!this.atEnd() && this.peekByte() !== 0x3A && this.peekByte() < 0x80) {
      name = this.varName().name;
    }
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const f = this.stack[i];
      if (f.kind !== 'for') continue;
      if (name !== null && f.name.slice(0, 2) !== name.slice(0, 2)) continue;
      const v = this.getVar(f.name, f.sigil) + f.step;
      this.setVar(f.name, f.sigil, v);
      const running = f.step > 0 ? v <= f.to : v >= f.to;
      if (running) { this.pc = { ...f.pc }; this.stack.length = i + 1; }
      else this.stack.length = i;
      return { yield: YIELD.none };
    }
    throw new Unsupported('NEXT without FOR', this.lineNo);
  }

  doRead() {
    for (;;) {
      const { name, sigil } = this.varName();
      const v = this.readDatum(sigil);
      this.setVar(name, sigil, v);
      this.skipSpaces();
      if (this.peekByte() !== 0x2C) break;
      this.pc.at++;
    }
    return { yield: YIELD.none };
  }

  /** The next DATA item, walking the program for DATA statements the way Applesoft does. */
  readDatum(sigil) {
    while (this.dataPtr.line < this.lines.length) {
      const line = this.lines[this.dataPtr.line];
      const items = this.dataItems(line);
      if (this.dataPtr.item < items.length) {
        const raw = items[this.dataPtr.item++];
        return sigil === '$' ? raw : Number(raw) || 0;
      }
      this.dataPtr = { line: this.dataPtr.line + 1, item: 0 };
    }
    throw new Unsupported('READ with no DATA left', this.lineNo);
  }

  dataItems(line) {
    if (line._data) return line._data;
    const items = [];
    let i = 0;
    while (i < line.bytes.length) {
      if (line.bytes[i] !== T.DATA) { i++; continue; }
      i++;
      let cur = '';
      for (; i < line.bytes.length; i++) {
        const c = line.bytes[i];
        if (c === 0x3A) break;
        if (c === 0x2C) { items.push(cur.trim()); cur = ''; continue; }
        cur += String.fromCharCode(c & 0x7F);
      }
      items.push(cur.trim());
    }
    line._data = items;
    return items;
  }

  doDim() {
    for (;;) {
      const { name, sigil } = this.varName();
      this.expect(0x28);
      const dims = [this.num()];
      while (this.peekByte() === 0x2C) { this.pc.at++; dims.push(this.num()); }
      this.expect(0x29);
      this.arrays.set(varKey(name, sigil),
        { dims, data: new Map(), fill: sigil === '$' ? '' : 0 });
      this.skipSpaces();
      if (this.peekByte() !== 0x2C) break;
      this.pc.at++;
    }
    return { yield: YIELD.none };
  }

  doGet() {
    const { name, sigil } = this.varName();
    this.pendingKeyVar = { name, sigil };
    return { yield: YIELD.key };
  }

  doInput() {
    // The disk uses INPUT only for the player's initials, and the host supplies it.
    this.skipSpaces();
    if (this.peekByte() === 0x22) this.string();     // a prompt, if there is one
    this.skipSpaces();
    if (this.peekByte() === 0x3B || this.peekByte() === 0x2C) this.pc.at++;
    const { name, sigil } = this.varName();
    const v = this.host.input();
    this.setVar(name, sigil, sigil === '$' ? String(v) : Number(v) || 0);
    return { yield: YIELD.none };
  }

  doOn() {
    const n = Math.trunc(this.num());
    this.skipSpaces();
    const kind = this.nextByte();
    if (kind !== T.GOTO && kind !== T.GOSUB) {
      throw new Unsupported('ON without GOTO or GOSUB', this.lineNo);
    }
    const targets = [this.num()];
    while (this.peekByte() === 0x2C) { this.pc.at++; targets.push(this.num()); }
    if (n < 1 || n > targets.length) return { yield: YIELD.none };
    if (kind === T.GOSUB) this.stack.push({ kind: 'gosub', pc: { ...this.pc } });
    this.goto(targets[n - 1]);
    return { yield: YIELD.none };
  }

  doHplot() {
    this.skipSpaces();
    if (this.peekByte() === T.TO) {
      this.pc.at++;
      const x = this.num(); this.expect(0x2C); const y = this.num();
      this.host.hplotTo(x, y);
      return { yield: YIELD.none };
    }
    let x = this.num(); this.expect(0x2C); let y = this.num();
    this.host.hplot(x, y);
    this.skipSpaces();
    while (this.peekByte() === T.TO) {
      this.pc.at++;
      x = this.num(); this.expect(0x2C); y = this.num();
      this.host.hplotTo(x, y);
      this.skipSpaces();
    }
    return { yield: YIELD.none };
  }

  doDraw(xor) {
    const shape = this.num();
    this.skipSpaces();
    let at = null;
    if (this.peekByte() === T.AT) {
      this.pc.at++;
      const x = this.num(); this.expect(0x2C); const y = this.num();
      at = [x, y];
    }
    this.host.draw(shape, at, xor);
    return { yield: YIELD.none };
  }

  doHlin() {
    const x1 = this.num(); this.expect(0x2C); const x2 = this.num();
    if (this.nextByte() !== T.AT) throw new Unsupported('HLIN without AT', this.lineNo);
    const y = this.num();
    this.host.hlin(x1, x2, y);
    return { yield: YIELD.none };
  }

  doPrint() {
    let out = '';
    let newline = true;
    for (;;) {
      this.skipSpaces();
      if (this.atEnd() || this.peekByte() === 0x3A) break;
      const b = this.peekByte();
      if (b === 0x3B) { this.pc.at++; newline = false; continue; }
      if (b === 0x2C) { this.pc.at++; out += '\t'; newline = true; continue; }
      if (b === T['SPC(']) {
        this.pc.at++;
        const n = this.num();
        this.expect(0x29);
        out += ' '.repeat(Math.max(0, Math.trunc(n)));
        newline = true;
        continue;
      }
      if (b === T['TAB(']) {
        this.pc.at++;
        const n = this.num();
        this.expect(0x29);
        this.host.htab(Math.trunc(n));
        newline = true;
        continue;
      }
      const v = this.value();
      out += typeof v === 'string' ? v : formatNumber(v);
      newline = true;
    }
    this.emit(out, newline);
    return this.afterPrint(out);
  }

  /**
   * A PRINT whose text starts with Ctrl-D is a DOS command, not output.
   *
   * That is the whole of DOS's interface from BASIC: the characters go to the screen driver,
   * DOS watches them, and a line that begins with $04 is taken as a command. Every load,
   * every chain and every file on this disk goes through it.
   */
  afterPrint(text) {
    const cmd = text.replace(/^\n+/, '');
    if (!cmd.startsWith('\u0004')) return { yield: YIELD.none };
    const body = cmd.slice(1).trim();
    const r = this.host.dos(body);
    if (r && r.chain) {
      this.done = true;
      return { yield: YIELD.chain, program: r.chain };
    }
    return { yield: YIELD.none };
  }

  emit(text, newline) {
    this.output += text + (newline ? '\n' : '');
    this.host.print(text, newline);
  }

  expect(ch) {
    this.skipSpaces();
    const b = this.nextByte();
    if (b !== ch) {
      throw new Unsupported(`expected '${String.fromCharCode(ch)}' and found`
        + ` ${b === undefined ? 'the end of the line' : `'${String.fromCharCode(b)}'`}`,
      this.lineNo);
    }
  }

  // ---------------------------------------------------------------- variables -------------
  varName() {
    this.skipSpaces();
    let name = '';
    for (;;) {
      const b = this.peekByte();
      if (b === undefined) break;
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9]/.test(c)) { name += c.toUpperCase(); this.pc.at++; continue; }
      break;
    }
    if (!name) throw new Unsupported('a variable name was expected', this.lineNo);
    let sigil = '';
    const b = this.peekByte();
    if (b === 0x24 || b === 0x25) { sigil = String.fromCharCode(b); this.pc.at++; }
    return { name, sigil };
  }

  getVar(name, sigil) {
    const k = varKey(name, sigil);
    if (this.vars.has(k)) return this.vars.get(k);
    return sigil === '$' ? '' : 0;
  }

  setVar(name, sigil, value) {
    let v = value;
    if (sigil === '%') v = Math.trunc(v);
    this.vars.set(varKey(name, sigil), v);
  }

  array(name, sigil) {
    const k = varKey(name, sigil);
    if (!this.arrays.has(k)) {
      // Applesoft dimensions an undimensioned array to 10 on first use.
      this.arrays.set(k, { dims: [10], data: new Map(), fill: sigil === '$' ? '' : 0 });
    }
    return this.arrays.get(k);
  }

  getArray(name, sigil, subs) {
    const a = this.array(name, sigil);
    const k = subs.map((s) => Math.trunc(s)).join(',');
    return a.data.has(k) ? a.data.get(k) : a.fill;
  }

  setArray(name, sigil, subs, value) {
    const a = this.array(name, sigil);
    a.data.set(subs.map((s) => Math.trunc(s)).join(','), sigil === '%'
      ? Math.trunc(value) : value);
  }

  // ---------------------------------------------------------------- expressions -----------
  /** A numeric expression. */
  num() {
    const v = this.value();
    if (typeof v === 'string') {
      throw new Unsupported('a string where a number was expected', this.lineNo);
    }
    return v;
  }

  /** A string expression. */
  str() {
    const v = this.value();
    return typeof v === 'string' ? v : formatNumber(v);
  }

  /** Full precedence, lowest first. */
  value() { return this.orExpr(); }

  orExpr() {
    let v = this.andExpr();
    for (;;) {
      this.skipSpaces();
      if (this.peekByte() !== T.OR) return v;
      this.pc.at++;
      const r = this.andExpr();
      v = (v || r) ? 1 : 0;
    }
  }

  andExpr() {
    let v = this.compare();
    for (;;) {
      this.skipSpaces();
      if (this.peekByte() !== T.AND) return v;
      this.pc.at++;
      const r = this.compare();
      v = (v && r) ? 1 : 0;
    }
  }

  /**
   * Comparisons, including Applesoft's two-token spellings.
   *
   * `>=` is written `=>` on this disk - `SD PART2` line 175 - and Applesoft accepts the
   * operators in either order, so both have to be taken.
   */
  compare() {
    const left = this.addSub();
    this.skipSpaces();
    const ops = [];
    while ([T['>'], T['<'], T['=']].includes(this.peekByte())) {
      ops.push(this.nextByte());
      this.skipSpaces();
    }
    if (!ops.length) return left;
    const right = this.addSub();
    const gt = ops.includes(T['>']), lt = ops.includes(T['<']), eq = ops.includes(T['=']);
    const a = left, b = right;
    let r;
    if (gt && eq) r = a >= b;
    else if (lt && eq) r = a <= b;
    else if (gt && lt) r = a !== b;
    else if (gt) r = a > b;
    else if (lt) r = a < b;
    else r = a === b;
    return r ? 1 : 0;
  }

  addSub() {
    let v = this.mulDiv();
    for (;;) {
      this.skipSpaces();
      const b = this.peekByte();
      if (b === T['+']) {
        this.pc.at++;
        const r = this.mulDiv();
        v = (typeof v === 'string' || typeof r === 'string')
          ? (typeof v === 'string' ? v : formatNumber(v))
            + (typeof r === 'string' ? r : formatNumber(r))
          : v + r;
      } else if (b === T['-']) { this.pc.at++; v -= this.mulDiv(); } else return v;
    }
  }

  mulDiv() {
    let v = this.power();
    for (;;) {
      this.skipSpaces();
      const b = this.peekByte();
      if (b === T['*']) { this.pc.at++; v *= this.power(); } else if (b === T['/']) {
        this.pc.at++;
        const d = this.power();
        if (d === 0) throw new Unsupported('division by zero', this.lineNo);
        v /= d;
      } else return v;
    }
  }

  power() {
    let v = this.unary();
    this.skipSpaces();
    if (this.peekByte() === T['^']) { this.pc.at++; v **= this.power(); }
    return v;
  }

  unary() {
    this.skipSpaces();
    const b = this.peekByte();
    if (b === T['-']) { this.pc.at++; return -this.unary(); }
    if (b === T['+']) { this.pc.at++; return this.unary(); }
    if (b === T.NOT) { this.pc.at++; return this.unary() ? 0 : 1; }
    return this.primary();
  }

  primary() {
    this.skipSpaces();
    const b = this.peekByte();
    if (b === undefined) throw new Unsupported('an expression ran off the line', this.lineNo);
    if (b === 0x28) { this.pc.at++; const v = this.value(); this.expect(0x29); return v; }
    if (b === 0x22) return this.string();
    if ((b >= 0x30 && b <= 0x39) || b === 0x2E) return this.number();
    if (b >= 0x80) return this.func();
    return this.variable();
  }

  number() {
    let s = '';
    for (;;) {
      const b = this.peekByte();
      if (b === undefined) break;
      const c = String.fromCharCode(b);
      if (/[0-9.]/.test(c)) { s += c; this.pc.at++; continue; }
      if ((c === 'E' || c === 'e') && /[0-9.]$/.test(s)) { s += 'E'; this.pc.at++; continue; }
      if ((c === '+' || c === '-') && /E$/.test(s)) { s += c; this.pc.at++; continue; }
      break;
    }
    return Number(s);
  }

  string() {
    this.expect(0x22);
    let s = '';
    for (;;) {
      const b = this.nextByte();
      if (b === undefined || b === 0x22) break;
      s += String.fromCharCode(b & 0x7F ? b : b);
    }
    return s;
  }

  variable() {
    const { name, sigil } = this.varName();
    this.skipSpaces();
    if (this.peekByte() === 0x28) {
      this.pc.at++;
      const subs = [this.num()];
      while (this.peekByte() === 0x2C) { this.pc.at++; subs.push(this.num()); }
      this.expect(0x29);
      return this.getArray(name, sigil, subs);
    }
    return this.getVar(name, sigil);
  }

  func() {
    const tok = this.nextByte();
    const one = () => { this.expect(0x28); const v = this.value(); this.expect(0x29); return v; };
    switch (tok) {
      case T.PEEK: { const a = one(); return this.host.peek(a < 0 ? a + 0x10000 : a); }
      case T.RND: { one(); return this.host.rnd(); }
      case T.INT: return Math.floor(one());
      case T.ABS: return Math.abs(one());
      case T.SGN: return Math.sign(one());
      case T.SQR: return Math.sqrt(one());
      case T.LEN: return String(one()).length;
      case T.VAL: { const s = String(one()); const m = s.match(/^\s*[-+]?(\d+\.?\d*|\.\d+)/);
        return m ? Number(m[0]) : 0; }
      case T.ASC: { const s = String(one()); return s.length ? s.charCodeAt(0) : 0; }
      case T['CHR$']: return String.fromCharCode(Math.trunc(one()) & 0xFF);
      case T['STR$']: return formatNumber(one());
      case T.PDL: return this.host.pdl(Math.trunc(one()));
      case T.POS: { one(); return this.host.pos(); }
      case T['SCRN(']: {
        const x = this.value(); this.expect(0x2C); const y = this.value(); this.expect(0x29);
        return this.host.scrn(x, y);
      }
      case T['LEFT$']: {
        this.expect(0x28); const s = this.str(); this.expect(0x2C);
        const n = this.num(); this.expect(0x29);
        return s.slice(0, Math.max(0, Math.trunc(n)));
      }
      case T['RIGHT$']: {
        this.expect(0x28); const s = this.str(); this.expect(0x2C);
        const n = this.num(); this.expect(0x29);
        return n <= 0 ? '' : s.slice(-Math.trunc(n));
      }
      case T['MID$']: {
        this.expect(0x28); const s = this.str(); this.expect(0x2C);
        const from = Math.trunc(this.num());
        let count = s.length;
        this.skipSpaces();
        if (this.peekByte() === 0x2C) { this.pc.at++; count = Math.trunc(this.num()); }
        this.expect(0x29);
        return s.substr(Math.max(0, from - 1), Math.max(0, count));
      }
      default:
        throw new Unsupported(`the function ${TOKENS[tok - 0x80]}`, this.lineNo);
    }
  }
}

/** Applesoft prints whole numbers without a decimal point and drops a leading zero. */
export function formatNumber(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  let s = String(Number(v.toPrecision(9)));
  s = s.replace(/^(-?)0\./, '$1.');
  return s;
}
