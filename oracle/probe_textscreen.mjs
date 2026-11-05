// The 40x24 text screen: its layout, its three styles, and which way round a letter goes.
//
// The layout is the machine's and is checked against the formula. The glyph shapes are not:
// the Apple II's characters live in a ROM on the motherboard, not on this disk, so they are a
// stand-in and the only thing worth checking about them is that they come out the right way
// round. That is here because they did not - the glyph data is written with bit 4 leftmost
// and the renderer read bit 0 leftmost, which is the hi-res page's order, and every character
// on the title screen came out mirrored.
import { rowOffset, decode, encode, paintText, readRow, clear, glyph,
  COLS, ROWS, CELL_W, CELL_H } from '../port/src/platform/text.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

// ---------------------------------------------------------------- the layout -------------
console.log('\n=== the layout ===');
{
  const offsets = [];
  for (let r = 0; r < ROWS; r++) offsets.push(rowOffset(r));
  check('24 rows, every one at a different offset',
    new Set(offsets).size === ROWS,
    `${offsets[0]}, ${offsets[1]}, ${offsets[2]} ... ${offsets[23]}`);
  check('and the page is three groups of eight, 40 bytes each with holes between',
    offsets[0] === 0 && offsets[8] === 40 && offsets[16] === 80 && offsets[1] === 0x80,
    'row 1 is $80 below row 0 and row 8 is 40 along - the same interleave as the hi-res'
      + ' page, one third as deep');
  check('every row fits inside the 1,024-byte page',
    offsets.every((o) => o + COLS <= 1024),
    `the last row starts at ${offsets[23]} and ends at ${offsets[23] + COLS}`);
}

// ---------------------------------------------------------------- the styles -------------
console.log('\n=== normal, inverse and flashing ===');
{
  const bad = [];
  for (const style of ['normal', 'inverse', 'flash']) {
    for (const ch of 'ABZ019 ?') {
      const b = encode(ch, style);
      const d = decode(b);
      if (d.ch !== ch.toUpperCase() || d.style !== style) {
        bad.push(`${style} '${ch}' -> $${b.toString(16)} -> ${d.style} '${d.ch}'`);
      }
    }
  }
  check('every character survives encode and decode in all three styles',
    bad.length === 0, bad.slice(0, 3).join('; ') || '24 combinations');

  // The mistake this guards: masking to $7F turns inverse capitals into control codes.
  check('inverse capitals decode as capitals, not as control codes',
    decode(0x01).ch === 'A' && decode(0x1A).ch === 'Z',
    '$01 is an inverse A and $1A an inverse Z - the low six bits lifted into ASCII, which is'
      + ' why a plain & $7F reads the title as ^S^P^A^C^E');
}

// ---------------------------------------------------------------- which way round --------
console.log('\n=== which way round a letter goes ===');
{
  const mem = new Uint8Array(0x10000);
  clear(mem, 0x400);
  const word = 'PF';                                  // both asymmetric, both left-heavy
  for (let i = 0; i < word.length; i++) {
    mem[0x400 + rowOffset(0) + i] = encode(word[i], 'normal');
  }
  check('a row reads back as what was written into it',
    readRow(mem, 0, 0x400) === word, `"${readRow(mem, 0, 0x400)}"`);

  const out = { width: COLS * CELL_W, data: new Uint8ClampedArray(COLS * CELL_W * ROWS * CELL_H * 4) };
  paintText(mem, out, { base: 0x400, fromRow: 0, toRow: 1 });
  const lit = (col, x, y) => {
    const px = ((y) * out.width + col * CELL_W + x) * 4;
    return out.data[px] > 0;
  };

  // P's top row is its bar: four pixels from the left of the five, so x=1..4 lit, x=5 dark.
  const pTop = [1, 2, 3, 4, 5].map((x) => lit(0, x, 0));
  // P's bottom row is just the stem: the leftmost pixel only.
  const pBottom = [1, 2, 3, 4, 5].map((x) => lit(0, x, 6));
  console.log(`  P row 0: ${pTop.map((b) => (b ? 'X' : '.')).join('')}`
    + `   P row 6: ${pBottom.map((b) => (b ? 'X' : '.')).join('')}`);
  check('P has its stem on the LEFT, which is how a mirrored renderer is caught',
    pBottom[0] === true && pBottom[4] === false,
    'the bottom row of a P is the stem alone, so the leftmost of the five is lit and the'
      + ' rightmost is not - reversed, it would be the other way about');
  check('and its top bar runs from the left edge',
    pTop[0] === true && pTop[3] === true && pTop[4] === false,
    pTop.map((b) => (b ? 'X' : '.')).join(''));

  // The control: the same glyph read the other way round, which is the bug that happened.
  const g = glyph('P');
  const mirrored = g.map((row) => {
    let v = 0;
    for (let i = 0; i < 5; i++) if ((row >> i) & 1) v |= 1 << (4 - i);
    return v;
  });
  check('control: reading the glyph bits the other way round changes P, so this can fail',
    mirrored.some((v, i) => v !== g[i]),
    'P is not its own mirror image, which is why it was the letter to check');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
