// The port's music player against the machine's, toggle for toggle.
//
// `probe_music.mjs` established the format and the four self-modifying sites. This holds the
// transliteration to the thing itself: run PLAYER.MODULE on the real tunes in the oracle,
// record the cycle number of every speaker access, and compare the complete list against what
// `port/src/game/music.js` computes. Not a summary of it, not a count - the list.
//
// That is the only comparison worth making for a square-wave player, because the cycle
// numbers *are* the sound. A port that got the loop right and one branch's cycle cost wrong
// would produce the same notes at a slightly wrong pitch, which no count would catch and this
// catches on the first toggle that drifts.
import { openOracle } from './a2.mjs';
import { openDisk, DISK } from './dsk.mjs';
import { play, records, EOR, CMP } from '../port/src/game/music.js';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const d = openDisk(DISK);
const PLAYER = d.read(d.files.find((x) => x.name === 'PLAYER.MODULE'));
const TUNES = ['M.STAR DESTROYER', 'M.END'];
const TUNE_AT = 0x6000;
const WANT = 400;

const a2 = await openOracle();
const machine = {};
try {
  await a2.coldStart({ fill: 0x00 });
  for (let i = 0; i < 40; i++) {
    await a2.waitMs(500);
    if ((await a2.screen()).some((r) => r.includes('STARSHIP BATTLE'))) break;
  }
  for (const name of TUNES) {
    const t = d.read(d.files.find((x) => x.name === name));
    machine[name] = JSON.parse(await a2.ev(`(() => {
      const cpu = window.M.cpu, wr = window.M.wr;
      const player = ${JSON.stringify([...PLAYER.data])};
      const tune = ${JSON.stringify([...t.data])};
      for (let i = 0; i < player.length; i++) wr(0x0300 + i, player[i]);
      for (let i = 0; i < tune.length; i++) wr(${TUNE_AT} + i, tune[i]);
      wr(0x1E, ${TUNE_AT & 0xFF}); wr(0x1F, ${(TUNE_AT >> 8) & 0xFF});
      wr(0xC010, 0);
      const st = cpu.getState(); st.pc = 0x0300; st.sp = 0xF8; cpu.setState(st);
      const SITES = new Set([0x0362, 0x036C, 0x0396, 0x03A3]);
      const toggles = [];
      const start = cpu.getCycles();
      let prev = 0x0300;
      cpu.stepCyclesDebug(4000000, () => {
        if (SITES.has(prev)) toggles.push(cpu.getCycles() - start);
        prev = cpu.getPC();
        if (toggles.length >= ${WANT}) return true;
      });
      return JSON.stringify({ toggles });
    })()`));
  }
} finally {
  await a2.close();
}

console.log('\n=== the port against the machine ===');
const ports = {};
for (const name of TUNES) {
  const t = d.read(d.files.find((x) => x.name === name));
  ports[name] = play(t.data, { maxToggles: WANT });
  const m = machine[name].toggles, p = ports[name].toggles;
  let first = -1;
  for (let i = 0; i < Math.min(m.length, p.length); i++) {
    if (m[i] !== p[i]) { first = i; break; }
  }
  const same = first === -1 && m.length === p.length;
  console.log(`  ${name.padEnd(18)} machine ${m.length} toggles to cycle ${m[m.length - 1]},`
    + ` port ${p.length} to ${p[p.length - 1]}`
    + (same ? '  - identical'
      : `  - first difference at ${first}: machine ${m[first]}, port ${p[first]}`));
}
{
  const bad = TUNES.filter((n) => {
    const m = machine[n].toggles, p = ports[n].toggles;
    return m.length !== p.length || m.some((v, i) => v !== p[i]);
  });
  check(`every one of the first ${WANT} toggles is on the same cycle, for both tunes`,
    bad.length === 0,
    bad.length ? `differs on: ${bad.join(', ')}`
      : `${WANT * 2} cycle numbers, exactly - which is the sound, not a summary of it`);
}

// ---------------------------------------------------------------- the format ------------
console.log('\n=== the records the port reads ===');
{
  const bad = [];
  for (const name of TUNES) {
    const t = d.read(d.files.find((x) => x.name === name));
    const r = records(t.data);
    const bytes = r.length * 3;
    if (t.data[bytes] !== 0) bad.push(`${name}: byte ${bytes} is ${t.data[bytes]}, not 0`);
    console.log(`  ${name.padEnd(18)} ${r.length} records, ${bytes} bytes, then the`
      + ` terminator`);
  }
  check('the port reads both tunes to their terminator and no further',
    bad.length === 0, bad.join('; ') || 'so the record walk agrees with the file');
}

// ---------------------------------------------------------------- controls --------------
console.log('\n=== controls ===');
{
  const t = d.read(d.files.find((x) => x.name === TUNES[0]));
  const truth = ports[TUNES[0]].toggles;

  // A key cuts the tune short - the reason SELECT does not make you sit through it.
  const cut = play(t.data, { maxToggles: WANT, keyAt: truth[50] });
  check('a key pending stops the player, as $0371 BIT $C000 says it must',
    cut.ended === 'key' && cut.toggles.length < truth.length && cut.toggles.length > 0,
    `${cut.toggles.length} toggles instead of ${truth.length}, then it returns`);

  // A rest is a voice that does not toggle. Zero one voice's periods and the waveform must
  // change - if it did not, the EOR/CMP patch would be doing nothing.
  const quiet = Uint8Array.from(t.data);
  for (let p = 0; p + 2 < quiet.length; p += 3) {
    if (quiet[p] === 0) break;
    if (quiet[p] !== 1) quiet[p + 1] = 0;
  }
  const rested = play(quiet, { maxToggles: WANT });
  check('control: silencing voice 1 changes the waveform, so the EOR/CMP patch matters',
    rested.toggles.join(',') !== truth.join(','),
    `${rested.toggles.length} toggles against ${truth.length} - the patch at $0383 is what`
      + ' turns a voice off, and a port that ignored it would come out identical here');

  // And the octave shift: doubling it should move the toggles.
  const octave = Uint8Array.from(t.data);
  const shifted = play(octave, { maxToggles: 40 });
  const faster = play(Uint8Array.from([1, 2, 2, ...octave]), { maxToggles: 40 });
  check('control: a leading control record changes the pitch, so the shift is read',
    shifted.toggles.join(',') !== faster.toggles.join(','),
    'adding `01 02 02` in front halves both periods, and the toggle list moves');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
