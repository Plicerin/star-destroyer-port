// The sound: a 1-bit speaker, toggled on a cycle count.
//
// There is no sound chip. $C030 is a soft switch and every access to it flips the speaker cone
// to the other position, so a sound IS a list of cycle numbers - and the pitch comes from how
// long the 6502 spends between two of them. That is why this file is an interpreter of
// forty instructions rather than a synthesiser: the generator at $1D52 cannot be
// described any other way, because the thing it produces is its own timing.
//
//     $1D52  SEC / INC $1D4E / LDX $1D4F
//     $1D59  ROL $1D4B / ROL $1D4C          a 16-bit shift register, carry in at the bottom
//            TXA / BEQ / DEX                count X down
//            BNE / BCC / LDA $C030          toggle, if X expired AND the carry is set
//            LDX $1D4F                      and reload the period
//     $1D6D  ROR A x3 / EOR $1D4C / ASL A x3 / PHP      the feedback into the carry
//     $1D77  the pitch sweep, if $1D50 is not zero
//     $1D93  PLP / DEC $1D4D / BNE / DEC $1D4E / BNE / RTS
//
// **The waveform is not a property of the sound.** `ROL $1D4B` and `ROL $1D4C` shift the carry
// into a register that nothing initialises, and the carry comes back out of the `EOR`/`ASL`
// feedback - so the noise depends on where the register was when the sound started, which is
// where the last sound left it. Measured over five seeds, all six of these sounds differ from
// the very first toggle, and their lengths differ too: $1E21 gives 108 toggles from one seed
// and 158 from another. So a captured waveform would have been a lie, and `state` below is
// carried across sounds exactly as $1D4B and $1D4C are.
//
// **$1FB2 drives the other generator**, $1D9F, which has no feedback register: just a period
// and a duration, counted down. It looked at first like a waveform that could simply be
// captured, and the capture was wrong twice over. The toggle count was wrong because $1DA5 is
// both the instruction after `LDA $C030` and the target of a branch, so watching where control
// lands counted the delay loop as well as the speaker - 16,253 toggles where there are 85. And
// it is not state-free either: `JSR $FF4A` leaves the STACK POINTER in X, so the first period
// is however deep the stack was, and the duration counts down on a Y nobody sets. So it is
// modelled too, by `generateTone`.
//
// Cycle counts are the ordinary 6502 ones, branches costing one more when taken. Every address
// in the generator is in page $1D and so is every branch target, so none of them pays the
// page-crossing penalty - which is worth saying because it would be the first thing to suspect
// if the timing were out.
//
// Held against the machine by oracle/parity_sound.mjs, which compares the complete list of
// cycle numbers, not a summary of it.
import { SOUNDS, BLOCK } from './sounds.js';

export { SOUNDS, BLOCK };

/**
 * The 6502's clock. The Apple II runs at 14.31818 MHz / 14, and stretches one cycle in every
 * 65 for the video, which this does not model - the oracle does not either, and parity is on
 * cycle numbers rather than on seconds, so the only thing this figure affects is the pitch of
 * the rendered audio.
 */
export const CPU_HZ = 1020484;

/** Where each byte of the parameter block lives, as an index into a `block` array. */
export const PARAM = {
  /** $1D4A - read by $1D9F and $1DBA, not by $1D52. */
  other: 0,
  /** $1D4B, $1D4C - the shift register, which nothing initialises. */
  shiftLo: 1,
  shiftHi: 2,
  /** $1D4D - the inner loop count. */
  inner: 3,
  /** $1D4E - the outer loop count, incremented on the way in. */
  outer: 4,
  /** $1D4F - the period: how many rounds between toggles. */
  period: 5,
  /** $1D50 - the sweep. Zero disables it; its sign chooses the direction. */
  sweep: 6,
  /** $1D51 - read by $1D9F, not by $1D52. */
  duration: 7,
};

/**
 * $1D52-$1D9E - run the generator and return every cycle at which the speaker flipped.
 *
 * @param {number[]} block the eight bytes of $1D4A-$1D51
 * @param {number} y the Y register on entry, which the sweep decrements and nothing sets
 * @returns {{cycles: number, toggles: number[], shift: number[], period: number, y: number,
 *            incTaken: boolean}} the state to carry into the next sound, and whether the
 *            unreachable-looking branch at $1D8D was taken
 */
export function generate(block, y = 0) {
  let lo = block[PARAM.shiftLo] & 0xff;
  let hi = block[PARAM.shiftHi] & 0xff;
  let inner = block[PARAM.inner] & 0xff;
  let outer = block[PARAM.outer] & 0xff;
  let period = block[PARAM.period] & 0xff;
  const sweep = block[PARAM.sweep] & 0xff;

  let a = 0, x = 0, yr = y & 0xff, carry = true, z = false, n = false;
  let cycles = 2;                                     // $1D52 SEC
  let incTaken = false;
  const toggles = [];

  outer = (outer + 1) & 0xff;                         // $1D53 INC $1D4E
  cycles += 6;
  x = period;                                         // $1D56 LDX $1D4F
  cycles += 4;

  for (;;) {
    // $1D59 - the shift register. The carry goes in at the bottom of $1D4B and out of the
    // top of $1D4C.
    let v = (lo << 1) | (carry ? 1 : 0);
    carry = v > 0xff;
    lo = v & 0xff;
    cycles += 6;
    v = (hi << 1) | (carry ? 1 : 0);
    carry = v > 0xff;
    hi = v & 0xff;
    cycles += 6;

    a = x;                                            // $1D5F TXA
    z = a === 0;
    cycles += 2;
    cycles += 2;                                      // $1D60 BEQ $1D63
    if (z) {
      cycles += 1;                                    // taken: X is already zero, so no DEX
    } else {
      x = (x - 1) & 0xff;                             // $1D62 DEX
      z = x === 0;
      cycles += 2;
    }

    cycles += 2;                                      // $1D63 BNE $1D6D
    if (!z) {
      cycles += 1;                                    // the period has not expired
    } else {
      cycles += 2;                                    // $1D65 BCC $1D6D
      if (!carry) {
        cycles += 1;                                  // expired, but the noise says no
      } else {
        cycles += 4;                                  // $1D67 LDA $C030
        toggles.push(cycles);
        x = period;                                   // $1D6A LDX $1D4F
        cycles += 4;
      }
    }

    // $1D6D - three rights, an EOR with the register's high byte, three lefts. The carry
    // that comes out of this is the bit the next ROL shifts in.
    for (let k = 0; k < 3; k++) {                     // ROR A
      const bit = a & 1;
      a = ((a >> 1) | (carry ? 0x80 : 0)) & 0xff;
      carry = bit === 1;
      cycles += 2;
    }
    a ^= hi;                                          // $1D70 EOR $1D4C
    cycles += 4;
    for (let k = 0; k < 3; k++) {                     // ASL A
      carry = (a & 0x80) !== 0;
      a = (a << 1) & 0xff;
      cycles += 2;
    }
    const saved = carry;                              // $1D76 PHP
    cycles += 3;

    // $1D77 - the sweep.
    a = sweep;                                        // LDA $1D50
    z = a === 0;
    n = (a & 0x80) !== 0;
    cycles += 4;
    let done = false;
    cycles += 2;                                      // $1D7A BEQ $1D93
    if (z) {
      cycles += 1;
      done = true;
    }
    if (!done) {
      yr = (yr - 1) & 0xff;                           // $1D7C DEY
      z = yr === 0;
      cycles += 2;
      cycles += 2;                                    // $1D7D BNE $1D93
      if (!z) {
        cycles += 1;
        done = true;
      }
    }
    if (!done) {
      yr = a;                                         // $1D7F TAY
      z = a === 0;
      n = (a & 0x80) !== 0;
      cycles += 2;
      cycles += 2;                                    // $1D80 BMI $1D8D
      let up = false;
      if (n) {
        cycles += 1;
        up = true;                                    // a negative sweep raises the pitch
      } else {
        a = period;                                   // $1D82 LDA $1D4F
        z = a === 0;
        cycles += 4;
        cycles += 2;                                  // $1D85 BEQ $1D93
        if (z) {
          cycles += 1;
          done = true;
        }
        if (!done) {
          period = (period - 1) & 0xff;               // $1D87 DEC $1D4F
          cycles += 6;
          a = yr;                                     // $1D8A TYA
          z = a === 0;
          cycles += 2;
          cycles += 2;                                // $1D8B BNE $1D93
          if (!z) {
            cycles += 1;
            done = true;
          } else {
            // Falling through to $1D8D would undo the decrement above. It cannot happen:
            // Y was loaded from the sweep two instructions ago and the sweep is not zero,
            // or $1D7A would have branched away. Kept because the original has it, and
            // reported so a harness can say it never fired.
            up = true;
          }
        }
      }
      if (up && !done) {
        period = (period + 1) & 0xff;                 // $1D8D INC $1D4F
        cycles += 6;
        a &= 0x7F;                                    // $1D90 AND #$7F
        cycles += 2;
        yr = a;                                       // $1D92 TAY
        cycles += 2;
        if (!n) incTaken = true;
      }
    }

    carry = saved;                                    // $1D93 PLP
    cycles += 4;
    inner = (inner - 1) & 0xff;                       // $1D94 DEC $1D4D
    z = inner === 0;
    cycles += 6;
    cycles += 2;                                      // $1D97 BNE $1D59
    if (!z) {
      cycles += 1;
      continue;
    }
    outer = (outer - 1) & 0xff;                       // $1D99 DEC $1D4E
    z = outer === 0;
    cycles += 6;
    cycles += 2;                                      // $1D9C BNE $1D59
    if (!z) {
      cycles += 1;
      continue;
    }
    cycles += 6;                                      // $1D9E RTS
    return { cycles, toggles, shift: [lo, hi], period, y: yr, incTaken };
  }
}

/**
 * One of the six sounds, through however many stages it has.
 *
 * The shift register and Y are carried from stage to stage and from sound to sound, which is
 * what the machine does and what makes the noise different every time. A caller that wants the
 * disk's own sequence has to keep one `state` and pass it along.
 *
 * @param {object} sound an entry from SOUNDS
 * @param {{shift: number[], y: number}} [state] carried from the last sound
 */
export function play(sound, state = null) {
  let shift = state ? [...state.shift] : [0, 0];
  let y = state ? state.y : sound.stages[0].y;
  const toggles = [];
  let cycles = 0;
  for (const stage of sound.stages) {
    const block = [...stage.block];
    let r;
    if (sound.engine === 0x1D9F) {
      r = generateTone(block, stage.x, y);
    } else {
      // The routine's own stores overwrite everything except the shift register, which it
      // leaves alone - so the carried pair goes back in before the engine runs.
      block[PARAM.shiftLo] = shift[0];
      block[PARAM.shiftHi] = shift[1];
      r = generate(block, y);
      shift = r.shift;
    }
    for (const t of r.toggles) toggles.push(cycles + t);
    cycles += r.cycles;
    y = r.y;
  }
  return { cycles, toggles, state: { shift, y } };
}

/**
 * `JSR $FF4A` - the monitor's SAVE, measured at 38 cycles with the JSR.
 *
 * It is ROM, so this port does not run it; what matters is its cost and the one thing it
 * leaves behind. SAVE stores A, X, Y, the flags and the stack pointer into $45-$49, and on the
 * way it does `TSX / STX $49` - so it returns with **X holding the stack pointer**, which is
 * what $1D9F's period counter starts from.
 */
export const SAVE_CYCLES = 38;

/** `JSR $FF3F` - the monitor's RESTORE, 31 cycles with the JSR. */
export const RESTORE_CYCLES = 31;

/**
 * $1D9F-$1DB9 - the other generator: a period and a duration, no noise.
 *
 *     $1D9F  JSR $FF4A                     and X comes back as the stack pointer
 *     $1DA2  LDA $C030                     toggle
 *     $1DA5  DEY / BNE $1DAD               the duration ticks on Y
 *     $1DA8  DEC $1D51 / BEQ $1DB6         and finishes when it runs out
 *     $1DAD  DEX / BNE $1DA5               the period
 *     $1DB0  LDX $1D4A / JMP $1DA2         reload and toggle
 *
 * So the pitch is $1D4A and the length is $1D51 in units of 256 of the inner delay - except
 * for the first period, which is whatever $FF4A left in X and not $1D4A at all.
 *
 * @param {number[]} block the eight bytes of $1D4A-$1D51
 * @param {number} x the period counter's first value, which is whatever $FF4A left in X -
 *   measured there rather than worked out from the stack pointer
 * @param {number} y the Y register at the call
 */
export function generateTone(block, x, y = 0) {
  const period = block[PARAM.other] & 0xff;
  let duration = block[PARAM.duration] & 0xff;
  let counter = x & 0xff;
  let yr = y & 0xff;
  let cycles = SAVE_CYCLES;
  const toggles = [];
  for (;;) {
    cycles += 4;                                      // $1DA2 LDA $C030
    toggles.push(cycles);
    for (;;) {
      yr = (yr - 1) & 0xff;                           // $1DA5 DEY
      cycles += 2;
      cycles += 2;                                    // $1DA6 BNE $1DAD
      if (yr !== 0) {
        cycles += 1;
      } else {
        duration = (duration - 1) & 0xff;             // $1DA8 DEC $1D51
        cycles += 6;
        cycles += 2;                                  // $1DAB BEQ $1DB6
        if (duration === 0) {
          cycles += 1 + RESTORE_CYCLES + 6;           // $1DB6 JSR $FF3F / $1DB9 RTS
          return { cycles, toggles, period, y: yr };
        }
      }
      counter = (counter - 1) & 0xff;                 // $1DAD DEX
      cycles += 2;
      cycles += 2;                                    // $1DAE BNE $1DA5
      if (counter !== 0) {
        cycles += 1;
        continue;
      }
      counter = period;                               // $1DB0 LDX $1D4A
      cycles += 4;
      cycles += 3;                                    // $1DB3 JMP $1DA2
      break;
    }
  }
}

/**
 * Turn a list of toggle cycles into audio.
 *
 * The speaker is one bit, so between two toggles the cone is simply in one position or the
 * other. Each output sample is the AVERAGE of that over the sample's own span of cycles rather
 * than a point reading, because at 1 MHz a point reading of a square wave this fast aliases
 * badly - and averaging is also closer to what a cone with mass actually does.
 *
 * @param {{cycles: number, toggles: number[]}} wave
 * @returns {Float32Array} samples in -1 to 1
 */
export function render(wave, { sampleRate = 44100, amplitude = 0.5, cpuHz = CPU_HZ } = {}) {
  const span = cpuHz / sampleRate;
  const count = Math.max(1, Math.ceil(wave.cycles / span));
  const out = new Float32Array(count);
  let level = -1, next = 0;
  for (let i = 0; i < count; i++) {
    const from = i * span, to = from + span;
    let at = from, sum = 0;
    while (next < wave.toggles.length && wave.toggles[next] < to) {
      const edge = Math.max(wave.toggles[next], from);
      sum += level * (edge - at);
      at = edge;
      level = -level;
      next++;
    }
    sum += level * (to - at);
    out[i] = (sum / span) * amplitude;
  }
  return out;
}
