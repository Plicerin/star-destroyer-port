# Star Destroyer

*Star Destroyer*, Harvest Time Software Company, **© 1983 by Mitchell Robbins** — the same
author as *Space Vikings*, one year later, built on subLOGIC's **A2-3D2** 3-D graphics
package - the enhancement of the **A2-3D1** that the earlier game ran on, which that disk
carries byte-for-byte as supplied.

**The game plays, beginning to end.** Open `index.html` from a local server and the disk
boots by itself: the attract mode with the story in it, the difficulty screen, the wireframe
flight in colour with its instrument panel and radar scope, the hyperdrive, the starbase, the
final mission and the high scores - at the disk's own 2.57 frames a second. Both endings are
reachable.

The presentation is **interpreted, not transliterated**: `applesoft.js` runs the disk's own
twenty Applesoft programs as they are, `host.js` is DOS 3.3 underneath them, and only the four
6502 overlays are rewritten by hand. What is missing is the two title pictures, which are not
on this image - the port builds them as a missing asset, so a clean dump restores the opening
with no code change.

Everything under `port/src/game` and `port/src/a23d2` is held to the original by the
oracle: the disk running under emulation, drivable from a script, so that anything the
port claims is checked against the machine rather than against someone's notes.
**61 harnesses**, `cd oracle && node run_all.mjs`.

---

## Layout

```
disk/STAR_DESTROYER.dsk   the image everything is measured against
index.html                the page - open this to play
port/
  index.html              the workbench: two drivers, every control, no presentation
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

Then open <http://localhost:8124/>. Arrows turn, up or shift engages warp, space fires,
P pauses. Leave it alone when it loads and the attract mode runs; press a key and you skip it,
which is what the text screen invites you to do.

The controls on the page all default to the disk's behaviour:

- **frames/sec**, which starts at 2.57 because that is what one game frame costs on an
  Apple II. Raising it speeds the whole game up rather than smoothing it: a pass is a full
  tick of game state as well as a frame, so everything scales together.
- **display**, which starts in colour, because the game is in colour — A2-3D2's COLOUR
  opcode, not Applesoft's `HCOLOR`. Green, amber and white screens are there for anyone who
  had that monitor.
- **the high scores**, which are kept in this browser, because the port will not write to the
  disk image. `CLEAR SCORES` - the two-line utility the author shipped and nothing on the disk
  ever runs - is a button beside them.

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

**The `probe_boot.mjs` flake is fixed.** It sampled the machine at fixed times after
power-on, and how far the boot had got when `coldStart` returned varied, so about one run in
four compared different stages and three or four of its eight checks failed together. It now
waits for the title to appear and measures everything from there - the same move
`settleBinary` makes, for the same reason. Five runs in a row, and the suite, are green.

Playwright is pinned to **1.59.1** deliberately — it is the version whose Chromium is
already on this machine, and a floating range downloads a new one.

## Before porting anything, read this

**The two title pages on this image are not the game's.** `SD.PIC1` and `SD.PIC2` have been
overwritten in place — not prefixed, replaced — and the originals are not recoverable from
this image: it has ten free sectors against the 8,192 bytes a hi-res page needs. The port
builds them as a **missing asset**, so a clean dump restores the opening with no code change.
See the top of [DISK_TRUTH.md](oracle/DISK_TRUTH.md).

## The rules this inherits

- **Fidelity is the baseline.** Replicate the original as it is. Quality-of-life additions
  (save games, higher frame rates, gamepads) go behind switches that default off.
- **The oracle is the arbiter.** A measurement nothing consumes is a note, not a test.
- **A check that cannot fail is worse than none**, because it gets counted. Every probe here
  was made to fail on purpose before it was believed; three of them were wrong on the first
  try and the ways they were wrong are written down in `DISK_TRUTH.md` rather than quietly
  fixed.
