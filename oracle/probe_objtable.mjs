// The object tables: two runs of twelve 13-byte records, and what they point at.
//
// Where the stride comes from, so it is not a number pulled out of the air:
//
//   - the BASIC pokes $8124, $8131, $813E, $814B to turn things on and off (STARBASE
//     lines 7 and 129, SD START 131-133), and $8248, $8255, $8262, $826F likewise. Both
//     runs step by 13.
//   - SV DATA and SV DATA2 are the same 491-byte block configured for two scenes, and
//     they differ in eight bytes ONLY: $813B/$813C, $8148/$8149, $8155/$8156, $8162,
//     $816F. Also a stride of 13, at a different offset within the record.
//
// Two independent runs at the same stride, one of them the author's own pokes, is what
// makes 13 a finding rather than a guess.
//
// Where the LENGTH comes from: laid out this way the first twelve records are identical
// in shape - ten zero bytes, a pointer, then 19 - and the thirteenth is visibly not a
// record at all. The first version of this probe kept walking and reported nine bad
// pointers; the table simply ends. $8124 + 12*13 = $81C0, exactly where it stops being
// regular, and $8248 + 12*13 = $82E4, two bytes from the end of the block.
import { openDisk, DISK } from './dsk.mjs';
import fs from 'fs';

const d = openDisk(DISK);
const file = (n) => d.read(d.files.find((x) => x.name === n));
const hex = (n, w = 4) => '$' + n.toString(16).toUpperCase().padStart(w, '0');

const TABLES = [0x8124, 0x8248], STRIDE = 13, COUNT = 12;
const PTR = 10;                        // the pointer's offset within a record

const scenes = {
  'SV DATA': { cfg: file('SV DATA'), shapes: file('MAIN DATA') },
  'SV DATA2': { cfg: file('SV DATA2'), shapes: file('BASE STAR DATA') },
};

const results = [], out = { tables: {} };
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

for (const [name, { cfg, shapes }] of Object.entries(scenes)) {
  const byte = (a) => cfg.data[a - cfg.addr];
  const lo = shapes.addr, hi = shapes.addr + shapes.len;
  out.tables[name] = {};

  for (const base of TABLES) {
    const recs = [];
    console.log(`\n=== ${name}, table at ${hex(base)} ===`);
    console.log('  addr    ' + [...Array(13)].map((_, i) => `+${i}`.padStart(4)).join('') + '     shape');
    for (let r = 0; r < COUNT; r++) {
      const at = base + r * STRIDE;
      const b = [...Array(13)].map((_, c) => byte(at + c));
      const ptr = b[PTR] | (b[PTR + 1] << 8);
      console.log(`  ${hex(at)}  ` + b.map((v) => String(v).padStart(4)).join('')
        + `     ${hex(ptr)}${ptr >= lo && ptr < hi ? '' : '  OUTSIDE'}`);
      recs.push({ at, bytes: b, ptr, inside: ptr >= lo && ptr < hi });
    }
    out.tables[name][hex(base)] = recs;

    check(`${name} ${hex(base)}: all twelve pointers land inside the scene's shape file`,
      recs.every((r) => r.inside), `${recs.filter((r) => r.inside).length}/12 in ${hex(lo)}-${hex(hi)}`);
    check(`${name} ${hex(base)}: the pointers ascend`,
      recs.every((r, i) => i === 0 || r.ptr > recs[i - 1].ptr), '');
    check(`${name} ${hex(base)}: +0 to +9 are zero in a file as shipped`,
      recs.every((r) => r.bytes.slice(0, 10).every((v) => v === 0)),
      'the BASIC writes +0 at run time to switch an object on');
  }

  // The record after the last one should NOT look like a record - that is what bounds it.
  const after = TABLES[0] + COUNT * STRIDE;
  const b = [...Array(13)].map((_, c) => byte(after + c));
  check(`${name}: ${hex(after)} is not a thirteenth record`,
    !b.slice(0, 10).every((v) => v === 0), `+0..+9 = ${b.slice(0, 10).join(',')}`);
}

// The two scenes differ only where a scene's own shapes differ: the pointer field.
{
  const a = scenes['SV DATA'].cfg, b = scenes['SV DATA2'].cfg;
  const differ = [];
  for (let i = 0; i < a.len; i++) if (a.data[i] !== b.data[i]) differ.push(a.addr + i);
  const inTableA = differ.filter((x) => x >= TABLES[0] && x < TABLES[0] + COUNT * STRIDE);
  check('every byte differing between the two scenes is in the first table',
    inTableA.length === differ.length, `${inTableA.length} of ${differ.length}`);
  check('and every one of them is the pointer field',
    differ.every((x) => { const o = (x - TABLES[0]) % STRIDE; return o === PTR || o === PTR + 1; }),
    `offsets ${[...new Set(differ.map((x) => (x - TABLES[0]) % STRIDE))].sort().join(', ')}`);
}

fs.mkdirSync('captured/objtable', { recursive: true });
fs.writeFileSync('captured/objtable/golden.json', JSON.stringify({ out, results }, null, 1) + '\n');
const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `object table: all ${results.length} checks passed`
  : `object table: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
