// "Which screen is the machine showing?", answered against the disk.
//
// The first version of probe_play asked "is it hires on page 1?" and called that the
// difficulty screen. The title is also hires on page 1, so the check passed on the title
// and the probe happily reported a difficulty of 0 and 255 enemies. A detector that
// cannot tell the two apart is not a detector.
//
// Six screens on this disk are stored as whole hi-res pages, so the honest question is
// whether the bytes on screen ARE one of those files. This compares them.
import { openDisk, DISK } from './dsk.mjs';

const disk = openDisk(DISK);

/** The .PIC files, as 8 KB pages indexed by name. */
export const PICTURES = (() => {
  const out = {};
  for (const f of disk.files) {
    if (f.type !== 'BINARY') continue;
    const r = disk.read(f);
    if (r.addr !== 0x2000 || r.len < 0x1F00) continue;
    const page = new Uint8Array(0x2000);
    page.set(r.data.subarray(0, Math.min(r.data.length, 0x2000)));
    out[f.name] = page;
  }
  return out;
})();

/** How many of the 8192 bytes differ. */
export function bytesDiffering(a, b) {
  let n = 0;
  for (let i = 0; i < 0x2000; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * The picture the screen matches, or null.
 *
 * Not an exact compare: a program that BLOADs a picture then prints over it has changed
 * some bytes and is still showing that screen. `tolerance` is the share of the page
 * allowed to differ - 2% is about four text lines' worth.
 */
export function identify(page, tolerance = 0.02) {
  let best = null;
  for (const [name, pic] of Object.entries(PICTURES)) {
    const diff = bytesDiffering(page, pic);
    if (!best || diff < best.diff) best = { name, diff };
  }
  if (!best || best.diff > 0x2000 * tolerance) return null;
  return best;
}
