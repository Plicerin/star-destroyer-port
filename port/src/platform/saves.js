// The one file this game writes, kept where it will still be there tomorrow.
//
// `INITIALS.DAT` is the only writable file on the disk and the high-score table is the only
// thing in it. `host.js` runs the DOS side of it - OPEN, READ, WRITE, CLOSE, a record per
// PRINT - and deliberately does not touch the disk image, because the image is what every
// measurement in this repository is made against. So the records come out of the host and
// stop somewhere, and until this existed that somewhere was a `Map` on an object the page
// threw away on reload: the table came up as the author left it every single time.
//
// What is stored is **the file, not a data structure**: the records joined by carriage
// returns, which is exactly what the sectors hold. A stored table can be compared with the
// disk's own bytes, and a store written by a version of this port that no longer exists still
// reads back.
//
// Nothing in here is allowed to throw. `localStorage` is absent in a private window on some
// browsers, throws on read when site data is blocked, and throws on write when the origin is
// full - and a high score is not worth stopping a game for. Failures are recorded once, the
// way a broken speaker is, and the game carries on with the table it has.

/** The file. There is only one. */
export const SCORES = 'INITIALS.DAT';

/** A carriage return ends a record, which is DOS's text format and not a choice made here. */
const CR = String.fromCharCode(13);

/**
 * What `CLEAR SCORES` writes.
 *
 * The author shipped a two-line utility beside the game and the chain never runs it:
 *
 *     20 FOR J = 1 TO 7: PRINT CHR$(4);"WRITE INITIALS.DAT": PRINT "AAA": PRINT 0: NEXT
 *
 * Seven names and seven scores, and it is what the table on this disk holds. An empty table
 * is seven of these, so a port that lets a player keep scores has to let them do this too -
 * otherwise the first three letters typed into it are there for good.
 */
export const CLEARED = Array.from({ length: 7 }, () => ['AAA', '0']).flat();

export class Saves {
  /**
   * @param {Storage|null} storage something with `getItem`, `setItem`, `removeItem` -
   *   `window.localStorage`, or a harness's own
   * @param {object} [opts] `prefix` to keep the keys together
   */
  constructor(storage = null, { prefix = 'star-destroyer/' } = {}) {
    this.storage = storage ?? null;
    this.prefix = prefix;
    /** Set once, to the first reason this did not work. The page reads it. */
    this.broken = null;
  }

  key(name) { return this.prefix + name; }

  /** Set `broken` the first time, and keep the first reason rather than the latest. */
  fail(why) {
    if (!this.broken) this.broken = why;
    return null;
  }

  /**
   * The records of a stored file, or null if there is no stored copy.
   *
   * Null is not an empty file: it means the game has never written this one, and the host
   * then opens the disk's own copy. Returning `[]` here would hand `INITIALS` an empty table
   * and lose the author's.
   */
  read(name) {
    if (!this.storage) return null;
    let text;
    try {
      text = this.storage.getItem(this.key(name));
    } catch (e) {
      return this.fail(`the stored scores could not be read: ${e.message}`);
    }
    if (text === null || text === undefined || text === '') return null;
    return String(text).split(CR);
  }

  /** Keep a file. The records go in as the file's own bytes. */
  write(name, records) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key(name), records.join(CR));
      return true;
    } catch (e) {
      this.fail(`the scores could not be saved: ${e.message}`);
      return false;
    }
  }

  /** Forget the stored copy, so the disk's own file is what opens next. */
  forget(name) {
    if (!this.storage) return false;
    try {
      this.storage.removeItem(this.key(name));
      return true;
    } catch (e) {
      this.fail(`the stored scores could not be removed: ${e.message}`);
      return false;
    }
  }

  /**
   * `CLEAR SCORES`, as the author wrote it.
   *
   * It writes fourteen records over the front of the file and DOS does not truncate, so
   * whatever is past them stays - and with no stored copy at all the right answer is to
   * forget it, because the table on the disk is already a cleared one.
   */
  clearScores() {
    const kept = this.read(SCORES);
    if (!kept) return this.forget(SCORES);
    const records = [...kept];
    CLEARED.forEach((r, i) => { records[i] = r; });
    return this.write(SCORES, records);
  }
}

/** The store the page uses, or one that keeps nothing if the browser will not have it. */
export function browserSaves() {
  try {
    return new Saves(typeof localStorage === 'undefined' ? null : localStorage);
  } catch (e) {
    // Reading the property itself can throw where site data is blocked.
    const s = new Saves(null);
    s.fail(`this browser would not open its storage: ${e.message}`);
    return s;
  }
}
