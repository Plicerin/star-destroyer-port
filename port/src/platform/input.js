// Whatever the host has, turned into what PREAD would have returned.
//
// The game reads three things and nothing else: paddle 0 for steering, paddle 1 for the
// throttle, and button 0 for the trigger. `controls.js` takes the paddle byte rather than a
// stick position on purpose - "PREAD's timing loop is not modelled here, so a caller that
// wants to drive this from a real analogue axis has to produce the reading itself" - and this
// is that caller.
//
// **Any mapping here is a substitution.** The original is a 150kΩ paddle; a keyboard is not
// one, and no amount of care makes it one. So the two sources are kept apart and named:
//
//   keyboard   a key is held or it is not, so the reading is one of three values - hard left,
//              centre, hard right. The turn rate is three units a frame regardless of how far
//              a paddle is over (`controls.js`, TURN_RATE), so for steering this loses
//              **nothing at all**: the dead zone is 100-154 and anything outside it turns at
//              the same rate. It is only the throttle where a paddle had travel this does not.
//   analogue   a pointer across the window, or a gamepad axis, scaled to 0-255. Closer to the
//              hardware, and off by default because it is the Phase 7 switch, not the
//              baseline.
//
// The pause is a key, as the loop has it: `$1929` sees a pending key, clears the strobe, then
// spins until another. Press to pause, press to resume - so the shell holds the loop rather
// than passing anything through.
import { DEAD_ZONE } from '../game/controls.js';
import { WARP_THRESHOLD } from '../game/flight.js';

/** The three readings a held key produces. The centre is the middle of the dead zone. */
export const LEFT = 0x00;
export const CENTRE = (DEAD_ZONE[0] + DEAD_ZONE[1]) >> 1;      // 127, comfortably inside
export const RIGHT = 0xFF;

/** Paddle 1 open and shut. Warp engages below $5A, so anything at or above it is off. */
export const THROTTLE_ON = 0x00;
export const THROTTLE_OFF = 0xFF;

/** The keys, by what they do. Several each, because nobody agrees about arrows. */
export const KEYS = {
  left: ['ArrowLeft', 'KeyA', 'KeyJ'],
  right: ['ArrowRight', 'KeyD', 'KeyL'],
  warp: ['ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight'],
  fire: ['Space', 'KeyF', 'Enter'],
  pause: ['KeyP', 'Escape'],
};

export class Input {
  /**
   * @param {EventTarget} target usually `window`
   * @param {object} [opts] `analogue` to steer from a pointer or a gamepad axis instead of
   *   the keyboard - off by default, see above
   */
  constructor(target = window, { analogue = false } = {}) {
    this.target = target;
    this.analogue = analogue;
    this.held = new Set();
    /** 0 to 1 across the window, or null when the pointer has not been over it. */
    this.pointer = null;
    /** Set by a pause key and cleared by the shell when it has acted on it. */
    this.pausePressed = false;
    this.onKeyDown = (e) => {
      if (Object.values(KEYS).some((ks) => ks.includes(e.code))) e.preventDefault();
      if (KEYS.pause.includes(e.code) && !this.held.has(e.code)) this.pausePressed = true;
      this.held.add(e.code);
    };
    this.onKeyUp = (e) => this.held.delete(e.code);
    this.onBlur = () => this.held.clear();
    /**
     * The box the pointer is measured against, cached.
     *
     * `getBoundingClientRect` forces the browser to lay the document out, and this runs on
     * every `pointermove` - a stream of them while the mouse is moving, each one landing on a
     * layout the canvas has just dirtied by repainting. Measured: 500 moves cost 4.6ms against
     * a clean layout and **34.8ms against a dirty one**, which is what the page always has.
     * So it is read once and kept until something can have changed it.
     */
    this.rect = null;
    this.onMeasure = () => { this.rect = null; };
    this.onPointerMove = (e) => {
      const el = e.currentTarget === window ? document.documentElement : e.currentTarget;
      if (!this.rect) {
        this.rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      }
      const r = this.rect;
      this.pointer = r && r.width > 0
        ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        : null;
    };
    this.onPointerDown = () => this.held.add('PointerButton');
    this.onPointerUp = () => this.held.delete('PointerButton');
  }

  attach() {
    // The cached rect is only good until the page moves or changes size.
    this.rect = null;
    this.target.addEventListener('resize', this.onMeasure);
    this.target.addEventListener('scroll', this.onMeasure, true);
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
    this.target.addEventListener('pointermove', this.onPointerMove);
    this.target.addEventListener('pointerdown', this.onPointerDown);
    this.target.addEventListener('pointerup', this.onPointerUp);
    return this;
  }

  detach() {
    this.target.removeEventListener('resize', this.onMeasure);
    this.target.removeEventListener('scroll', this.onMeasure, true);
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointerup', this.onPointerUp);
  }

  down(which) {
    return KEYS[which].some((k) => this.held.has(k));
  }

  /** The first gamepad's left stick X, or null. */
  gamepadX() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.axes && pad.axes.length) return pad.axes[0];
    }
    return null;
  }

  /** The first gamepad's button 0, or false. */
  gamepadFire() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.buttons && pad.buttons.length) return !!pad.buttons[0].pressed;
    }
    return false;
  }

  /**
   * What to hand `Game.pass`.
   *
   * @returns {{paddle0: number, paddle1: number, button0: boolean}}
   */
  read() {
    let paddle0 = CENTRE;
    if (this.analogue) {
      const axis = this.gamepadX();
      const pos = axis !== null && Math.abs(axis) > 0.08 ? (axis + 1) / 2 : this.pointer;
      if (pos !== null && pos !== undefined) paddle0 = Math.round(pos * 255) & 0xFF;
    }
    // The keyboard overrides, so a held key still works with analogue on.
    if (this.down('left')) paddle0 = LEFT;
    else if (this.down('right')) paddle0 = RIGHT;

    return {
      paddle0,
      paddle1: this.down('warp') ? THROTTLE_ON : THROTTLE_OFF,
      button0: this.down('fire') || this.held.has('PointerButton') || this.gamepadFire(),
    };
  }

  /** True once per press, and clears itself. */
  takePause() {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }
}

/** For a caption in the shell, so the mapping is on screen rather than in this file. */
export const HELP = [
  ['← →', 'turn'],
  ['↑ or Shift', 'warp'],
  ['Space', 'fire'],
  ['P', 'pause'],
];

/** The threshold the throttle is compared against, re-exported so the shell can show it. */
export { WARP_THRESHOLD };
