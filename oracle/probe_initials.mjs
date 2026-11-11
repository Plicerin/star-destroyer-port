// The one file the game writes, and whether a score outlives the game that set it.
//
// `INITIALS.DAT` is the only writable file on the disk: seven names, seven scores, read at the
// top of `INITIALS` and written back when the player makes the table. Everything about that
// path was in place except the end of it - the records stopped in a `Map` on an object the
// page threw away, so the Hall of Heroes came up as the author left it on every reload.
//
// Three things are checked here and they are different in kind.
//
//   * **What the disk holds.** Read, not assumed: fourteen records of a cleared table and a
//     longer one behind them that DOS never truncated away.
//   * **That the port writes like DOS writes.** A record goes in at the file's own position,
//     overwriting in place, and what is past the write stays. The port used to append, which
//     is right exactly once: the second game's table went in behind the first one's and the
//     screen after it showed the older of the two.
//   * **That it persists, and cannot break the game.** The store is a stub here rather than a
//     browser's, and one of them throws on every call, because a high score is not worth
//     stopping a game for - the same rule the speaker is held to.
//
// No emulator and no browser. The subject is the disk's own `INITIALS`, run through the port's
// interpreter, writing through the port's host.
import { readFileSync } from 'node:fs';
import { Presentation, WAITING } from '../port/src/shell/presentation.js';
import { Saves, SCORES, CLEARED } from '../port/src/platform/saves.js';
import { openDisk } from '../port/src/platform/dsk.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};

const image = readFileSync(new URL('../STAR_DESTROYER.dsk', import.meta.url));
const CR = String.fromCharCode(13);

/** The file as the disk holds it, which is where every one of these starts. */
const onDisk = (() => {
  const f = openDisk(image).file(SCORES);
  return Array.from(f.data, (b) => String.fromCharCode(b & 0x7F)).join('').split(CR);
})();

/** A `Storage`, in miniature: enough of one for `Saves`, and able to refuse. */
function makeStorage({ refuse = null } = {}) {
  const items = new Map();
  return {
    items,
    getItem(k) { if (refuse) throw new Error(refuse); return items.has(k) ? items.get(k) : null; },
    setItem(k, v) { if (refuse) throw new Error(refuse); items.set(k, String(v)); },
    removeItem(k) { if (refuse) throw new Error(refuse); items.delete(k); },
  };
}

/** The seven rows `INITIALS` draws, read out of a file's records. */
const table = (records) => Array.from({ length: 7 },
  (_, i) => `${records[i * 2]} ${records[i * 2 + 1]}`);

/**
 * Run the disk's own `INITIALS` for one game.
 *
 * The score comes from the five interface bytes lines 2010-2016 read, and the letters are
 * typed at line 170's `GET` the way a player types them: three and a RETURN.
 *
 * @param {object} opts `kills` the three counters, `bonus` $1FF4, `won` $1FFF, `letters` the
 *   three typed, `store` a `Saves` or null, `show` an existing session to play on again
 */
function play({ kills = [10, 5, 2], bonus = 3, won = true, letters = 'ZZZ', store = null,
  show = null } = {}) {
  const s = show ?? new Presentation(image, { store });
  s.mem[0x1FFC] = kills[0];
  s.mem[0x1FFD] = kills[1];
  s.mem[0x1FFE] = kills[2];
  s.mem[0x1FF4] = bonus;
  s.mem[0x1FFF] = won ? 1 : 0;
  s.load('INITIALS');
  const typed = [...letters, String.fromCharCode(13)];
  let i = 0, next = null;
  for (let step = 0; step < 400; step++) {
    const r = s.run({ maxChains: 0 });
    if (r.waiting === WAITING.key) { s.key(typed[i++ % typed.length]); continue; }
    if (r.next) { next = r.next; break; }
    if (r.waiting === WAITING.ended) break;
  }
  return { show: s, next, records: s.host.files.get(SCORES) ?? null };
}

console.log('=== the high-score file ===');

// ---------------------------------------------------------------- what is on the disk ------
{
  const live = onDisk.slice(0, 14);
  const past = onDisk.slice(14).filter((r) => r && r.charCodeAt(0) !== 0);
  check('the disk\'s file is a cleared table, and a longer one is still behind it',
    live.join(',') === CLEARED.join(',') && past.length > 0,
    `fourteen records of ${CLEARED[0]}/${CLEARED[1]}, then ${past.length} more`
      + ` - ${past.slice(0, 4).join(', ')} and so on. DOS does not truncate a text file, so`
      + ' a shorter save leaves the longer one it was written over in place');
}

// ---------------------------------------------------------------- what INITIALS works out --
// Lines 2010-2017: 300 a fighter, 600 a cruiser, 800 a base, 500 a flight survived, and
// 10,000 for the base star if `$1FFF` says it died.
{
  const r = play({ letters: 'ZZZ' });
  check('a game that makes the table writes the letters typed and the score lines 2010-2017 add up',
    r.records && r.records[0] === 'ZZZ' && r.records[1] === '19100',
    `${r.records?.[0]} ${r.records?.[1]} - 10x300 + 5x600 + 2x800 is 7,600, three flights`
      + ' survived is 1,500, and the base star is 10,000');

  // And the 10,000 is line 2016's, not part of the rest of it.
  const lost = play({ won: false, letters: 'ZZZ' });
  check('and the base star\'s ten thousand is only there when $1FFF says it died',
    lost.records && lost.records[1] === '9100',
    `the same kills with the base star alive come to ${lost.records?.[1]}, which is 19,100`
      + ' less line 2016');
}

// ---------------------------------------------------------------- a DOS write --------------
// Three games in one session. Each save goes in at the front of the file, over the last one.
{
  const first = play({ kills: [10, 0, 0], bonus: 0, won: false, letters: 'ZZZ' });
  const second = play({ kills: [20, 0, 0], bonus: 0, won: false, letters: 'YYY',
    show: first.show });
  const third = play({ kills: [30, 0, 0], bonus: 0, won: false, letters: 'XXX',
    show: second.show });
  const rows = table(third.records);
  check('three games in a row leave a table of the three of them, best first',
    rows[0] === 'XXX 9000' && rows[1] === 'YYY 6000' && rows[2] === 'ZZZ 3000'
      && rows.slice(3).every((x) => x === 'AAA 0'),
    rows.join(' | '));

  check('and what was past the seven rows is untouched, because a DOS write does not truncate',
    third.records.slice(14).join(CR) === onDisk.slice(14).join(CR),
    `${third.records.length - 14} records past the table, the same ones the disk has`);

  // The control, and it is run rather than described: put the old rule back into the host -
  // each record goes on the end of the file instead of at the file's own position - and play
  // the same games through it. One game could not tell the difference, which is why this went
  // unnoticed: the file it wrote was empty, so the end of it and the front of it were the
  // same place.
  const legacy = new Presentation(image);
  const atPosition = legacy.host.writeToFile.bind(legacy.host);
  legacy.host.writeToFile = (text, newline) => {
    legacy.host.file.pos = legacy.host.file.records.length;
    atPosition(text, newline);
  };
  play({ kills: [10, 0, 0], bonus: 0, won: false, letters: 'ZZZ', show: legacy });
  const appended = play({ kills: [20, 0, 0], bonus: 0, won: false, letters: 'YYY',
    show: legacy }).records;
  check("control: writing to the end of the file instead leaves the author's table in front",
    table(appended)[0] === 'AAA 0' && appended.indexOf('YYY') > 14,
    `the rows a player is shown are ${table(appended).slice(0, 2).join(' | ')}, with both`
      + ` games' scores written off the end of the table at record ${appended.indexOf('ZZZ')}`
      + ' and beyond');
}

// ---------------------------------------------------------------- and it persists ----------
{
  const storage = makeStorage();
  const saves = new Saves(storage);
  play({ kills: [10, 0, 0], bonus: 0, won: false, letters: 'ZZZ', store: saves });

  // A second session, a second 64K image, a second interpreter - and the same store.
  const later = play({ kills: [20, 0, 0], bonus: 0, won: false, letters: 'YYY',
    store: new Saves(storage) });
  const rows = table(later.records);
  check('a score set in one session is on the table in the next',
    rows[0] === 'YYY 6000' && rows[1] === 'ZZZ 3000',
    `${rows.slice(0, 2).join(' | ')} - two sessions, two images, one store`);

  check('and what is stored is the file itself, carriage returns and all',
    storage.items.get(`star-destroyer/${SCORES}`).split(CR).join(',')
      === later.records.join(','),
    `${storage.items.get(`star-destroyer/${SCORES}`).length} characters, which split on`
      + ' $0D are the records - so a stored table can be read beside the disk\'s own bytes');

  // The control: without a store the second session reads the disk, and the first game is gone.
  const forgetful = play({ kills: [20, 0, 0], bonus: 0, won: false, letters: 'YYY' });
  check('control: with nothing keeping it, the next session has the author\'s table again',
    table(forgetful.records)[1] === 'AAA 0',
    `the second row is ${table(forgetful.records)[1]} rather than the last game's -`
      + ' which is what the page did on every reload');
}

// ---------------------------------------------------------------- a store that refuses -----
// Same rule as the speaker: `localStorage` is absent in some private windows, throws on read
// where site data is blocked and throws on write where the origin is full. None of that is
// worth a stopped game.
{
  const saves = new Saves(makeStorage({ refuse: 'the quota has been exceeded' }));
  const r = play({ letters: 'ZZZ', store: saves });
  check('a store that throws on every call does not stop the game',
    r.next === 'START' && r.records && r.records[0] === 'ZZZ',
    `INITIALS finished and line 6000 chained to ${r.next}, with the table kept for the`
      + ' session and nowhere else');

  check('and it says why, once, and says it did not keep them',
    typeof saves.broken === 'string' && saves.broken.includes('quota')
      && saves.write(SCORES, CLEARED) === false,
    `broken is ${JSON.stringify(saves.broken)} - the first reason, kept, the way a broken`
      + ' speaker is');
}

// ---------------------------------------------------------------- CLEAR SCORES -------------
// The author shipped a two-line utility beside the game and nothing on the disk runs it. Once
// the table persists, there has to be a way back to an empty one.
{
  const storage = makeStorage();
  const saves = new Saves(storage);
  play({ letters: 'ZZZ', store: saves });
  const before = saves.read(SCORES);
  saves.clearScores();
  const after = saves.read(SCORES);
  check('CLEAR SCORES puts back the fourteen records it writes, and leaves the rest',
    before[0] === 'ZZZ' && after.slice(0, 14).join(',') === CLEARED.join(',')
      && after.slice(14).join(CR) === before.slice(14).join(CR),
    `${before[0]} ${before[1]} becomes ${after[0]} ${after[1]}, with the ${after.length - 14}`
      + ' records behind the table where they were');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
