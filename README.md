# Star Destroyer

*Star Destroyer*, Harvest Time Software Company, **© 1983 by Mitchell Robbins** — the same
author as *Space Vikings*, one year later, built on subLOGIC's **A2-3D2** 3-D graphics
package instead of hand-rolled `HPLOT`.

**The flight loop is ported and it runs.** Open `port/index.html` from a local server and
you get the game: the wireframe view in colour, the instrument panel, the radar scope, the
controls and the speaker, at the disk's own 2.57 frames a second. What is not ported yet is the
presentation around it - the title, the difficulty screen, the starbase, the hyperdrive
sequences, the high scores - and the final mission's binary.

Everything under `port/src/game` and `port/src/a23d2` is held to the original by the
oracle: the disk running under emulation, drivable from a script, so that anything the
port claims is checked against the machine rather than against someone's notes.
**45 harnesses**, `cd oracle && node run_all.mjs`.

---

## Layout

```
disk/STAR_DESTROYER.dsk   the image everything is measured against
port/
  index.html              the shell - open this to play
  src/a23d2/              subLOGIC's 3-D package, reimplemented
  src/game/               the flight loop, block by block
  src/platform/           disk, hi-res, input, audio - the host, not the game
  src/shell/main.js       canvas, clock and keyboard; the only file with no harness
oracle/                   the arbiter
  DISK_TRUTH.md           the only findings document to trust
  a2.mjs                  the disk in apple2js, driven from Node
  dsk.mjs                 DOS 3.3 reader - catalog, files, load addresses
  detokenise.mjs          Applesoft out of a byte array
  hgr.mjs                 hi-res page -> pixels -> PNG
  screens.mjs             "which screen is this?", answered against the disk
  probe_*.mjs             things that ask the disk a question
  listing/                every Applesoft program, detokenised
  captured/               what the probes saw
```

## Playing it

```bash
node port/devserver.mjs
```

Any static server over the repository root would do - the page just fetches the disk image -
but that one sends `Cache-Control: no-store`, and a browser that caches an ES module will
happily run an edit-old copy of the port while the file on disk is correct. An hour went
into a fix that was right, was served correctly when fetched by hand, and was still wrong on
the page.

Then open <http://localhost:8124/port/index.html>. Arrows turn, up or shift engages warp,
space fires, P pauses.

Three switches on the page, all defaulting to the disk's behaviour:

- **frames/sec**, which starts at 2.57 because that is what one game frame costs on an
  Apple II. Raising it speeds the whole game up rather than smoothing it: a pass is a full
  tick of game state as well as a frame, so everything scales together.
- **display**, which starts in colour, because the game is in colour — A2-3D2's COLOUR
  opcode, not Applesoft's `HCOLOR`. Green, amber and white screens are there for anyone who
  had that monitor.
- **repair the interface**, which puts back the wave counters that
  `BRUN STAR DESTROYER.OBJ0` runs over. The page explains it; the short version is that it
  is this disk image's fault and not the game's.

## Running the oracle

```bash
cd oracle && npm install
```

```bash
node probe_catalog.mjs
```

```bash
node probe_play.mjs
```

`probe_catalog.mjs` and `probe_chain.mjs` read the image directly and are instant; the
rest drive the machine. `run_all.mjs` discovers every `probe_*.mjs` and `parity_*.mjs`,
runs the probes first, refuses to report success on an empty suite, and exits with the
number of failures.

**One known flake, and it is getting annoying:** `probe_boot.mjs`'s "two different power-on
fills converge on the same machine" has now failed three times in about a dozen suite runs
and passed on every rerun. It is timing dependent. Three failures is past the point where
"rerun it" is a reasonable answer - a suite that cries wolf is worth less than one harness -
so this should be fixed rather than tolerated.

Playwright is pinned to **1.59.1** deliberately — it is the version whose Chromium is
already on this machine, and a floating range downloads a new one.

## Before porting anything, read this

**The disk is a modified copy.** It boots to a the replacement art screen, and both
of the game's own title pages have been overwritten with that art — not prefixed, replaced.
The original title screens are not recoverable from this image. See the top of
[DISK_TRUTH.md](oracle/DISK_TRUTH.md).

## The rules this inherits

- **Fidelity is the baseline.** Replicate the original as it is. Quality-of-life additions
  (save games, higher frame rates, gamepads) go behind switches that default off.
- **The oracle is the arbiter.** A measurement nothing consumes is a note, not a test.
- **A check that cannot fail is worse than none**, because it gets counted. Every probe here
  was made to fail on purpose before it was believed; three of them were wrong on the first
  try and the ways they were wrong are written down in `DISK_TRUTH.md` rather than quietly
  fixed.
