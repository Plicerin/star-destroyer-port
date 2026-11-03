# DISK_TRUTH

What the original *Star Destroyer* disk actually does, measured from the disk running under
the oracle. **This is the only findings document to trust.** Every entry says how it was
obtained and can be re-derived by running the probe named against it.

The rule: **the disk is the only source.** If something is not in here, it is not known.

Status: **prep only.** Nothing has been ported yet. This file holds what the first pass over
the disk established, and the list of what it did not.

---

## How a finding gets into this file

1. A probe in this directory produces it from the disk, running or read.
2. The probe is committed, so the number can be reproduced.
3. The entry names the probe and what it observed.

Anything worked out by reading a listing rather than reading the machine is marked as such
and is not settled until measured.

---

## The headline: this disk is a change

`probe_boot.mjs` — the disk boots to a brick wall with a sign on it reading **the replacement art**, with two phone numbers. It is not the game's title screen.

`probe_pics.mjs` — worse than an added screen. The game's own two title pages, `SD.PIC1` and
`SD.PIC2`, are **byte-identical to each other and both are the replacement art** (11,672 lit pixels
each). `START` BLOADs them at `$2000` and `$4000` and shows them, so whoever modified it did not
bolt an intro on the front: they overwrote the originals in place.

**The original Star Destroyer title screens are not on this disk.** No probe can recover
them, because they are not there to read.

What this does *not* appear to have touched: the other four pictures are game art, all 21
Applesoft programs detokenise cleanly, and the game plays through to flight. The change is
visible in two files and the boot. Whether it changed anything else is **not established** —
see the open questions.

---

## What the disk is

`dsk.mjs`, read by every probe here — a 143,360-byte DOS 3.3 image, 35 tracks × 16 sectors × 256 bytes. The
VTOC reports DOS 3.3 and the catalog chain reads to the end without a bad link. **48 files.**

| group | files |
| --- | --- |
| Applesoft | 21, all detokenised by `probe_chain.mjs` into `listing/` |
| 3-D engine | `A2-3D2` at `$6000`, 8,443 bytes |
| scene | `SV DATA`, `SV DATA2` at `$80FB`, 491 bytes — the display-list program, see below |
| model data | `MAIN DATA`, `STARBASE MAIN DATA`, `BASE STAR DATA` — all at `$83AE`, all exactly 1,575 bytes |
| pictures | 6 whole hi-res pages at `$2000` |
| overlays | 6 `.OBJ0` binaries at `$08EF` |
| music | `PLAYER.MODULE` at `$0300`; `M.STAR DESTROYER`, `M.END` at `$2900` |
| other | `HEADING DATA` `$89CB`, `MATH` `$98F3`, `CLS` `$1ED2`, `CHR$.A24576.L148` `$6000` |
| writable | `INITIALS.DAT`, a text file — the high scores live on the disk |

---

## Who made it

`probe_pics.mjs`, read off `DIFFICULTY.PIC`, which is the game's own difficulty screen and
says it in its own words:

- **HARVEST TIME SOFTWARE COMPANY**
- **STAR DESTROYER**
- **© 1983 BY MITCHELL ROBBINS**
- **A2-3D2 COPYRIGHT 1981 SUB LOGIC**

So: the same author as *Space Vikings*, one year later, self-published rather than through
subLOGIC, and built on subLOGIC's **A2-3D2** 3-D graphics package rather than on hand-rolled
`HPLOT`. The year is **1983**, from the screen, not 1982.

---

## The boot chain

`probe_chain.mjs` detokenises all 21 programs; the route below was then walked in the
machine by `probe_play.mjs`.

```
boot -> START -> LOGO1 --(a key within 500 BASIC iterations)--> SELECT -> SD -> SD START
                   |
                   +--(no key)--> DEMO
```

- `START` draws its text-screen message (`PREPARE YOURSELF FOR THE ULTIMATE / STARSHIP
  BATTLE! / PRESS ANY KEY TO SKIP TITLE PAGE.`), BLOADs `SD.PIC1` at `$2000` and `SD.PIC2`
  at `$4000`, chains `LOGO1`.
- `LOGO1` BLOADs `TITLE.OBJ0`, then `FOR J = 1 TO 500` polling `$C000`. A key chains
  `SELECT`; the loop running out does `CALL 2287`, `CALL 62454` and chains `DEMO`.
- `SELECT` shows `DIFFICULTY.PIC` and chains `SD`.
- `SD` chains `SD START`, after `BLOAD MATH`.

The chain is only partly recoverable from the listings: several programs build their DOS
command from a variable, so what they run next is not in the text. Those edges are unknown
until walked in the machine.

---

## Difficulty

From `SELECT` (listing), confirmed live by `probe_play.mjs`:

`SELECT` zeroes `$1FF3`–`$1FFF`, then writes the chosen level to **`$1FF6`** and an enemy
count to **`$1FF8`**:

| key | level | enemies |
| --- | --- | --- |
| 1 | HARD | `5 + RND(1)*3` → 5 to 7 |
| 2 | HARDER | `8 + RND(1)*3` → 8 to 10 |
| 3 | HARDEST | `10 + RND(1)*6` → 10 to 15 |

Anything outside 1–3 loops back. Measured: pressing `1` left `$1FF6 = 1` and `$1FF8 = 7`.

**`SELECT` does not wait for a key.** Line 16 reloads the picture and the music, line 17
reads `$C000` exactly once, and if nothing is pending it chains `DEMO`. The press has to land
inside that load. (The first version of `probe_play.mjs` slept three seconds and read once,
got the uninitialised `0` and `255` still sitting at those addresses, and reported them as
the answer.)

---

## Music

`SELECT` line 2000, not yet measured in the machine:

```
BLOAD PLAYER.MODULE : BLOAD M.STAR DESTROYER,A24576 : POKE 30,0 : POKE 31,96 : CALL -958 : CALL 768
```

`PLAYER.MODULE` loads at `$0300` and `CALL 768` is `$0300`, so it is the player. The tune is
BLOADed to `A24576` = **`$6000`** — overriding the `$2900` in its own header, and landing on
the same address as `A2-3D2` and as `CHR$.A24576.L148`. Three different things claim `$6000`;
which of them is resident when is **not established**.

`probe_boot.mjs` saw the 6502 at `$03BD` and `$03AE` while the title sat idle, which is the
player running.

---

## The oracle

`a2.mjs` runs the `.dsk` in apple2js (vendored under `emu/`) in headless Chromium. It is the
Space Vikings harness with four changes, all forced by this disk:

### WebGL has to be asked for by name

apple2js draws through a WebGL shader and only resolves `apple2.ready` once the screen is
up. A machine whose shader fails to compile **never finishes assembling**: `getIO()` stays
`undefined` and every probe dies on `Cannot read properties of undefined (reading '_slot')`.
In headless Chromium that depends on the GPU path the host offers that minute — `unable to
compile shader COMPOSITE` on one run, a clean boot on the next.

```js
args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
```

This is a **latent flake in the Space Vikings suite too**, which has been getting the good
path by luck.

### Wait for the IO, not for the object

`window.Apple2.apple2` appears well before the machine is assembled. The wait now requires
`getIO()` to return something.

### The display mode is on `vm`, nowhere else

- `getIO().getState()` carries `annunciators` and `cards` and **no display flags at all**.
  Asking it for `.hires` returns `undefined`.
- The read-only status switches `$C01A`–`$C01D` answer **0 for all four whatever the mode**,
  so peeking them is a reading that cannot be anything but zero.
- `a2.vm.getState()` is the real one: `{ textMode, mixedMode, hiresMode, pageMode, ... }`.

The first `probe_boot.mjs` used the first of those and reported `TEXT` for sixty seconds
while the hires pages were visibly churning.

### Power-on RAM has to be fixed, or nothing is reproducible

apple2js fills RAM the way a real Apple II wakes up: `s & 2 ? 0 : 255`, with **four random
bytes every 512** at offsets 40, 41, 104 and 105. That is faithful, and it means any
reading taken before the disk has overwritten that address is different on every run.

`probe_boot.mjs` had been writing a golden with samples at 0.5s, 1s, 2s and 5s, and those
four changed every single time it ran. A golden that cannot be reproduced records the
random number generator, not the disk.

`a2.mjs`'s `coldStart()` now fills RAM deterministically before entering the boot ROM, and
every probe goes through it. Two complete runs of the suite produce byte-identical
captures.

A fixed choice is as true as a random one — real power-on RAM is arbitrary — but only if
the disk does not *depend* on it, so that is a check rather than a hope. `probe_boot.mjs`
cold-starts with `$00` and with `$A5` and compares:

| at | |
| --- | --- |
| 0.5s, 1s, 2s | differ — most of what is being hashed is still the fill itself |
| 5s | differ only in hires page 2 |
| 10s | **identical** |

So **the game seeds nothing from power-on RAM.** No random number, no timing, nothing.
Wherever its randomness comes from, it is not there.

### Identifying a screen

`screens.mjs` compares the displayed page against the six `.PIC` files read off the disk, so
"is this the difficulty screen" is answered by the disk rather than by a guess at the video
mode. The first `probe_play.mjs` asked "hires on page 1?", which the title also satisfies, and
passed on the wrong screen.

---

## Verified reachable

`probe_play.mjs`, 5 checks, all passing:

- the disk boots to `START`
- a key reaches the difficulty screen — `DIFFICULTY.PIC`, matching the disk file **exactly**
- `1` writes difficulty 1 and an enemy count in 5–7
- the game draws a screen of its own: starfield, centre reticle, and an instrument panel of
  three bar gauges and a scope (`captured/play/03_game_25s.png`)

So the method holds: the oracle can boot this disk, answer its prompts, and reach flight.

---

## The A2-3D2 scene format

This is the centre of the port, and it is now read. Three probes: `probe_datafiles.mjs`,
`probe_objtable.mjs`, `probe_shapes.mjs`, with `render_shapes.mjs` drawing the result.

### The BASIC names its own API

`SD START` line 3, `SD RET` line 4 and `STARBASE` lines 1 and 127 assign the addresses to
variables, so these labels are the author's, not inferred:

| address | his name | what |
| --- | --- | --- |
| `$6000` | `CA` | A2-3D2 itself. `CALL 24576` renders one frame. |
| `$8110` | | page soft switch, `84` = `$C054`, `85` = `$C055` |
| `$8112`, `$8114` | | the other half of the page flip |
| `$8116`/`$8118`/`$811A` | `XI`/`YI`/`ZI` | viewer position, 16-bit each |
| `$811C`/`$811D`/`$811E` | `P1`/`B1`/`H1` | pitch / bank / heading, one byte each |
| `$8124`, `$8248` | `ST1`, `TS1` | the two object tables |
| `$817B` | | a rotation, stepped by 15 in `STARBASE` |
| `$81DD`/`$81F3`/`$8209` | `SHLD`/`WARP`/`MSL` | shields, warp, missiles |
| `$8222`+3n | `S(1)`..`S(7)` | seven three-byte somethings |
| `$89CB` | `S1` | where `HEADING DATA` is BLOADed |

`STARBASE` lines 185-186 are the render loop in miniature: poke the page switch, poke the
rotation, `CALL 24576`, flip, repeat.

### Two tables of twelve 13-byte records — which are twenty-four instructions

`probe_objtable.mjs`, 16 checks. At `$8124` and `$8248`, twelve records of thirteen bytes
each. Bytes +0..+9 are runtime state and ship as zero; **+10/+11 is a pointer to the
object's shape**; +12 is 19 for twenty-three of the twenty-four.

The BASIC switches an object on by poking +0 (`POKE ST1,255`) and off with 0.

The stride is not a guess. Two independent runs give it: the author's own pokes step by 13
(`$8124`, `$8131`, `$813E`, `$814B` and `$8248`, `$8255`, `$8262`, `$826F`), and
`SV DATA` and `SV DATA2` — the same 491-byte block configured for two different scenes —
**differ in eight bytes and no others**, all of them the pointer field of records 1 to 5.
Nothing else in the per-scene configuration changes at all.

The length is not a guess either: laid out this way the first twelve records are identical
in shape and the thirteenth is visibly not a record. `$8124 + 12*13 = $81C0`, exactly where
the regularity stops.

**Corrected by `probe_renderer.mjs`, one byte to the left.** These are not records in a
table. Each is an *instruction* — opcode 19 followed by twelve operand bytes — in the
display-list program that `SV DATA` is, so the first one begins at `$8123`, not `$8124`.
That is why "+12 is 19": +12 is not a field, it is the next instruction's opcode, and the
twenty-fourth lacks one because nothing follows it. The author's `ST1` and `TS1` are
operand 0 of the first opcode in each run, which is where a `POKE` has to aim.

Everything measured about the records survives the correction; only the frame around them
changes. Opcode 19's operands, from its handler at `$6D07`:

| operand | what |
| --- | --- |
| 0 | 0 = skip the object, `$FF` = draw it, 1-254 = draw it and **decrement this byte in place** |
| 1-6 | the object's position: X, Y, Z, 16-bit each, subtracted from the viewer's at `$70E3` |
| 7-9 | the object's attitude: pitch, bank, heading |
| 10-11 | the shape — written straight into the list pointer, which is how the engine recurses |

The countdown in operand 0 is read off the handler, not observed: in flight every object
is either 0 or `$FF`, and no counter was seen to tick.

### The shape format

`probe_shapes.mjs`, 14 checks, and `shapes.mjs` carries the reader.

A shape is a list of commands and a terminator. Nearly every command is **seven bytes** —
an opcode, then X, Y, Z as 16-bit little-endian signed. `COLOUR` is two.

| opcode | bytes | meaning |
| --- | --- | --- |
| 0 | 7 | POINT |
| 1 | 7 | MOVE — pen up |
| 2 | 7 | DRAW — pen down, line from the last point |
| 3 | 7 | a fourth kind, **not explained** |
| 18 | 2 | COLOUR, one operand, only ever 1-4 |
| 121 | 1 | end of shape |

Read this way, **MAIN DATA and BASE STAR DATA parse with no opcode above 3 and no
coordinate outside -140..130.**

`render_shapes.mjs` draws each one front, top and side. Shapes 0 and 1 are unmistakably
swept-wing spacecraft; 8 to 11 are flat sixteen-point starbursts at radius 21, 35, 63 and
84, which is an explosion in four sizes; 16 to 19 are single points; 20 to 23 are squares.
A mis-sliced parse does not come out looking like that.

### The control

`STARBASE MAIN DATA` shares `SV DATA`'s pointer table while holding different shapes, so
most of those pointers are stale for it. The records `STARBASE` switches **on** (0 and 6,
line 129) parse clean; the ones it explicitly zeroes (1, 2, 3, line 7) **de-sync**. The
parser can still fail, which is the only reason the fourteen passes above mean anything.

---

## The renderer

`probe_renderer.mjs`, 19 checks, with `renderer.mjs` holding the reading and
`listing/A2-3D2.asm`, `listing/SV_DATA.list` and `listing/SV_DATA2.list` the output.

Read two ways that have to agree: the binary disassembled from the disk, and the same
engine traced instruction by instruction in the oracle while the game flies.

### A2-3D2 is an interpreter, and `SV DATA` is a program

`CALL 24576` is `JSR $6000`, and `$6000` is a four-entry jump table:

| call | what |
| --- | --- |
| `$6000` | render a frame, saving the 96 bytes of zero page it uses |
| `$6003` | render a frame without saving them |
| `$6006` | cosine of a one-byte angle |
| `$6009` | sine of a one-byte angle |

`$6000` copies zero page `$60`-`$BF` into `$600C`-`$606B`, calls `$6003` and copies it
back, which is what those 96 bytes are: not code, not data, a save area.

The frame routine zeroes its state, points a 16-bit zero-page pointer `$9B`/`$9C` at
**`$80FB`** - where DOS loads `SV DATA` - and runs the interpreter at `$6118`:

```
$6118  LDA #$0A  STA $B1          ; ten clip steps allowed for this command
       LDY #$00
       LDA ($9B),Y                ; fetch the opcode
       BMI end                    ; >= $80 stops
       CMP #$1E  BPL end          ; >= 30 stops
       ASL A  TAX
       LDA $60DC,X ... JMP ($A3)  ; dispatch
```

So the instruction set is **exactly thirty opcodes**, dispatched through thirty two-byte
entries at `$60DC`. That is not a count of what this disk happens to use: the table runs
from `$60DC` to `$6117` and the interpreter starts at `$6118`, so a thirty-first entry
would overwrite the code that reads it.

Each handler advances the pointer itself, through `$621F` ("add A to the list pointer"),
so an instruction's length belongs to its opcode. Fourteen of the thirty were measured in
the running machine - the distance the pointer moved between one fetch and the next - and
all fourteen matched the `LDA #n` in their handler. The rest this disk never executes, and
their lengths are read off the handler only, which the table in `renderer.mjs` says of
each one.

**The test of the whole reading** is that `SV DATA` then decodes end to end: 491 bytes,
variable-length instructions, **71 of them**, landing on the terminator at `$82E3` with
two spare bytes after it. A wrong length de-synchronises and cannot drift back into phase.
`SV DATA2` does the same, and the two differ in five instructions, all of them objects
pointing at different shapes.

### What the scene says

Readable now, start to finish (`listing/SV_DATA.list`):

```
$80FB  VIEWPORT xscale 140 yscale 126 xcentre 0 ycentre 34
$8107  MODE 0
$8109  SWITCH $C052 / $C050 / $C057 / $C054      <- graphics, hires, mixed, page 1
$8111  CLEAR page 1
$8113  DRAWTO page 1
$8115  VIEWER at 0,0,0  pitch 0 bank 0 heading 0
$8123  OBJECT x12                                <- the first "table"
$81BF  COLOUR 1 ... LINE2D ... POINT2D x7        <- the instrument panel
$8236  VIEWPORT xscale 65 yscale 66 xcentre 32 ycentre 195
$823D  VIEWER ...                                <- a second viewpoint
$8247  OBJECT x12                                <- the second "table"
$82E3  END
```

Several things the earlier passes had as addresses are now instructions:

- `$8110`, the "page soft switch" the BASIC pokes with 84 or 85, is the **operand of a
  `SWITCH` instruction** whose handler patches its own `STA $C0nn`. `$8112` and `$8114` are
  the operands of `CLEAR` and `DRAWTO`.
- `XI`/`YI`/`ZI`/`P1`/`B1`/`H1` at `$8116`-`$811E` are the nine operand bytes of the
  `VIEWER` instruction at `$8115`.
- `SHLD` `$81DD`, `WARP` `$81F3` and `MSL` `$8209` are each the **third operand byte of a
  2-D line** - the x of its far end. The three bar gauges are one line apiece, and the
  BASIC moves their right-hand ends.
- `S(1)`..`S(7)` at `$8222`+3n are seven **2-D point** instructions: the blips.
- The 136 bytes at `$81C0`-`$8247` that nothing accounted for are the whole instrument
  panel, plus a second viewport and viewpoint. The second `VIEWPORT` is small (scale 65x66
  at centre 32,195) and is followed by its own `VIEWER`, which is the scope inset.

### The geometry

- **Angles are one byte to the turn.** `$6147` holds a 64-entry 16-bit quarter sine table
  and `$61CB` folds the quadrants onto it; `$61C8` is the same table entered 64 units
  earlier, which is the cosine. Both are exposed as engine entry points. A port that uses
  `Math.sin` will not land on the same pixels.
- **The field of view is exactly 90 degrees.** `$6A22` and `$6A7B` build a four-bit outcode
  per point by testing `z+x`, `z-x`, `z+y`, `z-y` for overflow, which is the frustum
  `|x| <= z`, `|y| <= z`. The drawing code rejects a line whose two outcodes share a bit -
  Cohen-Sutherland's trivial reject.
- **The clipper is a bisection, not an intersection.** A line that straddles a plane is
  walked inward by halving, at most **ten times**, counted down in `$B1`, which `$6118`
  reloads with 10 for every command. Clipped endpoints are therefore approximate in a
  specific, reproducible way, and a port that solves the intersection exactly will differ
  from the original at every window edge.
- **The projection** is at `$6370`-`$63AF`: divide, scale by a constant, add a centre. Both
  constants for both axes are **bytes inside that code** (`$6380`, `$6386`, `$63A3`,
  `$63A9`), patched by the `VIEWPORT` instruction. x and y are scaled separately, which is
  where the aspect correction lives.

### Opcode 3, and the shape format

Opcode 3 was an open question. Its handler `$62C0` loads the **saved previous point** as
the far end, reads a new point as the near end, draws between them, and - reading through
`$624B`, which does not update the saved point - leaves the previous point where it was.
A run of opcode 3s is a hub with spokes radiating from it.

`render_shapes.mjs` had been drawing nothing at all for it. Redrawn, MAIN DATA's shape 3
is a hexagonal cone: six spokes to a centre, and a spire.

The engine also reads opcode 1 as a single **fourteen**-byte instruction, two points, a
move and a draw - the pair `shapes.mjs` had been reading as a 7-byte move always followed
by a 7-byte draw. Same geometry, so that reader is left alone, with a note.

### It rewrites itself

The resident engine is **not** the file on the disk. Outside the save area, 119 bytes
differ while the game flies, in four mechanisms, each one an opcode patching the code:

| opcode | patches | effect |
| --- | --- | --- |
| 7 `SWITCH` | `$63E8` | the low byte of a `STA $C0nn` |
| 9 `DRAWTO` | `$7C2D`, `$79A7`, `$7C68`, ... | the hires page base, in the plotting code |
| 12 `PLOTMODE` | `$7734`, `$7739`, ... | `ORA (zp),Y` against `EOR (zp),Y` - draw or erase |
| 14 `VIEWPORT` | `$6380`, `$6386`, `$63A3`, `$63A9` | the two scales and the two centres |

Measured, not assumed: the probe compares the running image against the disk and checks
those four addresses are among the differences. It also disassembles both - and thirteen
addresses the machine executed are ones a disassembly of the *disk* does not find, all of
them in the patched stretch between `$7700` and `$7D00`, because the patched bytes move
the instruction boundaries. `listing/A2-3D2.asm` is therefore a listing of the **resident**
image.

### The cadence

| | |
| --- | --- |
| one `CALL 24576` | **316,000 cycles**, three frames within 0.8% of each other |
| in time | **309 ms**, so **3.23 renders a second** |
| 6502 instructions | about 95,000 a frame |
| display-list fetches | 122 |

The engine is not synchronised to anything: it runs until it is done, 18.6 video frames
later. Whatever the port does about frame rate, **3.2 Hz with a 90-degree frustum and a
ten-step bisection clipper is what the original looks like**, and that is the baseline
fidelity has to be measured against before any smoothing is offered as an option.

### What is resident at `$6000`

Measured during flight: `A2-3D2`, byte-identical to the disk file apart from its own
patches. The character set and the music both BLOAD to `$6000` as well, but not while the
game is flying.

---

## Open questions

Things this pass did **not** establish. None of them should be guessed at later and quietly
promoted to fact.

1. **What the original title screens looked like.** Gone from this image. Only a clean dump
   can answer it.
2. **Whether the change changed anything else** — the RWTS, a protection check inside a
   binary, the contents of `INITIALS.DAT`. Comparing against a second image is the only
   honest way to answer it.
3. ~~**Opcode 3.**~~ Answered: a line back to the saved previous point, which it leaves
   in place. Handler `$62C0`.
4. ~~**What `CALL $6000` does with all this.**~~ Answered above, with two things still open
   under it: the exact screen mapping of the 2-D coordinates (`$771C` and `$7745` hold it,
   and the panel's y values run past 192, so they are not straight pixel coordinates), and
   the fourteen opcodes this disk never executes, whose lengths are known and whose
   meanings are not.
5. ~~**The 13-byte record's bytes +0 to +9.**~~ Answered: a frame counter, a 16-bit
   position and a three-byte attitude. The counter's decrement is read off the handler and
   was never seen to happen.
6. ~~**`$81C0`-`$8247`.**~~ Answered: the instrument panel, as display-list instructions.
7. ~~**What is resident at `$6000`.**~~ Answered for flight: A2-3D2. Not established for
   the title, the demo or the end sequence, where the music loads over the same address.
8. **The `.OBJ0` overlays at `$08EF`**, which is 238 bytes above Applesoft's `$0801`. How a
   BASIC program and a binary share that space is not understood.
9. **`INITIALS.DAT`** — the game writes high scores back to the disk. Nothing has been
   measured about when or in what format.
10. **The `DEMO` path**, never walked.
11. **`MATH` (`$98F3`) and `HEADING DATA` (`$89CB`).** `SD` BLOADs `MATH` before chaining
    `SD START`, and nothing in the renderer trace reads either of them.
