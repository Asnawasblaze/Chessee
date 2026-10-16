import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { clamp, damp } from './ease.js';
import {
  GROW_LARGE,
  GROW_SMALL,
  INK,
  MONO,
  SANS,
  armGrow,
  cardMetrics,
  createCard,
  createPrintLayer,
  faceCamera,
  fillTracked,
  footprintOf,
  setCardFade,
  stamp,
} from './instruments.js';

/**
 * The rating gauge — the one instrument on the board that is not about the
 * position.
 *
 * The other four report on a game: how good it is, how deep the search went,
 * what the line is, where it is heading. This one reports on the *player*, which
 * is the chapter's closing argument ("so you become a stronger chess player")
 * and therefore the one thing the camera ends on. It is deliberately the
 * smallest and quietest card in the rig for the three beats before that, because
 * a claim about where the reader ends up should not be shouting during the part
 * where the problem is still being stated.
 *
 * Built out of the same card kit as the four instruments rather than as its own
 * thing (see instruments.js). That matters more here than anywhere else on the
 * board: this is the card the camera flies to and fills the frame with, so any
 * difference in corner radius, housing gradient, hairline weight or type
 * treatment would be magnified rather than glossed over. It is not a new
 * instrument, it is the fifth one.
 *
 * Not interactive, and nothing on it is focusable — the whole scene is one
 * `aria-hidden` canvas behind the chapter's copy. What the reader gets instead
 * is the copy, which says the same thing in words.
 */

/* ── The scale ───────────────────────────────────────────────────────────────
 * The bar's own range, which is wider at both ends than the climb it shows. A
 * gauge whose minimum is the starting value reads as already begun, and one
 * whose maximum is the destination reads as finished the moment it arrives —
 * headroom at the top is what makes the last band an achievement rather than the
 * end of the track.
 */
const ELO_MIN = 600;
const ELO_MAX = 2600;

/**
 * The bands, by the rating each one opens at. Five, because five is what a
 * vec4's worth of internal boundaries buys and because these are the divisions a
 * player actually recognises — the numbers are the common club/federation
 * reading of them rather than any one organisation's table.
 */
const TIERS = [
  { at: 600, name: 'Beginner' },
  { at: 1200, name: 'Intermediate' },
  { at: 1700, name: 'Advanced' },
  { at: 2100, name: 'Master' },
  { at: 2400, name: 'Grandmaster' },
];

/** Where a rating sits on the track, 0-1. */
const ratingToFill = (rating) => {
  const value = Number.isFinite(rating) ? rating : ELO_MIN;
  return clamp((value - ELO_MIN) / (ELO_MAX - ELO_MIN));
};

/** The band a rating falls in. Never returns undefined: TIERS[0] opens at the floor. */
const tierFor = (rating) => {
  let found = TIERS[0];
  for (const tier of TIERS) if (rating >= tier.at) found = tier;
  return found;
};

/**
 * Metrics. Narrow and a little shorter than the side gauges, which is the whole
 * of its restraint: at the portrait card's 1.12 × 3.02 it read as a fifth equal
 * instrument, and the composition already has four of those.
 *
 * `foot` is three times the kit's default because the band's name is printed
 * below the track rather than beside it. Beside it would need the card to be
 * half again as wide, and a wide card here is one that has to be framed rather
 * than tucked into a corner.
 *
 * The printed face carries more pixels than any other card in the rig (640 wide
 * against the portrait cards' 512) for one reason: this is the only card the
 * camera ever fills the frame with, so it is the only one whose artwork is ever
 * *magnified* rather than minified, and a magnified 512 shows its own texels.
 */
const METRICS = cardMetrics({
  w: 0.94,
  h: 2.18,
  headPx: { w: 640, h: 376 },
  headW: 0.84,
  wellW: 0.42,
  top: 0.075,
  gap: 0.09,
  foot: 0.3,
  wellR: 0.026,
});

/** Artwork for the band strip under the track. */
const TIER_PX = { w: 512, h: 132 };
const TIER_W = 0.86;

const ELO_DECLARES = /* glsl */ `
  uniform float uProgress;
  uniform vec4  uTiers;
  uniform float uCrownAt;
  uniform vec3  uRung;
  uniform vec3  uClimb;
  uniform vec3  uCrown;
  uniform vec3  uIndex;
  uniform float uPulse;
`;

const ELO_WELL = /* glsl */ `
  /* A band boundary: a hairline across the full width of the track. Full width
     on purpose, unlike the evaluation bar's ticks, which bite in from the edges
     — a tick is a measurement on a continuous scale, a boundary is a division
     into named parts, and drawing them the same way would say the wrong thing. */
  float boundary(vec2 p, float v) {
    return hair(p.y, wellY(v), 0.0075);
  }

  float boundaries(vec2 p) {
    float m = boundary(p, uTiers.x);
    m = max(m, boundary(p, uTiers.y));
    m = max(m, boundary(p, uTiers.z));
    m = max(m, boundary(p, uTiers.w));
    return m;
  }

  vec3 wellContent(vec2 p, vec3 base) {
    float v = wellV(p.y);
    float top = wellY(uProgress);

    /* The unreached climb. Lifted off the recess rather than left black, for the
       same reason the trend ribbon's empty half is: an empty track reads as a
       fault, a lit one reads as a track with nothing on it yet. */
    vec3 col = lay(base, uRung, 0.14);

    /* The top band, drawn faintly from the first frame. This is the one piece of
       the gauge that is doing rhetoric rather than reporting: the reader can see
       where the bar is going before it goes there, so the climb has somewhere to
       arrive instead of simply stopping. */
    col = lay(col, uCrown, smoothstep(uCrownAt - 0.05, uCrownAt + 0.02, v) * 0.17);

    /* A fine ladder over the whole track, so the travel is read against a scale
       rather than against its own previous length. Dissolved into a flat wash
       once a rung goes near a pixel — the same concession the depth gauge makes,
       and for the same reason: a sub-pixel ladder is moire, not a ladder. */
    float pitch = (uWellHi.y - uWellLo.y) / 32.0;
    float into = mod(p.y - uWellLo.y, pitch);
    float ladder = within(into - pitch * 0.36);
    ladder = mix(ladder, 0.4, smoothstep(0.24, 0.62, aa / pitch));
    float inset = uWellHi.x * 0.42;
    col = lay(col, uRung, ladder * smoothstep(uWellHi.x - inset + aa, uWellHi.x - inset - aa, abs(p.x)) * 0.44);

    /* The climb, warming as it rises: it starts in the page's own cool accent and
       arrives in the crown's amber. That gradient is what makes the top of the
       bar read as a destination rather than as more of the same colour — and it
       is keyed to height rather than to progress, so the tone at any point on the
       bar is a property of the rating it stands for and does not change as the
       bar grows past it. */
    float filled = under(p.y, top);
    vec3 climb = mix(uClimb * 0.6, uCrown, smoothstep(0.34, 1.0, v));
    col = mix(col, climb * (0.7 + 0.42 * v), filled);

    /* Boundaries over the fill as well as under it, in ink that flips with
       whichever side it lands on — the reader has to be able to see which band
       the rating is standing in, not only how tall the bar is. */
    vec3 ink = mix(vec3(0.52, 0.6, 0.72), vec3(0.05, 0.07, 0.1), filled);
    col = lay(col, ink, boundaries(p) * 0.72);

    /* The well is sunk, so its shadow carries across the top of the fill. */
    col *= 1.0 - exp(-max(0.0, uWellHi.y - p.y) * 14.0) * 0.34;

    return col;
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    float y = wellY(uProgress);
    float across = smoothstep(uWellHi.x + aa, uWellHi.x - aa, abs(p.x));

    float seat = hair(p.y, y, 0.024) * across;
    float line = hair(p.y, y, 0.011) * across;

    /* Triangular index in the housing margin either side, tip on the track.
       Lifted wholesale from the evaluation bar: a reader who has just learned to
       find the score on one gauge should not have to learn a second gauge to read
       their own rating off this one. */
    float outward = abs(p.x) - (uWellHi.x + 0.010);
    float tri = within(max(abs(p.y - y) - outward * 0.6, outward - 0.062));

    base = lay(base, vec3(0.01, 0.014, 0.022), max(seat - line, 0.0) * 0.5);
    /* Flares while the rating is actually moving and settles when it stops, which
       makes the index the one mark on the card that is reacting to the climb
       rather than reporting it. */
    return lay(base, uIndex, max(line, tri) * (0.76 + 0.24 * uPulse));
  }
`;

export class EloGauge {
  /**
   * @param {object} [opts]
   * @param {number[]} [opts.position] where the card stands, in world space
   */
  constructor({ position = [5.35, 0, 2.35] } = {}) {
    this.fill = 0;
    this.targetFill = 0;
    this.rating = ELO_MIN;
    this.pulse = 0;
    /** The band currently printed, so the strip redraws only on a change. */
    this.printedTier = null;

    const bounds = TIERS.slice(1).map((tier) => ratingToFill(tier.at));

    const card = createCard({
      name: 'elo-gauge',
      metrics: METRICS,
      position,
      caption: 'RATING',
      initial: String(ELO_MIN),
      declares: ELO_DECLARES,
      wellSource: ELO_WELL,
      uniforms: {
        uProgress: { value: 0 },
        uTiers: {
          value: new THREE.Vector4(bounds[0], bounds[1], bounds[2], bounds[3]),
        },
        uCrownAt: { value: ratingToFill(TIERS[TIERS.length - 1].at) },
        uRung: { value: new THREE.Color(PALETTE.eloRung) },
        uClimb: { value: new THREE.Color(PALETTE.eloClimb) },
        uCrown: { value: new THREE.Color(PALETTE.eloCrown) },
        uIndex: { value: new THREE.Color(PALETTE.accent) },
        uPulse: { value: 0 },
      },
    });

    this.group = card.group;
    this.face = card.face;
    this.mesh = card.mesh;
    this.material = card.material;
    this.readout = card.readout;
    this.footprint = footprintOf(METRICS);

    /* The band's name, printed below the track rather than in the readout window
       above it. Two readings, two places: the window answers "what is the
       number" and the strip answers "what is the number worth", and stacking
       both in one window would make the card look like it had one value in two
       formats. */
    this.strip = createPrintLayer({
      px: TIER_PX,
      w: TIER_W,
      h: (TIER_W * TIER_PX.h) / TIER_PX.w,
      y: (METRICS.wellLo[1] - METRICS.h / 2) / 2,
      paint: (ctx, px) => this.#paintTier(ctx, px),
    });
    this.face.add(this.strip.mesh);

    this.set(ELO_MIN);
  }

  #paintTier(ctx, px) {
    const tier = this.printedTier ?? TIERS[0];
    const crowned = tier === TIERS[TIERS.length - 1];

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* The top band is the only one printed warm, and it is the only one that
       needs to be: every band below it is a waypoint and this one is the point.
       Held under the bloom threshold like every other mark in the rig. */
    ctx.fillStyle = crowned ? '#ffd79a' : INK.caption;
    /* Fitted, not trusted to fit: "Grandmaster" is nearly three times the width
       of "Master", and a band name that overflows its own strip is worse than a
       smaller one. */
    const size = px.h * (58 / 132);
    ctx.font = `600 ${size}px ${SANS}`;
    const tracking = px.w * (11 / 512);
    const maxWidth = px.w * 0.92;
    const text = tier.name.toUpperCase();
    const measured =
      ctx.measureText(text).width + tracking * Math.max(0, text.length - 1);
    if (measured > maxWidth) {
      ctx.font = `600 ${Math.floor((size * maxWidth) / measured)}px ${SANS}`;
    }
    fillTracked(ctx, text, px.w / 2, px.h * 0.42, tracking, GROW_SMALL);

    /* The range, small and dim underneath. Without it the strip is a label with
       no scale behind it — "MASTER" says nothing about how far there is left to
       go, and how far there is left to go is what the last beat is about. */
    ctx.fillStyle = INK.caption;
    ctx.font = `500 ${px.h * (30 / 132)}px ${MONO}`;
    ctx.globalAlpha = 0.62;
    const range = `${ELO_MIN}\u2013${ELO_MAX}`;
    stamp(
      ctx,
      range,
      px.w / 2,
      px.h * 0.8,
      armGrow(ctx, ctx.font, INK.caption, GROW_SMALL)
    );
    ctx.globalAlpha = 1;
  }

  /**
   * @param {number} rating the rating to show, in Elo
   */
  set(rating) {
    const value = Number.isFinite(rating) ? rating : ELO_MIN;
    this.rating = value;
    this.targetFill = ratingToFill(value);

    /* Rounded to ten. The climb runs 1700 points over a beat and a half, so an
       unrounded readout is a units digit spinning too fast to read — which reads
       as a slot machine rather than as progress. Tens still change often enough
       to look live. */
    const shown = Math.round(value / 10) * 10;
    const tier = tierFor(value);
    /* Both tones stated. `setText`'s colour argument defaults to whatever is
       currently drawn, so passing it only on the way up would leave the readout
       amber for the rest of the session once the climb had touched the top band —
       including after the reader scrubbed back to the start. */
    this.readout.setText(
      String(shown),
      tier === TIERS[TIERS.length - 1] ? '#ffd79a' : INK.value
    );

    if (tier !== this.printedTier) {
      this.printedTier = tier;
      this.strip.redraw();
    }
  }

  /** How present the card is, 0-1. */
  setFade(fade) {
    setCardFade(this, fade);
  }

  update(dt, camera) {
    const before = this.fill;
    this.fill = damp(this.fill, this.targetFill, 6, dt);
    this.material.uniforms.uProgress.value = this.fill;

    /* Read off the bar's own movement rather than tracked as its own state, so
       the index cannot be left flaring at a rating that has stopped climbing —
       including when the reader scrubs backwards, which is a case no separate
       "is it animating" flag would get right. */
    const moving = clamp((Math.abs(this.fill - before) / Math.max(dt, 1e-4)) * 3.4);
    this.pulse = damp(this.pulse, moving, 7, dt);
    this.material.uniforms.uPulse.value = this.pulse;

    faceCamera(this.group, this.face, camera);
  }

  dispose() {
    this.strip.dispose();
    this.readout.dispose();
    this.material.dispose();
    this.group.traverse((child) => child.geometry?.dispose?.());
  }
}

export { ELO_MIN, ELO_MAX, TIERS as ELO_TIERS };
