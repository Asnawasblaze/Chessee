import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import primaryImg from "../assets/new-primary.webp";
// secondary.webp (1476x1066) rather than new-secondary.webp (1477x1065):
// its aspect ratio is 1.3846 against new-primary's 1.3847, so the two
// treatments register on top of each other under `object-fit: cover`.
// new-secondary's 1.3869 drifted enough to shift the lit artwork a couple
// of pixels off the base image during the crossfade.
import secondaryImg from "../assets/secondary.webp";
import Clouds from "./Clouds";
import "./HeroSection.css";

gsap.registerPlugin(useGSAP);

// Native pixel size of hero-bg.png. The HUD panel positions (in
// HeroSection.css) are percentages authored against this exact image, so
// the art frame below is always sized/positioned to match this ratio.
const ART_WIDTH = 1672;
const ART_HEIGHT = 941;
const ART_RATIO = ART_WIDTH / ART_HEIGHT;

// Horizontal focal point (0-1, fraction of art width) of the player/board
// subject in hero-bg.png, derived from the cloud-mask hole centered at
// x=0.66. On narrow (portrait/mobile) viewports the crop is severe enough
// that a plain center-crop pushes the subject off-frame — this keeps it
// roughly centered in the visible slice instead.
const ART_FOCUS_X = 0.62;

// Below ~700px viewport width the crop is too narrow for the three HUD
// panels (authored for a landscape layout) to read sensibly — they're
// hidden via a matching media query in HeroSection.css, and only the
// artwork + clouds show.

interface ArtRect {
  width: number;
  height: number;
  left: number;
  top: number;
}

// Breathing room kept between the right-hand panels and the viewport edge
// when the art frame is cropped horizontally. Sized to clear the corner
// brackets too, which now sit outside the panel's own rect.
const HUD_EDGE_GUTTER = 18;

/** Reproduces `object-fit: cover` math: the smallest rect that is >= the
 * viewport in both dimensions while preserving ART_RATIO. Sizing a wrapper
 * div to this rect (instead of relying on cover on the <img> itself) gives
 * the HUD panels a containing block that exactly matches the visible,
 * cropped artwork at any viewport size. Horizontal placement is biased
 * toward ART_FOCUS_X (clamped to the image bounds) instead of pure
 * centering, so narrow crops still frame the subject. */
function computeCoverRect(viewportW: number, viewportH: number): ArtRect {
  const viewportRatio = viewportW / Math.max(viewportH, 1);
  let width: number;
  let height: number;
  if (viewportRatio > ART_RATIO) {
    // Viewport is wider than the art -> crop top/bottom, match width.
    width = viewportW;
    height = width / ART_RATIO;
    return { width, height, left: 0, top: (viewportH - height) / 2 };
  }

  // Viewport is taller/narrower than the art -> crop left/right, match height.
  height = viewportH;
  width = height * ART_RATIO;
  const centeredLeft = (viewportW - width) / 2;
  const focusedLeft = viewportW / 2 - ART_FOCUS_X * width;
  // Clamp so the frame never reveals empty space beyond the image edges.
  const minLeft = viewportW - width;
  const left = Math.min(0, Math.max(minLeft, focusedLeft));
  // Blend toward pure centering when the crop is mild, so the bias only
  // kicks in once cropping is actually significant.
  const cropSeverity = Math.min(1, (width - viewportW) / viewportW);
  return {
    width,
    height,
    left: centeredLeft + (left - centeredLeft) * cropSeverity,
    top: 0,
  };
}

const DEPTH_MAX = 45;
// Chart viewBox units. The trend is plotted against *search depth* rather
// than a rolling clock window (see EvalChart), which is how an engine's own
// analysis panel draws it — you can see how the score converged, not just
// the last few seconds of it.
const SPARK_W = 190;
const SPARK_H = 50;
const CP_RANGE = 3.2;

// Frame-relative position (fractions of .hero-art-frame) of the lit pawn in
// the artwork. Measured from the rendered hero rather than eyeballed: the
// glow's bright core sits in a column at x≈0.663, and 0.715 is the crown of
// the piece where the player's finger meets it. The art frame is always
// sized to ART_RATIO, so this one pair of numbers is viewport-independent.
const BOARD_ANCHOR = { x: 0.6625, y: 0.7145 };
// Fixed, symmetric domain the sparkline is plotted against, matching the
// exact range every cp value is clamped to (see computeCpForDepth). This
// is the key fix for the "looks like a flat/straight line" issue: an
// earlier version plotted against a *tighter* domain than the actual value
// range, so any decisive eval (which happens often — targets roll up to
// +/-2.6) clipped to the domain edge and pinned the line flat there for
// the rest of the search cycle. Matching the domain to the real range
// means the line is never artificially pinned — it keeps responding to
// every tick's movement, all the way to the top/bottom.
const EVAL_DOMAIN: [number, number] = [-2.9, 2.9];
// Same palette used by .holo-value.positive/.negative, reused here so the
// chart's line/fill/dot always agree with the numeric readout's color.
const EVAL_POSITIVE_COLOR = "#8ce0f6";
const EVAL_NEGATIVE_COLOR = "#f39a94";

function randRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(n: number) {
  return Math.floor(Math.random() * n);
}

// Figurine notation glyphs, so the readout looks like a real engine line
// without needing a legal move generator behind it.
const PIECE_GLYPHS = ["♟", "♞", "♝", "♜", "♛"];
const FILES = "abcdefgh";

function randMove() {
  const glyph = PIECE_GLYPHS[randInt(PIECE_GLYPHS.length)];
  const capture = Math.random() < 0.3 ? "x" : "";
  return `${glyph}${capture}${FILES[randInt(8)]}${1 + randInt(8)}`;
}

/** "29...♟xf5" — black to move, matching the position on the board. */
function buildBestMove(moveNumber: number) {
  return `${moveNumber}...${randMove()}`;
}

/** The continuation an engine prints after its best move. Having the
 * principal variation on screen is what makes the panel read as engine
 * output instead of a single decorative number. */
function buildPv(moveNumber: number) {
  return `${moveNumber + 1}.${randMove()} ${randMove()} ${
    moveNumber + 2
  }.${randMove()}`;
}

/** Logistic score-to-result curve, the same shape engines use to turn a
 * centipawn score into a practical win expectancy. */
function winPercent(cp: number) {
  return Math.round(100 / (1 + Math.pow(10, -cp / 3.4)));
}

const groupFormatter = new Intl.NumberFormat("en-US");

/** Splits the node count into a number and its magnitude suffix so the unit
 * can be typeset smaller than the digits.
 *
 * Below a million the count is shown in full grouped digits. Compact
 * notation ("1.1K") was the reason the counter looked like it was stepping
 * rather than counting: one displayed digit covers a hundred nodes, so the
 * readout only changed every few hundred thousand nodes' worth of progress
 * and jumped when it did. Full digits at those magnitudes tick every frame,
 * and the value only switches to a compact "1.24M" once the digit count
 * would outgrow the panel. */
function formatNodesParts(n: number): { num: string; unit: string } {
  const v = Math.max(0, Math.round(n));
  if (v < 1_000_000) return { num: groupFormatter.format(v), unit: "" };
  return { num: (v / 1_000_000).toFixed(2), unit: "M" };
}

/** Compact form for the nodes-per-second readout, where two decimals keep
 * the trailing digits moving instead of parking on a rounded value. */
function formatRate(n: number): { num: string; unit: string } {
  const v = Math.max(0, n);
  if (v < 1000) return { num: String(Math.round(v)), unit: "n/s" };
  if (v < 1_000_000) return { num: (v / 1000).toFixed(1), unit: "Kn/s" };
  return { num: (v / 1_000_000).toFixed(2), unit: "Mn/s" };
}

function formatCp(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

const SPARK_PAD_Y = 4;

/** Maps a centipawn value to a chart y-coordinate against the fixed
 * EVAL_DOMAIN, so the line's height always reflects the true magnitude of
 * the evaluation instead of being rescaled to whatever's in the window. */
function mapY(cp: number) {
  const [min, max] = EVAL_DOMAIN;
  const t = Math.max(0, Math.min(1, (cp - min) / (max - min)));
  return SPARK_H - SPARK_PAD_Y - t * (SPARK_H - SPARK_PAD_Y * 2);
}

const ZERO_Y = mapY(0);
// Sample i is the score printed at ply i + 1, so the x axis is search depth.
const SPARK_STEP = SPARK_W / (DEPTH_MAX - 1);

interface ChartShape {
  points: string;
  area: string;
  lastX: number;
  lastY: number;
}

function buildChart(samples: number[]): ChartShape | null {
  if (samples.length === 0) return null;
  const coords = samples.map(
    (cp, i) => [i * SPARK_STEP, mapY(cp)] as [number, number]
  );
  if (coords.length === 1) {
    // A single sample has no line to draw — extend it a hair so the stroke
    // and the leading dot still register on the very first ply.
    coords.push([SPARK_STEP * 0.4, coords[0][1]]);
  }
  const points = coords
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  // Closed polygon (line + baseline-at-zero) used to fill the area under
  // the trend, so the chart reads as a filled eval graph rather than a
  // bare line with no sense of scale.
  const area = `0,${ZERO_Y.toFixed(1)} ${points} ${lastX.toFixed(
    1
  )},${ZERO_Y.toFixed(1)}`;
  return { points, area, lastX, lastY };
}

// Faint rules at +/-1 and +/-2 pawns give the line a readable scale instead
// of leaving it to float in an empty box.
const CHART_RULES = [2, 1, -1, -2];
// Depth gridlines every 5 plies.
const CHART_TICKS = Array.from(
  { length: Math.floor((DEPTH_MAX - 1) / 5) },
  (_, i) => (i + 1) * 5
);

interface ChartRefs {
  pathRef: React.RefObject<SVGPolylineElement | null>;
  /* Wide, translucent copy of the trend line sitting under it. This is the
   * line's glow, and it is drawn rather than filtered on purpose: a
   * `filter: drop-shadow()` on geometry that changes every frame has to be
   * re-evaluated every frame, and the whole HUD overlay re-rasterises
   * together (SVG transforms are not composited), so a handful of glow
   * filters in here measured as a full dropped frame during scroll. An
   * extra stroke costs a fraction of that and reads the same at these
   * sizes. */
  bloomRef: React.RefObject<SVGPolylineElement | null>;
  areaRef: React.RefObject<SVGPolygonElement | null>;
  dotRef: React.RefObject<SVGCircleElement | null>;
  dotBloomRef: React.RefObject<SVGCircleElement | null>;
  headRef: React.RefObject<SVGLineElement | null>;
  levelRef: React.RefObject<SVGLineElement | null>;
}

/** Evaluation plotted against search depth, redrawn every frame. Depth
 * gridlines, pawn-value rules, a zero baseline, a filled area and a leading
 * marker projecting the current level forward give the trend a real scale to
 * be read against. The SVG keeps its own aspect ratio (no non-uniform
 * scaling), so strokes and the marker dot stay round at any panel width. */
function EvalChart({
  pathRef,
  bloomRef,
  areaRef,
  dotRef,
  dotBloomRef,
  headRef,
  levelRef,
}: ChartRefs) {
  return (
    <svg
      className="eval-chart"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      fill="none"
      aria-hidden="true"
    >
      <g className="chart-grid">
        {CHART_TICKS.map((d) => (
          <line
            key={`t${d}`}
            x1={(d - 1) * SPARK_STEP}
            y1={0}
            x2={(d - 1) * SPARK_STEP}
            y2={SPARK_H}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {CHART_RULES.map((cp) => (
          <line
            key={`r${cp}`}
            x1={0}
            y1={mapY(cp)}
            x2={SPARK_W}
            y2={mapY(cp)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <line
        className="chart-zero"
        x1={0}
        y1={ZERO_Y}
        x2={SPARK_W}
        y2={ZERO_Y}
        vectorEffect="non-scaling-stroke"
      />
      <polygon ref={areaRef} className="chart-area" points="" />
      <polyline
        ref={bloomRef}
        className="chart-path-bloom"
        points=""
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        ref={pathRef}
        className="chart-path"
        points=""
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        ref={levelRef}
        className="chart-level"
        x1={0}
        y1={ZERO_Y}
        x2={SPARK_W}
        y2={ZERO_Y}
        vectorEffect="non-scaling-stroke"
      />
      <line
        ref={headRef}
        className="chart-head"
        x1={0}
        y1={0}
        x2={0}
        y2={SPARK_H}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        ref={dotBloomRef}
        className="chart-dot-bloom"
        cx={0}
        cy={ZERO_Y}
        r="5"
      />
      <circle ref={dotRef} className="chart-dot" cx={0} cy={ZERO_Y} r="2.1" />
    </svg>
  );
}

/** Shared HUD chrome around any panel's content, so all three read as one
 * hologram UI: corner brackets, an outer bloom, a projected top/bottom edge
 * light, a fixed pixel grid, a crawling interlace pattern and a scan band. */
function HoloPanel({
  className,
  ariaLabel,
  children,
}: {
  className: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={`holo-panel ${className}`} aria-label={ariaLabel}>
      <span className="holo-aura" aria-hidden="true" />
      <span className="holo-corner corner-tl" />
      <span className="holo-corner corner-tr" />
      <span className="holo-corner corner-bl" />
      <span className="holo-corner corner-br" />
      <div className="holo-panel-inner">
        <div className="holo-grid" aria-hidden="true" />
        <div className="holo-interlace" aria-hidden="true" />
        <div className="holo-scan" aria-hidden="true" />
        <div className="holo-edge" aria-hidden="true" />
        <div className="holo-content">{children}</div>
      </div>
    </div>
  );
}

/** Panel heading: caption, a hairline rule that eats the remaining width
 * (so short labels don't leave a dead gap), and an optional status tag. */
function HoloLabel({
  children,
  tag,
  tagClass,
}: {
  children: ReactNode;
  tag?: ReactNode;
  tagClass?: string;
}) {
  return (
    <div className="holo-label">
      <span className="holo-label-text">{children}</span>
      <i className="holo-label-rule" aria-hidden="true" />
      {tag !== undefined ? (
        <span className={`holo-label-tag ${tagClass ?? ""}`}>{tag}</span>
      ) : null}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** One score revision in a search: the ply it lands on and the value the
 * engine settles on from there. */
interface Waypoint {
  depth: number;
  cp: number;
}

interface EngineState {
  depth: number;
  /** Eval-vs-depth trajectory for the current search. */
  plan: Waypoint[];
  /** Last tick's trajectory value, used to detect a score revision. */
  planCp: number;
  cp: number;
  displayedCp: number;
  moveNumber: number;
  bestMove: string;
  pv: string;
  /** One sample per completed ply of the current search. */
  samples: number[];
  noise: number;
  nodes: number;
  /** Node rate this search settles at. */
  npsTarget: number;
  /** Slow wander around that rate. */
  npsDrift: number;
  nps: number;
  elapsed: number;
}

// A search settles at a roughly constant node rate; the ramp over the first
// second or so is the engine spinning up. Modelling the *rate* and
// integrating it is what makes the counter behave: it climbs every frame,
// never stalls waiting for the next ply, and never steps backwards.
const NPS_RAMP_SEC = 1.1;

function rollNpsTarget() {
  return randRange(185_000, 330_000);
}

/** Builds the evaluation trajectory for one search as a set of revisions.
 *
 * This is what makes the trend read as real analysis. An engine's score does
 * not slide continuously from one value to another: it holds while the search
 * confirms the current best line, then steps when a deeper ply finds
 * something better — big steps early, progressively smaller ones as the
 * search converges on its final assessment. The shallow read is also often
 * plain wrong, sometimes on the opposite side of zero, which is exactly the
 * "engine changes its mind as it thinks" behaviour the panel is selling. */
function buildEvalPlan(): Waypoint[] {
  const settled = (Math.random() < 0.5 ? -1 : 1) * randRange(0.2, 2.3);
  const steps = 3 + randInt(3);
  // Shallow-search error, more often than not on the wrong side of the
  // settled score.
  let deviation =
    randRange(1.0, 2.1) *
    (Math.random() < 0.62 ? -Math.sign(settled) : Math.sign(settled));

  const plan: Waypoint[] = [
    { depth: 1, cp: clamp(settled + deviation, -CP_RANGE, CP_RANGE) },
  ];
  for (let k = 1; k < steps; k++) {
    // Each revision shrinks the error and may flip its sign, so the line
    // overshoots and corrects rather than easing in one direction.
    deviation *= randRange(-0.62, 0.5);
    const spread = (DEPTH_MAX - 4) / steps;
    const depth = Math.round(k * spread + randRange(-1.5, 2));
    plan.push({
      depth: clamp(depth, plan[k - 1].depth + 2, DEPTH_MAX - 2),
      cp: clamp(settled + deviation, -CP_RANGE, CP_RANGE),
    });
  }
  plan.push({ depth: DEPTH_MAX, cp: clamp(settled, -CP_RANGE, CP_RANGE) });
  return plan;
}

// Plies a revision takes to land. Engines print the new score on a single
// ply, but easing it over a ply and a half keeps the chart's corner from
// being a vertical wall while still reading as a distinct step.
const REVISION_PLIES = 1.6;

/** The trajectory's value at `depth`: flat between revisions, stepping into
 * each new one over REVISION_PLIES. */
function planValueAt(plan: Waypoint[], depth: number) {
  let prev = plan[0];
  for (const wp of plan) {
    if (depth < wp.depth) {
      const t = clamp((depth - (wp.depth - REVISION_PLIES)) / REVISION_PLIES, 0, 1);
      // Smoothstep gives the step a natural accelerate/settle shape.
      return prev.cp + (wp.cp - prev.cp) * (t * t * (3 - 2 * t));
    }
    prev = wp;
  }
  return prev.cp;
}

// How much of the previous ply's jitter carries forward. High momentum means
// the wobble drifts in legs instead of reading as per-tick static.
const NOISE_MOMENTUM = 0.78;

/** Search jitter layered over the trajectory. Amplitude decays with depth:
 * a shallow search is volatile, a deep one is close to settled — the same
 * narrowing you see in a real engine's score as it converges. */
function nextNoise(state: EngineState) {
  const amp = 0.05 + 0.4 * Math.exp(-state.depth / 11);
  state.noise = clamp(
    state.noise * NOISE_MOMENTUM + randRange(-amp, amp) * 0.55,
    -amp * 1.7,
    amp * 1.7
  );
  return state.noise;
}

interface MaskEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

// Initial/fallback ellipse fractions (objectBoundingBox units, relative to
// the art frame) for each panel's mist hole, used only until the first
// real measurement lands so nothing flashes an unmasked hole on mount.
// These roughly match each panel's authored CSS position in
// HeroSection.css — after mount they're replaced with values measured
// from the panels' actual rendered rects (see the effect below), so the
// holes always track the real panel regardless of viewport size.
const INITIAL_PANEL_MASKS: Record<"depth" | "eval" | "bestmove", MaskEllipse> = {
  depth: { cx: 0.5215, cy: 0.3275, rx: 0.1, ry: 0.14 },
  eval: { cx: 0.905, cy: 0.302, rx: 0.11, ry: 0.11 },
  bestmove: { cx: 0.9015, cy: 0.5785, rx: 0.12, ry: 0.12 },
};

// Each panel's mask hole is sized to contain the panel's rect with enough
// margin to survive the feather blur applied to the holes (see
// #hero-panel-hole-feather) — without it the softened edge would let mist
// creep back over the panel border.
const PANEL_MASK_COVER = 1.16;

// The corner brackets sit outside the panel's own rect (--holo-bracket-gap
// in HeroSection.css) and the measured rect does not include them, so the
// hole is grown by their reach before the cover factor is applied. Without
// this the shortest panel's hole stopped just inside its own brackets and
// mist drifted back across them.
const PANEL_BRACKET_REACH = 8;

// Natural pixel ratios of the two hero cutouts. Used to reproduce each
// image's `object-fit: cover` placement inside the SVG masks. They're
// re-measured from the real <img> elements on load; these defaults are the
// shipped assets' own values so the masks are correct on the first paint.
const PRIMARY_RATIO_DEFAULT = 1303 / 941;
const SECONDARY_RATIO_DEFAULT = 1476 / 1066;

interface CoverBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** objectBoundingBox rect (fractions of the art frame) covered by an image
 * of `imgRatio` painted with `object-fit: cover; object-position: center`
 * inside a frame of `frameRatio`.
 *
 * This is the fix for the masks landing in the wrong place. An <image>
 * inside a mask with maskContentUnits="objectBoundingBox" resolves
 * preserveAspectRatio against the *unit square*, and only afterwards gets
 * stretched non-uniformly to the frame's real aspect. So "xMidYMid slice"
 * cropped the artwork on the wrong axis and shifted it sideways: the mist
 * holes and the hover-reveal clip were offset and stretched relative to
 * the artwork they were supposed to trace. Placing the image explicitly
 * and painting it with preserveAspectRatio="none" reproduces
 * object-fit: cover exactly, on the correct axis.
 *
 * The art frame is always sized to ART_RATIO (see computeCoverRect), so
 * this result is viewport-independent — one calculation covers every
 * screen size. */
function coverImageBox(frameRatio: number, imgRatio: number): CoverBox {
  if (frameRatio >= imgRatio) {
    // Frame is relatively wider: image matches the frame's width and
    // overflows vertically, cropped equally top and bottom.
    const h = frameRatio / imgRatio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  // Frame is relatively taller: image matches the frame's height and
  // overflows horizontally, cropped equally left and right.
  const w = imgRatio / frameRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

// Hover-reveal spotlight radius, derived from the art frame's rendered
// width so it scales sensibly across viewport sizes instead of a fixed
// pixel value that would feel tiny on a large display or oversized on a
// small one.
function revealRadiusFor(frameWidth: number) {
  return Math.min(220, Math.max(110, frameWidth * 0.095));
}

/* ---------------------------------------------------------------------- */
/* HUD ↔ board connection beams                                           */
/* ---------------------------------------------------------------------- */

type PanelKey = "depth" | "eval" | "bestmove";

const PANEL_KEYS: PanelKey[] = ["depth", "eval", "bestmove"];

const PANEL_SELECTORS: Record<PanelKey, string> = {
  depth: ".depth-panel",
  eval: ".eval-panel",
  bestmove: ".bestmove-panel",
};

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Panel geometry in art-frame pixels, measured from the DOM. Shared by the
 * mist mask holes and the connection beams so both always agree with where
 * the panels actually rendered. */
interface FrameMetrics {
  w: number;
  h: number;
  panels: Record<PanelKey, Box>;
}

interface Point {
  x: number;
  y: number;
}

// Length of the straight run a beam makes into its panel, and the radius of
// the corner where that run meets the diagonal from the board.
const BEAM_STUB = 26;
const BEAM_CORNER = 9;

/** Where a beam docks, plus the point it approaches from.
 *
 * The edge chosen is whichever one actually faces the board — measured by how
 * far outside the box the anchor sits on each axis — and the run into it is
 * perpendicular to that edge. Picking the edge and the approach together is
 * what keeps a beam from grazing along a panel's side or reaching around it. */
function dockFor(box: Box, from: Point): { dock: Point; approach: Point } {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const cx = box.left + box.width / 2;

  const outX =
    from.x < box.left ? box.left - from.x : from.x > right ? from.x - right : 0;
  const outY =
    from.y < box.top ? box.top - from.y : from.y > bottom ? from.y - bottom : 0;

  if (outY >= outX) {
    // Board is mostly above/below the panel: dock on the near horizontal
    // edge, offset toward the board's side of the panel.
    const dock: Point = {
      x: box.left + box.width * (from.x > cx ? 0.72 : 0.28),
      y: from.y > bottom ? bottom : box.top,
    };
    const dir = from.y > bottom ? 1 : -1;
    return { dock, approach: { x: dock.x, y: dock.y + dir * BEAM_STUB } };
  }

  // Board is off to one side: dock on the near vertical edge.
  const dock: Point = {
    x: from.x > right ? right : box.left,
    y: box.top + box.height * 0.62,
  };
  const dir = from.x > right ? 1 : -1;
  return { dock, approach: { x: dock.x + dir * BEAM_STUB, y: dock.y } };
}

/** Connector drawn the way an instrument callout is: one long diagonal off
 * the board anchor, a rounded corner, then a short perpendicular run into the
 * panel edge. */
function beamPath(a: Point, approach: Point, dock: Point): string {
  const legA = Math.hypot(approach.x - a.x, approach.y - a.y);
  const legB = Math.hypot(dock.x - approach.x, dock.y - approach.y);
  const r = Math.min(BEAM_CORNER, legA * 0.4, legB * 0.4);
  const head = `M${a.x.toFixed(1)},${a.y.toFixed(1)}`;
  const tail = `${dock.x.toFixed(1)},${dock.y.toFixed(1)}`;
  if (!(r > 1)) {
    return `${head} L${approach.x.toFixed(1)},${approach.y.toFixed(
      1
    )} L${tail}`;
  }
  const p1: Point = {
    x: approach.x + ((a.x - approach.x) / legA) * r,
    y: approach.y + ((a.y - approach.y) / legA) * r,
  };
  const p2: Point = {
    x: approach.x + ((dock.x - approach.x) / legB) * r,
    y: approach.y + ((dock.y - approach.y) / legB) * r,
  };
  return (
    `${head} L${p1.x.toFixed(1)},${p1.y.toFixed(1)} ` +
    `Q${approach.x.toFixed(1)},${approach.y.toFixed(1)} ${p2.x.toFixed(
      1
    )},${p2.y.toFixed(1)} L${tail}`
  );
}

interface Beam {
  key: PanelKey;
  d: string;
  dock: Point;
}

function buildBeams(metrics: FrameMetrics): Beam[] {
  const anchor: Point = {
    x: BOARD_ANCHOR.x * metrics.w,
    y: BOARD_ANCHOR.y * metrics.h,
  };
  return PANEL_KEYS.map((key) => {
    const { dock, approach } = dockFor(metrics.panels[key], anchor);
    return { key, d: beamPath(anchor, approach, dock), dock };
  });
}

/* Hero copy, authored once and rendered twice: the visible base layer and the
   pointer-lit layer stacked on top of it. Sharing one definition is what
   guarantees the two layers wrap identically at every viewport width — a
   second hand-written copy would drift the moment a line broke differently
   and the light would fall on ghost text.

   Each headline line sits in its own mask so it can be revealed by rising out
   of it on load (see the entrance timeline).

   The break is authored, not left to wrapping. At 700 weight the natural wrap
   of "like a real grandmaster" put both words in one mask, so the reveal
   uncovered two visual lines as a single block and the payoff word arrived
   with the line above it. Three masks means three separate uncoverings, and
   the shape of the block is the same at every width instead of re-flowing
   at whatever point the column happens to run out. */
const heroTitleLines = (
  <>
    <span className="hero-title-line-mask">
      <span className="hero-title-line">
        <em className="hero-see">See</em> the board
      </span>
    </span>
    <span className="hero-title-line-mask">
      <span className="hero-title-line">like a real</span>
    </span>
    <span className="hero-title-line-mask">
      <span className="hero-title-line">
        <span className="hero-title-accent">grandmaster</span>
      </span>
    </span>
  </>
);

/* Support copy, split into words so each one can be revealed on its own (see
   the focus-pull stagger in the entrance timeline). Kept as one string rather
   than hand-written spans so the copy stays editable as a sentence. */
const HERO_SUBTITLE_WORDS =
  "Chessee lets you play against powerful bots with deep analysis that shows everything you need — every move, every idea, every winning chance.".split(
    " "
  );

const heroSubtitleWords = HERO_SUBTITLE_WORDS.map((word, i) => (
  <Fragment key={`${word}-${i}`}>
    <span className="hero-subtitle-word">{word}</span>
    {i < HERO_SUBTITLE_WORDS.length - 1 ? " " : ""}
  </Fragment>
));

// Radius of the copy column's cursor spotlight, matching the mask in
// HeroSection.css. Only used to park the highlight offscreen on exit.
const COPY_LIGHT_RADIUS = 175;

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const artFrameRef = useRef<HTMLDivElement>(null);
  const [artRect, setArtRect] = useState<ArtRect | null>(null);
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  const [hudShift, setHudShift] = useState(0);
  const [imageRatios, setImageRatios] = useState({
    primary: PRIMARY_RATIO_DEFAULT,
    secondary: SECONDARY_RATIO_DEFAULT,
  });
  const depthValueRef = useRef<HTMLSpanElement>(null);
  const depthBarRef = useRef<HTMLDivElement>(null);
  const nodesValueRef = useRef<HTMLSpanElement>(null);
  const nodesUnitRef = useRef<HTMLSpanElement>(null);
  const npsValueRef = useRef<HTMLSpanElement>(null);
  const timeValueRef = useRef<HTMLSpanElement>(null);
  const evalValueRef = useRef<HTMLSpanElement>(null);
  const evalDeltaRef = useRef<HTMLSpanElement>(null);
  const evalSideRef = useRef<HTMLSpanElement>(null);
  const evalWinRef = useRef<HTMLSpanElement>(null);
  const bestMoveTextRef = useRef<HTMLSpanElement>(null);
  const bestMoveCpRef = useRef<HTMLSpanElement>(null);
  const bestPvRef = useRef<HTMLSpanElement>(null);
  const chartPathRef = useRef<SVGPolylineElement>(null);
  const chartBloomRef = useRef<SVGPolylineElement>(null);
  const chartAreaRef = useRef<SVGPolygonElement>(null);
  const chartDotRef = useRef<SVGCircleElement>(null);
  const chartDotBloomRef = useRef<SVGCircleElement>(null);
  const chartHeadRef = useRef<SVGLineElement>(null);
  const chartLevelRef = useRef<SVGLineElement>(null);
  const heroPrimaryRef = useRef<HTMLImageElement>(null);
  const revealSubjectRef = useRef<HTMLDivElement>(null);
  const revealWindowRef = useRef<HTMLDivElement>(null);
  const revealShiftRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const copyTextRef = useRef<HTMLDivElement>(null);
  const copyLitRef = useRef<HTMLDivElement>(null);
  const revealGlowRef = useRef<HTMLDivElement>(null);
  const revealRadiusRef = useRef(160);
  // Plain mutable object (not React state) driving the reveal mask + glow
  // every frame — same pattern as EngineState above, since this updates
  // far too often for React state to be the right tool.
  const revealRef = useRef({ x: 0, y: 0, r: 0 });

  /** Keeps the mask geometry honest if either artwork is ever swapped for
   * one with a different aspect ratio. */
  const handleArtLoad =
    (key: "primary" | "secondary") =>
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (!naturalWidth || !naturalHeight) return;
      const ratio = naturalWidth / naturalHeight;
      setImageRatios((prev) =>
        Math.abs(prev[key] - ratio) < 0.0005 ? prev : { ...prev, [key]: ratio }
      );
    };

  const setCpColor = (el: HTMLElement | null, cp: number) => {
    if (!el) return;
    el.classList.toggle("positive", cp >= 0);
    el.classList.toggle("negative", cp < 0);
  };

  const paintCp = (cp: number) => {
    const text = formatCp(cp);
    if (evalValueRef.current) evalValueRef.current.textContent = text;
    if (bestMoveCpRef.current) bestMoveCpRef.current.textContent = text;
    setCpColor(evalValueRef.current, cp);
    setCpColor(bestMoveCpRef.current, cp);
    // Plain-language read-out of what the number means, so the panel
    // explains the position instead of only scoring it.
    const leader = Math.abs(cp) < 0.2 ? null : cp > 0 ? "White" : "Black";
    if (evalSideRef.current) {
      evalSideRef.current.textContent = leader
        ? `${leader} is ahead`
        : "Even game";
    }
    if (evalWinRef.current) {
      // Always the *leading* side's chance. Pairing "Black is ahead" with
      // white's 34% would read as a contradiction.
      const white = winPercent(cp);
      evalWinRef.current.textContent = `${leader === "Black" ? 100 - white : white}%`;
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateRect = () => {
      const { clientWidth, clientHeight } = el;
      if (clientWidth > 0 && clientHeight > 0) {
        const rect = computeCoverRect(clientWidth, clientHeight);
        setArtRect(rect);
        // On viewports taller/narrower than the artwork the frame is wider
        // than the viewport, and the two right-hand panels — positioned at
        // ~83% of the *frame* — end up cropped off screen with it. Publish
        // how far the frame overhangs so they can be pulled back into view.
        const overhang = rect.left + rect.width - clientWidth;
        setHudShift(overhang > 1 ? overhang + HUD_EDGE_GUTTER : 0);
        revealRadiusRef.current = revealRadiusFor(rect.width);
      }
    };

    updateRect();
    const observer = new ResizeObserver(updateRect);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Copy spotlight: the bright duplicate layer is revealed through a radial
  // hole tracking the cursor, so the copy is dim at rest and lights up under
  // the pointer — the same gesture the artwork's own hover reveal uses.
  //
  // One light for the whole column (headline *and* subtitle) rather than one
  // per block: a single mask means the light carries across the gap between
  // them instead of switching off and on again, and it is one duplicate layer
  // to keep registered rather than two. The hover region is the whole copy
  // column, so the light is already lit and positioned by the time the cursor
  // reaches the words.
  //
  // Coordinates are written as CSS custom properties on a rAF tick rather
  // than on every pointermove: a pointer can fire several moves per frame,
  // and each write here dirties the masked text layer. One write per frame is
  // the most the compositor can show anyway.
  useEffect(() => {
    const copy = copyRef.current;
    const text = copyTextRef.current;
    const lit = copyLitRef.current;
    if (!copy || !text || !lit) return;
    const canHover = window.matchMedia(
      "(hover: hover) and (pointer: fine)"
    ).matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Without a cursor there is nothing to track, and a light that chases the
    // pointer is exactly the kind of motion reduced-motion users opt out of.
    // Both cases fall back to the flat, slightly brighter base copy set in
    // the stylesheet's (hover: none) block.
    if (!canHover || reduce) return;

    let frame = 0;
    let px = 0;
    let py = 0;

    const paint = () => {
      frame = 0;
      lit.style.setProperty("--sx", `${px.toFixed(1)}px`);
      lit.style.setProperty("--sy", `${py.toFixed(1)}px`);
    };

    const track = (event: PointerEvent) => {
      // Measured against the text block, not the hover region: the mask lives
      // on the duplicate layer, which is inset:0 of that block.
      const r = text.getBoundingClientRect();
      px = event.clientX - r.left;
      py = event.clientY - r.top;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onEnter = (event: PointerEvent) => {
      // Position first, then fade in — otherwise the layer cross-fades from
      // wherever the light was left on the previous pass.
      track(event);
      paint();
      lit.style.opacity = "1";
    };

    const onLeave = () => {
      lit.style.opacity = "0";
      // Park it well outside the box so the next enter can't briefly show the
      // old position through the fading mask.
      px = -COPY_LIGHT_RADIUS * 3;
      py = -COPY_LIGHT_RADIUS * 3;
    };

    copy.addEventListener("pointerenter", onEnter);
    copy.addEventListener("pointermove", track);
    copy.addEventListener("pointerleave", onLeave);
    return () => {
      copy.removeEventListener("pointerenter", onEnter);
      copy.removeEventListener("pointermove", track);
      copy.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Magnetic CTA: the primary button leans toward the cursor while hovered,
  // then settles back on exit. quickTo interpolates every frame so no
  // debounce is needed; listeners live on the button itself and are torn
  // down on unmount. Pointer-fine + motion-allowed only.
  useEffect(() => {
    const cta = ctaRef.current;
    if (!cta) return;
    const canHover = window.matchMedia(
      "(hover: hover) and (pointer: fine)"
    ).matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!canHover || reduce) return;

    // Two things were making this read as a button sliding around under the
    // cursor rather than a surface with a little give in it: the pull was 30%
    // of the cursor's offset from centre (over 30px of travel at the edges of
    // a 224px-wide button), and an elastic ease overshot and wobbled on every
    // change of direction. 9% capped at 4px is a lean, and power3 settles
    // without bouncing.
    const PULL = 0.09;
    const PULL_MAX = 4;
    const lean = (offset: number) =>
      gsap.utils.clamp(-PULL_MAX, PULL_MAX, offset * PULL);

    const xTo = gsap.quickTo(cta, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(cta, "y", { duration: 0.45, ease: "power3.out" });

    const onMove = (event: PointerEvent) => {
      const r = cta.getBoundingClientRect();
      xTo(lean(event.clientX - r.left - r.width / 2));
      yTo(lean(event.clientY - r.top - r.height / 2));
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };

    cta.addEventListener("pointermove", onMove);
    cta.addEventListener("pointerleave", onLeave);
    return () => {
      cta.removeEventListener("pointermove", onMove);
      cta.removeEventListener("pointerleave", onLeave);
      gsap.killTweensOf(cta);
    };
  }, []);

  // Derives each panel's mist-mask hole from its *actual* rendered rect
  // instead of hand-typed ellipse guesses. useLayoutEffect runs
  // synchronously after DOM layout (before paint), so when artRect state
  // causes a re-render the panel rects are measured from the already-
  // settled layout — no second-render lag.
  useLayoutEffect(() => {
    const frame = artFrameRef.current;
    if (!frame) return;

    const measure = () => {
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      if (frameW <= 0 || frameH <= 0) return;

      const panels = {} as Record<PanelKey, Box>;
      for (const key of PANEL_KEYS) {
        const el = frame.querySelector<HTMLElement>(PANEL_SELECTORS[key]);
        if (!el) return;
        // Use offsetLeft/offsetTop relative to the frame rather than
        // getBoundingClientRect() viewport coords — local offsets are not
        // affected by any in-progress transform/position transitions on
        // ancestor elements, so the measurement is always stable even if
        // the frame's own CSS position is mid-update.
        panels[key] = {
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        };
      }
      setMetrics((prev) => {
        if (
          prev &&
          prev.w === frameW &&
          prev.h === frameH &&
          PANEL_KEYS.every((key) => {
            const a = prev.panels[key];
            const b = panels[key];
            return (
              a.left === b.left &&
              a.top === b.top &&
              a.width === b.width &&
              a.height === b.height
            );
          })
        ) {
          return prev;
        }
        return { w: frameW, h: frameH, panels };
      });
    };

    measure();
    // ResizeObserver on the frame covers viewport resizes; panels are
    // laid out with cqw/percentage CSS off the frame's own size, so a
    // frame resize is exactly when their rects can change. Observing the
    // panels too covers the content-driven height changes (the panels size
    // to their readouts rather than to a fixed percentage).
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    for (const key of PANEL_KEYS) {
      const el = frame.querySelector<HTMLElement>(PANEL_SELECTORS[key]);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [artRect]);

  // Mist holes and connection beams are both derived from the one
  // measurement, so they can never drift apart.
  const panelMasks = useMemo(() => {
    if (!metrics) return INITIAL_PANEL_MASKS;
    const next = {} as Record<PanelKey, MaskEllipse>;
    for (const key of PANEL_KEYS) {
      const box = metrics.panels[key];
      next[key] = {
        cx: (box.left + box.width / 2) / metrics.w,
        cy: (box.top + box.height / 2) / metrics.h,
        rx:
          ((box.width / 2 + PANEL_BRACKET_REACH) / metrics.w) *
          PANEL_MASK_COVER,
        ry:
          ((box.height / 2 + PANEL_BRACKET_REACH) / metrics.h) *
          PANEL_MASK_COVER,
      };
    }
    return next;
  }, [metrics]);

  const beams = useMemo(() => (metrics ? buildBeams(metrics) : null), [metrics]);

  // Redraw budget for the eval sparkline. The chart used to be rebuilt on
  // every frame of the score tween — a 45-point polyline string plus nine
  // setAttribute calls, each of which dirties the SVG and forces the panel
  // to re-rasterise. Inside the hero (whose WebGL fog already invalidates
  // the whole composite every frame) that measured as a full dropped frame
  // during scroll. The line is a slow curve, so redrawing it at ~25fps is
  // indistinguishable from redrawing it at display rate.
  const CHART_REDRAW_MS = 40;
  // Movement, in chart units, below which a redraw would not change a
  // single rendered pixel of the 1.8px-wide stroke.
  const CHART_EPSILON = 0.12;
  const chartPaintRef = useRef({ at: 0, y: Number.NaN, count: 0 });

  /** `force` bypasses the budget for the frames that must land: a new ply's
   * sample appearing, or a fresh search resetting the line. */
  const paintChart = (samples: number[], force = false) => {
    const shape = buildChart(samples);
    if (!shape) return;
    const latest = samples[samples.length - 1];
    const color = latest >= 0 ? EVAL_POSITIVE_COLOR : EVAL_NEGATIVE_COLOR;
    const { points, area, lastX, lastY } = shape;
    const budget = chartPaintRef.current;
    if (!force && samples.length === budget.count) {
      const now = performance.now();
      if (
        now - budget.at < CHART_REDRAW_MS ||
        Math.abs(lastY - budget.y) < CHART_EPSILON
      ) {
        return;
      }
      budget.at = now;
    } else {
      budget.at = performance.now();
    }
    budget.y = lastY;
    budget.count = samples.length;
    if (chartPathRef.current) {
      chartPathRef.current.setAttribute("points", points);
      chartPathRef.current.setAttribute("stroke", color);
    }
    if (chartBloomRef.current) {
      chartBloomRef.current.setAttribute("points", points);
      chartBloomRef.current.setAttribute("stroke", color);
    }
    if (chartAreaRef.current) {
      chartAreaRef.current.setAttribute("points", area);
      chartAreaRef.current.setAttribute("fill", color);
    }
    if (chartDotRef.current) {
      chartDotRef.current.setAttribute("cx", lastX.toFixed(1));
      chartDotRef.current.setAttribute("cy", lastY.toFixed(1));
      chartDotRef.current.setAttribute("fill", color);
    }
    if (chartDotBloomRef.current) {
      chartDotBloomRef.current.setAttribute("cx", lastX.toFixed(1));
      chartDotBloomRef.current.setAttribute("cy", lastY.toFixed(1));
      chartDotBloomRef.current.setAttribute("fill", color);
    }
    // Leading marker: a vertical line at the ply being searched plus the
    // current level projected out to the right edge, so the "live" end of
    // the trend is obvious even while the line is still short.
    if (chartHeadRef.current) {
      chartHeadRef.current.setAttribute("x1", lastX.toFixed(1));
      chartHeadRef.current.setAttribute("x2", lastX.toFixed(1));
    }
    if (chartLevelRef.current) {
      chartLevelRef.current.setAttribute("x1", lastX.toFixed(1));
      chartLevelRef.current.setAttribute("y1", lastY.toFixed(1));
      chartLevelRef.current.setAttribute("y2", lastY.toFixed(1));
      chartLevelRef.current.setAttribute("stroke", color);
    }
  };

  useGSAP(
    (_context, contextSafe) => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      const panels = gsap.utils.toArray<HTMLElement>(".holo-panel");

      // Entrance: staggered boot-in, clean fade/rise only — no gloss sweep —
      // so the panels read as a UI powering on, not a glossy reveal.
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      tl.from(panels, {
        autoAlpha: 0,
        y: 10,
        duration: 0.5,
        stagger: { each: 0.15, from: "start" },
      });

      // Entrance reveal for the header + hero copy: a staggered rise that
      // brings the wordmark, headline, subtitle and CTA up in sequence, so
      // the page reads as composing itself rather than snapping in.
      if (!reduceMotion) {
        const intro = gsap.utils.toArray<HTMLElement>(".hero-anim");
        gsap.from(intro, {
          autoAlpha: 0,
          y: 28,
          duration: 1,
          ease: "expo.out",
          stagger: 0.1,
          delay: 0.12,
        });

        // Headline: each line rises out of its own mask, so the words are
        // uncovered rather than faded in. This is why the lines carry no
        // opacity of their own here — the mask is doing the reveal, and a
        // fade on top of it would soften the edge the effect depends on.
        gsap.from(
          gsap.utils.toArray<HTMLElement>(
            ".hero-title-main .hero-title-line"
          ),
          {
            yPercent: 116,
            duration: 1.15,
            ease: "expo.out",
            stagger: 0.11,
            delay: 0.16,
            clearProps: "transform",
          }
        );

        // Subtitle focus-pull: each word arrives blurred and slightly low,
        // then resolves. A tight stagger keeps it reading as one sentence
        // coming into focus rather than as words being typed out — a different
        // idea from the headline's uncovering, so the two blocks don't read as
        // the same effect applied twice.
        //
        // clearProps drops the inline blur/transform the tween leaves behind:
        // a `filter` left on ~22 inline-block spans keeps each of them on its
        // own render surface for the life of the page, inside a section whose
        // WebGL fog already re-composites every frame.
        gsap.from(
          gsap.utils.toArray<HTMLElement>(
            ".hero-subtitle-main .hero-subtitle-word"
          ),
          {
            autoAlpha: 0,
            yPercent: 34,
            filter: "blur(6px)",
            duration: 0.9,
            ease: "power2.out",
            stagger: 0.022,
            delay: 0.5,
            clearProps: "filter,transform,opacity,visibility",
          }
        );
      }

      const plyTags = gsap.utils.toArray<HTMLElement>(".holo-ply");

      const state: EngineState = {
        depth: 1,
        plan: buildEvalPlan(),
        planCp: 0,
        cp: 0,
        displayedCp: 0,
        moveNumber: 18 + randInt(12),
        bestMove: "",
        pv: "",
        samples: [],
        noise: 0,
        nodes: 0,
        npsTarget: rollNpsTarget(),
        npsDrift: 0,
        nps: 0,
        elapsed: 0,
      };

      const tickMs = 460;
      const tickSec = tickMs / 1000;
      const barState = { p: 0 };

      /** Quick opacity blink on a readout that just changed — the cue a
       * live instrument gives when it refreshes. */
      const flash = (el: Element | null) => {
        if (!el || reduceMotion) return;
        gsap.fromTo(
          el,
          { opacity: 0.3 },
          { opacity: 1, duration: 0.3, ease: "power2.out", overwrite: "auto" }
        );
      };

      /** Re-triggerable CSS pulse on a whole panel, used when the engine
       * revises its score so the readout reacts as a unit. */
      const pulse = (selector: string) => {
        if (reduceMotion) return;
        const el = containerRef.current?.querySelector<HTMLElement>(selector);
        if (!el) return;
        el.classList.remove("holo-revised");
        void el.offsetWidth;
        el.classList.add("holo-revised");
      };

      const setBestLine = () => {
        state.bestMove = buildBestMove(state.moveNumber);
        state.pv = buildPv(state.moveNumber);
        if (bestMoveTextRef.current) {
          bestMoveTextRef.current.textContent = state.bestMove;
        }
        if (bestPvRef.current) bestPvRef.current.textContent = state.pv;
      };

      const paintDepth = () => {
        if (depthValueRef.current) {
          depthValueRef.current.textContent = String(state.depth);
        }
        for (const tag of plyTags) tag.textContent = `d${state.depth}`;
        const target = state.depth / DEPTH_MAX;
        const writeBar = () => {
          if (depthBarRef.current) {
            depthBarRef.current.style.width = `${(barState.p * 100).toFixed(2)}%`;
          }
        };
        if (reduceMotion) {
          barState.p = target;
          writeBar();
          return;
        }
        gsap.to(barState, {
          p: target,
          duration: tickSec,
          ease: "none",
          overwrite: "auto",
          onUpdate: writeBar,
        });
      };

      /** Change since the previous ply, the way an analysis board shows a
       * score's movement rather than only its level. */
      const setDelta = (delta: number) => {
        const el = evalDeltaRef.current;
        if (!el) return;
        const abs = Math.abs(delta);
        el.classList.toggle("up", delta > 0.005);
        el.classList.toggle("down", delta < -0.005);
        el.textContent =
          abs < 0.005 ? "±0.00" : `${delta > 0 ? "▲" : "▼"}${abs.toFixed(2)}`;
      };

      let lastNodeNum = "";
      let lastNodeUnit = "";
      let lastRate = "";
      let lastTime = "";

      /** Per-frame telemetry. The node counter is driven by a *rate* instead
       * of a per-tick tween, so it climbs continuously — it never stalls
       * between plies, never steps backwards, and every frame moves the
       * digits. */
      const paintTelemetry = () => {
        const nodes = formatNodesParts(state.nodes);
        if (nodes.num !== lastNodeNum) {
          lastNodeNum = nodes.num;
          if (nodesValueRef.current) {
            nodesValueRef.current.textContent = nodes.num;
          }
        }
        if (nodes.unit !== lastNodeUnit) {
          lastNodeUnit = nodes.unit;
          if (nodesUnitRef.current) nodesUnitRef.current.textContent = nodes.unit;
        }
        const rate = formatRate(state.nps);
        const rateText = `${rate.num} ${rate.unit}`;
        if (rateText !== lastRate) {
          lastRate = rateText;
          if (npsValueRef.current) npsValueRef.current.textContent = rateText;
        }
        const time = `${state.elapsed.toFixed(1)}s`;
        if (time !== lastTime) {
          lastTime = time;
          if (timeValueRef.current) timeValueRef.current.textContent = time;
        }
      };

      /** Restarts iterative deepening from ply 1 with a fresh trajectory,
       * the way an engine begins a new search on the next move. */
      const startSearch = (first: boolean) => {
        if (!first) {
          state.moveNumber += 1;
          if (state.moveNumber > 40) state.moveNumber = 18 + randInt(8);
        }
        state.depth = 1;
        state.plan = buildEvalPlan();
        state.noise = 0;
        state.elapsed = 0;
        state.nodes = 0;
        state.npsTarget = rollNpsTarget();
        state.npsDrift = 0;
        state.nps = 0;
        state.planCp = planValueAt(state.plan, 1);
        state.cp = clamp(state.planCp + nextNoise(state), -CP_RANGE, CP_RANGE);
        state.displayedCp = state.cp;
        state.samples = [state.cp];

        gsap.killTweensOf(barState);
        barState.p = 0;
        if (depthBarRef.current) depthBarRef.current.style.width = "0%";

        setBestLine();
        paintDepth();
        paintChart(state.samples, true);
        paintCp(state.cp);
        setDelta(0);
        paintTelemetry();
      };

      const tick = contextSafe!(() => {
        if (state.depth >= DEPTH_MAX) {
          startSearch(false);
          return;
        }

        state.depth += 1;
        paintDepth();
        flash(depthValueRef.current);

        // Nudge the node rate around its plateau so the readout wanders the
        // way a real one does instead of holding a synthetic constant.
        state.npsDrift = clamp(
          state.npsDrift * 0.78 + randRange(-0.05, 0.05),
          -0.12,
          0.12
        );

        // With motion reduced there is no per-frame ticker, so the counters
        // advance once per ply here instead.
        if (reduceMotion) {
          state.elapsed += tickSec;
          const rate =
            state.npsTarget * (1 - Math.exp(-state.elapsed / NPS_RAMP_SEC));
          state.nodes += rate * tickSec;
          state.nps = rate;
          paintTelemetry();
        }

        const planCp = planValueAt(state.plan, state.depth);
        const revised = Math.abs(planCp - state.planCp) > 0.1;
        state.planCp = planCp;

        // Snap the previous sample to its exact target before appending the
        // new one, so the tween below can own the newest point alone.
        const prevCp = state.cp;
        if (state.samples.length) state.samples[state.samples.length - 1] = prevCp;
        state.cp = clamp(planCp + nextNoise(state), -CP_RANGE, CP_RANGE);
        state.samples.push(state.cp);

        if (revised) {
          // A score step means the search found a better line, so the
          // suggested move changes with it and both panels acknowledge it.
          setBestLine();
          pulse(".eval-panel");
          pulse(".bestmove-panel");
          flash(bestMoveTextRef.current);
        }
        setDelta(state.cp - prevCp);

        if (reduceMotion) {
          state.displayedCp = state.cp;
          paintCp(state.cp);
          paintChart(state.samples, true);
        } else {
          gsap.to(state, {
            displayedCp: state.cp,
            duration: tickSec * 0.9,
            ease: "sine.inOut",
            overwrite: "auto",
            onUpdate: () => {
              // Keep the newest chart point in step with the tweening
              // number, so the line grows as smoothly as the readout moves.
              state.samples[state.samples.length - 1] = state.displayedCp;
              paintCp(state.displayedCp);
              paintChart(state.samples);
            },
          });
        }
      });

      startSearch(true);

      const onFrame = (_time: number, deltaMs: number) => {
        const dt = Math.min(deltaMs, 120) / 1000;
        state.elapsed += dt;
        const rate =
          state.npsTarget *
          (1 - Math.exp(-state.elapsed / NPS_RAMP_SEC)) *
          (1 + state.npsDrift);
        state.nodes += rate * dt;
        // Low-pass the rate readout so it settles like a measurement rather
        // than tracking every wobble in the integrator.
        state.nps += (rate - state.nps) * Math.min(1, dt * 3);
        paintTelemetry();
      };

      /* The fake engine is a per-frame writer: telemetry digits every frame,
       * a new ply every 460ms, and a tween redrawing the eval chart in
       * between. None of that is worth a single frame once the hero has
       * scrolled past, and in a backgrounded tab it is pure waste — but it
       * used to run for the lifetime of the page regardless. Parked on both
       * conditions instead, so the features transition (which is what the
       * hero scrolls into) gets the frame budget to itself. */
      let hudRunning = false;
      let hudTimer = 0;
      let heroOnScreen = true;

      const startHud = () => {
        if (hudRunning) return;
        hudRunning = true;
        hudTimer = window.setInterval(tick, tickMs);
        if (!reduceMotion) gsap.ticker.add(onFrame);
      };

      const stopHud = () => {
        if (!hudRunning) return;
        hudRunning = false;
        window.clearInterval(hudTimer);
        hudTimer = 0;
        gsap.ticker.remove(onFrame);
      };

      const syncHud = () => {
        if (heroOnScreen && document.visibilityState !== "hidden") startHud();
        else stopHud();
      };

      const hudObserver = new IntersectionObserver(
        (entries) => {
          heroOnScreen = entries[entries.length - 1]?.isIntersecting ?? true;
          syncHud();
        },
        // A little margin so the readouts are already live by the time the
        // hero is scrolled back into view.
        { rootMargin: "15% 0px" }
      );
      if (containerRef.current) hudObserver.observe(containerRef.current);
      document.addEventListener("visibilitychange", syncHud);
      startHud();

      const teardownHud = () => {
        stopHud();
        hudObserver.disconnect();
        document.removeEventListener("visibilitychange", syncHud);
      };

      // ── Hover-reveal spotlight ──────────────────────────────────────
      // ── Organic crossfade reveal ─────────────────────────────────────
      // The secondary treatment fades over the primary through a soft,
      // asymmetric field. There is no visible aperture or scanner ring.
      const frame = artFrameRef.current;
      const revealEl = heroPrimaryRef.current;
      const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (frame && revealEl && canHover && !reduceMotion) {
        const reveal = revealRef.current;
        reveal.r = 0;
        const revealSubject = revealSubjectRef.current;
        // See the `visibility: hidden` note on .hero-reveal-subject: the
        // masked layer is only handed to the compositor while the reveal is
        // actually on screen. Tracked in a flag so the style write happens
        // twice per hover rather than on every frame of the tween.
        let revealShown = false;

        const revealWindow = revealWindowRef.current;
        const revealShift = revealShiftRef.current;

        /* Three compositor-only writes per frame: the spotlight window's
         * transform, the artwork's counter-transform, and the window's
         * opacity. The mask geometry itself is authored in CSS against
         * --rv-r and is never touched here — see the note on
         * .hero-reveal-window in HeroSection.css for why that matters. */
        const setMaskPosition = () => {
          const radius = revealRadiusRef.current;
          const shown = reveal.r > 0.002;
          if (shown !== revealShown && revealSubject) {
            revealShown = shown;
            revealSubject.style.visibility = shown ? "visible" : "hidden";
          }
          // Window is 3.2r x 2r, centred on the cursor.
          const wx = reveal.x - radius * 1.6;
          const wy = reveal.y - radius;
          if (revealWindow) {
            revealWindow.style.transform = `translate3d(${wx.toFixed(
              1
            )}px, ${wy.toFixed(1)}px, 0)`;
            revealWindow.style.opacity = reveal.r.toFixed(3);
          }
          if (revealShift) {
            revealShift.style.transform = `translate3d(${(-wx).toFixed(
              1
            )}px, ${(-wy).toFixed(1)}px, 0)`;
          }
        };

        const quickX = gsap.quickTo(reveal, "x", {
          duration: 0.42,
          ease: "power3.out",
          onUpdate: setMaskPosition,
        });
        const quickY = gsap.quickTo(reveal, "y", {
          duration: 0.42,
          ease: "power3.out",
          onUpdate: setMaskPosition,
        });

        const showReveal = contextSafe!(() => {
          gsap.to(reveal, {
            r: 1,
            duration: 0.55,
            ease: "power2.out",
            overwrite: "auto",
            onUpdate: setMaskPosition,
          });
          frame.classList.add("reveal-active");
        });

        const hideReveal = contextSafe!(() => {
          gsap.to(reveal, {
            r: 0,
            duration: 0.42,
            ease: "power2.inOut",
            overwrite: "auto",
            onUpdate: setMaskPosition,
          });
          frame.classList.remove("reveal-active");
        });

        const onPointerMove = contextSafe!((event: PointerEvent) => {
          const rect = frame.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

          if (!inside) {
            if (frame.classList.contains("reveal-active")) hideReveal();
            return;
          }

          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          if (!frame.classList.contains("reveal-active")) {
            reveal.x = x;
            reveal.y = y;
            setMaskPosition();
            showReveal();
            return;
          }

          quickX(x);
          quickY(y);
        });

        // Pointer leaving the window never produces a pointermove, so
        // without this the reveal would stay latched on after the cursor
        // exits the page (tab switch, moving to another app, devtools).
        const onPointerOut = contextSafe!((event: PointerEvent) => {
          if (event.relatedTarget) return;
          if (frame.classList.contains("reveal-active")) hideReveal();
        });

        window.addEventListener("pointermove", onPointerMove, { passive: true });
        document.addEventListener("pointerout", onPointerOut, { passive: true });
        setMaskPosition();

        return () => {
          teardownHud();
          window.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerout", onPointerOut);
        };
      }

      // No hover reveal on this device (coarse pointer or reduced motion):
      // the spotlight stays fully transparent and its layer stays hidden.
      if (revealWindowRef.current) revealWindowRef.current.style.opacity = "0";
      return teardownHud;
    },
    { scope: containerRef }
  );

  // The art frame is always sized to ART_RATIO, so both cover boxes are
  // constant across viewports — no need to recompute them on resize.
  const primaryBox = coverImageBox(ART_RATIO, imageRatios.primary);
  const secondaryBox = coverImageBox(ART_RATIO, imageRatios.secondary);

  // Reveal geometry, derived from the same measurement revealRadiusRef is
  // fed by (see the resize effect) so the CSS mask and the JS transforms
  // always agree on the spotlight's size.
  const frameWidth = artRect ? artRect.width : "100%";
  const frameHeight = artRect ? artRect.height : "100%";
  const revealRadius = artRect ? revealRadiusFor(artRect.width) : 160;

  const frameStyle = {
    ...(artRect
      ? {
          width: artRect.width,
          height: artRect.height,
          left: artRect.left,
          top: artRect.top,
        }
      // Before the first measurement, fall back to a cover-ish guess so
      // nothing pops/jumps once the real rect is measured.
      : { width: "100%", height: "100%", left: 0, top: 0 }),
    "--hud-shift": `${hudShift}px`,
  } as unknown as React.CSSProperties;

  return (
    <>
    {/* Anchor target for the header logo and the footer's "back to top" — both
        already point at #top, and without an element carrying the id the
        browser silently does nothing. */}
    <div className="hero-section" id="top" ref={containerRef}>
      <header className="hero-header">
        <a className="hero-logo hero-anim" href="#top" aria-label="Chessee home">
          {/* Line-drawn mark: hairline tile, two filled checker squares, all
              in currentColor so the whole wordmark lights as one on hover.
              The previous solid cyan-gradient tile was carrying its own
              light source into the darkest corner of the frame. */}
          <span className="hero-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <rect
                x="1.6"
                y="1.6"
                width="28.8"
                height="28.8"
                rx="8"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth="1.2"
              />
              <rect
                x="9"
                y="9"
                width="7"
                height="7"
                rx="1.4"
                fill="currentColor"
                fillOpacity="0.9"
              />
              <rect
                x="16"
                y="16"
                width="7"
                height="7"
                rx="1.4"
                fill="currentColor"
                fillOpacity="0.42"
              />
            </svg>
          </span>
          <span className="hero-logo-word">
            CHES<span className="logo-see">SEE</span>
          </span>
        </a>
        <nav className="hero-nav hero-anim" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#why">Why Chessee</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="hero-auth hero-anim">
          <a className="hero-login" href="#login">
            Login
          </a>
          <a className="hero-signup" href="#signup">
            <span>Sign up</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 12h15M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      </header>

      <div className="hero-art-frame" style={frameStyle} ref={artFrameRef}>

        {/* Primary artwork stays fully visible. The alternate treatment is
            layered above it and clipped to the materially opaque subject,
            preventing source-canvas edges from bleeding into the reveal. */}
        <img
          className="hero-primary"
          src={primaryImg}
          alt="Chess player analyzing the board"
          onLoad={handleArtLoad("primary")}
        />

        <div
          className="hero-reveal-subject"
          aria-hidden="true"
          ref={revealSubjectRef}
        >
          <div
            className="hero-reveal-window"
            ref={revealWindowRef}
            style={{ "--rv-r": `${revealRadius}px` } as React.CSSProperties}
          >
            <div className="hero-reveal-shift" ref={revealShiftRef}>
              {/* Sized to the art frame in pixels rather than 100%: its
                  parent is the spotlight window, which is deliberately not
                  frame-sized. */}
              <img
                className="hero-reveal"
                src={secondaryImg}
                alt=""
                ref={heroPrimaryRef}
                style={{ width: frameWidth, height: frameHeight }}
                onLoad={handleArtLoad("secondary")}
              />
            </div>
          </div>
        </div>

        {/* ── LAYER 3 — mist / cloud layer ─────────────────────────────────
            Sits behind primary but in front of secondary, so mist drifts
            through the background while both subject images stay crisp.
            The SVG mask blocks mist output over the panels (rects derived
            from real DOM rects) and over the character/board area (ellipse
            approximation — replace with cutout mask PNG when available). */}
        <svg className="hero-cloud-mask-def" aria-hidden="true">
          <defs>
            {/* Turns a cutout PNG/WebP into a hard silhouette stencil:
                alpha is thresholded to fully on/off, then flattened to a
                single colour so the subject's own brightness can't leak
                into the mask value. A short blur softens the outline so
                the mist recedes around the figure instead of being cut by
                a razor edge. Black = mist hidden. */}
            <filter
              id="hero-alpha-silhouette"
              x="-12%"
              y="-12%"
              width="124%"
              height="124%"
            >
              <feComponentTransfer result="solid-subject">
                <feFuncA type="discrete" tableValues="0 0 0 1 1" />
              </feComponentTransfer>
              <feColorMatrix
                in="solid-subject"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="stencil"
              />
              <feGaussianBlur in="stencil" stdDeviation="0.006" />
            </filter>
            {/* Same stencil, white — used the other way round, to keep the
                hover reveal inside the subject's real outline so the
                cutout's transparent surround never fades in as a rectangle. */}
            <filter
              id="hero-alpha-reveal"
              x="-12%"
              y="-12%"
              width="124%"
              height="124%"
            >
              <feComponentTransfer result="solid-reveal">
                <feFuncA type="discrete" tableValues="0 0 0 1 1" />
              </feComponentTransfer>
              <feColorMatrix
                in="solid-reveal"
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"
                result="stencil"
              />
              <feGaussianBlur in="stencil" stdDeviation="0.004" />
            </filter>
            {/* Feathers the panel holes so a strong mist doesn't reveal
                three hard-edged rectangles floating in the fog. */}
            <filter
              id="hero-panel-hole-feather"
              x="-25%"
              y="-25%"
              width="150%"
              height="150%"
            >
              <feGaussianBlur stdDeviation="0.006" />
            </filter>
            <mask id="hero-reveal-subject-mask" maskContentUnits="objectBoundingBox">
              <rect x="0" y="0" width="1" height="1" fill="#000" />
              <image
                href={secondaryImg}
                x={secondaryBox.x}
                y={secondaryBox.y}
                width={secondaryBox.w}
                height={secondaryBox.h}
                preserveAspectRatio="none"
                filter="url(#hero-alpha-reveal)"
              />
            </mask>
            <mask id="hero-cloud-mask" maskContentUnits="objectBoundingBox">
              <rect x="0" y="0" width="1" height="1" fill="#fff" />
              {/* Character/board hole — traced from new-primary.webp's real
                  alpha cutout, placed with the exact same cover geometry as
                  the .hero-primary <img> so it lines up with the visible
                  artwork at any viewport size. */}
              <image
                href={primaryImg}
                x={primaryBox.x}
                y={primaryBox.y}
                width={primaryBox.w}
                height={primaryBox.h}
                preserveAspectRatio="none"
                filter="url(#hero-alpha-silhouette)"
              />
              {/* Panel holes — measured from real DOM rects, always in sync. */}
              <g filter="url(#hero-panel-hole-feather)">
                <rect
                  x={panelMasks.depth.cx - panelMasks.depth.rx}
                  y={panelMasks.depth.cy - panelMasks.depth.ry}
                  width={panelMasks.depth.rx * 2}
                  height={panelMasks.depth.ry * 2}
                  fill="#000"
                />
                <rect
                  x={panelMasks.eval.cx - panelMasks.eval.rx}
                  y={panelMasks.eval.cy - panelMasks.eval.ry}
                  width={panelMasks.eval.rx * 2}
                  height={panelMasks.eval.ry * 2}
                  fill="#000"
                />
                <rect
                  x={panelMasks.bestmove.cx - panelMasks.bestmove.rx}
                  y={panelMasks.bestmove.cy - panelMasks.bestmove.ry}
                  width={panelMasks.bestmove.rx * 2}
                  height={panelMasks.bestmove.ry * 2}
                  fill="#000"
                />
              </g>
            </mask>
          </defs>
        </svg>

        {/* Mist tuning notes, since the interaction depends on all of these
            agreeing with each other:
            - opacity was 0.1, which put the fog barely above the noise
              floor — parting it with the cursor produced a change of about
              one 255th of a step, i.e. invisible. 0.3 is still atmospheric
              but leaves the wind something to actually clear.
            - shadow must be 0. The composite pass ramps its drop shadow up
              by (1 - mist), so every bit of fog the cursor pushed away was
              immediately backfilled with an equally faint dark patch, and
              the swept area never looked any clearer.
            - cover is lowered so the field has visible light/dense
              structure rather than a flat wash; wind/windRadius are raised
              so a normal cursor sweep clears a legible channel. */}
        <Clouds
          className="hero-clouds"
          density={0}
          cover={0.13}
          speed={0.55}
          scale={3}
          color={[0.66, 0.73, 0.92]}
          opacity={0.2}
          shading={1}
          shadow={0}
          wind={0.6}
          windRadius={100}
        >
          <HoloPanel
            className="depth-panel"
            ariaLabel="Search depth and nodes"
          >
            <div className="holo-row">
              <HoloLabel tag="searching">Depth</HoloLabel>
              <span className="holo-value">
                <span ref={depthValueRef}>1</span>
                <span className="holo-unit">/{DEPTH_MAX}</span>
              </span>
              <div className="holo-bar" aria-hidden="true">
                <div className="holo-bar-fill" ref={depthBarRef} />
              </div>
            </div>
            <div className="holo-row">
              <HoloLabel>Nodes</HoloLabel>
              <span className="holo-value">
                <span ref={nodesValueRef}>0</span>
                {/* Magnitude suffix, set larger than a plain unit: "M" has to
                    read unmistakably as millions, not as decoration. */}
                <span className="holo-unit holo-unit-mag" ref={nodesUnitRef} />
              </span>
            </div>
            <div className="holo-meta">
              <span ref={npsValueRef}>0 n/s</span>
              <i className="holo-meta-sep" aria-hidden="true" />
              <span ref={timeValueRef}>0.0s</span>
            </div>
          </HoloPanel>

          <HoloPanel className="eval-panel" ariaLabel="Position evaluation">
            <HoloLabel tag={<span className="holo-ply">d1</span>}>
              Evaluation
            </HoloLabel>
            <div className="holo-value-row">
              <span className="holo-value large" ref={evalValueRef}>
                +0.00
              </span>
              <span className="holo-delta" ref={evalDeltaRef}>
                ±0.00
              </span>
            </div>
            <div className="chart-wrap">
              <EvalChart
                pathRef={chartPathRef}
                bloomRef={chartBloomRef}
                areaRef={chartAreaRef}
                dotRef={chartDotRef}
                dotBloomRef={chartDotBloomRef}
                headRef={chartHeadRef}
                levelRef={chartLevelRef}
              />
              <span className="chart-axis" aria-hidden="true">
                <i>d1</i>
                <i>d{DEPTH_MAX}</i>
              </span>
            </div>
            <div className="holo-meta">
              <span ref={evalSideRef}>Balanced</span>
              <i className="holo-meta-sep" aria-hidden="true" />
              <span>
                win <b ref={evalWinRef}>50%</b>
              </span>
            </div>
          </HoloPanel>

          <HoloPanel className="bestmove-panel" ariaLabel="Suggested best move">
            <HoloLabel tag={<span className="holo-ply">d1</span>}>
              Best move
            </HoloLabel>
            <span className="holo-value large" ref={bestMoveTextRef}>
              23...♟e4
            </span>
            <span className="holo-value small" ref={bestMoveCpRef}>
              +0.00
            </span>
            <div className="holo-caption">
              <span>Sequence found</span>
              <i aria-hidden="true" />
            </div>
            <span className="holo-pv" ref={bestPvRef}>
              24.♞f3 ♜d8 25.♛c2
            </span>
          </HoloPanel>
        </Clouds>

        {/* Beams from the lit pawn up to each readout, so the panels look
            like instruments trained on that square rather than three cards
            parked on top of the picture. Geometry comes from the same DOM
            measurement the mist holes use, in art-frame pixels, so the SVG
            is 1:1 with the layout at any viewport size. */}
        {metrics && beams ? (
          <svg
            className="hero-holo-links"
            viewBox={`0 0 ${metrics.w} ${metrics.h}`}
            aria-hidden="true"
          >
            {beams.map((beam, i) => (
              <g className={`holo-link link-${beam.key}`} key={beam.key}>
                <path className="holo-link-beam" d={beam.d} />
                <path className="holo-link-base-glow" d={beam.d} />
                <path className="holo-link-base" d={beam.d} />
                {/* Glow pass first, bright core over it. Both carry the same
                    dash + clock, which is what keeps the halo locked to the
                    packet without a drop-shadow filter (see the note above
                    .holo-link-beam in HeroSection.css). */}
                <path
                  className="holo-link-flow-glow"
                  d={beam.d}
                  pathLength={100}
                  style={{ animationDelay: `${i * -0.9}s` }}
                />
                <path
                  className="holo-link-flow"
                  d={beam.d}
                  pathLength={100}
                  style={{ animationDelay: `${i * -0.9}s` }}
                />
                <circle
                  className="holo-link-dock-ring"
                  cx={beam.dock.x}
                  cy={beam.dock.y}
                  r={5.5}
                />
                <circle
                  className="holo-link-dock-glow"
                  cx={beam.dock.x}
                  cy={beam.dock.y}
                  r={5}
                />
                <circle
                  className="holo-link-dock"
                  cx={beam.dock.x}
                  cy={beam.dock.y}
                  r={2.2}
                />
              </g>
            ))}

            {/* Target lock on the piece being analysed. */}
            <g
              className="holo-anchor"
              transform={`translate(${(BOARD_ANCHOR.x * metrics.w).toFixed(
                1
              )},${(BOARD_ANCHOR.y * metrics.h).toFixed(1)}) scale(${Math.min(
                1.55,
                Math.max(0.85, metrics.w / 1440)
              ).toFixed(3)})`}
            >
              <circle className="holo-anchor-pulse" r={9} />
              <circle className="holo-anchor-dash" r={15} />
              <circle className="holo-anchor-ring" r={4.5} />
              <circle className="holo-anchor-core-glow" r={4} />
              <circle className="holo-anchor-core" r={1.5} />
              <path
                className="holo-anchor-bracket-glow"
                d="M-27,-8 L-27,-22 L-15,-22 M15,-22 L27,-22 L27,-8 M27,44 L27,58 L15,58 M-15,58 L-27,58 L-27,44"
              />
              <path
                className="holo-anchor-bracket"
                d="M-27,-8 L-27,-22 L-15,-22 M15,-22 L27,-22 L27,-8 M27,44 L27,58 L15,58 M-15,58 L-27,58 L-27,44"
              />
            </g>
          </svg>
        ) : null}

        <div className="hero-reveal-glow" ref={revealGlowRef} aria-hidden="true" />
      </div>

      <div className="hero-atmosphere" aria-hidden="true" />

      {/* Bottom dissolve. The artwork is painted with `object-fit: cover`,
          so at the section's bottom edge it was cut off by a hard
          horizontal line — scene above, flat page colour below — which is
          the seam you scroll into on the way to the features section. This
          feathers the last quarter of the frame into the exact colour the
          page continues in (.hero-tail below), so the image runs out into
          darkness instead of stopping. Above the mist and the beams, below
          .hero-layout, so the copy stays crisp. */}
      <div className="hero-fade" aria-hidden="true" />

      {/* Deliberately minimal: title, subtitle, one CTA. The artwork and the
          analysis HUD already carry the scene, so the copy column stays out of
          their way — an eyebrow badge, a secondary button and a trust strip
          were all competing with the background rather than sitting on it. */}
      <div className="hero-layout">
        <div className="hero-copy" ref={copyRef}>
          {/* Two stacked copies of the same words: a dim base layer, and an
              identical bright layer revealed through a soft circle that
              follows the cursor (see the pointer effect above). The lit layer
              is aria-hidden so assistive tech reads the copy once.

              The -main classes mark the layer the entrance animations target,
              so the tweens can't reach into the duplicate and stagger it out
              of registration with the copy it sits on. */}
          <div className="hero-copy-text" ref={copyTextRef}>
            <h1 className="hero-title hero-title-main">{heroTitleLines}</h1>
            {/* Accent rule between headline and support copy, drawn in on
                load. It replaces the hairline that used to sit directly under
                "grandmaster" — at 700 weight that underline collided with the
                letterforms, and a rule with air around it separates the two
                type sizes far more clearly. */}
            <i className="hero-rule" aria-hidden="true" />
            {/* No .hero-anim on either block: both have reveals of their own
                rather than riding the header's stagger. The spaces between the
                word spans are text nodes, so the paragraph still wraps like
                ordinary prose. */}
            <p className="hero-subtitle hero-subtitle-main">
              {heroSubtitleWords}
            </p>
            <div className="hero-copy-lit" aria-hidden="true" ref={copyLitRef}>
              <div className="hero-title">{heroTitleLines}</div>
              {/* Present only to hold the rule's slot, so the duplicated
                  paragraph stays in registration with the real one — it is
                  painted at zero opacity (see HeroSection.css). */}
              <i className="hero-rule" />
              <p className="hero-subtitle">{heroSubtitleWords}</p>
            </div>
          </div>
          <div className="hero-actions hero-anim">
            <a className="hero-cta" href="#start" ref={ctaRef}>
              <span className="hero-cta-inner">
                <span className="hero-cta-label">Start analysing</span>
                <svg
                  className="hero-cta-arrow"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 12h15M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </a>
          </div>
        </div>

        {/* Scroll cue, bottom-centred as in the reference comp. It is a real
            anchor to the first section rather than decoration, so the hint is
            also the shortcut. Kept out of .hero-copy so it centres against the
            viewport instead of the left-hand column. */}
        <a className="hero-scroll-cue hero-anim" href="#features">
          <span className="hero-scroll-label">Scroll to explore</span>
          <span className="hero-scroll-well" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v13M6.5 12.5 12 18l5.5-5.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </a>
      </div>
    </div>

    {/* Extra length in the same colour the fade lands on, kept *outside*
        .hero-section on purpose: the art frame is sized from that element's
        client box (see computeCoverRect), so growing the section would
        re-crop the artwork. This band is what the cloud curtain builds over
        before it clears onto the light features theme. */}
    {/* The mist that dissolves the artwork's bottom edge into this band is
        not here: it's the single scroll-driven cloud layer in
        FeaturesSection, which rides up over the seam from below. Keeping it
        in one place is what stops the fog from arriving in separate,
        visibly different layers. */}
    <div className="hero-tail" aria-hidden="true" />
    </>
  );
}
