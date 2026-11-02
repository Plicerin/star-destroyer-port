// Every hi-res picture on the disk, as a PNG.
//
// Six files BLOAD at $2000, which is the hi-res page, so each is a whole screen stored
// byte for byte. Unlike Space Vikings - which drew its opening with HPLOT and had to have
// the arithmetic reconstructed - these are bitmaps, and porting them is a copy.
//
// They are also how we find out what on this disk is the game and what is the change: the
// boot lands on a "the replacement art" screen, which is somebody's addition.
import { openDisk, DISK } from './dsk.mjs';
import { decodeHgr, toPng } from './hgr.mjs';
import fs from 'fs';

const d = openDisk(DISK);
fs.mkdirSync('captured/pics', { recursive: true });

const out = [];
for (const f of d.files) {
  if (f.type !== 'BINARY') continue;
  const r = d.read(f);
  if (r.addr !== 0x2000 || r.len < 0x1F00) continue;        // a screen, give or take
  // SD.PIC1 and SD.PIC2 are 8191 bytes, one short of a page: the last byte is in the
  // screen's unused tail, so a missing one costs nothing. Pad rather than refuse.
  const px = new Uint8Array(0x2000);
  px.set(r.data.subarray(0, Math.min(r.data.length, 0x2000)));
  const name = f.name.replace(/[^A-Z0-9.]+/gi, '_');
  fs.writeFileSync(`captured/pics/${name}.png`, toPng(decodeHgr(px)));
  const lit = decodeHgr(px).reduce((a, b) => a + (b ? 1 : 0), 0);
  out.push({ name: f.name, bytes: r.len, litPixels: lit });
  console.log(`${f.name.padEnd(24)} ${String(r.len).padStart(5)} bytes   ${lit} lit pixels`);
}
fs.writeFileSync('captured/pics/golden.json', JSON.stringify({ pictures: out }, null, 1) + '\n');
console.log(`\n${out.length} pictures -> captured/pics/`);
