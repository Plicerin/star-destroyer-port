// The page's wiring: which control talks to which driver.
//
// This was two hundred lines inside `index.html`, where nothing could reach it - and it is not
// markup, it is logic, and it is where a run of bugs lived. Mute, tint and frames/sec were all
// bound to `shell`, so once the disk was booted they set properties on an object that was not
// running; `fly()` stopped the shell and left the boot's loop alive on the same canvas; the
// ship panel sat at em-dashes through a whole flight because the boot's status handler never
// filled those four rows. The owner found two of those by using the page.
//
// So it lives here, it takes its drivers as arguments, and `probe_page.mjs` wires it to a
// stub document and a pair of recording drivers. `index.html` is the loader and nothing else.
//
// **There are two drivers and only one runs at a time.** `Shell` flies a single mission;
// `Boot` runs the whole disk and hands off to a mission when the chain BRUNs one. Each owns
// its own Audio, its own tint and its own frame rate, which is the whole reason `active()`
// exists.

/**
 * Wire the page up.
 *
 * @param {Document} doc something with `getElementById`
 * @param {object} deps `Shell` and `Boot`, the two driver classes; `HELP`, `FPS_CHOICES` and
 *   `DISK_FPS` for the captions; `fetchImage` to get the .dsk; `saves` for where the high
 *   scores are kept, which the page owns because the Clear button outlives any one driver;
 *   `log` for the console
 * @returns {object} the drivers and the handlers, for the console and for a harness
 */
export function wire(doc, { Shell, Boot, HELP, FPS_CHOICES, DISK_FPS, fetchImage,
  saves = null, log = console } = {}) {
  const $ = (id) => doc.getElementById(id);
  const canvas = $('screen');
  let shell = new Shell(canvas);
  let boot = null;
  let image = null;

  $('help').innerHTML = HELP
    .map(([k, what]) => `<kbd>${k}</kbd> ${what}`).join(' &nbsp; ');

  $('fps').innerHTML = FPS_CHOICES.map(({ fps, label }) =>
    `<option value="${fps}">${fps.toFixed(fps < 10 ? 2 : 0)} &mdash; ${label}</option>`).join('');
  $('fps').value = String(DISK_FPS);

  const fpsNote = () => {
    const fps = Number($('fps').value);
    $('fps-note').textContent = fps <= DISK_FPS + 0.01
      ? 'the original: one pass is 397,000 cycles, of which 80% is the renderer'
      : `${(fps / DISK_FPS).toFixed(1)}× the original speed — a pass is a whole tick of `
        + 'game state as well as a frame, so this speeds the game up rather than smoothing it';
  };

  /**
   * Set a node's text only when it differs.
   *
   * The two status handlers run once a frame, so every one of these was a DOM write sixty
   * times a second for a string that changes a few times a minute - and `note` was an
   * `innerHTML`, which tears the nodes down and parses them again each time.
   */
  const put = (id, text) => {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  };
  const putHTML = (id, html) => {
    const el = $(id);
    if (el.innerHTML !== html) el.innerHTML = html;
  };

  /**
   * Something to tell the player, for a few seconds.
   *
   * Both status handlers write `over` on every frame, so a line put there by a button is gone
   * before anybody reads it - which is what happened to Clear's own confirmation. This is the
   * line they fall back to while it is still fresh.
   */
  let notice = null;
  let noticeUntil = 0;
  const say = (text, ms = 5000) => {
    notice = text;
    noticeUntil = Date.now() + ms;
    put('over', text);
  };
  const fresh = () => (notice && Date.now() < noticeUntil ? notice : null);

  /** The three gauges are a bar's far end, not a percentage: a hit shrinks one by STEP. */
  const gauge = (v, s) => (v === 0 ? 'empty'
    : `${v} · ${Math.max(0, Math.floor((v - s.empty) / s.step))} left`);

  const show = (s) => {
    put('s-shields', gauge(s.shields, s));
    put('s-warp', gauge(s.warp, s));
    put('s-missiles', gauge(s.missiles, s));
    put('s-hits', `${s.hits} of ${s.fatal}`);
    put('s-waves', s.waves.join(' / '));
    put('s-kills', s.kills.join(' / '));
    put('s-passes', String(s.passes));
    put('s-sounds', s.sounds.length ? s.sounds.join(', ') : '—');
    put('pause', s.paused ? 'Resume' : 'Pause');
    const why = shell.reason();
    put('over', why || fresh() || (s.paused ? 'paused' : ''));
  };

  /** The flight the BASIC set up, in the BASIC's own terms. */
  const note = (s) => {
    if (!s || !s.intended) { put('note', ''); return; }
    putHTML('note',
      `<b>This flight:</b> ${s.intended.waves.join(' + ')} enemies to clear, `
      + `and ${s.intended.target} flights to survive.`);
  };

  /** What the chain shows instead, where the flight panel's labels do not describe a screen. */
  const showChain = (s) => {
    put('l-waves', 'program');
    put('l-kills', 'display');
    put('s-waves', s.program ?? '—');
    put('s-kills', s.display ?? '—');
    put('s-passes', String(s.flights));
    put('s-sounds', s.state);

    // The four SHIP rows, which this handler used to leave at their em-dashes for the whole of
    // a flight - the screen drew the three bars and the panel beside it said nothing. `fatal`
    // follows the mission: the finale dies at two hits where a flight takes four.
    const flying = s.state === 'flight';
    put('s-shields', flying ? gauge(s.shields, s) : '—');
    put('s-warp', flying ? gauge(s.warp, s) : '—');
    put('s-missiles', flying ? gauge(s.missiles, s) : '—');
    put('s-hits', flying ? `${s.hits} of ${s.fatal}` : '—');
    put('l-passes', s.finale ? 'flights · FINALE' : 'flights');
    put('pause', s.paused ? 'Resume' : 'Pause');
    put('over', s.error ? s.error
      : s.silent ? `the sound stopped: ${s.silent} — the game carries on`
      // A table that cannot be kept is worth saying out loud, because the game gives no sign
      // of it: the Hall of Heroes comes up looking right and forgets you on reload.
      : s.forgetful ? `the high scores are not being kept: ${s.forgetful}`
      : fresh() || (s.waiting === 'key' ? 'press a key' : ''));
    const gaps = s.unimplemented || [];
    putHTML('note', gaps.length
      ? '<b>Not ported yet, and reached:</b> '
        + gaps.map((g) => `${g.what} (${g.n}×)`).join('; ')
      : '');
  };

  async function loadImage() {
    if (image) return image;
    image = await fetchImage();
    return image;
  }

  /** The driver the controls should talk to. See the note at the top of this file. */
  let booted = false;
  const active = () => (booted && boot ? boot : shell);

  async function fly() {
    $('start').disabled = true;
    $('start').textContent = 'Loading…';
    try {
      const img = await loadImage();
      shell.stop();
      // And the other driver, which this did not do: both loops went on painting the same
      // canvas, and both Audios went on playing.
      if (boot) { boot.stop(); boot = null; }
      booted = false;
      shell = new Shell(canvas, {
        fps: Number($('fps').value),
        tint: $('tint').value,
      });
      shell.audio.setMuted($('mute').checked);
      shell.onStatus = (s) => show(s);
      const info = shell.load(img, Number($('difficulty').value));
      note(shell.status());
      show(shell.status());
      shell.start();
      $('pause').disabled = false;
      $('start').textContent = 'Reload and fly again';
      log.log('loaded, in order:', info.loaded);
    } catch (e) {
      put('over', String(e.message || e));
      log.error(e);
    } finally {
      $('start').disabled = false;
    }
  }

  async function bootDisk() {
    $('boot').disabled = true;
    $('boot').textContent = 'Booting…';
    try {
      const img = await loadImage();
      shell.stop();
      if (boot) boot.stop();
      boot = new Boot(canvas, img, {
        fps: Number($('fps').value),
        tint: $('tint').value,
        saves,
      });
      booted = true;
      boot.audio.setMuted($('mute').checked);
      boot.onStatus = showChain;
      boot.start();
      $('pause').disabled = false;
      $('pause').textContent = 'Pause';
      $('boot').textContent = 'Reboot';
    } catch (e) {
      put('over', String(e.message || e));
      log.error(e);
    } finally {
      $('boot').disabled = false;
    }
  }

  $('boot').addEventListener('click', bootDisk);
  $('start').addEventListener('click', fly);
  $('pause').addEventListener('click', () => {
    const d = active();
    d.paused = !d.paused;
    d.audio.resume();
    // `Boot` repaints and reports from its own loop; only the shell needs the nudge.
    if (d === shell) show(shell.status());
    else $('pause').textContent = d.paused ? 'Resume' : 'Pause';
  });
  $('mute').addEventListener('change', (e) => active().audio.setMuted(e.target.checked));
  /**
   * `CLEAR SCORES`, which is a program on the disk that nothing on the disk runs.
   *
   * The running driver gets it when there is one, because it has this session's copy of the
   * file open as well as the store; with no disk booted the store is the only copy there is.
   */
  $('clear-scores').addEventListener('click', () => {
    if (!saves) { say('there is nowhere to keep high scores in this browser'); return; }
    const d = booted && boot ? boot : null;
    if (d) d.clearScores();
    else saves.clearScores();
    say(saves.broken
      ? `the high scores are not being kept: ${saves.broken}`
      : 'the hall of heroes is seven rows of AAA again, the way CLEAR SCORES leaves it');
  });
  $('tint').addEventListener('change', (e) => {
    const d = active();
    d.tint = e.target.value;
    d.draw();
  });
  $('fps').addEventListener('change', (e) => {
    active().fps = Number(e.target.value);
    fpsNote();
  });
  fpsNote();

  // For poking at it from the console, and for the harness.
  return {
    get shell() { return shell; },
    get boot() { return boot; },
    active,
    fly,
    bootDisk,
    show,
    showChain,
    saves,
  };
}
