// The soft switches, and what is actually on the screen because of them.
//
// The Apple II has no display mode setting. It has eight addresses that do something when you
// touch them, and the game touches them by POKEing -16304 and friends. Every presentation
// program on the disk opens the same way:
//
//     POKE -16304,0   $C050  graphics, not text
//     POKE -16303,0   $C051  text
//     POKE -16302,0   $C052  full screen, no text window
//     POKE -16301,0   $C053  mixed - four lines of text under the graphics
//     POKE -16300,0   $C054  page 1
//     POKE -16299,0   $C055  page 2
//     POKE -16298,0   $C056  lo-res
//     POKE -16297,0   $C057  hi-res
//
// So `MONOLITH` line 10 - `POKE -16304,0: POKE -16297,0: POKE -16302,0: POKE -16300,0` - is
// "graphics, hi-res, full screen, page 1", and that is the whole of how a picture gets shown.
// The pictures are BLOADed to `$2000` or `$4000`, which are the two pages, and the switch
// chooses which one the player is looking at.
//
// **The game writes these through POKE, so this watches the addresses rather than offering an
// API.** `Display.poke` is wired to the Applesoft host's POKE and to nothing else, which means
// a program that flips a switch some way this file did not anticipate still works, because
// there is only one way to flip one.

export const SOFT = {
  GRAPHICS: 0xC050,
  TEXT: 0xC051,
  FULL: 0xC052,
  MIXED: 0xC053,
  PAGE1: 0xC054,
  PAGE2: 0xC055,
  LORES: 0xC056,
  HIRES: 0xC057,
};

/** The four lines of text a mixed screen shows under the graphics. */
export const MIXED_ROWS = 4;

export class Display {
  constructor() {
    /** Text or graphics. The machine starts in text. */
    this.text = true;
    /** Hi-res or lo-res. Only hi-res is used by this disk. */
    this.hires = false;
    /** Mixed puts four rows of text at the bottom. */
    this.mixed = false;
    /** 0 or 1 - $2000 or $4000 for hi-res, $400 or $800 for text. */
    this.page = 0;
    /** Bumped whenever anything changes, so a renderer can tell. */
    this.generation = 0;
  }

  /** Touching the address is the whole operation; the value POKEd is ignored, as on the machine. */
  touch(addr) {
    const before = `${this.text}${this.hires}${this.mixed}${this.page}`;
    switch (addr) {
      case SOFT.GRAPHICS: this.text = false; break;
      case SOFT.TEXT: this.text = true; break;
      case SOFT.FULL: this.mixed = false; break;
      case SOFT.MIXED: this.mixed = true; break;
      case SOFT.PAGE1: this.page = 0; break;
      case SOFT.PAGE2: this.page = 1; break;
      case SOFT.LORES: this.hires = false; break;
      case SOFT.HIRES: this.hires = true; break;
      default: return false;
    }
    if (`${this.text}${this.hires}${this.mixed}${this.page}` !== before) this.generation++;
    return true;
  }

  /** True if this address is one of the eight. */
  static isSwitch(addr) {
    return addr >= SOFT.GRAPHICS && addr <= SOFT.HIRES;
  }

  /** Where the hi-res page being displayed lives. */
  get hiresBase() { return this.page === 0 ? 0x2000 : 0x4000; }

  /** Where the text page being displayed lives. */
  get textBase() { return this.page === 0 ? 0x400 : 0x800; }

  /** What a renderer needs to know, in one object. */
  get state() {
    return {
      text: this.text,
      hires: this.hires,
      mixed: this.mixed,
      page: this.page,
      textRows: this.text ? 24 : (this.mixed ? MIXED_ROWS : 0),
      graphicsRows: this.text ? 0 : (this.mixed ? 160 : 192),
    };
  }

  toString() {
    return this.text ? `text page ${this.page + 1}`
      : `${this.hires ? 'hires' : 'lores'} page ${this.page + 1}`
        + (this.mixed ? ' mixed' : ' full');
  }
}
