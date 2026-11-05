// PLAYER.MODULE, transliterated.
//
// 208 bytes at `$0300`, called by `SELECT`, `MONOLITH` and `WIN` after they BLOAD a tune at
// `$6000` and point `$1E`/`$1F` at it. Two voices, square waves, no chip - the same speaker
// the sound effects use, so what comes out of here is a list of cycle numbers and
// `sound.js`'s `render` turns it into samples.
//
// **The shape of it.** Three bytes a record: duration, voice 1's period, voice 2's period.
// A duration of 1 means the record is not a note but a pair of octave shifts; a duration of
// 0 ends the tune; a period of 0 is a rest in that voice.
//
// **It patches itself, and that is the mechanism rather than a detail.** Each voice has one
// instruction that flips its bit of the waveform byte - `EOR #$40` at `$0383` for voice 1 and
// `EOR #$80` at `$03BB` for voice 2 - and the player stores `$C9` (CMP, which changes
// nothing) over the opcode to silence a voice and `$49` (EOR) to sound it. The periods go
// into the operands of `CPY #$00` at `$037B` and `CPX #$00` at `$03B3`. Four sites, checked
// against the disk by `oracle/probe_music.mjs`.
//
// **A, X and Y are the state and they survive each note.** A holds the two voices' square
// waves in bits 6 and 7, X counts voice 2 down and Y counts voice 1 down, and the three of
// them are pushed before each note is decoded and pulled back afterwards. The NOPs scattered
// through the inner loop are there to make every path through it cost the same number of
// cycles, which is why they are kept here as cycle costs rather than dropped as dead code.
//
// Cycle counts are hand-written, the way `sound.js`'s are, and `oracle/parity_music.mjs`
// compares the complete list of toggle cycle numbers against the machine's - so a miscount
// is not a subtle inaccuracy, it is a failing harness.

/** The two speaker-toggling sites per voice, for anyone reading alongside the disassembly. */
export const SPEAKER = [0x0362, 0x036C, 0x0396, 0x03A3];

/** `$49` is EOR - the voice sounds. `$C9` is CMP - the voice rests. */
export const EOR = 0x49, CMP = 0xC9;

/** What one tune record is. */
export function records(tune) {
  const out = [];
  for (let p = 0; p + 2 < tune.length; p += 3) {
    const a = tune[p];
    if (a === 0) break;
    out.push(a === 1
      ? { kind: 'control', shift1: tune[p + 1], shift2: tune[p + 2] }
      : { kind: 'note', duration: a, p1: tune[p + 1], p2: tune[p + 2] });
  }
  return out;
}

/**
 * Play a tune, and say when the speaker moved.
 *
 * @param {Uint8Array|number[]} tune the bytes BLOADed at $6000
 * @param {object} [opts] `budget` a cycle ceiling, `maxToggles` to stop early, `keyAt` a
 *   cycle number at which a key becomes pending - which is how the real one is cut short
 * @returns {{cycles: number, toggles: number[], ended: string}}
 */
export function play(tune, { budget = 40000000, maxToggles = Infinity, keyAt = null } = {}) {
  const t = tune;
  let cycles = 0;
  const toggles = [];
  const tick = (n) => { cycles += n; };
  /**
   * The cap has to bite where the toggle happens, not once an iteration: one pass through
   * the loop can touch the speaker twice, so a check at the top overshoots by one and the
   * list is then a toggle longer than the machine's.
   */
  const Stop = Symbol('enough');
  const speaker = () => {
    toggles.push(cycles);
    if (toggles.length >= maxToggles) throw Stop;
  };

  // Zero page, as the player uses it.
  let v1reload = 0;        // $06
  let v2reload = 0;        // $07
  let duration = 0;        // $08
  let shift1 = 1;          // $09
  let shift2 = 1;          // $1D
  let ptr = 0;             // $1E/$1F, as an index into the tune
  let state = 0;           // $4E - the waveform byte, saved and tested
  let sub = 0;             // $4F - the sub-counter the duration rides on
  // The two patched opcodes.
  let toggle1 = EOR, toggle2 = EOR;
  // The two patched compare operands.
  let v1period = 0, v2period = 0;
  // The registers, which carry from note to note.
  let A = 0, X = 0, Y = 0;
  // The three-deep stack the player pushes A, X and Y onto.
  const stack = [];

  /** `$032D` - fetch the next byte, and decide whether its voice sounds or rests. */
  function fetchVoice() {
    tick(6);                                      // JSR
    tick(2);                                      // LDX #$49
    let x = EOR;
    tick(2); Y = (Y + 1) & 0xFF;                  // INY
    tick(5); A = t[ptr + Y] ?? 0;                 // LDA ($1E),Y
    tick(2);                                      // BNE
    if (A === 0) { tick(2); x = CMP; }            // LDX #$C9
    else tick(1);                                 // the branch was taken
    tick(6);                                      // RTS
    return x;
  }

  // ---- $0300, the entry ----
  tick(2); A = 1;                                 // LDA #$01
  tick(3); shift1 = 1;                            // STA $09
  tick(3); shift2 = 1;                            // STA $1D
  tick(3); stack.push(A);                         // PHA
  tick(3); stack.push(A);                         // PHA
  tick(3); stack.push(A);                         // PHA
  tick(3);                                        // BNE $0320, taken

  let ended = 'budget';
  try {
  decode: for (;;) {
    if (cycles > budget) { ended = 'budget'; break; }

    // ---- $0320, read the record ----
    tick(2); Y = 0;                               // LDY #$00
    tick(5); A = t[ptr] ?? 0;                     // LDA ($1E),Y
    tick(2);                                      // CMP #$01
    if (A === 1) {
      // ---- $030B, a control record ----
      tick(3);                                    // BEQ taken
      tick(2); Y = (Y + 1) & 0xFF;
      tick(5); shift1 = t[ptr + Y] ?? 0;
      tick(3);
      tick(2); Y = (Y + 1) & 0xFF;
      tick(5); shift2 = t[ptr + Y] ?? 0;
      tick(3);
      tick(3); tick(2); tick(2); tick(3);         // LDA $1E / CLC / ADC #$03 / STA $1E
      ptr += 3;
      tick(3);                                    // BCC $0320 (or INC $1F)
      continue;
    }
    tick(2);                                      // BEQ not taken
    if (A === 0) {
      // ---- $032A, the end ----
      tick(2);                                    // BCS not taken
      tick(4); tick(4); tick(4);                  // PLA x3
      tick(2); tick(2); tick(5); tick(2); tick(6);
      ended = 'tune';
      break;
    }
    tick(3);                                      // BCS $0337, taken

    // ---- $0337, a note ----
    tick(3); duration = A;                        // STA $08
    toggle1 = fetchVoice();                       // JSR $032D
    tick(4);                                      // STX $0383
    tick(3); v1reload = A;                        // STA $06
    tick(3); X = shift1;                          // LDX $09
    for (;;) {                                    // LSR A / DEX / BNE
      tick(2); A >>= 1;
      tick(2); X = (X - 1) & 0xFF;
      tick(X === 0 ? 2 : 3);
      if (X === 0) break;
    }
    tick(4); v1period = A;                        // STA $037C
    toggle2 = fetchVoice();                       // JSR $032D
    tick(4);                                      // STX $03BB
    tick(3); v2reload = A;                        // STA $07
    tick(3); X = shift2;                          // LDX $1D
    for (;;) {
      tick(2); A >>= 1;
      tick(2); X = (X - 1) & 0xFF;
      tick(X === 0 ? 2 : 3);
      if (X === 0) break;
    }
    tick(4); v2period = A;                        // STA $03B4

    tick(4); Y = stack.pop() ?? 0; tick(2);       // PLA / TAY
    tick(4); X = stack.pop() ?? 0; tick(2);       // PLA / TAX
    tick(4); A = stack.pop() ?? 0;                // PLA

    // ---- the inner loop ----
    //
    // **It has three entry points and only one of them is the top.** The loop comes back
    // from `$03BD BVS $0362` or `$03C0 BVC $0365`, both of which land *below* the
    // `BNE $0365` at `$0360` - so that test runs once, on the way in from the PLA, and
    // never again. Treating `$0360` as the top of the loop cost three cycles an iteration
    // and put the very first toggle three cycles late, which is what parity_music.mjs
    // reported before this comment existed.
    let entry = 0x0360;
    for (;;) {
      if (cycles > budget) { ended = 'budget'; break decode; }

      if (entry === 0x0360) {
        // $0360 BNE $0365 - when A is zero, fall into the speaker touch below it.
        if (A !== 0) tick(3);
        else { tick(2); tick(4); speaker(); }     // $0362 BIT $C030
      } else if (entry === 0x0362) {
        tick(4); speaker();                       // $0362 BIT $C030
      }

      tick(2);                                    // $0365 CMP #$00
      const negative = (A & 0x80) !== 0;
      if (negative) {
        tick(3);                                  // $0367 BMI $036C taken
        tick(4); speaker();                       // $036C BIT $C030
      } else {
        tick(2);                                  // BMI not taken
        tick(2);                                  // $0369 NOP
        tick(3);                                  // $036A BPL $036F taken
      }

      tick(3); state = A;                         // $036F STA $4E
      tick(4);                                    // $0371 BIT $C000
      if (keyAt !== null && cycles >= keyAt) {
        tick(3); tick(6);                         // BMI to the RTS
        ended = 'key';
        break decode;
      }
      tick(2);                                    // BMI not taken

      // Voice 1: count Y down, reload and flip when it reaches the period.
      tick(2); Y = (Y - 1) & 0xFF;                // $0376 DEY
      let reach1 = true;                          // does control reach $0383?
      if (Y !== 0) {
        tick(3);                                  // $0377 BNE $037B taken
        tick(2);                                  // $037B CPY #period
        if (Y === v1period) {
          tick(3);                                // $037D BEQ $0383 taken
        } else {
          tick(2);                                // BEQ not taken
          tick(3);                                // $037F BNE $0385 taken
          reach1 = false;                         // and that one jumps over $0383
        }
      } else {
        tick(2);                                  // BNE not taken
        tick(3);                                  // $0379 BEQ $0381 taken
        tick(3); Y = v1reload;                    // $0381 LDY $06, then falls through
      }
      // $0383 - EOR #$40 when the voice sounds, CMP #$40 when it rests. Whether it runs at
      // all is a matter of which branch was taken, not of what Y now holds.
      if (reach1) {
        tick(2);
        if (toggle1 === EOR) A ^= 0x40;
      }

      tick(3);                                    // $0385 BIT $4E
      // BIT sets V from bit 6 and N from bit 7 of the byte tested.
      const v = (state & 0x40) !== 0;
      const n = (state & 0x80) !== 0;
      // The four-way branch tree at $0387-$0394, every path padded to the same cost.
      let touch = false;
      if (!v) {
        tick(3);                                  // $0387 BVC $0390 taken
        tick(2);                                  // $0390 NOP
        if (n) { tick(3); touch = true; }         // $0391 BMI $0396
        else { tick(2); tick(2); tick(3); }       // NOP / BPL $0399
      } else {
        tick(2);                                  // BVC not taken
        tick(3);                                  // $0389 BVS $038B taken
        if (!n) { tick(3); touch = true; }        // $038B BPL $0396
        else { tick(2); tick(2); tick(3); }       // NOP / BMI $0399
      }
      if (touch) { tick(4); speaker(); }          // $0396 CMP $C030

      tick(5); sub = (sub - 1) & 0xFF;            // $0399 DEC $4F
      if (sub !== 0) {
        tick(3);                                  // $039B BNE $03AE taken
      } else {
        tick(2);
        tick(5); duration = (duration - 1) & 0xFF;  // $039D DEC $08
        if (duration !== 0) {
          tick(3);                                // $039F BNE $03AE taken
        } else {
          tick(2);
          // $03A1 BVC $03A6, and $03A3 BIT $C030 on the other path.
          if (!v) tick(3);
          else { tick(2); tick(4); speaker(); }
          tick(3); stack.push(A);                 // PHA
          tick(2); tick(3); stack.push(X);        // TXA / PHA
          tick(2); tick(3); stack.push(Y);        // TYA / PHA
          tick(3);                                // JMP $0315
          // $0315 advances the pointer by three and goes back to $0320.
          tick(3); tick(2); tick(2); tick(3);
          ptr += 3;
          tick(3);
          continue decode;
        }
      }

      // Voice 2: the same, on X.
      tick(2); X = (X - 1) & 0xFF;                // $03AE DEX
      let reach2 = true;
      if (X !== 0) {
        tick(3);                                  // $03AF BNE $03B3 taken
        tick(2);                                  // $03B3 CPX #period
        if (X === v2period) tick(3);              // $03B5 BEQ $03BB taken
        else { tick(2); tick(3); reach2 = false; } // $03B7 BNE $03BD, over $03BB
      } else {
        tick(2);
        tick(3);                                  // $03B1 BEQ $03B9 taken
        tick(3); X = v2reload;                    // $03B9 LDX $07
      }
      if (reach2) {
        tick(2);                                  // $03BB EOR #$80 or CMP #$80
        if (toggle2 === EOR) A ^= 0x80;
      }

      // $03BD BVS $0362 / $03BF NOP / $03C0 BVC $0365 - and which one decides where the
      // next iteration starts, which is the whole reason `entry` exists.
      if (v) { tick(3); entry = 0x0362; }
      else { tick(2); tick(2); tick(3); entry = 0x0365; }
    }
  }

  } catch (e) {
    if (e !== Stop) throw e;
    ended = 'toggles';
  }

  return { cycles, toggles, ended };
}
