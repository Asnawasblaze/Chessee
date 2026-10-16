/**
 * Single source of truth for colours, shared by the 3D scene and the DOM HUD so
 * the overlay and the render never drift apart.
 */
export const PALETTE = {
  background: 0x05070d,
  ambient: 0x33507a,

  cyan: 0x4fd7ff,
  teal: 0x2ee6c0,
  amber: 0xffb45c,
  rose: 0xff5d7e,

  // Four tones on one ramp, spaced so that either piece colour reads against
  // either square colour: light square, dark square, and the two piece sets
  // sitting outside that range at both ends. Get this wrong and the board stops
  // being a chessboard — which is what happened when the tiles were dark enough
  // that the black pieces vanished into them.
  tileLight: 0xa9b9cd,
  tileDark: 0x3c4859,

  pieceWhite: 0xe8eef7,
  pieceBlack: 0x171d26,

  // Semantic colours for the analysis overlay.
  origin: 0x4fd7ff,
  destination: 0x2ee6c0,
  capture: 0xff5d7e,
  candidate: 0x7d6cff,
  check: 0xffb45c,

  // Forecasting. `tactic` marks a predicted winning sequence and `forecast` the
  // opponent's predicted answer. Both are deliberately outside the cyan/teal
  // range used for moves that are actually happening, so a prediction never
  // reads as a move already on the board.
  tactic: 0xffb45c,
  forecast: 0x8f9dff,

  /* The landing page's own accent, and the reason it is in here rather than
     being passed in: this scene is a layer in the Why chapter, and every rule,
     caret and rail dot on that stage is drawn in #9bd8ed. The instruments'
     needles and the ELO gauge's fill read as part of the page instead of as a
     demo dropped into it. */
  accent: 0x9bd8ed,

  /* The ladder the ELO gauge is drawn on. `rung` is the unreached part of the
     climb, `climb` the reached part, `crown` the grandmaster band at the top —
     warm, because it is the one thing on the gauge that is an achievement
     rather than a measurement. */
  eloRung: 0x3d5a72,
  eloClimb: 0x7fd3ef,
  eloCrown: 0xffd79a,
};
