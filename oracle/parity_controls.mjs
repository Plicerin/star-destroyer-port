// The port's flight controls against the game binary's, frame by frame.
//
// The first piece of STAR DESTROYER.OBJ0 to be ported, and the pattern the rest of the
// game logic should follow: drive the real machine through a scripted input, record the
// display-list byte the game writes on every frame, and require the port to produce the
// same sequence from the same inputs.
//
// It is a sequence rather than an endpoint deliberately. A rule that turns at the right
// rate but starts a frame late, or applies the dead zone on the wrong side of the
// comparison, lands on the same heading eventually; it does not produce the same heading
// on every frame along the way.
//
// Scope: this covers the steering only. The binary runs about 401 instructions a frame
// and this is a dozen of them. What it does establish is that the arbiter works - the
// game's output is display-list bytes, and those can be compared exactly.
import { openOracle } from './a2.mjs';
import { toFlight } from './exercise.mjs';
import { steer, applySteering, DEAD_ZONE, TURN_RATE, H1, OBJ12_HEADING }
  from '../port/src/game/controls.js';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};

const a2 = await openOracle();
const flight = await toFlight(a2);
check('the oracle reaches flight', flight.difficulty === 1);

// Watch the game's own frame boundary - the JSR to the renderer - and sample the heading
// at each one, so the port's steps and the game's frames line up exactly.
await a2.ev(`(() => {
  window.M.frameHeadings = (frames) => {
    const cpu = window.M.cpu, rd = window.M.rd;
    const out = [];
    cpu.stepCyclesDebug(17030 * 4000, () => {
      if (cpu.getPC() !== 0x6000) return;
      out.push([rd(${H1}), rd(${OBJ12_HEADING})]);
      if (out.length >= frames) return true;
    });
    return out;
  };
  return 'ok';
})()`);
const setPaddle = (v) => a2.ev(`(() => { window.M.a2.getIO().paddle(0, ${v}); return 'p'; })()`);

/**
 * The paddle positions used, and the PREAD reading each one produces.
 *
 * The extremes and the centre are used because PREAD's timing loop is not modelled in the
 * port - the port is given the reading, not the stick position - and at the ends of the
 * travel the reading is unambiguous.
 */
const STICK = { left: [0.0, 0x00], centre: [0.5, 0x80], right: [1.0, 0xFF] };

/** Run a script of [position, frames] through the machine and through the port. */
const FLUSH = 2;
async function script(name, steps) {
  const theirs = [], ours = [];
  for (const [where, frames] of steps) {
    const [position, reading] = STICK[where];
    await setPaddle(position);
    // Moving the stick lands at an arbitrary point inside the game's frame, so the first
    // sample or two were taken before the new reading reached the paddle read at $09A5.
    // Two frames are discarded to flush that, and the port is then started from where the
    // game is and stepped once per frame. The claim under test is the per-frame
    // evolution, not the alignment of my own sampling.
    const seen = JSON.parse(await a2.ev(`JSON.stringify(window.M.frameHeadings(${frames + FLUSH}))`))
      .slice(FLUSH);
    let heading = seen[0][0];
    for (let i = 1; i < seen.length; i++) {
      heading = steer(heading, reading);
      theirs.push(seen[i]);
      ours.push([heading, heading]);
    }
  }
  const wrong = [];
  for (let i = 0; i < theirs.length; i++) {
    if (theirs[i][0] !== ours[i][0] || theirs[i][1] !== ours[i][1]) {
      wrong.push(`frame ${i}: engine ${theirs[i]}, port ${ours[i]}`);
    }
  }
  console.log(`  ${name.padEnd(42)} ${wrong.length === 0 ? 'identical' : wrong.length + ' of ' + theirs.length + ' frames differ'}`);
  if (wrong.length) console.log(`     ${wrong.slice(0, 3).join(' | ')}`);
  console.log(`     engine: ${theirs.slice(0, 14).map((h) => h[0]).join(' ')}${theirs.length > 14 ? ' ...' : ''}`);
  return wrong.length;
}

console.log('\n=== the heading, frame by frame ===');
let failures = 0;
failures += await script('hard right for 8 frames', [['right', 8]]);
failures += await script('hard left for 8 frames', [['left', 8]]);
// A centred stick holds the heading still, so this one passes whatever the rule is. It
// is here to show the dead zone really is dead, and it carries no weight on its own.
failures += await script('centred for 6 frames', [['centre', 6]]);
failures += await script('right, centre, left, centre',
  [['right', 5], ['centre', 4], ['left', 5], ['centre', 4]]);
failures += await script('alternating ends', [['right', 3], ['left', 3], ['right', 3], ['left', 3]]);
// Long enough to carry the byte past 255 and back round, since the engine's angles wrap.
failures += await script('right for 50 frames, through the wrap', [['right', 50]]);
check('the port produces the same heading on every frame, not just at the end',
  failures === 0, failures ? `${failures} frames differ` : 'six scripts');

// --- the shape of the rule, checked on its own -------------------------------------------
console.log('\n=== the rule ===');
{
  check('the dead zone is 100 to 154 inclusive',
    steer(50, 99) === 47 && steer(50, 100) === 50 && steer(50, 154) === 50 && steer(50, 155) === 53,
    `99 turns, ${DEAD_ZONE[0]}..${DEAD_ZONE[1]} does not, 155 turns`);
  check('the turn is a flat three a frame, not proportional to the stick',
    steer(0, 155) === TURN_RATE && steer(0, 255) === TURN_RATE,
    'just over the threshold and hard over give the same turn');
  check('the heading wraps as a byte, because angles are one byte to the turn',
    steer(254, 255) === 1 && steer(1, 0) === 254);
  const mem = new Uint8Array(0x10000);
  mem[H1] = 100;
  applySteering(mem, 255);
  check('and it is written to both the viewer and object 12',
    mem[H1] === 103 && mem[OBJ12_HEADING] === 103, 'the same value to $811E and $8251');
}

await a2.close();
fs.mkdirSync('captured/parity', { recursive: true });
fs.writeFileSync('captured/parity/controls.json', JSON.stringify({ results }, null, 1) + '\n');

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `parity_controls: all ${results.length} checks passed`
  : `parity_controls: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
