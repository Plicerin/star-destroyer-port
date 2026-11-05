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

## Phase 4 — the display-list interpreter ✅ done

`port/src/a23d2/engine.js` and `clip.js`, held by `oracle/parity_frame.mjs` and
`parity_clip.mjs`. **Eight whole frames, every one byte-for-byte identical across all
8,192 bytes** - the scene as shipped, objects at various attitudes, objects straddling the
frustum, an explosion close up, eight objects at once, the second object block through the
second viewport, and the other scene file against its own shapes.

Two things this phase found that nothing earlier could:

- **Opcode 19 does not set an attitude and rebuild the matrix.** It rotates the relative
  position into the object's frame and COMPOSES the object's rotation into the matrix
  already there - heading on (x,z), pitch on (y,z), bank on (x,y), the same pairs and
  signs for the position and the matrix. Rebuilding instead draws nothing at all as soon
  as an object has a pitch.
- **`|n| == |d|` is inside DIV's domain, and the clipper depends on it.** Clipped points
  land exactly on a plane, so every clipped line projects through the saturating case.
  Treating the edge as out of domain made the port silently drop anything that needed
  clipping.

## Phase 4 notes — what the plan said to build

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

## Phase 5 — the game  (REFRAMED - see probe_game.mjs)

This phase was written as "the 21 Applesoft programs and the chain between them". That is
half of it and not the hard half.

**The flight is not in BASIC.** `SD PART2` is 287 bytes and its real line is
`BRUN STAR DESTROYER.OBJ0` - 5,890 bytes of 6502, 95.7% reachable code from its entry at
`$08EF`. Porting the combat means disassembling that, the way A2-3D2 was disassembled.
The other overlays (`BASE STAR.OBJ0`, `HYPERDRIVE.OBJ0`, `TITLE.OBJ0`, `PART1.OBJ0`) are
another 15KB of the same.

The 12KB of Applesoft is still real work - the title, the difficulty screen, the starbase,
the hyperdrive sequences, the high scores, the demo - but it is chaining and presentation.

**The arbiter is already built.** The binary's whole effect on what appears is the bytes
it pokes into the display list: the VIEWER instruction's `XI`/`ZI`/`H1`, the object
instructions' count/position/attitude/shape, and the far end of the three gauge lines.
Nothing else. Since the display list is ported and verified byte-for-byte, a parity
harness for the game logic compares **the display list after each frame**, not screenshots
and not internal state.

Suggested order:
1. ~~Trace `STAR DESTROYER.OBJ0` in the oracle during flight.~~ Done -
   `probe_gameloop.mjs`. 624 of its 2,086 instructions run, in 17 regions; a frame is
   397,000 cycles of which 80% is the renderer; 27 display-list bytes move per frame. The
   controls are **paddle 0** through the ROM's PREAD, with a dead zone of 100..154 and
   three units of heading a frame, and the keyboard is a pause.
2. Port the frame loop, and compare the display list each frame. **Started**:
   `port/src/game/controls.js` holds the steering from $09A3, and
   `oracle/parity_controls.mjs` drives the real paddle through six scripts and requires
   the port to produce the same heading on **every frame**, not just the same endpoint.
   `listing/STAR_DESTROYER.asm` is the annotated disassembly to work from - every
   reference into $6000-$83FF is named by the display-list field it writes.
   That is a dozen instructions of about 401 a frame. The rest of the loop is next, and
   the five large regions ($0957-$0AE0, $0C04-$0DA2, $0E05-$0EF6, $1014-$11AC,
   $120F-$1300) are where it lives. Three of them now open with ported code - see "Range and
   bearing" below - and what is left in each is the dispatch after it: what the game does
   with a range and a bearing once it has them.

   **Three things block the rest of it**, and they should be settled before more code is
   written, because everything in the loop runs through them:

   - ~~**`MATH` at `$98F3`.**~~ **Done, all of it.** Fourteen entry points in
     `port/src/game/math.js`, covering all 271 call sites in `.OBJ0`, held by
     `parity_gamemath.mjs` (22 checks: each routine singly, 240 random programs, and six
     wrong-port controls each failing on 60 of 60 while the port agrees on all 60).
     `probe_math.mjs` has 43 checks.

     The last five were `$9998` (add), `$9A04` (absolute value), `$9A17` (multiply), `$9AD0`
     (square root) and `$9C04` (arctangent). Two of them are the interesting ones: the root
     is transliterated because `trunc(sqrt(n*256))` is wrong at exactly one input, and the
     arctangent is a lookup over 90 measured step boundaries because it is a series with its
     own rounding that skips four whole degrees.

     Worth reading the "How this was nearly got wrong" note in DISK_TRUTH before tackling
     the next blocker the same way. `MATH` is not a function library, it is an accumulator
     machine, and the plan's own instruction here - "tabulate them the way `$6480` and
     `$65DE` were tabulated, inputs in, outputs out, no reading required" - is what produced
     two wrong answers. Sweeping inputs cannot characterise a routine that reads a register
     the sweep never varies. Where a routine might hold state, **read it**.

     It also turned up the warp gate: `$0948` is set from paddle 1 at `$0A8D`, and with the
     paddle at rest the movement block never runs. Any trace of the loop's movement code has
     to engage warp first - **but the gate does not stop `MATH`**. This plan and DISK_TRUTH
     both said it did, which was an artifact of measuring while the top 2KB of the binary
     had not finished loading; the range and bearing blocks drive `MATH` every pass whatever
     the gate does. Corrected, with the call sites, under "Range and bearing" in DISK_TRUTH.

     One substantive thing in `MATH` was also wrong until the bearing forced it: a quotient
     too wide for 24 bits **saturates** to `$FFFFFF` rather than wrapping into the register.
     The port wrapped, `parity_gamemath.mjs` skipped those cases instead of measuring them,
     and `probe_math.mjs` only asserted the answer was "not the quotient" - three places
     agreeing to leave a question alone. It is reachable in play, so it mattered.
   - ~~**The table at `$9801`.**~~ Mostly done. It is `MATH`'s own storage at
     `$9800`-`$98F2`, byte-indexed through a directory of 65 offsets at `$08F2`, and the
     binary is the only writer - no file loads there and no BASIC line POKEs there. 241 of
     its 243 bytes come out identical from a `$00` and an `$A5` power-on fill, so the port
     starts from a generated capture (`gen_game_tables.mjs`) and `parity_flight.mjs` checks
     the capture against the machine.

     **What is still open** is which code builds it: the 18 indexed stores in `.OBJ0` are
     the only writers found and none is on the setup path. The capture stands in for that
     until it is found, and it is honest because it is verified deterministic - but it is a
     capture, not an understanding.
   - ~~**The state at `$0900`-`$0950`.**~~ **Mostly mapped**, and mapping it is what made
     the five regions readable rather than transliterable. `$0901`/`$0903` are the ship's
     position indices; `$0908`-`$090C` the range and bearing block's working entries;
     `$090D`-`$0910` and `$0930`-`$0931` index the three enemy classes; `$0915`-`$0917` the
     movement operands; `$091F`-`$0924` are constants of the build; `$0926`, `$092F` and
     `$0932` range thresholds; `$092B`-`$092E` are `$1C3D`'s argument slots; `$0948` the
     warp gate and `$0949` the saved heading. See open question 14 in DISK_TRUTH for the
     eighteen bytes still unread, none of which the two ported idioms touch.

   **Movement is ported.** `port/src/game/flight.js` and `port/src/game/tables.js`, held by
   `parity_flight.mjs` - 19 checks, including a frame-by-frame replay seeded once and never
   resynchronised, all four wraps provoked in the machine, and the published `XI`/`ZI`. See
   DISK_TRUTH, "Flying: the heading, the throttle and the edge of the world".

   **Range and bearing are ported.** `port/src/game/geometry.js`, held by
   `parity_geometry.mjs` (10 checks) over `probe_geometry.mjs` (28). This is the piece that
   makes the five regions mostly already-written: seven of the nine places the game asks a
   geometric question are one of these two blocks with different indices, and the probe
   proves it by byte comparison - the four range copies share 54 identical bytes after their
   index loads, the three bearing copies are identical across all 257 once their jump targets
   move. So `$0C04-$0DA2`, `$1014-$11AC` and `$138D-$1798` each begin with code that now
   exists.

   Three measured things in them that a reasonable port would get wrong, all with controls:
   the range is `sqrt(2 * (|dx| + |dz|))` and **not** a Euclidean distance; the bearing
   increments each delta's low byte before dividing, which both prevents and causes a divide
   by zero; and its quadrant fold uses **271** degrees and **359** degrees-per-turn. There is
   also a disabled clamp sitting in all three copies that would have caught the one-unit
   overshoot the live path produces.

   **The dispatch is ported.** `port/src/game/dispatch.js` and
   `port/src/game/objects.js`, held by `parity_dispatch.mjs` (12 checks) over
   `probe_dispatch.mjs` (21). This is what each of those three regions does with the range and
   bearing it has just worked out: turn the enemy toward the bearing, and fire when it lines
   up. `objects.js` is the display list's record layout, which the dispatch needs and the
   missile flight and the publish will need after it.

   Unlike the range and bearing, **the three copies here are not copies.** Dropping two
   redundant stores that only class 1 has, all three run the same 58 opcodes in the same
   order, bar one - but they differ in four things that matter, and a port written from one
   copy gets three of them wrong in the others:

   - the cooldown branch lands on a different turn label, so the same code turns +2 for class
     1 and -3 for classes 2 and 3
   - class 3's cooldown is 15 frames where the others are 20
   - classes 2 and 3 share one missile, object 5, so either firing blocks the other
   - class 3's launch-sound flag is set with `STA` where the others use `STX`, so it takes the
     enemy's heading instead of the 1 the dead `LDX #$01` loaded - which only shows at heading
     0, where class 3 launches silently

   Each of those is a control in `parity_dispatch.mjs`, along with three for the turn itself,
   and all seven fire.

   **The enemies and their missiles are ported.** `port/src/game/entities.js`, held by
   `parity_entities.mjs` (11 checks) over `probe_entities.mjs` (18). Four blocks per class -
   `reach` at $0E05, `hold` at $0E2F, `move` at $0E3D and `missile` at $0F83 - twelve in all,
   and with the dispatch they are the whole of the three enemy regions bar the explosion
   routines and the player's own shots.

   Most of it turned out to be the ship's movement again. $0E3D is $09D1 without the warp
   gate, and that is a byte-level claim: the fifteen opcodes from $09DC and from $0E43 are the
   same, and the four compare-and-copy pairs that wrap them are identical in all four places
   once a stray CLC in the ship's copy is set aside. So `wrapPosition` and
   `buildStepOperands` are shared out of flight.js rather than written again, which is what
   the probe's instruction-stream comparison is there to justify.

   Three things measured that a reasonable port would get wrong, each a control: the three
   arrival thresholds are **not** the same comparison - `reach` fires at or inside its
   threshold and the other two only strictly inside, which shows at exact equality; the
   enemies divide by the **same** throttle entry the ship does, so they always fly at warp
   speed; and the missile has **no** world wrap, so it leaves the world and keeps going.

   **An open question closed, and a correction**: the object record's count. It was recorded
   here and in DISK_TRUTH as a frame counter whose decrement "was never seen to happen". It
   happens - A2-3D2 does it at $6D18, one per render - and $FF is exempt, so the byte is a
   switch and a timer at once. Nothing in .OBJ0 ever decrements a count, so a missile's
   twenty-frame life is twenty renders and the loop has no part in it.

   **The kill chain is ported.** `port/src/game/kill.js`, held by `parity_kill.mjs` (12
   checks) over `probe_kill.mjs` (15). The player's two shots against the three classes - six
   blocks, perfectly regular - plus the nine subroutines a hit calls, the debris animation,
   the respawn and the score.

   Three things in it are not what they look like, and each is a control:

   - **the debris is four objects and three are drawn.** Objects 11 and 23 are positioned and
     aimed on every kill and nothing in the binary ever gives them a count
   - **the respawn's `ADC` has no `CLC`**, so its bump is 10 or 11 (and 20 or 21) depending on
     the caller's carry. Both callers arrive with it set, for different reasons, so in play it
     is always the higher number. The port takes the carry as an argument
   - **class 2's respawn cascades into class 3's**: `$1ECC` is `BEQ $1EFA`, so an exhausted
     class 2 spawns a class 3 enemy rather than returning

   Parity caught one real port bug on the way: `$1D09`'s three tests are `CPX`/`BEQ` on
   equality, not a range, so a debris counter above 4 falls through to the respawn. The first
   version read `>= 4`.

   **The damage model is ported.** `port/src/game/damage.js`, held by `parity_damage.mjs`
   (15 checks) over `probe_damage.mjs` (16). One primitive, $1C89, shrinking a panel bar by up
   to four and stopping at $C7; a ram costs sixteen of the shield and a missile eight; when the
   shield runs out the missile and warp bars lose four each and $0933 ticks, and **four of
   those is fatal** - the nearest thing the binary has to a lives counter.

   Two edges worth the words. The shield is stored after the *second* shrink, not after each,
   so a ram that empties it on the first four leaves the bar untouched. And the floor is an
   equality, not a clamp, so a bar already at $C7 would step straight past it - which cannot
   happen because nothing ever raises one.

   One thing that looked like a control and is not: $1CFC tests `CPX #$C8` where `#$C7` would
   read more naturally, and the two cannot be told apart, because the one value they disagree
   on is caught by $1CB1's own guard. Recorded as a measured redundancy over 405 shield states
   rather than left as a control that silently never fires.

   **With that, the five big loop regions are done.**

   **The player's weapon is ported.** `port/src/game/weapon.js`, held by `parity_weapon.mjs`
   (10 checks) over `probe_weapon.mjs` (12): the trigger at $0ADB, the two shots' flight at
   $0B6A and $0BB7, and the publishes at $1B2B and $1B60. Three findings, each a control:

   - a slot may fire only if it is empty **and the other slot's count is below 11**, which is
     a rate limit expressed through the other barrel
   - **only slot 1 spends a missile**, so half the shots are free - and the cost is one unit,
     not four, because $0B26 enters $1C89's loop at $1C8B with Y already at 4
   - **the publish writes the wrong object's Y**: $1B2B sets OBJ4.y, the enemy missile's, and
     never OBJ6.y. Nothing in the binary ever sets a player shot's Y at all

   **The loop's own shape is traced** and is in DISK_TRUTH under "The loop's own shape":
   $09A3 to $193C, region by region. Everything in it is ported except $0AB7-$0ADA (the
   double-buffer page selection), $18D6-$193B (the tail) and the once-only setup at
   $0957-$09A2.

   **The frame driver is written.** `port/src/game/loop.js`, held by `parity_loop.mjs` (9
   checks). It composes all thirteen modules in the loop's traced order, and it closes the
   three blocks that were left: the double-buffer page selection, the loop's tail with its two
   exits, and the once-only setup. `Game.setup()` then `Game.pass(input)`, and the renderer is
   called where $1851 calls it, because the renderer is what decrements every object's count.

   **The state parity is exact.** Over 24 passes seeded once and never resynchronised, every
   byte of MATH's table, the display list and the binary's state agrees with the machine's.
   The harness captures what PREAD actually returned rather than modelling paddle timing.

   **It found three gaps on its first run**, each a block nobody had read:

   - `controls.js` was half of $09A3: the block also scrolls all seven scope blips three steps
     the other way, with a wrap that jumps the gap between $43 and $BC
   - the renderer's 14-bit halving at $688D, which the port threw on with the comment "no
     geometry on this disk reaches it", is reached on **63 of 138 points a pass** - a
     respawned enemy's Z operand is $9600, which signed is -27,136
   - the warp gate has to be written back to $0948, not only cleared

   **And the screen agrees too**, which took one more round and a retraction. The first run
   reported the drawn hi-res page as 15 to 217 bytes different and that went into DISK_TRUTH as
   open question 9. It was the harness's mistake: `Screen` kept its own pair of 8K buffers, so
   the comparison was against the copy the harness had synced in, and the bytes that "differed"
   were the ones that had changed since the previous frame - which is why they looked like the
   blips and the moving objects. `Screen` now takes the pages it draws into and the driver
   hands it views on $2000 and $4000 of the one image.

   **So the port runs the game.** Over 24 passes, seeded once and never resynchronised, every
   byte of MATH's table, the display list, the binary's state AND both 8K hi-res pages agrees
   with the machine's.

   What is left of Phase 5 is the Applesoft around the flight loop - the title, the difficulty
   screen, the starbase, hyperdrive, the high scores and the never-walked DEMO path - and then
   Phase 7's QoL switches, all default off.

   ~~**Phase 6 is now the biggest gap**~~ **Phase 6's sound is done**, bar one sequence.
   `port/src/game/sound.js` and the generated `sounds.js`, held by `parity_sound.mjs` (13
   checks) over `probe_sound.mjs` (12).

   There is no sound chip: $C030 is a soft switch, every access flips the speaker, and a sound
   IS a list of cycle numbers. So the port is an interpreter of the generator at $1D52 - forty
   instructions with their cycle costs - rather than a synthesiser, and parity compares the
   complete list of cycle numbers, not a summary of it. It came out exact first time over 176
   runs.

   It had to be modelled rather than captured, and that is the finding: $1D52 keeps a 16-bit
   shift register at $1D4B-$1D4C that **nothing initialises**, so a sound depends on where the
   last sound left it. Over five seeds all six of its sounds change in length as well as
   timbre - 108 toggles against 158 for the same routine. A captured waveform would have been
   one performance.

   The seventh, $1FB2 through $1D9F, has no shift register and looked capturable. It was not,
   twice over: $1DA5 is both the instruction after the speaker access and a branch target, so
   detecting a toggle by where control lands counted 16,253 where there are 85; and $1D9F opens
   with `JSR $FF4A`, which ends `TSX`, so the first period is **the stack pointer**. Modelled
   too, with the two ROM routines' costs measured (38 and 31 cycles).

   **Still not ported**: $1DBA, the third generator, and the six-note sequence at $1E40 that
   drives it - gated by a byte inside the code to fire once a game.

   **A hazard fixed on the way**, in `exercise.mjs`: `toFlight` could return before DOS had
   finished loading the binary, leaving everything above `$17EB` holding the power-on fill.
   It now waits for live memory to match the file and throws if it never does. Two findings
   had already been built on measurements taken inside that window.

   Useful structure already established: an enemy is ONE entity with TWO object
   instructions, *i* in the main view and *i+12* in the scope, switched on and moved
   together. And the spawn counters at `$1FF9`-`$1FFB` are the interface between the
   BASIC's difficulty and the binary's waves.
3. ~~Then the Applesoft around it.~~ The **decisions** are done: `port/src/game/chain.js`,
   held by `parity_progression.mjs` (11 checks) over `probe_progression.mjs` (22).

   The whole interface between the BASIC and the binary is thirteen bytes, `$1FF3`-`$1FFF`,
   inside the binary's own image. A game is 5-15 flights depending on difficulty, each a wave
   that has to be cleared to the last enemy, with a starbase between each that banks an
   accumulating bonus, and `BASE STAR.OBJ0` for the finale. `$1FF5` is the only one of the
   thirteen the binary keeps, and its increment is at `$09A0` in the once-only setup - so it
   counts flights, not passes.

   Held without a machine, on purpose: the four decisions are four Applesoft lines, so the
   harness parses each condition out of the detokenised program and compares the port's `next()`
   against it over the whole state space those lines can see, rather than against my reading
   of them.

4. **And then how those twenty programs load anything at all**: `port/src/game/dos.js`,
   held by `parity_overshoot.mjs` (9 checks) over `probe_overshoot.mjs` (17).

   A DOS 3.3 `BLOAD` writes up to 255 bytes past the end of the file, because every sector
   after the first is read straight to the destination. Every binary on this disk overshoots,
   and the game is built around it - `SD START` line 2 loads A2-3D2 then SV DATA because
   A2-3D2's one byte lands on the display list's first byte, and MAIN DATA then HEADING DATA
   because MAIN DATA's 213 bytes land inside it. The load order is a repair list.

   One overshoot has no repair: `STAR DESTROYER.OBJ0` ends at `$1FF0` and runs 250 bytes over
   the interface, so the waves the BASIC rolled as 2/2/5 reach the binary as 32/51/51 and the
   target of 7 reaches it as 217. The finale's binary has the same overshoot and all-zero
   slack, which is what says neither was intended. The port models the load rather than
   working around it, so a clean dump fixes it without a change here - the same decision as
   the title pages.

   **Still not ported**: the *presentation* around those decisions - the title (`START`,
   `LOGO1`), `SELECT`'s keyboard handling, `STARBASE` itself, the hyperdrive animation
   (`HYPERDRIVE.OBJ0` + `CLS`), `INITIALS`, `WIN`, `MONOLITH`, and `DEMO`. And
   `BASE STAR.OBJ0`, the finale's binary, which loads at the same address as
   `STAR DESTROYER.OBJ0` and is what writes `$1FFF`.

## Phase 5 notes — what the plan first said

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

## Phase 6.5 — the shell  ✅ done

Not in the original plan, which went straight from the disk to the switches and quietly
assumed a front end would appear. It did not, so this is it.

`port/index.html` plus `port/src/platform/` and `port/src/shell/main.js`:

- `platform/dsk.js` — a DOS 3.3 catalogue, read in the browser. A second implementation of
  `oracle/dsk.mjs` on purpose: the port is not allowed to depend on the arbiter.
- `platform/boot.js` — the 64K image, built by **replaying the loads the BASIC performs in
  the order it performs them**, through `game/dos.js`. Placing four files at four addresses
  would be wrong: two of those loads are repairs for the one before.
- `platform/hgr.js` — the page onto a canvas, **in colour**, held by `probe_hires.mjs`
  (11 checks). This was monochrome in the first version on the reasoning that every
  Applesoft program sets `HCOLOR=7`, so the game must be white lines. Wrong, and DISK_TRUTH
  already had the measurement: `HCOLOR` is the BASIC's own shape-table text, the game is
  drawn by A2-3D2's COLOUR opcode, and the display list uses 1 to 4 — the four hi-res hues.
  Colour 0 is the white one and the game barely uses it. Driving the real engine with each
  colour reproduces DISK_TRUTH's byte table and the port turns those bytes into green,
  violet, blue and orange, which is why the instrument panel has three colours in it.
  Monochrome phosphors stay as a menu, for anyone who had that monitor.
- `platform/input.js` — keyboard, pointer or gamepad, turned into the paddle bytes PREAD
  would have returned. Any mapping here is a substitution and the file says so; for
  *steering* it loses nothing, because the turn is three units a frame however far a paddle
  is over.
- `platform/audio.js` — WebAudio. Carries `$1D52`'s shift register across the whole session,
  because nothing initialises it and a sound depends on where the last one left it.
- `shell/main.js` — canvas, clock, keyboard. The only file in the port with no harness, and
  there is nothing in it for a harness to check.

Verified in the browser: the turn is exactly three units a pass, object 12's heading tracks
the viewer's, the trigger produces `$1F73`, and both of the loop's exits report
(`$00` = `$4D`, and wave clear).

## Phase 6.6 — the presentation  (part done)

The twelve programs between the flights. **They are run, not transliterated**: they are
Applesoft, they are on the disk, and an interpreter cannot drift from them the way twelve
hand-translations would. The four pieces that are *not* BASIC are a different matter and
are below.

Done:

- `port/src/game/applesoft.js` — the interpreter, over `probe_applesoft.mjs` (7 checks).
  54 tokens used on this disk, all 54 implemented, and the port parses the same 380 lines
  as the oracle's reader.
- `port/src/platform/display.js` — the eight soft switches, watched through POKE.
- `port/src/platform/text.js` — the 40x24 page, its interleave and three styles. The glyph
  shapes are a stand-in: the real ones are in a character ROM, not on this disk.
- `port/src/platform/host.js` — POKE/PEEK, the text cursor, Applesoft's HPLOT, the DOS
  commands, the keyboard, the high-score file. Unimplemented CALLs are recorded and shown
  rather than being fatal or silent.
- `port/src/shell/presentation.js` and `boot.js` — the chain, and the handover to the
  flight loop at `BRUN STAR DESTROYER.OBJ0`.

**It boots.** START, LOGO1, the difficulty screen from the disk's own DIFFICULTY.PIC, SD,
SD START, SD PART2, the flight, MONOLITH, INITIALS - in the browser, one screen at a time.

Still to do here: the Applesoft shape table, which `INITIALS` and `STARBASE` draw their
text with (105 DRAW calls in one pass through the high scores); writing the high-score
file somewhere it survives; and `$FC42`, a monitor routine three programs CALL that this
repository has not identified.

## Phase 6.7 — the four that are not BASIC

The owner's call, taken 2026-11-05: **transliterate each, the way the flight loop was**,
rather than running them under a 6502 interpreter. Same method and same evidence standard
throughout.

- `TITLE.OBJ0`, 1,792 bytes — the title animation, CALLed by LOGO1.
- `HYPERDRIVE.OBJ0`, 2,048 bytes, with `CLS`, 250 — the warp sequence between flights.
  `CLS` is cheaper than it looks: `CLS DATA` on the disk is its source, in BASIC.
- `PLAYER.MODULE`, 208 bytes — the music, CALLed by SELECT, MONOLITH and WIN.

## Phase 7 — the switches

Only now, and all defaulting to off: save states, frame rate, gamepad. Each one measured
against the fidelity baseline so the difference is a choice rather than a drift.

Three are already in the shell, all defaulting to the disk: **frame rate** (a menu from the
disk's 2.57 passes a second up to 60, and raising it speeds the whole game up rather than
smoothing it, because a pass is a full tick of game state as well as a frame — there is no
interpolation on offer and inventing one would draw positions the original never computed),
**analogue steering** (`Input`'s `analogue`, which is the gamepad switch's
groundwork), and **repair the interface** (`boot`'s `honest: false`), which is the odd one
out - it does not improve on the original, it undoes what this disk image does to it, and
on a clean dump it would be a no-op.

Still to do: save states.

---

## What a clean dump would change

Two things now, and the second is testable the moment one exists:

1. The two title pictures come back and `START` needs no change.
2. If bytes 5,894-6,143 of `STAR DESTROYER.OBJ0`'s sector chain are zeros on a clean dump,
   then the interface survives its own `BRUN` there and the game plays as designed - and this
   image, not the game, is why it does not. See DISK_TRUTH, "A BLOAD writes past the end of
   the file".

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
