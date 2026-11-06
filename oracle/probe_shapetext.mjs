// The words the game draws, and why no text search of the disk can find them.
//
// `START` prints its message to the text screen, so `PREPARE YOURSELF FOR THE ULTIMATE
// STARSHIP BATTLE!` sits in the disk image as plain ASCII. Nothing else does. Every word on
// the starbase, high-score and demo screens is drawn with `XDRAW` out of one shape table, and
// the programs hold their text as **lists of shape numbers in `DATA` statements** - so a
// search of the image for `BEOWULF` or `COMMANDER` finds nothing, and this file was written
// for a long time as though those words did not exist.
//
// **The cipher is not guessed at, it is forced.** Two routines in `STARBASE` convert a digit
// to a shape number by different means - line 2050 does `VAL` then `+ 2`, line 3020 does
// `ASC` then `- 46` - and they agree. That fixes the table as a contiguous ASCII run; the
// letters in the `DATA` then land on 18-43, which is `ASC - 47`, one lower. So the table is
// ASCII `/` through `Z` **with `@` left out**, and 1 + 10 + 6 + 26 is exactly the 43 shapes
// the table declares, with nothing over and nothing short. The decode is then confirmed
// against a word the derivation did not choose: `STARBASE`'s banner spells the program's
// own name.
//
// **What it says** is the game's entire fiction, and it is in `DEMO` - the attract mode, which
// this file called "never walked" for weeks. The player commands the starship *Beowulf*
// against an alien armada. Nothing anywhere else on the disk names either.
//
// One thing measured on the way: `STARBASE` line 2045, `IF A = 8 THEN A = 9`, draws every 8
// in the docking score as a 9. Shape 10 is a perfectly good 8 and the level-number routine at
// line 3020 draws it without complaint, so the guard is a bug in the original and not a
// workaround for a damaged glyph. The port keeps it.
import fs from 'node:fs';
import { openDisk, DISK } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import { parseTable, drawShape } from '../port/src/platform/shapes.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const SHAPES = 'CHR$.A24576.L148';
/** `POKE 232,251: POKE 233,26` in all three programs that draw text. */
const BASE = 0x1AFB;

const mem = new Uint8Array(0x10000);
const shapeFile = d.read(d.files.find((x) => x.name === SHAPES));
for (let i = 0; i < shapeFile.len; i++) mem[BASE + i] = shapeFile.data[i];
const table = parseTable(mem, BASE);

/** Load a program's tokenised bytes and return its lines. */
const program = (name) => {
  const raw = d.read(d.files.find((x) => x.name === name));
  const m = new Uint8Array(0x10000);
  for (let i = 0; i < raw.len; i++) m[raw.addr + i] = raw.data[i];
  return listProgram(m, 0x801);
};

/** The `DATA` numbers of one line of one program. */
const data = (lines, num) => {
  const line = lines.find((l) => l.num === num);
  const m = line && line.text.match(/^DATA\s+(.*)$/);
  if (!m) throw new Error(`${num} is not a DATA line`);
  return m[1].split(',').map((v) => Number(v.trim()));
};

// ------------------------------------------------- the cipher is forced, not chosen --------
console.log('\n=== the cipher ===');

// STARBASE converts a digit to a shape twice, by different routes. If they disagree there is
// no single mapping to find and everything below is unfounded.
const starbase = program('STARBASE');
{
  const viaVal = (dig) => dig + 2;                       // line 2050, after `A = VAL(P$)`
  const viaAsc = (dig) => ('0'.charCodeAt(0) + dig) - 46; // line 3020, `A = ASC(..) - 46`
  const digits = [...Array(10).keys()];
  const agree = digits.every((n) => viaVal(n) === viaAsc(n));
  check('STARBASE\'s two digit routines agree on the mapping', agree,
    `0->${viaVal(0)} .. 9->${viaVal(9)}, by VAL+2 (line 2050) and by ASC-46 (line 3020)`);

  const srcs = ['A = A + 2', 'A = A - 46'];
  const present = srcs.every((s) => starbase.some((l) => l.text.includes(s)));
  check('control: both of those lines really are in STARBASE', present,
    'read off the disk, not quoted from this comment');
}

// The letters. Their span, and where it ends, is the rest of the account.
const LETTERS = (() => {
  const used = new Set();
  for (const name of ['DEMO', 'STARBASE', 'INITIALS']) {
    for (const l of program(name)) {
      const m = l.text.match(/^DATA\s+(.*)$/);
      if (!m) continue;
      for (const v of m[1].split(',').map((x) => Number(x.trim()))) {
        if (v > 11 && v < 100) used.add(v); // above the digits, below the terminators
      }
    }
  }
  return [...used].sort((a, b) => a - b);
})();
{
  // The account: 1 slash, 10 digits, 6 punctuation, 26 letters. If ASCII `/` to `Z` less `@`
  // did not come to exactly 43, the run would have a gap somewhere and A would not be at 18.
  const run = 'Z'.charCodeAt(0) - '/'.charCodeAt(0) + 1; // '/' .. 'Z' inclusive
  check('ASCII / to Z with @ left out is exactly the table\'s size', run - 1 === table.count,
    `${run} characters from / to Z, minus @, is ${run - 1}`);
  // '?' is 17 under the digits' own ASC-46, so with `@` skipped the next shape is A.
  check('which puts A at 18, one below ASCII\'s own gap',
    '?'.charCodeAt(0) - 46 === 17 && 'A'.charCodeAt(0) - 47 === 18);

  const lo = LETTERS[0], hi = LETTERS[LETTERS.length - 1];
  check('and the lowest letter the disk draws is that 18', lo === 18,
    `letters used run ${lo}..${hi}; an A one shape higher would make this 19`);
  check('all of them inside the letter range', hi <= table.count && lo >= 18,
    `${LETTERS.length} distinct`);

  // The top of the range is not the top of the table, and that is a fact about the script.
  const unused = [];
  for (let n = 18; n <= 43; n++) {
    if (!LETTERS.includes(n)) unused.push(String.fromCharCode(n + 47));
  }
  check('the game never draws J, Q, X or Z - no word in it contains one',
    unused.join('') === 'JQXZ', `${LETTERS.length} of 26 letters used, missing ${unused.join(', ')}`);
}

/** shape -> character, under the mapping the checks above forced. */
const letter = (n) => {
  if (n === 0) return ' ';
  if (n === 1) return '/';
  if (n <= 11) return String.fromCharCode(n + 46);  // digits, ASC - 46
  if (n <= 17) return String.fromCharCode(n + 46);  // : ; < = > ?
  if (n <= 43) return String.fromCharCode(n + 47);  // A - Z, ASC - 47
  return `{${n}}`;
};
/** 127 ends a row, 777 and 999 end a block - terminators, not characters. */
const TERMINATORS = new Set([127, 777, 999]);
const decode = (nums) => nums.filter((n) => !TERMINATORS.has(n)).map(letter).join('')
  .replace(/\s+$/, '');

// The confirmation: a word the derivation had no say in.
check('STARBASE\'s banner decodes to the program\'s own name',
  decode(data(starbase, 500)) === 'STARBASE',
  `line 500 -> "${decode(data(starbase, 500))}"`);
check('and INITIALS\' decodes to what that screen is for',
  decode(data(program('INITIALS'), 2999)) === 'FINAL SCORE',
  `line 2999 -> "${decode(data(program('INITIALS'), 2999))}"`);

// --------------------------------------------------------------- what DEMO says ------------
console.log('\n=== the game\'s fiction, which is all in DEMO ===');
const demo = program('DEMO');
const NARRATION = [
  [450, 'STAR DESTROYER'],
  [500, 'YOU ARE THE COMMANDER OF THE'],
  [510, 'STARSHIP BEOWULF'],
  [520, 'DESTROY THE ALIEN ARMADA'],
  [525, 'BEFORE THEY DESTROY YOU'],
];
for (const [num, want] of NARRATION) {
  const got = decode(data(demo, num));
  check(`DEMO line ${num}`, got === want, `"${got}"`);
}

// And the point of the whole exercise: those words are not in the image.
{
  const image = fs.readFileSync(DISK);
  const ascii = Buffer.from(image).toString('latin1');
  // The disk stores text with the high bit set, so look for both.
  const hasText = (s) => ascii.includes(s)
    || ascii.includes([...s].map((c) => String.fromCharCode(c.charCodeAt(0) | 0x80)).join(''));

  check('control: a string the game really does print as text IS in the image',
    hasText('STARSHIP BATTLE'), 'START prints it to the text screen - so the search works');
  const hidden = ['BEOWULF', 'COMMANDER', 'ALIEN ARMADA', 'DESTROY THE'];
  const found = hidden.filter(hasText);
  check('none of DEMO\'s narration is anywhere in the image as text', found.length === 0,
    found.length ? `found: ${found.join(', ')}` : `${hidden.join(', ')} - all drawn, never written`);
}

// --------------------------------------------- and the port draws it, in order -------------
// Decoding the DATA proves what the bytes say. It does not prove the port ever gets there,
// and `DEMO` makes that a real question: the narration is not drawn in one go but by four
// `GOSUB 400`s fired from inside the attract loop, at `HH = 6`, at `HH = 63` and at
// `JM = 45`, each reading the next block of `DATA` until a 999. A program that left the loop
// early - on a keyboard latch that read as pressed, say - would still run, still render, and
// silently draw none of it.
console.log('\n=== the port, running DEMO ===');
{
  const { Presentation } = await import('../port/src/shell/presentation.js');
  const pres = new Presentation(fs.readFileSync(DISK));
  let drawn = '';
  const real = pres.host.draw.bind(pres.host);
  pres.host.draw = (shape, at, xor) => {
    const n = typeof shape === 'number' ? shape : shape && shape.shape;
    drawn += letter(n);
    return real(shape, at, xor);
  };
  pres.load('DEMO');
  const r = pres.run({ maxSteps: 8_000_000, maxChains: 0 });

  const want = NARRATION.map(([, t]) => t).join('').replace(/ /g, '');
  check('every character of the narration is XDRAWn', drawn.replace(/ /g, '') === want,
    `${drawn.replace(/ /g, '').length} characters, in the order the DATA blocks sit in`);
  check('and DEMO leaves for SELECT of its own accord', r.next === 'SELECT',
    'the attract loop ends at HH = 66 with JU = 1 (line 153), not on a key');
  check('control: it got there without a keypress', pres.host.peek(0xC000) < 128,
    'an unread keyboard latch would have sent line 143 to RUN SELECT on the first pass');
  check('control: nothing it asked the host for was unimplemented',
    pres.host.unimplemented.size === 0,
    [...pres.host.unimplemented.keys()].join(', ') || 'none');
}

// ------------------------------------------------- the 8 that STARBASE will not draw -------
console.log('\n=== STARBASE line 2045 ===');
{
  const guard = starbase.find((l) => l.num === 2045);
  check('the guard is on the disk', !!guard && /IF A = 8 THEN A = 9/.test(guard.text),
    guard ? guard.text : 'line 2045 missing');

  // Render shapes 10 and 11 and compare. If 10 were damaged the guard would be a workaround.
  const bitmap = (n) => {
    const W = 24, H = 20, g = [];
    for (let i = 0; i < H; i++) g.push(new Array(W).fill(0));
    drawShape({ plot: (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = 1; } },
      mem, table, n, 11, 14, {});
    return g.map((r) => r.join('')).join('\n');
  };
  const eight = bitmap(10), nine = bitmap(11);
  const lit = (b) => [...b].filter((c) => c === '1').length;
  check('shape 10 draws something, and it is not shape 11',
    lit(eight) > 10 && eight !== nine,
    `the 8 lights ${lit(eight)} pixels, the 9 lights ${lit(nine)}, and they differ`);

  // The 8 is closed top and bottom; the 9 is not. That is the difference the guard throws away.
  const rows = (b) => b.split('\n').filter((r) => r.includes('1'));
  const e = rows(eight), nn = rows(nine);
  check('and it is an 8: closed at the top and the bottom, where the 9 is open',
    e[0].replace(/0/g, '').length >= 4 && e[e.length - 1].replace(/0/g, '').length >= 4,
    `8 spans ${e.length} rows, 9 spans ${nn.length}`);
}

// ----------------------------------------------------------- the table is intact -----------
console.log('\n=== the table ===');
{
  let terminated = 0;
  for (let n = 1; n <= table.count; n++) {
    const start = table.offsets[n - 1];
    const end = n < table.count ? table.offsets[n] : shapeFile.len;
    if (mem[BASE + end - 1] === 0) terminated++;
  }
  check('every shape ends with a zero in the byte before the next one begins',
    terminated === table.count, `${terminated} of ${table.count}`);
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
