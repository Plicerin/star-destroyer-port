/**
 * A2-3D2's 2-D line, at $7748.
 *
 * It is Bresenham, but that is a conclusion rather than an assumption - the stepping was
 * measured out of the engine before any of this was written, because the previous two
 * times something here was read off the disassembly it was read wrong.
 *
 * What the 6502 does, and why it does not look like Bresenham at first:
 *
 *     LDA #$00  SEC  SBC $B9     ; A = -dx
 *     SEC  ROR A   STA $B8       ; the error, biased
 *     ...
 *     ADC $BA                    ; error += dy
 *     BCS step                   ; carried?
 *     ...
 *     step: SBC $B9  STA $B8     ; error -= dx, and move a row
 *
 * The stored error is `e - dx` in two's complement, so the carry out of `ADC dy` is
 * exactly the test `e + dy >= dx`, and the `SBC` after it re-biases. Unwound, the
 * initial value is `floor(dx/2)` and the rule is the textbook one. Checked against the
 * engine: for the line (0,0)-(40,13) it reproduces all thirteen y-transitions including
 * the one four-long run at x = 20, where every other run is three.
 *
 * Four unrolled loops in the original, one per case, chosen after x is normalised:
 *
 *   $7796  dy >= 0, |dy| <  dx    shallow, stepping y up
 *   $79C8  dy <  0, |dy| <  dx    shallow, stepping y down
 *   $7BFA  dy >= 0, |dy| >= dx    steep
 *   $7C90  dy <  0, |dy| >= dx    steep
 *
 * The unrolling is over bit positions within the byte, not over steps - which is why the
 * routine is 1.7 KB of nearly identical blocks and why transliterating it would have been
 * 1.7 KB of nearly identical JavaScript.
 *
 * **The endpoints are normalised, and that matters.** When x2 < x1 the engine swaps both
 * points ($777F) and draws from the lower x. Bresenham run from the other end can differ
 * by a pixel wherever the error lands exactly on the threshold, so a port that skipped
 * the swap would be right most of the time.
 */

/**
 * The cells a line covers, in the order the engine plots them.
 *
 * Returns coordinates rather than drawing, so the caller puts them through the same
 * plotter as everything else - the colour, the plot mode and the straddle all belong
 * there, not here.
 */
export function lineCells(x1, y1, x2, y2) {
  // $777F: normalise on x, swapping both ends.
  if (x2 < x1) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sy = dy < 0 ? -1 : 1;
  const ady = Math.abs(dy);

  // Shallow and steep differ in more than which axis is stepped. A shallow line walks
  // several cells along one byte, so the original combines them into a run mask that
  // stops at $7F; a steep line changes row every step and never has a run to combine, so
  // it plots single cells with the table's own mask, $C0 and all. Measured: with runs
  // used for both, the steep comparisons came back with the engine setting bit 7 where
  // the port did not.
  const out = [];
  out.run = ady < dx;
  if (ady < dx) {
    // Shallow: one cell per x, dx + 1 of them.
    let y = y1, e = dx >> 1;
    for (let i = 0, x = x1; i <= dx; i++, x++) {
      out.push([x, y]);
      e += ady;
      if (e >= dx) { e -= dx; y += sy; }
    }
  } else {
    // Steep: one cell per y, |dy| + 1 of them. dy >= dx sends the engine here, so the
    // exactly-diagonal case is steep, not shallow.
    //
    // And the rule is NOT the mirror of the shallow one. $7BFA starts the error at
    // +floor(dy/2) unbiased - `LDA $BA, CLC, ROR A` - where the shallow path starts at
    // -floor(dx/2) biased, and the loop at $7C32 then does
    //
    //     SEC  SBC $B9     ; e -= dx
    //     BCS  no step     ; borrowed?
    //     ADC  $BA         ; e += dy, and step x
    //
    // so it subtracts first and steps on the borrow. That lands differently on ties from
    // the shallow path's "add, then test >= dx", which is exactly the off-by-one this
    // had: at y = -40 on the line (-9,-60)-(20,-20) the engine is at x = 5 and the
    // mirrored rule says 6.
    let x = x1, e = ady >> 1;
    for (let i = 0, y = y1; i <= ady; i++, y += sy) {
      out.push([x, y]);
      e -= dx;
      if (e < 0) { e += ady; x += 1; }
    }
  }
  return out;
}

/**
 * Draw a line onto a Screen, which is where colour and plot mode live.
 *
 * Every cell goes through the plotter in RUN form - the original builds a mask covering
 * a run of cells inside one byte, and those masks stop at $7F, so a straddling cell gets
 * its pixel and not the palette bit. See Screen#point.
 */
export function line(screen, x1, y1, x2, y2) {
  const cells = lineCells(x1, y1, x2, y2);
  const how = cells.run ? 'run' : 'cell';
  for (const [x, y] of cells) screen.point(x, y, how);
}
