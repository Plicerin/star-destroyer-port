// The frame loop: everything else in this directory, in the order the binary runs it.
//
// Twelve modules have been held to the machine one block at a time. This is the piece that was
// missing: the thing that calls them in the loop's own order, which is a claim of its own and
// gets its own harness. oracle/parity_loop.mjs runs the real loop and this one side by side,
// pass for pass, over the same input, and compares the whole machine - MATH's table, the
// display list, the binary's state and the hi-res page.
//
// Traced from the running disk, the loop is $09A3 to $193C:
//
//     $09A3  the controls                $0A92  the throttle
//     $09D1  the ship moves               $0AB7  the gate shut, and the page flip
//     $0A09  and wraps                    $0ADB  the trigger
//     $0A63  and publishes                $0B6A  the two shots move
//     $0C04  class 1, $1014 class 2, $141E class 3 - and each of those is
//            range, bearing, dispatch, reach, cooldown, hold, move, publish,
//            the two shot-hit tests, and that class's missile
//     $1829  the three debris ticks       $1851  JSR RENDER
//     $1854  the page toggle              $186E  the launch sounds
//     $1895  the awards                   $18BC  the damage
//     $18D6  two ways out                 $193C  JMP $09A3
//
// **Three things in the order matter and are not obvious.**
//
//   - An enemy whose cooldown is running **always moves**: `$0E2C` jumps straight past the
//     hold test. Only an enemy that is not cooling has to be outside 25 units to move.
//   - A class with no object alive skips its whole region **including the two shot-hit
//     tests**, straight to its missile: `$0C0C` is `JMP $0F83`.
//   - The debris ticks run **before** the awards, so a kill scores once rather than twice.
//
// **Two ways out of the loop.** `$18D6` leaves if zero page $00 holds $4D, which `$1F2B` - the
// destroyed sound - is what sets; and `$18DD` leaves, after one `INC $1FFE`, when all three
// waves are spent, all three enemy classes are off and no debris is still animating. Death and
// wave-clear, and they come out the same door into the BASIC above.
//
// **The pause is a key.** `$1929` sees a pending key, clears the strobe, and then spins until
// another key is pending. Press to pause, press to resume.
//
// The renderer is the port's own A2-3D2, called where `$1851` calls it, because it is not
// optional: it is what decrements every object's count, and the counts are the game's
// lifetimes. Pass `render: false` to drive the loop without it and nothing will ever expire.
import { Math24 } from './math.js';
import { TABLE_INIT, VAR } from './tables.js';
import { Flight, GATE_OPEN } from './flight.js';
import { steer, turnDirection, panStars, H1, OBJ12_HEADING } from './controls.js';
import { field } from './objects.js';
import { GEOM, rangeToTarget, bearing } from './geometry.js';
import { CLASSES, dispatch, coolDown } from './dispatch.js';
import { reach, hold, move, missile } from './entities.js';
import { SHOTS, shotHit, debrisTick, award, respawn } from './kill.js';
import { launchSounds, applyDamage, MSL, WARP, SHLD, HITS, QUIT, QUIT_VALUE }
  from './damage.js';
import { fire, moveShot, FIRED } from './weapon.js';
import { Engine } from '../a23d2/engine.js';

/** $8116, $811A - the viewer instruction's X and Z operands. */
export const XI = 0x8116;
export const ZI = 0x811A;

/** $8110, $8112, $8114 - the three page operands the double buffer writes. */
export const DISPLAY_PAGE = 0x8110;
export const CLEAR_PAGE = 0x8112;
export const DRAW_PAGE = 0x8114;

/** $0947 - which page is being drawn, 0 or 1. */
export const PAGE = 0x0947;

/** $0948 - the warp gate, and $0956 the counter that paces what warp costs. */
export const GATE = 0x0948;
export const BURN = 0x0956;

/**
 * $00 - zero page. $4D in it ends the loop, and `$1F64` is what puts it there.
 *
 * Defined in `damage.js`, because that is where it is written, and re-exported here because
 * `$18D6` below is where it is read.
 */
export { QUIT, QUIT_VALUE };

/** $1FF9-$1FFB - how many of each class the wave still has to send. */
export const WAVES = [0x1FF9, 0x1FFA, 0x1FFB];

/** $1FF5 - flights flown, which `$09A0` increments and no BASIC program writes. */
export const FLIGHTS = 0x1FF5;

/** $1FFC-$1FFE - the per-class counters the awards bump. $1FFE doubles as the wave-clear mark. */
export const SCORES = [0x1FFC, 0x1FFD, 0x1FFE];

/**
 * $0A63-$0A91 - publish the ship's position where the renderer reads it.
 *
 * The same two bytes per axis as every other publish - the position's middle and high - into
 * the VIEWER instruction's operands and into object 12's, which is the thing that turns with
 * the ship. The setup at $098B does exactly this too, before the loop starts.
 */
export function publishShip(mem, math, { axes = ['x', 'z'] } = {}) {
  for (const [index, viewer, object] of [[VAR.posX, XI, 'x'], [VAR.posZ, ZI, 'z']]) {
    // The finale's entry at $0992 publishes X alone, which is what `axes` is for. The loop's
    // own two calls take both and do not pass it.
    if (!axes.includes(object)) continue;
    for (const offset of [0, 1]) {
      const byte = math.table[(index + 1 + offset) & 0xff];
      mem[viewer + offset] = byte;
      mem[field(12, object) + offset] = byte;
    }
  }
}

/**
 * $0ABC-$0ADA - choose which hi-res page is shown and which is drawn.
 *
 * `$0947` is the toggle. The display operand takes $54 or $55, which are the low bytes of the
 * two page soft switches, and the clear and draw operands take the opposite of the toggle - so
 * the game shows one page while building the other.
 */
export function selectPages(mem) {
  const toggle = mem[PAGE];
  mem[DISPLAY_PAGE] = toggle === 0 ? 0x54 : 0x55;
  const other = toggle === 1 ? 0 : 1;
  mem[CLEAR_PAGE] = other;
  mem[DRAW_PAGE] = other;
}

/**
 * $18DD-$1928 - is the wave finished?
 *
 * Three counts of three, and each is "how many of these are zero": the wave counters, the
 * three enemy classes' object counts, and the three debris counters. All nine zero means the
 * wave is clear. Two of the three tests also short-circuit on their last item - `$18EE` and
 * `$191E` branch away as soon as the third one is non-zero - which changes nothing about the
 * answer and is kept because it is what the original does.
 */
export function waveClear(mem) {
  let n = 0;
  for (const [i, wave] of WAVES.entries()) {
    if (i === 2 && mem[wave] !== 0) return false;        // $18EE
    if (mem[wave] === 0) n += 1;
  }
  if (n !== 3) return false;
  n = 0;
  for (const c of CLASSES) if (mem[field(c.enemy, 'count')] === 0) n += 1;
  if (n !== 3) return false;
  n = 0;
  for (const [i, c] of CLASSES.entries()) {
    if (i === 2 && mem[c.debrisCounter] !== 0) return false;   // $191E
    if (mem[c.debrisCounter] === 0) n += 1;
  }
  return n === 3;
}

/** What one pass did, and whether the loop is over. */
export const DONE = { running: null, destroyed: 'destroyed', waveClear: 'waveClear' };

export class Game {
  /**
   * @param {Uint8Array} mem a 64K image with A2-3D2 at $6000, SV DATA at $80FB, MAIN DATA at
   *   $83AE and STAR DESTROYER.OBJ0 at $08EF - the same set DOS leaves resident in flight
   * @param {object} [options]
   * @param {boolean} [options.render] false drives the loop with no renderer, which means no
   *   object ever expires, because the count is the renderer's to decrement
   */
  constructor(mem, { render = true } = {}) {
    this.mem = mem;
    this.math = new Math24();
    this.math.table.set(TABLE_INIT, 0);
    this.flight = new Flight(this.math);
    // The hi-res pages are memory, so the renderer draws straight into the image rather
    // than into a buffer of its own: $2000 and $4000, where the machine has them.
    this.engine = render
      ? new Engine(mem, { pages: [mem.subarray(0x2000, 0x4000), mem.subarray(0x4000, 0x6000)] })
      : null;
    /** What the last pass asked the sound to play, in order. Phase 6 is not wired up. */
    this.sounds = [];
  }

  /** The renderer, where $1851 and the setup call it. */
  render() {
    if (!this.engine) return;
    this.engine.reset();
    this.engine.run();
  }

  /**
   * $0957-$09A2 - once, before the loop.
   *
   * Prime both hi-res pages by rendering to each in turn, clear the page toggle, spawn one
   * class-1 and one class-2 enemy, and publish the ship's position. Note which two classes:
   * class 3 is not spawned here and only appears through class 2's cascade or a kill.
   */
  setup() {
    this.mem[DISPLAY_PAGE] = 0x54;
    this.mem[CLEAR_PAGE] = 1;
    this.mem[DRAW_PAGE] = 1;
    this.render();
    this.mem[DISPLAY_PAGE] = 0x55;
    this.mem[CLEAR_PAGE] = 0;
    this.mem[DRAW_PAGE] = 0;
    this.render();
    this.mem[PAGE] = 0;
    // $0985, $0988 - with the carry CLEAR, which is not what it is anywhere else. `$0957` is
    // `CLC`, but `JSR $6000` runs the whole renderer twice before these two, so the flag here
    // is A2-3D2's leftover rather than that `CLC`. Measured at both call sites from six
    // different mission states: clear every time. It was `true` here, which put each spawn's
    // X high byte one too far out - invisible, because nothing drove `setup`.
    respawn(this.mem, this.math, CLASSES[0], false, CLASSES);   // $0985 JSR $1E98
    respawn(this.mem, this.math, CLASSES[1], false, CLASSES);   // $0988 JSR $1EC9
    publishShip(this.mem, this.math);

    // $09A0 INC $1FF5 - the last instruction of the block, and **the binary is what counts
    // flights**: no Applesoft program touches this byte. `SD PART2` line 175 compares it with
    // the target `SELECT` rolled, so without it a game can never reach its last flight and
    // never reach the base star. It was missing here until the chain needed it, and nothing
    // caught that because no harness drove `setup` at all and `$1FF5` sat outside the window
    // `parity_loop.mjs` compared.
    this.mem[FLIGHTS] = (this.mem[FLIGHTS] + 1) & 0xff;
  }

  /**
   * $0C04 / $1014 / $141E - one enemy class's whole region.
   *
   * The order here is the loop's and the three jumps that shape it are named where they are.
   */
  enemy(c) {
    const { mem, math } = this;
    // $0C04 - no object alive: the region is skipped entirely, shot tests and all, and only
    // the class's missile still gets a pass.
    if (mem[field(c.enemy, 'count')] < 1) {
      missile(mem, math, c);
      return;
    }
    const target = GEOM.targets[CLASSES.indexOf(c)];
    rangeToTarget(math, target.x, target.z);     // $0C0F
    bearing(math);                               // $0C5A
    dispatch(mem, math, c);                      // $0D5B
    reach(mem, math, c);                         // $0E05
    // $0E23 - a cooling enemy jumps straight past the hold test, so it always moves.
    if (coolDown(mem, c) || !hold(math)) move(mem, math, c);
    for (const shot of SHOTS) shotHit(mem, math, shot, c);   // $0EF3, $0F3B
    missile(mem, math, c);                       // $0F83
  }

  /**
   * $09A3-$193C - one pass of the loop.
   *
   * @param {object} input
   * @param {number} input.paddle0 what PREAD would return for the steering paddle
   * @param {number} input.paddle1 and for the throttle
   * @param {boolean} input.button0 BUTTON0, the trigger
   * @returns {{done: string|null, sounds: number[]}}
   */
  pass({ paddle0 = 128, paddle1 = 255, button0 = false } = {}) {
    const { mem, math } = this;
    this.sounds = [];

    // $09A3 - the controls. The same byte goes to the viewer and to object 12, and turning
    // also pans the seven stars the other way.
    const heading = steer(mem[H1], paddle0);
    const turn = turnDirection(paddle0);
    mem[H1] = heading;
    mem[OBJ12_HEADING] = heading;
    if (turn !== 0) panStars(mem, turn);

    // $09D1 - the ship, gated on the warp the PREVIOUS pass set.
    this.flight.step(heading);
    publishShip(mem, math);                                  // $0A63

    // $0A92 - the throttle, which sets the gate the next pass reads.
    mem[WARP] = this.flight.throttle(paddle1, mem[WARP]);
    // $0A9D stores $FF when it opens and $0AB7 stores zero when it does not, so the byte and
    // Flight's own copy are the same thing and both have to be written.
    mem[GATE] = this.flight.gate;
    mem[BURN] = this.flight.burnCounter;
    selectPages(mem);                                        // $0ABC

    // $0ADB - the trigger, then the two shots.
    const shot = fire(mem, math, button0);
    if (shot.sound) this.sounds.push(shot.sound);
    for (const s of SHOTS) moveShot(mem, math, s);           // $0B6A, $0BB7

    for (const c of CLASSES) this.enemy(c);                  // $0C04, $1014, $141E

    // $1829 - the debris, before the awards, which is what makes a kill score once.
    for (const c of CLASSES) debrisTick(mem, math, c, CLASSES);

    this.render();                                           // $1851 JSR RENDER

    // $1854 - the page toggle, which `selectPages` reads on the next pass. `INX / CPX #$02`
    // is an equality, not a bound, so a toggle that somehow held 5 would count on to 6 rather
    // than being pulled back to 0.
    mem[PAGE] = (mem[PAGE] + 1) & 0xff;
    if (mem[PAGE] === 2) mem[PAGE] = 0;

    // $1861 - the firing flag, read and cleared like the three launch flags below it.
    if (mem[FIRED] !== 0) {
      this.sounds.push(0x1F73);
      mem[FIRED] = 0;
    }
    for (const s of launchSounds(mem, CLASSES)) this.sounds.push(s.sound);   // $186E
    for (const c of CLASSES) {                               // $1895
      const a = award(mem, c);
      if (a.awarded) this.sounds.push(a.sound);
    }
    const damage = applyDamage(mem);                         // $18BC
    for (const r of [damage.ram, damage.missile]) {
      if (!r) continue;
      if (r.sound) this.sounds.push(r.sound);
      if (r.sounds) for (const x of r.sounds) this.sounds.push(x);
    }

    // $18D6 - the two ways out.
    if (mem[QUIT] === QUIT_VALUE) return { done: DONE.destroyed, sounds: this.sounds };
    if (waveClear(mem)) {
      mem[SCORES[2]] = (mem[SCORES[2]] + 1) & 0xff;          // $1925 INC $1FFE
      return { done: DONE.waveClear, sounds: this.sounds };
    }
    return { done: DONE.running, sounds: this.sounds };
  }
}
