# Star Destroyer

*Star Destroyer*, Harvest Time Software Company, **© 1983 by Mitchell Robbins** — the same
author as *Space Vikings*, one year later, built on subLOGIC's **A2-3D2** 3-D graphics
package instead of hand-rolled `HPLOT`.

This repository is at the **preparation** stage. Nothing is ported. What exists is the
oracle: the original disk running under emulation, drivable from a script, so that anything
the port later claims can be checked against the machine rather than against someone's
notes.

---

## Layout

```
disk/STAR_DESTROYER.dsk   the image everything is measured against
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

## Running it

```bash
cd oracle && npm install
```

```bash
node probe_catalog.mjs
```

```bash
node probe_play.mjs
```

`probe_catalog.mjs` and `probe_chain.mjs` read the image directly and are instant.
`probe_boot.mjs`, `probe_pics.mjs` and `probe_play.mjs` run the machine and take a few
minutes. `run_all.mjs` runs everything named `*_parity.mjs` or `*_check.mjs` and exits with
the number of failures; there are none of those yet, because there is nothing to compare
against.

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
