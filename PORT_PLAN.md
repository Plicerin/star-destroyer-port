# Porting Star Destroyer

A runbook. Each phase says what to build, what it has to prove, and where the facts it
rests on were established. It is written to be picked up by someone who was not here.

**Read `oracle/DISK_TRUTH.md` first.** It is the only trusted findings document. Anything
not in it is not known, and nothing in this file overrides it.

---

## The rules, inherited

- **Fidelity is the baseline.** Replicate the original as it is. Improvements go behind
  switches that default to off.
- **The oracle is the arbiter.** The original disk running in apple2js answers "does this
  match?". No other source counts — not a manual, not a memory, not a plausible reading.
- **A measurement nothing consumes is a note, not a test.** If a number matters, a harness
  checks it.
- **A check that cannot fail is worse than none**, because it reports success. Every
  harness here has at least one control: something that must fail for the passes to mean
  anything.

## The method

Two kinds of harness, both run by `node run_all.mjs` in `oracle/`:

| | |
| --- | --- |
| `probe_*.mjs` | establishes what the original does. Thirteen of them, all green. |
| `parity_*.mjs` | holds the port to it. Runs the port's code and the original's over the same inputs and requires exact agreement. |

Probes come first in the run, because a parity failure means nothing if the probe under it
is also failing.

`oracle/exercise.mjs` is what makes this possible: it can write a display list of our own
over `SV DATA`, call the engine, and read back the screen; and it can call any single
routine with the registers and zero page set. Anything the disk's own scene does not
happen to do can still be asked of the engine directly.

## The title pages

**Owner's decision: the port does not reproduce the replacement art.** The only disk image we
have is a modified copy, and the change overwrote the game's own two title pages in place —
`SD.PIC1` and `SD.PIC2` are byte-identical to each other and both are this image's
screen. The originals are not recoverable from this image: the disk has ten free sectors,
2,560 bytes, against the 8,192 a hi-res page needs.

Build this as a **missing asset, not a removed feature.** `START` loads two pictures and
shows them; keep that structure, keep the chain, and let the two picture files simply be
absent, with the opening falling through to what follows. If a clean dump turns up, adding
the two files restores the opening with no code change.

Do not substitute invented art in their place. A hand-drawn replacement presented where
Robbins's art was is the same fidelity problem as shipping the change, in better clothes.

---

## Phase 1 — the engine's arithmetic ✅ done

`port/src/a23d2/math.js`, held by `oracle/parity_math.mjs`. 3,000 products, 589 quotients
and 11,008 scalings, all exact.

- **`mul`** is a **transliteration** of `$6480`, instruction by instruction, not a formula.
  It is not `(a * b) >> 15`: it is a shift-add loop that discards the low half of its
  accumulator part way through, and it differs from the arithmetic shortcut on **29%** of
  the products in the sweep. Anything that reaches for a native multiply here will drift
  by a pixel in places that cannot be predicted.
- **`div`** and **`scale`** are formulas, verified over their whole domains. `div` is
  defined only for `|n| < |d|` and returns `null` outside it rather than inventing a value.

## Phase 2 — the 2-D layer (part done)

`port/src/a23d2/screen.js` and `tables.js`, held by `oracle/parity_screen.mjs`. Thirteen
whole-page comparisons, every one byte-for-byte identical.

Done: the coordinate system, the four tables (copied from the disk by
`oracle/gen_tables.mjs`, with the derived formulas checked against the copies), the point
plotter, the five colours, both plot modes, both pages, the straddling cells and the
off-screen wrap.

**Colour is modelled as patched code, not as a parameter**, because that is what it is -
see the note at the top of `screen.js`. The one combination the original corrupts, a
colour other than 0 followed by PLOTMODE, the port refuses rather than guessing.

The line routine is done too — `port/src/a23d2/line.js`, held by `oracle/parity_line.mjs`,
ten whole-page comparisons all identical. It **is** Bresenham, but that was measured out
of the engine rather than assumed, and the two halves are not symmetric: shallow adds then
tests `e >= dx`, steep subtracts then steps on the borrow, and they land differently on
ties. A straddling cell comes out three different ways depending on whether a point, a
shallow line or a steep line drew it. All three were found by a byte that differed.

**Phase 2 is complete.**

## Phase 2 notes — what the plan said to build

Everything downstream of a screen coordinate. All of it is established — see
**"What a 2-D coordinate means"** in DISK_TRUTH.

Build: the 140×192 cell model (`bit = 140 + 2x`, `row = 95 - y`), the four lookup tables at
`$7223`-`$7622`, the five colours and their alternating byte patterns, the palette-bit
artifact on the 20 straddling cells, OR against EOR plotting, and the two page bases.

Transliterate rather than reinvent: the 2-D line routine at `$7748`. Its stepping is not
assumed to be any particular Bresenham variant — find out, the same way `$6480` was found
out.

**Proves itself by:** a corpus of 2-D lines and points drawn by both, compared **byte for
byte across the whole 8 KB page**. Include lines that straddle byte boundaries, lines at
every slope sign, and both plot modes.

## Phase 3 — transform and projection ✅ done

`port/src/a23d2/view.js`, held by `oracle/parity_view.mjs`. Trig exact over all 256
angles of each function; the matrix exact over 96 attitudes and five settings of opcode
15; the transform and projection exact to the pixel.

`$666E` turned out to have a **bug** rather than rounding - it skips its own `LDA` and
scales the first entry of each row by a stale accumulator byte. See "$666E has a bug" in
DISK_TRUTH. The trig folding also is not a true negation, and `$61C8`/`$61CB` are sine
and cosine the other way round from how DISK_TRUTH first had them.

## Phase 3 notes — what the plan said to build

Both derived — see **"The projection, derived"** and **"What feeds it"** in DISK_TRUTH.

```
d = p - viewer
v = (M . d) << 3                 M is 3x3 Q15 at zp $7E-$8F, a row per output axis
h = div(v, z) >> 8
screen = ((h * scale) >> 7) + centre
```

`scale` and `centre` are bytes inside the projection code that the VIEWPORT instruction
patches: `scale = (operand >> 1) - 1`, `centre = the operand`.

One piece is **not** derived and must be transliterated: **`$666E`, the matrix builder**.
Its rotation is real and the y and z scales land on the diagonal within a few units, but
the x entry comes out up to 2.3% high and wanders with pitch, which is rounding inside the
builder. Read it and transliterate it as `$6480` was.

Note the edge: at `v = z` exactly, on the frustum boundary, the engine comes back **one
short** of the formula. Reproduce that.

**Proves itself by:** a sweep of (point, viewer, pitch/bank/heading) where the port's
view-space triple and screen pair both equal the engine's exactly.

## Phase 4 — the display-list interpreter

Thirty opcodes, all exercised — the table is in `port`-ready form in
`oracle/renderer.mjs` and documented in **"All thirty opcodes"**.

Build the interpreter loop (fetch, bound at 30, dispatch, each handler advances the
pointer by its own length), the object instruction's recursion into shapes, and the
clipper.

The clipper computes **exact intersections** - `t = f(p2)/(f(p2)-f(p1))` through the
engine's DIV, one plane at a time. This plan said "a bisection" until `parity_clip.mjs`
measured it; halving matches on 0 of 45 clips. The **ten** in `$B1` caps how many planes
one line may be clipped against, not how many halvings. Done: `port/src/a23d2/clip.js`.

Keep the engine's statefulness — opcode 20's vectors, opcode 12's plot mode, opcode 29's
capture mode and opcode 15's constants all survive a call. A frame inherits whatever the
last one left.

**Proves itself by:** running `SV DATA` and `SV DATA2` and comparing **the entire hi-res
page, byte for byte**, against the engine for the same frame. That is the real test of the
whole renderer, and it is achievable — every stage under it is exact.

## Phase 5 — the game

The 21 Applesoft programs in `oracle/listing/*.bas`, and the chain between them:

```
boot -> START -> LOGO1 --(key)--> SELECT -> SD -> SD START
                   +--(no key)--> DEMO
```

Includes the difficulty model (`$1FF6`, `$1FF8`), the twenty-four object instructions the
game pokes each frame, the instrument panel (three bar gauges whose far x the BASIC moves,
seven radar blips), and the second viewport and viewpoint that draw the scope inset.

**Watch the cadence.** One `CALL 24576` is **316,000 cycles — 309 ms, 3.23 renders a
second**. That is what the original looks like. Match it before offering anything smoother.

**Proves itself by:** driving both the original and the port through the same inputs and
comparing state and screens at checkpoints — the pattern `probe_play.mjs` already uses.

## Phase 6 — the rest of the disk

Sound (`PLAYER.MODULE` at `$0300`, tunes BLOADed to `$6000`), high scores
(`INITIALS.DAT`, written back to the disk), and the `DEMO` path, which has never been
walked. All three are open questions in DISK_TRUTH; establish them with probes before
porting them.

## Phase 7 — the switches

Only now, and all defaulting to off: save states, frame rate, gamepad. Each one measured
against the fidelity baseline so the difference is a choice rather than a drift.

---

## What a clean dump would change

The owner is looking for one. If it arrives:

1. **Diff it against `disk/STAR_DESTROYER.dsk` before trusting either.** That diff is the
   only honest answer to what else whoever modified it touched — still an open question.
2. Re-run `node run_all.mjs`. It takes about a minute. Every measurement in DISK_TRUTH
   came from the this image, and all of them are cheap to re-establish.
3. If the title pages are intact, drop them in; Phase 1 of this plan is structured so that
   is all it takes.
4. It may also carry `STAR DESTROYER.ASM` — Robbins's own 25-sector assembly source, which
   was deleted from our copy and is unrecoverable from it.

One lead, unverified: archive.org item **`a2_asimov_star_destroyer`** holds a
`star_destroyer.dsk` of 143,360 bytes with twenty screenshots. Same Asimov lineage as our
copy, so it may well be the same change — nobody has diffed them.
