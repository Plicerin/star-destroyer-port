// A DOS 3.3 catalogue, read in the browser.
//
// `oracle/dsk.mjs` does this too, and this is deliberately a second implementation rather than
// a shared one: that file is the arbiter's and uses Node's `fs` and `Buffer`, and the port is
// not allowed to depend on the arbiter. What they have in common is the format, which is not
// anyone's invention.
//
// A 35-track, 16-sector image is 143,360 bytes, laid out track by track and sector by sector.
// The VTOC at track 17 sector 0 points at the first catalogue sector; each catalogue sector
// holds seven 35-byte entries and points at the next. An entry gives the name with the high
// bit set on every character, the type, the sector count, and the track and sector of the
// file's track/sector list - which is itself a chain of sectors, each listing up to 122 data
// sectors as track/sector pairs from offset 12.
//
// What `read()` returns is the whole sector chain as stored, because that is what a load
// writes: see `../game/dos.js`, and `oracle/DISK_TRUTH.md` under "A BLOAD writes past the end
// of the file".

export const TRACKS = 35, SECTORS = 16, SECTOR_SIZE = 256;
export const DISK_BYTES = TRACKS * SECTORS * SECTOR_SIZE;

/** The file types, by the low seven bits of the type byte. The high bit is the lock. */
const TYPES = {
  0x00: 'TEXT', 0x01: 'INTEGER', 0x02: 'APPLESOFT', 0x04: 'BINARY',
  0x08: 'S', 0x10: 'RELOCATABLE', 0x20: 'A', 0x40: 'B',
};

/**
 * Open a disk image.
 *
 * @param {Uint8Array|ArrayBuffer} image 143,360 bytes
 * @returns {{files: object[], read: Function, sector: Function}}
 */
export function openDisk(image) {
  const buf = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (buf.length !== DISK_BYTES) {
    throw new Error(`not a 35-track DOS 3.3 image: ${buf.length} bytes, expected ${DISK_BYTES}`);
  }
  const sector = (t, s) =>
    buf.subarray((t * SECTORS + s) * SECTOR_SIZE, (t * SECTORS + s + 1) * SECTOR_SIZE);

  const vtoc = sector(17, 0);
  if (vtoc[3] !== 3) {
    throw new Error(`the VTOC says DOS version ${vtoc[3]}, not 3 - this reader only`
      + ' understands DOS 3.3');
  }

  const files = [];
  let [ct, cs] = [vtoc[1], vtoc[2]];
  const visited = new Set();
  while (ct !== 0 && !visited.has(ct * 16 + cs)) {
    visited.add(ct * 16 + cs);
    const cat = sector(ct, cs);
    for (let i = 0; i < 7; i++) {
      const e = cat.subarray(11 + i * 35, 11 + (i + 1) * 35);
      if (e[0] === 0 || e[0] === 0xFF) continue;            // never used, or deleted
      files.push({
        name: Array.from(e.subarray(3, 33), (b) => String.fromCharCode(b & 0x7F))
          .join('').replace(/\s+$/, ''),
        locked: !!(e[2] & 0x80),
        type: TYPES[e[2] & 0x7F] ?? `type ${e[2] & 0x7F}`,
        sectors: e[33] | (e[34] << 8),
        tsList: [e[0], e[1]],
      });
    }
    [ct, cs] = [cat[1], cat[2]];
  }

  /** The file's data sectors, concatenated, exactly as stored. */
  function rawData(f) {
    const parts = [];
    let [t, s] = f.tsList;
    const seen = new Set();
    let total = 0;
    while (t !== 0 && !seen.has(t * 16 + s)) {
      seen.add(t * 16 + s);
      const ts = sector(t, s);
      for (let i = 12; i < SECTOR_SIZE; i += 2) {
        if (ts[i] === 0 && ts[i + 1] === 0) continue;       // a hole, or past the end
        const d = sector(ts[i], ts[i + 1]);
        parts.push(d);
        total += d.length;
      }
      [t, s] = [ts[1], ts[2]];
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  /**
   * A file's contents, its header read off the front, and `raw` - the untouched chain.
   *
   * A binary starts with a 2-byte load address then a 2-byte length; an Applesoft or Integer
   * program with a 2-byte length; a text file with nothing.
   */
  function read(f) {
    const raw = rawData(f);
    if (f.type === 'BINARY') {
      const addr = raw[0] | (raw[1] << 8), len = raw[2] | (raw[3] << 8);
      return { addr, len, data: raw.subarray(4, 4 + len), raw };
    }
    if (f.type === 'APPLESOFT' || f.type === 'INTEGER') {
      const len = raw[0] | (raw[1] << 8);
      return { addr: 0x801, len, data: raw.subarray(2, 2 + len), raw };
    }
    return { addr: null, len: raw.length, data: raw, raw };
  }

  /** By name, because every caller here knows what it wants. */
  function file(name) {
    const f = files.find((x) => x.name === name);
    if (!f) throw new Error(`no file called ${name} on this disk`);
    return { ...read(f), name, type: f.type };
  }

  return { files, read, file, sector };
}
