# DISK_TRUTH

What the original *Star Destroyer* disk actually does, measured from the disk running under
the oracle. **This is the only findings document to trust.** Every entry says how it was
obtained and can be re-derived by running the probe named against it.

The rule: **the disk is the only source.** If something is not in here, it is not known.

Status: **the port has started.** See `PORT_PLAN.md` at the repo root for the phases. This
file remains the findings document: it records what the original disk does, and the port
is held to it by the `parity_*.mjs` harnesses alongside the probes.

**Owner's decision, 2026-11-03: the port does not reproduce the replacement art.** The two title
pages are built as a missing asset rather than a removed feature, so a clean dump can
restore them without a code change. The owner is looking for one; nothing else waits on it.

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

`probe_salvage.mjs` settles the "are you sure?" part, because deleting a file on a DOS 3.3
disk frees its sectors without erasing them, so there was a chance the old pages were
still lying in free space. They are not, and they cannot be: **the disk has ten free
sectors — 2,560 bytes — and a hi-res page is 8,192.** There is nowhere for them to hide.
The VTOC's own free map agrees with walking all 48 files sector by sector, so that is the
whole of the unused disk.

What this does *not* appear to have touched: the other four pictures are game art, all 21
Applesoft programs detokenise cleanly, and the game plays through to flight. The change is
visible in two files and the boot. Whether it changed anything else is **not established** —
see the open questions.

## Four files were deleted from this disk

`probe_salvage.mjs`, 9 checks. DOS 3.3 keeps a deleted file's catalog entry — it writes
`$FF` over the first byte of the track/sector pointer and moves the original track number
into byte 32, the last of the thirty name bytes. So the names survive:

| name | sectors | |
| --- | --- | --- |
| `STAR DESTROYER.ASM` | 25 | **the game's own assembly source** |
| `DEMO` | 19 | superseded — a live `DEMO` exists |
| `CLEAR SCORES` | 2 | superseded — a live `CLEAR SCORES` exists |
| `STARBASE II` | 1 | **exists nowhere on this disk** |

None of the four is recoverable: every one of their track/sector lists has been written
over by a live file. The ten free sectors hold fragments of whatever went last — readable
strings in them include `RUN SELECT` and `BLOAD MAIN DATA`, and the assembler's own
`FORWARD REFERENCES:` — which is kept at `captured/salvage/free_sectors.bin` rather than
described.

**The game still hangs together.** Every DOS command in all 21 Applesoft programs was read
out and checked against the catalog: 32 distinct file names are referenced and all 32 are
present. Neither of the two files that were deleted and never replaced is wanted by
anything. So apart from the title pages, this disk is complete.

That `STAR DESTROYER.ASM` was ever here is the most interesting thing in this section: the
author's source was on the game disk, and a clean dump might still carry it.

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
  `SELECT`; the loop running out does `CALL 2287`, `CALL 62454` and chains `DEMO`. **The
  branch nobody takes is the one with the story in it** - `DEMO` is where the game says what
  it is about, drawn from the shape table. See *The ship is called the Beowulf*.
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
- `S(1)`..`S(7)` at `$8222`+3n are seven **2-D point** instructions: **the stars**. They are
  white, they sit in the sky above the horizon, and they are drawn through the *main*
  viewport, before the second one begins - so they are part of the view, not part of any
  instrument. `$1B95` and `$1BD5` pan all seven sideways three steps per turn, against the
  turn, and they wrap; nothing else moves them and they never move vertically. This file
  called them "blips" for a long time, by association with the scope inset two lines below,
  which is a different thing entirely.
- The 136 bytes at `$81C0`-`$8247` that nothing accounted for are the whole instrument
  panel, plus a second viewport and viewpoint. The second `VIEWPORT` is small (scale 65x66
  at centre 32,195) and is followed by its own `VIEWER`, which is the scope inset.

### The geometry

- **Angles are one byte to the turn.** The 16-bit quarter-turn table starts at `$6146`,
  `$61CB` folds the quadrants onto it, and `$61C8` is the same table entered 64 units
  earlier. **`$61CB` is the COSINE and `$61C8` is the SINE** - this file had them the
  other way round until `parity_view.mjs` measured all 256 angles of each: at angle 0,
  `$61CB` returns 32767 and `$61C8` returns 0.

  A port that uses `Math.sin` will not land on the same pixels, and neither will one that
  mirrors the table into the negative quadrants. The folding negates its two bytes in the
  wrong order, so `cos(128)` comes back as **-32383** where a true -1.0 would be -32767.
- **The clip frustum is `|x| <= z`, `|y| <= z` in view space.** `$6A22` and `$6A7B` build a
  four-bit outcode per point by testing `z+x`, `z-x`, `z+y`, `z-y` for overflow. The
  drawing code rejects a line whose two outcodes share a bit - Cohen-Sutherland's trivial
  reject.

  That test runs on the point **after** the transform, and the transform scales each axis
  by one of opcode 15's constants, so the cone visible in *world* space is
  `|x| <= (sz/sx) z` and `|y| <= (sz/sy) z`. With the shipped constants
  (16000, 32767, 9541) that is:

  | | |
  | --- | --- |
  | horizontal field of view | `2 atan(9541/16000)` = **about 62 degrees** |
  | vertical field of view | `2 atan(9541/32767)` = **about 32 degrees** |

  (This file said "the field of view is exactly 90 degrees" after the renderer pass, which
  was the view-space frustum mistaken for the world-space one, and then "not a fixed
  angle", which was truncation noise mistaken for a varying ratio. It is fixed, and it is
  set by three bytes a scene can change.)
- **The clipper computes exact intersections.** ~~A bisection.~~ This file said the
  opposite after the renderer pass - "walked inward by halving, at most ten times" - and
  `parity_clip.mjs` shows a bisection reproduces the engine on **0 of 45** clips, so that
  description would have been wrong at every clipped edge. What `$6AEE` does, for the one
  plane it picks:

  ```
  t   = f(p2) / (f(p2) - f(p1))     a Q15 parameter, via the engine's DIV
  p2' = p2 + t * (p1 - p2)          two axes through MULCORE
  ```

  with the plane's own axis forced equal, so the point lands exactly on it. `$6AD4` clips
  the other endpoint by swapping the two slots, clipping, and swapping back.

  The `DEC $B1` loop, with the **ten** that `$6118` reloads for every command, is a cap on
  how many PLANES one line may be clipped against - clipping to one can leave the point
  outside another - not a halving count.
- **The projection** is at `$6367`, and it is now a formula rather than a shape - see
  below.

### What a 2-D coordinate means

`probe_screen2d.mjs`, 13 checks. The display list is full of 2-D coordinates - every panel
line, every star, and whatever the 3-D projection produces - and the panel's run past 192
and 140, so they are plainly not pixels.

The answer is the 1,024 bytes at `$7223`-`$7622` that the renderer pass could only call "a
table". They are **four 256-byte tables**, and the point plotter at `$771F` indexes them
directly, assembling the whole screen address out of them with `$99` held at zero:

| table | indexed by | gives |
| --- | --- | --- |
| `$7223` | y | the row address, high byte (plus `$BB`, the page) |
| `$7323` | y | the row address, low byte |
| `$7423` | x | the byte offset within the row |
| `$7523` | x | a two-bit mask |

So the mapping can be read off exactly, and then made to happen:

> **x is a signed byte, 0 at the centre of the screen, one unit = two hires bits.**
> **y is a signed byte, `row = 95 - y`, so positive is up.**

Both are exact, and both are exactly the size of the screen. The 140 x values from **-70 to
69** cover all 280 bits once each with nothing left over; the 192 y values from **-96 to
95** cover all 192 rows. Outside those the tables wrap, and the engine plots somewhere
wrong rather than not at all.

That makes the panel readable as a picture: `LINE2D 199,173 -> 244,173` is x -57 to -12 on
row 178, which is the shield bar, left of centre, near the bottom.

Measured, not just read: `exercise.mjs` writes a display list over `SV DATA`, calls the
engine at `$6003`, and reads the page back. Eleven points predicted from the tables all
landed on the predicted row and inside the predicted cell.

**A cell is two bits and the colour chooses which one** - which is how hires carries
colour at all. Measured by plotting eight cells in each colour and reading the bytes:

| colour | pattern | |
| --- | --- | --- |
| 0 | `$FF $7F` | both bits of every cell: white |
| 1 | `$2A $55` | one bit, palette 0 |
| 2 | `$55 $2B` | the other bit, palette 0 |
| 3 | `$D5 $AB` | palette 1 |
| 4-7 | `$AA $D5` | palette 1, the other phase - **4, 5, 6 and 7 are the same colour** |

There are five, not eight. The pattern alternates between even and odd bytes because seven
bits to a byte is odd, which is the Apple II's usual arithmetic.

`probe_hires.mjs` (11 checks) re-runs this measurement and then carries it through to the
screen: the port's renderer turns those bytes into **green, violet, blue and orange** for
colours 1, 2, 3 and 4, and white for 0. Four hues, which is why the instrument panel has
three colours in it. The shell shipped monochrome first, on the reasoning that every
Applesoft program sets `HCOLOR=7` so the game must be white lines — but `HCOLOR` is the
BASIC's own shape-table text, and this table was already here saying otherwise. Recorded
rather than quietly fixed, because the mistake was reasoning past a measurement that was
already in this file.

And one artifact a port has to carry: **20 of the 140 cells straddle a byte boundary**
(x = 3, 10, 17, 24 ...). Their mask has bit 7 set, so the engine ORs the mask into one byte
and `$01` into the next - and bit 7 of a hires byte is not a pixel, it is the palette
select. Plotting at one of those x values flips that byte's colour as a side effect. It is
the engine's behaviour, not a misreading of it.

And it is **visible**: eight cells in colour 2 light nine bits, not eight, and three of the
resulting pixels come out white rather than violet, because the straddle puts three lit
pixels in a row across the byte boundary and three in a row fills two cells. A monochrome
renderer cannot show that at all, which is the second reason the first one was wrong.

### Calling the engine with a list of our own

`exercise.mjs`. `$6090` does not take the list's address: it loads `$9B`/`$9C` with `$80FB`
from two immediate operands in its own code, which is where DOS puts `SV DATA`. So an
experiment saves those 491 bytes, writes its own list there, calls `$6003` with a return
address of `$FFFE` pushed, steps until the PC reaches `$FFFF`, reads the page and puts
`SV DATA` back.

This is how anything about the engine gets settled that the disk's own scene does not
happen to exercise.

### All thirty opcodes

`probe_opcodes.mjs`, 22 checks. `SV DATA` uses sixteen. For the other fourteen the
renderer pass could give a length and nothing else, because reading a handler says what it
stores where, not what the instruction is for.

So they were run. Every length in the table below was measured in the machine - the
distance the list pointer moved between one fetch and the next - and every meaning marked
*exercised* is something the engine was made to do on inputs of our choosing.

| op | len | what |
| --- | --- | --- |
| 0 | 7 | POINT, 3-D |
| 1 | 14 | LINE: two 3-D points, a move and a draw |
| 2 | 7 | DRAW ON: line from the previous point to this one |
| 3 | 7 | DRAW BACK: line **to** the previous point, leaving it put - a hub with spokes |
| 4 | 2 | set the mode byte `$7C` |
| 5 | 10 | VIEWER: x, y, z 16-bit, then pitch, bank, heading |
| 6 | 5 | 2-D LINE: x1, y1, x2, y2 |
| 7 | 2 | touch soft switch `$C0nn` |
| 8 | 2 | clear a hires page (0 = `$2000`, else `$4000`) |
| 9 | 2 | select the page to draw on |
| 10 | 3 | 2-D POINT |
| 11 | - | **JUMP**: the list pointer becomes the operand |
| 12 | 2 | **PLOTMODE**: `ORA` or `EOR` into the plot sites - only well defined with COLOUR 0 |
| 13 | 3 | **COMPILE**: write the 2-D result to an address instead of drawing it |
| 14 | 5 | VIEWPORT: x scale, y scale, x centre, y centre |
| 15 | 7 | six engine constants into `$6140`-`$6145` |
| 16 | 1 | the whole graphics-mode sequence in one byte |
| 17 | 1 | no-op |
| 18 | 2 | COLOUR - patches 26 sites in the plotting code |
| 19 | 13 | OBJECT |
| 20 | 2 | **VECTOR**: re-point the 2-D primitives at a second pair of routines |
| 21 | 7 | **2-D LINE** with x 16-bit at twice the scale |
| 22 | 4 | **ORIGIN** for 23 and 25: x 16-bit (halved), y a byte |
| 23 | 5 | **2-D LINE** relative to that origin |
| 24 | 4 | **2-D POINT** with x 16-bit at twice the scale |
| 25 | 3 | **2-D POINT** relative to that origin |
| 26 | 3 | **SKIP**: if operand 2 is zero, skip operand 1 further bytes |
| 27 | 2 | **WAIT**: a delay, about 200,000 cycles - 0.2 s - per unit |
| 28 | 3 | **CAPTURE TO**: where 29 appends points, six bytes each |
| 29 | 2 | **CAPTURE**: 0 off, non-zero appends every transformed point, 2 also stops drawing |
| 121 | 1 | END |

Three of those change what A2-3D2 is.

**It is a language with control flow.** Opcode 11 is a jump and opcode 26 is a conditional
skip - "if this byte is zero, skip the next N bytes". A program can poke that byte and
switch a whole block of the scene off without touching anything else. The game does not
use either, but they are there.

**It compiles.** Opcode 13 says "do not draw this, write it down", and what comes out is a
display list in the same language holding the 2-D result of the 3-D work. Measured: a
`COLOUR 7` and two 3-D points compiled to `$12 $07 | $0A $00 $22 | $0A $16 $22 | $79` -
colour, two 2-D points, terminator - with nothing drawn. So a scene can be projected once
and then redrawn cheaply, which matters a great deal to a port that wants a higher frame
rate honestly.

**It answers questions.** Opcodes 28 and 29 point the engine at a buffer and have it
append every transformed point, six bytes each, with mode 2 suppressing the drawing
entirely. Measured: with the viewer at the origin, `(11,22,33)` and `(-1,-2,-3)` came back
as exactly those numbers. That is how a game asks "where on screen is this object" without
drawing it.

The rest is a second, higher-resolution 2-D layer: opcode 20 re-points the primitives at
`$7710`/`$7E3C` instead of `$771F`/`$7748`, and opcodes 21 to 25 take x as a 16-bit value
at twice the scale, optionally relative to an origin set by opcode 22. Those draw both
bits of a cell, so they come out white.

Three things this cost before it worked, all of them the kind that make a measurement
quietly wrong rather than obviously broken:

- **The engine remembers.** Opcode 20's vectors, opcode 12's plot mode and opcode 29's
  capture mode all survive a call. An early run measured opcode 6 lighting 41 pixels where
  it lights 21, because an earlier experiment had re-vectored the plotter and never put it
  back. Every list now opens by setting all three.
- **Opcode 15 with zero operands wrecks the engine.** Its six bytes go into `$6140`-`$6145`
  and nothing resets them, so a sweep that runs every opcode with zero operands poisons
  the projection for everything after it. The prologue restores `SV DATA`'s own values.
- **Zero is not a neutral operand, and neither is zero padding.** A line from a point to
  itself, or a 3-D point at the viewer's own position, is a degenerate case the clipper
  does not return from - and padding after the instruction is itself executed, where zeros
  decode as opcode 0 at the origin. The padding is opcode 17 now. The line routines also
  do not survive being asked to draw in a colour that was never set.

### The projection, derived

`probe_projection.mjs`, 9 checks. `$6367` turns one view-space point into two screen
bytes. It is built from two routines whose arithmetic is not obvious from reading them, so
rather than decode them by eye each was **tabulated**: `exercise.mjs` can call a single
routine with the registers and zero page set, so the function is whatever the table says.

| routine | what it computes |
| --- | --- |
| `$65DE` DIV | `sign * floor(abs(n) * 16384 / abs(d)) * 2`, dividend in A:X, divisor in `$7A`/`$7B` |
| `$659D` SCALE | `(signed8(a) * m) >> 7`, truncating downwards |

The doubled fourteen-bit quotient is why `40/100` comes back as **13106** and not the
13107 that `0.4 * 32768` would give: the bottom bit is not computed, it is shifted in.

Composed, per axis:

```
h      = DIV(v, z) >> 8                  v/z in seven fractional bits, a signed byte
screen = ((h * scale) >> 7) + centre     both signed, both truncating downwards
```

**Exact on 308 of 308 coordinates** swept across seven depths, strictly inside the
frustum. `scale` and `centre` are bytes inside the projection code that `VIEWPORT`
patches: `scale = (operand >> 1) - 1` and `centre = the operand`, separately for x and y -
measured over four viewports.

Two edges worth having:

- **DIV is only defined for `|n| < |d|`**, because a quotient of 1 does not fit in fifteen
  fractional bits. That is exactly the frustum, which the outcode test enforces before
  anything is projected. Outside it the routine returns numbers that fit no formula, which
  the probe checks - the domain is real, not a convenience.
- **On the frustum edge itself**, `v = z`, the engine comes back **one short**: 68 where
  the formula says 69. A port copying the formula without that clamp will differ on points
  sitting exactly on the edge.

### What feeds it: the transform, derived

`probe_transform.mjs`, 12 checks. This had been recorded as "an anisotropic fixed-point
scaling that multiplies x and y by about 3.8 and z by about 2.3, at a ratio that is not
even constant" - true, and useless. It is:

```
d = p - viewer                  per axis, 16-bit
v = (M . d) << 3                M a 3x3 matrix; the shift applies to the sum
```

`M` is nine 16-bit Q15 entries in zero page, laid out **by output axis**:

| | x term | y term | z term |
| --- | --- | --- | --- |
| out x | `$7E` | `$84` | `$8A` |
| out y | `$80` | `$86` | `$8C` |
| out z | `$82` | `$88` | `$8E` |

`$6090` sets `$7E`, `$86` and `$8E` to `$7FFD` at startup, which is the identity - and is
why those three addresses looked like "three 16-bit values set to $7FFD" in the first
pass over the engine. `$666E` rebuilds the whole thing from pitch, bank and heading at
`$96`-`$98` whenever a VIEWER instruction runs; which entries move with which angle
confirms the layout, and the rows keep their length as the angles change, so it is a
rotation.

**The shift of three is what made the old description look strange.** The multiply returns
a Q15 product, so `M` alone scales a point *down* - at zero angles its diagonal is
(16123, 32765, 9539), which is (0.49, 1.00, 0.29). The `<< 3` multiplies by eight, giving
3.9, 8.0 and 2.3. That is the whole of the "anisotropic scaling": a per-axis constant
times eight.

**And the per-axis constants are opcode 15's operands** - the instruction whose six bytes
had been recorded as "six engine constants, into `$6140`-`$6145`" with no idea what they
were for. They are three 16-bit scales, one per axis, and each moves its own diagonal
entry and no other. `SV DATA` ships (16000, 32767, 9541). This is also why zeroing opcode
15 wrecks the projection, which probe_opcodes.mjs had to work around before knowing why.

Verified end to end: **from world coordinates, through the transform and the projection,
to the exact pixel**, on every unclipped case - which is the thing no earlier probe could
do.

Two pieces are deliberately not reduced to arithmetic, and a port has to reimplement them
from the listing rather than replace them:

- **`$6480`, the multiply.** A shift-add loop that truncates its partial sums, so it is
  *not* `(a * b) >> 15`: it agrees with that about 70% of the time and is one low
  otherwise. Close enough to look right, wrong often enough to drift. The probe uses the
  engine's own multiply to predict the engine's transform, and pins a golden table of 84
  products to check a reimplementation against.
- **`$666E`, the matrix builder.** ~~Rounding.~~ It is a **bug**, and it is now
  transliterated - see below.


### $666E has a bug, and it is load-bearing

`parity_view.mjs`. The matrix builder scales each row by one of opcode 15's three
constants, and for the **first entry of each row** it reads only the constant's high byte:

```
LDX $6141        ; the high byte
CPX #$7F         ; "is this row's scale 1.0, so we can skip it?"
BNE $675F        ; ...and this branch jumps PAST the LDA below
LDA $6140
CMP #$FF
BEQ skip
STA $78          ; <- A is stale when we arrived by the branch
```

So whenever a scale's high byte is not `$7F`, the multiplier becomes
`(high << 8) | whatever the accumulator happened to hold`, which is the low byte of the
previous multiply's result. The second and third entries of each row reload it properly.

At all angles zero the previous product is `mul(cosH, cosP)` = 32763, low byte `$FB`, so
the x scale is `$3EFB` = **16123** rather than the 16000 the scene asked for. That is
exactly what the engine's matrix holds, and it is why the x row appeared to "wander with
pitch": change the pitch, change the previous product, change the scale.

This is why the earlier pass could only call it "rounding, bounded but not modelled". It
is not rounding and it is not bounded by anything meaningful - it is a missing `LDA`. A
port that uses the constant is 0.8% out at the origin and differently out at every
attitude.

Two more things the transliteration needed, neither of them visible from the formula:

- **The operand order is not consistent.** `MULCORE` complements its first operand and
  adds its second, so it is not symmetric. Every scaling block puts the constant in `$78`
  except the x row's second and third entries (`$6772`, `$678B`), which put the value
  there instead. That difference is worth exactly one unit, and it showed up as
  `engine 11311, port 11312`.
- **Only the first entry of each row is affected by the stale accumulator**, because the
  other two reload the constant.

`parity_view.mjs` reproduces the matrix exactly over 96 attitudes and five settings of
opcode 15, including the settings where a row is skipped entirely.

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
exact clipper is what the original looks like**, and that is the baseline
fidelity has to be measured against before any smoothing is offered as an option.

### What is resident at `$6000`

Measured during flight: `A2-3D2`, byte-identical to the disk file apart from its own
patches. The character set and the music both BLOAD to `$6000` as well, but not while the
game is flying.

## The game is in the overlays

`probe_game.mjs`, 12 checks. This had been assumed to be an Applesoft game with a 3-D
library bolted on. It is not. The Applesoft chain reaches `SD PART2`, which is **287
bytes** long, and its one real line is

```
164 PRINT CHR$(4);"BRUN PART1.OBJ0" : PRINT CHR$(4);"BLOAD PART2,A$8BD8"
    : PRINT CHR$(4);"BRUN STAR DESTROYER.OBJ0"
```

`STAR DESTROYER.OBJ0` is **5,890 bytes of 6502**, and that is the flight game. Traversed
from its entry at `$08EF` - a `JMP $0957` - **95.7% of it is reachable code**, 2,086
instructions. The six overlays together are 20,995 bytes against 12,477 for all 21
Applesoft programs.

The Applesoft is not nothing: 12KB of it runs the title, the difficulty screen, the
starbase, the hyperdrive sequences, the high-score entry and the demo, and all of that has
to be ported. But the combat is a binary.

### How a BRUN overwrites the program that issued it

Open question 8 was how a BASIC program at `$0801` and an overlay at `$08EF` share that
space, since `$08EF` is only 238 bytes above `$0801` and every program is longer than
that. Measured in flight: **`SD PART2`'s text matches the disk for exactly its first 238
bytes** - up to `$08EF` and not one byte further. The overlay really does overwrite the
tail of the program that ran it.

It works because of how the program is laid out. The lines that still have to run after
the BRUN - 172, 175 and 180, which read the result bytes and decide what to chain next -
all sit below `$08EF` and survive. The subroutine at 200, which line 10 calls *before* the
BRUN, sits above it and is destroyed. Nothing needs it again.

So `$08EF` is not an arbitrary address: it is as low as the overlays can start while
leaving room for the part of each program that has to outlive them.

### How the game drives the renderer

This is what matters for the port, because the binary's entire effect on what appears is
the bytes it writes into the display list - and that list is already ported and verified
byte-for-byte. Every absolute reference the game makes into `$6000`-`$83FF`:

| address | times | what |
| --- | --- | --- |
| `$6000` | 3 | `CALL 24576`, render a frame |
| `$8110`, `$8112`, `$8114` | 3 each | the display page switch, and which page to clear and draw on |
| `$8116`, `$811A`, `$811E` | 2, 1, 7 | `XI`, `ZI`, `H1` - the VIEWER instruction's operands |
| `$81DD`, `$81F3`, `$8209` | 5, 4, 5 | the shield, warp and missile gauges |
| 135 more | | fields of object instructions: count, position, attitude and shape |

So the ship flies by poking two position axes and a heading into one `VIEWER` instruction;
the enemies move by poking `OBJECT` instructions directly; and the instrument panel moves
by poking the far end of three 2-D lines. There is no other channel.

**That makes the arbiter for the game logic a byte comparison too.** The port does not
have to match the original's internal state - it has to poke the same display list.

### The game loop, traced

`probe_gameloop.mjs`, 10 checks. The binary stepped instruction by instruction through
seven frames of real flight.

| | |
| --- | --- |
| one game frame | **397,000 cycles - 389 ms, 2.57 a second** |
| of which the renderer | about 316,000, so **80%** of the frame is drawing |
| the game's own code | **401 instructions** a frame |
| of the binary's 2,086 instructions | **624 ran**; 1,462 were never reached in seven frames |

The 2.57 frames a second is the game's real cadence, where the 3.23 in the renderer
section is the renderer alone with nothing thinking in front of it.

Every address the trace executed is one the static traverse also found, which is the same
cross-check the renderer pass used.

It executes in **17 separate regions**, the largest being `$0957`-`$0AE0`, `$0C04`-`$0DA2`,
`$0E05`-`$0EF6`, `$1014`-`$11AC` and `$120F`-`$1300`.

### What a frame pokes

27 of the display list's 491 bytes move between frames, and every one of them is
accounted for:

- `$8110`, `$8112`, `$8114` - every frame. The display page and the two page selects: the
  double buffering.
- object 1, 2, 13 and 14's **position and attitude** - the enemies moving and turning.
- the viewer's `XI`, `ZI` and `H1` when the ship is being flown.

Nothing else changes. The binary's entire effect on the screen is those bytes.

### The controls

**Paddle 0 steers.** A scan of the soft switches the binary touches found the keyboard and
button 0 and no paddle at all, which was misleading: the read goes through the monitor
ROM.

```
$09A3  LDX #$00        ; paddle 0
$09A5  JSR $FB1E       ; PREAD - the ROM's paddle read, returns Y
$09A8  CPY #$9B        ; 155 or more: heading += 3
$09BE  CPY #$64        ; under 100:   heading -= 3
```

So a **dead zone from 100 to 154** and **three units of heading a frame**. Measured by
driving the paddle in the machine and watching `$811E`: hard over turns +3 a frame one way
and -3 the other, and the centre does not move at all. The heading is written to the
`VIEWER` instruction and to object 12's attitude at `$8251` at the same time.

**The keyboard is a pause.** `$1929` reads `$C000`, and if a key is pending it clears the
strobe and spins at `$1935` until another arrives. Measured: with the paddle held hard
over, the heading advances 9; press a key and it advances 0; press another and it advances
9 again.

**Button 0** is read once a frame at `$0ADB`, in the main loop region.

### The explosions

`$1944` copies object 1's x and z into objects **8, 9, 10, 11 and 20, 21, 22, 23** - which
are the four explosion starbursts of each block, the ones `render_shapes.mjs` drew as
sixteen-point bursts at radius 21, 35, 63 and 84. The explosion is placed at the target it
belongs to, and the four sizes are the animation.

### Inside the frame loop

`listing/STAR_DESTROYER.asm` is the annotated disassembly, generated by
`gen_game_listing.mjs`. Because the display list is understood, every reference out of the
game into `$6000`-`$83FF` is named by the field it writes, so most interesting lines label
themselves: `$09AC` reads `LDX H1.heading`, not `LDX $811E`.

`$0957` is setup - it renders twice, to page 1 and then page 2, which is how both pages
get cleared. **`$09A3` is the top of the frame loop**, and it is where the pause at `$1941`
jumps back to.

**An enemy is one entity with two object instructions.** The scene draws the first block
of twelve through the main viewport and the second through the scope inset, so each enemy
has an instruction in each: `$1E98` switches `OBJ1` and `OBJ13` on in the same breath.
Measured - across seven traced frames, ten object fields moved, and every one moved in
object *i* and object *i+12* in exactly the same frames.

**The enemies are spawned from counters the BASIC sets.** `SD PART2` line 200 pokes 8185,
8186 and 8187 - `$1FF9`, `$1FFA`, `$1FFB` - each with `PEEK(8182) + RND(1)*4 + 1.5`, and
then BRUNs the binary. `$1E98`, `$1EC9` and `$1EFA` each take one of those counters, and
while it is non-zero decrement it and bring an enemy in. Line 172 reads the same three
bytes back afterwards and chains `MONOLITH` if any are left. So the difficulty's enemy
count, the spawner and the end-of-wave test are one mechanism spread across the two
languages.

**The ship's position is an index, not a coordinate.** `$0901` and `$0903` index a table at
`$9801` whose 16-bit entries become `XI` and `ZI`; the arithmetic on those indices is done
by routines in `MATH` (`$999B`, `$99D2`, `$9A65`, `$9C4B`, `$9C7A`). The same values go to
`OBJ12`, so whatever object 12 is moves with the ship.

The store at `$9800` is the binary's own, not Applesoft's: checked in flight, the running
program has **no arrays at all** - `ARYTAB` and `STREND` are both `$0927`. Its contents
include the seven stars' x offsets (-20, -50, -10, -40, 20, 50, 60), which are the same
numbers `SD RET` and `SD START2` declare as `T%(1..7)`; the binary carries its own copy
rather than reading the BASIC's.

**The ship's position is an index, not a coordinate.** `$0901` and `$0903` index the table at
`$9800`, whose top two bytes per entry become `XI` and `ZI`; the arithmetic on them is done by
`MATH`, which is answered below. The same values go to `OBJ12`, so whatever object 12 is moves
with the ship.

Still unknown, and needed before the rest of the loop can be ported: which code builds the
`$9800` table in the first place, and the rest of the game's state at `$0900`-`$0950`.

### `MATH` at `$98F3` - a 24-bit accumulator machine

`MATH` is 1,023 bytes and the renderer never touches it. The game drives it constantly: 229
call sites in `.OBJ0`, and 296 calls over sixty frames of warp. It is **not** a library of
functions. It is a little machine with its registers in zero page, and the frame loop issues
one instruction at a time:

```
$09DF  LDY $0915
$09E2  LDX $0917
$09E5  JSR $9A65     ; ACC := table[Y] * 256 / table[X]
$09E8  LDX $0901
$09EB  JSR $999B     ; ACC += table[X]
$09EE  LDY $0901
$09F1  JSR $9C7A     ; table[Y] := ACC
```

**The registers**, all 24-bit little-endian and signed:

| | | |
|---|---|---|
| `ACC` | `$FA`-`$FC` | the accumulator |
| `B` | `$EB`-`$ED` | the operand |
| `EXT` | `$FD`-`$FF` | the divide's remainder, the multiply's high half |
| `$CE` | | the sign flag the multiply and divide set and then act on |
| `$EE` | | where `$9C5C` parks `X` across its own use of it |

**The table** is byte-indexed from `$9800`: an index is a byte offset and a value is the three
bytes at it. Entries sit three apart by convention, so most indices are multiples of three,
but not all - a trace under warp shows `X` and `Y` at 66, 69, 75, 121, 124 and 167.

**The entry points:**

| | | sites |
|---|---|---|
| `$9998` | `ACC := table[Y] + table[X]` | 16 |
| `$999B` | `ACC += table[X]` - loads `B`, keeps `ACC` | 12 |
| `$99AB` | `ACC := table[Y] - table[X]` | 14 |
| `$99D2` | compare `table[Y]` against `table[X]`: `A` becomes +1, 0 or -1, signed | 55 |
| `$9A04` | `ACC := |ACC|` - a sign test falling into the negate | 11 |
| `$9A08` | `ACC := -ACC` | |
| `$9A17` | `ACC := table[Y] * table[X] / 256` | 8 |
| `$9A65` | `ACC := table[Y] * 256 / table[X]`, remainder in `EXT` | 24 |
| `$9AD0` | `ACC := sqrt(ACC * 256)`, by Newton | 4 |
| `$9C04` | `ACC := arctan(ACC)` in whole degrees, scaled by 256 | 3 |
| `$9C4B` | `table[Y] := table[X]`, three bytes | 62 |
| `$9C5C` | `ACC := table[Y]`; `X` preserved via `$EE` | |
| `$9C6C` | `B := table[X]` | |
| `$9C7A` | `table[Y] := ACC` | 62 |

**Entries and bodies.** Most entries are a couple of loads and then a body, and the bodies are
re-entered from elsewhere in the file without the loads: `$9AD0` drives `$999E` (add), `$99D8`
(compare) and `$9A6E` (divide) directly, over registers it has already arranged. `$9998` is
`$9C5C` falling into `$999B`, and `$9A04` is a two-instruction sign test falling into `$9A08`.
The port is split the same way, which is what lets the square root be a transliteration.

**The fixed point is consistent.** The divide multiplies its dividend by 256 and the multiply
divides its product by 256, so a stored 24-bit value is its quantity times 256 throughout -
the low byte a fraction, the top two bytes the whole number the renderer reads.

**`$9A17`** builds a 48-bit product across `$F9`-`$FE` and takes `ACC` from bytes 1 to 3 of it,
so the discarded low byte is left in `$F9` and bytes 4 and 5 land in `EXT`'s low two bytes.
`$FF` is not part of the shift chain, so `EXT`'s top byte survives a multiply.

**`$9AD0`** is Newton's method: `x := (n * 256 / x + x) / 2` from `x = n`, at most sixteen
rounds, stopping when `ACC` equals `B` rather than on a tolerance. It is **transliterated, not
modelled**, because its edges are the point. `trunc(sqrt(n * 256))` agrees on 209 of 210 inputs
and fails at `ACC = 1`, where the first halving reaches zero, already equals `B`, and the
routine returns **0** instead of 16. It never calls `$9B00` either, so a negative input is
simply worked on as a pattern: `ACC = -1` roots `$FFFFFF * 256` and gives 65535.

**`$9C04`** is an arctangent answering in whole degrees, input and output both scaled by 256 -
so `ACC = 256`, a ratio of 1.0, comes back as `45 * 256`. It is a series with a reflection
above 1.0, and it has its own rounding: a `trunc(atan)` model disagrees on 52 of 496 inputs,
sometimes high and sometimes low. It **is** monotonic, so the port describes it by the 90
inputs at which each degree begins and does a lookup - exact, including the four degrees it
never answers at all. **39, 40, 50 and 51 are skipped**: the series jumps 38 to 41 and 49 to
52, confirmed in the machine at each boundary. No closed form would have predicted that.

Only `ACC` is modelled for the arctangent. The real series leaves working values in `B`,
`EXT`, `R3` and `R7` that the lookup does not reproduce, which is allowed because nothing
reads them - all three call sites are the same four instructions, `$9A65`, `$9C04`, `$9A04`,
`$9C7A`, and the next `MATH` call after them reloads both registers. `probe_math.mjs` checks
that against the listing rather than taking it on trust.

**The registers are bit patterns, not values.** `$9B00` is meant to leave magnitudes, but it
negates in place and the negate wraps, so `$800000` - the most negative value there is - comes
out as itself and still negative. The bodies do unsigned arithmetic on three bytes and never
see a sign, and the port has to do the same or it diverges at exactly that input. `$9A04` has
the same hole: it is an absolute value everywhere except `$800000`, which it returns unchanged.

`$9C86` onward is a register file - eight four-instruction routines shuffling 24-bit values
between `ACC` (`$FA`-`$FC`), `B` (`$EB`-`$ED`), `R3` (`$03`-`$05`) and `R7` (`$07`-`$09`).

**The divide is the interesting one.** It is a restoring division: `$9B00` reduces both
operands to magnitudes and records the combined sign in `$CE`, the dividend is shifted up one
byte - which is where the `* 256` comes from, and makes the quotient 8.16 fixed point, so
`$000100` is 1.0 - then 24 rounds of shift-and-trial-subtract accumulate the quotient in `ACC`
and leave the remainder in `EXT`, and `$9A08` negates `ACC` at the end if the signs differed.
Three consequences, all measured and all kept in the port:

- **The remainder has no sign.** The negate only touches `ACC`, so `-1000/3` and `1000/3` both
  leave a remainder of 1.
- **`B` comes back as a magnitude**, because `$9B00` works in place. A later instruction that
  reads `B` sees `|B|`.
- **Neither edge is guarded, and both edges saturate.** A zero divisor makes every trial
  subtraction succeed, so `ACC` fills with ones - `$FFFFFF`, or `+1` after the sign fix-up when
  the numerator was negative. **A quotient too wide for 24 bits does the same thing.** The
  domain condition is on the **quotient**: `65535*256/1` is fine at `$FFFF00` and
  `65536*256/256` is fine, but `65536*256/1` is not, and what it gives back is `$FFFFFF`, not
  the low 24 bits of the answer. Measured over 300 divides: 23 overflowing cases, 23
  saturating, 0 wrapping.

  This was read as a wrap for two commits, and the reason it survived is worth recording. The
  port wrapped, `parity_gamemath.mjs` *skipped* every out-of-domain case rather than asking
  what it did, and `probe_math.mjs` asserted only that the answer was "not the quotient" -
  three places agreeing to leave the question alone. What forced it was porting the bearing,
  where the case is reachable: a target on an axis gives a nudged delta of 1, and
  `409601*256` is far past 24 bits. `EXT` in the overflow case is a rotation of the shifted
  dividend, and that **is** left unmodelled, because no call site reads it.

**The index exits are not part of the contract.** The routines do advance `X` and `Y` -
`$9C5C` adds three to `Y`, `$9C6C` leaves `X` at zero, `$99D2` exits its compare loop with
both holding whatever the data led to - and the port models none of it, because nothing reads
it. All 229 call sites load every index they use immediately before the call; `probe_math.mjs`
checks that against the listing.

**`$0948` is the warp gate.** The whole movement block at `$09DC`-`$0A06` is skipped when
`$0948` is zero, and with the paddle at rest it is: over sixty frames of ordinary flight
`MATH` is **never entered at all**. What opens it is at `$0A8D` - paddle 1 read through
`PREAD`, engaged when the reading is below `$5A`, provided `WARP` (`$81F3`, an object field)
has not reached `$C7`. While engaged `$0948` is `$FF` and `$0956` counts frames, burning one
unit of `WARP` every `$37` - 55 - of them.

#### How this was nearly got wrong

The first pass treated `MATH` the way `$6480` and `$65DE` in the engine were treated: call
each entry point over a sweep of inputs and read the behaviour off the results. That works for
a pure function and it is how most of this document was built. Here it produced two confident,
repeatable, **wrong** answers - `$999B` as "return the entry's high byte" and `$9C7A` as "zero
the entry" - each passing a sweep of eighteen values with a readback confirming the writes had
landed.

Both are artifacts of the same thing. The harness varied the table and never varied the
registers, and `ACC` happened to be zero in the machine state it restored, so `ACC + entry`
read as `entry` and `store ACC` read as `store 0`. **A sweep over inputs cannot see a register
it never varies**, however many inputs it uses, and the repeatability that made the answers
look solid was the harness being consistently wrong rather than the routine being simple.

What settled it was reading the code. `probe_math.mjs` now varies `ACC` and `B` as well as the
table, and carries a check that no pure function can pass - calling `$999B` once, twice and
three times over must give 1000, 2000, 3000 - plus a regression check for each of the two old
readings. `parity_gamemath.mjs` goes further and compares whole random *programs*, because a
routine can be individually right and wrong in combination.

A smaller version of the same mistake, caught by a check rather than by rereading: `$EE` held
3 after every call made with `X` = 3, which looked like the entry size. It is the index the
caller passed.

### Flying: the heading, the throttle and the edge of the world

`MATH` is the arithmetic; this is what the frame loop asks it for. The movement block runs
between `$09D1` and `$0A60` and does three things.

**It builds a step from the heading.** `$1AE8` takes the heading out of the display list,
indexes two tables in `HEADING DATA`, and writes each component into a `MATH` entry:

```
$1AE8  LDY $0949            the heading, saved from H1.heading at $09D4
$1AEB  LDA $89CB,Y          the X component
$1AEE  LDY $0915
$1AF1  STA $9801,Y          into the MIDDLE byte of the entry
$1AF4  CMP #$7F / BCC / BEQ
$1AFA  LDA #$FF             sign-extend into the high byte
$1B06  STA $9800,Y          low byte zero
       ... the same for $8ACF into $0916 ...
```

So an entry is the component times 256 - a whole number of coordinate units with no fraction.

`$89CB` and `$8ACF` are a sine and a cosine of amplitude 100 over a 256-step circle, 260 bytes
apart inside a 520-byte file. **No closed form reproduces them.** A sweep of 102 candidates -
amplitudes 96 to 104 in halves, each with round, trunc and floor, with and without a half-step
phase - leaves `trunc(100*sin)` closest at a mean error of 0.17 and a worst of 3, and nothing
exact. The quarter turn reads 99 where every amplitude-100 model gives 100, so whatever
generated them, probably Applesoft's own `SIN`, is not worth guessing at. The port embeds the
512 bytes, for the same reason `gen_tables.mjs` embeds the engine's plotting tables.

Worth noting that the sign test at `$1AF4` separates `$7F` from `$80` by hand, with two
branches rather than a `BMI` - and that **no table entry can reach either**, because the
components run -100 to 99. The branch is unreachable in play. The port keeps it anyway.

**It divides, adds and stores.** Three `MATH` instructions an axis, with the accumulator
carrying the value between them:

```
$09DF  LDY $0915 / LDX $0917 / JSR $9A65     ACC := step * 256 / throttle
$09E8  LDX $0901 / JSR $999B                 ACC += position
$09EE  LDY $0901 / JSR $9C7A                 position := ACC
```

**The throttle is a divisor.** `$0917` names an entry holding 1280, so the largest step is
`100 * 256 * 256 / 1280` = 5120, which is 20 coordinate units a pass. A larger value there
means a slower ship.

**Position is 24-bit and the coordinate is its top two bytes.** `$0A66` publishes `$9801,Y`
and `$9802,Y` into `XI` (`$8116`) and object 12, and `$0A7B` does the same for Z into `ZI`
(`$811A`). The lowest byte of a position is a fraction the renderer never sees, which is what
lets the ship travel at a fraction of a unit a pass and still hand over whole numbers.

**The world wraps.** Four compare-and-copy pairs at `$0A09`, each jumping past the rest on
success, so at most one wrap happens per pass. X wraps symmetrically at +/-786432, which is
+/-3072 units. **Z does not**: `+409600` and `-344064`, or `+1600` and `-1344`. The asymmetry
is in the data, and the port keeps it.

The wrap test comes *after* the step, which matters to anything trying to provoke one: a
position placed within one pass's travel of a bound can be pulled back inside before the
compare and never wrap at all.

#### The variable directory at `$08F2`

`$08F2` onward in `.OBJ0` is a list of 65 byte offsets into `MATH`'s table, one per 24-bit
variable, running 0 to 221. The frame loop reads them with `LDX`/`LDY`, so `LDX $0901` means
"the index of the ship's X", not a value. Nothing ever writes them - they are constants of the
build, sitting immediately after the `JMP $0957` that starts the file.

Mostly three apart, but the stride breaks three times: 87 to 106, 124 to 128, 170 to 185.
**Thirty-five of the offsets are not multiples of three**, which is why the table has to be
modelled as bytes rather than as an array of entries. The throttle at offset 128 is one of
them.

#### The warp gate

`$0948` gates the whole movement block, and `$0A8D` is what sets it:

```
$0A8D  LDX #$01 / JSR PREAD    paddle 1
$0A92  CPY #$5A / BCS          at or above $5A: closed
$0A96  LDX WARP / CPX #$C7     $81F3 exhausted: closed
$0A9D  LDX #$FF / STX $0948    otherwise open
$0AA2  INC $0956               and count
$0AA8  CPX #$37 / ... DEC WARP every 55 passes, spend a unit
```

With the paddle at rest the gate is zero, the block is skipped and the ship stops dead.
`$09D7` reads the gate *before* `$0A8D` sets it, so throttling on takes a pass to bite.

**The gate does not gate `MATH`.** This file said for a while that with the paddle at rest
`MATH` was never entered at all, which was wrong, and wrong because of the loading hazard
below: the blocks that drive `MATH` irrespective of the gate live above `$17EB`, and the
measurement was taken while that part of the binary had not arrived. With the whole binary
resident and the gate shut, `$9A65` alone is still called from eight sites every pass -
`$0C78`, `$0D27`, `$0E4C`, `$0E61`, `$1088`, `$1137`, `$1256`, `$126B` - which are the range
and bearing blocks. Opening the gate adds exactly two, `$09E5` and `$09FA`, the movement
block's own. `probe_math.mjs` tells them apart by the return address on the stack, because the
operands do not: several blocks divide by the same entries.

#### The loop's period

One pass is about **126,600 instructions**, measured over seven intervals. The game renders the
main view and then the scope inset through A2-3D2 each time, so it runs at roughly 3Hz, not at
a video frame rate. Any harness that traces the loop has to be sized in passes: the first
version of `parity_flight.mjs` budgeted 17,030 cycles a frame, the right number for a video
frame, and a ninety-frame trace came back holding one sample.

### Range and bearing: the two idioms the loop asks a geometric question with

`probe_geometry.mjs` (28 checks) and `parity_geometry.mjs` (10). Seven of the nine places the
game works out where something is are one of two blocks of `MATH` instructions, repeated with
different indices out of the directory at `$08F2` - which is most of why the five big loop
regions look as repetitive as they do.

**The range appears four times.** Three inline, one per enemy class, each gated on an object
count: `$0C0F` on `OBJ1.count`, `$101F` on `OBJ2.count`, `$1429` on `OBJ3.count`. The fourth,
`$1C3D`, is the same seventy-five bytes with an `RTS` after them, called from nine places that
first copy four coordinates into `$092B`-`$092E`. The 54 bytes after the four index loads are
**byte-identical in all four**, and the loads are the only thing a copy varies.

```
$1C3D  LDY $092B / LDX $092D / JSR $99AB / LDY $0908 / JSR $9C7A    dx
$1C4C  LDY $092C / LDX $092E / JSR $99AB / LDY $0909 / JSR $9C7A    dz
$1C5B  LDY $0908 / LDX $0920 / JSR $9A17 / JSR $9A04 / ... $090C    |dx| * 2
$1C6D  LDY $0909 / LDX $0920 / JSR $9A17 / JSR $9A04               |dz| * 2
$1C79  LDX $090C / JSR $999B / JSR $9AD0 / LDY $090A / JSR $9C7A    + and root
```

**It is not a distance.** The entry `$0920` points at holds **512**, which is 2.0 in the fixed
point, so the two multiplies *double* each delta rather than squaring it - there is no second
operand anywhere that would make it a square. What comes out is

```
range = sqrt(2 * (|dx| + |dz|))
```

in world units: the root of twice the L1 norm. Opposite corners of the world are 135 units
apart on this scale where the Euclidean distance is 6,813, and the thresholds it is compared
against (`$0926`, `$092F`, `$0932`) are sized for it - the one at `$092F` is 11 units, which
is an L1 separation of about 60. `probe_geometry.mjs` carries a control that fails if anyone
replaces it with a hypotenuse. The sum cannot overflow 24 bits, because the world is not wide
enough: the widest possible is 4,653,056 against `$800000`.

**The bearing appears three times**, always straight after an inline range, reading the deltas
it left in `$0908` and `$0909`. The three copies are byte-identical across all 257 bytes once
their jump targets move with them. It is a four-quadrant arctangent in whole degrees, then
rescaled into the 256-unit heading the display list uses, and four things about it are
measured oddities the port keeps:

- **It increments the low byte of each delta first**, with no carry (`$0C5A`-`$0C71`). That is
  what stops a delta of zero dividing by zero - a target on the axis gives 0, which becomes 1
  - but when a delta's low byte is already `$FF` the increment wraps it to zero and causes the
  divide by zero it was put there to prevent. A delta of 255 is that case, and the bearing
  comes out 0. With deltas under a whole unit the increment changes the answer 90 times in 100.
- **The two positive-`dx` quadrants are resolved against 271 degrees**, not 270: `$0922`
  points at an entry holding `271 * 256`.
- **Degrees become heading units by dividing by 359**, not 360, so a full turn is
  `256*256/359` = 182.55 units rather than 182.04. The two errors partly cancel.
- **The fold runs to 361 degrees**, which is 257 heading units - more than a byte. The caller
  at `$0D63` reads the answer as the *middle* byte of the entry, so 257 wraps to 1 and the
  circle closes.

The fold's shape is worth transliterating rather than tidying. Four blocks of two signed
compares, and the second one does **not** jump away afterwards: it falls into the third, whose
tests then run and cannot fire. `$99D2` loads `ACC` and `B` before comparing, so those
discarded compares still move the registers, and a port that collapsed the four blocks into an
else-if chain diverges at `$0D21` on 72 of 132 separations.

```
$0C87  dx < 0, dz < 0  ->  bearing := 90 - bearing   ; JMP $0D21
$0CAF  dx < 0, dz > 0  ->  bearing := bearing + 90   ; falls through
$0CD4  dx > 0, dz > 0  ->  bearing := 271 - bearing  ; JMP $0D21
$0CFC  dx > 0, dz < 0  ->  bearing := bearing + 271
$0D21  bearing := bearing * 256 / 359
```

**And each copy ends with forty bytes that are jumped over.** `$0D33`, `$1143` and `$154D`
hold the same two compare-and-copy pairs: clamp the bearing above at the entry `$0923` points
at, and below at zero. `$0923` holds `256 * 256` - exactly 256 heading units, one short of the
257 the live path actually produces. The clamp that would have caught the overshoot is in the
binary, disabled.

### The dispatch: what an enemy does with a bearing

`probe_dispatch.mjs` (21 checks) and `parity_dispatch.mjs` (12). The block that follows each
inline range-and-bearing - `$0D5B`, `$116B`, `$1575`, one per enemy class - turns the enemy
toward the bearing and fires a missile when it lines up. Unlike the range and bearing above,
**these three are not copies**: they are the same shape with four real differences, and every
one is a detail a port written from one copy would get wrong in the other two.

What they share. Dropping two redundant stores that only class 1 has, all three run the **same
58 opcodes in the same order**, bar one - the typo below.

```
$0D5B  LDX $0938 / BEQ                    the cooldown: while it runs, do not look
$0D63  LDY $090B / LDA OBJ1.heading
       CMP $9801,Y / BEQ                   aligned -> fire
$0D6E  INC OBJ1.heading / CMP / BEQ        aligned now -> fire
$0D79  BCS                                 past it -> three decrements
$0D7B  DEC / $0D7E INC INC                 short of it -> back one, then up two
$0D90  DEC DEC DEC                         (the decrement path)
$0DA5  LDX OBJ4.count / BEQ                one missile at a time
$0DAD  launch
```

**The turn is a probe, not a comparison.** It increments the heading, *writes it*, and compares
again, so an enemy that lines up on the second test fires from the incremented heading and
keeps it - measured on 21 of 336 cases. Only if neither test hits does it pick a direction, and
then from the already-incremented value: `BCS` runs three decrements, two below where it
started, and the other path decrements once to undo the probe and then adds two. The compare is
unsigned, which shows at the wrap: a heading of 200 against a bearing of 10 turns **down**.

The scope twin is written by the two turn paths and **not** by the launch, so a missile firing
leaves object 13, 14 or 15 holding the heading from the previous pass.

**The cooldown branch is a label, not a signed turn.** `$0D5B`'s `BEQ` falls into the increment
path and the other two copies jump to the decrement path - and neither entry has had the
probing increment applied. So the same code gives **+2 for class 1 and -3 for classes 2 and
3**, where the probe's own paths give +2 and -2. A cooling class 1 at heading 50 comes out at
52; a cooling class 2 at 47. Transliterating the labels is the only way to get both.

The four instructions that run the cooldown back down are `$0E23`, `$122D` and `$1637`, in the
region below - after the collision test and before the enemy's own movement.

**The other three differences:**

- **Class 3's cooldown is 15 frames**, classes 1 and 2 are 20.
- **Classes 2 and 3 share one missile**, object 5 and its twin 17, along with its position and
  step entries. Either firing blocks the other, and a blocked launch changes **nothing at all**
  - not even the heading. Class 1 has object 4 to itself.
- **Class 3's launch-sound flag gets the heading instead of 1.** `$15C9` is `LDX #$01` followed
  by `STA $0945` where the other two copies have `STX`, so the `LDX` is dead and the flag takes
  the accumulator - which, arriving by `BEQ` from the compare, is the enemy's heading. The three
  flags are read at `$186E`, `$187B` and `$1888`, each tested for non-zero, played through
  `$1F8E` and cleared, so the typo is invisible **except at heading 0, where class 3 launches
  silently**.

**The launch** copies the enemy's position into the missile's entries, saves the heading into
`$0949`, calls `$1AE8` to turn it into step components, divides each by the missile's own speed
entry and parks the missile ten units below the plane. That entry holds **383** against the
ship's 1280, and both are divisors, so a missile covers 3.34 times the ground per pass.

One interaction worth recording: `$1AE8` always writes the entries named by `$0915` and `$0916`,
which are the *ship's* step operands. A launch therefore overwrites them, and that is harmless
only because the movement block rebuilds them before every use.

### The enemies move, their missiles fly, and the loop asks twice whether anything arrived

`probe_entities.mjs` (18 checks) and `parity_entities.mjs` (11). Four blocks per enemy class,
twelve in all, and with the dispatch above them they are the whole of the three big enemy
regions bar the explosion routines and the player's own shots.

```
$0E05  reach      range <= 11 units: the enemy has rammed the ship
$0E2F  hold       range <  25 units: the enemy stops moving and holds station
$0E3D  move       step along its heading, wrap at the world's edge, publish
$0F83  missile    step by the stored step, publish, range to the ship, hit test
```

with the copies at `$120F`/`$1239`/`$1247`/`$138D` for class 2 and
`$1619`/`$1643`/`$1652`/`$1798` for class 3.

**The enemy's movement is the ship's movement.** `$0E3D` is `$09D1` without the warp gate, and
that is a byte-level claim, not a resemblance: the fifteen opcodes from `$09DC` and from `$0E43`
are the same, and so are the four compare-and-copy pairs that wrap them - identical in all four
places once a stray `CLC` the ship's copy carries at `$0A14` is set aside. All four wrap against
the same four bound entries, `$08F2`-`$08F5`. That is why the port shares one `wrapPosition`
rather than writing it out four times.

**So an enemy always flies at warp speed.** All eight divides - the ship's two and the three
enemies' six - name the same throttle entry, `$0917`, holding 1280. The ship only moves that
fast with warp engaged, so an unwarped ship is being closed on and a warped one is matched.

**The missile does not wrap and does not call `$1AE8`.** Its step was computed once at launch
and stored, so a pass is two adds, a publish and a range. A port that gave it the world wrap
would look right until a missile left the world.

**The missile's hit test overwrites the range.** It copies its own position and the ship's into
`$1C3D`'s four argument slots and calls it, leaving a new range in `$090A` on top of the one the
dispatch region worked out. Nothing reads the old one by then, but the order is not
interchangeable.

**The three thresholds are not the same comparison.** `reach` loads the threshold as `Y` and the
range as `X`, so `BPL` makes it fire on `range <= threshold`; `hold` and the missile's test load
them the other way round and fire on `range < threshold`. It shows only at exact equality, and
it is exactly what the two controls in `parity_entities.mjs` get wrong. In units, with the range
being `sqrt(2 * (|dx| + |dz|))`:

| | entry | range | L1 separation |
|---|---|---|---|
| ram the ship | `$092F` | 11 | about 60 |
| stop moving | `$0926` | 25 | about 313 |
| missile hits | `$0932` | 13 | about 85 |

**What the arrivals leave for someone else.** `reach` sets `$0942` and the missile sets
`$0941`; `$18BC` and `$18C9` read them and call the damage routines at `$1C99` and `$1CFC`.
`reach` also calls an explosion routine - `$1E98`, `$1EC9` or `$1EFA` - which is not ported, so
the harness stops at the `JSR`.

Neither movement block touches an object's **Y**, so an enemy's altitude is whatever its spawn
set.

### Killing an enemy: the shot, the debris and the respawn

`probe_kill.mjs` (15 checks) and `parity_kill.mjs` (12). Six blocks and nine subroutines,
perfectly regular - two player shots against three enemy classes - and three parts of the
chain that are not what they look like.

```
$0EF3  LDX OBJ6.count / BEQ          is this shot up?
$0EF8  copy the shot and the enemy into $092B-$092E / JSR $1C3D
$0F1F  LDY $090A / LDX $092F / JSR $99D2 / BPL    range <= 11 units: a hit
$0F2A  STA $093E                      the debris counter, 4
$0F2F  JSR $1944                      put the debris where the enemy is
$0F32  JSR $1F67                      switch the shot off
$0F35  JSR $1A8B                      aim the debris along the shot's heading
$0F38  JSR $1AAC                      switch the enemy off
```

All six run the same 25 opcodes in the same order; each names the debris placer for its
**class** (`$1944`, `$19B1`, `$1A1E`) and the aim for its **shot** (`$1A8B`, `$1AC7`). The
threshold is `$092F` - the same entry an enemy rams the ship at, 11 units of range.

Switching a shot off takes two routines: `$1F67` zeroes the main record's count and `$1A8B`'s
own tail zeroes the scope twin's. Nothing says why they are split.

**The debris is four objects and only three are ever drawn.** `$1944` copies the dead enemy's
published X and Z into objects 8, 9, 10, 11 and the twins 20, 21, 22, 23, and `$1A8B` copies
the shot's heading into all eight. But the only code in the binary that writes a debris
object's count is `$1D09`, and it writes six addresses: 8/20, 9/21 and 10/22. **Nothing
anywhere switches objects 11 and 23 on.** Their position and heading are maintained on every
kill and they are never seen.

**The debris is an animation driven down by a counter**, one piece a pass. `$1829`, `$1837`
and `$1844` tick each class's counter and call `$1D09` with the value: 4 switches on the first
pair, 3 the second, 2 the third, and **1 respawns the enemy**. Each piece gets a count of 1, so
the renderer draws it once and switches it off - a three-pass puff. The three tests are
`CPX`/`BEQ` on **equality**, so a counter above 4 would match none of them and fall through to
the respawn; nothing in play is above 4, and the port reproduces the test as written because
the first version that read it as `>= 4` was caught by parity.

#### The respawn has an `ADC` with no `CLC`

`$1E98`, `$1EC9` and `$1EFA`, one per class:

```
LDX wave / BEQ            nothing left in this wave
DEC wave
OBJ.count := $FF, twin too
LDA #bump / ADC $9802,Y   the enemy's X high byte, plus the bump, plus the CALLER'S CARRY
store to the entry and to both records
LDA #$96                  and a fixed Z high byte
```

The bump is 10 for class 1 and 20 for classes 2 and 3, and there is no `CLC` before the `ADC`,
so what it actually adds is 10 or 11 and 20 or 21. Measured, **both callers arrive with the
carry set**: the debris tick comes through `$1D09`'s `CPY #$01`/`#$02`/`#$03` equality, which
sets it, and the reach block comes through `JSR $99D2`, and MATH's compare leaves it set. So in
play the bump is always one more than the immediate operand says. The port takes the carry as
an argument rather than hard-coding 11, so the control can tell the two apart - and it fails on
6 of 6.

The Z it writes, `$96`, is the high byte only, which makes the coordinate 38,400 or so - far
outside the `maxZ` of 1,600 the movement block wraps against. A fresh enemy therefore snaps to
the Z edge on its first pass and flies in from there. It is also where class 1's enemies start,
so this is the game putting them back.

**Class 2's respawn cascades into class 3's.** `$1ECC` is `BEQ $1EFA`, and `$1EFA` is class 3's
routine - so with class 2's wave counter empty it does not return, it spawns a class 3 enemy
and decrements that wave instead. Classes 1 and 3 branch to a local `CLC`/`RTS`. Measured
directly: with `$1FFA` at 0 and `$1FFB` at 5, object 3 comes on and `$1FFB` goes to 4.

### Taking damage: the shield absorbs, then the systems pay

`probe_damage.mjs` (16 checks) and `parity_damage.mjs` (15). Three instrument-panel bars -
`SHLD` at `$81DD`, `WARP` at `$81F3` and `MSL` at `$8209` - are single bytes in the display
list, and they are **coordinates**, the bar's end. In flight all three read 244 and
**`$C7` (199) is empty**, so each has 45 units of travel. `Flight.throttle` already knew that
value, because warp will not engage at it.

There is one primitive. `$1C89` shrinks a bar by up to four:

```
$1C89  LDY #$01
$1C8B  DEX / CPX #$C7 / BEQ      bottomed out
       CPY #$04 / BEQ            did four
       INY / JMP $1C8B
```

The bar goes in and out in `X`, and `Y` says how far it got. Four steps always leave `Y` at 4,
because the `CPX` is tested first; an early exit leaves 1, 2 or 3. **The floor only works from
above** - a bar already at `$C7` steps straight past it and keeps going, measured: `$C7` comes
back as 195. Nothing in the game ever raises a bar, so it cannot happen in play.

It is called from six places: four on the shield and one each on the missile and warp bars.

```
$1C99  a ram:      SHLD -= 4, -= 4, store, -= 4, -= 4, store, sound $1E03
$1CFC  a missile:  SHLD >= $C8 ? ( -= 4, -= 4, store, sound ) : the systems
$1CCD  the systems: MSL -= 4, WARP -= 4, and $0933 += 1
```

**A ram costs sixteen and a missile costs eight**, and the moment the shield bottoms out
control falls to `$1CCD` and the rest of the shield damage is abandoned. The two never both
happen: either the shield took it or the systems did.

**The store comes after the second shrink, not after each**, which is visible at the edge: a
ram that empties the shield on its *first* four leaves the bar **unchanged** and goes straight
to the systems. Measured at a shield of 202 - it stays 202.

`$1CFC` jumps into the middle of `$1C99` at `$1CB1`, so the last eight of a ram and the whole
of a missile hit are the same code.

**`$0933` is the hit count and four is fatal.** `$1CEE` is `CPX #$04 / BCC`, so the fourth time
the systems take damage the routine jumps to `$1F2B` and does not come back. That is the
nearest thing the binary has to a lives counter. An empty system bar is skipped rather than
wrapped, which is what the `CPX #$C7` guards at `$1CD0` and `$1CDD` are for.

One redundancy, recorded because it was nearly mistaken for something the port had to get
right: `$1CFC` tests `CPX #$C8` where `CPX #$C7` would have read more naturally, and the two
**cannot be told apart**. The only value they disagree on is `$C7`, and `$1CB1`'s own first
test sends that to the systems either way - checked over 405 shield states, 405 agreements.

The flags are read at `$18BC` and `$18C9`, each tested for non-zero, acted on and cleared, the
ram first. A pass in which both arrive therefore costs 24 and can tick the hit count twice. The
three launch-sound flags just above them, at `$186E`, `$187B` and `$1888`, have the same shape
and no damage - and class 3's holds its enemy's heading rather than 1, which makes no
difference to a test for non-zero.

Every sound this chain asks for - `$1E03` when the shield holds, `$1E21` and `$1E40` when it
does not, `$1F2B` when the ship is destroyed, `$1F8E` for an enemy launch - is Phase 6. The
port returns the address it would have called, so the chain is complete and the gap is named.

**Except that `$1F2B` is not a sound routine, and reading it as one cost the port its death.**
It is three things in a row:

```
$1F2B  JSR $1FA9        display teardown: STX $C054, STX $C056 - page 1, hi-res off
$1F2E  ...              two bursts through $1D52
$1F62  LDX #$4D
$1F64  STX $00          <- this
$1F66  RTS
```

That last write is the whole of the ship's death. `$18D6` is `LDX $00 / CPX #$4D / BNE $18DD`,
so `$00` is the only thing that tells the loop to stop, and `SD PART2` line 172 reads the same
byte to route to `MONOLITH`. Because the port treated `$1F2B` as nothing but a sound it never
made the write: `$0933` was seen climbing to **6** in a live flight against a fatal four, and
the ship simply could not be destroyed. `MONOLITH` was unreachable with it.

**Two things had to be wrong at once for this to survive the harnesses**, and both are worth
naming because the shape repeats:

1. `parity_damage.mjs` compared the display list and `$0900`-`$095F` and **not zero page**, so
   the one byte that changes was the one byte nobody looked at.
2. Every case it swept seeded `$0933` at 0, so **no case ever reached the fourth hit** - the
   fatal branch was never taken on either side.

Both are fixed: `$0000`-`$0001` is in the compared range, the sweep runs the hit count at 0, 2
and 3, and a control - a systems block that treats `$1F2B` as only a sound - now fails in 3 of
3 cases. `probe_damage.mjs` holds the machine's side directly (the fourth hit writes `$4D`, the
third leaves `$00` alone), and `parity_loop.mjs` holds the exit at `$18D6`, which had no check
of any kind before. The display teardown at `$1FA9` is still not ported; the shell puts the
display back its own way, and that is named in `damage.js` rather than dropped.

#### The score, and why two blocks' order decides it

`$1895`, `$18A2` and `$18AF` are `LDX counter / CPX #$03 / BCC past it / JSR $1DD3 / INC score`,
one per class, incrementing `$1FFC`, `$1FFD` and `$1FFE`. They fire while the debris counter is
3 or more, which is 4 and 3 - two passes, so two increments.

Except it is one. Traced over a pass, the loop visits `$1829` **before** `$1895`, so the tick
has already decremented when the award looks: the counter is 3 on the pass after the kill and 2
the pass after that, and the score goes up exactly once. `$1895` sits *below* `$1829` in memory
and the loop does not run in address order, so this was traced rather than read.

#### The object count is a lifetime the renderer runs, and `$FF` means forever

This answers an open question and corrects what this file said about it. The 13-byte record's
first operand was recorded as "a frame counter" whose "decrement is read off the handler and was
never seen to happen". It happens.

Measured: a count of 20 put on an object comes down by one at a time, every step of it from
**`$6D18`, inside A2-3D2**. Nothing in `.OBJ0` ever increments or decrements a count - the
twenty-one `INC`/`DEC` sites that touch an object record are all the dispatch turning a heading.
So the 20 the dispatch writes into a missile is twenty **renders**, and expiry is the renderer's
business, not the loop's.

**But `$FF` is not a lifetime.** The five objects that are drawn every pass in flight - 1, 2, 12,
13 and 14 - sit at 255 and stay there over six passes, undecremented. So one byte is both a
switch and a timer: zero is off, `$FF` is on indefinitely, anything else counts down and
switches itself off.

Measuring this took three attempts and each failure is worth recording, because all three were
the harness interfering with what it was watching. Forcing a count onto an enemy woke the spawn
code, which stored over it. Using a missile instead meant the missile *flew*, reached the ship
and zeroed its own count through the very block being ported. Only a missile parked a long way
out with a zero step is watched by nothing but the renderer.

### The binary loads late, and a probe can measure the fill

Found while writing `probe_geometry.mjs`, and it invalidated a finding already in this file.

`SD PART2` does `BRUN STAR DESTROYER.OBJ0`, 5,890 bytes over `$08EF`-`$1FF0`. `toFlight` used
to hand back the machine after a fixed settle, and measured, that settle could end with the
**last 2,023 bytes of the binary - everything from `$17EB` up - still holding the power-on
fill.** The subroutines at `$1AE8`, `$1C3D`, `$1D09` and `$1F67` are all in that window. The
write that finally puts the code there comes from `$B8D6`, which is DOS's own RWTS.

So `toFlight` now waits for the condition instead of for the clock: it compares live memory
against the file until they match, and **throws** if they never do. The only addresses that
ever differ once it is loaded are `$0933`-`$0956` and `$1D4A`-`$1D51`, the binary's own
variables kept inside its code image.

What this cost: the claim that the warp gate stops `MATH` being entered, corrected above. What
it is worth guarding against is a probe that reads `$FF FF 00 00` out of a page of code and
reports a number for it.

### The player's weapon: two shots, and only one of them costs anything

`probe_weapon.mjs` (12 checks) and `parity_weapon.mjs` (10). Four blocks, in the stretch
between the throttle and the first enemy region:

```
$0ADB  LDA BUTTON0 / BMI            not pressed: nothing to do
$0AE3  LDX MSL / CPX #$C7           none left: play $1FB2 and stop
$0AF0  the two slots, and which one gets to fire
$0B6A  slot 1 moves      $0BB7  slot 2 moves
$1B2B  slot 1's publish  $1B60  slot 2's
```

**Firing a slot depends on the state of the other one.** A slot may go only if it is empty
**and the other slot's count is below 11**. The counts start at 20 and the renderer takes one
off per draw, so that is a rate limit expressed through the other barrel: hold the button and
the two alternate about nine passes apart. Measured over every combination at and around the
two thresholds: `0/10` fires slot 1, `0/11` fires nothing, `10/0` fires slot 2, `11/0` nothing.

**Only slot 1 spends a missile.** `$0B26` takes one unit off the `MSL` bar and the `$0B34` path
that fires slot 2 never touches it, so half the shots are free. The empty-bar test at `$0AE3`
is also the only thing in the block that looks at the bar, so slot 2 is never checked against
it either.

**And the cost is one unit, not four, by entering the damage routine's loop one byte in.**

```
$0B26  LDX MSL / LDY #$04 / JSR $1C8B / STX MSL
```

`$1C89` is `LDY #$01` followed by the loop body at `$1C8B`. Jumping past the `LDY` with Y
already at 4 means the `CPY #$04` fires after the first `DEX`, so the loop stops having
decremented once. The same four instructions that take four off the shield take one off the
missile bar, and the entry point is the whole difference. It is the only call in the binary
that enters at `$1C8B`; the six damage calls all go to `$1C89`.

#### The publish writes the wrong object's Y

`$1B2B` puts slot 1's X and Z into objects 6 and 18 and then writes `$FFF0` to **`OBJ4.y`** -
class 1's missile - rather than to `OBJ6.y`. `$1B60` does the same to `OBJ5.y`. Measured
directly: `$1B2B` changes `$815B`, which is `OBJ4.y`, twice, and never touches `$8175`, which
is `OBJ6.y`.

Two consequences, and the second is the one that shows on screen. **Nothing anywhere in the
binary ever writes a player shot's Y**, so a shot flies at whatever height `SV DATA` gave
objects 6 and 7. And publishing a player shot drags the enemy missile's Y from the -10 the
dispatch set at launch to -16, every pass the shot is up.

A shot has its own speed entry at `$0918`, holding **309** against the ship's 1280 and an enemy
missile's 383 - all divisors, so a shot covers 4.1 times the ground per pass that the ship does
under warp. It does not wrap at the edge of the world, and it stores its divided step back over
`$0915` and `$0916`, which are the ship's step operands - harmless for the same reason the
dispatch's `$1AE8` call is.

### The loop's own shape

Traced: the frame loop runs **`$09A3` to `$193C`**, in this order.

```
$09A3  the controls              $0A92  the throttle
$09D1  the ship moves            $0AB7  the gate closed, and the page flip
$0A09  and wraps                 $0ADB  the trigger
$0A63  and publishes             $0B6A  the two shots move
                                 $0C04  class 1: range, bearing, dispatch, reach, cool,
                                        hold, move, publish, the player's shots, its missile
                                 $1014  class 2, the same
                                 $141E  class 3, the same
$1829  the three debris ticks    $1851  JSR RENDER
$1854  the page toggle           $186E  the launch sounds
$1895  the awards                $18BC  the damage
$18D6  ...                       $193C  back to the top
```

All of it is now ported, including the three pieces that were left: the double-buffer page
selection at `$0ABC`-`$0ADA`, the tail at `$18D6`-`$193B`, and the once-only setup at
`$0957`-`$09A2`. `port/src/game/loop.js` is the driver and `parity_loop.mjs` holds it.

**The double buffer.** `$0947` is the toggle. `$0ABC` writes `$54` or `$55` into the DISPLAY
operand - the low bytes of the two page soft switches - and the opposite of the toggle into
CLEAR and DRAW, so the game shows one page while building the other. `$1854` flips the toggle
after the render, with `INX / CPX #$02`, an equality rather than a bound.

**Two ways out of the loop, and they share a door.** `$18D6` leaves if zero page `$00` holds
`$4D`, which `$1F64` - inside the destroyed sound - is what puts there. And `$18DD` leaves,
after one `INC $1FFE`, when all three wave counters are zero, all three enemy classes are
switched off and no debris is still animating: three counts of three, with two of them
short-circuiting on their last item. Death and wave-clear, both returning to the BASIC above.

**The pause is a key.** `$1929` sees a pending key, clears the strobe, then spins until another
key is pending. Press to pause, press to resume.

**The setup** primes both hi-res pages by rendering to each in turn, clears the page toggle,
spawns one class-1 and one class-2 enemy - not class 3, which only ever arrives through class
2's cascade or a kill - and publishes the ship's position.

**Three things about the order that are not obvious**, and that only a whole-loop harness can
check. An enemy whose cooldown is running **always moves**, because `$0E2C` jumps straight past
the hold test. A class with no object alive skips its whole region **including the two
shot-hit tests**, straight to its missile. And the debris ticks run **before** the awards,
which is what makes a kill score once.

#### What the whole-loop harness found

Three gaps that no per-block harness could see, because each was a block nobody had read.

1. **`controls.js` was half the block.** `$09A3` sets the heading and then calls `$1BD5` or
   `$1B95`, and each of those pans all seven stars three steps the other way, with a
   wrap that jumps the gap between `$43` and `$BC`. Found as `$8222` three out on the first
   pass.
2. **The renderer's 14-bit halving is reached.** `$688D` halves all three deltas when any will
   not fit in fourteen bits, and the port threw there with the comment "no geometry on this
   disk reaches it". It is reached on **63 of 138 points a pass**: a respawned enemy's Z
   operand is `$9600`, which as a signed 16-bit coordinate is -27,136. Now modelled, in
   `halveIfWide`.
3. **The warp gate has to be written back.** `$0A9D` stores `$FF` into `$0948` when warp
   engages and `$0AB7` stores zero when it does not, so the byte and `Flight`'s own copy are
   one thing. The driver wrote only the zero.

And it closes the renderer too, which took one more round. The first run of it reported the
drawn hi-res page as 15 to 217 bytes different and that was recorded as an open question; the
difference was the harness's, not the port's. `Screen` held its own pair of 8K buffers, so the
comparison was against the copy the harness had synced in rather than against anything the port
had drawn - the "differing" bytes were the ones that had changed since the previous frame.
`Screen` now takes the pages it draws into and the driver gives it views on `$2000` and `$4000`
of the same image, as the machine has them.

**So the whole machine agrees.** Over 24 passes, seeded once and never resynchronised: every
byte of MATH's table, of the display list, of the binary's state, and of both 8K hi-res
pages.

## The sound is a cycle count

`probe_sound.mjs` (12 checks), `parity_sound.mjs` (13), generated by `gen_sound.mjs`.

There is no sound chip. `$C030` is a soft switch and every access flips the speaker cone to the
other position, so **a sound is a list of cycle numbers** and the pitch is how long the 6502
spends between two of them. The binary touches the speaker in exactly three places, one in each
of three generators: `$1D67` in `$1D52`, `$1DA2` in `$1D9F` and `$1DC5` in `$1DBA`.

Seven sound routines, all of them straight-line stores into a parameter block at `$1D4A`-`$1D51`
that lives *inside the code*, between two routines, followed by a call to a generator. Three of
the seven make more than one call, so a sound is a sequence of stages.

| | at | stages | engine | asked for by |
|---|---|---|---|---|
| kill | `$1DD3` | 2 | `$1D52` | the three award blocks |
| shield held | `$1E03` | 1 | `$1D52` | `$1CC9` |
| systems hit | `$1E21` | 1 | `$1D52` | `$1CF5` |
| destroyed | `$1F2B` | 2 | `$1D52` | `$1CF2`, the fourth hit |
| player shot | `$1F73` | 1 | `$1D52` | `$1866` |
| enemy launch | `$1F8E` | 1 | `$1D52` | the three launch flags |
| warp buzz | `$1FB2` | 3 | `$1D9F` | `$0AEA` |

Measured, they run from 0.13s to 1.74s, 86 to 319 toggles each, with gaps between toggles from
72 to 31,245 cycles - which is 16 Hz to 7 kHz, so every one of them sweeps.

### Six of them have no waveform of their own

This is the finding that decided how to port it. `$1D52`'s generator keeps a 16-bit shift
register at `$1D4B`-`$1D4C`, shifts the carry into it, and gets the carry back out of an
`EOR`/`ASL` feedback chain. **Nothing initialises that register.** So what a sound sounds like
depends on where the register was when it started - which is where the last sound left it.

Measured over five seeds, all six change, and not subtly: `$1E21` gives 108 toggles from one
seed and 158 from another, and `$1DD3` gives 101 to 151. Lengths differ, so the sounds differ
in duration as well as in timbre. A captured waveform would have been one performance of the
sound and not the sound, so the port is an interpreter of the generator's forty instructions
with the register carried between sounds, exactly as the machine carries it.

`$1D52`'s timing is simple to count, and that is worth one check of its own: ten branches, every
target in page `$1D`, so none of them pays the extra cycle a page-crossing branch costs. The
transliteration came out cycle-exact first time on 176 runs - every stage of every sound, six
shift-register seeds, seven values of Y, and ninety random parameter blocks the game never uses.

### The seventh depends on the stack pointer

`$1FB2` drives `$1D9F`, which has no shift register: a period in `$1D4A`, a duration in `$1D51`,
counted down. It looked like the one waveform that could simply be captured, and the capture was
wrong twice.

First, the toggle count. `$1DA5` is both the instruction after `LDA $C030` **and** the target of
the `BNE` at `$1DAE`, so a harness that detects a toggle by where control lands counts the delay
loop too: 16,253 toggles where there are 85. A toggle has to be detected by the instruction that
just *ran*.

Second, it is not state-free either. `$1D9F` opens with `JSR $FF4A`, the monitor's SAVE, which
ends `TSX / STX $49` - so it returns with **the stack pointer in X**, and X is the period
counter. The first gap of the buzz is therefore however deep the stack happened to be, and only
the gaps after it come from `$1D4A`: four stack pointers give first gaps of 610, 1250, 1887 and
2377 cycles and then 2567 in every case. The duration also counts down on a `Y` nobody sets.

So that one is modelled too. The two ROM routines it leans on are measured rather than emulated:
`JSR $FF4A` costs 38 cycles and `JSR $FF3F` 31.

### What is not ported

`$1DBA`, the third generator, and the six-note sequence at `$1E40` that drives it. `$1E40` opens
`LDX $1E3F / BEQ $1E46 / RTS` - a byte inside the code that the sequence then increments - so it
fires once a game, from `$1CF5`'s path only.

### Rendering it

The port turns a toggle list into audio by averaging the 1-bit level over each sample's own span
of cycles rather than point-sampling it, because at 1 MHz a point reading of a square wave this
fast aliases badly - and a cone with mass averages anyway. The clock is taken as 1,020,484 Hz;
the Apple II stretches one cycle in 65 for the video and neither the oracle nor this models it,
which affects the rendered pitch by about 1.5% and nothing else, since parity is on cycle numbers
rather than on seconds.

---

## A game is thirteen bytes

`probe_progression.mjs` (22 checks), `parity_progression.mjs` (11).

Everything outside the flight loop is Applesoft, and everything the Applesoft and the binary say
to each other goes through **`$1FF3`-`$1FFF`** - the thirteen bytes just **above**
`STAR DESTROYER.OBJ0`, which ends at `$1FF0`. Being outside every binary's image is what lets
them carry state from one program in the chain to the next. That is the whole interface. There
is no file, no DOS buffer and no second channel.

Correcting this section as first written, which said they were the last thirteen bytes *of* the
binary's image. They are above it, and they do **not** survive the `BRUN` - see the next
section, which is what finding that out turned into.

| | written by | read by |
|---|---|---|
| `$1FF3` | `HYPERDRIVE 3`, `HYPERDRIVE 4` - both `POKE 8179,120` | `STARBASE` |
| `$1FF4` | `SELECT`, `STARBASE` | `STARBASE`, `INITIALS` |
| `$1FF5` | **the binary**, at `$09A0 INC $1FF5` | `SD PART2`, `STARBASE` |
| `$1FF6` | `SELECT` | `SD PART2` |
| `$1FF7` | `SD START2` | **`BASE STAR.OBJ0`** - see below |
| `$1FF8` | `SELECT` | `SD PART2` |
| `$1FF9`-`$1FFB` | `SD PART2`, and the binary counts them down | `SD PART2` |
| `$1FFC`-`$1FFE` | the binary's three award blocks | `STARBASE`, `INITIALS` |
| `$1FFF` | `BASE STAR.OBJ0` | `SD PART3`, `INITIALS` |

`$1FF7` was recorded here as written and never read. That is true of the twenty Applesoft
programs, which is all the scan that produced it could see, and false of the game: the finale's
binary zeroes it at `$0962`, increments it at `$0F53` and `$0F9B`, and at `$10ED` compares it
against fifteen, then calls two blocks, resets it and puts 4 in `$093E`. It is that binary's
progress counter through the final mission, and `SD START2`'s `POKE` is its initialisation.

`$1FF5` is the one worth stating plainly, because it is the only one the main binary keeps: the
increment is at `$09A0`, inside the once-only setup rather than the frame loop, so **it counts
flights, not passes**. Four passes of the loop leave it at 0.

### The shape of a game

```
SELECT    rolls the target from the difficulty, and zeroes all thirteen bytes first
SD START  zeroes the counters
SD PART2  rolls three wave counters, BRUNs the binary, then decides:
            a counter left, or $00 = 77    -> MONOLITH -> INITIALS      (dead)
            flights => target              -> HYPERDRIVE 3 -> STARBASE  (the last one)
            otherwise                      -> HYPERDRIVE1 -> STARBASE
STARBASE  scores the visit, banks the bonus, then:
            $1FF3 = 120 -> HYPERDRIVE 4 -> SD START2 -> SD PART3
            otherwise   -> HYPERDRIVE2  -> SD PART2
SD PART3  BRUNs BASE STAR.OBJ0, then $1FFF decides MONOLITH or WIN
```

So a game is **five to fifteen flights**, each a wave that has to be cleared to the last enemy,
with a starbase between each and a different binary for the finale. `SELECT` rolls the target
as `5 + RND*3`, `8 + RND*3` or `10 + RND*6`, and `POKE` truncates, so the three difficulties are
5-7, 8-10 and 10-15 flights. `SD PART2` line 300 rolls each wave counter as
`PEEK(8182) + ((RND(1)*4) + 1.5)` - the difficulty plus 1 to 5, weighted to the middle, because
the fractional part lands in `[1.5, 5.5)` and the ends get half a unit each.

Two details that read the wrong way round if you only glance at them. `SD PART2` line 175 is
`IF PEEK(8181) = > PEEK(8184)`, Applesoft's spelling of `>=`, so flying *exactly* as many as
asked for ends the run - a strict `>` would give every difficulty one flight too many. And
`STARBASE` line 220 is an equality against 120, not a test for nonzero, so the flag is a value
and not a boolean.

### Scoring

`SC = PEEK(8188)*300 + PEEK(8189)*600 + PEEK(8190)*800`, in both `STARBASE` and `INITIALS`.
On top of it `STARBASE` line 2016 banks `min(PEEK(8181), 5)` into `$1FF4` and pays
`PEEK(8180)*500`, so the bonus **accumulates across visits** - each visit adds the flights so
far, capped at five, to a running total that every later visit and the high-score screen
multiply again. `INITIALS` adds 10,000 if `$1FFF` is 1. A won game on hard comes out near
180,000, and about two thirds of that is the accumulated bonus rather than the kills.

### Four programs nothing names

Correcting this: it said three. `SD RET`, `HYPERDRIVE0`, `CLEAR SCORES` **and `CLS DATA`** are
on the disk and no `RUN` anywhere reaches them. The first two chain somewhere sensible -
`SD RET` sets up like `SD START`, `HYPERDRIVE0` runs `SD` - so they look like earlier versions
left in place, and `CLEAR SCORES` is two lines that reset `INITIALS.DAT` and was presumably run
by hand.

**`CLS DATA` is the interesting one**, and missing it was a real loss rather than a miscount.
It is not a screen at all: it is the author's own build tool, and line 530 is
`BSAVE CLS,A7890,L` - it **generates the `CLS` binary** that the hyperdrive animation BLOADs,
out of its own `DATA` statements. So one of the four 6502 overlays has its source on this disk,
in BASIC. It is also the only `BSAVE` anywhere on the disk, which is how it was found: a probe
counting the DOS commands the presentation needs came back with eight where seven were
expected.

### How this one was held

There is no machine in `parity_progression.mjs`, and that is deliberate. The four decisions are
four Applesoft lines, so the harness **parses each condition out of the detokenised program**
into a small expression tree, evaluates it independently, and compares the port's `next()`
against it over the whole of the state space those lines can see - 720 states for `SD PART2`'s
two lines and every value of the byte for the other two. A transcription error cannot survive
that, because the thing the port is compared against was never transcribed. Then complete games
are played in the port and their shape checked against what the lines say it should be.

---

## A BLOAD writes past the end of the file

`probe_overshoot.mjs` (17 checks), `parity_overshoot.mjs` (9).

The section above says a game is thirteen bytes. It is - and on this disk those thirteen bytes
are destroyed by the `BRUN` that is supposed to read them.

**This disk's DOS** does not copy a binary file out of a staging buffer. It reads the first
sector into a buffer, because the file manager has to find the load address and length in its
first four bytes before it knows where the file goes, and then reads **every sector after that
straight to the destination** - all 256 bytes of each, the last one included. So the sectors
land on a grid that starts four bytes below the load address, nothing is written below the load
address itself, and a load writes up to 255 bytes past the end of the file. What it writes there
is whatever was left in that sector on the disk when the file was saved.

**Corrected:** this section first said that was DOS 3.3's behaviour. It is not. Stock DOS 3.3
buffers each sector and copies out, and does not overshoot; the routine that walks the buffer
through the destination is a modification this disk carries and a System Master does not. See
the open question below, which is now answered. The measurements in this section are unchanged
- they were made on this disk and they still describe it - but the cause is a patched DOS and
not the operating system.

The model is one line - *a load writes the file's sector chain, less its header, at `addr`* -
and it predicts **all sixteen bytes at `$1FF0`-`$1FFF` from the disk image alone**, checked
against the running machine. `parity_overshoot.mjs` then replays every load on the path from
the boot to a flight, extracted from the detokenised programs rather than transcribed, and
reproduces 9,328 bytes of the machine's memory.

Every binary on the disk overshoots. The amount follows from the length:

    bytes = 256 x ceil((4 + len) / 256) - 4 - len

| | ends at | also writes | bytes |
|---|---|---|---|
| A2-3D2 | `$80FA` | `$80FB` | 1 |
| CLS | `$1FCB` | `$1FCC`-`$1FCD` | 2 |
| SV DATA, SV DATA2 | `$82E5` | `$82E6`-`$82F6` | 17 |
| MAIN DATA and its two variants | `$89D4` | `$89D5`-`$8AA9` | 213 |
| STAR DESTROYER.OBJ0, BASE STAR.OBJ0 | `$1FF0` | `$1FF1`-`$20EA` | 250 |
| MATH | `$9CF1` | `$9CF2`-`$9DEE` | 253 |

### The load order is a repair list

Four of those overshoots land on something the game needs, and three of them are repaired by
the load that comes next. `SD START` line 2 is

    BLOAD A2-3D2,A$6000 : BLOAD SV DATA : BLOAD MAIN DATA : BLOAD HEADING DATA,A35275

A2-3D2's single byte lands on `$80FB`, which is the display list's first byte - and SV DATA
starts exactly there, so loading it next is the repair. The overshoot would put `0` there; SV
DATA puts `14`, which is the VIEWPORT opcode the whole scene begins with. Measured on the
machine: `$80FB` is 14. Likewise MAIN DATA's 213 bytes land inside HEADING DATA, which is
loaded after it. **The order in that line is doing work, and the author knew about this.**

### The one that is not repaired

`STAR DESTROYER.OBJ0` ends at `$1FF0`, so its last sector covers `$1FEB`-`$20EA` and runs over
`$1FF3`-`$1FFF` - and the `BRUN` is the last thing `SD PART2` does before the binary takes
over. There is no line after it.

Measured, end to end, on the machine:

| | the BASIC rolls | the binary reads |
|---|---|---|
| `$1FF8`, the target | 7 flights | 217 |
| `$1FF9`-`$1FFB`, the waves | 2 / 2 / 5 - nine enemies | 32 / 51 / 51 - a hundred and thirty-four |

The slack is a line of leftover high-score text - fourteen of the sixteen bytes are printable,
and read `" 1     Y 33366"`. So on this image a flight spawns 134 enemies instead of 9, and when
it ends `SD PART2` line 172 finds the wave counters nonzero and goes to `MONOLITH`. The binary
is then seen doing exactly what it should with the wrong numbers: `$1E9D DEC $1FF9`,
`$1ECE DEC $1FFA` and `$09A0 INC $1FF5`, three writes in three million instructions.

**`BASE STAR.OBJ0` loads to the same address with the same length and the same 250-byte
overshoot, and it is harmless.** 249 of its 250 slack bytes are zero; the one that is not sits
at `$1FF1`, two bytes below the interface, so it touches nothing. Against the mission binary's
230 non-zero slack bytes that is the whole asymmetry, and it is what says neither was intended:
two files with identical geometry, one of which destroys the game and one of which does not,
and nothing in either chose which.

### What the port does about it

**It loads exactly the way DOS does, and then puts the thirteen bytes back.** That is the only
place in this port where the disk is not followed, and it was not the first decision: for most
of this project the default was to leave the corruption in place, on the rule that the
baseline is the disk.

The rule still holds; this is where it stops applying. **Fidelity to the game and fidelity to
this image are the same thing everywhere else, and opposite here.** Keeping `STARBASE`'s
`IF A = 8 THEN A = 9` preserves something Mitchell Robbins wrote, so the port keeps it.
Keeping this preserves `" 1     Y 33366"` - a stranger's high-score line that happened to be
lying in the sectors of this copy. It is not authorship, it is damage, and `BASE STAR.OBJ0`
is the proof: same geometry, same overshoot, and its slack does nothing. Nothing in either
file chose which. Left alone the binary reads a target of 217 against a flight counter already
at 32, and `SD PART2` line 172 ends every run at the high scores - so the default was
preserving a this image's accident at the cost of the author's game.

**What did not change is the measurement.** `dos.js` still overshoots, `boot()` still reports
in `actual` what the slack wrote, and `parity_overshoot.mjs` still holds the load model against
the machine over 9,328 bytes - with five checks added around the repair itself, the important
one being that it touches those thirteen bytes and **not one other byte of the 64K**. The
disk's own behaviour is a switch away (`corruptInterface: true`, the page's *load this disk's
broken interface*), and in that mode `$1FF3`-`$1FFF` still agrees with the machine byte for
byte.

This is still the **second thing a clean dump would change**, and the more interesting one,
because it is testable the moment one exists: load `STAR DESTROYER.OBJ0` from it, look at bytes
5,894 to 6,143 of its sector chain, and if they are zeros then this image is why the game does
not work rather than the game - and the repair above becomes a no-op that could be deleted.

---

## The music is two voices and three bytes a note

`probe_music.mjs` (10 checks), `parity_music.mjs` (5).

`PLAYER.MODULE` is 208 bytes at `$0300`, and `SELECT`, `MONOLITH` and `WIN` all use it the
same way: BLOAD the player, BLOAD a tune at `$6000`, `POKE 30,0: POKE 31,96` to point
`$1E`/`$1F` at it, `CALL 768`. That is the whole of the game's music.

**A tune is three bytes a record.**

| | |
|---|---|
| `00 .. ..` | the end |
| `01 a b` | not a note - set the two voices' octave shifts |
| `dd p1 p2` | a duration, voice 1's period, voice 2's period; a period of 0 is a rest |

`M.STAR DESTROYER` is 330 records - 326 notes and 4 control - and `M.END` is 329, of which
35 are control and 3 have a rest in one voice. Both end in a terminator with two bytes to
spare.

**The player patches itself, and that is the mechanism.** Each voice has one instruction
that flips its bit of the waveform byte, `EOR #$40` at `$0383` and `EOR #$80` at `$03BB`,
and the player writes `$C9` - CMP, which changes nothing - over the opcode to rest a voice
and `$49` to sound it. The periods go into the operands of `CPY #$00` at `$037B` and
`CPX #$00` at `$03B3`. Four self-modifying sites. A, X and Y are the state and survive each
note: A carries both square waves in bits 6 and 7, Y counts voice 1 and X counts voice 2,
and all three are pushed before a note is decoded and pulled back after.

**The NOPs are load-bearing.** The branch tree at `$0387`-`$0394` has every path padded to
the same cost, so the loop takes the same number of cycles whichever way the two voices
happen to be swinging. A transliteration that dropped them as dead code would be wrong by a
few cycles a pass, which is a pitch error rather than a crash.

**A key stops it.** `$0371 BIT $C000` and the `BMI` after it leave through the RTS, which is
why `SELECT` does not make you sit through the whole tune before choosing a difficulty.

### What the port got wrong first

The loop does not come back to its top. `$03BD BVS $0362` and `$03C0 BVC $0365` both land
*below* the `BNE $0365` at `$0360`, so that test runs once on the way in and never again.
Treating `$0360` as the top of the loop cost three cycles an iteration and put the very
first toggle three cycles late - which the parity harness reported as "machine 225, port
228" before anything else had a chance to go wrong.

---

## The hyperdrive is a starfield, and CLS is a table

`probe_hyperdrive.mjs` (12 checks).

Two files are BLOADed for the warp sequence between flights, and **only one of them is a
program**.

### CLS is data, and its source is on the disk

250 bytes at `$1ED2`, and every one of them is accounted for: `CLS DATA`, one of the four
programs nothing runs, is an Applesoft build tool whose DATA statements are a list of
addresses and whose line 530 is `BSAVE CLS,A7890,L`. Regenerating the file from that
program gives **the same 250 bytes**.

What the list holds is 124 hi-res row addresses, sixteen-bit and little-endian, ending in
`$7F`. Mapped back to rows they are **0 to 123, contiguous** - so the table is the sky and
not the screen. The instrument panel below row 123 is left alone, which is why there are 124
entries rather than 192, and 124 x 40 = **4,960 bytes**, which is exactly how many the
machine changes when the sequence runs.

So one of the four 6502 overlays needs no transliteration at all. It is a table, and the
port can load it the way the game does.

### HYPERDRIVE.OBJ0 is a starfield

2,048 bytes, entry `$08EF`, which is a `JMP $0A63` over its own data. 610 instructions
reachable, 605 of them executed.

`$08F2`-`$0A62` is 369 zero bytes on the disk and holds four tables the code fills in -
`$08F2`, `$096C`, `$09E6` and `$0A23`, which are each star's position and velocity, low byte
and high. `$0EC9` adds the velocity to the position, and that is the animation.

The screen clear at `$0E41` walks the CLS table two bytes at a time and **writes each address
into the operand of its own `STA $2000,X`** at `$0E47`, then fills 40 bytes. Self-modifying
code again, the same trick the music player uses, and the reason the table exists in that
form.

### What it needs that is not on the disk

Four ROM entry points: `$F6F0` three times, `$F457` once, and `$FF4A`/`$FF3F`, the monitor's
SAVE and RESTORE whose costs are already measured in the sound unit. 163,955 instructions of
an eight-million-cycle run execute at or above `$F000`.

This is the first thing in the port that depends on code which is neither on the disk nor
already ported. It is not a blocker and it does not need the ROM reimplemented: what a port
has to reproduce is the sequence's **effect on the page**, which is measurable, rather than
those routines' insides, which are not this disk's to explain.

### The branches lie about the loop, so it is counted instead

A first transliteration read the loop off the branch structure and got it wrong twice. Both
are now counted on the machine instead, and both are in the probe:

| | what the branches suggest | what the machine does |
|---|---|---|
| frames in the first pass | 10, from `CPX #$0A` at `$0F0E` | **14** |
| plots | 62 x 10 | **868**, which is 62 x 14 |
| entries to the sound routine | 40 after the clear, 1 a frame - 54 | **174** |

The frame count is the more interesting of the two: `$0A60` is incremented once per pass
through the star loop at `$0EF5`, and `CPX #$0A` compares against it, so ten is what the
code appears to say and fourteen is what happens. **Nothing here explains that yet**, and
the 120 unaccounted entries to `$0FBE` are the same kind of gap. Both are recorded as
measurements rather than guessed at, and a transliteration has to match them before it
means anything.

The tables the setup builds *are* settled: `oracle/gen_hyperdrive.mjs` captures them into
`port/src/game/hyperdrive-tables.js`, 62 stars with a step each, and they come out as a disc
of direction vectors - `-1..1`, then `-2..2`, then `-3..3` and so on outward, which is what a
starfield needs.

---

## The final mission is the same engine with five different models

`probe_basestar.mjs` (14 checks).

`SD PART3` BRUNs `BASE STAR.OBJ0` after `SD START2` has loaded `SV DATA2` and
`BASE STAR DATA` in place of the main mission's `SV DATA` and `MAIN DATA`. It is the last
part of the game that is gameplay rather than presentation.

**It is the same engine.** Same load address, same length, same entry at `$0957`, the first
105 bytes identical - MATH's directory, which both read through. It calls the same eleven
MATH entry points and no others, reads the paddle twice and calls the renderer three times,
exactly as the main mission does. It is about two thirds the size: **1,369 instructions
against 2,085**.

**The scene is nearly the same scene.** `SV DATA2` differs from `SV DATA` in **eight bytes**
of 491, and every one of them is at offset 11 or 12 of an object record - the shape pointer.
Objects 1 to 5 draw different models and nothing else about the display list changes.
`BASE STAR DATA` against `MAIN DATA` is 1,043 of 1,575 bytes identical, so the model file
shares two thirds of its structure and differs in the shapes themselves.

### Three rules a port would get silently wrong

| | the main mission | the finale |
|---|---|---|
| hits before it ends | 4, at `$1CFC` | **2**, at `$10E8 CPX #$02` with an `RTS` under it |
| `$1FF7` | written by `SD START2`, read by no BASIC | **its progress counter**, compared against 15 at `$10F0` |
| the wave counts | rolled by `SD PART2` | hardcoded 5, 3, 3 at `$1803` - **but nothing reaches that routine** |

Carrying the main mission's four hits across would make the finale twice as survivable, and
nothing on screen would say so.

**`$1FFF` is incremented, not set, and both sites fire in every winning mission.** ~~Whether
both can be reached in one mission is not established.~~ Established, by setting the progress
counter to fifteen in the machine and letting it run:

```
frame 1   $1FF7 reaches 15, so $10FF sets $093E to 4 and resets the counter
frame 2   the tick takes $093E to 3; $109D CPX #$03 / BCC does not branch;
          $10A7 INC $1FFF -> 1, and $10AA JMP $10CB keeps the mission running
frame 3   $093E to 2
frame 4   $093E to 1, then 0 - and with the field empty $112A INC $1FFF -> 2,
          and $112D RTS ends the mission
```

The staged win does not end anything; only `$112D` does. So **a won mission leaves `$1FFF`
holding 2**, and that is a bug in the original with a visible consequence:

| program | line | test | at 2 |
|---|---|---|---|
| `SD PART3` | 175 | `IF PEEK(8191) = 0 THEN RUN MONOLITH` | you win |
| `INITIALS` | 2016 | `IF PEEK(8191) = 1 THEN BN = BN + 10000` | **no bonus** |

So the ten thousand points for killing the base star are never paid. Being paid for it needed
the byte to hold 1, which needs the mission to end before the field empties. The port
reproduces it; `parity_finale.mjs` holds it.

### Getting it into a real mission

~~Running the binary with its files loaded gets it started but only 140 of its 1,369 addresses
run.~~ **Answered.** The missing piece was exactly what the previous paragraph guessed, and
it is seventeen POKEs.

`SD START2` is the one program on the route that is pure setup: four BLOADs and seventeen
POKEs, no input, no animation, no branch that depends on anything. `exercise.mjs`'s
`sdStart2Setup` reads them off the disk - variables resolved through the program's own
`NAME = number` assignments, so `POKE XI + 1,253` resolves through line 3's `XI = 33046`, and
line 129's `LO%`/`HI%` through lines 10-13 with `BV% = 5000` - and `toFinale` applies them in
the chain's own order: the four BLOADs, then the POKEs, then `SD PART3`'s two BRUNs. The order
is not cosmetic; four of the POKEs are to `$1FF7`-`$1FFF`, which the last BRUN's overshoot
lands on.

| | side-loaded | with `SD START2`'s POKEs |
|---|---|---|
| addresses reached | 147 | **542** of 1,369 |
| `$1FFF` after the run | **1** - already won | 0 |
| `$10A7` / `$112A` reached | yes, first pass | no |

The decisive POKE is line 130's `POKE 33099,255` - `$814B`, object 3's count - together with
line 4 zeroing the wave counters. Those are the bytes the finale's own "is the field empty"
test reads, and at zero the mission believes it has already been won. `probe_basestar.mjs`
holds both sides: the run, and the same run without the POKEs as a control.

542 of 1,369 is where it settles and it stays there over 80M cycles and 156 renders, because
the remaining code is the damage, kill and firing paths. The main mission with a centred
paddle and no trigger looks the same.

### The first block transliterated: how the mission ends

`port/src/game/finale.js`, held by `parity_finale.mjs` (9 checks, 180 swept cases).

**The two binaries are not the same code.** They share 105 bytes - the MATH directory - and
nothing else: 4% of 5,890 match, and every routine the port knows by address in the main
mission sits somewhere else here. "The same engine" means the same MATH entries, the same
renderer, the same paddle read; it does not mean reuse. So the finale is transliterated.

`$10E5`-`$112E` is the frame's last block and the finale's answer to `$18D6`/`$18DD`. It has
four ways out, and the harness compares **which address the machine leaves through**:

| exit | meaning |
|---|---|
| `$10EC RTS` | two hits - the mission is over |
| `$1104 JMP $112E` | a stage finished |
| `$112D RTS` | the field is empty - the base star is dead |
| `$112E JMP $09A7` | round again |

Three things in it differ from the main mission and none of them shows on screen:

- **Two hits, tested for equality.** `$10E8 CPX #$02 / BNE` leaves only at exactly two, where
  `$1CEE CPX #$04 / BCC` leaves at four *or more*. Nothing increments by more than one, so
  they agree in play - but they are different programs, and the control that writes `>= 2`
  fails at three hits.
- **No quit flag.** The main mission writes `$4D` into zero page `$00` and tests it at
  `$18D6`; the finale simply `RTS`es out of the mission from inside the frame. `$00` is not
  used here at all.
- **The pause compares against `$7F`**, where `$1929` compares against `$80`. One byte. The
  keyboard sets bit 7 while a key is pending, so the two agree in ordinary play and part only
  on exactly `$7F` - a cleared latch whose last key was DEL. Kept.

The win is two bytes: `$814B` (object 3's count) and `$093E` (class 1's debris) both zero.
That is the whole of "is the field empty", and it is why the mission has to be set up before
it is run. `$1FFF` is incremented rather than stored, so a mission reaching both this and
`$10A7` would leave it at 2 - which `SD PART3` reads as won and `INITIALS` reads as no bonus.

The frame top is **`$09A7`**, where the main mission's is `$09A3`.

### The damage block, $1476-$14FA

The shrink primitive at `$1476` is **logic-identical** to `$1C89` - `LDY #$01 / DEX /
CPX #$C7 / BEQ / CPY #$04 / BEQ / INY / JMP`, same floor, same four steps - so `damage.js`'s
`shrink` is reused rather than rewritten. Everything around it is at different addresses, and
two pieces of it behave differently in ways that matter.

**A ram costs eight, not sixteen.** `$1486` shrinks the shield twice, stores, then tests
`CPY #$0A` before falling into `$149E` for a second eight. `$1476` returns Y between 1 and 4
and can return nothing else, so that test is never equal, the branch is always taken and the
ram goes to the systems instead. The main mission's twin test is `CPY #$04`, which is exactly
what the primitive can return. One digit. Measured: `$FF` goes to 247.

**`$149E` is not dead code, it is the missile's.** `$14EE` tests the shield against `$C8` and
`$14F8` is `JMP $149E`, so the second eight belongs to the missile path. Which means ram and
missile cost the same eight here, where in the main mission a ram costs twice a missile.

**And the missile *sets* the hit count.** `$14B2 LDA #$01 / STA $0933`, unconditionally, in
the middle of `$149E`. A missile landing on a healthy shield puts the count at exactly 1 -
so it knocks a count of 2 back down to 1. Nothing in the main mission stores that byte at
all; every other write to it is an increment. Measured: two goes in, one comes out.

**Two fatal tests, doing different jobs.** `$14E0 CPX #$02 / BCC` is a threshold - at two or
more the systems block jumps to `$171D`, which is `JSR $1797` (teardown through `$C054` and
`$C056`), two sound bursts and an `RTS`. No state, not even a quit flag. The mission ends at
`$10E8 CPX #$02 / BNE`, the equality test in the frame. So the damage block plays the death
and the frame ends the mission, and a port with only one of the two would look right until
the count managed to pass two.

All four entry points - `$1486`, `$14EE`, `$14BF`, `$149E` - are held against the machine
across the shield's whole boundary, 189 cases each.

### The debris block, $103E-$10AA

Three debris counters tick down a frame at a time, the scene renders, two one-shot flags are
serviced and cleared, and then class 1's counter alone is tested against three - which is the
staged win above. Nothing else is tested there: not the other two counters, not the hit count.
The `$0947` toggle beside it is `INX / CPX #$02 / BNE / LDX #$00`, a plain 0/1 flip.

Held across 240 cases - every combination of the three counters either side of the threshold,
the toggle including an out-of-range 2, and both one-shot flags.

### The two award blocks, and one bit that is wrong

`$0F21`-`$0F61` and `$0F69`-`$0FA9` are the same seven steps twice: four `JSR $9C4B` calls
handing MATH its operands, a `JSR $142A`, a `JSR $99D2` compare, and a `BPL` that skips
everything when the answer is positive. When it is not, the enemy died - `$1FF7` goes up by
one, that class's debris counter is loaded with four, and three routines run.

**`$1FF7` is raised at these two sites and nowhere else**, so fifteen of them is the whole of
the finale's scoring. There is no third: `$093E` is written by nothing but `$10FF`, the staged
win itself, which is why class 1 is the base star rather than an enemy.

**The second block has `ROL $0907` where the first has `LDX $0906`.** The bytes are `AE 06 09`
against `2E 07 09` - one bit of one opcode - with identical alignment on both sides, so it is
not a disassembly artefact. Run in the machine as the single instruction it is: it rotates
`$0907` left through carry (`$12` to `$24`, or `$25` with carry in; `$81` to `$02`) and leaves
X holding what `$0F75 LDX $0930` put there. So the block **corrupts its own operand every time
it runs** and hands MATH the previous one twice.

Typo or bit rot is not knowable from here, and this file does not guess. What it does is
measurable and the port does the same. `$0907` is one of the bytes open question 15 has never
managed to name, and there is now a reason to want it named: it is the one the game damages.

### The hit test, and what the ROL actually costs

**`$142A` is `$1C3D` relocated and otherwise identical** - 26 instructions, same operands,
same MATH calls, same order, not one difference - so `geometry.js`'s `rangeFromArgs` is reused
exactly. Beyond the MATH directory and the shrink primitive, that is the only code the two
binaries genuinely share, and it means the finale's weapons use the main mission's range.

The idiom is `kill.js`'s to the instruction: four `JSR $9C4B` calls filling `$1C3D`'s argument
slots, the range, then `LDY $090A / LDX $092F / JSR $99D2 / BPL` - the same `$092F` threshold
an enemy rams the ship at, equality included.

**And the `ROL` is worse than it looked.** `$9C4B` walks X forward three bytes as it copies,
so it ends on the index *after* its source; table entries are three bytes, so after copying
`$0930` the register holds `$0931`'s index. Block B's third copy never reloads X, so:

|  | aX | bX | aZ | bZ |
|---|---|---|---|---|
| block A | `$0904` | `$0930` | `$0906` | `$0931` |
| block B | `$0905` | `$0930` | **`$0931`** | `$0931` |

Both points get the target's Z. **The Z delta is always zero**, so the range block B measures
is the X distance alone: the second weapon hits on how far across the target is and never on
how far away. Measured against the machine's MATH table byte for byte, from twelve different
mission states, plus a forced hit with the threshold raised.

One gap named rather than hidden: the bit `$0F7E` rotates in is the carry left by the `JSR`
above it, which is data-dependent, and `math.js` does not model MATH's flags because nothing
else has needed them. `hitTest` takes the carry as an input and the harness supplies the
machine's.

### A third of the finale is already written

Three routines turning up identical-but-relocated was either a coincidence or a pattern, and
the difference decides whether the finale is 1,369 instructions to write or far fewer. So
every routine either binary is JSRed to was reduced to a **shape**: its instructions to the
first `RTS`, with a branch or `JMP` landing inside the routine written as an offset instead of
an address, and everything else - absolute operands, calls out - kept exactly. Same shape
means same code at a different address.

**18 of the finale's 32 routines are main-mission routines moved**, 274 of its 556
instructions. The match runs to a **fixpoint**: a `JSR` to a routine already known to be a
relocation is rewritten through the mapping before the key is made, so two routines that are
the same code except that each calls its own copy of a helper can match once the helper is
known. Learning one helper lets its callers match, which can expose further callers; it
settles after three rounds. A single pass finds 14 and misses both star pans, which differ
from `$1B95` and `$1BD5` only in which wrap helper they name.

| finale | main | | finale | main | | finale | main |
|---|---|---|---|---|---|---|---|
| `$1131` | `$1A1E` | | `$134D` | `$1B60` | | `$1476` | `$1C89` |
| `$12D5` | `$1AE8` | | `$16EC` | `$1EFA` | | `$1478` | `$1C8B` |
| `$142A` | `$1C3D` | | `$1278` | `$1A8B` | | `$140B` | `$1C1E` |
| `$1382` | `$1B95` | | `$12B4` | `$1AC7` | | `$141F` | `$1C32` |
| `$13C2` | `$1BD5` | | `$1402` | `$1C15` | | `$12AB` | `$1ABE` |
| `$1318` | `$1B2B` | | `$1416` | `$1C29` | | `$1797` | `$1FA9` |

And **every one of them is a routine the port already holds against the machine** -
`controls.js`, `damage.js`, `dispatch.js`, `entities.js`, `kill.js`, `weapon.js`. They are not
work; they are a lookup. Four of them had been written down in `finale.js` as gaps before
anyone checked.

That leaves **14 routines and 282 instructions** that are the finale's own, and the largest
is `$1544` at 40. There is no monster routine in it. Of those fourteen:

- **two are already ported** - `$1486` and `$14EE`, the damage block, 45 instructions;
- **six are sound**, 105 instructions, every one of them reaching `$1544`, which is the
  finale's own `$1D52`. Sound is Phase 6 everywhere in this port and the finale matches;
- **six are gameplay still to write**: `$119E`, `$120B`, `$14FB`, `$17A0`, `$15AC` and
  `$1591`, **132 instructions** between them.

**The first version of this analysis said 19 routines and 694 instructions, with `$0D2A` at
346 of them.** That was wrong and the way it was wrong is worth keeping. It found call targets
by scanning every byte for `$20` and treating each as a `JSR`, which finds bytes that merely
look like a call: `$0D2A` came from three such, none of them at an instruction boundary. The
"routine" it produced was a 346-instruction span starting mid-instruction and running through
the awards, the debris and the frame end - three blocks already ported - before stopping at
their `RTS`. So the finale's own share was inflated by counting ported code twice, and the
control that was supposed to prove the method worked was built on the phantom. The scan now
walks only addresses `traverse` reached from `$0957`, and requires the target to be an
instruction too.

`probe_basestar.mjs` derives the mapping rather than storing it, so a module moving or a
routine changing makes the check fail, and the control is now one of the finale's own
routines failing to match.

What is still unported and genuinely the finale's: `$1544`, `$119E`, `$120B`, `$1382`,
`$13C2`, `$15C5`, `$14FB` (the debris drawer), `$17A0`, `$15AC`, `$1591`, `$15F5`, `$1613`,
`$1632`, `$171D`, `$1755`, `$175B`, `$1761` and `$177C`. They are named in `finale.js` rather
than dropped.

### The route is not walkable, and that is a separate bug

The honest way in is to finish a flight and let `SD PART2` line 175 route to `HYPERDRIVE 3`,
`STARBASE`, `HYPERDRIVE 4`, `SD START2`, `SD PART3`. Tried, and it gets three programs along:
the flight exits, `HYPERDRIVE 3` sets `$1FF3` to 120, and `STARBASE` loads and starts its
docking scene - **and never finishes it**. A2-3D2 enters a tight loop around `$664A`-`$665C`
and stays there through six emulated minutes, against the thirty-five renders `STARBASE`'s own
loop asks for (`Z` steps 45 from -1500 to -400, then `JM` counts ten more). Nothing waits for
a key anywhere on that route.

Whether that is the renderer, the starbase scene, or damage done by the nine bytes this
harness pokes to make the flight exit, is **not established**. It is open question 17.

---

## The ship is called the Beowulf

`probe_shapetext.mjs`.

For most of this file the game had no fiction in it. Nothing on the disk names the player's
ship or the enemy, and a search of the image for a name finds nothing, so this file said
there was nothing to find. **That was wrong, and the reason it was wrong is worth more than
the correction.** `START` prints its one message to the *text* screen, so
`PREPARE YOURSELF FOR THE ULTIMATE / STARSHIP BATTLE!` really does sit in the image as ASCII.
Every other word the game shows is **drawn**, with `XDRAW`, out of one shape table - and the
programs hold their text as lists of **shape numbers in `DATA` statements**. There is no text
to search for. A screenshot of the original showed a sentence this file said did not exist.

**The cipher is forced, not guessed.** `STARBASE` turns a digit into a shape number twice, by
different routes, and they agree:

| line | code | digit 0 | digit 9 |
|---|---|---|---|
| 2050 | `A = VAL(P$)` then `A = A + 2` | 2 | 11 |
| 3020 | `A = ASC(MID$(A$,J,1))` then `A = A - 46` | 2 | 11 |

`ASC - 46` makes the table a contiguous ASCII run starting at `/` (47). Then `?` is 17, and
the letters in the `DATA` start at **18**, not 19 - so `@` is **left out**. That closes the
account exactly: 1 + 10 + 6 + 26 = **43**, which is what the table's count byte declares,
with nothing over and nothing short. ASCII `/` through `Z` less `@`.

    shape 1      /
    shapes 2-11  0 1 2 3 4 5 6 7 8 9      (ASC - 46)
    shapes 12-17 : ; < = > ?              (ASC - 46)
    shapes 18-43 A .. Z                   (ASC - 47)

Confirmed against two words the derivation had no say in: `STARBASE` line 500 decodes to
`STARBASE`, the program's own name, and `INITIALS` line 2999 to `FINAL SCORE`. `0` is a space
and is never drawn (`DEMO` line 408, `STARBASE` line 208); `127` ends a row; `999` ends a
block, and `STARBASE` adds `777`, which stops the read, draws the score box and resumes.

**What it says is the whole of the game's story, and it is in `DEMO`** - the attract mode
this file called "never walked":

```
DEMO 450   STAR DESTROYER
DEMO 500   YOU ARE THE COMMANDER OF THE
DEMO 510   STARSHIP BEOWULF
DEMO 520   DESTROY THE ALIEN ARMADA
DEMO 525   BEFORE THEY DESTROY YOU
```

So the player's ship is the **Beowulf** and the enemy is the **alien armada**. Nothing else
on the disk names either, and no manual survives, so this is the only statement of what the
game is about that exists.

The port draws all 92 characters, in order, and leaves for `SELECT` on its own as the program
does. **What is not established is how long they stay up.** `GOSUB 400` is called from inside
the attract loop, which page-flips and renders 96 times while the text is on screen, and in
the port the page is nearly empty by the end. That is open question 16, and it is the reason
to finally walk `DEMO` in the oracle. `STARBASE` adds `STARBASE`, `DOCKING COMPLETE`, `SCORE` and
`LEVEL`; `INITIALS` adds `FINAL SCORE`. That is the game's entire written vocabulary, and it
uses **22 of the 26 letters** - no word in it contains a J, a Q, an X or a Z.

**One bug falls out of reading it.** `STARBASE` line 2045 is `IF A = 8 THEN A = 9`, applied to
the digit before the `+ 2`, so **every 8 in the docking score is drawn as a 9**: a score of
800 reads 900. Shape 10 is a perfectly good 8 - rendered and compared against shape 9, closed
top and bottom where the 9 is open - and the level-number routine at line 3020 draws it
without any such guard. So it is a mistake in the original, not a workaround for a damaged
glyph, and the port keeps it.

The lesson for the rest of this file: **"a search of the disk finds nothing" is not a finding
about the game.** It is a finding about the search, and this file has reached for that
reasoning before. Where it says the game contains no X, the question to ask is whether X
would be stored as bytes a search could match.

---

## Open questions

Things this pass did **not** establish. None of them should be guessed at later and quietly
promoted to fact.

1. **What the original title screens looked like.** Gone from this image, and now
   demonstrably so: there is not enough free space on the disk for them to be hiding in.
   Only a clean dump can answer it.
2. **Whether the change changed anything else** — the RWTS, a protection check inside a
   binary, the contents of `INITIALS.DAT`. Comparing against a second image is the only
   honest way to answer it, and **there is no second image**. The archive.org item
   `a2_asimov_star_destroyer` was the standing lead; its `star_destroyer.dsk` is
   byte-for-byte identical to this one, md5 `e48dd77ffa4b971bbaf75ab722424c7a`, and a search
   of archive.org by identifier and by publisher returns no other Apple II Star Destroyer at
   all. Every copy in circulation is this copy.

   Its fifty files were gone through rather than skimmed: the image, twenty-odd screenshots,
   and metadata. **No manual, no documentation, no description beyond the word "star
   destroyer".** The one substantial file is `a2_asimov_star_destroyer_meta.xml`, 24KB, whose
   `notes` field holds a 2014 auto-analysis of the disk: disk info, the catalogue, and
   detokenised listings of 21 Applesoft programs. Nothing in it about the game that this
   repository does not already take off the disk itself.

   It is worth something anyway, as **an independent reading of the same bytes from 2014**:

   - the catalogue agrees exactly - 48 files, same types, same sector counts, **same order** -
     and so do the free-sector count (10) and the volume number (254);
   - the detokenised line numbers agree for **20 of the 21** programs, `SD PART2`'s
     `= >` spelling of `>=` included;
   - on `INITIALS` they do not, and **this repository's reader is the one that is right**.
     It finds seven lines the 2014 tool dropped, a contiguous run from 5010 to 5052, and they
     are coherent high-score-insertion code - `INSERT = 1`, the `FOR J = 8 TO 1 STEP -1`
     that walks the table, and a stray `PRINT J` at 5051 that looks like the author's own
     debugging left in. The 2014 listing skips straight from 380 to 5055.

   The 2014 listings also drop the Ctrl-D from every DOS command, printing `"BRUNPART1.OBJ0"`
   where this repository prints `"^DBRUNPART1.OBJ0"`. That byte is the whole of DOS's
   interface from BASIC, so a listing without it reads as a program that prints filenames at
   the screen. One thing was tried and is recorded
   here as *not* an answer: tracks 0-2, which hold the DOS image, differ from a stock
   DOS 3.3 in 5,682 of 12,288 bytes. That sounds damning and proves nothing. DOS 3.3 ships
   in several releases, commercial disks routinely carry a patched or trimmed DOS, and the
   author had every reason to modify his own. It is not evidence about whoever modified it. (The
   reference image used was `dos33.dsk` from the Space Vikings tree, which is not in this
   repository, so this is not a reproducible probe and is not one.)

   **And that reference is worse than non-reproducible: it has no DOS file manager in it.**
   Counting instructions anywhere in each image that address the RWTS IOB at `$B7E8`-`$B7F4`
   - `STA`, `LDA`, `LDX`, `INC`, `STX` against those twelve bytes - gives 56 for this disk
   and **0** for `dos33.dsk`, which also has 289 of its 560 sectors blank. So the 5,682-byte
   figure was a diff against something that is not a working DOS, and it says nothing at all
   rather than merely saying little. Four other images to hand are no better for the purpose:
   Space Vikings in 4am's release has 32 such instructions, `Bolo` has 4 and `Neptune` has 0,
   so all of them carry a trimmed or partial DOS, which is what a commercial game does to get
   its memory back.

   **ANSWERED.** The routine at `$BC83`-`$BCB3` is **not stock DOS 3.3**. It is a
   modification carried by this disk and by nothing else to hand.

   The instruction is `$BC9B INC $B7F1`: it bumps the IOB's buffer one page per sector, so
   every sector after the first is read straight to the destination, the last one included.
   Stock DOS does not do that. It reads each sector into a fixed buffer and copies out, which
   is why a stock `BLOAD` does not overshoot.

   | image | file manager | the setter at T1/S14+75 | `INC $B7F1` |
   |---|---|---|---|
   | Star Destroyer | T0/S1+22, +95; **T0/S6+160, +193**; T1/S13+226 | yes | **yes, T0/S6+155** |
   | Space Vikings (4am release) | T0/S1+22, +95; T1/S13+226 | yes | no |
   | DOS 3.3 System Master | T0/S1+22, +95; T1/S13+226 | yes | no |
   | `dos33.dsk` | T0/S1+22, +95; T1/S13+226 | yes | no |

   Every image has the file manager at the **same sector offsets**, and the setter -
   `LDA $B5C9 / STA $B7F0 / LDA $B5CA / STA $B7F1`, which points the IOB once - at the same
   offset in all four. Only this disk has a sector, T0/S6, holding a routine that then walks
   that pointer. No other image has any buffer increment of any kind: not `INC $B7F1`, not
   `INC $B7F0`, not `INC $B5C9` or `INC $B5CA`.

   Reading sectors straight to the destination instead of buffering and copying is the
   classic **speed patch**. It is what a fast-DOS does, and it is what makes this one
   overshoot. Who applied it is not established - a this image's loader and a commercial fast
   DOS such as Diversi-DOS or Pronto-DOS both look like this, and testing against those is
   the obvious next step for anyone who wants a name.

   **The Space Vikings comparison is stronger than it first looked, and in the opposite
   direction to the one recorded here earlier.** 4am's release notes for that disk say what
   was changed, and it is four bytes:

       T00,S02,$FC: DA -> AD      T00,S03,$35: ED -> DE
       T00,S02,$5D: DA -> AD      T00,S02,$9E: ED -> DE

   Those are address and data epilogue marks - a nibble-level protection defeat - and none
   of them is in the file manager. The notes also say the image was taken from an original
   disk, lent at Kansasfest in 2017. So that image is **a preserved retail disk minus four
   bytes**, and its DOS is what subLOGIC shipped in 1982. All four bytes read the same way on
   this disk, and T0/S2 and T0/S3 are byte-identical between the two images.

   This matters because it was hedged the wrong way at first: the note here used to reason
   that Space Vikings has *fewer* file-manager instructions than this disk - 32 against 56 -
   and so 4am had probably replaced DOS with something smaller. 4am replaced nothing. The
   count runs the other way: **this disk's DOS carries about two dozen more file-manager
   instructions than a preserved original**, and the extra includes the routine that
   overshoots. Code was added here, not removed there.

   One thing it does not establish: Space Vikings is subLOGIC and Star Destroyer is Harvest
   Time Software, so this is not the same publisher's practice. It is the same author's
   previous game, preserved from an original, shipping a DOS without the patch.

   **Why this took four tries, and the thing to know before trying again.** A DOS 3.3 System
   Master stores its DOS image **unrelocated**, assembled for the bottom of memory: the file
   manager's page reads `$37` where a running 48K machine has `$B7`, and the bootstrap moves
   it up on load. Searching a master for `$B7xx` operands finds nothing and looks exactly
   like "this image has no DOS in it", which is what four images were wrongly written off as.
   Search for **both** `8D EC B7` and `8D EC 37`. This disk is the odd one out for storing
   DOS already relocated, which is itself consistent with its DOS having been saved from a
   running machine rather than built the standard way.

3. ~~**Opcode 3.**~~ Answered: a line back to the saved previous point, which it leaves
   in place. Handler `$62C0`.
4. ~~**What `CALL $6000` does with all this.**~~ Answered above, and so is everything that
   was open under it: the 2-D screen mapping, all thirty opcodes, and the projection's
   arithmetic.
5. ~~**The 13-byte record's bytes +0 to +9.**~~ Answered: a frame counter, a 16-bit
   position and a three-byte attitude. The counter's decrement **does** happen - it is
   A2-3D2's, at `$6D18`, one per render - and `$FF` is exempt, which is how the byte serves as
   a switch and a timer at once. See "The object count is a lifetime the renderer runs".
   This entry read "was never seen to happen" until `probe_entities.mjs` went looking.
6. ~~**`$81C0`-`$8247`.**~~ Answered: the instrument panel, as display-list instructions.
7. ~~**What is resident at `$6000`.**~~ Answered for flight: A2-3D2. Not established for
   the title, the demo or the end sequence, where the music loads over the same address.
8. ~~**The `.OBJ0` overlays at `$08EF`.**~~ Answered, below.
9. ~~**The renderer's output on the live display list.**~~ **Answered, and the question was
   wrong.** The last commit recorded this as a gap: the hi-res page the pass drew came out 15
   to 217 bytes different out of 8,192, and six rows ten apart pointed at the stars.
   There is no gap. `Screen` kept its own pair of 8K buffers, so `parity_loop.mjs` was
   comparing the machine's freshly rendered page against the stale copy it had synced in -
   and the bytes that "differed" were simply the bytes that had changed since the previous
   frame, which is why they were the stars and the moving objects and why the count varied
   with how much had moved.
   `Screen` now takes the two pages it draws into, the driver hands it views on `$2000` and
   `$4000` of the one image, and **both 8K pages agree byte for byte on every pass** - 24 of
   them, seeded once and never resynchronised. Recorded rather than quietly deleted, because
   the shape of the mistake is worth keeping: a harness that compares against something it
   supplied itself will tell you whatever you put there.
10. **`INITIALS.DAT`** — the game writes high scores back to the disk. Nothing has been
   measured about when or in what format.
11. ~~**The `DEMO` path**, never walked.~~ Partly answered, above, and it mattered more than
    its place in this list suggested: `DEMO`'s `DATA` statements hold **the game's entire
    fiction**, drawn from the shape table rather than printed, which is why no search of the
    image ever found it. The player commands the starship *Beowulf* against an alien armada.
    What is still unwalked is `DEMO`'s *animation* - whatever it draws between the sentences -
    and whether it returns to `LOGO1` or loops.
12. ~~**The world-to-view transform.**~~ Derived, above, and both routines under it are
    now transliterated and held by `parity_math.mjs` and `parity_view.mjs`.
13. ~~**`MATH` (`$98F3`) and `HEADING DATA` (`$89CB`).**~~ Both answered, below. `MATH` is a
    24-bit accumulator machine with nine entry points; `HEADING DATA` is a sine and cosine
    pair of amplitude 100 that `$1AE8` reads to build the ship's step. Ported and held by
    `parity_gamemath.mjs` and `parity_flight.mjs`.
14. ~~**The table at `$9800`.**~~ Answered as far as it needs to be, below: `MATH`'s own
    storage, `$9800`-`$98F2`, byte-indexed through a directory at `$08F2`, written by the
    binary and by nothing else. 241 of its 243 bytes are deterministic. **What still has no
    answer is which code builds it** - 18 indexed stores in `.OBJ0` are the only writers
    found and none of them is on the setup path, so the port starts from a capture. **One
    hypothesis is now ruled out**: no file's BLOAD overshoot reaches `$9800`. The nearest
    below it is HEADING DATA's, which stops at `$8CC6`.
15. **The game's state at `$0900`-`$0950`**, now mostly read. The dispatch added
    `$0911`-`$0914` (the two missiles' position entries), `$0919` (the missile speed divisor),
    `$0927`-`$092A` (their step entries), `$0938`-`$093A` (the three firing cooldowns) and
    `$0943`-`$0945` (the three launch-sound flags). `$0901` and `$0903` are the
    ship's position indices; `$0908`-`$090C` are the range and bearing block's working
    entries - dx, dz, range, bearing, scratch; `$090D`-`$0910` and `$0930`-`$0931` index the
    three enemy classes' positions; `$0915`-`$0917` are the movement operands; `$091F`-`$0924`
    are constants of the build - zero, 2.0, 90 degrees, 271 degrees, a disabled clamp's bound
    and 359; `$0926`, `$092F` and `$0932` are range thresholds; `$092B`-`$092E` are `$1C3D`'s
    four argument slots; `$0947` and `$0956` are counters; `$0948` is the warp gate and
    `$0949` the saved heading; and `$0933`-`$0956` holds the flags and counters the blocks
    write, which together with `$1D4A`-`$1D51` are the only bytes of the binary's image that
    change as it runs - `$0938`, `$0939`, `$0943`, `$0947` and `$0949` were seen moving over
    a minute of flight. What is still unread is
    `$0905`-`$0907`, `$0911`-`$0914`, `$0918`-`$091E`, `$0925`, `$0927`-`$092A` and
    `$0933`-`$0937`.
16. **Whether `DEMO`'s narration stays on the screen.** The sentences are drawn - the port
    XDRAWs all 92 characters in order, and `probe_shapetext.mjs` holds that - but `DEMO`
    draws them *from inside* its attract loop, which page-flips (`POKE 33040, 84 + OO`) and
    makes 96 `CALL 24576`s while they are up. In the port the page is nearly bare by the time
    `DEMO` leaves, so the text is being overwritten by later frames. Whether the machine does
    the same, flickers at half rate, or keeps it, is **unmeasured**: `DEMO` has still never
    been walked in the oracle, and this is now the reason to walk it. Until it is, the port's
    attract mode draws the right words and may well show them for the wrong length of time.

17. **Why `STARBASE` never finishes its docking scene in the machine.** Reached through the
    real chain it loads, starts rendering and then sits in A2-3D2 around `$664A` for six
    emulated minutes. Its own loop asks for about thirty-five renders. The suspect list is
    the renderer, the starbase scene itself, and the nine bytes `toFinale`'s first attempt
    poked to make the flight exit - and nothing distinguishes them yet. It is why the finale
    is reached through `SD START2`'s setup rather than by walking the chain.
