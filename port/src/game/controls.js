/**
 * The flight controls, from the top of the frame loop at $09A3.
 *
 * This is one piece of STAR DESTROYER.OBJ0, not the whole of it. The binary runs about
 * 401 instructions a frame across seventeen regions; what is ported here is the part
 * whose behaviour `probe_gameloop.mjs` established by driving the real machine.
 *
 *     $09A3  LDX #$00        ; paddle 0
 *     $09A5  JSR $FB1E       ; PREAD, the monitor's paddle read, returns Y
 *     $09A8  CPY #$9B        ; 155 or more
 *     $09AA  BCC $09BE
 *     $09AC  LDX $811E  INX INX INX  STX $811E   ; heading += 3
 *     $09B5  STX $8251                            ; and object 12's heading
 *     $09BE  CPY #$64        ; under 100
 *     $09C0  BCS $09D1
 *     $09C2  LDX $811E  DEX DEX DEX  STX $811E   ; heading -= 3
 *
 * Three things about it that a reimplementation has to keep:
 *
 *   - the dead zone is **100 to 154 inclusive**, which is most of the paddle's travel
 *   - the turn is **three units a frame**, not proportional to how far the paddle is over
 *   - the heading is a byte and wraps, because the engine's angles are one byte to the
 *     whole turn
 *
 * The same value goes to the VIEWER instruction's heading operand and to object 12's, so
 * whatever object 12 is turns with the ship.
 */

export const DEAD_ZONE = [100, 154];       // inclusive, from CPY #$64 and CPY #$9B
export const TURN_RATE = 3;                // three INX or three DEX

/**
 * One frame of steering.
 *
 * `paddle` is what PREAD returned, 0 to 255 - not the stick's position. PREAD's timing
 * loop is not modelled here, so a caller that wants to drive this from a real analogue
 * axis has to produce the reading itself.
 *
 * Returns the new heading. The caller writes it to both the viewer and object 12.
 */
export function steer(heading, paddle) {
  if (paddle >= 0x9B) return (heading + TURN_RATE) & 0xff;
  if (paddle < 0x64) return (heading - TURN_RATE) & 0xff;
  return heading & 0xff;
}

/**
 * $8222 onward - the seven dots on the radar scope, three bytes apart.
 *
 * Each is a 2-D point's X operand, and turning the ship scrolls all seven the other way. This
 * was missing from the first version of this file, which read $09A3 as the heading and nothing
 * else: the block also calls $1BD5 or $1B95, and each of those puts every blip through a
 * three-step move. parity_loop.mjs is what found it, on its first pass, as $8222 three out.
 */
export const BLIPS = [0x8222, 0x8225, 0x8228, 0x822B, 0x822E, 0x8231, 0x8234];

/** `CPX #$7F` and `CPX #$44` / `CPX #$BC` - the two ends of the gap a blip jumps. */
export const SCOPE_LOW = 0x44;
export const SCOPE_HIGH = 0xBC;

/**
 * $1C1E - one step up, and the wrap that goes with it.
 *
 * A blip's X lives in $BC-$FF and $00-$43, which is a circle of 136 values with a gap in the
 * middle, and the check jumps the gap: anything that lands in $44-$7E is thrown forward to
 * $BC. Above $7F it is left alone, which is the other half of the gap and cannot be reached
 * from below.
 */
const wrapUp = (x) => {
  if (x >= 0x7F) return x;
  if (x < SCOPE_LOW) return x;
  return SCOPE_HIGH;
};

/** $1C32 - one step down, and the mirror of the same gap. */
const wrapDown = (x) => {
  if (x < 0x7F) return x;
  if (x >= SCOPE_HIGH) return x;
  return SCOPE_LOW;
};

/**
 * $1B95 / $1BD5 - scroll the whole scope one turn's worth.
 *
 * Three steps, each followed by the wrap check - not three steps and then one check. The third
 * check is the routine falling into it rather than calling it, which is the same thing.
 *
 * @param {Uint8Array} mem
 * @param {number} direction +1 for $1B95, which the LEFT turn calls, and -1 for $1BD5
 */
export function scrollScope(mem, direction) {
  const step = direction > 0 ? 1 : -1;
  const wrap = direction > 0 ? wrapUp : wrapDown;
  for (const blip of BLIPS) {
    let x = mem[blip];
    for (let k = 0; k < 3; k++) x = wrap((x + step) & 0xff);
    mem[blip] = x;
  }
}

/**
 * Which way $09A3 turned, if it turned: +1 for left and -1 for right, matching `scrollScope`.
 *
 * The signs look backwards and are not: turning the ship right scrolls the scope left, so the
 * right-hand branch at $09AC - the one that adds three to the heading - calls $1BD5, which
 * decrements every blip.
 */
export function turnDirection(paddle) {
  if (paddle >= 0x9B) return -1;
  if (paddle < 0x64) return 1;
  return 0;
}

/** Where the heading goes: the VIEWER instruction's operand, and object 12's. */
export const H1 = 0x811E;
export const OBJ12_HEADING = 0x8251;

/** Apply one frame of steering to a display list. */
export function applySteering(mem, paddle) {
  const next = steer(mem[H1], paddle);
  mem[H1] = next;
  mem[OBJ12_HEADING] = next;
  return next;
}
