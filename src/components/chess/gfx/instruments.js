import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { clamp, damp } from './ease.js';
import { evalToFill } from '../logic/game.js';

/* ── Provenance ─────────────────────────────────────────────────────────────
 * Ported from the standalone prototype in animations/src/gfx/instruments.js and
 * kept deliberately close to it, so the two can still be diffed. Three changes,
 * all additive, all for the landing page:
 *
 *   - the card machinery below (cardMetrics, createCard, createPrintLayer, the
 *     type helpers, the chrome and ink tables) is exported rather than private,
 *     because the page adds two more instruments of its own — the rating gauge
 *     and the opponent roster, in eloGauge.js and bots.js — and a second copy of
 *     this file's metrics would be a second card family;
 *   - `uFade` and `setCardFade`, because on the page the instruments arrive on
 *     the beat that talks about them instead of standing there throughout;
 *   - nothing else. Every shader, tone and comment below is the prototype's.
 */

/**
 * The four instruments standing around the board: evaluation and search depth
 * on the left and right, the win/draw/loss forecast behind Black and the
 * predicted line in front of White.
 *
 * Every one of them is one flat card. That is the whole design principle here,
 * and it is a correction: the first version of the two side gauges stacked a lit
 * housing box, a track plane, seven tick planes, a level line, a needle and two
 * sprites at slightly different depths, then tipped the stack toward the camera.
 * Any depth offset under a tipped, perspective-projected panel parallaxes, so
 * the housing slid visibly off the bar and the whole thing read as a misprint
 * rather than an instrument. Sprites made it worse, because a sprite always
 * faces the camera squarely and therefore slides against the panel it is meant
 * to be printed on.
 *
 * So: everything except the glyphs is drawn analytically into a single plane's
 * fragment shader, and the glyphs live on planes in that same plane. Nothing can
 * drift out of register with anything else, because there is nothing to drift.
 * Every edge is anti-aliased against a screen-space pixel measured in card
 * units, which is what keeps a hairline a hairline whether the card fills the
 * frame or sits thirty units away.
 *
 * The two wide cards replaced DOM panels in the corners of the overlay. They did
 * not just move: a flat SVG chart redrawn once per move, on impact, cannot say
 * anything between moves, so the trend read as a fixed picture of a game that
 * was plainly still being played. Here both cards carry continuous state — a
 * cursor that travels, a runner that slides along the line, a forecast that
 * reaches ahead of the position — and all of it is damped from the same values
 * the board is animating from.
 *
 * Both wide cards are the *bot's* panels, and they say so. That is a correction
 * too. They had always been readouts from the thing doing the analysis rather
 * than properties of the position, but nothing printed on them said whose read
 * they were, so a viewer had no reason to connect the line on the card to the
 * phantom pieces gliding over the board. Each now prints three rows — whose
 * panel it is, what it currently reads, and what the bot is doing with it — and
 * the strip names the side it is calculating for. The depth gauge takes the same
 * treatment, because the sweep across the predicted line is driven off the very
 * ramp that gauge is showing.
 *
 * A note on legibility, since a good many constants here are now set by it. A
 * card's printed face is around a thousand pixels wide and lands on screen in two
 * to four hundred, so every glyph is resolved out of a blend of two mip levels,
 * and light type on a dark recess loses stroke weight in that blend. Three things
 * follow. Glyphs are stroked in their own fill colour before being filled, which
 * puts the lost weight back — see `GROW_SMALL`. Marks are kept clear of the
 * recess by a wide margin, because contrast survives minification where fine
 * detail does not. And nothing is drawn above 0.85 luminance, because that is
 * where bloom starts and a haloed glyph does not read as a bright glyph, it reads
 * as an out-of-focus one — which was the worst offender on the predicted line,
 * where the step being played was the only step on the card wearing a halo.
 */

const _worldPos = new THREE.Vector3();
const _lampTarget = new THREE.Color();

export const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* ------------------------------------------------------------ card geometry */

/** Corner radius, shared by every card so they read as one family. */
const CARD_R = 0.075;

/**
 * Derives a card's full metric set, in world units measured from the card's
 * centre, from the handful of numbers worth stating.
 *
 * Everything relational is computed rather than written down, because the
 * relationships are what break first: the readout plane's aspect has to match
 * its canvas or the glyphs stretch, and the well has to start below the head
 * window or the two overlap. Both used to be hand-maintained.
 *
 * @param {number} w      card width
 * @param {number} h      card height
 * @param {object} headPx artwork resolution of the printed face
 * @param {number} headW  width of the printed face
 * @param {number} wellW  width of the sunk track
 */
export function cardMetrics({ w, h, headPx, headW, wellW, top = 0.085, gap = 0.105, foot = 0.09, wellR = 0.032 }) {
  const headH = (headW * headPx.h) / headPx.w;
  const headCy = h / 2 - top - headH / 2;
  return {
    w,
    h,
    r: CARD_R,
    /** Card centre height, so the bottom edge stands just clear of the board. */
    y: h / 2 + 0.05,
    headPx,
    headW,
    headH,
    headCy,
    headLo: [-headW / 2 - 0.02, headCy - headH / 2 - 0.014],
    headHi: [headW / 2 + 0.02, headCy + headH / 2 + 0.014],
    wellLo: [-wellW / 2, -h / 2 + foot],
    wellHi: [wellW / 2, headCy - headH / 2 - gap],
    wellR,
  };
}

/**
 * The side gauges. The proportions matter more than the numbers: a gauge much
 * narrower than this reads as a stray sliver floating in the dark, and one much
 * taller pushes its readout out of the top of the frame at the shot list's
 * closer radii — which is exactly what used to happen.
 */
export const PORTRAIT = cardMetrics({
  w: 1.12,
  h: 3.02,
  headPx: { w: 512, h: 300 },
  headW: 1.0,
  wellW: 0.6,
});

/**
 * The end panels. Wide because both of them carry something that runs along an
 * axis — a game's worth of forecast, a line's worth of moves — and a tall narrow
 * card would have to shrink either one to the point of illegibility. Kept low
 * enough that they stand under the sight line to the board from every framing in
 * the shot list but the flattest.
 */
export const WIDE = cardMetrics({
  w: 3.06,
  h: 1.9,
  // Taller head than the other cards need, because both wide panels now print
  // three rows: what the panel is, what it currently says, and what the bot is
  // doing with it. Two rows crammed into the old 190 forced the caption down to
  // a size that did not survive the trip through the texture's mip chain.
  headPx: { w: 1024, h: 230 },
  headW: 2.86,
  wellW: 2.86,
  gap: 0.075,
});

/**
 * How far each kind of card stands from the board centre. The board frame ends
 * at 4.62.
 *
 * The end panels stand further out than the side gauges, and that is not for
 * symmetry's sake but for sight lines: a card 3.06 wide is nearly three times
 * the footprint of a gauge, and at the flattest angle the director uses — the
 * finale, which drops to phi 1.0 and pulls in — an end panel at the gauges'
 * offset rose above the line of sight to the near rank and cut the first two
 * ranks off. Half a unit further out clears it.
 */
export const GAUGE_OFFSET = 5.15;
export const PANEL_OFFSET = 5.7;

/**
 * How far out the end panels stand, by frame shape.
 *
 * A narrow frame can have them closer, and wants them closer: the panels are
 * what a portrait viewport runs out of width for first, and the reason they were
 * pushed out — clearing the sight line to the near rank at flat angles — does
 * not apply there, because a portrait frame is already held above `phi` 0.6 to
 * stop the board foreshortening into a strip. From that far overhead a panel at
 * either distance is well under the line of sight.
 */
export const PANEL_STANDOFF = { wide: PANEL_OFFSET, narrow: GAUGE_OFFSET };

/**
 * What the camera needs to know to frame a card: how far it reaches either side
 * of where it stands, and how high it reaches.
 *
 * Both matter separately, and neither is the card's distance from the board.
 * Every card yaws to face the camera, so its width always runs across the frame
 * while its stand-off only counts when the camera is looking along the other
 * axis; and its height counts because a camera looking down at the board is
 * nearer a card's top corner than it is to the board itself.
 */
export function footprintOf(metrics) {
  return { halfWidth: metrics.w / 2, topY: metrics.y + metrics.h / 2 };
}

/**
 * Housing tones. These are written straight to the framebuffer in linear space:
 * the scene renders through a composer, so three.js leaves tone mapping to the
 * output pass and a value here is the value the grade receives. They are picked
 * to land just under the bloom threshold, so a card is a solid object in the
 * shot rather than another source of light.
 */
export const CHROME = {
  frame: 0x222d3c,
  frameLit: 0x39485e,
  edge: 0xa8c0d8,
  // Darker than it was. The recess is the ground every mark on a card is read
  // against, so every stop it drops is a stop of contrast gained by the marks
  // for free, and unlike brightening the marks it cannot run into the bloom.
  recess: 0x080d15,
};

/**
 * Print tones.
 *
 * These are ceilinged, not chosen freely. Bloom triggers on luminance above
 * 0.85 in the linear buffer the cards are drawn into, and a glyph that crosses
 * it gets a halo — which reads as the text being out of focus, not as the text
 * being bright. `value` at #e7eff8 lands at about 0.80 linear, which is as far
 * as a mark on a card can be pushed and stay a mark.
 */
export const INK = {
  caption: '#a3b6cd',
  value: '#e7eff8',
  valueDim: '#b3c5da',
};

/**
 * The tones the two wide panels use to say they belong to the bot rather than
 * to the position. Amber is the same voice the predicted arcs over the board
 * are drawn in, so a caption and the line it describes are keyed alike.
 *
 * All four are luminance-checked against the bloom threshold: a saturated
 * amber can hold a channel at 1.0 and still sit at 0.65 luminance, which is
 * why these can be this warm without haloing.
 */
export const BOT_INK = {
  tag: '#ffc98a',
  thinking: '#ffcf95',
  playing: '#9fe0f7',
  idle: '#8fa4bd',
};

/**
 * The draw share, and the tone the faint furniture in a well is drawn in. The
 * draw band has to sit clear of both piece colours at once, because it is
 * sandwiched between them.
 *
 * Both are lifted from where they were. The grid was drawn so faintly that the
 * empty part of the ribbon read as a fault rather than as ruled paper, and the
 * draw band was close enough to the black share that a drawish position and a
 * lost one looked the same at a glance.
 */
const TREND = {
  draw: 0x76899f,
  grid: 0x5c7089,
};

/** How much of the camera's elevation a card tips to meet. */
const PITCH_FOLLOW = 0.45;

/**
 * Aims a card at the camera.
 *
 * `mount` yaws about world Y so the card is never seen edge-on. `face` then
 * pitches to meet part of the camera's elevation — only part, because a fully
 * billboarded card stops reading as an object standing beside the board, while
 * an unpitched one is badly foreshortened from the high angles the director
 * favours and the scale becomes impossible to read off.
 *
 * The parent's own yaw is subtracted because `world` carries a small parallax
 * rotation that would otherwise leak in.
 */
export function faceCamera(mount, face, camera) {
  if (!camera) return;
  mount.getWorldPosition(_worldPos);
  const dx = camera.position.x - _worldPos.x;
  const dy = camera.position.y - _worldPos.y;
  const dz = camera.position.z - _worldPos.z;

  const parentYaw = mount.parent?.rotation.y ?? 0;
  mount.rotation.y = Math.atan2(dx, dz) - parentYaw;
  face.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz)) * PITCH_FOLLOW;
}

/* ------------------------------------------------------------------- glyphs */

/**
 * How much of its own size a glyph is stroked by, on top of being filled.
 *
 * A card's artwork is minified on its way to the screen — the printed face is
 * around a thousand pixels wide and lands in two to four hundred — so every
 * glyph is resolved out of a blend of two mip levels. Light type on a dark
 * recess loses stroke weight doing that: the dark ground bleeds inward and thin
 * stems go grey and indistinct, which is exactly what "blurry" looks like.
 *
 * Stroking the outline in the *same colour as the fill* puts the lost weight
 * back before the minification happens, so what arrives on screen is a stem of
 * roughly the intended thickness rather than a ghost of one. Small type needs
 * proportionally more of it than large type, because it has proportionally less
 * to lose.
 */
export const GROW_SMALL = 0.06;
export const GROW_LARGE = 0.028;

/** The pixel size out of a CSS font shorthand, for scaling the stroke to it. */
function fontPx(font) {
  return Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '0');
}

/**
 * Arms the context to draw thickened glyphs in `fill`, and reports whether
 * `stamp` should stroke at all.
 */
export function armGrow(ctx, font, fill, grow) {
  if (!grow) return false;
  ctx.strokeStyle = fill;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = fontPx(font) * grow;
  return ctx.lineWidth > 0;
}

/** Stroke-then-fill, so the thickening sits under the glyph rather than over it. */
export function stamp(ctx, text, x, y, stroking) {
  if (stroking) ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/** Draws `text` centred on `cx` with `tracking` extra units between letters. */
export function fillTracked(ctx, text, cx, y, tracking, grow = GROW_SMALL) {
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);

  const stroking = armGrow(ctx, ctx.font, ctx.fillStyle, grow);
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  chars.forEach((char, i) => {
    stamp(ctx, char, x, y, stroking);
    x += widths[i] + tracking;
  });
  ctx.textAlign = align;
}

/**
 * A row of differently-styled fragments — `{ text, font, fill, tracking, gap }`
 * — laid out left to right. Measuring and drawing share one implementation so a
 * right-aligned row cannot end up a few pixels off its own measurement, which is
 * how a legend starts clipping its last percentage.
 */
function runWidth(ctx, run) {
  ctx.font = run.font;
  const chars = [...run.text];
  const tracking = run.tracking ?? 0;
  return (
    chars.reduce((total, char) => total + ctx.measureText(char).width, 0) +
    tracking * Math.max(0, chars.length - 1)
  );
}

export function runsWidth(ctx, runs) {
  return runs.reduce((total, run) => total + (run.gap ?? 0) + runWidth(ctx, run), 0);
}

export function drawRuns(ctx, runs, x, y) {
  ctx.textAlign = 'left';
  let cursor = x;
  for (const run of runs) {
    cursor += run.gap ?? 0;
    ctx.font = run.font;
    ctx.fillStyle = run.fill;
    // Measurement is deliberately taken from the fill alone, not the stroke:
    // the thickening adds half a line width at each end, and a row that
    // measured its own strokes would drift away from the grid the swatches and
    // columns are placed on for the sake of a fraction of a pixel.
    const stroking = armGrow(ctx, run.font, run.fill, run.grow ?? GROW_SMALL);
    const tracking = run.tracking ?? 0;
    const chars = [...run.text];
    for (const char of chars) {
      stamp(ctx, char, cursor, y, stroking);
      cursor += ctx.measureText(char).width + tracking;
    }
    // Only paid once per gap, not once per character, so a tracked run measures
    // the same width it draws.
    if (chars.length) cursor -= tracking;
  }
  return cursor;
}

/** Draws a row of runs with its right edge on `x`. */
export function drawRunsRight(ctx, runs, x, y) {
  return drawRuns(ctx, runs, x - runsWidth(ctx, runs), y);
}

/**
 * A canvas hung in the card's own plane, so it shares the card's foreshortening
 * and reads as printed on it.
 *
 * `z` is a hair in front of the card. Enough to settle the depth test, far too
 * little to parallax: at this separation the offset is a fraction of a pixel
 * even at the steepest angle a card is ever tipped to.
 */
export function createPrintLayer({ px, w, h, x = 0, y = 0, order = 3, paint }) {
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps stay on — a card is tipped and yawed every frame, and without them
  // the type crawls — but the anisotropic sample count is taken as high as the
  // spec allows, because that is what pulls the resolved glyph back toward the
  // sharper of the two mip levels it is blended from.
  texture.anisotropy = 16;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, 0.0022);
  mesh.renderOrder = order;

  let disposed = false;
  const redraw = () => {
    if (disposed) return;
    ctx.clearRect(0, 0, px.w, px.h);
    paint(ctx, px);
    texture.needsUpdate = true;
  };

  redraw();

  // Canvas text bakes whatever font was resolved at draw time. Without this the
  // cards keep the fallback metrics for the life of the page whenever the web
  // fonts land after first paint.
  document.fonts?.ready?.then(redraw).catch(() => {});

  return {
    mesh,
    material,
    redraw,
    dispose() {
      disposed = true;
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** Canvas pixel coordinates -> card-space coordinates on a card's printed face. */
export function headPoint(metrics, px, py) {
  return [
    -metrics.headW / 2 + (metrics.headW * px) / metrics.headPx.w,
    metrics.headCy + metrics.headH * (0.5 - py / metrics.headPx.h),
  ];
}

/**
 * The printed face of a side gauge: a caption and a value.
 *
 * The value is fitted to the window rather than trusted to fit. Scores here run
 * from `#` to `+12.00`, a three-fold range in width, and a readout that
 * overflows its own housing is worse than a smaller one.
 *
 * Type sizes are fractions of the artwork rather than pixel counts, so the
 * layout survives a change of resolution.
 */
function createReadout(metrics, caption, initial) {
  let currentText = initial;
  let currentColor = INK.value;

  const layer = createPrintLayer({
    px: metrics.headPx,
    w: metrics.headW,
    h: metrics.headH,
    y: metrics.headCy,
    paint: (ctx, px) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = INK.caption;
      ctx.font = `600 ${px.h * (50 / 300)}px ${SANS}`;
      fillTracked(ctx, caption, px.w / 2, px.h * (92 / 300), px.w * (13 / 512));

      // Fit, then draw. Two passes on a canvas this small costs nothing and it
      // is the only thing standing between "+12.00" and a clipped readout.
      const maxWidth = px.w - px.w * (82 / 512);
      const size = px.h * (118 / 300);
      ctx.font = `700 ${size}px ${MONO}`;
      const measured = ctx.measureText(currentText).width;
      if (measured > maxWidth) ctx.font = `700 ${Math.floor((size * maxWidth) / measured)}px ${MONO}`;

      ctx.textBaseline = 'middle';
      ctx.fillStyle = currentColor;
      const stroking = armGrow(ctx, ctx.font, currentColor, GROW_LARGE);
      stamp(ctx, currentText, px.w / 2, px.h * (206 / 300), stroking);
    },
  });

  return {
    mesh: layer.mesh,
    /** What is currently drawn. Readable so the value can be asserted on. */
    get text() {
      return currentText;
    },
    /** Redraws only when something actually changed. */
    setText(value, color = currentColor) {
      if (value === currentText && color === currentColor) return;
      currentText = value;
      currentColor = color;
      layer.redraw();
    },
    dispose: layer.dispose,
  };
}

/* -------------------------------------------------------------- card shader */

const CARD_VERTEX = /* glsl */ `
  uniform vec2 uCard;
  varying vec2 vP;

  void main() {
    vP = (uv - 0.5) * uCard;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Shared chrome: signed-distance helpers plus the declarations every card
 * needs. `aa` is one screen pixel expressed in card units and every edge in
 * every card shader is softened by exactly that, which is the whole reason the
 * marks stay crisp at any distance instead of dissolving into gradients.
 */
const CARD_COMMON = /* glsl */ `
  varying vec2 vP;

  uniform vec2  uCard;
  uniform float uCardR;
  uniform vec2  uWellLo;
  uniform vec2  uWellHi;
  uniform float uWellR;
  uniform vec2  uHeadLo;
  uniform vec2  uHeadHi;
  uniform vec3  uFrame;
  uniform vec3  uFrameLit;
  uniform vec3  uEdge;
  uniform vec3  uRecess;
  uniform float uFade;

  float aa;

  float sdBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  float sdRect(vec2 p, vec2 lo, vec2 hi, float r) {
    return sdBox(p - (lo + hi) * 0.5, (hi - lo) * 0.5, r);
  }

  /* 1 inside the shape, 0 outside, one pixel of transition. */
  float within(float d) { return smoothstep(aa, -aa, d); }

  /* A band of width w lying just inside the shape's edge. */
  float rim(float d, float w) { return within(d) - within(d + w); }

  /* A line of total width 2*hw centred on at, along one axis. */
  float hair(float coord, float at, float hw) {
    return smoothstep(hw + aa, hw - aa, abs(coord - at));
  }

  /* 1 where coord falls under at. */
  float under(float coord, float at) { return smoothstep(at + aa, at - aa, coord); }

  vec3 lay(vec3 base, vec3 c, float a) { return mix(base, c, clamp(a, 0.0, 1.0)); }

  float wellV(float y) { return (y - uWellLo.y) / (uWellHi.y - uWellLo.y); }
  float wellY(float v) { return mix(uWellLo.y, uWellHi.y, v); }

  /* Supplied by each card. */
  vec3 wellContent(vec2 p, vec3 base);
  vec3 cardOverlay(vec2 p, vec3 base);
`;

const CARD_MAIN = /* glsl */ `
  void main() {
    // Derivatives first, before any discard, so the pixel size stays defined
    // for the fragments along the card's rounded edge.
    vec2 ddx = dFdx(vP);
    vec2 ddy = dFdy(vP);
    aa = clamp(0.62 * sqrt(max(dot(ddx, ddx), dot(ddy, ddy))), 0.0006, 0.05);

    float dCard = sdRect(vP, -uCard * 0.5, uCard * 0.5, uCardR);
    float card = within(dCard) * uFade;
    if (card < 0.002) discard;

    // A shallow gradient reads as a machined face catching the key light. A
    // flat fill reads as a sticker.
    float h = clamp(vP.y / uCard.y + 0.5, 0.0, 1.0);
    vec3 col = mix(uFrame, uFrameLit, 0.12 + h * h * 0.78);

    // Bright hairline around the card with a dark one just inside it. The pair
    // is what separates the panel from the void behind it; without them the
    // readout floats in the dark and the gauge stops reading as an object.
    col = lay(col, uEdge, rim(dCard, 0.010) * 0.5);
    col = lay(col, uRecess, rim(dCard + 0.010, 0.013) * 0.55);

    // Readout window, sunk so the value sits in a display rather than on bare
    // metal.
    float dHead = sdRect(vP, uHeadLo, uHeadHi, 0.028);
    col = lay(col, uRecess, within(dHead) * 0.92);
    col = lay(col, uEdge, rim(dHead, 0.007) * 0.2);

    // Track well, with the shadow gathering under its top edge.
    float dWell = sdRect(vP, uWellLo, uWellHi, uWellR);
    vec3 recess = mix(uRecess, uRecess * 0.3, exp(-max(0.0, uWellHi.y - vP.y) * 12.0));
    col = lay(col, wellContent(vP, recess), within(dWell));
    col = lay(col, uRecess * 0.35, rim(dWell, 0.009) * 0.85);
    col = lay(col, uEdge, rim(dWell + 0.009, 0.006) * 0.22);

    col = cardOverlay(vP, col);

    gl_FragColor = vec4(col, card);
  }
`;

/** Uniforms describing the card itself. One fresh set per instrument. */
export function chromeUniforms(m) {
  return {
    uCard: { value: new THREE.Vector2(m.w, m.h) },
    uCardR: { value: m.r },
    uWellLo: { value: new THREE.Vector2(m.wellLo[0], m.wellLo[1]) },
    uWellHi: { value: new THREE.Vector2(m.wellHi[0], m.wellHi[1]) },
    uWellR: { value: m.wellR },
    uHeadLo: { value: new THREE.Vector2(m.headLo[0], m.headLo[1]) },
    uHeadHi: { value: new THREE.Vector2(m.headHi[0], m.headHi[1]) },
    uFrame: { value: new THREE.Color(CHROME.frame) },
    uFrameLit: { value: new THREE.Color(CHROME.frameLit) },
    uEdge: { value: new THREE.Color(CHROME.edge) },
    uRecess: { value: new THREE.Color(CHROME.recess) },
    /* How present the card is, 0-1, and the only channel on it the page owns.
       Added for the landing page, where the instruments are not standing around
       the board the whole time: they arrive on the beat that talks about them
       and leave with it, driven from scroll position.

       On the card's alpha rather than on its colours, because these are objects
       and an object that dims to black is still occluding the board behind it.
       The glyph planes are faded alongside it by `setCardFade` — they are the
       one thing on a card that is not drawn by this shader. */
    uFade: { value: 1 },
  };
}

/**
 * Sets how present a card is, 0-1. Fades the housing (a shader uniform) and the
 * glyph planes printed on it (plain material opacity) together, so a card is
 * never caught as floating type over an absent panel.
 *
 * `opacity` is free to own on the print layers: the only channel any of them
 * animates for itself is `color` (see LineStrip's cell ramp), and none of them
 * is ever drawn at anything but full opacity otherwise.
 *
 * Hidden outright once it is fully faded, so a card that is not in the shot
 * costs no draw call rather than a transparent one — these are sorted, blended
 * and double-sided, which is the expensive kind of invisible.
 *
 * @param {{group: THREE.Object3D, face: THREE.Object3D, material: THREE.ShaderMaterial}} card
 * @param {number} fade
 */
export function setCardFade(card, fade) {
  const value = clamp(Number.isFinite(fade) ? fade : 0);
  const u = card.material?.uniforms?.uFade;
  if (u) u.value = value;
  card.face?.traverse((child) => {
    const material = child.material;
    if (material && material.isMeshBasicMaterial) material.opacity = value;
  });
  card.group.visible = value > 0.002;
}

/**
 * Builds one instrument card.
 * @param {string} name        group name
 * @param {object} metrics     PORTRAIT or WIDE
 * @param {number[]} position  where the card stands, in world space
 * @param {string} [caption]   printed above the value; omit to print nothing
 * @param {string} [initial]   value shown before the first update
 * @param {string} declares    GLSL declarations for the card's own uniforms
 * @param {string} wellSource  GLSL defining wellContent and cardOverlay
 * @param {object} uniforms    those uniforms
 */
export function createCard({ name, metrics, position, caption, initial = '', declares, wellSource, uniforms }) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(position[0], position[1], position[2]);

  const face = new THREE.Group();
  face.position.y = metrics.y;
  group.add(face);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...chromeUniforms(metrics), ...uniforms },
    vertexShader: CARD_VERTEX,
    fragmentShader: CARD_COMMON + declares + wellSource + CARD_MAIN,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(metrics.w, metrics.h), material);
  mesh.renderOrder = 2;
  face.add(mesh);

  const readout = caption ? createReadout(metrics, caption, initial) : null;
  if (readout) face.add(readout.mesh);

  return { group, face, mesh, material, readout };
}

/* ------------------------------------------------------------------ eval bar */

/** Scale marks, in pawns. Symmetric, so only the positive side is listed. */
const TICK_SCORES = [1, 3, 5];

const EVAL_DECLARES = /* glsl */ `
  uniform float uFill;
  uniform vec3  uWhite;
  uniform vec3  uBlack;
  uniform vec3  uTickV;
  uniform vec3  uNeedle;
`;

const EVAL_WELL = /* glsl */ `
  /* One scale notch, biting in from both edges of the track. Symmetric on
     purpose: a mark that only reaches in from one side reads as a scratch on
     the fill rather than as part of a scale. */
  float notch(vec2 p, float v, float len) {
    float from = uWellHi.x - len;
    return hair(p.y, wellY(v), 0.013) * smoothstep(from - aa, from + aa, abs(p.x));
  }

  float scaleMarks(vec2 p) {
    // Short. At two thirds of the half-width they closed to within a sliver of
    // each other and read as full-width rules, which left the level line with
    // nothing to distinguish it from the rest of the scale.
    float len = uWellHi.x * 0.38;
    float m = notch(p, uTickV.x, len);
    m = max(m, notch(p, 1.0 - uTickV.x, len));
    m = max(m, notch(p, uTickV.y, len));
    m = max(m, notch(p, 1.0 - uTickV.y, len));
    m = max(m, notch(p, uTickV.z, len));
    m = max(m, notch(p, 1.0 - uTickV.z, len));
    return m;
  }

  vec3 wellContent(vec2 p, vec3 base) {
    float v = wellV(p.y);
    float boundary = wellY(uFill);

    // White's share fills from the bottom, Black's from the top, and the
    // boundary is the score. One pixel wide at any distance, so the reading
    // stays exact instead of turning into a gradient you have to guess at.
    float above = smoothstep(boundary - aa, boundary + aa, p.y);

    // A little shading across each share so they read as material rather than
    // flat paint. Both are pulled well off the piece colours they are keyed to:
    // at full strength the white share is the brightest thing in the frame and
    // reads as a sheet of paper, while the black share is dark enough to pass
    // for a hole cut in the card. What matters is that each is recognisably its
    // side's tone, not that it matches exactly.
    // The black share has to sit clear of two things at once: the near-black
    // recess below it and the housing beside it. Landing on the housing's tone,
    // which it did, loses the top edge of the track altogether.
    vec3 white = uWhite * (0.6 + 0.13 * v);
    vec3 black = uBlack * (1.1 + 1.5 * v) + vec3(0.014, 0.02, 0.036);
    vec3 col = mix(white, black, above);

    // The well is sunk, so a trace of its shadow carries across the top of the
    // fill. Without it the fill reads as pasted onto the card rather than
    // sitting down inside it.
    col *= 1.0 - exp(-max(0.0, uWellHi.y - p.y) * 14.0) * 0.4;

    // Ink that flips with whichever share it lands on, so no mark is ever
    // drawn in a tone close to its own background.
    vec3 ink = mix(vec3(0.055, 0.075, 0.105), vec3(0.42, 0.5, 0.62), above);

    // Scale marks are placed by running the real scores through the same
    // mapping the fill uses, so a mark standing for +3 sits exactly where the
    // bar puts +3 and the two cannot drift apart.
    col = lay(col, ink, scaleMarks(p) * 0.75);

    // Level. The one reference point the eye should find without looking for
    // it, so it is the only mark that crosses the full width of the track.
    col = lay(col, ink, hair(p.y, wellY(0.5), 0.016) * 0.9);

    return col;
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    float y = wellY(uFill);
    float across = smoothstep(uWellHi.x + aa, uWellHi.x - aa, abs(p.x));

    // A dark seat under the index line, so it holds its shape against the pale
    // share as clearly as against the dark one.
    float seat = hair(p.y, y, 0.028) * across;
    float line = hair(p.y, y, 0.015) * across;

    // Triangular index in the housing margin either side, tip on the track.
    // A pointer stops at the card's edge; the overhanging bar this used to be
    // ran off into the dark and read as a stray stroke.
    float outward = abs(p.x) - (uWellHi.x + 0.012);
    float tri = within(max(abs(p.y - y) - outward * 0.6, outward - 0.082));

    base = lay(base, vec3(0.01, 0.014, 0.022), max(seat - line, 0.0) * 0.5);
    return lay(base, uNeedle, max(line, tri));
  }
`;

/**
 * The evaluation bar.
 *
 * Reads exactly like the eval bar in any analysis tool: White's share fills
 * from the bottom, Black's from the top, and the boundary is the score. The
 * scale is non-linear (see `evalToFill`), so the ticks are placed by running
 * the real scores through the same mapping the fill uses — they cannot drift
 * out of agreement with the bar.
 */
export class EvalSpine {
  /**
   * @param {object} opts
   * @param {number} [opts.side] 1 for the right of the board, -1 for the left
   */
  constructor({ side = 1 } = {}) {
    this.fill = 0.5;
    this.targetFill = 0.5;

    const ticks = TICK_SCORES.map((score) => evalToFill(score));

    const card = createCard({
      name: 'eval-bar',
      metrics: PORTRAIT,
      position: [side * GAUGE_OFFSET, 0, 0],
      caption: 'EVAL',
      initial: '+0.00',
      declares: EVAL_DECLARES,
      wellSource: EVAL_WELL,
      uniforms: {
        uFill: { value: 0.5 },
        // The two shares are the actual piece colours, so the bar states which
        // side it means rather than relying on the viewer knowing the
        // convention.
        uWhite: { value: new THREE.Color(PALETTE.pieceWhite) },
        uBlack: { value: new THREE.Color(PALETTE.pieceBlack) },
        uTickV: { value: new THREE.Vector3(ticks[0], ticks[1], ticks[2]) },
        uNeedle: { value: new THREE.Color(PALETTE.cyan) },
      },
    });

    this.group = card.group;
    this.face = card.face;
    this.material = card.material;
    this.mesh = card.mesh;
    this.readout = card.readout;
    this.footprint = footprintOf(PORTRAIT);
  }

  /**
   * @param {number} fill 0..1 share of the bar held by White, from evalToFill
   * @param {string} label formatted score for the readout
   * @param {boolean} [mate] tints the index when mate is forced
   */
  set(fill, label, mate = false) {
    // Guarded rather than trusted: a NaN here would latch into the damping and
    // freeze the bar for the rest of the session.
    this.targetFill = Number.isFinite(fill) ? clamp(fill, 0.014, 0.986) : 0.5;
    // Dim the number when Black is ahead, so which way the bar has moved is
    // legible even in a thumbnail.
    this.readout.setText(label, this.targetFill >= 0.5 ? INK.value : INK.valueDim);
    this.material.uniforms.uNeedle.value.set(mate ? PALETTE.rose : PALETTE.cyan);
  }

  update(dt, camera) {
    this.fill = damp(this.fill, this.targetFill, 6, dt);
    this.material.uniforms.uFill.value = this.fill;
    faceCamera(this.group, this.face, camera);
  }

  dispose() {
    this.readout.dispose();
    this.material.dispose();
    this.group.traverse((child) => child.geometry?.dispose?.());
  }
}

/* --------------------------------------------------------------- depth gauge */

/**
 * 20 rungs for a search that tops out at depth 20, so one lit rung is exactly
 * one ply and the gauge can be read by counting.
 */
const LADDER_RUNGS = 20;

const DEPTH_DECLARES = /* glsl */ `
  uniform float uProgress;
  uniform float uRungs;
  uniform vec3  uOff;
  uniform vec3  uOn;
  uniform vec3  uLead;
`;

const DEPTH_WELL = /* glsl */ `
  vec3 wellContent(vec2 p, vec3 base) {
    float span = uWellHi.y - uWellLo.y;
    float pitch = span / uRungs;

    float slot = (p.y - uWellLo.y) / pitch;
    float index = floor(slot);

    // Rung edges are placed in world units and softened by one pixel, not by a
    // fixed fraction of a rung. That distinction is the whole fix: with a fixed
    // fraction the transition goes sub-pixel as the card foreshortens and the
    // ladder breaks into moire.
    float into = (slot - index) * pitch;
    float rung = smoothstep(-aa, aa, into - pitch * 0.2) * within(into - pitch * 0.78);

    // Once a rung is thinner than a pixel there is nothing honest left to draw,
    // so the pattern is dissolved into a bar of its own average brightness
    // rather than left to alias.
    rung = mix(rung, 0.58, smoothstep(0.22, 0.62, aa / pitch));

    // Every fifth rung runs the full width of the track, so depth can be read
    // off in fives instead of counted one at a time.
    float major = 1.0 - step(0.5, abs(mod(index + 1.0, 5.0)));
    float inset = mix(0.055, 0.014, major);
    rung *= smoothstep(uWellHi.x - inset + aa, uWellHi.x - inset - aa, abs(p.x));

    float filled = uProgress * uRungs;
    float lit = step(index + 1.0, filled);
    float lead = lit * (1.0 - step(0.5, abs(index - (floor(filled) - 1.0))));

    // A very faint wash under the fill line: enough that the depth reads at a
    // glance in a thumbnail, not enough to compete with the rungs themselves.
    base = lay(base, uOn, under(p.y, wellY(uProgress)) * 0.07);

    // Unlit rungs are held at half strength, not a tenth. The depth that has
    // *not* been reached is part of the reading — a gauge whose empty travel is
    // invisible does not tell you how far it can still go.
    vec3 col = mix(mix(uOff, uOn, lit), uLead, lead);
    return lay(base, col, rung * mix(0.52, 1.0, lit));
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    return base;
  }
`;

/**
 * Search-depth gauge: one rung per ply of depth, lit from the bottom up, with
 * the leading rung picked out. Count the lit rungs and you have the depth,
 * which is also printed above them.
 *
 * The rungs are even. They used to shorten toward the top to suggest a search
 * cone, which cost the gauge its symmetry and bought nothing — a lopsided
 * ladder does not say "cone", it says "ragged".
 */
export class DepthLadder {
  constructor({ side = -1 } = {}) {
    this.depth = 0;
    this.targetDepth = 0;

    const card = createCard({
      name: 'depth-gauge',
      metrics: PORTRAIT,
      position: [side * GAUGE_OFFSET, 0, 0],
      // Named for its owner, like the two end panels. This gauge is the bot's
      // search and nothing else — the sweep across the predicted line is driven
      // off the very same ramp — so leaving it as a bare "DEPTH" left the one
      // instrument that is purely a report on the machine sounding like a
      // property of the position.
      caption: 'BOT DEPTH',
      initial: 'd0',
      declares: DEPTH_DECLARES,
      wellSource: DEPTH_WELL,
      uniforms: {
        uProgress: { value: 0 },
        uRungs: { value: LADDER_RUNGS },
        uOff: { value: new THREE.Color(0x40587a) },
        uOn: { value: new THREE.Color(0x8fb4d2) },
        uLead: { value: new THREE.Color(PALETTE.cyan) },
      },
    });

    this.group = card.group;
    this.face = card.face;
    this.material = card.material;
    this.mesh = card.mesh;
    this.readout = card.readout;
    this.footprint = footprintOf(PORTRAIT);
  }

  /** @param {number} depth search depth in plies; one rung per ply */
  set(depth) {
    this.targetDepth = Number.isFinite(depth) ? clamp(depth, 0, LADDER_RUNGS) : 0;
  }

  update(dt, camera) {
    this.depth = damp(this.depth, this.targetDepth, 8, dt);
    this.material.uniforms.uProgress.value = this.depth / LADDER_RUNGS;
    this.readout.setText(`d${Math.round(this.depth)}`);
    faceCamera(this.group, this.face, camera);
  }

  dispose() {
    this.readout.dispose();
    this.material.dispose();
    this.group.traverse((child) => child.geometry?.dispose?.());
  }
}

/* ----------------------------------------------------------- forecast ribbon */

/** One time rule every four full moves. */
const TREND_GRID_PLIES = 8;

/** Plotting margin either side of the ribbon, so ply zero has some width. */
const PLOT_INSET = 0.03;

const TREND_DECLARES = /* glsl */ `
  uniform sampler2D uSeries;
  uniform float uCount;
  uniform float uSpan;
  uniform float uReveal;
  uniform float uPulse;
  uniform vec2  uProject;
  uniform vec2  uProjTo;
  uniform vec2  uPlot;
  uniform float uGridPlies;
  uniform vec3  uWhite;
  uniform vec3  uBlack;
  uniform vec3  uDrawCol;
  uniform vec3  uCursor;
  uniform vec3  uGrid;
`;

const TREND_WELL = /* glsl */ `
  /* Plotted between uPlot rather than edge to edge. Without the margin the very
     first ply lands exactly on the well's rounded corner and has no width at
     all, so the legend printed a reading beside an apparently empty chart. */
  float plyToX(float ply) { return mix(uPlot.x, uPlot.y, ply / max(uSpan, 1.0)); }
  float xToPly(float x) { return (x - uPlot.x) / (uPlot.y - uPlot.x) * max(uSpan, 1.0); }

  /* White's share, and the top of the draw band, both as 0..1 of the well. The
     series is a texture so any length of game fits without recompiling, and it
     is sampled with linear filtering, which is what lets the cursor sit between
     two plies while a move is still travelling. */
  vec2 sampleWDL(float ply) {
    float u = (clamp(ply, 0.0, uCount - 1.0) + 0.5) / max(uCount, 1.0);
    return texture2D(uSeries, vec2(u, 0.5)).rg;
  }

  /* Three stacked shares, in the same order the evaluation bar stacks its two:
     White from the bottom, Black from the top, the draw between them. Reading
     one card teaches you the other. */
  /* The white share is still held back from the evaluation bar's strength,
     because here it can cover most of a card 3.06 wide and at the bar's value a
     won game turned this panel into the brightest object in the shot. But it was
     held too far back: at 0.42 the three shares landed within a narrow band of
     each other and the chart read as one murky field rather than as three. All
     three are now spread apart — White up, the draw tone up and warmer, Black
     lifted clear of the recess it used to sink into — which is what buys the
     separation back without taking the eye off the board.

     The top of the white share stays under 0.65 luminance so the ribbon cannot
     bloom into the bands above it. */
  vec3 stack(vec2 wd, float y, float v) {
    // Black's share carries a floor rather than relying on its own tone, which
    // is nearly the recess. Scaling 0x171d26 up gets nowhere — there is almost
    // nothing there to scale — so what separates the band from the empty bed
    // above and to the right of it is this additive term, and it has to be
    // several times the bed's own lift to do it.
    vec3 white = uWhite * (0.50 + 0.15 * v);
    vec3 drawn = uDrawCol * (0.72 + 0.42 * v);
    vec3 black = uBlack * (1.3 + 1.8 * v) + vec3(0.034, 0.046, 0.074);
    float overWin = smoothstep(wellY(wd.x) - aa, wellY(wd.x) + aa, y);
    float overDraw = smoothstep(wellY(wd.y) - aa, wellY(wd.y) + aa, y);
    return mix(mix(white, drawn, overWin), black, overDraw);
  }

  vec3 wellContent(vec2 p, vec3 base) {
    float v = wellV(p.y);
    float live = step(0.0, uReveal);
    float cursorX = plyToX(max(uReveal, 0.0));

    // The part of the game still to come is empty, not blank: a lift off the
    // recess makes the card read as filling in rather than as broken, which
    // matters most on the first ply of a loop when there is nothing else on it.
    vec3 col = lay(base, uGrid, 0.11);

    // Time axis. Without it the width of the card says nothing and the ribbon
    // could be four moves or forty. Four vertical rules and a level line turn an
    // empty chart into ruled paper. Faint, but no longer so faint that the ruling
    // itself has to be looked for — at the old strengths the grid was the first
    // thing the mip chain threw away.
    float pitch = (uPlot.y - uPlot.x) * uGridPlies / max(uSpan, 1.0);
    float m = mod(p.x - uPlot.x, pitch);
    col = lay(col, uGrid, hair(min(m, pitch - m), 0.0, 0.0055) * 0.36);

    float played = under(p.x, cursorX) * live;
    col = lay(col, uGrid, hair(p.y, wellY(0.5), 0.0065) * 0.52 * (1.0 - played));

    vec2 wd = sampleWDL(xToPly(p.x));
    col = mix(col, stack(wd, p.y, v), played);

    // The well is sunk, so its shadow carries across the top of the ribbon.
    // Without it the bands read as pasted on rather than sitting down inside.
    // Shallower than it was: at 0.3 it was eating the top of the black share,
    // which is the share that has least contrast to give away.
    col *= 1.0 - exp(-max(0.0, uWellHi.y - p.y) * 15.0) * 0.16 * played;

    // Boundaries, drawn in ink rather than in an accent. The win edge sits on
    // the top of a near-white share, so a coloured stroke there says something
    // about the colour it is drawn in: rose on the mate plies read as Black
    // winning along the whole curve, which is the opposite of what it plots.
    //
    // These are what actually make the curve a curve. Under-drawn, the reading
    // has to be guessed from where one wash of blue-grey becomes another.
    col = lay(col, vec3(0.03, 0.045, 0.065), hair(p.y, wellY(wd.x), 0.0085) * played * 0.95);
    col = lay(col, vec3(0.54, 0.62, 0.74), hair(p.y, wellY(wd.y), 0.0065) * played * 0.8);

    // Level again over the bands: the even-money reference has to stay findable
    // once the ribbon has covered the bed it was drawn into.
    col = lay(col, vec3(0.50, 0.57, 0.68), hair(p.y, wellY(0.5), 0.005) * played * 0.26);

    // Forecast: the same three shares run forward to where the bot's predicted
    // line ends. This is the panel's headline claim and it was drawn at 0.4 of a
    // share already held at 0.42, which put it barely above the empty bed — the
    // one mark on the card that says the bot is looking ahead was the hardest
    // one on it to see. It is now drawn nearly as strongly as the played curve
    // and told apart by *how* it is drawn instead: a diagonal hatch over it, and
    // a hard edge where the line runs out.
    float projEnd = plyToX(min(uSpan, max(uReveal, 0.0) + uProject.x));
    float ahead = (1.0 - under(p.x, cursorX)) * under(p.x, projEnd) * live * uProject.y;
    float t = clamp((p.x - cursorX) / max(1e-4, projEnd - cursorX), 0.0, 1.0);
    vec2 now = sampleWDL(max(uReveal, 0.0));
    vec2 pw = mix(now, uProjTo, t);
    float fade = ahead * (1.0 - t * 0.42);
    col = mix(col, stack(pw, p.y, v), fade * 0.82);

    // The hatch. Provisional, in the way a hatched region on a drawing is
    // provisional, which is a claim about status rather than about brightness —
    // so the forecast can be bright enough to read and still never be mistaken
    // for a game already played. Dissolved once its pitch goes near a pixel,
    // for the same reason the arcs drop their dashes: a sub-pixel hatch is not
    // a hatch, it is noise.
    float stripe = 0.5 + 0.5 * sin((p.x * 2.4 - p.y) * 66.0);
    float hatched = smoothstep(0.020, 0.008, aa);
    col = lay(col, vec3(0.05, 0.065, 0.095), ahead * smoothstep(0.3, 0.8, stripe) * hatched * 0.30);

    // Where the line runs out. A forecast with no end drawn on it does not say
    // how far ahead it reaches, which is half of what it is claiming.
    float aheadOfNow = (1.0 - under(p.x, cursorX)) * live * uProject.y;
    col = lay(col, uCursor, hair(p.x, projEnd, 0.0055) * aheadOfNow * 0.7);
    col = lay(col, uCursor, hair(p.y, wellY(pw.x), 0.006) * fade * 0.85);

    // Now. A hairline with a bead where it crosses the win edge, and a ring
    // that expands once each time a move lands. The one mark here that moves,
    // and it moves because something happened. Held at most of full strength
    // between pulses rather than half, because it is also the boundary between
    // the game and the forecast and has to hold that job while nothing is
    // happening.
    col = lay(col, uCursor, hair(p.x, cursorX, 0.0075) * live * (0.72 + 0.28 * uPulse));
    float r = length(vec2(p.x - cursorX, p.y - wellY(now.x)));
    col = lay(col, uCursor, within(r - 0.022) * live);
    col = lay(col, uCursor, rim(r - (0.03 + 0.08 * uPulse), 0.009) * uPulse * live * 0.75);

    return col;
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    // Index in the margin under the track, tip on the cursor: the same device
    // the evaluation bar uses for its needle, so the two read as one rig.
    float cursorX = plyToX(max(uReveal, 0.0));
    float outward = uWellLo.y - 0.012 - p.y;
    float tri = within(max(abs(p.x - cursorX) - outward * 0.7, outward - 0.055));
    return lay(base, uCursor, tri * step(0.0, uReveal));
  }
`;

/**
 * The win / draw / loss ribbon.
 *
 * Replaces an SVG chart that was redrawn once per move, on impact, and so read
 * as a fixed picture beside a game that was visibly still moving. Three things
 * changed with it:
 *
 * 1. It stacks the same way the evaluation bar does — White from the bottom,
 *    Black from the top — so the two cards are one reading, and the cursor's
 *    boundary height is the same height the bar is showing.
 * 2. The cursor is a damped position in ply units rather than an index, so it
 *    travels between plies while a piece is in the air and the ribbon draws
 *    itself instead of appearing.
 * 3. It reaches ahead. While the engine is running a line out, the bands
 *    continue past the cursor toward what that line ends in, fading with
 *    distance. That is the difference between charting a game and forecasting
 *    one.
 */
export class ForecastRibbon {
  /**
   * @param {object} opts
   * @param {number} [opts.side] 1 for White's end of the board, -1 for Black's
   */
  constructor({ side = -1 } = {}) {
    /** Damped cursor position, in plies. Negative means nothing has been played. */
    this.cursor = -1;
    this.target = -1;
    this.pulse = 0;
    this.projection = 0;
    this.projectionTarget = 0;
    /** How far ahead the bot's line reaches, in plies, for the printed note. */
    this.aheadPlies = 0;
    this.series = [];
    /** Ply the printed percentages belong to, so they redraw only on a change. */
    this.printed = null;
    /** Same, for the bot note under the legend. */
    this.printedAhead = 0;

    this.texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    const card = createCard({
      name: 'forecast-ribbon',
      metrics: WIDE,
      position: [0, 0, side * PANEL_OFFSET],
      declares: TREND_DECLARES,
      wellSource: TREND_WELL,
      uniforms: {
        uSeries: { value: this.texture },
        uCount: { value: 1 },
        uSpan: { value: 1 },
        uReveal: { value: -1 },
        uPulse: { value: 0 },
        // x: how many plies the forecast reaches, y: how strongly it is drawn.
        uProject: { value: new THREE.Vector2(0, 0) },
        uProjTo: { value: new THREE.Vector2(0.5, 0.5) },
        uPlot: {
          value: new THREE.Vector2(WIDE.wellLo[0] + PLOT_INSET, WIDE.wellHi[0] - PLOT_INSET),
        },
        uGridPlies: { value: TREND_GRID_PLIES },
        uWhite: { value: new THREE.Color(PALETTE.pieceWhite) },
        uBlack: { value: new THREE.Color(PALETTE.pieceBlack) },
        uDrawCol: { value: new THREE.Color(TREND.draw) },
        uCursor: { value: new THREE.Color(PALETTE.cyan) },
        uGrid: { value: new THREE.Color(TREND.grid) },
      },
    });

    this.group = card.group;
    this.face = card.face;
    this.material = card.material;
    this.mesh = card.mesh;
    this.side = side;
    this.footprint = footprintOf(WIDE);

    this.head = createPrintLayer({
      px: WIDE.headPx,
      w: WIDE.headW,
      h: WIDE.headH,
      y: WIDE.headCy,
      paint: (ctx, px) => this.#paintHead(ctx, px),
    });
    this.face.add(this.head.mesh);
  }

  /** Moves the panel in or out along its own end of the board. */
  standAt(distance) {
    this.group.position.z = this.side * distance;
  }

  /* ------------------------------------------------------------------ data */

  /**
   * Hands over the whole curve, which is known up front because the game is
   * authored. Only the part behind the cursor is drawn, so the ribbon never
   * spoils a mate that has not happened yet.
   *
   * @param {Array<{win: number, draw: number, san: string, mate: boolean}>} series
   */
  setSeries(series) {
    this.series = series ?? [];
    const count = Math.max(1, this.series.length);
    const data = new Uint8Array(count * 4);

    this.series.forEach((point, i) => {
      const win = clamp(point.win ?? 0);
      // Stored as the *top* of the draw band rather than its height, so the
      // shader compares against two boundaries instead of accumulating, and
      // linear filtering between plies interpolates the boundaries themselves.
      const drawTop = clamp(win + (point.draw ?? 0));
      data[i * 4 + 0] = Math.round(win * 255);
      data[i * 4 + 1] = Math.round(drawTop * 255);
      data[i * 4 + 2] = Math.round(clamp(point.fill ?? 0.5) * 255);
      data[i * 4 + 3] = point.mate ? 255 : 0;
    });

    this.texture.dispose();
    this.texture = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    const u = this.material.uniforms;
    u.uSeries.value = this.texture;
    u.uCount.value = count;
    u.uSpan.value = Math.max(1, count - 1);
  }

  /**
   * Moves the cursor to a ply. `-1` empties the ribbon.
   *
   * @param {number} index last ply that has actually landed
   * @param {object} [opts]
   * @param {boolean} [opts.snap] jump instead of travelling, for a loop reset
   *   where easing would sweep backwards across the whole game
   */
  reveal(index, { snap = false } = {}) {
    const shown = Math.min(index, this.series.length - 1);
    this.target = Number.isFinite(shown) ? shown : -1;
    if (snap) this.cursor = this.target;

    const point = this.series[Math.max(0, Math.round(this.target))];
    this.material.uniforms.uCursor.value.set(
      this.target >= 0 && point?.mate ? PALETTE.rose : PALETTE.cyan
    );

    const key = this.target < 0 ? null : Math.round(this.target);
    if (key !== this.printed) {
      this.printed = key;
      this.head.redraw();
    }
  }

  /**
   * Reaches the bands ahead of the cursor toward where a predicted line ends.
   *
   * @param {number} plies how far ahead the line runs; 0 retracts the forecast
   * @param {{win: number, draw: number}|null} [outcome] what it arrives at
   */
  project(plies, outcome = null) {
    const span = Number.isFinite(plies) ? Math.max(0, plies) : 0;
    this.projectionTarget = span > 0 && outcome ? 1 : 0;
    if (span > 0 && outcome) {
      const u = this.material.uniforms;
      u.uProject.value.x = span;
      u.uProjTo.value.set(clamp(outcome.win), clamp(outcome.win + outcome.draw));
    }

    // The note under the legend states how far ahead the bot is reading, so it
    // has to be told. Gated on a change, because this is a canvas upload and
    // `project` is called on every ply whether or not there is a line to draw.
    const ahead = this.projectionTarget ? Math.round(span) : 0;
    if (ahead !== this.printedAhead) {
      this.printedAhead = ahead;
      this.aheadPlies = ahead;
      this.head.redraw();
    }
  }

  /** Marks a move landing: the cursor flares and throws one ring. */
  ping() {
    this.pulse = 1;
  }

  /** The three percentages as printed, so the reading can be asserted on. */
  get text() {
    const point = this.#current();
    if (!point) return '\u2014';
    return [point.win, point.draw, point.loss].map((v) => `${Math.round(v * 100)}%`).join(' / ');
  }

  #current() {
    if (this.printed === null) return null;
    return this.series[this.printed] ?? null;
  }

  /* ------------------------------------------------------------------ paint */

  /**
   * Title, legend and the bot note, in three rows.
   *
   * The rows answer three different questions and are ordered by how often the
   * answer changes: what this panel is, what it currently reads, and what the
   * bot is doing with it right now.
   *
   * The percentages are printed for the ply the cursor is travelling *to*, not
   * for its damped position: a number that changes every frame is a number
   * nobody can read, and it would redraw the canvas every frame to say so. The
   * bands carry the motion, the print carries the value — the same split the
   * evaluation bar makes.
   */
  #paintHead(ctx, px) {
    const point = this.#current();
    const pad = px.w * 0.028;
    const capY = px.h * (60 / 230);
    const tracking = px.w * (8 / 1024);

    ctx.textBaseline = 'alphabetic';

    // Row one names the owner before it names the metric. The panel is not a
    // chart of the game, it is the bot's read of the game, and until it said so
    // there was nothing on either wide card tying it to the machine doing the
    // thinking.
    drawRuns(
      ctx,
      [
        {
          text: 'BOT',
          font: `700 ${px.h * (34 / 230)}px ${MONO}`,
          fill: BOT_INK.tag,
          tracking,
        },
        {
          text: '\u00b7 POSITION TREND',
          font: `500 ${px.h * (34 / 230)}px ${MONO}`,
          fill: INK.caption,
          tracking,
          gap: px.w * 0.012,
        },
      ],
      pad,
      capY
    );

    drawRunsRight(
      ctx,
      [
        {
          text: point ? `after ${point.san}` : 'no moves played',
          font: `500 ${px.h * (30 / 230)}px ${MONO}`,
          fill: INK.caption,
        },
      ],
      px.w - pad,
      capY
    );

    // Three fixed thirds, with the swatch and label pinned left and the value
    // pinned right inside each. Centring the group instead let every number
    // shift sideways whenever a percentage gained or lost a digit.
    const leader = point
      ? Math.max(point.win, point.draw, point.loss)
      : 0;
    const bands = [
      { label: 'WHITE', value: point?.win, swatch: PALETTE.pieceWhite, hollow: false },
      { label: 'DRAW', value: point?.draw, swatch: TREND.draw, hollow: false },
      { label: 'BLACK', value: point?.loss, swatch: 0x2b3446, hollow: true },
    ];

    const y = px.h * (152 / 230);
    const boxW = px.w / 3 - pad * 0.6;
    const swatch = px.h * (30 / 230);

    bands.forEach((band, i) => {
      const centre = (px.w * (i * 2 + 1)) / 6;
      const left = centre - boxW / 2;
      const right = centre + boxW / 2;

      const colour = `#${band.swatch.toString(16).padStart(6, '0')}`;
      if (band.hollow) {
        ctx.strokeStyle = '#8fa4bd';
        ctx.lineWidth = Math.max(1, px.h * (4 / 230));
        ctx.strokeRect(left, y - swatch, swatch, swatch);
      } else {
        ctx.fillStyle = colour;
        ctx.fillRect(left, y - swatch, swatch, swatch);
      }

      const hasValue = point && Number.isFinite(band.value);
      drawRuns(
        ctx,
        [
          {
            text: band.label,
            font: `500 ${px.h * (32 / 230)}px ${MONO}`,
            fill: INK.caption,
          },
        ],
        left + swatch * 1.55,
        y
      );

      drawRunsRight(
        ctx,
        [
          {
            text: hasValue ? `${Math.round(band.value * 100)}%` : '\u2014',
            font: `700 ${px.h * (60 / 230)}px ${MONO}`,
            // The largest share is the one worth reading, so it is the bright one.
            fill: hasValue && band.value >= leader - 1e-6 ? INK.value : INK.valueDim,
            grow: GROW_LARGE,
          },
        ],
        right,
        y
      );
    });

    // Row three: what the bot is doing with the chart. When it is reading a line
    // out, the bands run past the cursor and this says how far — so the hatched
    // region has a number attached to it instead of being a shape the viewer has
    // to interpret. Otherwise it states whose read this is, which is the point of
    // the whole panel.
    const noteY = px.h * (212 / 230);
    const noteFont = `500 ${px.h * (28 / 230)}px ${MONO}`;
    const projecting = this.aheadPlies > 0;
    drawRuns(
      ctx,
      [
        {
          text: projecting
            ? `forecasting ${this.aheadPlies} ${this.aheadPlies === 1 ? 'ply' : 'plies'} ahead`
            : 'bot read of the position',
          font: noteFont,
          fill: projecting ? BOT_INK.thinking : BOT_INK.idle,
        },
      ],
      pad,
      noteY
    );

    drawRunsRight(
      ctx,
      [{ text: 'WIN / DRAW / LOSS', font: noteFont, fill: INK.caption, tracking }],
      px.w - pad,
      noteY
    );
  }

  /* ----------------------------------------------------------------- frame */

  update(dt, camera) {
    const u = this.material.uniforms;

    // Slower than the evaluation bar on purpose: the bar is a value settling,
    // this is a line being drawn, and a curve that snaps into place never reads
    // as having been drawn at all.
    this.cursor = damp(this.cursor, this.target, 4.2, dt);
    if (Math.abs(this.cursor - this.target) < 0.003) this.cursor = this.target;
    u.uReveal.value = this.cursor;

    this.pulse = damp(this.pulse, 0, 3.4, dt);
    u.uPulse.value = this.pulse < 0.004 ? 0 : this.pulse;

    this.projection = damp(this.projection, this.projectionTarget, 5, dt);
    u.uProject.value.y = this.projection;
    if (this.projection < 0.004) u.uProject.value.x = 0;

    faceCamera(this.group, this.face, camera);
  }

  dispose() {
    this.head.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.group.traverse((child) => child.geometry?.dispose?.());
  }
}

/* --------------------------------------------------------------- line strip */

/**
 * Columns of the strip. Four full moves, each column holding one side's move
 * over the other's answer, which is how notation is written — so eight plies is
 * the most a line can show and the longest line in the game is seven.
 */
const LINE_COLS = 4;
const LINE_CELLS = LINE_COLS * 2;

/** Lamp colours for the three states the panel reports. */
const LAMP = {
  idle: 0x4a5f7a,
  thinking: PALETTE.tactic,
  playing: PALETTE.cyan,
};

const LINE_DECLARES = /* glsl */ `
  uniform float uSteps;
  uniform float uOffset;
  uniform float uActive;
  uniform float uSideMask;
  uniform float uGhostMask;
  uniform float uMateAt;
  uniform float uProgress;
  uniform float uScan;
  uniform float uThink;
  uniform float uCols;
  uniform vec2  uRow;
  uniform vec2  uRun;
  uniform vec2  uLamp;
  uniform float uLampA;
  uniform vec3  uLampCol;
  uniform vec3  uLead;
  uniform vec3  uReplyCol;
  uniform vec3  uMateCol;
`;

const LINE_WELL = /* glsl */ `
  /* Per-step flags arrive packed into one float rather than as arrays, because
     indexing a uniform array with a computed index is not portable in GLSL ES
     1.00 and eight steps fit in eight bits with room to spare. */
  float bitAt(float mask, float i) {
    return mod(floor(mask / exp2(i)), 2.0);
  }

  vec3 wellContent(vec2 p, vec3 base) {
    vec3 col = base;

    float pitchX = (uWellHi.x - uWellLo.x) / uCols;
    float colF = floor(clamp((p.x - uWellLo.x) / pitchX, 0.0, uCols - 1.0));
    float pitchY = (uRow.y - uRow.x) * 0.5;
    // Top of a column is the side that owns the line, bottom is the answer it
    // forces. Reading order is down each column, then across.
    float rowF = step(p.y, (uRow.x + uRow.y) * 0.5);
    float idx = colF * 2.0 + rowF - uOffset;

    vec2 centre = vec2(uWellLo.x + (colF + 0.5) * pitchX, uRow.y - (rowF + 0.5) * pitchY);
    // Named bounds rather than the obvious thing, because "half" is a reserved
    // word in GLSL ES and using it fails with only a syntax error on this line
    // to go on.
    vec2 bounds = vec2(pitchX * 0.5 - 0.014, pitchY * 0.5 - 0.012);
    float d = sdBox(p - centre, bounds, 0.024);

    float present = step(0.0, idx) * step(idx, uSteps - 1.0);
    float lead = bitAt(uSideMask, max(idx, 0.0));
    float ghost = bitAt(uGhostMask, max(idx, 0.0));
    float isMate = 1.0 - step(0.5, abs(idx - uMateAt));

    vec3 tint = mix(uReplyCol, uLead, lead);
    tint = mix(tint, uMateCol, isMate);

    // How close the runner is, and whether it has been through already. Both
    // are continuous, so a cell lights as the runner arrives rather than at the
    // instant an integer changes.
    float near = 1.0 - clamp(abs(uActive - idx), 0.0, 1.0);
    float past = smoothstep(idx + 0.1, idx + 0.9, uActive);

    // A seat, so the steps read as keys set into the housing rather than as
    // paint on the recess. A forecast step keeps most of its seat rather than
    // nearly none of it: hollowing it out that far left the bot's expected reply
    // sitting on bare recess, which read as an empty cell with text floating in
    // it rather than as a step held more loosely than the others.
    float seat = within(d) * present * (1.0 - ghost * 0.45);
    col = lay(col, mix(uRecess, uFrame, 0.58), seat);
    col = lay(col, uRecess * 0.25, rim(d, 0.008) * present * 0.7);

    // The rim carries the state: dim while the step is still ahead, full as the
    // runner arrives, held bright afterwards so a line that has been played out
    // stays legible as a receipt. The floor is what matters most here — at 0.24
    // the steps the bot had not reached yet were barely outlined at all, so a
    // line of four moves looked like a line of one.
    float strength = 0.46 + 0.32 * past + 0.36 * near;
    col = lay(col, tint, rim(d, 0.011) * present * clamp(strength, 0.0, 1.0));

    // The step being played takes an accent bar down its leading edge — the
    // same device the move strip along the bottom of the frame uses, so nothing
    // here has to be filled in a tone strong enough to compete with it.
    float bar = within(max(d, p.x - (centre.x - bounds.x + 0.034)));
    col = lay(col, tint, bar * present * near);

    // Progress along the whole line, which a grid of cells cannot say by
    // itself: four columns look the same whether one step is done or seven.
    float dRun = sdRect(p, vec2(uWellLo.x + 0.03, uRun.x), vec2(uWellHi.x - 0.03, uRun.y), 0.012);
    float run = within(dRun);
    float fillTo = mix(uWellLo.x + 0.03, uWellHi.x - 0.03, uProgress);
    col = lay(col, uRecess * 0.5, run);
    col = lay(col, uLead, run * under(p.x, fillTo) * 0.85);
    col = lay(col, uLampCol, run * hair(p.x, fillTo, 0.013));

    // Search sweep, positioned by the same depth ramp the gauge on the far side
    // of the board is showing. It arrives at the right edge when the search
    // tops out and fades when the search ends, so it reports rather than
    // decorates.
    //
    // The wash alone was too diffuse to read as a sweep — it looked like uneven
    // lighting on the card. A hairline at its head gives the motion something
    // definite to be carried by, which is the whole signal that the bot is
    // working through the line right now.
    float scanX = mix(uWellLo.x, uWellHi.x, uScan);
    // The hairline is held well under full strength because it crosses the
    // notation on its way through. It has to be definite enough to read as a
    // sweep and no more: brighter, it stops being a line passing over the moves
    // and starts being a scratch on them.
    col = lay(col, uLampCol, exp(-abs(p.x - scanX) * 7.0) * uThink * 0.18);
    col = lay(col, uLampCol, hair(p.x, scanX, 0.008) * uThink * 0.42);

    return col;
  }

  vec3 cardOverlay(vec2 p, vec3 base) {
    // State lamp. Drawn here rather than printed on the caption so it can
    // breathe while the engine is running a line out; a baked canvas cannot,
    // and "thinking" against "playing" is the one distinction on this card that
    // the board itself cannot make — a phantom move and a real one look alike.
    // Larger than it was, and with a second ring outside the first. It is the
    // one element on either wide panel that tells you the machine is live rather
    // than that the picture is finished, so it is worth being findable from the
    // shot list's wider framings.
    float r = length(p - uLamp);
    vec3 col = lay(base, uLampCol, within(r - 0.023) * uLampA);
    col = lay(col, uLampCol, rim(r - 0.038, 0.007) * uLampA * 0.45);
    return lay(col, uLampCol, rim(r - 0.055, 0.005) * uLampA * 0.18);
  }
`;

/**
 * The predicted line.
 *
 * Replaces a list of DOM chips whose only motion was a CSS colour transition on
 * whichever chip was current. The problem was not the styling: a predicted line
 * is a claim about the future that the game then either confirms or leaves, and
 * a static list cannot show either happening. Here the runner slides through the
 * steps in step with the phantom pieces on the board, the progress bar under
 * them says how much of the claim has been honoured, and the lamp says whether
 * what you are watching is the engine imagining the line or the game following
 * it.
 *
 * Steps are laid out in columns of two — one side's move over the other's answer
 * — because that is how the moves are written down everywhere else.
 */
export class LineStrip {
  /**
   * @param {object} opts
   * @param {number} [opts.side] 1 for White's end of the board, -1 for Black's
   * @param {boolean} [opts.reducedMotion] holds the lamp steady
   */
  constructor({ side = 1, reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.time = 0;
    this.state = '';
    this.steps = [];
    this.committed = 0;
    this.verdict = '';
    this.qualifier = '';
    this.kind = 'level';
    this.offset = 0;
    /** Side the bot is calculating for, so the panel can say so out loud. */
    this.leadColor = 'w';
    /** Damped position of the runner, in steps. */
    this.active = 0;
    this.targetActive = 0;
    this.think = 0;
    this.thinkTarget = 0;
    /** Signature of the line on display, so an unchanged line is not rebuilt. */
    this.signature = '';

    const row = [WIDE.wellLo[1] + 0.135, WIDE.wellHi[1] - 0.015];
    const run = [WIDE.wellLo[1] + 0.025, WIDE.wellLo[1] + 0.105];
    this.row = row;
    this.pitchX = (WIDE.wellHi[0] - WIDE.wellLo[0]) / LINE_COLS;
    this.pitchY = (row[1] - row[0]) / 2;

    // Sat on the caption row's baseline, in the taller head's coordinates. The
    // caption is indented past it by `lampGap` in `#paintHead`; if either moves
    // the other has to move with it.
    const lamp = headPoint(WIDE, 46, 50);

    const card = createCard({
      name: 'line-strip',
      metrics: WIDE,
      position: [0, 0, side * PANEL_OFFSET],
      declares: LINE_DECLARES,
      wellSource: LINE_WELL,
      uniforms: {
        uSteps: { value: 0 },
        uOffset: { value: 0 },
        uActive: { value: 0 },
        uSideMask: { value: 0 },
        uGhostMask: { value: 0 },
        uMateAt: { value: -1 },
        uProgress: { value: 0 },
        uScan: { value: 0 },
        uThink: { value: 0 },
        uCols: { value: LINE_COLS },
        uRow: { value: new THREE.Vector2(row[0], row[1]) },
        uRun: { value: new THREE.Vector2(run[0], run[1]) },
        uLamp: { value: new THREE.Vector2(lamp[0], lamp[1]) },
        uLampA: { value: 0.32 },
        uLampCol: { value: new THREE.Color(LAMP.idle) },
        // Amber for the side doing the winning, periwinkle for the answers it
        // forces — the same two voices the arcs over the board are drawn in.
        uLead: { value: new THREE.Color(PALETTE.tactic) },
        uReplyCol: { value: new THREE.Color(PALETTE.forecast) },
        uMateCol: { value: new THREE.Color(PALETTE.rose) },
      },
    });

    this.group = card.group;
    this.face = card.face;
    this.material = card.material;
    this.mesh = card.mesh;
    this.side = side;
    this.footprint = footprintOf(WIDE);

    this.head = createPrintLayer({
      px: WIDE.headPx,
      w: WIDE.headW,
      h: WIDE.headH,
      y: WIDE.headCy,
      paint: (ctx, px) => this.#paintHead(ctx, px),
    });
    this.face.add(this.head.mesh);

    // One glyph plane per cell, coplanar with the card and tinted through the
    // material rather than repainted. That is what lets a step brighten as the
    // runner reaches it without a canvas upload per frame: the artwork is drawn
    // white once and every colour after that is a uniform.
    this.cells = [];
    for (let i = 0; i < LINE_CELLS; i += 1) {
      const cell = this.#createCell();
      cell.mesh.visible = false;
      this.face.add(cell.mesh);
      this.cells.push(cell);
    }
    this.lampColor = new THREE.Color(LAMP.idle);
  }

  /** Moves the panel in or out along its own end of the board. */
  standAt(distance) {
    this.group.position.z = this.side * distance;
  }

  /* ------------------------------------------------------------------ cells */

  #createCell() {
    const state = { san: '', number: '' };
    const layer = createPrintLayer({
      px: { w: 340, h: 186 },
      w: this.pitchX - 0.09,
      h: (this.pitchX - 0.09) * (186 / 340),
      order: 4,
      paint: (ctx, px) => {
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffffff';

        if (state.number) {
          ctx.textAlign = 'left';
          // Lifted from 0.42. The move number is the only thing establishing
          // that a column is one full move, and at four tenths it was the first
          // mark on the card to disappear into the mip chain.
          ctx.globalAlpha = 0.62;
          ctx.font = `500 ${px.h * (36 / 186)}px ${MONO}`;
          stamp(
            ctx,
            state.number,
            px.w * 0.05,
            px.h * (48 / 186),
            armGrow(ctx, ctx.font, '#ffffff', GROW_SMALL)
          );
          ctx.globalAlpha = 1;
        }

        // Fitted, not trusted to fit: "O-O-O" is nearly twice the width of "d4"
        // and a step that overflows its own cell is worse than a smaller one.
        const size = px.h * (96 / 186);
        ctx.font = `700 ${size}px ${MONO}`;
        const maxWidth = px.w * 0.9;
        const measured = ctx.measureText(state.san).width;
        if (measured > maxWidth) ctx.font = `700 ${Math.floor((size * maxWidth) / measured)}px ${MONO}`;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        stamp(
          ctx,
          state.san,
          px.w / 2,
          px.h * (126 / 186),
          armGrow(ctx, ctx.font, '#ffffff', GROW_LARGE)
        );
      },
    });

    return {
      mesh: layer.mesh,
      material: layer.material,
      state,
      set(san, number) {
        if (state.san === san && state.number === number) return;
        state.san = san;
        state.number = number;
        layer.redraw();
      },
      dispose: layer.dispose,
    };
  }

  /**
   * Where a step sits, in card units. Mirrors the shader's division of the well
   * exactly; if one changes the other has to change with it, which is why both
   * derive from the same pitch and offset rather than from tuned constants.
   */
  #cellCentre(index) {
    const slot = index + this.offset;
    const column = Math.floor(slot / 2);
    const row = slot % 2;
    return [
      WIDE.wellLo[0] + (column + 0.5) * this.pitchX,
      this.row[1] - (row + 0.5) * this.pitchY,
    ];
  }

  /* ------------------------------------------------------------------- data */

  /**
   * Puts a line on the card.
   *
   * @param {object} line
   * @param {string} line.verdict     headline, e.g. "White mates in 2"
   * @param {string} [line.qualifier] how strong the claim is: 'forced' | 'best play'
   * @param {string} [line.kind]      'mate' | 'winning' | 'edge' | 'level'
   * @param {string} [line.leadColor] side the line belongs to, 'w' or 'b'
   * @param {Array<{san: string, color: string, number: string|null, forecast: boolean}>} line.steps
   */
  setLine({ verdict = '', qualifier = '', kind = 'level', leadColor = 'w', steps = [] } = {}) {
    // A line starting with Black's move leaves the top of the first column
    // empty, so the column still stands for one full move rather than silently
    // renumbering the whole strip.
    const offset = steps[0]?.color === 'b' ? 1 : 0;
    const shown = steps.slice(0, LINE_CELLS - offset);

    const signature = [verdict, qualifier, kind, leadColor, offset]
      .concat(shown.map((step) => `${step.number ?? ''}${step.san}${step.forecast ? '~' : ''}`))
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.verdict = verdict;
    this.qualifier = qualifier;
    this.kind = kind;
    this.offset = offset;
    this.leadColor = leadColor;
    this.steps = shown;
    // Steps the engine actually committed to, which is what the progress bar
    // measures. A one-move forecast is not a line to be part-way through, so a
    // strip carrying only that reports no progress rather than reporting itself
    // half done.
    this.committed = shown.filter((step) => !step.forecast).length;
    // A new line starts at its first step rather than easing there from wherever
    // the last one finished, which would light the cells in reverse on the way
    // back down the strip.
    this.active = 0;
    this.targetActive = 0;

    let sideMask = 0;
    let ghostMask = 0;
    let mateAt = -1;
    shown.forEach((step, i) => {
      if (step.color === leadColor) sideMask |= 1 << i;
      if (step.forecast) ghostMask |= 1 << i;
    });
    if (kind === 'mate' && shown.length) {
      const last = shown[shown.length - 1];
      if (!last.forecast) mateAt = shown.length - 1;
    }

    const u = this.material.uniforms;
    u.uSteps.value = shown.length;
    u.uOffset.value = offset;
    u.uSideMask.value = sideMask;
    u.uGhostMask.value = ghostMask;
    u.uMateAt.value = mateAt;

    this.cells.forEach((cell, i) => {
      const step = shown[i];
      cell.mesh.visible = Boolean(step);
      if (!step) return;
      cell.set(step.san, step.number ?? '');
      const [x, y] = this.#cellCentre(i);
      cell.mesh.position.x = x;
      cell.mesh.position.y = y;
    });

    this.head.redraw();
  }

  /**
   * Where the runner is, in steps. Fractional on purpose: during a predicted
   * line this is handed the same continuous position the phantom pieces are
   * moving to, so the strip and the board cannot drift apart.
   */
  setStep(step) {
    this.targetActive = Number.isFinite(step) ? clamp(step, -0.6, LINE_CELLS) : 0;
  }

  /**
   * Says which of two things is happening, because they look similar on the
   * board and mean opposite things: `thinking` is the engine running the line
   * out as a phantom sequence, `playing` is the game actually following it.
   *
   * @param {'thinking'|'playing'|''} state
   */
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.head.redraw();
  }

  /**
   * Drives the sweep from the real search ramp rather than from a clock, so it
   * reaches the end of its travel exactly when the depth gauge tops out.
   *
   * @param {number} ramp 0..1 progress of the current search
   * @param {boolean} active whether a search is open
   */
  setSearch(ramp, active) {
    this.material.uniforms.uScan.value = clamp(Number.isFinite(ramp) ? ramp : 0);
    this.thinkTarget = active ? 1 : 0;
  }

  clear() {
    this.signature = '';
    this.verdict = '';
    this.qualifier = '';
    this.kind = 'level';
    this.leadColor = 'w';
    this.steps = [];
    this.committed = 0;
    this.offset = 0;
    this.active = 0;
    this.targetActive = 0;

    const u = this.material.uniforms;
    u.uSteps.value = 0;
    u.uSideMask.value = 0;
    u.uGhostMask.value = 0;
    u.uMateAt.value = -1;
    u.uOffset.value = 0;

    for (const cell of this.cells) cell.mesh.visible = false;
    this.setState('');
    this.head.redraw();
  }

  /** The headline as printed, so the reading can be asserted on. */
  get text() {
    return this.verdict || '\u2014';
  }

  /** The line as printed, for the same reason. */
  get line() {
    return this.steps.map((step) => step.san);
  }

  /* ------------------------------------------------------------------ paint */

  /**
   * Title, verdict and the bot note, in three rows — the same structure the
   * forecast ribbon prints, so the two end panels read as a matched pair of
   * readouts from one machine rather than as two unrelated charts.
   */
  #paintHead(ctx, px) {
    const pad = px.w * 0.028;
    // Room for the lamp, which the shader draws at a fixed spot so it can pulse.
    const lampGap = px.w * 0.062;
    const capY = px.h * (60 / 230);
    const capSize = px.h * (34 / 230);
    const tracking = px.w * (8 / 1024);

    ctx.textBaseline = 'alphabetic';

    // "BOT" is set in the amber the predicted arcs over the board are drawn in,
    // so the caption and the thing it is describing are the same voice.
    drawRuns(
      ctx,
      [
        { text: 'BOT', font: `700 ${capSize}px ${MONO}`, fill: BOT_INK.tag, tracking },
        {
          text: '\u00b7 PREDICTED LINE',
          font: `500 ${capSize}px ${MONO}`,
          fill: INK.caption,
          tracking,
          gap: px.w * 0.012,
        },
      ],
      pad + lampGap,
      capY
    );

    // The state word is the panel's one claim about the machine rather than
    // about the position, so it gets the lamp's own colour rather than a
    // neutral ink. `IDLE` is printed too: a state that vanishes when nothing is
    // happening leaves the lamp with no legend to be read against.
    const state = this.state || 'idle';
    drawRunsRight(
      ctx,
      [
        {
          text: state.toUpperCase(),
          font: `700 ${px.h * (32 / 230)}px ${MONO}`,
          fill:
            state === 'thinking'
              ? BOT_INK.thinking
              : state === 'playing'
                ? BOT_INK.playing
                : BOT_INK.idle,
          tracking: px.w * (6 / 1024),
        },
      ],
      px.w - pad,
      capY
    );

    const noteY = px.h * (212 / 230);
    const noteFont = `500 ${px.h * (28 / 230)}px ${MONO}`;

    // Row three, left: what the bot is doing with the line. `thinking` and
    // `playing` look identical on the board — a phantom move and a real one are
    // the same gesture — so this is the only place the difference is stated in
    // words rather than as a colour.
    drawRuns(
      ctx,
      [
        {
          text:
            state === 'thinking'
              ? 'bot is calculating this line'
              : state === 'playing'
                ? 'board is following the bot\u2019s line'
                : 'bot\u2019s best line from here',
          font: noteFont,
          fill: state === 'idle' ? BOT_INK.idle : BOT_INK.thinking,
        },
      ],
      pad,
      noteY
    );

    // Row three, right: which side the bot is calculating for. The panel shows
    // lines for both colours over a game, and without this the amber steps only
    // say "the side doing the winning" — which is not the same as naming it.
    if (this.verdict) {
      drawRunsRight(
        ctx,
        [
          {
            text: `playing for ${this.leadColor === 'b' ? 'Black' : 'White'}`,
            font: noteFont,
            fill: INK.caption,
          },
        ],
        px.w - pad,
        noteY
      );
    }

    if (!this.verdict) return;

    // The verdict is its own row rather than sharing the caption, because the
    // claim it makes needs qualifying — "forced" against "best play" — and that
    // does not fit beside a label.
    const runs = [
      {
        text: this.verdict.toUpperCase(),
        font: `700 ${px.h * (64 / 230)}px ${MONO}`,
        // Both branches are a bright ink now. The verdict is the headline on the
        // card, and `valueDim` used to put a level or edge assessment at the same
        // weight as the furniture around it.
        fill: this.kind === 'mate' ? BOT_INK.tag : INK.value,
        grow: GROW_LARGE,
      },
    ];
    if (this.qualifier) {
      runs.push({
        text: `\u00b7 ${this.qualifier}`,
        font: `500 ${px.h * (32 / 230)}px ${MONO}`,
        fill: INK.caption,
        gap: px.w * 0.018,
      });
    }

    // Fitted as a group, so a long verdict shrinks its qualifier with it rather
    // than pushing it off the card.
    const width = runsWidth(ctx, runs);
    const maxWidth = px.w - pad * 2;
    if (width > maxWidth) {
      const scale = maxWidth / width;
      runs.forEach((run) => {
        run.font = run.font.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Math.floor(size * scale)}px`);
        if (run.gap) run.gap *= scale;
      });
    }
    drawRuns(ctx, runs, pad, px.h * (150 / 230));
  }

  /* ----------------------------------------------------------------- frame */

  update(dt, camera) {
    const u = this.material.uniforms;
    this.time += dt;

    this.active = damp(this.active, this.targetActive, 9, dt);
    u.uActive.value = this.active;

    u.uProgress.value = this.committed > 1 ? clamp((this.active + 1) / this.committed) : 0;

    this.think = damp(this.think, this.thinkTarget, 4, dt);
    u.uThink.value = this.think;

    const target = this.state === 'thinking' ? LAMP.thinking : this.state === 'playing' ? LAMP.playing : LAMP.idle;
    this.lampColor.lerp(_lampTarget.set(target), 1 - Math.exp(-9 * dt));
    u.uLampCol.value.copy(this.lampColor);

    // The lamp breathes only while the engine is thinking. That is the one place
    // a moving element is justified here: it is on screen for a second or two
    // and it is the signal, not decoration.
    const breathe = this.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(this.time * 5.2);
    u.uLampA.value =
      this.state === 'thinking' ? breathe : this.state === 'playing' ? 0.95 : 0.3;

    // Steps that the runner has not reached yet are held back, so the line reads
    // as a prediction being confirmed one move at a time.
    //
    // Two numbers changed and both were legibility bugs. The floor was 0.42,
    // which put the notation for every step the bot had not reached yet at well
    // under half strength against a dark seat — that is most of the line, most of
    // the time. And the ceiling was 1.0, which took the glyph on the step being
    // played *past* the bloom threshold: the one cell the eye is meant to land on
    // was the one cell wearing a halo, and a haloed glyph does not read as
    // emphasised, it reads as out of focus. The range is now 0.42 to 0.82, which
    // is brighter everywhere it matters and blooms nowhere.
    this.cells.forEach((cell, i) => {
      if (!cell.mesh.visible) return;
      const near = 1 - clamp(Math.abs(this.active - i), 0, 1);
      const past = clamp((this.active - i - 0.1) / 0.8);
      const step = this.steps[i];
      const tone = 0.58 + 0.12 * past + 0.12 * near - (step?.forecast ? 0.14 : 0);
      cell.material.color.setScalar(clamp(tone, 0.42, 0.82));
    });

    faceCamera(this.group, this.face, camera);
  }

  dispose() {
    this.head.dispose();
    for (const cell of this.cells) cell.dispose();
    this.material.dispose();
    this.group.traverse((child) => child.geometry?.dispose?.());
  }
}

export { LADDER_RUNGS };
