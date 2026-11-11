// The page's wiring: which control reaches which driver.
//
// `probe_shell.mjs` holds `Boot` itself. This holds the layer above it - `page.js`, which was
// two hundred lines inside `index.html` where nothing could reach it. That is where the bugs
// the owner found actually lived: mute, tint and frames/sec bound to `shell` so that booting
// the disk left all three setting properties on an object that was not running, and `fly()`
// stopping the shell while leaving the boot's loop alive on the same canvas.
//
// There is no emulator here and no disk. `wire` takes its two driver classes as arguments, so
// the drivers are stubs that record what was done to them, and the document is an object with
// `getElementById`. What is being checked is the wiring and nothing else.
const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `   ${detail}` : ''}`);
};

// ------------------------------------------------------------------ a document, in miniature
/** An element that remembers what was set on it and who is listening. */
function makeElement(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    /** Fire a handler the way a click or a change does. */
    fire(type, event = {}) {
      for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this, ...event });
    },
  };
}

function makeDocument() {
  const els = new Map();
  return {
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeElement(id));
      return els.get(id);
    },
  };
}

// ------------------------------------------------------------------ drivers that only record
/** What both drivers have in common, as far as the page is concerned. */
class StubDriver {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.tint = opts.tint ?? 'colour';
    this.fps = opts.fps ?? 2.57;
    this.paused = false;
    this.stopped = false;
    this.started = false;
    this.draws = 0;
    this.audio = {
      muted: null,
      resumed: 0,
      setMuted(m) { this.muted = m; },
      resume() { this.resumed += 1; },
    };
  }

  draw() { this.draws += 1; }

  start() { this.started = true; return this; }

  stop() { this.stopped = true; }
}

class StubShell extends StubDriver {
  constructor(canvas, opts) {
    super(canvas, opts);
    StubShell.made.push(this);
    this.loaded = null;
  }

  load(image, difficulty) {
    this.loaded = { image, difficulty };
    return { loaded: [] };
  }

  reason() { return null; }

  status() {
    return {
      shields: 244, warp: 244, missiles: 244, hits: 0, fatal: 4, empty: 0xC7, step: 4,
      waves: [1, 2, 3], kills: [0, 0, 0], passes: 0, sounds: [], paused: this.paused,
      intended: { waves: [1, 2, 3], target: 5 },
    };
  }
}
StubShell.made = [];

class StubBoot extends StubDriver {
  constructor(canvas, image, opts) {
    super(canvas, opts);
    this.image = image;
    StubBoot.made.push(this);
  }
}
StubBoot.made = [];

const { wire } = await import('../port/src/shell/page.js');

/** A freshly wired page, with the stubs and nothing real. */
function page() {
  StubShell.made.length = 0;
  StubBoot.made.length = 0;
  const doc = makeDocument();
  const sd = wire(doc, {
    Shell: StubShell,
    Boot: StubBoot,
    HELP: [['P', 'pause']],
    FPS_CHOICES: [{ fps: 2.57, label: 'the disk' }, { fps: 60, label: 'absurd' }],
    DISK_FPS: 2.57,
    fetchImage: async () => new Uint8Array([1, 2, 3]),
    log: { log() {}, error() {} },
  });
  return { doc, sd, $: (id) => doc.getElementById(id) };
}

console.log('=== the page\'s wiring ===');

// ---------------------------------------------------------------- the controls follow ------
// The bug the owner reported: with the disk booted, the mute checkbox set `shell.audio`, which
// was not the object making the sound. Tint and frames/sec were just as dead, and failed
// silently where mute at least could be heard not working.
{
  const { sd, $ } = page();
  await sd.bootDisk();
  const boot = StubBoot.made[0];
  const shell = StubShell.made[0];

  $('mute').checked = true;
  $('mute').fire('change');
  $('tint').value = 'amber';
  $('tint').fire('change');
  $('fps').value = '60';
  $('fps').fire('change');

  check('with the disk booted, mute, tint and frames/sec all reach the boot',
    boot.audio.muted === true && boot.tint === 'amber' && boot.fps === 60,
    `muted ${boot.audio.muted}, tint ${boot.tint}, fps ${boot.fps}`);

  check('and none of them touches the shell, which is not the one running',
    shell.audio.muted === null && shell.tint === 'colour' && shell.fps === 2.57,
    `the idle shell still reads muted ${shell.audio.muted}, tint ${shell.tint},`
      + ` fps ${shell.fps}`);

  check('the tint also repaints, because a stopped loop will not do it for you',
    boot.draws > 0, `${boot.draws} draw after the tint changed`);
}

// ---------------------------------------------------------------- and back to the shell ----
{
  const { sd, $ } = page();
  await sd.bootDisk();
  await sd.fly();
  const boot = StubBoot.made[0];
  const flying = StubShell.made[StubShell.made.length - 1];

  check('flying after a boot stops the boot, rather than leaving both loops on one canvas',
    boot.stopped === true && sd.boot === null && sd.active() === flying,
    `the boot is stopped and dropped, and the controls now point at the ${flying.constructor.name}`);

  $('mute').checked = true;
  $('mute').fire('change');
  check('and the controls follow it back',
    flying.audio.muted === true && boot.audio.muted !== true,
    `the flight reads muted ${flying.audio.muted}, the stopped boot ${boot.audio.muted}`);
}

// ---------------------------------------------------------------- the mute state carries ---
// Booting with the box already ticked used to come up loud: `bootDisk` applied fps and tint to
// the new driver and not mute.
{
  const { sd, $ } = page();
  $('mute').checked = true;
  $('fps').value = '60';
  $('tint').value = 'amber';
  await sd.bootDisk();
  const boot = StubBoot.made[0];
  check('a driver is built with the settings already on the page, mute included',
    boot.audio.muted === true && boot.fps === 60 && boot.tint === 'amber',
    `built muted ${boot.audio.muted}, fps ${boot.fps}, tint ${boot.tint}`);
}

// ---------------------------------------------------------------- pause ---------------------
{
  const { sd, $ } = page();
  await sd.bootDisk();
  const boot = StubBoot.made[0];
  check('the pause button is live once the disk is booted',
    $('pause').disabled === false,
    'it was disabled whenever the disk was booted, because Boot had no pause at all');

  $('pause').fire('click');
  check('and it reaches the boot, and says so on the button',
    boot.paused === true && $('pause').textContent === 'Resume',
    `paused ${boot.paused}, button reads "${$('pause').textContent}"`);

  $('pause').fire('click');
  check('and again to resume',
    boot.paused === false && $('pause').textContent === 'Pause',
    `paused ${boot.paused}, button reads "${$('pause').textContent}"`);
}

// ---------------------------------------------------------------- the ship panel ------------
// Under the chain these four rows sat at em-dashes for the whole of a flight.
{
  const { sd, $ } = page();
  await sd.bootDisk();
  const chain = { program: 'LOGO1', display: 'text', flights: 0, state: 'chain',
    empty: 0xC7, step: 4, shields: 0, warp: 0, missiles: 0, hits: 0, fatal: 4 };
  sd.showChain(chain);
  const idle = $('s-shields').textContent;

  sd.showChain({ ...chain, state: 'flight', program: 'SD PART2', flights: 1,
    shields: 244, warp: 240, missiles: 243, hits: 1 });
  check('the gauges fill in once a flight is running and are blank before it',
    idle === '—' && $('s-shields').textContent.startsWith('244')
      && $('s-hits').textContent === '1 of 4',
    `"${idle}" on a title screen and "${$('s-shields').textContent}" in flight`);

  sd.showChain({ ...chain, state: 'flight', finale: true, fatal: 2, hits: 1 });
  check('and the panel says which mission it is, because the finale dies at two',
    $('l-passes').textContent === 'flights · FINALE' && $('s-hits').textContent === '1 of 2',
    `"${$('l-passes').textContent}" and hits "${$('s-hits').textContent}"`);

  sd.showChain({ ...chain, silent: 'no speaker' });
  check('and it says when the sound has gone rather than going quiet about it',
    $('over').textContent.includes('no speaker')
      && $('over').textContent.includes('carries on'),
    `"${$('over').textContent}"`);
}

// ---------------------------------------------------------------- a load that fails ---------
// The disk is fetched, and a fetch can fail. It used to leave the button saying "Booting…".
{
  const doc = makeDocument();
  StubShell.made.length = 0;
  const sd = wire(doc, {
    Shell: StubShell,
    Boot: StubBoot,
    HELP: [['P', 'pause']],
    FPS_CHOICES: [{ fps: 2.57, label: 'the disk' }],
    DISK_FPS: 2.57,
    fetchImage: async () => { throw new Error('could not fetch the disk image: 404'); },
    log: { log() {}, error() {} },
  });
  await sd.bootDisk();
  check('a disk that will not load says so, and leaves the button usable',
    doc.getElementById('over').textContent.includes('404')
      && doc.getElementById('boot').disabled === false,
    `"${doc.getElementById('over').textContent}", button disabled`
      + ` ${doc.getElementById('boot').disabled}`);
}

// ---------------------------------------------------------------- the control ---------------
// Every check above would pass against a page that wired everything to one driver, if that
// driver happened to be the running one. So: wire it the old way and watch mute miss.
{
  const { sd, $ } = page();
  await sd.bootDisk();
  const boot = StubBoot.made[0];
  const shell = StubShell.made[0];
  // What the page used to do - `shell.audio`, whoever is running.
  shell.audio.setMuted(true);
  check('control: the binding this page used to have sets the idle driver instead',
    shell.audio.muted === true && boot.audio.muted !== true,
    'which is exactly the report - the checkbox moved, and the sound did not');
}

console.log('');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks FAILED`
  : `all ${results.length} checks passed`);
process.exit(failed.length);
