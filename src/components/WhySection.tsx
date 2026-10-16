import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import ThinkingModel, {
  type DitherState,
  type ThinkPose,
} from "./ThinkingModel";
import ChessBoard, { type ChessSceneHandle } from "./ChessBoard";
import Shatter, {
  type ShatterInstance,
  type ShatterOptions,
} from "./Shatter";
import EffectBoundary from "./EffectBoundary";
/* The pricing chapter's sky, mounted here too. Not a second sky: the same
   component, because the two are on screen at once for the screen of scrolling
   between this chapter's pin releasing and that chapter's backdrop being held,
   and any difference between them lands as a seam ruled across the join. See
   the header note in SpaceField.tsx, and .why-threshold in the stylesheet. */
import SpaceField from "./SpaceField";
import useFarPast from "./useFarPast";
import { REFRESH_PRIORITY } from "./scrollOrder";
import { beatSettle, snapHold } from "./beatSnap";
import { BEAT_VH, SCRUB } from "./pacing";
import { registerAnchorLanding } from "./anchorScroll";
import { glideToOffset } from "./smoothScroll";
import "./WhySection.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ---------------------------------------------------------------------- */
/* Why Chessee? — the argument, over a board being analysed                */
/* ---------------------------------------------------------------------- */

/* The page's closing argument, and its centrepiece effect: a single pinned,
 * scrubbed sequence in which the chapter asks its question, the frame it asked it
 * in comes apart, and behind it is a chess game being analysed — which then
 * illustrates each of the four beats in turn as the reader passes them.
 *
 * The board is the through-line, and it is a *demonstration* rather than a
 * backdrop. Each beat gets a frame of it that makes the same claim the copy does:
 *
 *   01 the problem        a best move found and played, on a bare board, with
 *                         nothing to explain it — the absence is the beat
 *   02 built for learning the instruments arrive (evaluation, search depth, the
 *                         predicted line performed in phantom pieces, the
 *                         win/draw/loss trend) and a small rating gauge with them
 *   03 beyond analysis    the opponents come up behind Black, named and rated
 *   04 the goal           the camera leaves the board for that rating gauge, and
 *                         it climbs from beginner to grandmaster
 *
 * Scroll owns the camera, which instruments are on the board and who is on the
 * other side of it. The game itself runs on its own clock and is deliberately not
 * scrubbed — see the note on the two clocks in chess/chessScene.js. The reader is
 * watching something happen, not operating a diagram.
 *
 * There is no second reading surface below the pin: the argument used to be an
 * ordinary flowing column and is now inside the pinned scene, which is the
 * deliberate cost of making this one continuous shot (see the reduced-motion note
 * below, which is where that cost gets paid back).
 *
 * ── The five acts ────────────────────────────────────────────────────────
 *
 *   0  Dusk        The handover from the light feature chapter, unchanged: a
 *                  scrubbed nightfall band that takes near-white paper down to
 *                  the hero's #000106 before the stage pins.
 *
 *   1  The title   The pawn rises out of the dark under a shaft of light and
 *                  "why chessee?" wipes up into place around it, letter by
 *                  letter, as one oversized wordmark the figure stands inside
 *                  of — see the note on the two title layers below.
 *
 *   2  Rest        The settled frame, and the one the snapping parks an
 *                  arriving reader on. Held still — there used to be a pointer
 *                  response here (the shatter lens lifting the background into
 *                  glass shards under the cursor, the night's mask opening a
 *                  hole, the wordmark taking a specular sweep), which read as a
 *                  "hover to reveal" interaction on the title. It has been
 *                  removed: the frame simply holds until scroll takes over.
 *
 *   3  The descent Scroll takes over. The wordmark's letters wipe up out of
 *                  frame, the shatter goes screen-wide (baseStrength, no cursor
 *                  involved), the whole night fades off the board, and the pawn
 *                  zooms in hard and starts to fall. Colour begins draining out
 *                  of it.
 *
 *   4  Four beats  Four scroll-timed windows sharing the rest of the pin. Each
 *                  beat's index, kicker and body arrive in the middle of the
 *                  frame, hold, and give way, while the board changes *between*
 *                  them rather than under them. The pawn crosses to the rail as
 *                  the first beat opens and stands in the section indicator for
 *                  all four — the chapter's centrepiece *is* its index, rather
 *                  than becoming one on the way out.
 *
 *   5  Resolve     The thesis leaves, the rail and the figure on it go together,
 *                  the board dims out, and the frame resolves to flat #000106.
 *
 *   6  Threshold   Not part of the pin, and that is the point of it. The pin has
 *                  to release a screen before the next chapter's first row can
 *                  reach the top of the frame, so the stage spends that screen
 *                  rolling off — and the layer it rolls off with is the next
 *                  chapter's opening frame: the tone ramps to the pricing sky's,
 *                  that chapter's own star field is revealed from the bottom of
 *                  the frame up, and the light on the far side rises under both.
 *                  See the threshold timeline, and .why-threshold in the CSS.
 *
 * ── Motion personality ───────────────────────────────────────────────────
 * Premium, unchanged from the rest of the page: decelerating entrances, zero
 * overshoot, power2/power3 curves, entrances noticeably longer than exits. The
 * zoom at the top of act 3 is the one moment that reads as *sudden*, and it is
 * still an eased deceleration over roughly a third of the act — fast relative
 * to the fall around it, not a cut.
 *
 * ── The title, and the two layers it is made of ──────────────────────────
 * It was a particle field for a while, and a particle field is the wrong object
 * here for one specific reason: a few thousand loose dots have no edge, so the
 * word could neither pass behind the figure (the dots read as haze over it) nor
 * in front of it (the figure's shoulders swallowed a whole letter and the frame
 * read as "WHY C ESSEE?"). It ended up in front, at full opacity, sitting on the
 * one object the chapter is about.
 *
 * The wordmark solves the same problem the way a title sequence does. The word is
 * rendered *twice*, from the same markup at the same size, in two boxes either
 * side of the figure in z:
 *
 *   .why-title        z 3 — the solid fill, behind the pawn. The pawn occludes
 *                           it, which is the depth cue, and no part of the
 *                           figure is ever covered by ink.
 *   .why-title-ghost  z 6 — the identical word as a hairline outline, in front
 *                           of everything. Where the fill is visible the stroke
 *                           lands on the fill's own edge and disappears into it;
 *                           where the pawn has eaten a letter, the outline is
 *                           the only thing left, so the letterform continues
 *                           *across* the figure as a wireframe.
 *
 * That is the whole trick, and it is why the two layers must stay identical:
 * they are one word at one position, cut in half by the figure's z-index. Any
 * property that changes metrics (size, weight, tracking, the string itself) has
 * to be set on the shared `.why-mark` rule, never on one layer.
 *
 * Set lowercase in a heavy geometric sans at nearly the full width of the frame,
 * tightly tracked, flat near-white, no gradient and no shadow — the type is the
 * graphic, so anything applied to it is something else competing with the
 * figure. What went with the particles: the field's pointer repulsion. The
 * shatter lens is this chapter's single pointer response now, which is what it
 * should have been — two pointer reactions on one frame compete.
 *
 * ── Where the reveal actually comes from ─────────────────────────────────
 * Worth being explicit, because the obvious reading of "the background shatters
 * and the board shows through the cracks" does not survive contact with the
 * effect: <Shatter> captures the DOM beneath it into a texture and paints its
 * shards and its gaps *opaquely* over that same DOM, and it only works at all
 * where the experimental html-in-canvas API is available (Chromium behind a
 * flag today — see the header comment in Shatter.tsx). Neither the gaps nor the
 * effect's availability can be the thing the composition depends on.
 *
 * So the reveal is the night's own mask: `.why-night` is the flat opaque fill
 * that hides the board, and it carries a soft radial hole that follows the
 * pointer (act 2) and a fade that takes the whole broken frame away (act 3).
 * Where that hole opens, the content the shatter samples is transparent, so the
 * shards fade out around its edge and the lens reads as *causing* the opening.
 * On a browser without html-in-canvas the shards simply never appear and the
 * hole still opens onto the board — the sequence loses a layer of polish and
 * none of its meaning.
 */

interface Beat {
  id: string;
  index: string;
  kicker: string;
  body: string;
  /** The closing beat is the thesis, and is set in the display face. */
  thesis?: boolean;
}

const BEATS: Beat[] = [
  {
    id: "problem",
    index: "01",
    kicker: "The problem",
    body: "Most chess analysis platforms focus on finding the strongest move, but they often leave players wondering why that move is the best. As a result, many users end up memorising engine recommendations instead of truly understanding the position.",
  },
  {
    id: "learning",
    index: "02",
    kicker: "Built for learning",
    body: "Chessee is built for learning — not blind move-following. Instead of simply recommending the best move, it explains the tactical ideas behind it, evaluates how strong it is, highlights winning chances, and gives you clear insight into the position.",
  },
  {
    id: "beyond",
    index: "03",
    kicker: "Beyond analysis",
    body: "Beyond analysis, Chessee hands you powerful bots and deeper insight with far more game customisation — so you can play those bots while the analysis uncovers the secret behind every move.",
  },
  {
    id: "goal",
    index: "04",
    kicker: "The goal",
    body: "The goal isn't just to show you the best move. It's to help you understand why it's the best move — so you become a stronger chess player.",
    thesis: true,
  },
];

/* ── Pin budget, in viewport heights ─────────────────────────────────────
   Roughly five screens of pinned scroll, which is long — but this chapter is
   now the page's closing argument *and* its centrepiece effect, and the four
   beats have to be readable at scroll pace rather than flashing past. Each
   number is a span, not a position; the positions below are derived so a change
   to one act cannot silently overlap the next. */
/* The title card and the four beats are readable frames, so they are worth one
   readable frame's scroll each — the page's shared unit, not a number this
   chapter picks for itself (see pacing.ts).

   Both were under it. The title card had 0.7 of a screen, and the beats 0.85
   apiece against the feature story's full screen — which had it backwards: a
   beat here carries a kicker, a heading *and* a paragraph, where a feature
   story beat carries a heading and a list. The chapter reading fastest was the
   one with the most words on it. */
const TITLE_SPAN = BEAT_VH;
const DESCENT_SPAN = 0.6;
const BEAT_SPAN = BEAT_VH;
/* The chapter's closing act: the argument clears the frame and the board dims
   with it, then a flat fill raises to opacity 1 so the pin ends on a known,
   fully resolved tone rather than a scene still faintly dimmed.

   There used to be a "dive" inside this span — a lit hole opening onto a
   starfield, timed against the pin — and it is still gone. The handover lives
   *outside* the pin now, on the screen the stage spends rolling off the top,
   which is scroll distance the page is already paying for either way. So this
   act stays a resolve and costs nothing extra. See the threshold timeline. */
const RESOLVE_SPAN = 0.45;

const DESCENT_AT = TITLE_SPAN;
const BEATS_AT = DESCENT_AT + DESCENT_SPAN;
const RESOLVE_AT = BEATS_AT + BEAT_SPAN * BEATS.length;
const TOTAL = RESOLVE_AT + RESOLVE_SPAN;

/* ── The board's window, named rather than inlined ───────────────────────
   The resolve and the fade behind the blackout write the same channels on the
   same proxy object, so the second cannot begin before the first has finished.
   Inlined offsets had the tunnel this replaces overlapping by 0.095 of a scroll
   unit, and two tweens writing one property in an overlap resolve in whatever
   order the timeline happens to render them — so the state the frame resolved to
   depended on scroll velocity and on which direction the reader arrived from.
   Derived here so the hand-off cannot drift again when either act is retimed. */
const BOARD_OUT_AT = RESOLVE_AT + 0.04;
const BOARD_OUT_END = BOARD_OUT_AT + RESOLVE_SPAN * 0.9;

/** Where beat `i`'s window opens, in scroll units. */
const beatAt = (i: number) => BEATS_AT + i * BEAT_SPAN;
/* The frame in that window where the beat is fully set and nothing has begun
   to leave — the settled frame the snapping parks on. Slightly past the middle
   because the entrance is longer than the exit. */
const beatFocus = (i: number) => beatAt(i) + BEAT_SPAN * 0.6;

/* Act 2 is the title's settled frame: everything is in and the descent starts
   exactly here, which makes it both the snap target and where a nav jump to
   #why lands. Without it the title card is something a fling scrolls past. */
const TITLE_FOCUS = TITLE_SPAN;

/* One rest per readable frame. Every beat gets its own, which is what gives it
   a genuine hold rather than a smear: without them the reader's gesture would
   usually end mid-transition between two beats. */
const RESTS = [TITLE_FOCUS, ...BEATS.map((_, i) => beatFocus(i))].map(
  (at) => at / TOTAL
);
const HOLD = snapHold(TOTAL);

/* Inside the pinned timeline durations are *fractions of a scroll unit*, not
   seconds. Entrances run ~55% longer than exits, matched to the feature story
   so the page has one motion identity. */
const ENTER = 0.34;
const LEAVE = 0.22;

/* Seconds per character for the kicker typewriter, reused from the previous
   build — except that here it is scrubbed, so the label types itself as the
   reader scrolls into the beat. `steps(n)` is what keeps a character either set
   or not set; a fractional width slices the last glyph down its middle. */
const TYPE_RATE = 0.045;
const TYPE_MIN = 0.3;

/* ── Poses ───────────────────────────────────────────────────────────────
   x/y are fractions of the travel the figure actually has at its current size
   (see ThinkPose), so these read the same on a 2:1 laptop and a portrait phone.

   The sequence is: rise into the title, get rushed at by the camera, tip into a
   fall, and end up on the rail as the chapter's index. The first and the last are
   solved from the DOM (see titleSeat and railPose) because both aim the figure at
   a box the stylesheet lays out; the two in between are authored, because there is
   nothing in the frame for them to hit. */
/* Centred, inside the title, and already in its resting pose, not rising into
   it: the figure used to start yawed away and small (ry -0.55, scale 0.72) and
   tween up to this pose across the first 70% of the title's scroll span, which
   read as the model performing its own entrance while the type wiped in around
   it. That scroll-driven journey is gone — START_POSE now equals TITLE_POSE, so
   the tween below is a no-op and the reader arrives to the thinking pawn
   already standing in place, centred in "why chessee?", with only the title's
   own letter wipe left to animate.

   Centred on the stage's true middle, not on the gap between the two words. The
   figure is meant to *interlock* with the wordmark: the fill layer sits behind it
   and the outline layer in front (see the class header note above), so wherever
   the silhouette crosses a letter, that letter keeps going as a wireframe through
   the figure — that cut-in-half look is the whole trick. A pawn standing in the
   1em gap barely reaches it: the gap is sized so the figure clears the
   letterforms, at most grazing the "y" descender and the foot of the "c". Sitting
   it on the stage's true centre instead — pose.x = 0 — puts it across "chessee?"'s
   leading strokes, which is where the interlock actually reads.

   x = 0 is only the *authored* fallback, for before the wordmark has painted or
   under reduced motion. Once it has, titleSeat measures the rendered frame every
   refresh and overrides this with the stage's live centre — see titleSeat, which
   has the arithmetic. */
const START_POSE: ThinkPose = {
  ry: 0.14,
  rx: 0.02,
  scale: 1,
  x: 0,
  y: 0.01,
};
const TITLE_POSE: ThinkPose = {
  ry: 0.14,
  rx: 0.02,
  scale: 1,
  x: 0,
  y: 0.01,
};
/* The zoom. Not a new position — the same pose rushed toward the camera, which
   is what makes it read as the frame lunging at the figure rather than the
   figure walking forward. */
/* 1.6 rather than the 1.9 this started at: past about 1.65 the crown and the
   base are both outside the frame, and the crop takes the face with it — which
   is the one thing this model exists for. */
const ZOOM_POSE: ThinkPose = {
  ry: 0.4,
  rx: -0.05,
  scale: 1.6,
  x: 0,
  y: -0.04,
};
/* Tipping into the fall. Pitch does the tumbling rather than yaw: past about
   2 rad of yaw this model shows the back of its head, and the face is the whole
   reason it is this model. */
/* Off-centre and small, and both are legibility fixes rather than composition
   ones. The figure is deliberately the nearer layer, so anything it occupies is
   space the copy cannot have — and the copy is now a centred block up to 720px
   wide, where it used to be a column held to the left gutter.

   The old numbers were solved for that column: a quarter of the available travel
   to the right, at 0.66 scale, put the figure in the half of the frame the copy
   did not use. Against a centred block they put a lit silhouette straight through
   the middle of every paragraph — measured on a 1440px frame, the figure's own
   ~300px and the copy's centre were the same pixels, and whole words were being
   covered.

   So it goes further out, higher, and much smaller — measured against the rendered
   frame rather than estimated, because the first attempt at this was estimated and
   was still clipping the ends of the longest lines. What decides it is not the
   block's 720px box but the copy's own measure inside it: the body is held to 46
   characters (see .why-beat-body), which resolves to about 450px, so the copy's
   right edge is ~225px from the centre and everything past that is free. At 0.24
   scale the figure is ~85px wide, and 0.76 of the travel puts it a clear 70px past
   the measure's right edge at every width the clamp resolves to.

   Note what this pose now *is*: the last frame of the fall and the first frame of
   the crossing, held for no scroll at all. It used to be where the figure lived
   for three of the four beats, which is what the paragraph above was solving for;
   the figure is on the rail from the first beat now, so the clearance matters only
   while the fall is passing through here. It is kept measured anyway — the fall's
   terminal frame is a frame a reader can stop on, and the beats' copy is already
   arriving underneath it. */
const FALL_POSE: ThinkPose = {
  ry: 1.02,
  rx: 0.34,
  scale: 0.24,
  x: 0.76,
  y: 0.36,
};
/* ── Where the fall ends ─────────────────────────────────────────────────
   Not in a vanishing point any more. The figure used to be aimed at the eye of
   the light tunnel and to disappear into it, which was the right ending for a
   chapter whose background was a shaft; the background is now a board being
   analysed, and a figure vanishing into the middle of it would be an ending
   borrowed from a scene that is no longer there.

   So it lands on the rail instead — the four marks in the top right that report
   which beat the reader is on. The figure crosses the frame as the first beat
   opens, shrinks to the size of a marker, and comes to rest inside the indicator,
   where it spends all four beats breathing and answering the pointer. The
   chapter's centrepiece *is* its index, which is the one place a small live
   object earns its keep.

   It used to make that crossing on the *last* hand-off, and spend the three beats
   before it drifting mid-frame — which left the figure reading as a loose object
   near the indicator rather than as part of it for most of the chapter, and put
   the one frame where the two were a single object in the last few hundred pixels
   of the pin. Arriving at the front means the indicator is a piece standing on a
   marked square for the whole argument, and the drift that filled those three
   beats has nothing left to fill.

   Only the rotation and the scale are stated here. The position is measured off
   the rail itself (see railPose), because the rail is laid out in CSS — a gutter
   that clamps, a top offset in svh, and a different arrangement entirely below
   the narrow breakpoint — and any pose written down here would be a second,
   silently wrong copy of that layout. */
const RAIL_POSE: ThinkPose = {
  /* Round to face the reader again. The fall turned the figure away; arriving as
     an index it has to be legible as a piece, at a size where the silhouette is
     nearly all there is to read. */
  ry: 0.24,
  rx: 0.06,
  /* Marker size, and the number is set by what it stands next to rather than by
     the title it came from — except that what it stands next to has changed, so
     this has moved with it.

     It was 0.08, or about 24x40px, and that was solved against a rail whose rows
     were 24px apart and whose current row was marked by a lit 6px dot. The piece
     had to be small enough not to span three rows and quiet enough not to compete
     with the dot. Both of those constraints have gone: the rows are now spaced to
     the figure (see .why-rail-dots) and the dot has given up being a highlight and
     become a hairline notch (see .why-rail-dot i), precisely so that the piece can
     be the mark.

     So it is sized to be *read* instead — 0.115 is ~33x57px on a 720px frame, which
     is the smallest this model reads as a chess piece rather than as a light grey
     blob. Below about 0.1 the crown's flare and the neck stop separating and the
     silhouette collapses; the figure was legible in the abstract and unidentifiable
     in practice, which is a poor return on a live WebGL context.

     The number is a fraction of the frame's height (0.69 × height × scale), so it is
     the same proportion at every viewport — which is what lets the rail's own svh
     step stay in agreement with it. */
  scale: 0.115,
  /* Both overridden per viewport and per beat by railPose() below. These are only
     what the reduced-motion branch and any non-scrubbed read would see. */
  x: 0.8,
  y: 0.72,
};

/* ── Turning pixels back into pose units ─────────────────────────────────
   ThinkPose's x/y are fractions of the travel the figure *has*, not of the frame:
   its own projected half-extent and a margin come off the half-frame first (see
   the travelX/travelY note in ThinkingModel). So a landing point measured in
   pixels has to be divided back through that, and the figure's own size cannot be
   dropped from the arithmetic — leaving it out lands the pawn a clear 40px short
   of the mark it is aiming at, which reads as a near miss rather than as a hit.

   MARGIN_X / MARGIN_Y are the renderer's own margins. FIGURE_TOP and FIGURE_SIDE
   are the model's half-extents at scale 1, as fractions of the frame's half-height
   — that unit rather than half-*width* because the renderer normalises the model
   to a height (MODEL_HEIGHT against the camera's vertical extent, which is where
   the 0.69 comes from), so both of them scale with the frame's height whatever its
   aspect. FIGURE_SIDE is the narrower of the two: the pawn is roughly half as wide
   as it is tall.

   Both are solved from the asset rather than eyeballed, and the numbers are worth
   writing down because they are checkable: `gltf-transform inspect` reports the
   export at 97.793 units tall and 53.476 across its widest axis (z), the renderer
   normalises that height to MODEL_HEIGHT and the camera sees halfH = tan(19°) × 6
   = 2.0660 at the pivot plane. So FIGURE_TOP = (2.86 / 2) / 2.0660 = 0.692 and
   FIGURE_SIDE = (53.476 / 2 × 2.86 / 97.793) / 2.0660 = 0.378. FIGURE_SIDE was
   0.4, which is the estimate the sentence above describes; it cost ~10px of travel
   at 1440x900 and is only ever wrong in the direction of an under-reach. */
const MARGIN_X = 0.06;
const MARGIN_Y = 0.05;
const FIGURE_TOP = 0.692;
const FIGURE_SIDE = 0.378;

/* The renderer's aspect taper, restated. ThinkingModel multiplies every pose's
   scale by this before it places the figure — see `fitScale` there — so a travel
   budget solved without it is wrong by the taper on any frame narrower than 4:3.
   Both callers below aim the figure at a box measured in the DOM, where being
   wrong by 3% is a visible miss rather than a rounding error. ThinkingModel's copy
   is the original; this one exists because the two live in different units and
   neither can read the other's. */
const fitScaleFor = (w: number, h: number) =>
  0.56 + 0.44 * Math.min(1, w / h / 1.35);

/** The figure's travel in px, at a given pose scale, inside a frame of `w` x `h`. */
const travelFor = (w: number, h: number, scale: number) => {
  const s = scale * fitScaleFor(w, h);
  return {
    x: Math.max(1, (w / 2) * (1 - MARGIN_X) - FIGURE_SIDE * (h / 2) * s),
    y: Math.max(1, (h / 2) * (1 - MARGIN_Y) - FIGURE_TOP * (h / 2) * s),
  };
};

/* ── Calibration ─────────────────────────────────────────────────────────
   Two numbers that close the gap between where the pose above says the figure goes
   and where it actually lands, measured against the rendered frame rather than
   derived: the renderer's own geometry — where the model's origin sits inside its
   silhouette, what its bounding box measures — is not knowable from out here, and
   a formula that pretends otherwise is a guess with arithmetic around it.

   Both are now zero, and that is a result rather than a placeholder. They used to
   carry an 18px push down and a 6px push right, which between them were doing two
   different jobs: standing the piece on the lip of a ring that no longer exists,
   and correcting a landing that had been measured while it was still moving. The
   renderer eases its displayed transform toward the target by a fixed fraction per
   frame, so a reading taken mid-flight reports the trajectory, not the destination
   — and with the old timing the crossing finished a tenth of a scroll unit before
   the frame it was measured on. Re-measured settled, travelFor's estimate is
   accurate to a pixel or two on both axes at 1152x720, 1440x900 and 430x860.

   Kept as named constants rather than deleted because the thing they express is
   still a real risk: the pose is solved from a DOM box, the figure is drawn by a
   renderer that knows nothing about that box, and any change to the model, the
   camera or the seat's size can reopen the gap. Stated in pose units, which is
   what makes a correction hold at every viewport — pose units and the figure's
   height are both fractions of the frame's height, so the ratio between them does
   not move when the frame does. */
const RAIL_LIFT = 0;
const RAIL_NUDGE = 0;

/* Where a seat on the rail is, in ThinkPose units. Read off the DOM rather than
   authored, and re-read on every refresh, so the figure sits on its dot at every
   viewport and in the narrow layout where the rail is a row along the top instead
   of a column down the side.

   Called per frame from pushRide rather than wired into a tween as a function
   value. That is deliberate and it is load-bearing — see the note on the ride
   channel for what a tween that caches this measurement does when it happens to
   cache it on the wrong frame. */
const railPose = (
  stage: HTMLElement | null,
  seat: HTMLElement | null
): { x: number; y: number } => {
  if (!stage || !seat) return { x: RAIL_POSE.x, y: RAIL_POSE.y };
  const frame = stage.getBoundingClientRect();
  const box = seat.getBoundingClientRect();
  if (!frame.width || !frame.height) return { x: RAIL_POSE.x, y: RAIL_POSE.y };

  /* Offset from the frame's centre, because that is where a pose of 0, 0 puts the
     figure. Signs: pose x grows right like the screen, pose y grows *up* where
     the screen grows down. */
  const dx = box.left + box.width / 2 - (frame.left + frame.width / 2);
  const dy = box.top + box.height / 2 - (frame.top + frame.height / 2);

  const travel = travelFor(frame.width, frame.height, RAIL_POSE.scale);
  const clamp = gsap.utils.clamp(-1, 1);
  return {
    x: clamp(dx / travel.x + RAIL_NUDGE),
    y: clamp(-dy / travel.y - RAIL_LIFT),
  };
};

/* ── Where the figure stands in the title ────────────────────────────────
   Between the words, and measured off the type rather than stated as a constant.

   It *was* a constant: -0.48, fitted at 1440x900 and 1152x720, on the reasoning
   that the word gap's offset from centre and the figure's travel both scale with
   the frame, so one ratio would hold at every size. They do both scale with the
   frame — but not with each other, and the reason is one line of the stylesheet:
   `.why-mark` is sized `min(12.2vw, 27svh)`. On any frame where the svh term wins,
   the type stops growing with the width while the travel carries on, and the ratio
   between them moves. Solved against the rendered frame, the correct value runs
   from -0.42 at 16:10, to -0.40 on a 1920x945 window, to -0.34 on a 3440x1400
   ultrawide — a spread of well over a hundred pixels, which on this composition is
   the difference between standing between the words and standing through one of
   them. Short landscape frames are not an edge case either: a maximised 1920x1080
   browser is already past the hinge.

   The mark's metrics move it too, and by more than the viewport does — the offset
   is exactly half the difference between the two words' widths, so a different face
   is a different seat. The whole composition is "one word cut in half by the
   figure's z-index", so the figure has to be where the cut is *in the type that
   actually rendered*, which before Inter lands is the fallback face.

   So it is read off the fill layer's own word boxes, the same way railPose reads the
   rail, and for the same reason: the gap is a fact about the rendered type, and the
   only thing that knows where it is, is the type.

   ── And the size, for the same reason ──
   The figure is sized against the type rather than against the frame, which is the
   other half of the same fix. Its scale used to be a flat 1 — 69% of the frame's
   *height* — while the mark is sized off the width, so the two only agreed on
   frames where the vw term won at around 16:10. On a tall frame the type is held
   down by the width while the figure keeps growing with the height, and the
   composition inverts: measured at 768x1024 the pawn stood ~620px tall behind a
   94px wordmark, which is not a figure standing in a word, it is a figure with some
   type on it.

   FIGURE_TO_MARK is that agreement written down: the figure's height as a multiple
   of one glyph box. 2.8 is not a taste call — it is what the desktop composition
   already was (a 623px figure against a 222px box at 1440x900), so every frame now
   resolves to the proportion the design was actually approved at. Clamped at 1
   because 1 is the authored hero size and there is no reason for the figure to be
   *larger* than the frame was built for; wide short frames all resolve above it.

   One solver, several consumers, and that is the point: the pose wants fractions of
   travel, the shaft of light wants a CSS length, and on a narrow frame the type
   itself has to move. All three come out of this one measurement, so none of them
   can end up disagreeing about where the figure is. */
const FIGURE_TO_MARK = 2.8;
const FIGURE_MIN = 0.45;
/* How far above the stacked mark the figure's feet sit, as a fraction of the
   frame's height. */
const STACK_GAP = 0.05;

interface TitleSeat {
  x: number;
  y: number;
  scale: number;
  /** The seat's horizontal offset from the stage's centre, in px. */
  px: number;
  /**
   * How far the mark itself has to move off its centred position, in px, for the
   * figure and the type to be one vertically balanced lockup. Always 0 on a frame
   * wide enough for the mark to be one line, where the figure stands *in* the word
   * and the word does not move at all. Consumed as --why-mark-y.
   */
  markY: number;
}

const titleSeat = (stage: HTMLElement | null): TitleSeat => {
  const authored = {
    x: TITLE_POSE.x,
    y: TITLE_POSE.y,
    scale: TITLE_POSE.scale,
    px: 0,
    markY: 0,
  };
  const frame = stage?.getBoundingClientRect();
  if (!stage || !frame?.width || !frame.height) return authored;

  const words = stage.querySelectorAll<HTMLElement>(
    `.why-mark-fill .why-mark-word`
  );
  const a = words[0]?.getBoundingClientRect();
  const b = words[1]?.getBoundingClientRect();
  /* Nothing on the page to measure yet. Falls back to the authored pose, which is
     still the right answer at the proportion it was fitted at. */
  if (!a || !b) {
    const travel = travelFor(frame.width, frame.height, TITLE_POSE.scale);
    return { ...authored, px: TITLE_POSE.x * travel.x };
  }

  const fit = fitScaleFor(frame.width, frame.height);
  /* The figure's height in px at pose scale 1 — FIGURE_TOP is its half-extent as
     a fraction of the frame's half-height, so the two halves cancel. */
  const fullHeight = FIGURE_TOP * frame.height * fit;
  const scale = gsap.utils.clamp(
    FIGURE_MIN,
    1,
    (FIGURE_TO_MARK * a.height) / fullHeight
  );
  const travel = travelFor(frame.width, frame.height, scale);
  const midY = frame.top + frame.height / 2;

  /* Stacked rather than spaced. Below 620px the mark is a flex column (see the
     narrow-frame block in the stylesheet), and the test for it is exact rather
     than a tolerance: both words are centred, so the second can only begin to the
     left of where the first ends if they are on different lines. The vertical test
     this replaces did not work — the column closes its leading up with a -0.2em
     margin, so the second line's box starts *above* the first line's bottom, and a
     phone was being measured as one long line with a gap in the middle of "why".

     There is no gap to stand in here, so the composition changes rather than
     shrinks: the figure stands *above* the words, and the two are solved together
     as one block centred in the frame. Both halves have to be solved at once
     because neither fits in a slot the other does not know about — a fixed CSS
     offset for the type was tried first and it cannot work, since the space the
     figure needs above it is a function of the figure's size, which is a function
     of the type's size. At 620x900 the figure's head was cropped off the top of the
     frame by the same padding that balanced it at 430x860.

     Solved from the mark's *centred* position rather than its current one, which is
     what keeps this from feeding back on itself: the answer does not depend on the
     offset the last pass wrote. */
  if (b.left < a.right) {
    const markH = Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top);
    const figureH = fullHeight * scale;
    const gap = frame.height * STACK_GAP;
    const blockTop = frame.top + (frame.height - (figureH + gap + markH)) / 2;
    return {
      x: 0,
      y: gsap.utils.clamp(-1, 1, (midY - (blockTop + figureH / 2)) / travel.y),
      scale,
      px: 0,
      /* Where the type has to go, against where a centred mark would have sat. */
      markY: blockTop + figureH + gap - (midY - markH / 2),
    };
  }

  /* The stage's own centre, not the gap's. The figure is meant to interlock
     with the wordmark — the fill layer sits behind it and the outline layer
     in front (see the class header above), so wherever the silhouette
     crosses a letter, that letter keeps going as a wireframe through it. A
     pawn parked in the 1em gap barely reaches that trick at all: at most it
     grazes the "y" descender and the foot of the "c". Standing it on the
     title's true midpoint instead puts it across "chessee?"'s leading
     strokes, where the cut-in-half letterform is actually visible — which is
     `px = 0`: pose.x is a fraction of travel measured from the stage's own
     centre, so leaving it at 0 is what lands the figure there. */
  return {
    x: 0,
    y: TITLE_POSE.y,
    scale,
    px: 0,
    markY: 0,
  };
};

/* ── Layer configuration ─────────────────────────────────────────────────
   A module constant rather than an inline object: <Shatter> diffs its options on
   every render, so a fresh object literal per render would mean re-uploading
   uniforms and waking a settled render loop for nothing. */
const SHATTER: ShatterOptions = {
  /* A little tighter than the demo's 0.4: the lens is one of two things
     happening under the cursor here (the night's hole is the other), and at 0.4
     it covered enough of the frame that the reader could not see it as local. */
  radius: 0.34,
  softness: 0.62,
  tileSize: 132,
  shards: 1,
  corner: 0,
  lift: 34,
  tilt: 2,
  scatter: 6,
  perspective: 1400,
  /* The void behind a lifted shard is the stage's own base tone, not black:
     anything darker draws a hole in a surface that is already nearly black. */
  gapColor: [0, 0.004, 0.024],
  shadow: 0.55,
  shading: 0.6,
  refraction: 1.4,
  dispersion: 0.26,
  floatSpeed: 1.6,
  strength: 1,
  baseStrength: 0,
  followSpeed: 2.6,
};

/* ── The board's state at each hand-off ──────────────────────────────────
   Six channels are driven across five consecutive acts, each picking up where
   the last left off: the descent brings the board out from behind the night, the
   first beat plays best moves on a bare board, the second puts the instruments
   on it, the third brings the opponents in, the fourth leaves the board for the
   rating gauge, and the resolve takes it all off again.

   Every one of the tweens below states both of its endpoints, and that is not
   tidiness. A `to` on a scrubbed timeline infers its start from whatever the
   target holds the first time it renders, and on a scrubbed timeline that first
   render happens at whichever playhead the reader arrives at — a rail jump, a
   resize (invalidateOnRefresh wipes the recorded values), a reload with the
   scroll position restored. The target here is a plain object that keeps the last
   frame's numbers, so an inferred start could be a *later* act's state, and the
   camera would fly in from somewhere new on every visit.

   Which is what these are for. GSAP writes a tween's start values into the target
   whenever the playhead moves back before it, so a stated start that disagreed
   with the previous act's end would be a jump in the frame rather than a fix —
   the joins have to be written down once, in one place, and derived from each
   other. Fractions of a state rather than six loose numbers per act.

   `elo` is deliberately *not* in here. It is the one channel with a single tween
   of its own (see act 4), and a channel that appears in these states as well
   would be written by two tweens in the window where they overlap — which
   resolves by render order, which flips with scroll direction. One channel, one
   author. */

/** Act 1-2: behind the night. Nothing on the board, and no one looking at it. */
const BOARD_DARK = {
  beat: 0,
  instruments: 0,
  gauge: 0,
  bots: 0,
  preview: 0,
  dim: 0,
};
/* Act 3: the night comes apart and the board is what is behind it. Held back a
   little, because the argument's copy arrives on top of it in the same act.

   Barely at all, though, and that is a correction made three times. These started
   half again as high, on the reasoning that a board at full exposure is the
   brightest thing in the frame. It is — but the copy is not read against the whole
   frame, it is read against the ground directly behind it, which does that job
   locally and at full strength. Dimming the scene as well was paying twice, and what
   it bought was a chapter whose centrepiece was hard to make out.

   Halved again in this pass, and the third correction is the one that finally has a
   reason rather than a judgement behind it: on a wide frame the copy is no longer
   over the board at all. It is a column down the left with a directional ramp behind
   it (.why-scrim) and the camera composes the subject into the right of the frame
   (placeSide in chess/chessScene.js), so there is no longer any pixel that is both
   'behind the copy' and 'on the board'. A global exposure cut protects nothing at
   that point; it just takes a stop off the thing the chapter is about.

   Not taken to zero, and that is not timidity. `dim` is also what gives the four
   beats a shape — the frame settles very slightly as each statement arrives and lifts
   again on the closing shot — and on a narrow frame the copy *is* still over the
   board, where the ramp does not run. A tenth of a stop is enough for both jobs and
   invisible as a defect in either. */
const BOARD_OPEN = { ...BOARD_DARK, dim: 0.05 };
/* Beat 01, the problem. Still nothing on the board but a move being suggested and
   played — the absence *is* the beat, so this state's job is to hold the frame
   empty while the copy says why that is not enough. */
const BOARD_PROBLEM = { ...BOARD_OPEN, dim: 0.06 };
/* Beat 02, built for learning. The instruments arrive, the predicted line starts
   being performed in phantom pieces, and the rating gauge comes up in the corner.
   A step further back again: there are now four lit cards in the frame and four
   sentences to read over them. */
const BOARD_LEARN = {
  ...BOARD_PROBLEM,
  beat: 1,
  instruments: 1,
  gauge: 1,
  preview: 1,
  dim: 0.1,
};
/* Beat 03, beyond analysis. The opponents come up behind Black. */
const BOARD_BOTS = { ...BOARD_LEARN, beat: 2, bots: 1 };
/* Beat 04, the goal. The camera leaves the board for the gauge, and the four
   analysis cards leave with it — at that distance an evaluation bar in the near
   foreground is larger and brighter than the card being read. The opponents are
   held at a trace rather than cut, so the frame the camera is leaving is still
   populated. Brought back up to nearly full exposure: this shot has one subject
   and the reader is being asked to read it. */
const BOARD_GOAL = {
  ...BOARD_BOTS,
  beat: 3,
  instruments: 0,
  bots: 0.3,
  preview: 0,
  /* Held *further* back than the beats, not less — the one place in the chapter
     where dimming the scene is the right instrument. The camera is four units from
     the gauge and the board is eight behind it, so the board is in the near
     foreground of a close-up: at the beats' exposure it is a wall of lit tiles
     behind the one card the reader is being asked to read.

     Untouched by the pass that halved the three above it, for exactly that reason.
     Those were protecting copy the layout no longer puts over the board; this one is
     separating a foreground subject from a background, which is a compositional job
     and does not care where the copy sits. */
  dim: 0.4,
};
/* Act 5: everything off, before the light comes up. */
const BOARD_GONE = { ...BOARD_GOAL, gauge: 0, bots: 0, dim: 0.72 };

/* ── The rating's own climb ──────────────────────────────────────────────
   Beginner to grandmaster, and the only numbers in the chapter that are a claim
   about the reader rather than about the product.

   Both ends are inside the gauge's own scale rather than at its stops (it runs
   600-2600), which is what keeps the bar from reading as already begun at one end
   and finished at the other. */
const ELO_FLOOR = 780;
const ELO_PEAK = 2500;

/* ── The wordmark ────────────────────────────────────────────────────────
   Lowercase, because that is what makes it read as a mark rather than as a
   headline: caps at this size are a row of equal-height slabs and the eye reads
   the block before it reads the word, whereas lowercase gives the silhouette
   ascenders and a descender to hang the word on. The question mark stays — the
   chapter is a question and the whole argument below answers it. */
const TITLE_TEXT = "why chessee?";

/* Both layers at once, always. `.why-mark` is on the fill and on the ghost, so
   every tween written against these selectors keeps the outline welded to the
   type it traces — which is the one invariant the effect depends on. */
const MARK = ".why-mark";
const GLYPH = ".why-mark .why-glyph i";

/* The word's ambient shadow — what sits it *on* the darkness rather than in front
   of it. Authored here rather than in the stylesheet because the timeline animates
   `filter` on the same element and both ends of that tween have to state the same
   function list; see the starting frame. Wide and soft, offset down, because the
   chapter's light comes from above (.why-shaft). */
const MARK_SHADOW = "drop-shadow(0 0.03em 0.09em rgba(0, 4, 12, 0.85))";

/* Delay per letter, in scroll units, resolved from the glyph's own index rather
   than from its position in the query — see the note on `data-g`. */
const glyphStagger =
  (step: number) => (_i: number, target: Element) =>
    Number((target as HTMLElement).dataset.g ?? 0) * step;

/* One layer of the mark: a clip box per glyph so each letter can wipe up out of
   its own edge, wrapped a word at a time so the two words stay whole, in a
   full-frame box that centres it. Three of these make the title — plate, sheen
   and outline — and they are identical by construction, which is the invariant
   the whole effect rests on.
  
   `data-g` is the glyph's index in the whole string, and it is the reason this is
   an attribute rather than DOM order: the mark is rendered twice (see the header
   note) and the timeline staggers both layers with one tween, so the delay has to
   be a function of *which letter this is* and not of where the element sits in a
   flat query of the document. Without it the ghost layer's letters would all run
   a full string-length behind the fill's and the outline would visibly lag the
   type it is supposed to be welded to.
  
   Decorative in both layers: the accessible name is a single hidden copy of the
   question inside the <h2> (see the render), because a screen reader handed
   twelve one-letter boxes reads twelve letters. */
const titleLayer = (variant: "fill" | "sheen" | "line") => {
  let g = 0;
  return (
    <span
      className={`why-title-layer why-title-${variant}`}
      aria-hidden="true"
    >
      <span className={`why-mark why-mark-${variant}`}>
        {TITLE_TEXT.split(" ").map((word, w) => (
          <Fragment key={`w-${w}`}>
            {w > 0 ? <span className="why-mark-gap"> </span> : null}
            <span className="why-mark-word">
              {word.split("").map((ch, i) => (
                <span className="why-glyph" key={`${ch}-${i}`}>
                  <i data-g={g++}>{ch}</i>
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
};

/* Words as their own clip boxes, with real spaces between them so the
   paragraph is still a paragraph to a screen reader — no aria-hidden copy, no
   duplicated text. Only the thesis is split this way: it is two short
   sentences, and a wipe across 40 words of body copy reads as a loading
   state. */
const splitWords = (text: string) =>
  text.split(" ").map((word, i) => (
    <Fragment key={`${word}-${i}`}>
      {i > 0 ? " " : null}
      <span className="why-tword">
        <i>{word}</i>
      </span>
    </Fragment>
  ));

/* Body copy is split into plain inline boxes rather than clip boxes: at this
   size a paragraph runs several lines, and `overflow: hidden` per word across
   four paragraphs is a lot of layout for an effect the reader reads as a fade
   with lift. */
const splitBody = (text: string) =>
  text.split(" ").map((word, i) => (
    <Fragment key={`${word}-${i}`}>
      {i > 0 ? " " : null}
      <span className="why-bword">{word}</span>
    </Fragment>
  ));

export default function WhySection() {
  const sectionRef = useRef<HTMLElement>(null);
  /* The pin is triggered off the stage, not the section: the section starts
     with the dusk band, so a section-triggered `top top` would fix the stage in
     place while it was still a few hundred pixels below the fold. */
  const stageRef = useRef<HTMLDivElement>(null);
  const duskRef = useRef<HTMLDivElement>(null);
  const beatsRef = useRef<HTMLOListElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);

  /* Live state the renderers read every frame. GSAP scrubs these numbers and
     ThinkingModel eases its displayed transform toward the pose, which is where
     the figure's weight comes from; the dither uniforms are written straight
     through, since the timeline already owns their easing. */
  const poseRef = useRef<ThinkPose>({ ...START_POSE });
  const ditherRef = useRef<DitherState>({
    grayscale: 0,
    invert: 0,
    dither: 1,
  });
  const contactRef = useRef<HTMLSpanElement>(null);

  /* The seats: one empty box per dot, marking where the figure sits while that
     dot is the current one. Measured rather than authored, because the rail is
     laid out in CSS and rearranges entirely below the narrow breakpoint — see
     railPose.

     Queried rather than held in a ref array, and re-queried on every read: these
     are only ever looked up from inside GSAP function values, which run at
     refresh time on an already-mounted rail, and four callback refs would be
     four more things to keep in step with BEATS for no gain. */
  const seatAt = (i: number) =>
    railRef.current?.querySelectorAll<HTMLElement>(".why-rail-seat")[i] ?? null;

  /* Imperative handles on the two effects that are driven by scroll at frame
     rate. Neither goes through React state to get there — see the notes in each
     component. */
  const boardRef = useRef<ChessSceneHandle>(null);
  const shatterRef = useRef<ShatterInstance | null>(null);
  /* The timeline's writer for the board's channels, published out of the GSAP
     context so the mount effect below can call it. The board is the one layer
     that arrives *after* the timeline that drives it (it is deferred until the
     chapter is within a screen and a half — see boardReady), and a scene that
     mounts holding its own defaults while the playhead is parked in the closing
     act shows an empty board from behind White until the reader nudges the wheel.
     The frame has to be a function of scroll position, not of what mounted
     when. */
  const pushBoardRef = useRef<() => void>(() => {});

  /* The composition itself changes under `prefers-reduced-motion`, not just its
     timing: there is no pin, no fall and no WebGL board, and the four beats
     have to be an ordinary stacked block of prose. That is a rendering
     decision, so it is resolved here rather than inside the GSAP context —
     mounting three animation-only WebGL contexts and then reverting them would
     be the expensive way to say "none of this". */
  const [motion, setMotion] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setMotion(!query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /* The board is a third WebGL context in one section, and browsers cap how many
     a page may hold at once — over the cap the oldest is evicted, which is how the
     hero's figure ends up as a blank canvas two chapters later. It is also by some
     distance the most expensive of the three (a lit board, thirty-two shadowed
     pieces, six instrument cards and five plaques) and nobody sees it until the
     descent, so it is mounted only once the chapter is within a screen and a half.
     Latched: it never unmounts once mounted, because tearing a GL context down and
     rebuilding it while the reader scrolls back and forth is worse than holding
     it. */
  const [boardReady, setBoardReady] = useState(false);

  useEffect(() => {
    if (!motion) return;
    const section = sectionRef.current;
    if (!section) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setBoardReady(true);
          io.disconnect();
        }
      },
      { rootMargin: "150% 0px" }
    );
    io.observe(section);
    return () => io.disconnect();
  }, [motion]);

  /* And once it is here, hand it the frame the reader is actually on. The
     timeline owns every channel the scene reads and writes them from tween
     callbacks; every one of those writes before this mount went to a null ref.
     Runs after the child's own effects (React commits children first), so it lands
     on top of the defaults the scene seeds itself with rather than under them. */
  useEffect(() => {
    if (boardReady) pushBoardRef.current();
  }, [boardReady]);

  /* The other half of boardReady's lifecycle: this chapter runs three live
     WebGL contexts (the board, the shatter pass, the pawn) at once, latched
     open forever the moment they build — correct while the reader is
     anywhere near the chapter, wasteful once they are not. See useFarPast for
     the full reasoning; releasing at 4 viewports past the section and
     re-arming only within 2.5 keeps this from firing while the reader is
     merely scrolling through the chapter's own five-screen pin. */
  const farPast = useFarPast(sectionRef, 4, 2.5);

  /* boardReady only ever turns on; farPast can turn back off (the reader
     scrolled back near the chapter), which has to re-run the same "hand it
     the current frame" push the mount above does — otherwise a rebuilt board
     comes back showing its own seeded defaults instead of wherever the
     timeline's playhead actually is. */
  useEffect(() => {
    if (boardReady && !farPast) pushBoardRef.current();
  }, [boardReady, farPast]);

  /* ── The threshold's sky ───────────────────────────────────────────────
     The handover mounts the pricing chapter's star field a section early (see
     layer 8 in the markup), and that field is three full-frame canvases with a
     draw loop behind them.

     Held back until the chapter is nearly over, and this is deliberately *not*
     useNearViewport's question. That hook asks whether a layer's own box is
     coming into view, and this layer's box is inside the pinned stage — so it
     is on screen, and the engine's own IntersectionObserver would have it
     drawing, from the moment the pin engages, six screens before anything can
     see it. The engine's note is that at most one of the page's two fields is
     ever in frame; this is what keeps that true, and it is the difference
     between a second field and a second field running underneath a live chess
     scene for the length of the argument.

     So it is measured against the section's last row instead, because that row
     *is* the handover: 2.5 viewports of notice before it reaches the fold is the
     pin's closing acts, which is more warning than anything else on the page
     gets. Latched, like the board — a field that tore itself down and rebuilt
     as the reader crossed the join would be both expensive and visible — and it
     fails open, because a deferral is an optimisation and being wrong about one
     must never be why something is missing. */
  const [skyReady, setSkyReady] = useState(false);

  useEffect(() => {
    if (!motion || skyReady) return undefined;

    const section = sectionRef.current;
    if (!section) {
      setSkyReady(true);
      return undefined;
    }

    /* `progress > 0` rather than `isActive`, so arriving from below — a reload
       partway down the page, or a nav jump that lands past the chapter — builds
       the field instead of waiting for the reader to scroll back into a range
       they are already beyond. */
    const arm = (self: ScrollTrigger) => {
      if (self.isActive || self.progress > 0) setSkyReady(true);
    };

    const trigger = ScrollTrigger.create({
      trigger: section,
      start: "bottom bottom+=250%",
      end: "bottom top",
      /* Fires as part of creation, so a trigger already inside or past its range
         at setup resolves on the spot. */
      onRefresh: arm,
      onToggle: arm,
    });

    return () => trigger.kill();
  }, [motion, skyReady]);

  /* The rail's index is navigation, not decoration: each dot takes the reader
     to the settled frame of its beat, resolved from the pin's live range
     because that range moves as the code-split chapters above it arrive.
     glideToOffset rather than a cut — this is a short trip inside one chapter,
     and cutting would lose the reader's place in the fall. */
  const jumpToBeat = (i: number) => {
    const st = triggerRef.current;
    if (!st) return;
    glideToOffset(st.start + (st.end - st.start) * (beatFocus(i) / TOTAL));
  };

  useGSAP(
    () => {
      const section = sectionRef.current;
      const stage = stageRef.current;
      if (!section || !stage) return;

      /* Bodoni and Inter are webfonts, the beats' indices are set in the first
         very large and the wordmark in the second at nearly the full width of the
         frame — so the stage's height and the title's line breaks are both
         measured against fallback metrics until they land. */
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      const mm = gsap.matchMedia(sectionRef);

      /* ── Reduced motion ───────────────────────────────────────────────
         No pin, no scrub, no fall. The pawn holds its title pose below a
         wordmark that is simply set, and all four beats are simply on the page
         as prose. This is the only motion-free reading path the chapter has,
         which is exactly why it is a hard requirement rather than a nicety:
         moving the argument inside the pin took the other one away. */
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(poseRef.current, { ...TITLE_POSE, x: 0, y: 0 });
        gsap.set(ditherRef.current, { grayscale: 0, invert: 0, dither: 1 });
        gsap.set(".why-shaft", { autoAlpha: 0.5 });
        /* The mark is set, not wiped in. Only the fill layer matters here: the
           ghost is display:none under .is-static, since with the figure in flow
           below the title there is nothing for the outline to trace across. */
        gsap.set(MARK, { autoAlpha: 1, filter: `${MARK_SHADOW} blur(0px)` });
        gsap.set(GLYPH, { yPercent: 0 });
        gsap.set(".why-beat", { autoAlpha: 1, y: 0 });
        gsap.set([".why-beat-num i", ".why-tword i"], { yPercent: 0, y: 0 });
        gsap.set(".why-beat-rule", { autoAlpha: 1, scaleX: 1 });
        gsap.set(".why-beat-dash", { scaleX: 1 });
        /* The typewriter is a width animation whose CSS fallback is "as wide as
           the text" (see .why-beat-kicker), so the kicker needs nothing here —
           only its caret has to go, since nothing is typing. */
        gsap.set(".why-beat-caret", { autoAlpha: 0 });
        gsap.set([".why-beat-body", ".why-bword"], { autoAlpha: 1, y: 0 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        /* ── Act 0: nightfall ──────────────────────────────────────────
           Unchanged. The join between the light chapter and this one is a
           colour ramp, and a ramp alone is seamless without being smooth: the
           reader crosses the better part of a screen in which nothing happens.
           Scrubbing the band's own layers turns that screen into the
           transition — the last light sinks and goes out, the dark closes up
           the frame from below as --why-fall compresses the ramp's middle
           stops, and a field of stars comes up behind it to hand the stage the
           sky it opens on. Nothing here touches the band's first or last row,
           so both joins stay provably the same colour as the surfaces either
           side of them. */
        const dusk = duskRef.current;
        if (dusk) {
          gsap
            .timeline({
              defaults: { ease: "none" },
              scrollTrigger: {
                trigger: dusk,
                start: "top bottom",
                end: "bottom top",
                /* The page's one scrub value, where this used to run lighter at
                   0.6. The band is a full-width background ramp handing over
                   between two chapters, so a reader crossing it feels the page's
                   response change gear twice in a screen and a half. */
                scrub: SCRUB,
                refreshPriority: REFRESH_PRIORITY.why,
                invalidateOnRefresh: true,
              },
            })
            .fromTo(
              ".why-dusk-ramp",
              { "--why-fall": 0 },
              { "--why-fall": 1 },
              0
            )
            .fromTo(
              ".why-dusk-light",
              { autoAlpha: 0.9, yPercent: -8 },
              { autoAlpha: 0, yPercent: 30 },
              0
            )
            .fromTo(
              ".why-dusk-stars",
              { autoAlpha: 0, yPercent: -5 },
              { autoAlpha: 1, yPercent: 0 },
              0.06
            );
        }

        /* ── Starting frame ───────────────────────────────────────────── */
        /* Position and size off the wordmark rather than off START_POSE, so the
           very first frames — before the timeline has rendered anything — already
           have the figure standing where the type puts it. holdTitle keeps it there
           for the rest of the act. */
        const opening = titleSeat(stage);
        gsap.set(poseRef.current, {
          ...START_POSE,
          x: opening.x,
          y: opening.y,
          scale: opening.scale,
        });
        gsap.set(ditherRef.current, { grayscale: 0, invert: 0, dither: 1 });
        gsap.set(".why-shaft", { autoAlpha: 0 });
        /* All three layers of the mark, one selector — see the header note on why
           they must never be addressed separately. Parked below their own clip
           boxes rather than merely transparent, so the entrance is a wipe from an
           edge and not a fade from nowhere.

           The shadow is stated here rather than in CSS because the exit tweens
           this same property, and GSAP only interpolates a filter *list* against a
           matching list — a bare `blur(18px)` target against a CSS-declared
           `drop-shadow(...)` would swap one string for the other in a single
           frame. It lives on the word's box rather than on the glyphs so it is not
           clipped by their wipe boxes (see .why-mark-fill's own note on why the
           hard relief offsets can live there and a blurred one cannot). */
        gsap.set(MARK, {
          autoAlpha: 0,
          filter: `${MARK_SHADOW} blur(0px)`,
        });
        gsap.set(GLYPH, { yPercent: 106 });
        gsap.set(".why-shatter-box", { autoAlpha: 1 });
        /* Both closing layers start out of the frame, and they come back into it
           on one tween — see the resolve. --why-open is left at its registered
           initial 0; the threshold timeline's own fromTo arms it. */
        gsap.set([".why-blackout", ".why-threshold"], { autoAlpha: 0 });
        gsap.set(".why-rail", { autoAlpha: 0 });
        gsap.set(".why-contact", { autoAlpha: 1 });
        gsap.set(".why-beat", { autoAlpha: 0, y: 46 });
        gsap.set(".why-beat-rule", { autoAlpha: 0, scaleX: 0 });
        gsap.set(".why-beat-dash", { scaleX: 0 });
        /* Both indices wipe up out of their own clip box, same construction as
           the old headline's glyphs: 112% of the box's height parks the numeral
           clear of it without exposing the padding the Didone's overshoot
           needs. */
        gsap.set([".why-beat-num i", ".why-tword i"], { yPercent: 112, y: 0 });
        /* `--why-type` overrides the CSS fallback of "full width" the moment it
           is defined, so this line is what arms the typewriter. */
        gsap.set(".why-beat-kicker", { "--why-type": 0 });
        gsap.set(".why-beat-caret", { autoAlpha: 0 });
        gsap.set(".why-beat-body", { autoAlpha: 0, y: 20 });
        gsap.set(".why-bword", { autoAlpha: 0, y: 12 });

        /* ── The rail ─────────────────────────────────────────────────────
           Which beat the reader is with, reported from the pin's own progress
           rather than from four more ScrollTriggers, and written to the DOM
           directly rather than through React state: a re-render here would take
           the whole composition — three WebGL wrappers included — with it.

           Declared before the timeline because the trigger's onUpdate can fire
           during creation and refresh, and a callback that closes over a `const`
           declared further down would be reading it inside its own temporal
           dead zone. */
        const dots = gsap.utils.toArray<HTMLElement>(".why-rail-dot");
        const railLabel =
          railRef.current?.querySelector<HTMLElement>(".why-rail-label") ?? null;
        let current = -1;

        const syncRail = (at: number) => {
          let next = -1;
          if (at >= BEATS_AT && at < RESOLVE_AT + RESOLVE_SPAN * 0.5) {
            next = Math.min(
              BEATS.length - 1,
              Math.floor((at - BEATS_AT) / BEAT_SPAN)
            );
          }
          if (next === current) return;
          current = next;
          dots.forEach((dot, i) => {
            const on = i === next;
            dot.classList.toggle("is-current", on);
            if (on) dot.setAttribute("aria-current", "true");
            else dot.removeAttribute("aria-current");
          });
          /* The count, not the kicker: the beat on screen is already naming
             itself in type twice the size of this, so repeating it here would be
             the rail saying nothing. How deep the reader is, and out of how
             many, is the one thing the frame doesn't already say. */
          if (railLabel) {
            railLabel.textContent =
              next < 0
                ? ""
                : `${BEATS[next]!.index} / ${String(BEATS.length).padStart(2, "0")}`;
          }
        };

        /* Proxies for the two effects whose state is not a DOM property. GSAP
           tweens these plain objects and their onUpdate pushes the numbers
           straight into the live instances — no React render, no uniform
           upload that isn't needed. */
        const glass = { base: 0 };
        const pushGlass = () =>
          shatterRef.current?.setOptions({
            strength: 1,
            baseStrength: glass.base,
          });
        /* Every channel the scene reads, on one object, seeded at the frame the
           chapter opens on. `elo` is here as well but is the only one this act
           chain does not touch — it has a tween of its own, for the reason
           recorded on the states. */
        const board = { ...BOARD_DARK, elo: ELO_FLOOR };
        const pushBoard = () => boardRef.current?.set(board);
        pushBoardRef.current = pushBoard;

        /* ── Where the piece is on the rail ───────────────────────────────
           A third proxy, and the same idea as the two above: one channel the
           timeline can tween, converted to the thing it drives at the moment it
           is used. -1 is the pose the fall leaves the figure in, 0 is the first
           dot's seat, 3 is the last, and a fraction is a piece in transit
           between two of them.

           The conversion has to happen per frame, and that is the whole reason
           this channel exists rather than the tweens writing the pose's x/y
           directly. A tween written as `x: () => railPose(...)` resolves that
           function *once* — on its first render, or on the first render after
           invalidateOnRefresh drops the cached value — and then holds the
           number. Land one of those resolves on a frame where the rail is not in
           its final layout and the piece parks at a stale point for good:
           measured on a 430x860 frame, a jump from the top of the document
           straight into beat 3 (which is exactly what a reload with the scroll
           position restored does) left the figure clamped in the corner of the
           frame, and no amount of scrolling afterwards brought it back. Every
           tween below runs between two plain numbers, so there is nothing left
           to go stale, and the seats are read on the frame they are used on.

           Three getBoundingClientRects per update, and only while the piece is
           actually moving — the tweens carry this as their onUpdate, so a reader
           parked on a beat pays nothing. */
        const RIDE_FALL = -1;
        const ride = { at: RIDE_FALL };

        const pushRide = () => {
          const pose = poseRef.current;
          /* At exactly -1 the fall still owns x/y (see the act-3 tween), so the
             frame where the two meet is left alone rather than written twice. */
          if (!pose || ride.at <= RIDE_FALL) return;
          const last = BEATS.length - 1;
          const lo = Math.floor(ride.at);
          const seat = (i: number) =>
            i < 0
              ? { x: FALL_POSE.x, y: FALL_POSE.y }
              : railPose(stage, seatAt(Math.min(last, i)));
          const from = seat(lo);
          const to = seat(lo + 1);
          const t = ride.at - lo;
          pose.x = from.x + (to.x - from.x) * t;
          pose.y = from.y + (to.y - from.y) * t;
        };

        /* ── Where the figure stands in the title ─────────────────────────
           Act 1 is a hold, so the seat could have been two numbers in a tween —
           and that is exactly what it was, and it was wrong on arrival about a
           third of the time.

           The measurement is a DOM read (see titleSeat), and a tween resolves a
           function value *once*: on its first render, or on the first render after
           invalidateOnRefresh drops it. Neither of those is guaranteed to land
           after the wordmark is set in the face it will actually be set in, and
           the consequence of missing is not subtle — the offset is half the
           difference between the two words' widths, so a different face is a
           different seat, and the figure ends up standing through a letter instead
           of between the words.

           The fonts.ready refresh at the top of this effect is not cover for that,
           because this chapter is code-split: it mounts long after that promise has
           already settled once, so the refresh it triggers can run before Inter 800
           has even been requested for a mark that is only now being painted — and
           nothing afterwards re-resolves anything. Hence the observer further down,
           which watches the one thing that actually reports the change.

           So x is owned here instead, written from a cached measurement rather
           than a cached *resolve*. Same division as the rail's `ride` channel and
           for the same underlying reason, with the costs swapped around: the rail
           has to re-measure per frame because its seat moves with the beat, and
           this one cannot move except when the layout does — so it is measured on
           the events that mean "the layout moved" and the per-frame write is a
           plain assignment with no reflow in it. */
        let seat = titleSeat(stage);
        const measureSeat = () => {
          seat = titleSeat(stage);
        };
        const holdTitle = () => {
          const pose = poseRef.current;
          if (!pose) return;
          /* Only while the title still owns x. From DESCENT_AT the zoom does, and
             a second writer on the same channel resolves by render order — which
             flips with scroll direction. */
          const at = (triggerRef.current?.progress ?? 0) * TOTAL;
          if (at >= DESCENT_AT) return;
          pose.x = seat.x;
          pose.y = seat.y;
          pose.scale = seat.scale;
        };

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: stage,
            start: "top top",
            end: `+=${TOTAL * 100}%`,
            pin: stage,
            // A little lag so the pawn and the frame feel like they carry mass
            // rather than snapping to the wheel. One value for the whole page —
            // see pacing.ts.
            scrub: SCRUB,
            // Without this, a fast fling leaves the scrub still easing toward a
            // scroll position the reader has already left, which reads as the
            // chapter catching up after the fact.
            fastScrollEnd: true,
            anticipatePin: 1,
            refreshPriority: REFRESH_PRIORITY.why,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              syncRail(self.progress * TOTAL);
              holdTitle();
            },
            /* A resize moves every seat, and a reader parked on a beat is
               between two ride tweens with nothing updating the pose. Fires
               after the refresh has re-measured and re-applied the pin, so the
               rail it reads is the rail the reader is looking at; a no-op
               unless the piece is on it. */
            /* The title's seat moves on the same event and for the same reason —
               a resize re-sets the wordmark. Re-read here rather than in the
               global refresh listener so that placeLight, which runs after every
               trigger has refreshed, aims the shaft at a seat already brought up
               to date. */
            onRefresh: () => {
              pushRide();
              measureSeat();
              holdTitle();
            },
          },
        });
        triggerRef.current = tl.scrollTrigger ?? null;

        /* Which direction the reader is travelling. Several of the callbacks
           below only make sense one way round — a title that re-assembles as
           you scroll *down* past it would be a bug, not a flourish. */
        const forward = () => (tl.scrollTrigger?.direction ?? 1) >= 0;

        /* Comes to rest on a readable frame rather than mid-transition.
           Performed by beatSettle rather than ScrollTrigger's own `snap`, whose
           correction tween intermittently threw the reader back to the top of
           the page under ScrollSmoother — see beatSnap.ts. */
        const stopSettling = tl.scrollTrigger
          ? beatSettle(tl.scrollTrigger, RESTS, HOLD)
          : undefined;

        /* Nav links to #why land on act 2 — the composed question — rather than
           on the section's top edge, which is the dusk band a few hundred
           pixels above the point the stage pins and reads as an empty screen. */
        const unregisterAnchor = registerAnchorLanding("why", () => {
          const st = triggerRef.current;
          return st ? st.start + (st.end - st.start) * (TITLE_FOCUS / TOTAL) : 0;
        });

        /* ── The threshold: the night opening into the pricing chapter ─────
           The pin has to unpin somewhere, and once it does the stage still has
           its own screen to roll off the top before the next chapter's first row
           can reach it. That screen used to be a flat black slab sliding up off a
           sky that has stars in it — a hard line travelling the height of the
           frame with night on one side of it and space on the other, which is
           what made the join read as two pages rather than one move.

           So the stage's last layer is the next chapter's first frame, and this is
           what opens it: the base tone ramps to the sky's, the same star field the
           pricing chapter mounts is revealed from the bottom of the frame up, and
           the light on the far side rises under both. The composition is in the
           stylesheet, under .why-threshold.

           Its own trigger rather than a tail on the pin's, because the window it
           needs is the one *after* the pin. `bottom bottom` is the section's last
           row reaching the fold, which is the frame the pin releases on — the
           section contains the pin's spacer, so its last row is the stage's last
           row — and `bottom top` is that row leaving the top of the frame. Those
           are the same two facts the pricing chapter measures its approach against
           from the other side of the join, so the two timelines run over one
           identical scroll distance by construction rather than by being tuned to
           agree. That is what lets both star fields be scaled at the same rates
           without either timeline touching the other's properties.

           Declared after the pin so it refreshes after it: ScrollTrigger sorts by
           refreshPriority and falls back to creation order inside a priority, and
           this trigger's positions are only correct once the pin's spacer is in
           the document. See scrollOrder.ts. */
        const threshold = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "bottom bottom",
            end: "bottom top",
            scrub: SCRUB,
            refreshPriority: REFRESH_PRIORITY.why,
            invalidateOnRefresh: true,
          },
        });

        threshold
          /* The one number the handover is authored against: the ramp's middle
             stops, the star field's reveal and its three depths' scales all read
             it. Linear, because it is this window's clock — the layers below ease
             against it rather than it easing against them. */
          .fromTo(
            ".why-threshold",
            { "--why-open": 0 },
            { "--why-open": 1, duration: 1 },
            0
          )
          /* The light on the far side, rising into the frame from below. The
             travel is a *lag*, not a lift: the stage is already moving up at
             scroll speed, so a layer holding a third of a screen back reads as
             something a long way off, where one that kept pace would read as an
             object going past. Linear with the clock; only the exposure eases. */
          .fromTo(
            ".why-threshold-core",
            { yPercent: 14 },
            { yPercent: 34, duration: 1 },
            0
          )
          /* Up well before the sky is, so the reader is travelling toward a lit
             region rather than watching one arrive. Nothing takes it back down —
             the stage's own clip does that as the frame leaves, and by then the
             pricing chapter's core is at full. */
          .fromTo(
            ".why-threshold-core",
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.66, ease: "power2.out" },
            0
          );

        /* ── Ambient ──────────────────────────────────────────────────────
           Runs until the background leaves, so the frame is never frozen: the
           rank grid recedes at a fraction of the scroll speed, which is what
           gives a flat stage depth. */
        tl.fromTo(
          ".why-files",
          { "--why-files-y": "26px" },
          { "--why-files-y": "-20px", duration: BEATS_AT },
          0
        );

        /* ── Act 1: the question sets itself ───────────────────────────── */
        /* A hold, stated as a tween. START_POSE equals TITLE_POSE by design — the
           reader arrives to the pawn already standing in the word rather than
           watching it walk in — so both ends of this are the same frame, and the
           only reason it is a tween at all is that something has to own the pose
           across the title's span and hand it to the zoom in act 3.

           x, y and scale are deliberately *not* in it: all three are solved from the
           wordmark's own box, and this act does not own them. See holdTitle. What is
           left is the two rotations, which are authored. */
        tl.to(
          poseRef.current,
          {
            ry: TITLE_POSE.ry,
            rx: TITLE_POSE.rx,
            duration: TITLE_SPAN * 0.7,
          },
          0
        )
          // The shaft arrives with the pawn — it is lit *by* the reveal rather
          // than fading in already lit.
          .to(
            ".why-shaft",
            { autoAlpha: 1, duration: TITLE_SPAN * 0.62, ease: "power2.out" },
            0.02
          )
          /* The mark's box comes up first and empty — its letters are still
             parked under their clip edges — so what the reader sees is the word
             being set rather than a block of type fading in. */
          .to(MARK, { autoAlpha: 1, duration: ENTER * 0.5, ease: "none" }, 0.06)
          /* Letter by letter up out of the baseline, left to right. Scrubbed,
             unlike the particle field it replaced: the whole point of dropping
             the canvas was that the type has real edges, and a wipe against a
             real edge can be bound to scroll position without reimplementing a
             simulation. So the word now sets itself *as* the reader arrives and
             un-sets itself if they back up, instead of firing on a trigger and
             then arguing with the playhead about whether it should be there.

             A short step: twelve letters at 0.018 of a scroll unit is a ripple
             across the word, not twelve separate arrivals. Ends by ~0.62 — the
             positions and durations here are absolute scroll units, so they do
             not stretch with TITLE_SPAN — which leaves the rest of the title's
             span as hold, and means the settled frame the snapping parks on
             (TITLE_FOCUS, the end of the span) never has type in flight on it. */
          .fromTo(
            GLYPH,
            { yPercent: 106 },
            {
              yPercent: 0,
              duration: ENTER,
              ease: "power3.out",
              stagger: glyphStagger(0.018),
            },
            0.08
          );

        /* ── Act 3: the descent ────────────────────────────────────────────
           The one moment where the two pointer-driven systems of act 2 hand
           over to scroll. They don't fight on the way: by the end of this act
           the background is shattered screen-wide and fading regardless of
           where the cursor is, so the hover state and the scroll state agree. */

        /* The title leaves first, and it leaves *upward* — out of the top of its
           own clip boxes, which is the direction that reads as the reader
           dropping away from it rather than as the word wandering off. Same
           construction as the entrance run backwards, so scrolling back up sets
           the question again with no state to keep in sync.

           Exit is faster than the entrance and the stagger is tighter (0.011
           against 0.018): the word came in as a ripple and goes as one gesture,
           which is the page's entrance/exit ratio applied to the letters as well
           as to their box. Clear by ~1.11, well before the first beat at 1.3. */
        tl.to(
          GLYPH,
          {
            yPercent: -106,
            duration: DESCENT_SPAN * 0.5,
            ease: "power2.in",
            stagger: glyphStagger(0.011),
          },
          DESCENT_AT
        )
          /* And the box goes with them. The blur is on the word's own box rather
             than on the full-frame layer, so the filter's area is the type and
             not the viewport — and the shadow is restated so the list matches the
             starting frame's and GSAP interpolates the blur rather than swapping
             one string for another. Reads as the mark losing focus as it passes
             the camera. */
          .to(
            MARK,
            {
              autoAlpha: 0,
              filter: `${MARK_SHADOW} blur(18px)`,
              duration: DESCENT_SPAN * 0.56,
              ease: "power2.in",
            },
            DESCENT_AT + 0.06
          )
          /* The whole screen breaks up, cursor or no cursor. */
          .to(
            glass,
            {
              base: 1,
              duration: DESCENT_SPAN * 0.8,
              ease: "power2.in",
              onUpdate: pushGlass,
            },
            DESCENT_AT
          )
          /* …and then goes, taking the night, the glows, the floor and the "?"
             with it and leaving the board. Exit curve, and faster than
             anything in act 1 arrived. */
          .to(
            ".why-shatter-box",
            {
              autoAlpha: 0,
              duration: DESCENT_SPAN * 0.72,
              ease: "power2.in",
            },
            DESCENT_AT + 0.03
          )
          /* The floor pool has no floor to sit on once the fall starts. */
          .to(
            ".why-contact",
            { autoAlpha: 0, duration: LEAVE, ease: "power2.in" },
            DESCENT_AT + 0.04
          )
          /* The board comes up out of the dark behind it. First link in the chain
             of five that drive the scene — both endpoints stated, see the note on
             BOARD_DARK.

             Only the exposure moves here. The board has been rendering the whole
             time (it is latched on well before the reader arrives, and its own
             observer parks the loop when the chapter is off screen), so what
             changes in this act is not whether it exists but whether anything is
             standing between the reader and it — which is the night above, and the
             night is the shatter's business. */
          .fromTo(
            board,
            { ...BOARD_DARK },
            {
              ...BOARD_OPEN,
              duration: DESCENT_SPAN,
              ease: "power2.out",
              immediateRender: false,
              onUpdate: pushBoard,
            },
            DESCENT_AT
          )
          /* The zoom. Roughly the first third of the act, power3.out, no
             overshoot: sudden because it is fast relative to the fall around
             it, not because it is a cut. */
          .to(
            poseRef.current,
            {
              ...ZOOM_POSE,
              duration: DESCENT_SPAN * 0.32,
              ease: "power3.out",
            },
            DESCENT_AT
          )
          /* And then the floor goes out from under it. */
          .to(
            poseRef.current,
            {
              ...FALL_POSE,
              duration: DESCENT_SPAN * 0.62,
              ease: "power1.in",
            },
            DESCENT_AT + DESCENT_SPAN * 0.34
          )
          /* Colour drains as the pawn falls deeper — not before, so the drop into
             grayscale is something the fall does to the figure rather than a
             filter that was always on. And it stays drained: the piece spends the
             rest of the chapter as the rail's marker, and the rail is grey type and
             grey dots. A bronze pawn sitting in it is the one object on that
             furniture with a colour, which reads as a 3D model parked on the
             interface rather than as part of it.

             The only tween on this channel now. It used to run two beats longer and
             then be undone by a restore to 0.3 as the figure landed — the restore
             is gone, so this is both the drain and the resting value, and there is
             no second writer to overlap with. Bounded by the act anyway: finishing
             where the fall finishes is what makes the grey arrive with the landing
             rather than a screen after it. */
          .to(
            ditherRef.current,
            {
              grayscale: 1,
              duration: DESCENT_SPAN,
              ease: "power1.inOut",
            },
            DESCENT_AT
          );

        /* Once the background has faded out there is nothing left for the
           shatter to break, so the effect is idled rather than left rendering a
           screen-wide lift into an invisible canvas: at strength 0 its render
           loop settles and parks itself. Direction-guarded, because a timeline
           callback fires whichever way the playhead crosses it. */
        tl.call(
          () => {
            if (forward()) {
              shatterRef.current?.setOptions({
                strength: 0,
                baseStrength: 0,
              });
            }
          },
          undefined,
          BEATS_AT + 0.02
        ).call(
          () => {
            if (!forward()) pushGlass();
          },
          undefined,
          BEATS_AT - 0.02
        );

        /* ── Act 4: four beats, and the board answering each one ──────────
           Every beat gets a frame of the board that argues the same thing the
           copy does, and the board changes *between* beats rather than under
           them. That is what the positions below are for: each hand-off opens
           just past the settled frame the snapping parks on (beatFocus, at 0.6
           of the beat) and closes before the next one's, so the reader is never
           asked to read a paragraph while the camera is moving, and never parked
           on a frame that is halfway between two shots.

              hold ──── beatFocus(i) ──┬── the board moves ──┬── beatFocus(i+1)
                                       │                      │
                                    -0.34 of the next beat, for 0.72

           One tween per hand-off rather than one continuous ramp across all
           four, for the same reason the beats are four windows rather than one
           scroll: a camera that moves the whole time has no frames in it. */
        const HANDOVER = 0.72;
        const handoverAt = (i: number) => beatAt(i) - 0.34;

        const boardActs = [
          { from: BOARD_OPEN, to: BOARD_PROBLEM, at: DESCENT_AT + DESCENT_SPAN * 0.5 },
          { from: BOARD_PROBLEM, to: BOARD_LEARN, at: handoverAt(1) },
          { from: BOARD_LEARN, to: BOARD_BOTS, at: handoverAt(2) },
          { from: BOARD_BOTS, to: BOARD_GOAL, at: handoverAt(3) },
        ];

        for (const act of boardActs) {
          tl.fromTo(
            board,
            { ...act.from },
            {
              ...act.to,
              duration: HANDOVER,
              /* Decelerating, like every other arrival on this page. The camera
                 leaves on the reader's scroll and settles into the next frame
                 rather than easing out of one and into the next, which is what
                 makes a scrubbed move read as a move rather than as a slider. */
              ease: "power2.out",
              immediateRender: false,
              onUpdate: pushBoard,
            },
            act.at
          );
        }

        /* ── The figure crosses into the indicator ────────────────────────
           The fall's destination, and the chapter's one piece of choreography
           that has to agree with a DOM layout: the figure travels to the seat of
           the rail's first dot and then steps from dot to dot as the section
           indicator for all four beats.

           On the *first* beat's opening rather than the last hand-off, and the
           timing is the whole point of the act. The rail is the chapter's index;
           a piece standing in it is what makes the index read as part of this
           scene rather than as chrome parked over it. Arriving on the last
           hand-off meant three of the four beats had the figure loose in the
           middle of the frame with the indicator sitting empty beside it, and put
           the one frame where the two are a single object in the last few hundred
           pixels of a five-screen pin.

           It has to *land* before beatFocus(0), which is the frame the beat
           snapping parks on: a reader who stops on the first beat is looking at
           the frame this act exists to produce, so the crossing cannot still be in
           the air there. At HANDOVER * 0.7 it is down 0.1 of a scroll unit early,
           with the landing's own decelerating tail inside that margin.

           And it cannot start any earlier either: the fall writes this same
           channel until DESCENT_AT + DESCENT_SPAN * 0.96, and two tweens writing
           one property in a shared window resolve by render order — which flips
           with scroll direction, so the figure would leave for the rail from a
           slightly different place depending on which way the reader arrived.

           Two tweens in step rather than one, because the pose's channels have
           two different owners here. The turn and the shrink are authored numbers
           and belong on the pose; where the piece ends up is a DOM measurement
           and belongs on the ride channel (see pushRide) — so this states ry, rx
           and scale, and the ride tween beside it states the position. Same
           window, same ease, one gesture. */
        const CROSSING = HANDOVER * 0.7;

        tl.fromTo(
          poseRef.current,
          { ry: FALL_POSE.ry, rx: FALL_POSE.rx, scale: FALL_POSE.scale },
          {
            ry: RAIL_POSE.ry,
            rx: RAIL_POSE.rx,
            scale: RAIL_POSE.scale,
            immediateRender: false,
            duration: CROSSING,
            ease: "power2.inOut",
          },
          BEATS_AT
        )
          .fromTo(
            ride,
            { at: RIDE_FALL },
            {
              at: 0,
              duration: CROSSING,
              ease: "power2.inOut",
              immediateRender: false,
              onUpdate: pushRide,
            },
            BEATS_AT
          )
          /* And the halftone comes off it as it shrinks.

             The dither pass is a *screen* — a grid of dots at a fixed pitch in
             device pixels — so what it costs the figure grows as the figure gets
             smaller: at title size it is a material, and at a marker's size it is
             a grid laid over a shape small enough that the grid wins outright.

             All the way off, and to 0 rather than to something under the shader's
             own 0.5 switch. This channel is not a blend — below 0.5 the screen is
             simply off (see DITHER_FRAG) — so the old target of 0.32 was already a
             hard cut dressed as a ramp, and stating it as 0 says what happens.
             Turning the screen off no longer takes the desaturation with it: that
             was the shader bug this pass fixed, and it is the reason the marker
             used to come out bronze with uGrayscale pinned at 1. */
          .fromTo(
            ditherRef.current,
            { dither: 1 },
            {
              dither: 0,
              duration: CROSSING,
              ease: "power1.out",
              immediateRender: false,
            },
            BEATS_AT
          )
          .fromTo(
            ".why-rail",
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: ENTER, ease: "power2.out" },
            BEATS_AT - 0.12
          );

        /* ── And it steps down the rail with the reader ────────────────────
           One tween per hand-off, each moving the piece from the seat of the dot
           it is beside to the seat of the next — so the figure is not a thing that
           arrived at the rail once and then stopped, it is the mark for whichever
           beat is on screen.

           Position only. The rotation and the scale were settled by the crossing
           and have no business being re-stated four times; a marker that resized
           itself at every hand-off would read as a glitch.

           On the hand-offs rather than on the beat openings, which puts the move
           inside the same window as the board's camera change and outside every
           settled frame: each one runs handoverAt(i) to handoverAt(i) + HANDOVER,
           which closes 0.22 of a scroll unit before beatFocus(i). The dot's own
           highlight flips at beatAt(i) (see syncRail), a third of the way into the
           move — so the light lands on the dot and the piece follows it in, rather
           than the two changing on the same frame. */
        for (let i = 1; i < BEATS.length; i += 1) {
          tl.fromTo(
            ride,
            { at: i - 1 },
            {
              at: i,
              duration: HANDOVER,
              ease: "power2.inOut",
              immediateRender: false,
              onUpdate: pushRide,
            },
            handoverAt(i)
          );
        }

        /* ── The climb ────────────────────────────────────────────────────
           Beginner to grandmaster, and the last beat's whole payoff: the chapter
           has spent four screens arguing that understanding a move makes you
           stronger, and this is the sentence stated as a number going up.

           Its own tween, and the only one that writes this channel — see the note
           on the states for why that matters. It starts a fraction after the
           camera does, so the gauge is already growing in the frame before the
           number begins to move (a counter that climbs while its own card is still
           crossing the frame is a counter nobody can read), and it finishes before
           beatFocus(3), which is the frame the snapping parks on — so a reader who
           stops on the last beat is looking at the finished climb rather than at
           one still in progress.

           `power1.inOut` rather than linear. The gauge damps its own bar and rounds
           its own readout to tens, so what this curve decides is the *feel* of the
           travel: eased at both ends it reads as progress being made, at a constant
           rate it reads as a value being dragged. */
        tl.fromTo(
          board,
          { elo: ELO_FLOOR },
          {
            elo: ELO_PEAK,
            duration: 0.78,
            ease: "power1.inOut",
            immediateRender: false,
            onUpdate: pushBoard,
          },
          beatAt(3) - 0.1
        );

        const beatEls = gsap.utils.toArray<HTMLElement>(".why-beat");

        beatEls.forEach((el, i) => {
          const at = beatAt(i);
          const last = i === BEATS.length - 1;
          const kicker = el.querySelector<HTMLElement>(".why-beat-kicker");
          const chars = Number(kicker?.dataset.chars ?? 0);
          const typeTime = Math.max(TYPE_MIN, chars * TYPE_RATE) * 0.5;

          /* Entrance. The box supplies one direction for the whole beat and the
             parts inside it supply the grain — 45 words each carrying their own
             travel is 45 things moving, and the eye reads that as noise. */
          tl.to(
            el,
            {
              autoAlpha: 1,
              y: 0,
              duration: BEAT_SPAN * 0.34,
              ease: "power2.out",
            },
            at
          )
            .to(
              el.querySelector(".why-beat-rule"),
              {
                autoAlpha: 1,
                scaleX: 1,
                duration: BEAT_SPAN * 0.3,
                ease: "power2.out",
              },
              at + 0.02
            )
            .to(
              el.querySelector(".why-beat-num i"),
              {
                yPercent: 0,
                y: 0,
                duration: BEAT_SPAN * 0.3,
                ease: "power3.out",
              },
              at + 0.04
            )
            .to(
              el.querySelector(".why-beat-dash"),
              { scaleX: 1, duration: BEAT_SPAN * 0.22, ease: "power2.out" },
              at + 0.08
            );

          /* The kicker types as the reader scrolls into the beat, with the
             caret arriving just before the first character and leaving a beat
             after the last — which is the whole reason the caret is here: it
             makes the label read as being written by something. */
          if (kicker && chars) {
            tl.to(
              el.querySelector(".why-beat-caret"),
              { autoAlpha: 1, duration: 0.05 },
              at + 0.02
            )
              .fromTo(
                kicker,
                { "--why-type": 0 },
                {
                  "--why-type": chars,
                  duration: typeTime,
                  ease: `steps(${chars})`,
                },
                at + 0.04
              )
              .to(
                el.querySelector(".why-beat-caret"),
                { autoAlpha: 0, duration: 0.08, ease: "power2.in" },
                at + 0.04 + typeTime + 0.06
              );
          }

          /* Copy follows the label in rather than racing it: the label names
             the beat, then the beat makes its case. The overlap is deliberate —
             waiting for the caret would leave a hole in the middle of the
             entrance. */
          /* Everything in the entrance has to be finished by beatFocus — the
             frame the snapping parks the reader on — or the settled frame shows
             a paragraph half-set, which reads as the page still loading. That is
             what sets the stagger budget below rather than taste: 45 words at
             0.0025 of a scroll unit each is the most that fits. */
          const bodyAt = at + 0.05 + typeTime * 0.3;

          tl.to(
            el.querySelector(".why-beat-body"),
            {
              autoAlpha: 1,
              y: 0,
              duration: BEAT_SPAN * 0.26,
              ease: "power2.out",
            },
            bodyAt
          );

          const thesisWords = el.querySelectorAll(".why-tword i");
          if (thesisWords.length) {
            tl.to(
              thesisWords,
              {
                yPercent: 0,
                y: 0,
                duration: BEAT_SPAN * 0.12,
                ease: "power3.out",
                stagger: BEAT_SPAN * 0.002,
              },
              bodyAt + 0.02
            );
          } else {
            tl.to(
              el.querySelectorAll(".why-bword"),
              {
                autoAlpha: 1,
                y: 0,
                duration: BEAT_SPAN * 0.12,
                ease: "power2.out",
                stagger: BEAT_SPAN * 0.0018,
              },
              bodyAt + 0.02
            );
          }

          /* Exit — except for the thesis, which is the chapter's last word and
             leaves in act 5 instead. Up and away, because the reader is
             travelling down: a beat that left downward would read as the copy
             falling with the pawn rather than the reader passing it. */
          if (!last) {
            tl.to(
              el,
              {
                autoAlpha: 0,
                y: -40,
                duration: BEAT_SPAN * 0.22,
                ease: "power2.in",
              },
              at + BEAT_SPAN * 0.76
            );
          }
        });

        /* ── Act 5: resolve, and the close ─────────────────────────────────
           The argument clears the frame, the board goes with it, and the
           chapter ends on a flat, fully dark tone.

           The order is the composition. The thesis leaves first, then the rail —
           and the figure standing on it — and the board's exposure comes down
           under both of them, so the last thing dimming is the rating gauge on
           an otherwise empty frame. Only then does the blackout itself raise to
           full opacity, closing the pin's last frame to black. */
        tl.to(
          ".why-beat.is-thesis",
          {
            autoAlpha: 0,
            y: -34,
            duration: RESOLVE_SPAN * 0.5,
            ease: "power2.in",
          },
          RESOLVE_AT + 0.04
        )
          /* The rail and the figure on it, as one thing. They arrived as one — the
             pawn crossed the frame to stand there — so a rail that faded out from
             under the piece it is carrying would take the whole hand-off apart at
             the last moment. */
          .to(
            [".why-rail", ".why-figure"],
            { autoAlpha: 0, duration: RESOLVE_SPAN * 0.5, ease: "power2.in" },
            RESOLVE_AT + RESOLVE_SPAN * 0.2
          )
          /* Last link in the chain: the state the beats leave, to the state the
             closing blackout picks up. Both stated — see the note on BOARD_DARK.

             Held to the front of the resolve rather than run across all of it, so
             the frame is already flat by the time the blackout arrives. A scene
             still dimming behind an opaque fill is frames spent on a layer nobody
             can see. */
          .fromTo(
            board,
            { ...BOARD_GOAL },
            {
              ...BOARD_GONE,
              duration: BOARD_OUT_END - BOARD_OUT_AT,
              ease: "power2.in",
              immediateRender: false,
              onUpdate: pushBoard,
            },
            BOARD_OUT_AT
          )
          /* The chapter's last tween: a flat fill raised to full opacity, so the
             frame the chapter ends on is a known value rather than a board still
             faintly dimmed (BOARD_GONE only takes it to 0.72).

             The threshold rides the same tween, and deliberately the *same* one
             rather than a second offset behind it. At --why-open 0 its ramp is
             this fill's own tone everywhere but the last few percent of the frame,
             so raising the two together costs nothing visually and buys the one
             thing the handover needs: the frame this tween closes on and the frame
             the threshold timeline starts from are the same frame, with no gap
             between them for a scrub to land in. */
          .to(
            [".why-blackout", ".why-threshold"],
            { autoAlpha: 1, duration: RESOLVE_SPAN * 0.5, ease: "power2.in" },
            RESOLVE_AT + RESOLVE_SPAN * 0.5
          );

        /* ── The stage's two placed lights ────────────────────────────────
           This used to be a live pointer response: moving the cursor over the
           stage opened a soft hole in the night's mask (the board showing
           through where the frame "came apart") and lit a specular sweep across
           the wordmark, gated on the same --why-lens-a/-x/-y trio. That hover-
           to-reveal interaction is removed — the title now simply sets itself
           and holds, with no pointer-driven reveal.

           --why-lens-x/-y still have to be *something*, though: .why-title-layer
           reads them for its parallax translate (see the stylesheet), and their
           registered initial value is a literal 0px, not "centred". Left
           unset, the mark would sit permanently shoved off-centre (see the
           is-static branch's own note on exactly this). So the coordinates are
           set once to the stage's centre — and re-set on refresh, since the
           centre point moves with the viewport — and never touched again:
           --why-lens-a stays at its registered initial 0, which is what keeps
           the night's mask fully closed and the sheen permanently invisible.

           The second is the overhead shaft, and it is here because it is the same
           kind of fact: a light that has to be placed against something the
           stylesheet laid out. `.why-shaft` was pinned to `left: 50%` while the
           figure stands in the word gap, a couple of hundred pixels to the left of
           that — so the one thing in the chapter described as "the shaft the figure
           stands in" was falling beside it, with the ground pool (which does follow
           the figure, via --think-x) lit under the pawn and the cone above it
           aimed at the empty middle of the frame. Two lights on one subject,
           disagreeing about where the subject is.

           Fed from titleSeat, so it is the *same* measurement that places the
           figure rather than a second guess at it. Deliberately not --think-x: that
           is the renderer's live projected centre, and it swings through the zoom
           and the fall — the shaft is leaving with the night by then (it is inside
           .why-shatter-box) and a cone sliding across the frame as it fades is a
           moving object, not a light going out. */
        const placeLight = () => {
          const box = stage.getBoundingClientRect();
          /* As far toward the figure as the cone can go without its own box
             leaving the frame. `.why-shaft` is a feathered mask inside a sized
             element, so an element pushed past the edge does not fade off — it
             gets cut, and a radial mask cut by an element boundary is a hard
             vertical line down the stage. On a wide frame there is far more room
             than the offset needs (380px of slack against ~240px of offset at
             1440x900); below 860px the shaft opens up to 86vw and the clamp starts
             doing real work, which is the right trade at a width where the shaft
             is most of the frame and which half of it is lit barely reads. */
          const shaft = stage.querySelector<HTMLElement>(".why-shaft");
          const room = shaft
            ? Math.max(0, (box.width - shaft.offsetWidth) / 2)
            : 0;
          const shaftX = gsap.utils.clamp(-room, room, seat.px);
          gsap.set(stage, {
            /* With units, which is not optional: both are registered as
               `<length>` (see the @property blocks), and a registered property
               handed a bare number is an invalid declaration — the property falls
               back to its own initial value, which is the literal 0px this line
               exists to avoid. It fails quietly and it does not fail to nothing:
               .why-title-layer's parallax reads these, so the mark sat 0.7% of the
               frame off centre in both axes, permanently — 10px right and 6px down
               on a 1440px window, on the one element on the stage that has to be
               exactly where the figure thinks it is. */
            "--why-lens-x": `${box.width / 2}px`,
            "--why-lens-y": `${box.height / 2}px`,
            "--why-shaft-x": `${shaftX.toFixed(1)}px`,
            /* The type's half of the narrow-frame lockup. Written on the stage
               rather than on either mark layer so both read one value — they are
               one word cut in half by the figure's z-index and a half-pixel of
               disagreement between them shows up as a double-struck letter. */
            "--why-mark-y": `${seat.markY.toFixed(1)}px`,
          });
        };
        placeLight();
        ScrollTrigger.addEventListener("refresh", placeLight);

        /* The one layout change nothing else on this page reports: the wordmark
           being re-set in a different face. `document.fonts.ready` cannot cover it
           for a code-split chapter (see the note on holdTitle), and a webfont
           landing is not a resize, not a scroll and not a ScrollTrigger refresh —
           so from out here it is only ever visible as the word's own box changing
           width. Watching that box is therefore both the narrowest and the most
           complete signal available, and it covers every other cause of the same
           change for free: a zoom, a language pack, a font-display swap. */
        const markWord = stage.querySelector<HTMLElement>(
          ".why-mark-fill .why-mark-word"
        );
        const reseat = () => {
          measureSeat();
          holdTitle();
          placeLight();
        };
        const markObserver = new ResizeObserver(reseat);
        if (markWord) markObserver.observe(markWord);
        reseat();

        /* Everything else in here was created inside this matchMedia context,
           so GSAP reverts it. These are ours. */
        return () => {
          stopSettling?.();
          unregisterAnchor();
          markObserver.disconnect();
          ScrollTrigger.removeEventListener("refresh", placeLight);
          triggerRef.current = null;
        };
      });
    },
    { scope: sectionRef, dependencies: [motion], revertOnUpdate: true }
  );

  /* The stage's background: the flat night that hides the board, the light the
     pawn stands in, two drifting masses and the receding rank grid. This is what
     <Shatter> breaks — and only this. The pawn and the title are deliberately
     outside it: shattering the two things the chapter is about would fight them.

     There used to be an oversized outlined "?" bleeding off the right edge in
     here as the furthest-back depth layer. It is gone: the question is already
     said in particles at 200px in the middle of the same frame, and a second
     giant glyph behind the beats put a moving stroke through the copy the
     chapter makes its case with. Depth is the grid's job now. */
  const ambient = (
    <div className="why-ambient" aria-hidden="true">
      {/* The only opaque layer, and therefore the only thing standing between
          the reader and the board. Its mask is the reveal — see the header
          note and .why-night in the stylesheet. */}
      <span className="why-night" />
      <span className="why-shaft" />
      <span className="why-glow why-glow-a" />
      <span className="why-glow why-glow-b" />
      <span className="why-files" />
      <span className="why-horizon" />
    </div>
  );

  return (
    <section
      id="why"
      className={`why-section${motion ? "" : " is-static"}`}
      ref={sectionRef}
      aria-labelledby="why-title"
    >
      {/* Nightfall. The feature story above ends on a near-white paper tone and
          this chapter runs on the hero's near-black, so the two are joined by a
          ramp rather than an edge. */}
      <div className="why-dusk" ref={duskRef} aria-hidden="true">
        <span className="why-dusk-ramp" />
        <span className="why-dusk-light" />
        <span className="why-dusk-stars" />
      </div>

      <div className="why-stage" ref={stageRef}>
        {/* ── 0: the board ───────────────────────────────────────────────
            Behind everything, and playing from the moment it mounts — what hides
            it is the night above it, so that the pointer can take the night away
            and find a game going on behind it.

            It plays whether or not anyone is looking, which is the point: the
            chapter's first beat is about being handed a move without being told
            why, and the answer to that has to be a board where a move is being
            suggested and played *now* rather than a diagram the scroll operates.
            Scroll owns the camera, the instruments and the opponents; the game
            owns its own clock. See chess/chessScene.js. */}
        <div className="why-board" aria-hidden="true">
          {motion && boardReady && !farPast ? (
            <EffectBoundary label="ChessBoard">
              <ChessBoard handleRef={boardRef} />
            </EffectBoundary>
          ) : null}
        </div>

        {/* ── 1: the night, shattered ─────────────────────────────────────
            The box is the animated element (one opacity ramp across act 3) and
            the effect sits inside it, which keeps GSAP away from a component
            that writes its own inline styles. Under reduced motion the effect
            is not mounted at all and the same ambient markup renders directly
            into the box. */}
        <div className="why-shatter-box" aria-hidden="true">
          {motion && !farPast ? (
            /* Fallback is the same background unwrapped: if the effect fails,
               the chapter loses its shards and keeps its night — which is the
               layer the board's reveal depends on. */
            <EffectBoundary label="Shatter" fallback={ambient}>
              <Shatter
                className="why-shatter"
                style={{ position: "absolute", inset: 0 }}
                onReady={(instance) => {
                  shatterRef.current = instance;
                }}
                {...SHATTER}
              >
                {ambient}
              </Shatter>
            </EffectBoundary>
          ) : (
            /* Also the reduced-motion path's markup: released far past the
               chapter or scrolled away from it entirely, the ambient
               background is still correct here, just without the shard
               pass — the same degraded state an EffectBoundary failure or a
               missing html-in-canvas API already leaves the page in. */
            ambient
          )}
        </div>

        {/* ── 2: hems ─────────────────────────────────────────────────────
            The joins with the surfaces either side, plus the grain that keeps
            the large flat gradients from banding and the vignette that keeps
            the frame's edges dark. Above the background so it can flatten the
            stage's first rows to exactly the tone the dusk band resolves to;
            below the type and the figure so it never dims either. */}
        <div className="why-hems" aria-hidden="true">
          <span className="why-hem-top" />
          {/* The ground the argument is read against on a frame wide enough to put
              the argument beside the picture instead of on top of it — a ramp off
              the left edge, not a wash over the middle. Off entirely below that
              width, where the copy is centred and carries its own ground. It lives
              here rather than inside .why-beats because it belongs to the *frame*:
              it is lighting, it does not move with any one beat, and nothing in the
              timeline touches it. See .why-scrim and the side-column block in the
              stylesheet. */}
          <span className="why-scrim" />
          <span className="why-grain" />
          <span className="why-vignette" />
        </div>

        {/* ── 3: the question, behind the figure ──────────────────────────
            The plate and the specular sweep that rides on it. Both are behind the
            pawn by z-index, which is the whole composition: the pawn occludes the
            word instead of the word covering the pawn. The letters the figure eats
            are picked up by the outline layer below — later in the source, and in
            front of the figure in z. See the header note.

            Source order is the paint order inside this stacking level: the plate
            is the surface, the sweep is the light on it.

            The heading's accessible name is the hidden copy, in ordinary sentence
            case: the mark is set lowercase as a graphic and there is no reason for
            a screen reader to hear it that way, and the split glyphs would
            otherwise be read out one letter at a time. */}
        <h2 className="why-title" id="why-title">
          <span className="why-sr">Why Chessee?</span>
          {titleLayer("fill")}
          {titleLayer("sheen")}
        </h2>

        {/* ── 3: the question, in front of the figure ─────────────────────
            The same word, same size, same position, as a hairline. Over the plate
            it vanishes into the plate's own edge; over the pawn it is the
            letterform continuing as a wireframe. Not a heading and not readable —
            it is the plate's shadow, cast in the other direction. */}
        <div className="why-title-ghost" aria-hidden="true">
          {titleLayer("line")}
        </div>

        {/* ── 4: the figure ──────────────────────────────────────────────
            Above the copy, not behind it: the brief is explicit that the
            argument appears *in the background of* the falling pawn, and by the
            time the beats arrive the figure is small enough that being in front
            costs the copy nothing. */}
        <div className="why-figure" aria-hidden="true">
          {!farPast ? (
            <EffectBoundary label="ThinkingModel">
              <ThinkingModel
                className="why-model"
                poseRef={poseRef}
                ditherRef={ditherRef}
                metricsRef={contactRef}
              />
            </EffectBoundary>
          ) : null}
          {/* Ground pool rather than a drop shadow: on a near-black stage a
              dark ellipse is invisible, so what welds the figure to the floor
              is the light it stands in. Published straight from the renderer —
              see ThinkingModel's metricsRef — and gone once there is no floor
              left to stand on. Unmounting the model above already clears its
              own metrics via `data-think-off`-driven CSS, same as a WebGL
              refusal, so this pool has nowhere to draw a stale reading from. */}
          <span className="why-contact" ref={contactRef} />
        </div>

        {/* ── 5: the argument ────────────────────────────────────────────
            Four beats in one place, one visible at a time under motion, an
            ordinary stacked column under reduced motion. Still an <ol>: the
            list is what carries the ordinal to a screen reader, and the
            oversized numerals are the typographic anchor that tells the eye a
            new statement has started. */}
        <ol className="why-beats" ref={beatsRef}>
          {BEATS.map((beat) => (
            <li
              className={`why-beat${beat.thesis ? " is-thesis" : ""}`}
              id={`why-${beat.id}`}
              key={beat.id}
            >
              <span className="why-beat-rule" aria-hidden="true" />
              <span className="why-beat-num" aria-hidden="true">
                <i>{beat.index}</i>
              </span>
              <p className="why-beat-label">
                <span className="why-beat-dash" aria-hidden="true" />
                <span className="why-beat-type">
                  {/* Typed by animating this box's width in `ch`, so the text
                      inside is never split, transformed or duplicated — see the
                      note on .why-beat-kicker in the stylesheet. */}
                  <span
                    className="why-beat-kicker"
                    data-chars={beat.kicker.length}
                    style={
                      { "--why-chars": beat.kicker.length } as CSSProperties
                    }
                  >
                    {beat.kicker}
                  </span>
                  <i className="why-beat-caret" aria-hidden="true" />
                </span>
              </p>
              <p className="why-beat-body">
                {beat.thesis ? splitWords(beat.body) : splitBody(beat.body)}
              </p>
            </li>
          ))}
        </ol>

        {/* ── 6: the rail ────────────────────────────────────────────────
            The one piece of interface in the chapter, and the answer to the
            cost of putting the argument inside a pin: four marks saying how far
            down the shaft the reader is, each one a jump to its beat's settled
            frame. Present under motion only — with the beats in ordinary flow
            there is nothing for it to report. */}
        {motion ? (
          <div className="why-rail" ref={railRef}>
            <nav className="why-rail-dots" aria-label="The case for Chessee">
              {BEATS.map((beat, i) => (
                <button
                  type="button"
                  key={beat.id}
                  className="why-rail-dot"
                  onClick={() => jumpToBeat(i)}
                >
                  <i aria-hidden="true" />
                  {/* One seat per dot, and nothing drawn in any of them: a seat's
                      whole job is to be a *position* the timeline can measure.
                      The figure that sits in it is a WebGL canvas covering the
                      whole stage, so the only thing it needs from the DOM is
                      where on that stage to be (see railPose), and it moves from
                      the seat of one dot to the next as the reader passes each
                      beat — which is what makes the piece read as the mark for
                      the beat it is beside rather than as an ornament parked near
                      the rail.

                      Laid out in CSS, in two arrangements: left of the dot where
                      the rail is a column, under it where the rail is a row. */}
                  <span className="why-rail-seat" aria-hidden="true" />
                  <span className="why-sr">{`${beat.index} ${beat.kicker}`}</span>
                </button>
              ))}
            </nav>
            {/* Written by the timeline, not by React — see syncRail. */}
            <span className="why-rail-label" aria-hidden="true" />
          </div>
        ) : null}

        {/* ── 7: the close ────────────────────────────────────────────────
            A flat fill raised to opacity 1 as the argument resolves, so the pin
            closes on a known, fully dark frame rather than a scene still dimmed.
            It does nothing else: the handover is the layer above it, and this is
            the value that layer opens from. */}
        <span className="why-blackout" aria-hidden="true" />

        {/* ── 8: the threshold ────────────────────────────────────────────
            The chapter's last frame is the next chapter's first. Across the one
            screen the pin spends rolling off the top — the same screen the
            pricing chapter runs its approach over, measured from the other side
            of the same join — the night's tone ramps to the sky's, that
            chapter's own star field is revealed from the bottom of the frame up,
            and the light on the far side rises under both.

            The sky is the shared component, not a copy of it: the two fields are
            on screen together for the whole handover, so anything they disagreed
            about would land as a line ruled across the page.

            Built 2.5 viewports before the join and released four past it — see
            skyReady above for why this layer cannot use the hook the rest of the
            page's canvases use. The tone ramp and the light are plain spans and
            are always here, which is also why the timeline drives the field
            through an inherited custom property instead of tweening it: the
            field mounts long after the timeline that moves it is built. */}
        <div className="why-threshold" aria-hidden="true">
          <span className="why-threshold-ramp" />
          {motion && skyReady && !farPast ? (
            <SpaceField className="why-threshold-sky" />
          ) : null}
          <span className="why-threshold-core" />
        </div>
      </div>

      {/* No run-out band, and none is wanted. The chapter used to end with a few
          hundred pixels of flat tone for the argument to breathe out into, which
          was a third of a screen of nothing added to a gap between two pinned
          stages that is already longer than anyone wants. The handover is
          composed inside that gap instead (layer 8 above), so the stage's last
          row hands straight over to the pricing stage's first — on the same tone,
          with the same stars already in it. */}
    </section>
  );
}
