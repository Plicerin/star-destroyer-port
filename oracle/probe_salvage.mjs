// What else is missing from this disk, and is any of it still down there?
//
// The two title pages were overwritten in place, and the standing question has been
// what else it touched. Before that can be answered properly by comparing against a clean
// dump, there is something this image can be asked on its own: a DOS 3.3 disk keeps a
// deleted file's catalog entry, and deleting a file frees its sectors without erasing
// them. So the disk can be searched for what used to be on it.
//
// Two results, and they point opposite ways.
//
// The title art is not here. The disk has ten free sectors - 2,560 bytes - and a hi-res
// page is 8,192. There is no room for it to be hiding in, so no cleverness recovers it.
// That was always the expectation; it is now a measurement.
//
// But four files were deleted from this disk and their names survive, and one of them is
// `STAR DESTROYER.ASM` at 25 sectors - the game's own assembly source. Another,
// `STARBASE II`, is a program that exists nowhere on the disk now. None of the four can be
// recovered: DOS keeps the entry but reuses the sectors, and every one of their
// track/sector lists has been written over.
//
// The useful half: **nothing any live program asks for is missing.** No Applesoft program
// on the disk names a deleted file, so the game as it stands is complete apart from the
// title pages.
import { openDisk, DISK, asMemory } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const key = (t, s) => t * 16 + s;

// --- who owns what ------------------------------------------------------------------------
const owned = new Set();
for (let s = 0; s < 16; s++) { owned.add(key(0, s)); owned.add(key(1, s)); owned.add(key(2, s)); }
owned.add(key(17, 0));
const catalogSectors = [];
{
  let [t, s] = [d.sector(17, 0)[1], d.sector(17, 0)[2]];
  const seen = new Set();
  while (t !== 0 && !seen.has(key(t, s))) {
    seen.add(key(t, s)); owned.add(key(t, s)); catalogSectors.push([t, s]);
    const x = d.sector(t, s); [t, s] = [x[1], x[2]];
  }
}
for (const f of d.files) {
  let [t, s] = f.tsList;
  const seen = new Set();
  while (t !== 0 && !seen.has(key(t, s))) {
    seen.add(key(t, s)); owned.add(key(t, s));
    const ts = d.sector(t, s);
    for (let i = 12; i < 256; i += 2) if (ts[i] || ts[i + 1]) owned.add(key(ts[i], ts[i + 1]));
    [t, s] = [ts[1], ts[2]];
  }
}
const free = [];
for (let t = 0; t < 35; t++) for (let s = 0; s < 16; s++) if (!owned.has(key(t, s))) free.push([t, s]);

console.log(`\n=== space ===`);
console.log(`  ${owned.size} of 560 sectors are accounted for; ${free.length} are free`);
// The VTOC's own bitmap should agree with walking every file. If it did not, something
// would be writing sectors nobody owns, and that would be worth knowing.
const vtoc = d.sector(17, 0);
let bitmapFree = 0;
for (let t = 0; t < 35; t++) {
  const hi = vtoc[0x38 + t * 4], lo = vtoc[0x39 + t * 4];
  for (let s = 0; s < 16; s++) if (s < 8 ? (lo >> s) & 1 : (hi >> (s - 8)) & 1) bitmapFree++;
}
check('the VTOC free map agrees with walking every file sector by sector',
  bitmapFree === free.length, `bitmap says ${bitmapFree}, the walk says ${free.length}`);
check('there is nowhere on this disk a hi-res page could be hiding',
  free.length * 256 < 8192,
  `${free.length} free sectors = ${free.length * 256} bytes, and a page is 8192`);

// --- what was deleted -------------------------------------------------------------------------
// DOS 3.3 marks a deleted entry by writing $FF over the first byte of its track/sector
// list pointer and moving the original track number to byte 32, the last of the 30 name
// bytes. So the name survives minus its last character, and so does the whole chain's
// address - which is what makes the attempt below possible at all.
console.log(`\n=== deleted files ===`);
const deleted = [];
for (const [ct, cs] of catalogSectors) {
  const cat = d.sector(ct, cs);
  for (let i = 0; i < 7; i++) {
    const e = cat.subarray(11 + i * 35, 11 + (i + 1) * 35);
    if (e[0] !== 0xff) continue;
    deleted.push({
      name: [...e.subarray(3, 32)].map((b) => String.fromCharCode(b & 0x7f)).join('').trimEnd(),
      sectors: e[33] | (e[34] << 8), list: [e[32], e[1]],
    });
  }
}
for (const f of deleted) {
  const reused = owned.has(key(f.list[0], f.list[1]));
  f.recoverable = !reused;
  console.log(`  "${f.name}"  ${String(f.sectors).padStart(2)} sectors, list at `
    + `T${f.list[0]}S${f.list[1]} - ${reused ? 'reused by a live file, so the chain is gone' : 'still free'}`);
}
check('four files were deleted from this disk and their names survive',
  deleted.length === 4, deleted.map((f) => `"${f.name}"`).join(', '));
check('the author\'s own assembly source was one of them',
  deleted.some((f) => f.name.includes('.ASM')),
  deleted.find((f) => f.name.includes('.ASM'))?.name + ', '
  + deleted.find((f) => f.name.includes('.ASM'))?.sectors + ' sectors');
check('none of the four can be recovered - every chain has been written over',
  deleted.every((f) => !f.recoverable));

// --- does the game still hang together? --------------------------------------------------------
// The question that actually matters for the port. A deleted file only matters if
// something still asks for it, so this reads every DOS command out of every Applesoft
// program and checks the name against the catalog.
console.log(`\n=== does anything ask for a file that is not here? ===`);
const live = new Set(d.files.map((f) => f.name));
const wanted = new Map();
for (const f of d.files.filter((x) => x.type === 'APPLESOFT')) {
  const text = listProgram(asMemory(d.read(f)), 0x801).map((l) => l.text).join('\n');
  // DOS commands come through PRINT CHR$(4) strings: RUN, LOAD, BLOAD, BRUN, CHAIN, SAVE.
  for (const m of text.matchAll(/"(?:RUN|LOAD|BLOAD|BRUN|CHAIN|SAVE|DELETE|OPEN|READ|WRITE|CLOSE)\s*([^",]*)/g)) {
    const name = m[1].trim();
    if (!name) continue;
    if (!wanted.has(name)) wanted.set(name, []);
    wanted.get(name).push(f.name);
  }
}
const missing = [...wanted.entries()].filter(([n]) => !live.has(n));
console.log(`  ${wanted.size} distinct file names are referenced by the 21 Applesoft programs`);
for (const [n, by] of missing) console.log(`     MISSING: "${n}" wanted by ${by.join(', ')}`);
// A check that found nothing would pass for the wrong reason, so this insists it found
// the references first. The first version of it passed on zero, because listProgram wants
// memory indexed by address and was being handed a bare array.
check('the programs were actually read - DOS commands were found in them',
  wanted.size >= 10, `${wanted.size} distinct names referenced`);
check('no live program names a file that is not on the disk',
  missing.length === 0, missing.length ? missing.map(([n]) => n).join(', ') : `${wanted.size} names, all present`);
// Two of the four deleted names are also live files - DEMO and CLEAR SCORES were
// superseded, not removed - so being referenced is right and proper for those. The ones
// that matter are the two with no live namesake.
const goneForGood = deleted.filter((f) => !live.has(f.name));
check('the files that were deleted and never replaced are wanted by nothing',
  !goneForGood.some((f) => wanted.has(f.name)),
  goneForGood.map((f) => `"${f.name}"`).join(' and ') + ' exist nowhere and nothing asks for them');

// --- salvage ------------------------------------------------------------------------------------
// The ten free sectors are not empty. They are fragments of whatever was deleted, and the
// readable strings in them are assembler output - so they are the remains of
// STAR DESTROYER.ASM. Not enough to be useful, but worth keeping rather than describing.
console.log(`\n=== what is left in the free sectors ===`);
const salvage = Buffer.concat(free.map(([t, s]) => d.sector(t, s)));
const printable = [...salvage].map((b) => {
  const c = b & 0x7f;
  return c >= 32 && c < 127 ? String.fromCharCode(c) : '\n';
}).join('').split('\n').map((x) => x.trim()).filter((x) => x.length >= 8);
console.log(`  ${free.length} sectors, ${salvage.length} bytes, ${printable.length} readable strings:`);
for (const str of printable.slice(0, 8)) console.log(`     ${str.slice(0, 72)}`);
let nonZero = 0;
for (const b of salvage) if (b) nonZero++;
check('the free sectors still hold data rather than being wiped',
  nonZero > salvage.length / 2, `${nonZero} of ${salvage.length} bytes are non-zero`);

fs.mkdirSync('captured/salvage', { recursive: true });
fs.writeFileSync('captured/salvage/free_sectors.bin', salvage);
fs.writeFileSync('captured/salvage/golden.json', JSON.stringify({
  freeSectors: free.map(([t, s]) => `T${t}S${s}`),
  freeBytes: free.length * 256,
  deleted, referencedNames: [...wanted.keys()].sort(), missing: missing.map(([n]) => n),
  results,
}, null, 1) + '\n');
console.log(`\nwrote captured/salvage/free_sectors.bin and golden.json`);

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `salvage: all ${results.length} checks passed`
  : `salvage: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
