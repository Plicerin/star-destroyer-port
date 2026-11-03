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
