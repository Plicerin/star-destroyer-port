// Can the port's Applesoft actually run this disk's twelve programs?
//
// The presentation is Applesoft, and the port runs the programs rather than transliterating
// them - so the question is not "is the interpreter correct in general" (it is a subset and
// never will be) but "does the subset cover what is on this disk". That is measurable: walk
// every program, collect every token, and compare the set against what the interpreter
// implements. A gap is then a name, not a surprise at runtime.
//
// It also enumerates the two things the interpreter cannot do by itself - the DOS commands
// and the CALL targets - so what is left to build is a list rather than an impression.
import { openDisk, DISK } from './dsk.mjs';
import { listProgram, APPLESOFT_TOKENS } from './detokenise.mjs';
import { parseProgram, TOKENS } from '../port/src/game/applesoft.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const PROGRAMS = d.files.filter((f) => f.type === 'APPLESOFT').map((f) => f.name);

/** The program's bytes, loaded where Applesoft keeps them. */
function image(name) {
  const raw = d.read(d.files.find((x) => x.name === name));
  const mem = new Uint8Array(0x10000);
  for (let i = 0; i < raw.len; i++) mem[raw.addr + i] = raw.data[i];
  return mem;
}

// ---------------------------------------------------------------- two readers agree -------
console.log('\n=== the port reads the same program the oracle does ===');
{
  const bad = [];
  let lines = 0;
  for (const name of PROGRAMS) {
    const mem = image(name);
    const mine = parseProgram(mem, 0x801);
    const theirs = listProgram(mem, 0x801);
    lines += mine.length;
    if (mine.length !== theirs.length) {
      bad.push(`${name}: ${mine.length} lines vs ${theirs.length}`);
      continue;
    }
    for (let i = 0; i < mine.length; i++) {
      if (mine[i].num !== theirs[i].num) {
        bad.push(`${name}: line ${i} is ${mine[i].num} vs ${theirs[i].num}`);
        break;
      }
    }
  }
  check(`all ${PROGRAMS.length} programs parse to the same ${lines} lines either way`,
    bad.length === 0, bad.slice(0, 3).join('; ')
      || 'the port walks the $801 linked list itself rather than reusing the oracle\'s reader,'
        + ' so this is two implementations agreeing');
  check('and the two token tables are identical',
    TOKENS.length === APPLESOFT_TOKENS.length
      && TOKENS.every((t, i) => t === APPLESOFT_TOKENS[i]),
    `${TOKENS.length} tokens, $80 to $${(0x80 + TOKENS.length - 1).toString(16).toUpperCase()}`);
}

// ---------------------------------------------------------------- the subset --------------
console.log('\n=== which tokens this disk actually uses ===');

/** Statement tokens the interpreter's `statement()` handles. */
const STATEMENTS = new Set(['REM', 'END', 'STOP', 'HOME', 'TEXT', 'NORMAL', 'INVERSE', 'FLASH',
  'HGR', 'HGR2', 'RETURN', 'RESTORE', 'PRINT', 'POKE', 'CALL', 'GOTO', 'GOSUB', 'IF', 'FOR',
  'NEXT', 'DATA', 'READ', 'DIM', 'GET', 'INPUT', 'ON', 'HCOLOR=', 'COLOR=', 'ROT=', 'SCALE=',
  'HPLOT', 'DRAW', 'XDRAW', 'HLIN', 'VTAB', 'HTAB', 'LET']);

/** Tokens that are operators, functions or syntax inside a statement, all handled. */
const INLINE = new Set(['+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<', 'NOT', 'THEN',
  'TO', 'STEP', 'AT', 'SGN', 'INT', 'ABS', 'SQR', 'RND', 'PEEK', 'LEN', 'STR$', 'VAL', 'ASC',
  'CHR$', 'LEFT$', 'RIGHT$', 'MID$', 'SPC(', 'TAB(', 'SCRN(', 'PDL', 'POS']);

const used = new Map();
for (const name of PROGRAMS) {
  const mem = image(name);
  for (const line of parseProgram(mem, 0x801)) {
    let quoted = false;
    for (const b of line.bytes) {
      if (b === 0x22) { quoted = !quoted; continue; }
      if (quoted || b < 0x80) continue;
      const t = TOKENS[b - 0x80];
      if (!used.has(t)) used.set(t, new Set());
      used.get(t).add(name);
    }
  }
}
const sorted = [...used].sort((a, b) => b[1].size - a[1].size);
console.log('  ' + sorted.map(([t, who]) => `${t}(${who.size})`).join(' '));

{
  const missing = [...used.keys()].filter((t) => !STATEMENTS.has(t) && !INLINE.has(t));
  check(`every one of the ${used.size} tokens on this disk is one the interpreter implements`,
    missing.length === 0,
    missing.length ? `not implemented: ${missing.join(', ')}`
      : `across ${PROGRAMS.length} programs - so the subset is measured against the disk`);

  // A check that cannot fail is worse than none: show this one can.
  const unimplemented = TOKENS.filter((t) => !STATEMENTS.has(t) && !INLINE.has(t));
  const NAMED = ['SHLOAD', 'DEF', 'ONERR', 'PLOT', 'VLIN', 'USR', 'GR', 'WAIT'];
  check('control: these tokens are NOT implemented, so the check above could have failed',
    NAMED.every((t) => unimplemented.includes(t)) && !NAMED.some((t) => used.has(t)),
    `${unimplemented.length} of ${TOKENS.length} are unimplemented - ${NAMED.join(', ')}`
      + ' among them, and this disk uses none of those');
}

// ---------------------------------------------------------------- the host's work ---------
console.log('\n=== what the interpreter cannot do by itself ===');
const dosCommands = new Map();
const calls = new Map();
for (const name of PROGRAMS) {
  for (const line of listProgram(image(name), 0x801)) {
    // Two things to get right here, and the first version got neither.
    //
    // The verb runs straight into the filename - `^DRUNSELECT`, `^DBLOADPART2` - because DOS
    // parses a keyword prefix rather than a word, so match the keyword and not whatever is
    // in front of the first space.
    //
    // And the Ctrl-D is written two ways on this disk: as a literal control character inside
    // the string, which the listing shows as `^D`, and as `CHR$(4);` in front of it. Matching
    // only the first missed INITIALS entirely - every OPEN, READ, WRITE and CLOSE on the disk
    // is in that program and all of them are the second form.
    for (const m of line.text.matchAll(
      /(?:\^D|CHR\$\(4\)\s*;\s*")\s*(BLOAD|BRUN|BSAVE|RUN|LOAD|SAVE|OPEN|CLOSE|WRITE|READ|DELETE|APPEND|CATALOG)/g)) {
      const verb = m[1];
      if (!dosCommands.has(verb)) dosCommands.set(verb, new Set());
      dosCommands.get(verb).add(name);
    }
    for (const m of line.text.matchAll(/CALL\s*(-?\s*\d+)/g)) {
      const addr = Number(m[1].replace(/\s+/g, ''));
      const a = addr < 0 ? addr + 65536 : addr;
      if (!calls.has(a)) calls.set(a, new Set());
      calls.get(a).add(name);
    }
  }
}
console.log('  DOS commands: ' + [...dosCommands.keys()].sort().join(', '));
console.log('  CALL targets:');
// Only the ones this repository has actually established get a name. The rest get the region
// they are in, which is a fact, and a note that they are not identified. A first version of
// this table named $FC58 as HOME and $A4D4 as DOS; neither address is called by anything on
// this disk, so both were decoration standing where a measurement should be.
const KNOWN_CALLS = {
  0x0300: 'PLAYER.MODULE, the music player',
  0x08EF: 'whichever .OBJ0 is loaded - TITLE, HYPERDRIVE or the game',
  0x6000: 'A2-3D2, the renderer',
};
const region = (a) => (a >= 0xF800 ? 'the monitor ROM, routine not identified'
  : a >= 0xD000 ? 'Applesoft ROM, routine not identified'
    : a >= 0x9600 ? 'DOS, routine not identified' : 'not identified');
for (const [a, who] of [...calls].sort((x, y) => x[0] - y[0])) {
  console.log(`    $${a.toString(16).toUpperCase().padStart(4, '0')}`
    + `  ${(KNOWN_CALLS[a] ?? region(a)).padEnd(46)} ${[...who].join(', ')}`);
}
{
  const verbs = [...dosCommands.keys()].sort();
  // Eight, not the six I expected. BSAVE is the surprise and it is worth keeping: it is in
  // CLS DATA, which is not part of the game at all - it is the author's build tool, and it
  // BSAVEs the CLS binary that the hyperdrive animation uses. So the game itself needs seven
  // and the disk carries an eighth belonging to the program that made one of the game's files.
  const GAME = ['BLOAD', 'BRUN', 'RUN', 'OPEN', 'READ', 'WRITE', 'CLOSE'];
  check('the whole of DOS this disk needs is eight commands, seven of them the game\'s',
    verbs.length === 8 && GAME.every((v) => verbs.includes(v)) && verbs.includes('BSAVE'),
    verbs.join(', ') + ' - OPEN, READ, WRITE and CLOSE are INITIALS and the high-score file,'
      + ' and BSAVE belongs to CLS DATA, which is a build tool rather than a screen');
  check('and the only BSAVE on the disk is the one that builds CLS',
    [...dosCommands.get('BSAVE')].join(',') === 'CLS DATA',
    'CLS DATA line 530 writes CLS from its own DATA statements, so the hyperdrive'
      + " animation's binary has its source on the disk");
  const unknown = [...calls.keys()].filter((a) => !KNOWN_CALLS[a]);
  check('the CALL targets that are not identified are all ROM or DOS, none in the game',
    unknown.length > 0 && unknown.every((a) => a >= 0x9600),
    unknown.map((a) => '$' + a.toString(16).toUpperCase()).join(', ')
      + ' - so none of them blocks the port, and they are listed here rather than guessed at');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
