import * as THREE from 'three';

import { PALETTE } from './gfx/palette.js';
import { Atmosphere, createEnvironmentMap, createLighting } from './gfx/environment.js';
import { BoardMesh } from './gfx/boardMesh.js';
import { PieceSet } from './gfx/pieces.js';
import { MoveArcs } from './gfx/arcs.js';
import {
  DepthLadder,
  EvalSpine,
  ForecastRibbon,
  LineStrip,
  PANEL_STANDOFF,
  setCardFade,
} from './gfx/instruments.js';
import { ELO_MIN, EloGauge } from './gfx/eloGauge.js';
import { BotRoster } from './gfx/bots.js';
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp } from './gfx/ease.js';

import { BoardState, squareToWorld } from './logic/board.js';
import {
  OPERA_GAME,
  buildTrend,
  evalToFill,
  formatEval,
  predictedReply,
  resolvePv,
  signedEval,
  tacticVerdict,
  winDrawLoss,
} from './logic/game.js';

/* ---------------------------------------------------------------------- */
/* The chess scene behind the Why chapter                                  */
/* ---------------------------------------------------------------------- */

/* Adapted from the standalone prototype in animations/src/scene.js. The board,
 * the pieces, the arcs, the instruments and the chess are that prototype's,
 * unchanged (see the provenance note in gfx/instruments.js). What is different
 * is who is in charge.
 *
 * ── Two clocks, and the split between them ──────────────────────────────
 *
 * The prototype was a hero: one autonomous loop that played a game, cut between
 * camera angles on a timer, and reset. Here it is a *background*, and a
 * background has to answer to the page — but not with everything.
 *
 * The game runs on its own clock. Scroll does not step through moves, and that
 * is deliberate: the chapter's first beat is about platforms that hand you a
 * move without explaining it, and the answer to that is a board where a move is
 * being suggested and played *right now*, at every scroll position, including
 * one the reader has been parked on for a minute. Bound to scroll it would be a
 * diagram the reader operates, which is a different claim.
 *
 * Everything else answers to scroll. Which instruments are on the board, whether
 * a predicted line is performed, who is on the other side, where the camera is
 * standing and how bright the whole thing is are all channels the chapter's
 * pinned timeline writes through `set()` — the same imperative-handle contract
 * the light tunnel this replaces used, and for the same reason: these are
 * scrubbed at frame rate and a React render per frame would take the whole
 * composition with it.
 *
 * ── What each beat asks for ─────────────────────────────────────────────
 *
 *   0  The problem       The board, and nothing else. A best move is found,
 *                        drawn, and played, over and over. No eval bar, no
 *                        depth, no line — because that absence *is* the beat.
 *   1  Built for learning The instruments arrive: evaluation, search depth, the
 *                        predicted line performed in phantom pieces over the
 *                        board, the win/draw/loss trend. The rating gauge comes
 *                        up with them, small and quiet, so the last beat has
 *                        something to pay off rather than something to introduce.
 *   2  Beyond analysis   The opponents appear behind Black.
 *   3  The goal          The camera leaves the board for the rating gauge, which
 *                        climbs from beginner to grandmaster.
 *
 * ── What was dropped ────────────────────────────────────────────────────
 *
 * OrbitControls, the DOM HUD, the hover tooltips, the click-to-probe tools, the
 * x-ray control map and the post-processing chain. The first four are
 * interaction, and this canvas is `aria-hidden` behind body copy with
 * `pointer-events: none` — anything the reader could only find by clicking it
 * would be a feature nobody can reach. The grade went for a reason worth
 * stating: its bloom lifts the whole frame's luminance, and the whole frame is
 * behind four paragraphs the chapter needs read.
 */

/** Below this aspect the frame is treated as portrait: wider lens, longer lens throw. */
const LANDSCAPE_ASPECT = 0.85;

/**
 * Above this width the chapter's copy is a column down the left of the frame
 * rather than a block in the middle of it, and the composition owes the camera a
 * different answer: the subject moves into the right of the frame so the two
 * never share pixels (see `placeSide` on the shots below).
 *
 * A width and not an aspect, and it has to match the stylesheet's own gate
 * (`.why-beats`, under `@media (min-aspect-ratio: 85/100) and (min-width: 1000px)`)
 * or the frame composes for one layout while the reader is looking at the other.
 * Aspect alone was not enough: a 900x620 window is landscape by any measure and
 * still has no room for a reading column beside a board.
 */
const SIDE_COPY_MIN_WIDTH = 1000;

/* Elevation is `phi`, measured from straight up — so a *larger* phi is a
   *flatter* camera. Worth stating because every shot below reads backwards
   otherwise. */
const PORTRAIT_MAX_PHI = 0.72;

/**
 * One shot per beat, interpolated by the fractional `beat` channel.
 *
 * `place` is where the subject sits in the frame rather than an offset applied to
 * it: [0, 0] is centred, [1, 0] is the right edge, y up. It is realised with the
 * camera's own view offset rather than by aiming somewhere else, so composing
 * off-centre never costs a rotation — see `#frameShot`.
 *
 * `radiusNarrow` is stated per shot instead of being derived from one pull-back
 * factor, because the two ends of the sequence want opposite things from a
 * portrait frame: the wide shots need real distance or the instruments run off
 * the sides, and the closing shot needs almost none, because its subject is a
 * single card and pulling back is exactly what would make it unreadable.
 *
 * `placeSide` is the third composition, and it exists because the copy moved. On a
 * frame wide enough for it the chapter's argument is a column down the left (see
 * SIDE_COPY_MIN_WIDTH), which frees the right two thirds outright — so the subject
 * is pushed into them rather than being left in the middle with a paragraph on top
 * of it. Falls back to `place` where there is no side column, so the centred
 * layout keeps the centred framing it was composed for.
 *
 * ── On the distances ──
 * Every shot here was pulled in by roughly a seventh in this pass, and the number
 * was not picked — it is what each shot's own content allows. The scene is the
 * chapter's subject rather than its wallpaper, and it was being framed like
 * wallpaper: measured on a 1152x720 frame, shot 0's board occupied about two
 * thirds of the frame's height with a third of it empty air. What sets the floor is
 * the *vertical* fit, always, because the frame is wider than it is tall at every
 * size this branch runs at: shot 1's end panels stand at z = ±5.7 and project to
 * about 11 units of screen height with their own tops and bottoms counted, so at
 * radius 18.2 they fill ~89% of the frame and anything closer starts cutting the
 * cards the beat is about. Shot 0 has the most room by far — a bare board reaches
 * about 7.5 units — and takes the largest pull-in accordingly.
 */
const SHOTS = [
  {
    /* 0 — The problem. From behind White and close in: the board fills the frame
       and the arc over it is the only thing to look at, which is the point. */
    theta: -0.42,
    phi: 0.78,
    /* The closest of the three board shots, because it is the only one with
       nothing but the board in it: no cards stand at the edges of this frame, so
       the only thing that has to fit is the board's own 9.24 units and the pieces
       standing on them — about 7.5 units of screen height at this elevation. At
       14.4 that is ~78% of the frame, with the near rank whole. Measured, not
       derived: at 13.4 it was 81% and the first two ranks were off the bottom edge,
       which on the beat about a move being played is two rows of pieces the reader
       cannot see. */
    radius: 14.4,
    radiusNarrow: 17.6,
    target: [0, 0.45, 0],
    /* Lifted, where it used to sit a hair low. Every shot in this list is composed
       looking *down* at a board, so the subject's own foreshortening puts more of it
       below the aim point than above — leave the frame centred and the near edge
       runs off the bottom while the far edge floats in empty air. The positive y is
       what buys back the near rank. */
    place: [0, 0.08],
    placeSide: [0.18, 0.08],
    /* And the lift is *not* wanted on a portrait frame, which is the whole reason
       this is stated rather than inherited. A portrait frame is held above phi 0.6
       and framed with a wider lens, so the board foreshortens far less and sits
       square in the middle of the shot — there is no near edge running off the
       bottom to buy back. Applied there it simply pushed the board up and left a
       third of the frame empty under it: measured at 430x860, 240px of nothing. */
    placeNarrow: [0, -0.04],
  },
  {
    /* 1 — Built for learning. Pulled back and lifted, because there are suddenly
       four cards standing at the edges of the composition and all four have to be
       in the shot at once. The line panel is the one that decides the distance: it
       stands nearest the camera, so it is the first thing to run off the bottom of
       the frame, and it is also the card carrying the most reading. */
    theta: 0.3,
    phi: 0.7,
    /* The tightest constraint in the sequence, and the one shot whose distance is
       a fit rather than a choice: the end panels stand at z = ±5.7 and reach about
       11 units of screen height once their own 1.9 of card is counted top and
       bottom, and the line panel is nearest the camera so it is the first thing to
       run off the bottom.

       19.6 is where that panel keeps its last row on the frame at 1152x720, checked
       against the render rather than solved. 18.2 was tried and is what the
       arithmetic above allows on paper: it cut the panel's bottom two rows, because
       a card standing nearer the camera than the board is larger on screen than its
       world extent predicts and the estimate does not know that. */
    radius: 19.6,
    radiusNarrow: 23.4,
    target: [0, 0.75, 0],
    /* Lifted for the same reason as shot 0, and further, because this frame has more
       standing in front of the board than behind it. Level again on a portrait frame
       — see the note on shot 0's placeNarrow. */
    place: [0, 0.14],
    placeSide: [0.18, 0.14],
    placeNarrow: [0, 0],
  },
  {
    /* 2 — Beyond analysis. Flattened right down and swung to look along the board
       toward Black's end, which is the one framing where a row standing behind the
       back rank reads as looming over the position rather than as a line of
       cards. */
    theta: 0.05,
    phi: 1.02,
    /* Between the other two: the roster stands behind the back rank and the four
       cards are still lit, but this is the flattest elevation in the sequence, so
       the same content projects shorter than it does from shot 1.
     *
     * It has the least *vertical* slack of the three all the same, and from both
     * ends at once: five bot cards along the top edge and the line panel along the
     * bottom. So the lift below is the smallest of the three — enough to keep the
     * panel's moves on the frame, not enough to push the roster off it. */
    radius: 16.4,
    radiusNarrow: 20.8,
    target: [0, 1.3, 0],
    place: [0, 0.1],
    placeSide: [0.18, 0.1],
    placeNarrow: [0, 0.02],
  },
  {
    /* 3 — The goal. Off the board entirely and onto the rating gauge, from outside
       it, so what is behind the card is mostly open space with the board falling
       away at the frame's edge.

       Placed in the right third on a wide frame: the chapter's copy is centred, and
       a card the camera has spent a beat flying to should not arrive underneath the
       sentence it is illustrating. A portrait frame has no right third to give, so
       there the gauge drops low and the copy keeps the middle.

       `theta` is solved against where the gauge stands rather than picked — it is
       the bearing from the board's centre out to the card (atan2 of ELO_AT), so the
       camera ends up directly outside it. Pick the angle freehand and the board
       swings round to sit behind the one card in the chapter that has to be read
       cleanly. */
    theta: 1.0,
    phi: 0.92,
    /* Barely moved, and deliberately: this shot's subject is a single card that has
       to be *read*, so its distance was already solved against the card's own
       height rather than against the frame's empty space. The other three had empty
       space to give back; this one never did. Nudged out rather than in, in fact —
       the pull-in that the side layout allows this shot is spent on moving the card
       toward the middle of the frame (see placeSide), not on making it larger, and
       at 4.45 the gauge's own scale ran off the bottom edge. */
    radius: 4.6,
    /* Further back on a narrow frame, which is the opposite of what the other three
       shots do there and is the whole reason `radiusNarrow` is stated per shot. A
       portrait frame has no side to put the card beside — the copy takes the middle
       and the full width — so the only room left is underneath it, and the card has
       to be small enough to fit in what the closing beat's six lines leave. Pulled
       to 8 it is about 240px tall on a 430px frame, which is still the largest thing
       in the shot by a wide margin. */
    /* Left at 8, and the pass that pulled every other distance in tried 7.5 here and
       put it back. The margin this shot has on a portrait frame is not the frame's
       empty space, it is whatever the closing beat's six lines of thesis leave
       underneath them — about 240px on a 430x860 frame, which is what 8 renders the
       card at. At 7.5 it renders at 256 and the bottom of the scale, 'GRANDMASTER'
       included, goes off the bottom edge. */
    radiusNarrow: 8,
    target: [6.5, 1.14, 4.2],
    /* Well into the right third, and a hair below centre. Measured against the
       copy rather than chosen: the closing beat is the thesis, set to a 26-character
       measure and centred, which on a 1152px frame reaches about 265px either side
       of the middle. At 0.42 the card landed inside that and the sentence ran
       across the readout. */
    place: [0.6, -0.06],
    /* Low, not right. Measured against the closing beat's own block: at this width
       the thesis runs to six lines and reaches about 190px below the frame's middle,
       so the card sits under that and keeps its bottom edge on the frame. */
    placeNarrow: [0, -0.7],
    /* Back toward the middle, which is the one place `placeSide` moves a subject
       *less* far out than `place` does. The 0.6 above is a dodge around a centred
       paragraph; with the copy in a left column there is nothing in the middle of
       the frame to dodge, and a card banished to the last sixth of the width is a
       finale composed into a corner. At 0.34 the gauge sits in the right third with
       the board falling away behind it — the shot this beat was described as.

       And lifted well clear of the -0.06 the centred layout uses, because that
       number is also a dodge: it drops the card *below* the copy's centre line, and
       the copy is not in the middle of the frame any more. Level it up and the whole
       card is on the frame — the rating readout, the bar, and the 'GRANDMASTER' stop
       at the top of the scale, which is the one word in this shot that has to be
       read for the beat to land. */
    placeSide: [0.34, 0.2],
  },
];

/**
 * Where the rating gauge stands, and why it is out here.
 *
 * Well clear of the board's corner (4.62) and of both wide panels, which buys two
 * things at once. Through the first three beats it is a small card tucked into the
 * near-right corner — present, findable, and plainly not the subject. And in the
 * closing shot the camera can come at it from outside the rig, so the frame is the
 * card against open space rather than the card against a lit board and an
 * evaluation bar.
 *
 * SHOTS[3].target is this point lifted to the card's own centre (its metrics put
 * that at h / 2 + 0.05 = 1.14), so the closing shot is aimed at the card and not
 * at the floor under it.
 */
const ELO_AT = [6.5, 0, 4.2];

/** How fast the camera catches up with the shot the scroll position asks for. */
const CAMERA_EASE = 2.6;

/**
 * Idle azimuth sway: how far it reaches, and how fast.
 *
 * A bounded oscillation rather than a constant drift, which is a correction. A
 * drift is the obvious way to keep a parked frame from being a still, and it is
 * wrong here for a reason that only shows up on the closing shot: that shot orbits
 * the *rating gauge*, not the board, so an azimuth that accumulates without limit
 * swings the whole board around behind the one card the chapter needs read — and
 * where it ends up depends on how long the reader has had the page open. Bounded,
 * every shot in the sequence is the same shot on every visit, and the frame still
 * never sits perfectly still.
 */
const SWAY = 0.16;
/** Cycles per second — about one full swing every 75 seconds. */
const SWAY_RATE = 0.013;

/** Base exposure, and what `dim` takes it down to under the copy. */
const EXPOSURE = 1.32;
const EXPOSURE_DIM = 0.6;

/**
 * Phase lengths in seconds. Slower than the prototype's, which was a hero the
 * viewer was looking straight at; this one is behind four paragraphs, and a
 * background that moves at reading speed competes with the reading.
 */
const TIMING = {
  analysis: 0.68,
  travel: 0.52,
  settle: 0.34,
  finale: 2.4,
  dissolve: 0.95,
  rebuild: 0.9,
};

/** Seconds held on a finished predicted line before the real move is played. */
const TACTICS_TAIL = 0.5;

/* The tier used to be detected here, from this container's own size. It is now
 * handed in by the caller, because it is a page-level decision rather than this
 * scene's to make — see renderQuality.ts, which owns the heuristic that used to
 * live here (including the note about measuring in CSS pixels rather than device
 * pixels, which is the correction that stopped this scene looking soft). */

export class ChessScene {
  /**
   * @param {HTMLElement} container sized element the canvas fills
   * @param {object} [options]
   * @param {boolean} [options.reducedMotion]
   * @param {'low'|'medium'|'high'} [options.quality] defaults to the middle
   *   tier, which is the safe assumption for a caller that has not measured
   */
  constructor(container, { reducedMotion = false, quality = 'medium' } = {}) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    this.game = OPERA_GAME;
    this.failed = false;

    const rect = container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width || container.clientWidth || 1));
    this.height = Math.max(1, Math.round(rect.height || container.clientHeight || 1));
    this.quality = quality;

    /* The channels the page writes. Seeded at the frame the chapter opens on —
       board only, nothing else on it — so a scene that mounts before the timeline
       has written to it is a legal frame rather than an arbitrary one. */
    this.channels = {
      beat: 0,
      instruments: 0,
      gauge: 0,
      bots: 0,
      preview: 0,
      elo: ELO_MIN,
      dim: 0,
    };

    try {
      this.#initRenderer();
    } catch (error) {
      /* Decoration. It opts out rather than throwing: an exception escaping the
         caller's effect would unmount the chapter around it. */
      console.warn('ChessScene: WebGL unavailable, board disabled.', error);
      this.failed = true;
      return;
    }

    this.#initScene();
    this.#initState();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    /* Applied unconditionally rather than through `resize`, which is guarded on
       the size having changed — and on the first frame it has not, because the
       constructor measured it. Without this a portrait viewport would open on the
       landscape lens and the composition would be wrong until something resized. */
    this.#applyViewport();
    this.#start();
  }

  /* ------------------------------------------------------------- bootstrap */

  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== 'low',
      /* Transparent, and that is the difference between this and the prototype's
         renderer. The scene is a *layer* in the chapter: the night above it is the
         reveal, the drifting glows and the rank grid sit over it, and the base tone
         behind it belongs to the section. An opaque clear would take all of that
         and replace it with a rectangle. */
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!this.renderer.getContext()) throw new Error('no WebGL context');

    /* Render at the display's own density wherever it is affordable. A cap below
       `devicePixelRatio` does not make the picture smaller, it makes it *soft* — the
       canvas is stretched to its CSS box either way — and a soft board is the one
       failure this layer cannot absorb, because the whole chapter is about looking
       closely at it. Capped at 2 rather than uncapped: past that the extra samples
       are invisible and the fill cost is not.

       What pays for it is the shadow map below rather than resolution. */
    this.dprCap = this.quality === 'low' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, this.dprCap));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;';
    /* Decorative, and unreachable. The chapter's copy is the accessible version of
       every claim on this board. */
    canvas.setAttribute('aria-hidden', 'true');
    this.container.appendChild(canvas);
    this.canvas = canvas;
  }

  #initScene() {
    this.scene = new THREE.Scene();
    /* No `background` and no fog. Both would need an opaque frame to work
       against, and this one is composited over the chapter. */

    this.camera = new THREE.PerspectiveCamera(38, this.width / this.height, 0.5, 240);

    this.envMap = createEnvironmentMap(this.renderer);
    this.scene.environment = this.envMap;
    this.lights = createLighting(this.scene);

    /* Where the extra resolution is paid for. The rig authors a 2048 map, which is
       the right call for a hero the viewer is looking straight at; here the board is
       behind body copy and the shadows are contact and shape rather than detail, so
       halving the map is close to free to look at and quarters what it costs. Set
       before the first render, which is the only time it can be. */
    if (this.quality !== 'high') this.lights.key.shadow.mapSize.set(1024, 1024);

    this.atmosphere = new Atmosphere({
      reducedMotion: this.reducedMotion,
      quality: this.quality,
      backdrop: false,
    });
    this.scene.add(this.atmosphere.group);

    /* Everything board-related hangs off `world`, so the float and the pointer
       parallax are applied in one place and never fight the camera. */
    this.world = new THREE.Group();
    this.world.name = 'world';
    this.scene.add(this.world);

    this.board = new BoardMesh({ envMap: this.envMap });
    this.pieces = new PieceSet({ envMap: this.envMap });
    this.arcs = new MoveArcs();

    this.evalSpine = new EvalSpine({ side: 1 });
    this.depthLadder = new DepthLadder({ side: -1 });
    this.forecast = new ForecastRibbon({ side: -1 });
    this.lineStrip = new LineStrip({ side: 1, reducedMotion: this.reducedMotion });
    this.eloGauge = new EloGauge({ position: ELO_AT });

    /** The four that arrive together, plus the gauge that arrives with them. */
    this.instruments = [this.evalSpine, this.depthLadder, this.forecast, this.lineStrip];

    this.roster = new BotRoster();

    this.world.add(
      this.board.group,
      this.pieces.group,
      this.arcs.group,
      ...this.instruments.map((card) => card.group),
      this.eloGauge.group,
      this.roster.group
    );

    this.#layoutPanels();

    /* Nothing is on the board yet. Written before the first frame rather than
       left to the first `set()`, so the opening frame is the authored one whether
       or not the page has spoken. */
    for (const card of this.instruments) setCardFade(card, 0);
    this.eloGauge.setFade(0);
    this.roster.setFade(0);
  }

  #initState() {
    this.boardState = new BoardState();
    this.pieces.build(this.boardState, { animateIn: true });

    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = false;
    this.plyIndex = 0;

    this.phase = 'rebuild';
    this.phaseTime = 0;
    this.phaseDuration = TIMING.rebuild;

    /* Search depth, the one piece of telemetry kept. `window` is the whole
       thinking span for a ply — the predicted line plus the analysis beat when
       there is a line, just the analysis beat when there is not — so the ramp
       does not reset to zero between the two. */
    this.search = { depth: 0, targetDepth: 20, forPly: -1, think: 0, window: 1 };

    this.trend = buildTrend(this.game);
    this.forecast.setSeries(this.trend);
    this.tactic = null;
    this.tacticStep = -1;
    this.tacticStepTime = 0;
    this.activeEntry = null;

    /* Camera. `live` is where it is, `desired` is where the beat says it should
       be, and the gap between them is the lag that gives the move weight. */
    this.spherical = new THREE.Spherical(SHOTS[0].radius, SHOTS[0].phi, SHOTS[0].theta);
    this.target = new THREE.Vector3(...SHOTS[0].target);
    this.place = new THREE.Vector2(SHOTS[0].place[0], SHOTS[0].place[1]);
    this.desired = {
      theta: SHOTS[0].theta,
      phi: SHOTS[0].phi,
      radius: SHOTS[0].radius,
      target: new THREE.Vector3(...SHOTS[0].target),
      place: new THREE.Vector2(SHOTS[0].place[0], SHOTS[0].place[1]),
    };
    this.viewOffset = false;

    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();

    /* On the window rather than the canvas: this layer sits under a stack of
       full-bleed siblings and takes no pointer events, so the cursor is never
       actually over it. The chapter already lights its night and its wordmark from
       the same cursor — one light, another surface answering to it. */
    this.onPointerMove = (event) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.parallaxTarget.set(
        (event.clientX / w) * 2 - 1,
        -((event.clientY / h) * 2 - 1)
      );
    };
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });

    this.#applyEval(0, { reveal: -1 });
  }

  #start() {
    this.loop = () => {
      this.rafId = requestAnimationFrame(this.loop);
      this.#frame();
    };
    this.rafId = requestAnimationFrame(this.loop);
    /* One warm-up compile, so the first frame the reader sees is not the frame
       every shader in the rig is linked on. */
    this.renderer.compile(this.scene, this.camera);
  }

  /* --------------------------------------------------------------- channels */

  /**
   * Writes the scroll-driven channels. Every field optional; anything omitted
   * holds its last value.
   *
   * @param {object} values
   * @param {number} [values.beat] which beat's frame, 0-3, fractional between
   * @param {number} [values.instruments] 0-1, how present the four analysis cards are
   * @param {number} [values.gauge] 0-1, how present the rating gauge is
   * @param {number} [values.bots] 0-1, how present the opponents are
   * @param {number} [values.preview] 0-1; above 0.5 predicted lines are performed
   * @param {number} [values.elo] the rating the gauge shows
   * @param {number} [values.dim] 0-1, how far the whole scene is held back
   */
  set(values) {
    if (!values) return;
    const c = this.channels;
    if (values.beat !== undefined) c.beat = values.beat;
    if (values.instruments !== undefined) c.instruments = values.instruments;
    if (values.gauge !== undefined) c.gauge = values.gauge;
    if (values.bots !== undefined) c.bots = values.bots;
    if (values.preview !== undefined) c.preview = values.preview;
    if (values.elo !== undefined) c.elo = values.elo;
    if (values.dim !== undefined) c.dim = values.dim;
  }

  /**
   * Stops the loop without tearing the context down — for a chapter that is
   * mounted but off screen, or a hidden tab.
   *
   * The frame loop is cancelled outright rather than returning early from it: a
   * scene held for the length of a page the reader is not on should cost nothing,
   * and an early return still costs a callback every frame and keeps the tab from
   * idling.
   */
  setPaused(paused) {
    const next = Boolean(paused);
    if (next === this.paused || this.failed) return;
    this.paused = next;
    if (next) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    /* Swallow the gap. Without this the first frame back carries however long the
       chapter was away as its delta, and the game skips a move on return. */
    this.clock.getDelta();
    this.rafId = requestAnimationFrame(this.loop);
  }

  /* ------------------------------------------------------------- the timeline */

  get currentPly() {
    return this.game.plies[this.plyIndex] ?? null;
  }

  /** Whether predicted lines are being performed right now. */
  get previewing() {
    return this.channels.preview > 0.5;
  }

  /**
   * The line to perform for a ply.
   *
   * Prefers the authored principal variation, and falls back to the ply plus the
   * opponent's predicted answer. The fallback is what makes the second beat's
   * claim hold at every scroll position: only seven of the thirty-three plies
   * carry a real line, so without it a reader arriving on "predicted lines" would
   * watch several moves go by with nothing predicted.
   */
  #lineFor(index) {
    const line = resolvePv(this.game, index);
    if (line.length > 1) return line;
    const ply = this.game.plies[index];
    const forecast = predictedReply(this.game, index);
    if (ply && forecast) return [ply, forecast.move];
    return [];
  }

  /** Whether this ply opens on a performed line or goes straight to the arc. */
  #openingPhase() {
    if (!this.previewing) return 'analysis';
    return this.#lineFor(this.plyIndex).length > 1 ? 'tactics' : 'analysis';
  }

  #enterPhase(name) {
    this.phase = name;
    this.phaseTime = 0;

    if (name === 'tactics') {
      const moves = this.#lineFor(this.plyIndex);
      this.phaseDuration = TACTICS_TAIL + 0.36 * moves.length;
      this.#beginTactics(moves);
    } else if (name === 'analysis') {
      this.phaseDuration = TIMING.analysis;
      this.#beginAnalysis();
    } else if (name === 'travel') {
      this.phaseDuration = TIMING.travel;
      this.#beginTravel();
    } else if (name === 'settle') {
      this.phaseDuration = TIMING.settle;
      this.#showReply();
    } else if (name === 'finale') {
      this.phaseDuration = TIMING.finale;
      this.#beginFinale();
    } else if (name === 'dissolve') {
      this.phaseDuration = TIMING.dissolve;
      this.pieces.dissolve({ duration: 0.8 });
      this.pieces.clearGhosts({ fade: 0.4 });
      this.arcs.retire(null, 0.3);
    } else if (name === 'rebuild') {
      this.phaseDuration = TIMING.rebuild;
      this.plyIndex = 0;
      this.boardState.reset();
      this.pieces.build(this.boardState, { animateIn: true });
      this.tactic = null;
      this.tacticStep = -1;
      this.activeEntry = null;
      this.lineStrip.clear();
      this.forecast.project(0);
      /* Reveal nothing: the position is back to the first move, so a ribbon of a
         game that has not been replayed yet would be showing the future. */
      this.#applyEval(0, { reveal: -1 });
    }
  }

  #advance() {
    if (this.phase === 'tactics') {
      this.#enterPhase('analysis');
    } else if (this.phase === 'analysis') {
      this.#enterPhase('travel');
    } else if (this.phase === 'travel') {
      this.#enterPhase('settle');
    } else if (this.phase === 'settle') {
      if (this.plyIndex >= this.game.plies.length - 1) {
        this.#enterPhase('finale');
      } else {
        this.plyIndex += 1;
        this.#enterPhase(this.#openingPhase());
      }
    } else if (this.phase === 'finale') {
      this.#enterPhase('dissolve');
    } else if (this.phase === 'dissolve') {
      this.#enterPhase('rebuild');
    } else {
      this.#enterPhase(this.#openingPhase());
    }
  }

  /* --------------------------------------------------------------- tactics */

  /**
   * Turns a predicted line into a schedule of imagined moves.
   *
   * The line has to be simulated rather than read off the board: only its first
   * move starts from a square the real position can answer for, and a piece can
   * appear twice in one line. So a phantom occupancy is carried through it, which
   * is also what decides what happens on a capture — an imagined piece is
   * retired, a real one only dimmed, because it is still on the board.
   */
  #planGhostLine(moves, { step, travel }) {
    const lead = moves[0]?.color;
    const tintFor = (color) => (color === lead ? PALETTE.tactic : PALETTE.forecast);

    const occupancy = new Map();
    for (const piece of this.boardState.bySquare.values()) {
      occupancy.set(piece.square, {
        key: piece.id,
        type: piece.type,
        color: piece.color,
        real: true,
      });
    }

    const events = [];
    moves.forEach((move, i) => {
      const mover = occupancy.get(move.from);
      if (!mover) return;
      const target = occupancy.get(move.to) ?? null;

      events.push({
        key: mover.key,
        type: mover.type,
        color: mover.color,
        tint: tintFor(mover.color),
        from: move.from,
        to: move.to,
        at: i * step,
        travel,
        capture: Boolean(target),
        capturesKey: target && !target.real ? target.key : null,
        dimsEntryId: target && target.real ? target.key : null,
        promotion: move.promotion ?? null,
      });

      occupancy.delete(move.from);
      occupancy.set(move.to, {
        key: mover.key,
        type: move.promotion ?? mover.type,
        color: mover.color,
        real: false,
      });

      if (!move.rook) return;
      const rook = occupancy.get(move.rook.from);
      if (!rook) return;
      events.push({
        key: rook.key,
        type: rook.type,
        color: rook.color,
        tint: tintFor(rook.color),
        from: move.rook.from,
        to: move.rook.to,
        at: i * step + travel * 0.3,
        travel,
        capture: false,
        capturesKey: null,
        dimsEntryId: null,
        isCastleRook: true,
      });
      occupancy.delete(move.rook.from);
      occupancy.set(move.rook.to, {
        key: rook.key,
        type: rook.type,
        color: rook.color,
        real: false,
      });
    });

    return events;
  }

  /**
   * Performs a predicted line over the board: translucent copies of the pieces
   * glide through each move in turn while the real position dims underneath, with
   * an arc leading each one in.
   *
   * Performed rather than diagrammed, which is the whole of the second beat: a
   * picture of where the pieces end up reads as clutter, and it never says that a
   * line is being *considered*.
   */
  #beginTactics(moves) {
    const step = Math.max(
      0.16,
      (this.phaseDuration - TACTICS_TAIL) / Math.max(1, moves.length)
    );
    const travel = step * 0.82;
    const lead = moves[0]?.color;

    this.tacticStep = -1;
    this.tacticStepTime = step;
    this.#setTactic(this.plyIndex, moves);
    /* The line *is* the search result, so the depth ramp opens here and carries
       through the analysis beat that follows. */
    this.#beginSearch(this.phaseDuration + TIMING.analysis);

    moves.forEach((move, i) => {
      const a = squareToWorld(move.from);
      const b = squareToWorld(move.to);
      this.arcs.spawn({
        from: new THREE.Vector3(a.x, 0, a.z),
        to: new THREE.Vector3(b.x, 0, b.z),
        /* Amber for the side doing the winning, periwinkle for the answers it
           forces: one line of play, two voices. */
        kind: move.color === lead ? 'tactic' : 'reply',
        life: step * 2.6 + 0.35,
        delay: i * step,
        travel: step * 0.45,
        /* Each link arches a little higher, so a chain crossing the same squares
           stays separable. */
        apexScale: 1 + i * 0.07,
      });
    });

    this.pieces.playGhostLine(this.#planGhostLine(moves, { step, travel }), {
      tint: PALETTE.tactic,
    });

    const last = moves[moves.length - 1];
    if (last?.mate) this.board.highlight(last.to, PALETTE.check, 0.8, 1.6);

    /* Reach the trend ribbon ahead of the position, as far as the line runs and
       toward whatever it arrives at — read off the end of the same line the ghosts
       are playing, so the card and the board cannot disagree. */
    this.forecast.project(moves.length, winDrawLoss(signedEval(last)));
    this.lineStrip.setState('thinking');
    /* One opponent is calculating while a line is being run out. The roster only
       ever has one lit at a time — five meters sweeping together is an idle
       animation. */
    this.roster.cycleActive();
  }

  /**
   * Keeps the strip's runner on whichever move is being imagined on the board,
   * off the same step length the ghost schedule was built with. A fractional
   * position, not an index, so it travels with the phantom piece rather than
   * hopping a beat after each one lands.
   */
  #updateTactics() {
    if (this.phase !== 'tactics' || !this.tactic) return;
    const { moves } = this.tactic;
    const step = this.tacticStepTime || this.phaseDuration / Math.max(1, moves.length);
    const at = Math.min(moves.length - 1, this.phaseTime / step);
    this.lineStrip.setStep(at);
    this.tacticStep = Math.floor(at);
  }

  /**
   * Composes the line panel for a ply. A line is kept up for as long as the game
   * is following it, so the panel shows a prediction being confirmed move by move
   * rather than being rebuilt every ply.
   */
  #syncTactic() {
    const line = resolvePv(this.game, this.plyIndex);
    if (line.length > 1) {
      this.#setTactic(this.plyIndex, line);
      this.lineStrip.setState('playing');
      return;
    }

    if (this.tactic) {
      const step = this.plyIndex - this.tactic.index;
      if (step > 0 && step < this.tactic.moves.length) {
        this.tacticStep = step;
        this.lineStrip.setStep(step);
        this.lineStrip.setState('playing');
        return;
      }
    }

    this.#setTactic(this.plyIndex, this.currentPly ? [this.currentPly] : []);
    this.lineStrip.setState('');
  }

  /** Pushes a line to the strip, skipping the rebuild if it is already shown. */
  #setTactic(index, moves) {
    if (this.tactic?.index === index && this.tactic.moves.length === moves.length) {
      this.lineStrip.setStep(0);
      return;
    }

    const verdict = tacticVerdict(this.game, index);
    const forecast = predictedReply(this.game, index);
    this.tactic = { index, moves, verdict };
    this.tacticStep = 0;

    const numberFor = (move, i) => {
      const full = Math.floor((index + i) / 2) + 1;
      if (move.color === 'w') return `${full}.`;
      /* Only a line's opening step needs a number on Black's move, and it takes
         the ellipsis form: the column it heads has no white move above it. */
      return i === 0 ? `${full}\u2026` : null;
    };

    const steps = moves.map((move, i) => ({
      san: move.san,
      color: move.color,
      number: numberFor(move, i),
      forecast: false,
    }));

    /* With no line to show there is one move on the strip and three empty
       columns, so the predicted answer goes in beside it — hollow, because it is a
       forecast rather than a move anything committed to. Once a real line is up its
       second step *is* the answer, and printing it twice would make the strip claim
       more than it knows. */
    if (steps.length === 1 && forecast) {
      steps.push({
        san: forecast.move.san,
        color: forecast.move.color,
        number: numberFor(forecast.move, 1),
        forecast: true,
      });
    }

    this.lineStrip.setLine({
      verdict: verdict.label,
      qualifier: verdict.qualifier,
      kind: verdict.kind,
      leadColor: moves[0]?.color ?? 'w',
      steps,
    });
    this.lineStrip.setStep(0);
  }

  /* --------------------------------------------------------------- analysis */

  #beginAnalysis() {
    const ply = this.currentPly;
    if (!ply) return;

    /* Retire the preview before the real move starts: a ghost still standing on
       the square a piece is about to occupy renders as a double exposure. */
    this.arcs.retire('tactic', 0.22);
    this.pieces.clearGhosts({ fade: 0.22 });
    this.forecast.project(0);
    this.#syncTactic();

    const entry = [...this.pieces.entries.values()].find(
      (e) => !e.removed && e.square === ply.from
    );
    this.activeEntry = entry ?? null;

    this.board.highlight(ply.from, PALETTE.origin, 0.9, 1.1);
    this.board.highlight(
      ply.to,
      ply.capture ? PALETTE.capture : PALETTE.destination,
      0.7,
      1.1
    );

    /* Decoys first, so the move that gets played draws on top of them. Two, not
       three: enough to read as alternatives having been weighed, not enough to
       bury the best move under a fan. */
    this.#pickDecoys(ply, 2).forEach((decoy, i) => {
      const a = squareToWorld(decoy.from);
      const b = squareToWorld(decoy.to);
      this.arcs.spawn({
        from: new THREE.Vector3(a.x, 0, a.z),
        to: new THREE.Vector3(b.x, 0, b.z),
        kind: 'candidate',
        life: TIMING.analysis * 1.5,
        delay: 0.03 + i * 0.05,
        spread: i + 1,
        travel: TIMING.analysis * 0.7,
      });
    });

    /* The move itself. This arc is the whole of the first beat: a suggestion drawn
       over the position, and then the position changing to match it. */
    const from = squareToWorld(ply.from);
    const to = squareToWorld(ply.to);
    this.arcs.spawn({
      from: new THREE.Vector3(from.x, 0, from.z),
      to: new THREE.Vector3(to.x, 0, to.z),
      kind: ply.capture ? 'threat' : 'best',
      life: TIMING.analysis + TIMING.travel + 0.35,
      delay: 0.06,
      travel: TIMING.analysis * 0.72,
    });

    if (entry) this.pieces.pulse(entry.id, 0.8);
    if (this.search.forPly !== this.plyIndex) this.#beginSearch(TIMING.analysis);
  }

  /** Plausible alternatives for the side to move, for the candidate arcs. */
  #pickDecoys(ply, count) {
    const options = [];
    for (const piece of this.boardState.bySquare.values()) {
      if (piece.color !== ply.color) continue;
      if (piece.square === ply.from) continue;
      for (const move of this.boardState.movesFrom(piece.square)) {
        if (move.to === ply.to) continue;
        const centre =
          2 -
          (Math.abs(move.to.charCodeAt(0) - 100.5) +
            Math.abs(Number(move.to[1]) - 4.5)) *
            0.35;
        options.push({
          from: piece.square,
          to: move.to,
          weight: centre + (move.capture ? 2.4 : 0) + Math.random() * 1.6,
        });
      }
    }

    options.sort((a, b) => b.weight - a.weight);

    /* At most one alternative per piece, so the fan spreads across the board
       rather than out of one square. */
    const used = new Set();
    const picked = [];
    for (const option of options) {
      if (used.has(option.from)) continue;
      used.add(option.from);
      picked.push(option);
      if (picked.length >= count) break;
    }
    return picked;
  }

  #beginTravel() {
    const ply = this.currentPly;
    if (!ply) return;

    this.arcs.retire('candidate', 0.18);

    const result = this.boardState.apply(ply);
    if (!result) return;

    const duration = TIMING.travel * 0.98;
    this.pieces.animateMove(result.piece.id, ply.to, {
      duration,
      capture: Boolean(result.captured),
      onLand: () => this.#onLanded(ply, result),
    });

    if (result.rook) {
      this.pieces.animateMove(result.rook.id, ply.rook.to, {
        duration: duration * 1.12,
        isCastleRook: true,
      });
      this.board.highlight(ply.rook.from, PALETTE.cyan, 0.7, 2.4);
      this.board.highlight(ply.rook.to, PALETTE.cyan, 0.9, 1.6);
    }

    this.board.flash(ply.from, PALETTE.origin, 1.2);
    this.board.ripple(ply.from, PALETTE.origin, { scale: 0.95, duration: 0.7 });
  }

  /**
   * Impact, and everything about it is local to the square that was played. No
   * full-frame flash and no camera shake: those hit the whole image to report
   * something that happened on one square, which is louder and less informative
   * than lighting the square.
   */
  #onLanded(ply, result) {
    if (result.captured) {
      this.pieces.animateCapture(result.captured.id, { duration: 0.5 });
      this.board.ripple(ply.to, PALETTE.capture, { scale: 1.5, duration: 1.05 });
      this.board.flash(ply.to, PALETTE.capture, 1.6);
    } else {
      this.board.ripple(ply.to, PALETTE.destination, { scale: 1.2, duration: 0.9 });
      this.board.flash(ply.to, PALETTE.destination, 1.1);
    }

    if (ply.check || ply.mate) this.board.highlight(ply.to, PALETTE.check, 1.4, 1.4);
    if (ply.rook) {
      this.board.ripple(ply.rook.to, PALETTE.cyan, { scale: 1.1, duration: 0.85 });
    }

    this.#applyEval(this.plyIndex);
    this.forecast.ping();
  }

  /**
   * The opponent's predicted answer, drawn once the move that provoked it has
   * landed. Deliberately not during analysis: alongside the best arc and the
   * candidate fan it would be a fourth ribbon in the air, and the claim only means
   * anything after the move it answers is on the board.
   */
  #showReply() {
    this.arcs.retire('reply', 0.2);
    const forecast = predictedReply(this.game, this.plyIndex);
    if (!forecast) return;

    const move = forecast.move;
    const a = squareToWorld(move.from);
    const b = squareToWorld(move.to);
    this.arcs.spawn({
      from: new THREE.Vector3(a.x, 0, a.z),
      to: new THREE.Vector3(b.x, 0, b.z),
      kind: 'reply',
      life: TIMING.settle + TIMING.analysis + 0.7,
      travel: 0.34,
      apexScale: 1.1,
    });
    this.board.highlight(move.to, PALETTE.forecast, 0.55, 2.2);

    const entry = [...this.pieces.entries.values()].find(
      (e) => !e.removed && e.square === move.from
    );
    if (entry) this.pieces.pulse(entry.id, 0.5);
  }

  #beginFinale() {
    this.arcs.retire('candidate', 0.2);
    this.arcs.retire('reply', 0.2);
    this.forecast.project(0);
    if (this.tactic) this.lineStrip.setStep(this.tactic.moves.length - 1);
    this.lineStrip.setState('');
    this.roster.setActive(-1);

    /* One light, on the mated king. Marking the king says what happened; a
       full-frame flash does not. */
    for (const entry of this.pieces.entries.values()) {
      if (entry.removed) continue;
      if (entry.type === 'k' && entry.color === 'b') {
        this.board.highlight(entry.square, PALETTE.check, 2.2, 0.35);
        this.pieces.pulse(entry.id, 1.1);
      }
    }
  }

  /**
   * Pushes a ply's score onto the evaluation bar and the trend ribbon.
   *
   * `signedEval` and `evalToFill` are the only place the score is interpreted, so
   * the fill, the ticks, the printed number and the ribbon cannot disagree.
   */
  #applyEval(index, { reveal = index } = {}) {
    const ply = this.game.plies[index];
    const score = signedEval(ply);
    this.evalSpine.set(
      evalToFill(score),
      formatEval(ply),
      Boolean(ply?.mate || ply?.mateIn)
    );
    this.forecast.reveal(reveal, { snap: reveal < 0 });
  }

  /** Opens a search for the current ply, to be ramped over `window` seconds. */
  #beginSearch(window) {
    const s = this.search;
    s.forPly = this.plyIndex;
    s.think = 0;
    s.window = Math.max(0.001, window);
    /* At or under the gauge's twenty rungs, so the ladder never pins. */
    s.targetDepth = 16 + Math.floor(Math.random() * 5);
  }

  #updateSearchReadout(dt) {
    const s = this.search;

    let ramp = 0;
    if (this.phase === 'tactics' || this.phase === 'analysis') {
      s.think += dt;
      ramp = clamp(s.think / s.window);
    } else if (this.phase === 'travel' || this.phase === 'settle') {
      ramp = 1;
    }

    s.depth = damp(s.depth, easeOutCubic(ramp) * s.targetDepth, 6, dt);
    this.depthLadder.set(s.depth);
    /* The same ramp sweeps the predicted line, so the two cards are reporting one
       search from opposite ends of the board rather than each running an animation
       of its own. */
    this.lineStrip.setSearch(ramp, this.phase === 'tactics' || this.phase === 'analysis');
  }

  /* ------------------------------------------------------------------ frame */

  /**
   * Whether the chapter's copy is a column beside the frame rather than a block in
   * the middle of it — which decides whether the subject is composed off-centre.
   *
   * Read off the canvas' own measured width rather than from `window`, for the same
   * reason `resize` is: this element is full-bleed today and the scene should not
   * have an opinion about whether it stays that way.
   */
  get #sideCopy() {
    return (
      this.width >= SIDE_COPY_MIN_WIDTH && this.camera.aspect >= LANDSCAPE_ASPECT
    );
  }

  get #narrow() {
    return this.camera.aspect < LANDSCAPE_ASPECT;
  }

  /** Where the two wide panels stand, which depends on the frame's shape. */
  #layoutPanels() {
    const standoff = this.#narrow ? PANEL_STANDOFF.narrow : PANEL_STANDOFF.wide;
    this.forecast.standAt(standoff);
    this.lineStrip.standAt(standoff);
  }

  /**
   * Resolves the shot the current `beat` asks for and eases the camera toward it.
   *
   * Interpolated between the two shots either side rather than cut between, and
   * eased on the way, so the fractional beat a scrub leaves the reader on is a
   * composed frame rather than a halfway house between two.
   */
  #updateCamera(dt) {
    const narrow = this.#narrow;
    const side = this.#sideCopy;
    const at = clamp(this.channels.beat, 0, SHOTS.length - 1);
    const i = Math.min(SHOTS.length - 2, Math.floor(at));
    const t = easeInOutCubic(clamp(at - i));
    const a = SHOTS[i];
    const b = SHOTS[i + 1];

    const radiusOf = (shot) => (narrow ? shot.radiusNarrow : shot.radius);
    /* Three compositions, resolved most-specific first, each falling through to the
       one it is a variation of. `side` and `narrow` are mutually exclusive by
       construction — a frame cannot be both wider than 1000px and narrower than
       0.85:1 at the same time on any viewport this page runs at — but the order is
       stated rather than relied on. */
    const placeOf = (shot) => {
      if (side && shot.placeSide) return shot.placeSide;
      if (narrow && shot.placeNarrow) return shot.placeNarrow;
      return shot.place;
    };

    const sway =
      Math.sin(this.time * SWAY_RATE * Math.PI * 2) *
      SWAY *
      (this.reducedMotion ? 0.3 : 1);

    const d = this.desired;
    d.theta = lerp(a.theta, b.theta, t) + sway;
    d.phi = lerp(a.phi, b.phi, t);
    if (narrow) d.phi = Math.min(d.phi, PORTRAIT_MAX_PHI);
    d.radius = lerp(radiusOf(a), radiusOf(b), t);
    d.target.set(
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
      lerp(a.target[2], b.target[2], t)
    );
    const pa = placeOf(a);
    const pb = placeOf(b);
    d.place.set(lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t));

    this.spherical.theta = damp(this.spherical.theta, d.theta, CAMERA_EASE, dt);
    this.spherical.phi = damp(this.spherical.phi, d.phi, CAMERA_EASE, dt);
    this.spherical.radius = damp(this.spherical.radius, d.radius, CAMERA_EASE, dt);
    this.spherical.makeSafe();
    this.target.lerp(d.target, 1 - Math.exp(-CAMERA_EASE * dt));
    this.place.lerp(d.place, 1 - Math.exp(-CAMERA_EASE * dt));

    this.camera.position.setFromSpherical(this.spherical).add(this.target);
    this.camera.lookAt(this.target);
    this.#frameShot();
  }

  /**
   * Puts the subject where `place` says it goes.
   *
   * Done with the camera's view offset rather than by aiming a little to one side
   * of the target, which is the difference between panning the frame and turning
   * the camera: turning changes what the perspective does to the subject as well
   * as where it sits, so a card composed into the right third by rotation arrives
   * there sheared. The offset shifts the frustum and leaves the axis on the
   * subject.
   */
  #frameShot() {
    const px = this.place.x;
    const py = this.place.y;

    if (Math.abs(px) < 1e-4 && Math.abs(py) < 1e-4) {
      if (this.viewOffset) {
        this.camera.clearViewOffset();
        this.viewOffset = false;
      }
      return;
    }

    /* Signs, once, because they are not guessable: a positive offsetX raises the
       frustum's left edge, which moves the *content* left — so the subject ends up
       where `place` asks for only if the offset runs against it. Same for y, with
       the extra flip that screen y grows downward and `place.y` grows up. */
    this.camera.setViewOffset(
      this.width,
      this.height,
      (-px * this.width) / 2,
      (py * this.height) / 2,
      this.width,
      this.height
    );
    this.viewOffset = true;
  }

  /**
   * The float and the pointer parallax, applied to the world rather than to the
   * camera so the shot the beat asked for stays the shot it gets.
   */
  #updateWorld(dt) {
    this.parallax.x = damp(this.parallax.x, this.parallaxTarget.x, 3.2, dt);
    this.parallax.y = damp(this.parallax.y, this.parallaxTarget.y, 3.2, dt);

    const float = this.reducedMotion ? 0 : Math.sin(this.time * 0.45) * 0.018;
    this.world.position.set(0, float, 0);
    this.world.rotation.set(-this.parallax.y * 0.014, this.parallax.x * 0.018, 0);
  }

  /** Pushes the scroll channels onto the things that read them. */
  #applyChannels() {
    const c = this.channels;

    for (const card of this.instruments) setCardFade(card, clamp(c.instruments));

    /* Its own channel rather than a share of `instruments`, which is what it
       started as. The closing shot needs the four analysis cards to *leave* while
       the gauge stays — the camera has flown across the board to read one card, and
       an evaluation bar in the near foreground at that distance is brighter and
       larger than the thing being read. Derived from one channel there was no way
       to say that. */
    this.eloGauge.setFade(clamp(c.gauge));
    this.eloGauge.set(c.elo);

    this.roster.setFade(clamp(c.bots));

    this.renderer.toneMappingExposure =
      EXPOSURE * lerp(1, EXPOSURE_DIM, clamp(c.dim));
  }

  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    this.phaseTime += dt;
    if (this.phaseTime >= this.phaseDuration) this.#advance();

    this.#updateTactics();
    this.#updateSearchReadout(dt);
    this.#applyChannels();
    this.#updateCamera(dt);
    this.#updateWorld(dt);

    this.atmosphere.update(this.time);
    this.board.update(dt);
    this.pieces.update(dt);
    this.arcs.update(dt, this.time);
    /* The cards need the camera: they yaw to keep their faces readable. */
    for (const card of this.instruments) card.update(dt, this.camera);
    this.eloGauge.update(dt, this.camera);
    this.roster.update(dt, this.camera);

    /* The key light trails the piece that is moving, so the moving piece is the
       brightest thing on the board. */
    if (this.activeEntry && !this.activeEntry.removed) {
      const p = this.activeEntry.mesh.position;
      this.lights.key.position.x = damp(this.lights.key.position.x, p.x - 3.6, 1.6, dt);
      this.lights.key.position.z = damp(this.lights.key.position.z, p.z + 5.4, 1.6, dt);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /* ----------------------------------------------------------------- public */

  /** Fits the lens, the buffer and the layout to `this.width/height`. */
  #applyViewport() {
    this.camera.aspect = this.width / this.height;
    /* A wider lens on a narrow layout, so less pull-back is needed to hold the
       composition — a portrait frame sees far less horizontally at a given
       distance, and distance is the thing this scene has least of to spare. */
    this.camera.fov = this.#narrow ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.#layoutPanels();
    /* The view offset is stated in pixels of the frame it was measured against, so
       a stale one composes against the old frame. */
    this.#frameShot();
  }

  resize() {
    if (this.failed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.#applyViewport();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    if (this.onPointerMove) {
      window.removeEventListener('pointermove', this.onPointerMove);
    }

    this.atmosphere?.dispose();
    this.board?.dispose();
    this.pieces?.dispose();
    this.arcs?.dispose();
    for (const card of this.instruments ?? []) card.dispose();
    this.eloGauge?.dispose();
    this.roster?.dispose();
    this.envMap?.dispose();
    this.renderer?.dispose();
    /* `dispose()` does not release the context; `forceContextLoss()` does. This
       page runs several live contexts and browsers cap how many a document may
       hold, so handing this one back matters. */
    this.renderer?.forceContextLoss();
    this.canvas?.remove();
  }
}

/**
 * Mounts the scene into a sized element.
 *
 * @param {HTMLElement} container
 * @param {object} [options] see the constructor
 * @returns {ChessScene|null} null when WebGL was refused
 */
export function createChessScene(container, options) {
  const scene = new ChessScene(container, options);
  return scene.failed ? null : scene;
}
