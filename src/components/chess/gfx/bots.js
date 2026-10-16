import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { clamp, damp } from './ease.js';
import {
  BOT_INK,
  GROW_SMALL,
  INK,
  MONO,
  SANS,
  cardMetrics,
  createCard,
  createPrintLayer,
  drawRuns,
  drawRunsRight,
  faceCamera,
  runsWidth,
  setCardFade,
} from './instruments.js';

/**
 * The opponents, lined up behind Black.
 *
 * The chapter's third beat is about what the product hands you *besides*
 * analysis — bots to play, and room to configure them — and that is a claim about
 * who is on the other side of the board. So it is answered on the other side of
 * the board: five plaques standing behind Black's back rank, each naming an
 * opponent, its rating and what kind of thing it is.
 *
 * A lineup rather than one opponent, and ordered by rating from left to right,
 * because the point is the *range*: a human-like bot at club strength and a top
 * engine are both here, and the row is readable as a ladder without anything
 * having to say so. That is also why each plaque carries a segmented strength
 * meter rather than a continuous bar — blocks say "this many steps stronger",
 * where a bar only says "somewhat stronger".
 *
 * Standing above the trend ribbon rather than beside it, which is what keeps this
 * from being a fifth instrument competing with the four. They are further back
 * than any card and higher than all of them, so from the elevations the chapter
 * uses they read as a row of opponents behind the position rather than as more
 * readouts around it — and the ribbon at board level in front of them is never
 * occluded.
 *
 * Built from the same card kit as the instruments (see instruments.js) so the rig
 * stays one family. Nothing here is interactive or focusable: the whole scene is
 * an aria-hidden canvas behind the chapter's copy, and the copy makes the claim
 * in words.
 */

/**
 * Who is on the other side, ascending by strength.
 *
 * Real names, because a lineup of invented ones would be making a weaker claim
 * than the copy does — "powerful bots" means the engines a player has heard of.
 * The ratings are the commonly cited strengths of each rather than any one
 * rating list's current figure, and `role` is the distinction that actually
 * matters when choosing an opponent: what kind of player it is, not how strong.
 */
const BOTS = [
  { name: 'Maia', rating: 1900, role: 'human-like', strength: 0.44 },
  { name: 'Chessee', rating: 2450, role: 'coach', strength: 0.62 },
  { name: 'Komodo', rating: 3400, role: 'engine', strength: 0.88 },
  { name: 'Leela', rating: 3500, role: 'neural', strength: 0.94 },
  { name: 'Stockfish', rating: 3600, role: 'engine', strength: 1 },
];

/**
 * Metrics. Wide and low, because every plaque carries two rows that run across
 * it — a name against a rating, a role against a state — and the strength meter
 * runs across it too. A tall plaque would have to stack those, and a stack of
 * five stacked plaques is a wall.
 *
 * The well works out at about 0.15 high, which is the point: on the instruments a
 * well is a track you read a value off, and here it is a meter you glance at. Any
 * taller and the plaque starts claiming to be a gauge.
 */
const METRICS = cardMetrics({
  w: 1.34,
  h: 0.9,
  headPx: { w: 512, h: 224 },
  headW: 1.24,
  wellW: 1.24,
  top: 0.07,
  gap: 0.055,
  foot: 0.085,
  wellR: 0.022,
});

/**
 * Radius of the arc the row stands on, the angle between plaques, and how high off
 * the board.
 *
 * The step is wider than the plaques need in world space, and it has to be. Every
 * plaque yaws to face the camera, so from the flat elevation this row is framed at
 * their faces are nearly edge-on to the arc and their *projected* widths run well
 * past their footprints — at a step that merely cleared 1.34 units the outer two
 * overlapped their neighbours on screen while the arithmetic said they did not.
 */
const ARC_RADIUS = 7.5;
const ARC_STEP = 0.28;
/* Low enough to read as standing behind the position rather than floating over it,
   high enough to clear the trend panel that stands in front of them (its card tops
   out around 1.95). */
const ROW_Y = 2.25;

/** How long each plaque's arrival trails the one before it, as a share of the fade. */
const STAGGER = 0.13;

const BOT_DECLARES = /* glsl */ `
  uniform float uStrength;
  uniform float uThink;
  uniform float uTime;
  uniform vec3  uBlock;
  uniform vec3  uLead;
`;

const BOT_WELL = /* glsl */ `
  vec3 wellContent(vec2 p, vec3 base) {
    float span = uWellHi.x - uWellLo.x;
    float edge = mix(uWellLo.x, uWellHi.x, uStrength);

    /* Lifted off the recess, so an unfilled meter reads as an empty meter rather
       than as a slot with nothing drawn in it. */
    vec3 col = lay(base, uBlock, 0.13);

    /* Blocks, placed in world units and softened by one pixel — not by a
       fraction of a block, which goes sub-pixel as the plaque foreshortens and
       breaks the row into moire. Dissolved into a flat wash at that point for the
       same reason the depth gauge dissolves its ladder. */
    float pitch = span / 17.0;
    float into = mod(p.x - uWellLo.x, pitch);
    float block = within(into - pitch * 0.62);
    block = mix(block, 0.6, smoothstep(0.2, 0.58, aa / pitch));

    /* Inset top and bottom so a block is a block rather than a full-height
       column, which at this well height would close the meter into a solid bar. */
    float inset = (uWellHi.y - uWellLo.y) * 0.16;
    float within_y =
      smoothstep(uWellLo.y + inset - aa, uWellLo.y + inset + aa, p.y) *
      smoothstep(uWellHi.y - inset + aa, uWellHi.y - inset - aa, p.y);

    float lit = under(p.x, edge);
    col = lay(col, mix(uBlock, uLead, lit), block * within_y * mix(0.42, 1.0, lit));

    /* The search sweep, and the one thing on the plaque that moves. Drawn only
       across the blocks this bot has already lit and only while it is the one
       thinking, so a row of five is never five things animating at once — which
       is movement everywhere and information nowhere. */
    float u = (p.x - uWellLo.x) / span;
    float travel = fract(u - uTime * 0.34);
    col = lay(col, uLead, exp(-pow((travel - 0.5) * 5.5, 2.0)) * lit * uThink * 0.55);

    /* The well is sunk; a trace of its shadow gathers under the top edge. */
    col *= 1.0 - exp(-max(0.0, uWellHi.y - p.y) * 34.0) * 0.3;

    return col;
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    return base;
  }
`;

/** Margins and the gutter a paired row keeps between its two halves. */
const ROW_INSET = 0.055;
const ROW_GUTTER = 0.05;

/**
 * A row with something flush left and something flush right, where the left side
 * gives way if the two do not fit.
 *
 * Necessary rather than defensive: these plaques carry real names and real
 * ratings, and the widest pair on the row ("STOCKFISH" against "3600") overruns a
 * plaque this size by a comfortable margin — the two collided into
 * "STOCKFIS3600". Which side yields is the decision worth recording. The rating is
 * four monospaced digits, so shrinking it makes a number harder to read to save a
 * word; the name is a word, and a word set two points smaller is still the same
 * word. So the right side is drawn at its stated size and the left is fitted to
 * whatever is left over.
 *
 * @param {object} row `{ left, right }`, each `{ text, size, weight, face, fill, tracking }`
 */
function pairRow(ctx, px, baseline, { left, right }) {
  const runOf = (spec, size) => ({
    text: spec.text,
    font: `${spec.weight} ${size}px ${spec.face}`,
    fill: spec.fill,
    tracking: spec.tracking ?? 0,
    grow: GROW_SMALL,
  });

  const x0 = px.w * ROW_INSET;
  const x1 = px.w * (1 - ROW_INSET);

  const rightRun = runOf(right, right.size);
  const room = x1 - x0 - runsWidth(ctx, [rightRun]) - px.w * ROW_GUTTER;

  let size = left.size;
  const measured = runsWidth(ctx, [runOf(left, size)]);
  if (measured > room && room > 0) size = Math.floor((size * room) / measured);

  drawRuns(ctx, [runOf(left, size)], x0, baseline);
  drawRunsRight(ctx, [rightRun], x1, baseline);
}

/** One plaque: a card plus the two rows printed on its face. */
function createPlaque(bot, index) {
  const angle = (index - (BOTS.length - 1) / 2) * ARC_STEP;

  const card = createCard({
    name: `bot-${bot.name.toLowerCase()}`,
    metrics: METRICS,
    /* On an arc centred on the board rather than in a straight line: every plaque
       yaws to face the camera, so a straight row puts the outer two at a visibly
       greater distance and the lineup reads as a perspective accident. On the arc
       they are all the same size in frame. */
    position: [
      Math.sin(angle) * ARC_RADIUS,
      ROW_Y,
      -Math.cos(angle) * ARC_RADIUS,
    ],
    declares: BOT_DECLARES,
    wellSource: BOT_WELL,
    uniforms: {
      uStrength: { value: bot.strength },
      uThink: { value: 0 },
      uTime: { value: 0 },
      uBlock: { value: new THREE.Color(PALETTE.eloRung) },
      uLead: { value: new THREE.Color(PALETTE.accent) },
    },
  });

  /* Written by `paint`, read by nothing else. The state is a string rather than a
     flag because it is printed, and redrawing is gated on it changing — a canvas
     upload per frame for five plaques is five uploads per frame for a word that
     changes twice a game. */
  const state = { label: 'READY', ink: BOT_INK.idle };

  const head = createPrintLayer({
    px: METRICS.headPx,
    w: METRICS.headW,
    h: METRICS.headH,
    y: METRICS.headCy,
    paint: (ctx, px) => {
      ctx.textBaseline = 'alphabetic';
      /* Row one: who it is, and how strong. The name is set in the amber the
         predicted arcs over the board are drawn in, because a bot and the line it
         is calculating are the same voice; the rating is ink, because it is a
         measurement.

         Row two: what kind of player it is, and what it is doing. */
      pairRow(ctx, px, px.h * (78 / 224), {
        left: {
          text: bot.name.toUpperCase(),
          size: px.h * (56 / 224),
          weight: 700,
          face: SANS,
          fill: BOT_INK.tag,
          tracking: px.w * (4 / 512),
        },
        right: {
          text: String(bot.rating),
          size: px.h * (58 / 224),
          weight: 700,
          face: MONO,
          fill: INK.value,
        },
      });

      pairRow(ctx, px, px.h * (150 / 224), {
        left: {
          text: bot.role.toUpperCase(),
          size: px.h * (34 / 224),
          weight: 600,
          face: MONO,
          fill: INK.caption,
          tracking: px.w * (5 / 512),
        },
        right: {
          text: state.label,
          size: px.h * (34 / 224),
          weight: 600,
          face: MONO,
          fill: state.ink,
          tracking: px.w * (5 / 512),
        },
      });
    },
  });

  card.face.add(head.mesh);

  return { bot, card, head, state, think: 0, thinkTarget: 0 };
}

export class BotRoster {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'bots';

    this.plaques = BOTS.map((bot, i) => createPlaque(bot, i));
    for (const plaque of this.plaques) this.group.add(plaque.card.group);

    this.fade = 0;
    this.time = 0;
    this.active = -1;

    this.setFade(0);
  }

  /**
   * How present the row is, 0-1.
   *
   * Staggered left to right rather than fading as one block, so the lineup
   * arrives as a lineup — five plaques appearing at once reads as a panel being
   * switched on. Each plaque's own share of the ramp is offset by its index and
   * then stretched back over the remaining travel, which is what keeps the last
   * one arriving exactly at 1 instead of never quite getting there.
   */
  setFade(fade) {
    this.fade = clamp(Number.isFinite(fade) ? fade : 0);
    const span = 1 - STAGGER * (this.plaques.length - 1);
    this.plaques.forEach((plaque, i) => {
      const local = clamp((this.fade - STAGGER * i) / span);
      setCardFade(plaque.card, local);
      /* Rises the last fraction of a unit into place as it arrives. Small: the
         plaques are the furthest thing in the shot, and travel that reads as
         movement at this distance is travel that would be a lurch up close. */
      plaque.card.group.position.y = ROW_Y - (1 - local) * 0.45;
    });
    this.group.visible = this.fade > 0.002;
  }

  /**
   * Which opponent is thinking, or -1 for none. One at a time by construction:
   * five meters sweeping together is an idle animation, one sweeping is a claim.
   */
  setActive(index) {
    if (this.active === index) return;
    this.active = index;
    this.plaques.forEach((plaque, i) => {
      const on = i === index;
      plaque.thinkTarget = on ? 1 : 0;
      const label = on ? 'THINKING' : 'READY';
      const ink = on ? BOT_INK.thinking : BOT_INK.idle;
      if (plaque.state.label === label && plaque.state.ink === ink) return;
      plaque.state.label = label;
      plaque.state.ink = ink;
      plaque.head.redraw();
    });
  }

  /** Rotates which opponent is thinking. Called once per move by the director. */
  cycleActive() {
    this.setActive((this.active + 1) % this.plaques.length);
  }

  update(dt, camera) {
    if (!this.group.visible) return;
    this.time += dt;

    for (const plaque of this.plaques) {
      plaque.think = damp(plaque.think, plaque.thinkTarget, 5, dt);
      const u = plaque.card.material.uniforms;
      u.uThink.value = plaque.think;
      u.uTime.value = this.time;
      faceCamera(plaque.card.group, plaque.card.face, camera);
    }
  }

  dispose() {
    for (const plaque of this.plaques) {
      plaque.head.dispose();
      plaque.card.material.dispose();
      plaque.card.group.traverse((child) => child.geometry?.dispose?.());
    }
    this.plaques.length = 0;
  }
}

export { BOTS };
