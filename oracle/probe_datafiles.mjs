// The A2-3D2 data block, read as three natural experiments.
//
// The disk ships the same structures more than once, configured differently, and that is
// worth more than staring at one copy:
//
//   SV DATA / SV DATA2        both $80FB, both 491 bytes - the flight scene and the base
//                             star scene. What differs IS the per-scene configuration.
//   MAIN DATA / STARBASE MAIN DATA / BASE STAR DATA
//                             all $83AE, all exactly 1575 bytes - three scenes in one
//                             format. What is common is the format; what differs is content.
//
// The addresses the BASIC pokes come from the programs themselves, where the author named
// them (SD START line 3, STARBASE lines 1 and 127), so the labels below are his, not mine.
import { openDisk, DISK } from './dsk.mjs';
import fs from 'fs';

const d = openDisk(DISK);
const file = (name) => {
  const f = d.files.find((x) => x.name === name);
  if (!f) throw new Error(`no file named ${name}`);
  return d.read(f);
};
const hex = (n, w = 4) => '$' + n.toString(16).toUpperCase().padStart(w, '0');

// Named by the author in SD START line 3, SD RET line 4 and STARBASE lines 1 and 127.
const NAMES = {
  0x8110: 'page soft switch (84=$C054, 85=$C055)', 0x8112: 'draw page?', 0x8114: 'draw page?',
  0x8116: 'XI  viewer X (16-bit)', 0x8118: 'YI  viewer Y (16-bit)', 0x811A: 'ZI  viewer Z (16-bit)',
  0x811C: 'P1  pitch', 0x811D: 'B1  bank', 0x811E: 'H1  heading',
  0x8124: 'ST1', 0x8131: '(ST1 + 13)', 0x813E: 'ST2', 0x814B: '(ST2 + 13)',
  0x8172: '', 0x8175: '', 0x8176: '', 0x817B: 'rotation, stepped by 15 in STARBASE',
  0x8182: '', 0x8183: '',
  0x81DD: 'SHLD  shields', 0x81F3: 'WARP', 0x8209: 'MSL  missiles',
  0x8222: 'S(1)', 0x8225: 'S(2)', 0x8228: 'S(3)', 0x822B: 'S(4)',
  0x822E: 'S(5)', 0x8231: 'S(6)', 0x8234: 'S(7)',
  0x8240: 'BV% lo', 0x8241: 'BV% hi', 0x8244: '', 0x8248: 'TS1',
  0x8255: '(TS1 + 13)', 0x8262: 'SST2', 0x826F: '(SST2 + 13)',
};

const out = { pairs: [], strides: {} };

function diff(aName, bName) {
  const a = file(aName), b = file(bName);
  if (a.addr !== b.addr || a.len !== b.len) {
    console.log(`${aName} vs ${bName}: different shape, not comparable`);
    return null;
  }
  const at = [];
  for (let i = 0; i < a.len; i++) if (a.data[i] !== b.data[i]) at.push(i);
  console.log(`\n${aName}  vs  ${bName}`);
  console.log(`  both load at ${hex(a.addr)}, ${a.len} bytes; ${at.length} differ `
    + `(${(at.length / a.len * 100).toFixed(1)}%)`);
  for (const i of at) {
    const addr = a.addr + i;
    console.log(`    ${hex(addr)}  ${String(a.data[i]).padStart(3)} -> ${String(b.data[i]).padStart(3)}`
      + (NAMES[addr] ? `   ${NAMES[addr]}` : ''));
  }
  out.pairs.push({ a: aName, b: bName, addr: a.addr, len: a.len,
    differing: at.map((i) => ({ addr: a.addr + i, from: a.data[i], to: b.data[i] })) });
  return at;
}

console.log('=== the per-scene configuration block ===');
diff('SV DATA', 'SV DATA2');

console.log('\n\n=== the three scene files ===');
diff('MAIN DATA', 'STARBASE MAIN DATA');
diff('MAIN DATA', 'BASE STAR DATA');

// Is the 13-byte stride real? The BASIC pokes $8124, $8131, $813E, $814B and $8248,
// $8255, $8262, $826F - 13 apart in two runs. If those are records, the bytes between
// them should repeat with period 13.
console.log('\n\n=== testing the 13-byte stride ===');
{
  const sv = file('SV DATA');
  const byteAt = (addr) => sv.data[addr - sv.addr];
  for (const base of [0x8124, 0x8248]) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      const start = base + r * 13;
      if (start + 13 > sv.addr + sv.len) break;
      rows.push([...Array(13)].map((_, c) => byteAt(start + c)));
    }
    console.log(`\n  from ${hex(base)}, 13 bytes a row:`);
    rows.forEach((row, i) => console.log(`    ${hex(base + i * 13)}  `
      + row.map((v) => String(v).padStart(3)).join(' ')));
    out.strides[hex(base)] = rows;
  }
}

fs.mkdirSync('captured/datafiles', { recursive: true });
fs.writeFileSync('captured/datafiles/golden.json', JSON.stringify(out, null, 1) + '\n');
console.log('\nwrote captured/datafiles/golden.json');
