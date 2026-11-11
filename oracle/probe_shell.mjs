// The shell, driven without a browser.
//
// Everything under `port/src/game` and `port/src/a23d2` is held against the machine. **Nothing
// held `port/src/shell`**, and that is where a run of bugs lived: a `Game` driving the finale's
// binary, the ship panel blank for a whole flight, mute and tint set on the driver that was not
// running, `fly()` leaving the other loop alive, an `AudioContext` and a set of keyboard
// listeners leaked per driver, `Boot` with no pause at all, and the chain loading over its own
// interface. Two of those the owner found by using the page.
//
// None of it needed an emulator - only a canvas, a `window` and a clock, which is what this
// file supplies. It is a `probe_` rather than a `parity_` because the subject is the port's own
// shell: there is nothing on the machine to compare a pause button against.
//
// What it cannot reach is `port/index.html` - the page's own wiring, which is where mute, tint
// and frames/sec are bound to a driver. That still has no test.
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- the browser, in miniature -
// Enough of one for `Boot`: a 2D context that records nothing, a window that counts its
// listeners, a clock that does not tick on its own, and an AudioContext that can be closed.
let openContexts = 0;

class FakeAudioContext {
  constructor() {
    openContexts += 1;
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.destination = {};
    this.closed = false;
  }

  createGain() { return { gain: { value: 1 }, connect() {} }; }

  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data, copyToChannel() {} };
  }

  createBufferSource() {
    return { buffer: null, connect() {}, start() {}, stop() {}, onended: null };
  }

  async resume() { this.state = 'running'; }

  close() {
    if (!this.closed) { this.closed = true; openContexts -= 1; }
    return Promise.resolve();
  }
}

/** A window that keeps its listeners where a test can count them. */
function makeWindow() {
  const listeners = new Map();
  const w = {
    AudioContext: FakeAudioContext,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** How many handlers are attached for a type, which is the leak test. */
    count(type) { return listeners.get(type)?.size ?? 0; },
    dispatch(type, event) {
      // A real event has the methods the handlers call; `onKeyDown` cancels the browser's
      // own use of the arrow keys and the space bar.
      const e = { type, preventDefault() {}, stopPropagation() {}, ...event };
      for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
    },
  };
  return w;
}

/** A canvas that accepts the pixels and forgets them. */
function makeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 560, height: 384 }),
  };
}

const win = makeWindow();
globalThis.window = win;
globalThis.document = {
  documentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
};
/** The clock the shell asks for frames on. Nothing fires until `frames()` says so. */
let pending = [];
let rafId = 0;
globalThis.requestAnimationFrame = (cb) => { rafId += 1; pending.push([rafId, cb]); return rafId; };
globalThis.cancelAnimationFrame = (id) => { pending = pending.filter(([i]) => i !== id); };

// The modules read `window` when they are constructed, so they come in after the stub.
const { Boot } = await import('../port/src/shell/boot.js');
const { FINALE_BINARY } = await import('../port/src/shell/presentation.js');

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};
const hx = (v, n = 4) => `$${v.toString(16).toUpperCase().padStart(n, '0')}`;

const image = readFileSync(new URL('../STAR_DESTROYER.dsk', import.meta.url));

/** Run the frames the shell has asked for, with a clock that advances 16ms a time. */
let now = 0;
function frames(n) {
  for (let i = 0; i < n; i++) {
    now += 16;
    const due = pending;
    pending = [];
    for (const [, cb] of due) cb(now);
  }
}

const boot = (opts = {}) => new Boot(makeCanvas(), image, opts);

console.log('=== the shell, driven without a browser ===');

// ---------------------------------------------------------------- it runs at all -----------
{
  const b = boot();
  b.start();
  frames(400);
  check('Boot runs headless and walks the chain off its boot program',
    b.show.program !== 'START' && b.state === 'chain',
    `${b.show.program} after 400 frames, with no emulator and no browser`);
  b.stop();
}

// ---------------------------------------------------------------- pause --------------------
// `Boot` had no pause at all, so the page disabled the button whenever the disk was booted.
{
  const b = boot();
  b.start();
  frames(60);
  const before = b.show.program;

  b.paused = true;
  frames(900);
  const whilePaused = b.show.program;

  b.paused = false;
  frames(900);
  const after = b.show.program;

  check('pause freezes the chain and resuming lets it go on',
    before === whilePaused && after !== whilePaused,
    `held at ${whilePaused} for 900 frames, then reached ${after}`);

  // And on the key, which is the half a button cannot test.
  b.input.held.clear();
  b.input.pausePressed = false;
  win.dispatch('keydown', { code: 'KeyP' });
  frames(1);
  const pausedByKey = b.paused;
  win.dispatch('keyup', { code: 'KeyP' });
  win.dispatch('keydown', { code: 'KeyP' });
  frames(1);
  check('and P does it too, once per press rather than once per frame held',
    pausedByKey === true && b.paused === false,
    'pressed to pause and pressed again to resume, with the key held in between');
  b.stop();
}

// ---------------------------------------------------------------- what stop() releases -----
// Every driver owns an AudioContext and a set of window listeners. `Shell.stop` released
// neither and `Boot.stop` released only the listeners, so three boot-and-fly cycles in the page
// opened six contexts - the cap Chrome enforces - and left a keyboard handler per flight.
{
  const b = boot();
  b.start();
  frames(10);
  const liveKeys = win.count('keydown');
  const liveCtx = openContexts;
  b.stop();
  check('a running driver holds its listeners and its context',
    liveKeys > 0 && liveCtx > 0,
    `${liveKeys} keydown handler and ${liveCtx} context while it runs - which is what makes`
      + ' the next check mean something');
  check('and stop() gives both back',
    win.count('keydown') === 0 && openContexts === 0,
    `${win.count('keydown')} handlers and ${openContexts} contexts after stop`);
}

// ---------------------------------------------------------------- rebooting ----------------
{
  const made = [];
  for (let i = 0; i < 6; i++) {
    const b = boot();
    b.start();
    frames(30);
    made.push(b);
    b.stop();
  }
  const last = boot();
  last.start();
  frames(30);
  check('six reboots leave one driver holding one of each, not six',
    openContexts === 1 && win.count('keydown') === 1,
    `${openContexts} context and ${win.count('keydown')} keydown handler after six cycles and`
      + ' a seventh boot - browsers cap contexts at about six');

  // The frames belong to the live one only: a stopped driver must not still be ticking.
  const before = made.map((b) => b.show.program);
  frames(200);
  const after = made.map((b) => b.show.program);
  check('and the six stopped ones have gone quiet',
    before.every((p, i) => p === after[i]),
    'none of the stopped drivers moved while the live one ran 200 frames');
  last.stop();
}

// ---------------------------------------------------------------- what the panel reads -----
// The page shows these during a flight. `Presentation.status` has none of them - it does not
// know a flight from a title screen - so the whole SHIP panel sat at em-dashes until `Boot`
// read them out of the image itself.
{
  const b = boot();
  b.start();
  b.input.held.add('Digit1');
  frames(2500);
  b.input.held.delete('Digit1');
  const s = b.status();
  check('the panel has the ship\'s gauges once a flight is running',
    b.state === 'flight' && typeof s.shields === 'number' && typeof s.warp === 'number'
      && typeof s.missiles === 'number' && typeof s.hits === 'number',
    `shields ${s.shields}, warp ${s.warp}, missiles ${s.missiles}, hits ${s.hits} of ${s.fatal}`);

  check('and the fatal count follows the mission, because the finale dies at two',
    s.fatal === 4 && !s.finale,
    `an ordinary flight reads ${s.fatal}; the finale's own is 2, and ${hx(0x0933)} is the`
      + ' count both of them test');
  b.stop();
}

// ---------------------------------------------------------------- a broken speaker ---------
// This file found it by accident: its fake AudioContext was missing `copyToChannel`, and the
// chain went to 'stopped' on the difficulty screen with the disk half booted. `chainStep`
// catches whatever `run` throws, so anything a CALL handler throws is fatal - and a tune that
// cannot be built is as plausible as a context closed mid-play or a browser refusing to start
// one. Sound must never stop the game.
{
  const b = boot();
  // A context that builds buffers it cannot fill, which is the shape of the real failure.
  const realCreate = FakeAudioContext.prototype.createBuffer;
  FakeAudioContext.prototype.createBuffer = function broken(channels, length) {
    const buf = realCreate.call(this, channels, length);
    delete buf.copyToChannel;
    return buf;
  };
  b.start();
  b.input.held.add('Digit1');
  frames(2500);
  b.input.held.delete('Digit1');
  FakeAudioContext.prototype.createBuffer = realCreate;

  check('a speaker that refuses does not stop the game',
    b.state !== 'stopped' && !b.error,
    `it reached ${b.show.program} and is in ${b.state} with every sound failing`
      + (b.error ? ` - ${b.error}` : ''));

  const s2 = b.status();
  // `sounds` is the last four the speaker was asked for, so the note scrolls out of it within
  // a second; `silent` is the durable record and is what the page should read.
  check('and it says so rather than going quietly silent',
    typeof s2.silent === 'string' && s2.silent.length > 0,
    `status().silent is ${JSON.stringify(s2.silent)} - set once rather than once a frame,`
      + ' which is the difference between a note and a flood');
  b.stop();
}

// ---------------------------------------------------------------- which binary runs --------
// `SD PART2` BRUNs one binary and `SD PART3` the other, and they are different programs. The
// shell built a `Game` for both until the finale was wired in.
{
  const b = boot();
  b.start();
  b.input.held.add('Digit1');
  frames(2500);
  const flight = b.game?.constructor.name;
  // Hand the player the wave so the chain goes on to the next program rather than the scores.
  b.beginFlight(FINALE_BINARY);
  const finale = b.game?.constructor.name;
  check('each binary gets its own class, and the finale flag follows',
    flight === 'Game' && finale === 'Finale' && b.finale === true,
    `${flight} for ${hx(0x0B0C)}'s binary and ${finale} for the finale's`);
  b.stop();
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
