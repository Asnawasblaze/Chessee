import * as THREE from "three";
import {
  applyMorphWeights,
  createMorphingPieceGeometry,
  createPieceGeometry,
  createPieceOrnament,
  pieceWeights,
  PIECE_RIM,
  PIECE_TOPS,
  type PieceName,
} from "./chessPieces";

/* ---------------------------------------------------------------------- */
/* Three looping visuals, one per feature                                  */
/* ---------------------------------------------------------------------- */

/* The features chapter used to show one knight in three different poses, which
 * said the same thing three times: the reader saw a piece rotate and had to
 * take it on trust that the rotation had anything to do with the heading next
 * to it. Each feature gets its own scene here instead, and each scene *is* its
 * feature stated in motion rather than decorated by it:
 *
 *   01 customise  a board that re-skins itself in a travelling wave while the
 *                 piece hovering over it is re-cut into a different piece
 *   02 bots       an engine core precessing inside three gyroscope rings, over
 *                 a radial readout that sweeps like a search, with pawns
 *                 waiting on the ring below it
 *   03 analysis   one position read four plies deep, as four boards stacked
 *                 with the chosen line threaded up through them, a wave of
 *                 evaluation climbing the stack and a bar stepping with it
 *
 * Every one of them loops seamlessly and none of them has a start or an end,
 * because the reader arrives at an arbitrary moment and may sit on any of the
 * three for as long as they like. Nothing here is scroll-driven: scroll only
 * decides *which* scene is showing (see FeatureVisual), and that separation is
 * what lets a scene keep breathing while the page is still.
 *
 * Geometry is procedural end to end — no .glb, no textures, no loader. See
 * chessPieces.ts for why the pieces can be.
 */

export type FeatureSceneId = "customise" | "bots" | "analysis";

/** Where a scene meets the floor, in the units its own group is authored in. */
export interface SceneGround {
  /** Lowest point of the scene's visual mass. */
  y: number;
  /** Footprint radius, which sets how wide the DOM contact shadow spreads. */
  radius: number;
  /** Shadow strength. Scenes that levitate get a weaker, wider pool. */
  alpha: number;
}

export interface FeatureScene {
  /** Transformed by the host: crossfade scale, depth offset and pose. */
  group: THREE.Group;
  ground: SceneGround;
  /**
   * Advances the loop. `t` is seconds, monotonic, shared by all scenes.
   *
   * `boost` is a multiplier for anything drawn as a *line*, ≥ 1, published by
   * the host from the canvas' height. WebGL lines are always one device pixel
   * wide however large the scene is, so on a short canvas they fall below half a
   * CSS pixel and vanish at the alphas these are authored at. Width is not
   * fixable; opacity is. See the note on LINE_REFERENCE_H in FeatureVisual.
   */
  update(t: number, boost: number): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------- */
/* Palette + helpers                                                       */
/* ---------------------------------------------------------------------- */

/* The light chapter's own tokens, as hex. Kept in step with the CSS on
   .feature-story: --f-ink, --f-ink-soft, --f-accent and the sky ramp. The
   accent is the darkened one (#17789f), not the dark theme's #9bd8ed — on a
   near-white stage a pale accent is invisible, so "active" here reads as
   something going *darker*, not brighter. That inversion is the single most
   important thing about lighting these scenes. */
const INK = 0x0b2230;
const IVORY = 0xeff6fa;
const ACCENT = 0x17789f;
const ACCENT_DEEP = 0x0f5f80;
const STEEL = 0x93aeba;
const STEEL_PALE = 0xc3d6e0;

const TAU = Math.PI * 2;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hermite ramp between two edges. */
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Smooth symmetric falloff of half-width `w` about 0. */
const bump = (d: number, w: number) => {
  const t = clamp01(1 - Math.abs(d) / w);
  return t * t * (3 - 2 * t);
};

/** Positive modulo. `%` keeps the sign of the dividend, which breaks every
    "which cycle am I in" calculation for the frames before t passes zero. */
const mod = (a: number, n: number) => ((a % n) + n) % n;

const fract = (x: number) => x - Math.floor(x);

/** A line material's opacity after the host's small-canvas boost. */
const lineAlpha = (base: number, boost: number) => Math.min(1, base * boost);

/* Everything a scene allocates gets registered here, so teardown is one call
   and cannot drift out of step with the builder. Three's renderer does not
   free geometries or materials on its own — the page holds a live GL context
   for the whole session, so anything missed here stays resident on the GPU
   until the tab closes. */
function disposer() {
  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  return {
    keep<T extends THREE.BufferGeometry | THREE.Material>(item: T): T {
      owned.push(item);
      return item;
    },
    dispose() {
      for (const item of owned) item.dispose();
      owned.length = 0;
    },
  };
}

// Scratch objects. Reused across every frame of every scene: composing a
// matrix per instance is the whole per-frame cost of two of these scenes, and
// allocating three Vector3s and a Quaternion per instance per frame is how
// that turns into GC pressure.
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _color = new THREE.Color();
const _from = new THREE.Color();
const _to = new THREE.Color();

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Writes `a`→`b` at `f` into the shared scratch colour and returns it. */
function mixHex(a: number, b: number, f: number) {
  _from.setHex(a);
  _to.setHex(b);
  return _color.copy(_from).lerp(_to, clamp01(f));
}

/** A square outline in the XZ plane, half-extent 1. */
function createSquareOutlineGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -1, 0, -1, 1, 0, -1, 1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, 1, -1,
        0, -1,
      ],
      3
    )
  );
  return geometry;
}

/* ---------------------------------------------------------------------- */
/* 01 — "Everything is customisable"                                       */
/* ---------------------------------------------------------------------- */

/* A board re-skinning itself, and the piece above it being re-cut.
 *
 * The wave is the whole idea: a crest travels along the board's diagonal, each
 * tile it reaches turns over, and the tile comes back down in a different
 * theme. Because the colour is swapped at the halfway point of the flip — when
 * the tile is edge-on and has no visible face — the change is never *seen*
 * happening, only its result, which is what makes it read as the board being
 * re-skinned rather than as tiles changing colour.
 *
 * Meanwhile the piece hovering over the centre morphs pawn → rook → bishop →
 * queen on the same clock. Two kinds of customisation, one heartbeat. */

const BOARD_N = 8;
const TILE_PITCH = 0.3;
const TILE_SIZE = 0.278;
const TILE_THICK = 0.052;
const BOARD_Y = -1;
/** Half the board's true footprint, tiles included. */
const BOARD_HALF = ((BOARD_N - 1) / 2) * TILE_PITCH + TILE_SIZE / 2;
/** Crests per second. Slow: the reader is meant to notice it, not watch it. */
const WAVE_SPEED = 0.4;
/** Fraction of a tile's cycle spent turning over. The rest it sits still. */
const CREST = 0.24;
const TILE_LIFT = 0.16;

/* Three complete board themes, cycled by the wave. All three are inside the
   chapter's own palette — a genuinely arbitrary set of colours would say
   "theme picker demo" rather than "this page's board, your way". */
const BOARD_THEMES: ReadonlyArray<readonly [number, number]> = [
  [IVORY, 0x2b4d5e],
  [0xdcecf5, ACCENT_DEEP],
  [0xffffff, INK],
];
/** Piece finishes, cycled on the same clock as the board themes. */
const PIECE_TINTS = [0x14303f, ACCENT, 0x8fa9b6];

const MORPH_ORDER: readonly PieceName[] = ["pawn", "rook", "bishop", "queen"];
/** Seconds per piece, morph included. */
const MORPH_PERIOD = 3.4;
/* World height of the *tallest* piece in the set — the queen. The other three
   keep their own proportions below it (see the note on staging in chessPieces),
   so this is divided by her own profile height to get a scale rather than being
   used as one: the profiles top out between 0.58 and 1.00, so treating this as a
   multiplier would silently mean something different every time a silhouette was
   retuned. 1.5 puts her orb where the old single-height piece topped out, so the
   scene's framing is unchanged, and leaves the rook a little over half her
   height — which is the staging a real set has. */
const PIECE_HEIGHT = 1.5;
const PIECE_HOVER = 0.3;

/* The tiles turn over about the axis running *along* the wave front, not about
   a world axis — so the whole crest folds as one line crossing the board
   rather than 64 tiles happening to rotate at staggered times. The front runs
   at 45° to the files, so its axis is the other diagonal. */
const FLIP_AXIS = new THREE.Vector3(1, 0, -1).normalize();

function createCustomiseScene(): FeatureScene {
  const own = disposer();
  const group = new THREE.Group();

  /* ── Board ─────────────────────────────────────────────────────────── */
  const board = new THREE.Group();
  board.position.y = BOARD_Y;
  // A little more rake than the camera alone gives, so the board reads as a
  // board rather than as a bright horizontal band.
  board.rotation.x = 0.1;
  group.add(board);

  const tileGeometry = own.keep(
    new THREE.BoxGeometry(TILE_SIZE, TILE_THICK, TILE_SIZE)
  );
  const tileMaterial = own.keep(
    new THREE.MeshStandardMaterial({
      // White, because the per-instance colour multiplies into it.
      color: 0xffffff,
      metalness: 0.34,
      roughness: 0.36,
      envMapIntensity: 0.9,
    })
  );
  const tileCount = BOARD_N * BOARD_N;
  const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  /* Seeded before the first render on purpose: three only compiles the
     instanced-colour path into the shader if `instanceColor` exists when the
     material is first used, so a mesh that gets its colours a frame later
     renders that first frame — and every frame after it — in flat white. */
  for (let i = 0; i < tileCount; i++) {
    const parity = ((i % BOARD_N) + Math.floor(i / BOARD_N)) & 1;
    tiles.setColorAt(i, _color.setHex(BOARD_THEMES[0][parity]));
  }
  tiles.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  board.add(tiles);

  // Hairline frame just outside the tiles — the same 1px rule language the
  // chapter's type sits on, so the board belongs to the page.
  const frameMaterial = own.keep(
    new THREE.LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.34,
    })
  );
  const frame = new THREE.LineSegments(
    own.keep(createSquareOutlineGeometry()),
    frameMaterial
  );
  frame.scale.setScalar(BOARD_HALF + 0.07);
  board.add(frame);

  /* Selection ring under the hovering piece. Chess UI's own vocabulary for
     "this is the thing you are changing", which is the one cue that explains
     why the piece is off the board at all. */
  /* Sized to clear the widest base in the set (the queen's, ~0.34 world units in
     radius at PIECE_HEIGHT) rather than to match a square. The piece is held
     *above* the board as a specimen being re-cut, well over board scale, so a
     ring the size of a square would read as belonging to neither. */
  const ring = new THREE.Mesh(
    own.keep(new THREE.RingGeometry(0.395, 0.428, 72)),
    own.keep(
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = TILE_THICK / 2 + 0.004;
  board.add(ring);

  /* ── The piece ─────────────────────────────────────────────────────── */
  const pieceMaterial = own.keep(
    new THREE.MeshPhysicalMaterial({
      color: PIECE_TINTS[0],
      metalness: 0.5,
      roughness: 0.22,
      // Turned pieces are polished, and a clearcoat is what separates
      // "polished" from "shiny plastic": the specular sits in a thin layer
      // above the body colour instead of washing it out.
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1,
    })
  );
  /* The morphing body and its crown ornaments share one group, so the whole
     piece turns and is scaled as a unit and the ornaments can be authored in the
     profile's own units. */
  const pieceGroup = new THREE.Group();
  pieceGroup.scale.setScalar(PIECE_HEIGHT / PIECE_TOPS.queen);
  group.add(pieceGroup);

  const piece = new THREE.Mesh(
    own.keep(createMorphingPieceGeometry(MORPH_ORDER)),
    pieceMaterial
  );
  pieceGroup.add(piece);

  const influences = piece.morphTargetInfluences ?? [];
  const weights: number[] = new Array(MORPH_ORDER.length).fill(0);

  /* Crenellations and coronet points — the two features that make a rook a rook
     and a queen a queen, and the two a lathe cannot cut. See the note on
     createPieceOrnament. Sharing `pieceMaterial` means they re-finish with the
     body when the theme cycles; it also compiles a second program variant for
     the non-morphing meshes, which happens on the first frame alongside
     everything else rather than mid-scroll. */
  const ornaments = MORPH_ORDER.map((name, index) => {
    const ornament = createPieceOrnament(name, pieceMaterial);
    if (!ornament) return null;
    for (const geometry of ornament.geometries) own.keep(geometry);
    pieceGroup.add(ornament.group);
    return { ...ornament, index };
  }).filter((entry) => entry !== null);

  return {
    group,
    ground: {
      y: BOARD_Y - TILE_THICK / 2,
      radius: BOARD_HALF,
      alpha: 1,
    },
    update(t, boost) {
      frameMaterial.opacity = lineAlpha(0.34, boost);
      const travel = t * WAVE_SPEED;

      for (let i = 0; i < tileCount; i++) {
        const col = i % BOARD_N;
        const row = (i / BOARD_N) | 0;
        // Position along the wave's direction of travel, normalised so the
        // crest takes exactly one cycle to cross the whole board.
        const u = (col + row) / (2 * (BOARD_N - 1));
        const s = travel - u;
        const cycle = Math.floor(s);
        const within = s - cycle;

        const flip = smoothstep(0, CREST, within);
        // Accumulated, so the tile is continuous across cycle boundaries: it
        // ends each turn a half-rotation on from where it started rather than
        // unwinding back.
        const angle = (mod(cycle, 2) + flip) * Math.PI;
        // Rises and settles across the turn, plus a breath so a tile the wave
        // is nowhere near is still not perfectly dead.
        const lift =
          Math.sin(flip * Math.PI) * TILE_LIFT +
          Math.sin(t * 0.8 + u * 5) * 0.006;
        const pop = 1 + Math.sin(flip * Math.PI) * 0.07;

        _pos.set(
          (col - (BOARD_N - 1) / 2) * TILE_PITCH,
          lift,
          (row - (BOARD_N - 1) / 2) * TILE_PITCH
        );
        _quat.setFromAxisAngle(FLIP_AXIS, angle);
        _scl.set(pop, 1, pop);
        tiles.setMatrixAt(i, _mat.compose(_pos, _quat, _scl));

        /* The theme this tile is wearing. `cycle` has already advanced by the
           time the flip starts, so the first half of the turn still owes the
           previous theme — swapping at 0.5 puts the change exactly where the
           tile is edge-on and nothing can be seen changing. */
        const theme = BOARD_THEMES[
          mod(cycle - (flip < 0.5 ? 1 : 0), BOARD_THEMES.length)
        ];
        tiles.setColorAt(i, _color.setHex(theme[(col + row) & 1]));
      }
      tiles.instanceMatrix.needsUpdate = true;
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

      // Same clock as the tiles: one finish per two crests.
      const tintPhase = travel * 0.5;
      const tintStep = Math.floor(tintPhase);
      pieceMaterial.color.copy(
        mixHex(
          PIECE_TINTS[mod(tintStep, PIECE_TINTS.length)],
          PIECE_TINTS[mod(tintStep + 1, PIECE_TINTS.length)],
          smoothstep(0.62, 1, fract(tintPhase))
        )
      );

      const morphPhase = t / MORPH_PERIOD;
      pieceWeights(weights, morphPhase, MORPH_ORDER.length, 0.58);
      applyMorphWeights(influences, weights);

      /* Where the blended body's crown rim currently sits — the landmark the
         crown ornaments are cut into. The four pieces are staged at different
         heights *and* different crown widths, so an ornament pinned to its own
         piece's rim comes adrift in both axes the moment the body starts
         becoming something else: the rook's battlements hang in the air at
         cornice width around a pawn's ball head. Re-deriving the rim from the
         blend and following it in height and radius keeps them welded, and at
         full weight the correction is exactly nothing. */
      let rimR = 0;
      let rimY = 0;
      for (let i = 0; i < weights.length; i++) {
        const rim = PIECE_RIM[MORPH_ORDER[i]];
        rimR += weights[i] * rim.r;
        rimY += weights[i] * rim.y;
      }

      for (const ornament of ornaments) {
        const w = weights[ornament.index];
        ornament.group.visible = w > 0.01;
        if (!ornament.group.visible) continue;
        /* Uniform, so the detail narrows with the crown instead of only sliding
           down it. The group scales about the piece's origin, hence the
           `follow *` on the anchor offset — that is what keeps the rim itself
           fixed while everything around it shrinks toward the axis. */
        const follow = rimR / ornament.rim.r;
        ornament.group.scale.setScalar(follow);
        ornament.group.position.y =
          rimY + follow * (ornament.anchorY - ornament.rim.y);
        // Floored, so a part is never handed a singular matrix on its way out.
        const e = Math.max(0.001, w * w * (3 - 2 * w));
        for (const part of ornament.parts) {
          if (ornament.grow === "up") part.scale.set(1, e, 1);
          else part.scale.setScalar(e);
        }
      }

      pieceGroup.position.set(
        0,
        BOARD_Y + PIECE_HOVER + Math.sin(t * 0.55) * 0.035,
        0
      );
      /* Turns steadily, and a little further while it is being re-cut — so the
         new piece presents a fresh face rather than appearing to have been
         there all along. */
      pieceGroup.rotation.y = t * 0.2 + morphPhase * 0.85;

      ring.rotation.z = t * 0.22;
      (ring.material as THREE.MeshBasicMaterial).opacity =
        0.4 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.1));
    },
    dispose: own.dispose,
  };
}

/* ---------------------------------------------------------------------- */
/* 02 — "Gives powerful bots to play"                                      */
/* ---------------------------------------------------------------------- */

/* An engine, drawn as a machine rather than as a robot.
 *
 * A faceted core inside a wireframe shell, three hairline rings precessing
 * around it on separate axes, a radial readout sweeping the floor beneath, and
 * five pawns standing on that floor waiting their turn. The rings and the
 * sweep are what carry "powerful": they are always working, they never
 * complete, and they are visibly doing more than one thing at once.
 *
 * Pawns rather than a knight because the copy is about the bots you play
 * *against* — a rank of them queued around the engine is the whole sentence. */

const CORE_Y = 0.1;
const CORE_R = 0.34;
const RING_RADII = [0.6, 0.71, 0.82];
const RING_TILTS = [1.15, 0.55, -0.35];
const RING_ROLLS = [0, 0.4, -0.6];
const RING_SPINS = [0.42, -0.31, 0.22];
const READOUT_Y = -0.8;
const READOUT_R = 0.86;
const READOUT_BARS = 56;
const ORBIT_COUNT = 5;
/* A true circle, not a flattened ellipse. The camera is already pitched ~21°
   down (see FeatureVisual), so a circle in this plane is foreshortened into an
   ellipse for free — authoring one here as well double-flattens it, and the
   pawns end up sliding along a line. */
const ORBIT_R = 0.6;
/** World height of a pawn in the rank, divided by its own profile height for
    the same reason the customise scene does it — see PIECE_HEIGHT. */
const PAWN_HEIGHT = 0.26;
const PAWN_SCALE = PAWN_HEIGHT / PIECE_TOPS.pawn;

function createBotsScene(): FeatureScene {
  const own = disposer();
  const group = new THREE.Group();

  /* ── Core ──────────────────────────────────────────────────────────── */
  const core = new THREE.Mesh(
    own.keep(new THREE.IcosahedronGeometry(CORE_R, 3)),
    own.keep(
      new THREE.MeshPhysicalMaterial({
        color: INK,
        metalness: 0.82,
        roughness: 0.26,
        clearcoat: 0.5,
        clearcoatRoughness: 0.3,
        envMapIntensity: 1.1,
      })
    )
  );
  core.position.y = CORE_Y;
  group.add(core);

  /* Wireframe cage, counter-rotating. This is the element that reads as
     "computation" — a solid shell would just be a second sphere. */
  const shellMaterial = own.keep(
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      wireframe: true,
      transparent: true,
      opacity: 0.34,
    })
  );
  const shell = new THREE.Mesh(
    own.keep(new THREE.IcosahedronGeometry(CORE_R * 1.14, 2)),
    shellMaterial
  );
  shell.position.y = CORE_Y;
  group.add(shell);

  /* Aura around the core, breathing with the pulse.
     Deliberately *not* additive. Additive blending is the reflex for a glow and
     it is invisible here: this stage is near-white, and adding light to white
     leaves white. A low-opacity accent tint on the sphere's far shell reads as
     a haze around the silhouette instead, which is the same cue done in the one
     direction a light page has available. Depth-blind so it never draws an edge
     over the cage in front of it. */
  const haloMaterial = own.keep(
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  const halo = new THREE.Mesh(
    own.keep(new THREE.SphereGeometry(CORE_R * 1.48, 32, 20)),
    haloMaterial
  );
  halo.position.y = CORE_Y;
  group.add(halo);

  /* ── Gyroscope ─────────────────────────────────────────────────────── */
  /* A torus is rotationally symmetric, so spinning one about its own axis is
     invisible. Each ring therefore sits tilted inside a parent that spins
     instead: what moves is the ring's *axis*, which is what precession looks
     like and why three of them read as a mechanism rather than as decoration. */
  const ringMaterial = own.keep(
    new THREE.MeshStandardMaterial({
      color: ACCENT,
      metalness: 0.9,
      roughness: 0.22,
      envMapIntensity: 1.2,
    })
  );
  const gimbals = RING_RADII.map((radius, i) => {
    const gimbal = new THREE.Group();
    gimbal.position.y = CORE_Y;
    const torus = new THREE.Mesh(
      own.keep(new THREE.TorusGeometry(radius, 0.0088, 8, 180)),
      ringMaterial
    );
    torus.rotation.x = RING_TILTS[i];
    torus.rotation.z = RING_ROLLS[i];
    gimbal.add(torus);
    group.add(gimbal);
    return gimbal;
  });

  /* ── Radial readout ────────────────────────────────────────────────── */
  /* Ticks laid flat around the floor, each growing outward from a common ring.
     The bar geometry is pre-translated so its origin is its inner end, which
     is what lets a single scale on X grow it outward instead of from its
     middle. */
  const barGeometry = own.keep(new THREE.BoxGeometry(1, 0.014, 0.014));
  barGeometry.translate(0.5, 0, 0);
  const readout = new THREE.InstancedMesh(
    barGeometry,
    own.keep(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    READOUT_BARS
  );
  readout.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  readout.position.y = READOUT_Y;
  for (let i = 0; i < READOUT_BARS; i++) {
    readout.setColorAt(i, _color.setHex(STEEL_PALE));
  }
  readout.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  group.add(readout);

  /* The ring the ticks stand on, so the readout has a baseline. Real geometry
     rather than a line, so unlike the cage it keeps its width at any canvas
     size — hence a tube thin enough to read as a rule on the desktop canvas. */
  const baseline = new THREE.Mesh(
    own.keep(new THREE.TorusGeometry(READOUT_R, 0.0055, 6, 160)),
    own.keep(
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.4,
      })
    )
  );
  baseline.rotation.x = Math.PI / 2;
  baseline.position.y = READOUT_Y;
  group.add(baseline);

  /* ── The rank of pawns ─────────────────────────────────────────────── */
  const pawnMaterial = own.keep(
    new THREE.MeshPhysicalMaterial({
      color: 0x16323f,
      metalness: 0.55,
      roughness: 0.24,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1,
    })
  );
  const pawnGeometry = own.keep(createPieceGeometry("pawn", 40));
  const pawns = Array.from({ length: ORBIT_COUNT }, () => {
    const pawn = new THREE.Mesh(pawnGeometry, pawnMaterial);
    group.add(pawn);
    return pawn;
  });

  return {
    group,
    ground: { y: READOUT_Y - 0.02, radius: 0.95, alpha: 0.72 },
    update(t, boost) {
      const beat = 0.5 + 0.5 * Math.sin(t * 2.2);

      core.rotation.y = t * 0.16;
      core.rotation.x = t * 0.07;
      core.scale.setScalar(1 + beat * 0.03);

      shell.rotation.y = -t * 0.34;
      shell.rotation.z = t * 0.12;
      // The cage is drawn in wireframe, so it is line work and boosts with the
      // rest of it. The halo is a surface and does not.
      shellMaterial.opacity = lineAlpha(0.24 + beat * 0.26, boost);
      haloMaterial.opacity = 0.05 + beat * 0.055;

      for (let i = 0; i < gimbals.length; i++) {
        gimbals[i].rotation.y = t * RING_SPINS[i];
        // Second, much slower axis, so no ring ever repeats the same silhouette
        // on a short cycle.
        gimbals[i].rotation.z = Math.sin(t * 0.24 + i * 1.7) * 0.16;
      }

      for (let i = 0; i < READOUT_BARS; i++) {
        const a = (i / READOUT_BARS) * TAU;
        /* Two incommensurable harmonics: a slow swell the eye can follow and a
           fast chatter it cannot, which together read as a machine reporting
           real work rather than as a sine wave. */
        const swell = 0.5 + 0.5 * Math.sin(a * 3 - t * 1.5);
        const chatter = 0.5 + 0.5 * Math.sin(a * 11 + t * 2.6);
        // Sharp leading edge, long tail: a search sweep, not a pulse.
        const sweep = fract(t * 0.19 - a / TAU);
        const scan = Math.pow(clamp01(1 - sweep / 0.17), 2);
        const value = clamp01(swell * 0.48 + chatter * 0.32 + scan * 0.8);

        _pos.set(Math.cos(a) * READOUT_R, 0, Math.sin(a) * READOUT_R);
        // Bars lie flat and point outward: rotate about Y, not Z. Negated
        // because +Z in world space is a *clockwise* angle when seen from
        // above, which is the opposite of how `a` advances.
        _quat.setFromAxisAngle(Y_AXIS, -a);
        _scl.set(0.04 + 0.13 * value, 1, 1);
        readout.setMatrixAt(i, _mat.compose(_pos, _quat, _scl));
        readout.setColorAt(i, mixHex(STEEL_PALE, ACCENT_DEEP, value));
      }
      readout.instanceMatrix.needsUpdate = true;
      if (readout.instanceColor) readout.instanceColor.needsUpdate = true;

      for (let i = 0; i < pawns.length; i++) {
        const a = t * 0.32 + (i / ORBIT_COUNT) * TAU;
        const near = 0.5 + 0.5 * Math.sin(a);
        pawns[i].position.set(
          Math.cos(a) * ORBIT_R,
          READOUT_Y + 0.005,
          Math.sin(a) * ORBIT_R
        );
        // Each pawn stays upright and turns to face out of the ring, so the
        // rank reads as pieces set on a board rather than as beads on a wire.
        pawns[i].rotation.y = -a;
        pawns[i].scale.setScalar(PAWN_SCALE * (0.9 + 0.16 * near));
      }
    },
    dispose: own.dispose,
  };
}

/* ---------------------------------------------------------------------- */
/* 03 — "In-depth analysis"                                                */
/* ---------------------------------------------------------------------- */

/* One position, read four plies deep — with the board drawn once per ply.
 *
 * Four boards float in a stack. They are the *same* few squares at four moments
 * of one line: read upward and the dark bishop moves, the pale pawn answers, and
 * an accent thread stitches the bishop's path from board to board. On every
 * board the square it stands on is lit, the square it plays to next is marked,
 * and the two moves it looked at and rejected are marked fainter. A wave of
 * evaluation climbs the stack on a loop, and the bar beside it steps once per
 * ply as the reading is revised.
 *
 * That is the whole idea, and the reason it is boards rather than a graph: this
 * chapter's other two scenes already carry the abstract load — a board reskinning
 * itself, an engine in its gimbals — so the one about *analysis* is the one that
 * can afford to show a real position and let the depth be the drawing.
 *
 * Two rejected passes, because both are easy to walk back into:
 *
 *   *Five wireframe grids with a search tree threaded through them.* Two faults.
 *   Each node's bearing was derived from its index rather than from its parent's,
 *   so sibling sub-trees interleaved and the graph read as a tangle. And it was
 *   drawn in lines — WebGL renders a line exactly one device pixel wide whatever
 *   the scene's scale, so on this chapter's short canvas the grids, the tree and
 *   both outlines were all half-pixel strokes and the scene thinned to a smudge
 *   behind a numeral drawn four times heavier.
 *
 *   *A correctly branching tree in extruded tube, rising out of a piece.* Both
 *   faults above fixed, and it still did not work: a radially symmetric thing
 *   that branches upward into fine twigs with a bead at every tip reads as a
 *   shrub, and no amount of tuning the angles, the density or the tier alignment
 *   reaches past that. Stacked horizontal planes carry "depth" without asking
 *   the reader to see past a plant.
 *
 * Everything here is real geometry: 96 tiles, twenty men and sixteen frame bars
 * in four instanced draws, plus the thread. The only line material left is the
 * bar's own outline, which is therefore the only thing the host's small-canvas
 * line boost still has to carry.
 *
 * The stack sits right of centre and the bar stands on its left, spanning
 * exactly the plies it reads — the side of the frame the headline does not
 * cross. */

const PLIES = 4;
/**
 * Lowest board. The stack rises from here, so the deepest ply is the highest.
 *
 * That way round because the bottom board is the nearest and the largest on
 * screen, and it is the only one of the four that is *real* — the position in
 * front of the player. The three hypotheticals recede above it.
 */
const PLY_BOTTOM = -1.14;
/**
 * Gap between boards.
 *
 * Not a free choice: the camera is pitched about 21° down (see FeatureVisual), so
 * a board occludes the one below it unless the boards are shallow and well
 * spaced. At this step, BOARD_HZ and MAN_HEIGHT, the sightline to the top of a
 * man on the deepest rank of the *lowest* board — the tightest of the pairs,
 * since the higher a board sits the nearer it is to the camera's own height —
 * clears the board above it with about 0.07 to spare, which is the margin the
 * sway needs. Deepening the boards, closing the gap or growing the men starts
 * cropping the back rank with nothing on screen to say so.
 */
const PLY_STEP = 0.62;
const plyY = (ply: number) => PLY_BOTTOM + ply * PLY_STEP;

/** A wide, shallow crop of the board — three ranks of it, all eight files. The
    crop is what makes the stack legal, and it happens to suit both this scene's
    frame and the composition, which wants width and cannot spend height. */
const FILES = 8;
const RANKS = 3;
const SQUARE = 0.19;
const PLY_TILE = 0.176;
const PLY_TILE_H = 0.024;
const BOARD_HX = ((FILES - 1) / 2) * SQUARE + PLY_TILE / 2;
const BOARD_HZ = ((RANKS - 1) / 2) * SQUARE + PLY_TILE / 2;
/** Hairline frame, just clear of the tiles. Four bars per board rather than a
    line loop, so it keeps its width at any canvas size. */
const FRAME_BAR = 0.008;
const FRAME_HX = BOARD_HX + 0.016;
const FRAME_HZ = BOARD_HZ + 0.016;

const STACK_X = 0.16;
/** Height of a bishop. Every man is scaled by this over the *bishop's* own
    profile top, never by its own, which is what keeps a real set's staging —
    the pawn comes out around two thirds of the bishop on its own. See the note
    on proportion in chessPieces. */
const MAN_HEIGHT = 0.3;

/* Both boards and men are lit, and this stage's key is bright enough to blow a
   pale surface out to flat white — so the light halves are authored well below
   the value they should read at, and the dark halves well below the value a
   swatch would suggest. The pale men in particular have to hold an edge against
   a near-white page: at ivory they were five white blobs per board. */
const TILE_LIGHT = IVORY;
const TILE_DARK = 0x21414f;
const MAN_DARK = 0x14303f;
const MAN_LIGHT = 0x5c7688;

/**
 * The men on the stack, and the square each stands on at every ply. A repeated
 * square is a man who did not move.
 *
 * The first entry is the line: a dark bishop playing a real sequence of
 * diagonals, which is what the thread stitches and the pulse runs along. The
 * pale pawn answering it is what makes the stack a *line* rather than one piece
 * wandering. The other three are the position it is all happening in.
 *
 * Bishop and pawn only, and not for want of variety: they are the two pieces in
 * the set that a lathe finishes on its own. A rook is its crenellations and a
 * queen is her coronet, and at MAN_HEIGHT those details are smaller than a
 * pixel — a rook this size reads as a bucket. See chessPieces.
 *
 * Two things here are not free to edit. The line's four squares are all the same
 * colour — (file + rank) odd, every one — because a bishop cannot change colour,
 * and a bishop that does is the one error in a scene like this that a chess
 * player sees instantly. The second bishop is on the other colour, which is what
 * a pair is. Moving any of them means checking the parity and re-deriving
 * PLY_MOVES, whose squares are all diagonals off these.
 */
const MEN: ReadonlyArray<{
  piece: PieceName;
  dark: boolean;
  squares: readonly (readonly [number, number])[];
}> = [
  { piece: "bishop", dark: true, squares: [[1, 0], [3, 2], [5, 0], [6, 1]] },
  { piece: "pawn", dark: false, squares: [[2, 2], [2, 1], [2, 0], [2, 0]] },
  { piece: "bishop", dark: true, squares: [[7, 1], [7, 1], [7, 1], [7, 1]] },
  { piece: "pawn", dark: false, squares: [[0, 1], [0, 1], [0, 1], [0, 1]] },
  { piece: "pawn", dark: false, squares: [[4, 2], [4, 2], [4, 2], [4, 2]] },
];
/** Which entry above is the line. */
const LINE = 0;

/**
 * What each board has marked on it: the move the line plays from here, and other
 * squares the search looked at.
 *
 * Every one of them is a real square on one of the bishop's own diagonals from
 * wherever it is standing on that board, and none is under another man — so the
 * marks, the thread and the stack all agree, and every mark is visible. A set of
 * decorative highlights would come apart the moment a reader followed the
 * thread, which is exactly what the thread invites them to do.
 *
 * The deepest ply plays nothing. That is where the search stopped.
 */
const PLY_MOVES: ReadonlyArray<{
  played: readonly [number, number] | null;
  looked: readonly (readonly [number, number])[];
}> = [
  { played: [3, 2], looked: [[2, 1]] },
  { played: [5, 0], looked: [[4, 1], [1, 0]] },
  { played: [6, 1], looked: [[4, 1], [3, 2]] },
  { played: null, looked: [[5, 2], [7, 0]] },
];

/** Mark strengths: where the piece is, where it goes, what it passed over. */
const MARK_HERE = 1;
const MARK_PLAYED = 0.6;
const MARK_LOOKED = 0.26;
/** How far a marked square rises as its ply is read. */
const MARK_LIFT = 0.028;

const THREAD_R = 0.013;

/** Seconds for one pass of the evaluation wave up the stack. */
const WAVE_PERIOD = 5.6;
/** Half-height of the wave. Under the ply gap, so it reads one board at a time
    rather than washing over the whole stack. */
const WAVE_W = 0.34;
/* Starts below the first board and finishes above the last, so nothing is lit at
   either end of the cycle and the loop has no seam to hide. */
const WAVE_LO = PLY_BOTTOM - (WAVE_W + 0.02);
const WAVE_HI = plyY(PLIES - 1) + (WAVE_W + 0.02);
/** Seconds for the pulse to run the line, first board to last. */
const PULSE_PERIOD = 2.6;
const PULSE_W = 0.26;

/**
 * What the evaluation reads once each ply has been searched.
 *
 * Cyclic — the last value is the first — and read through a Hermite ramp per
 * segment, so the bar arrives at and leaves every ply at zero rate and the
 * restart of a pass is not a jump. That is what lets the bar be driven by the
 * search rather than by a sine of its own: it steps four times per pass, in
 * step with the wave crossing each board, which is the single thing that makes
 * the two halves of this scene read as one instrument.
 */
const PLY_SCORES = [0.5, 0.63, 0.45, 0.5] as const;

/* Evaluation bar. Stands at the bottom board and is drawn to the top one, so it
   spans exactly the plies it is reading. */
const GAUGE_X = -0.82;
const GAUGE_W = 0.13;
const GAUGE_HALF_H = ((PLIES - 1) * PLY_STEP) / 2;
const GAUGE_Y = PLY_BOTTOM + GAUGE_HALF_H;

const fileX = (file: number) => (file - (FILES - 1) / 2) * SQUARE;
const rankZ = (rank: number) => ((RANKS - 1) / 2 - rank) * SQUARE;
const squareIndex = (ply: number, file: number, rank: number) =>
  (ply * RANKS + rank) * FILES + file;

function createAnalysisScene(): FeatureScene {
  const own = disposer();
  const group = new THREE.Group();

  const stack = new THREE.Group();
  stack.position.x = STACK_X;
  group.add(stack);

  /* ── Marks ──────────────────────────────────────────────────────────
     Resolved once into a flat per-square strength, so the frame loop is a
     single array read per tile rather than four lookups and a comparison. */
  const marks = new Float32Array(PLIES * RANKS * FILES);
  for (let ply = 0; ply < PLIES; ply++) {
    // Written weakest first, so "where it goes" wins over "where it looked" and
    // "where it is" wins over both when a square is more than one of them.
    for (const [file, rank] of PLY_MOVES[ply].looked) {
      marks[squareIndex(ply, file, rank)] = MARK_LOOKED;
    }
    const played = PLY_MOVES[ply].played;
    if (played) marks[squareIndex(ply, played[0], played[1])] = MARK_PLAYED;
    const [file, rank] = MEN[LINE].squares[ply];
    marks[squareIndex(ply, file, rank)] = MARK_HERE;
  }

  /* ── Tiles ──────────────────────────────────────────────────────────── */
  const tileCount = PLIES * RANKS * FILES;
  const tiles = new THREE.InstancedMesh(
    own.keep(new THREE.BoxGeometry(PLY_TILE, PLY_TILE_H, PLY_TILE)),
    own.keep(
      new THREE.MeshStandardMaterial({
        // White, because the per-instance colour multiplies into it.
        color: 0xffffff,
        metalness: 0.3,
        roughness: 0.42,
        envMapIntensity: 0.62,
      })
    ),
    tileCount
  );
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stack.add(tiles);

  /* ── Board frames ───────────────────────────────────────────────────── */
  /* Four bars per board off one unit box: two running the files, two the ranks.
     Real geometry rather than a line loop, so unlike the wireframe grids this
     replaces they hold their width on the mobile canvas. */
  const frames = new THREE.InstancedMesh(
    own.keep(new THREE.BoxGeometry(1, FRAME_BAR, 1)),
    own.keep(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    PLIES * 4
  );
  frames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stack.add(frames);

  /* ── The men ────────────────────────────────────────────────────────
     One instanced draw per lathe, holding every copy of that piece on every
     board. Colour is per instance, which is what makes two sides out of one
     material. */
  const manScale = MAN_HEIGHT / PIECE_TOPS.bishop;
  const manMaterial = own.keep(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      /* Low for a polished piece, and the reason is the pale side. Albedo tints
         a metal's *reflection*, and what these reflect is a bright white room
         probe — so at the 0.5 the dark men would like, a pale man is white
         whatever its colour is set to. The clearcoat below keeps the highlight
         that the metalness is no longer providing. */
      metalness: 0.3,
      roughness: 0.36,
      // A clearcoat is what separates "polished" from "shiny plastic": the
      // specular sits in a thin layer above the body colour instead of washing
      // it out.
      clearcoat: 0.7,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.55,
    })
  );
  const lathes = new Map<PieceName, THREE.InstancedMesh>();
  /** Which instance of its lathe each man occupies, per ply. */
  const manSlots: number[][] = MEN.map(() => []);
  for (const name of ["bishop", "pawn"] as const) {
    const count = MEN.filter((man) => man.piece === name).length * PLIES;
    if (count === 0) continue;
    const mesh = new THREE.InstancedMesh(
      own.keep(createPieceGeometry(name, 28)),
      manMaterial,
      count
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    stack.add(mesh);
    lathes.set(name, mesh);
    let slot = 0;
    MEN.forEach((man, m) => {
      if (man.piece !== name) return;
      for (let ply = 0; ply < PLIES; ply++) manSlots[m][ply] = slot++;
    });
  }

  /* ── The thread ─────────────────────────────────────────────────────
     One tube per ply gap, running base to base along the line the engine
     chose. Orientation and length are fixed here so the frame loop only has to
     compose a stored quaternion — nothing about the line moves, only how lit it
     is. */
  const threadGeometry = own.keep(
    new THREE.CylinderGeometry(THREAD_R, THREAD_R, 1, 6, 1, true)
  );
  // Origin at the lower end, so one Y scale spans the gap.
  threadGeometry.translate(0, 0.5, 0);
  const threads = new THREE.InstancedMesh(
    threadGeometry,
    own.keep(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    PLIES - 1
  );
  const direction = new THREE.Vector3();
  for (let ply = 0; ply < PLIES - 1; ply++) {
    const [f0, r0] = MEN[LINE].squares[ply];
    const [f1, r1] = MEN[LINE].squares[ply + 1];
    const from = new THREE.Vector3(
      fileX(f0),
      plyY(ply) + PLY_TILE_H / 2,
      rankZ(r0)
    );
    direction.set(
      fileX(f1) - from.x,
      plyY(ply + 1) + PLY_TILE_H / 2 - from.y,
      rankZ(r1) - from.z
    );
    const len = direction.length();
    _quat.setFromUnitVectors(Y_AXIS, direction.divideScalar(len));
    _scl.set(1, len, 1);
    threads.setMatrixAt(ply, _mat.compose(from, _quat, _scl));
  }
  stack.add(threads);

  /* ── Evaluation bar ─────────────────────────────────────────────────── */
  const gauge = new THREE.Group();
  gauge.position.set(GAUGE_X, GAUGE_Y, 0);
  group.add(gauge);

  const columnGeometry = own.keep(new THREE.BoxGeometry(GAUGE_W, 1, GAUGE_W));
  const advantage = new THREE.Mesh(
    columnGeometry,
    own.keep(
      new THREE.MeshStandardMaterial({
        color: ACCENT_DEEP,
        metalness: 0.36,
        roughness: 0.38,
        envMapIntensity: 0.9,
      })
    )
  );
  const remainder = new THREE.Mesh(
    columnGeometry,
    own.keep(
      new THREE.MeshStandardMaterial({
        color: 0xe9f2f7,
        metalness: 0.2,
        roughness: 0.5,
        envMapIntensity: 0.9,
      })
    )
  );
  gauge.add(advantage, remainder);

  /* Hairline around the whole column, and a tick at the even mark. Without the
     outline the pale half of the bar has no edge against the page at all. */
  const gaugeOutlineSource = own.keep(
    new THREE.BoxGeometry(GAUGE_W + 0.008, GAUGE_HALF_H * 2, GAUGE_W + 0.008)
  );
  const gaugeOutlineMaterial = own.keep(
    new THREE.LineBasicMaterial({
      color: INK,
      transparent: true,
      opacity: 0.28,
    })
  );
  gauge.add(
    new THREE.LineSegments(
      own.keep(new THREE.EdgesGeometry(gaugeOutlineSource)),
      gaugeOutlineMaterial
    )
  );
  const tick = new THREE.Mesh(
    own.keep(new THREE.BoxGeometry(0.18, 0.007, 0.007)),
    own.keep(new THREE.MeshBasicMaterial({ color: ACCENT }))
  );
  tick.position.z = GAUGE_W / 2 + 0.006;
  gauge.add(tick);

  /* Graduations at the two interior board heights — the column's own ends
     already mark the first and last ply, and its middle is the even mark above.
     Four registrations, two weights: this is what turns a long thin box from a
     thermometer standing next to the stack into a scale reading it. */
  const gradGeometry = own.keep(new THREE.BoxGeometry(0.115, 0.005, 0.005));
  const gradMaterial = own.keep(new THREE.MeshBasicMaterial({ color: STEEL }));
  for (let ply = 1; ply < PLIES - 1; ply++) {
    const grad = new THREE.Mesh(gradGeometry, gradMaterial);
    grad.position.set(0, plyY(ply) - GAUGE_Y, GAUGE_W / 2 + 0.005);
    gauge.add(grad);
  }

  /* ── Frame ──────────────────────────────────────────────────────────── */
  const frame = (t: number, boost: number) => {
    /* Very slow sway, so the stack's depth is re-read from a slightly different
       angle every few seconds rather than being one fixed diagram. */
    group.rotation.y = Math.sin(t * 0.15) * 0.15;

    const frontY = WAVE_LO + fract(t / WAVE_PERIOD) * (WAVE_HI - WAVE_LO);
    /* The pulse enters below the first board and leaves above the last, so like
       the wave it is absent at its own loop's seam. */
    const pulseAt = -PULSE_W + fract(t / PULSE_PERIOD) * (1 + 2 * PULSE_W);

    for (let ply = 0; ply < PLIES; ply++) {
      const y = plyY(ply);
      // How hard this board is being read this instant.
      const read = bump(frontY - y, WAVE_W);

      for (let rank = 0; rank < RANKS; rank++) {
        for (let file = 0; file < FILES; file++) {
          const i = squareIndex(ply, file, rank);
          const mark = marks[i];
          /* Marked squares rise as their board is read — a small, precise
             motion on four squares out of twenty-four, which says "these are
             the ones it is looking at" without the board moving as a slab. */
          const lift = mark * MARK_LIFT * read;
          _pos.set(fileX(file), y + lift, rankZ(rank));
          _quat.identity();
          _scl.setScalar(1);
          tiles.setMatrixAt(i, _mat.compose(_pos, _quat, _scl));
          /* Marks go *toward the accent*, and the whole board takes a faint
             cast of it while the wave is on it. Emphasis on this near-white
             stage has to be something going darker; there is no brighter. */
          tiles.setColorAt(
            i,
            mixHex(
              (file + rank) & 1 ? TILE_LIGHT : TILE_DARK,
              ACCENT,
              0.14 * read + mark * (0.5 + 0.5 * read) * 0.9
            )
          );
        }
      }

      /* Frame: two bars along the files, two along the ranks. */
      for (let bar = 0; bar < 4; bar++) {
        const alongX = bar < 2;
        _pos.set(
          alongX ? 0 : (bar === 2 ? -1 : 1) * FRAME_HX,
          y,
          alongX ? (bar === 0 ? -1 : 1) * FRAME_HZ : 0
        );
        _quat.identity();
        _scl.set(
          alongX ? FRAME_HX * 2 + FRAME_BAR : FRAME_BAR,
          1,
          alongX ? FRAME_BAR : FRAME_HZ * 2 + FRAME_BAR
        );
        frames.setMatrixAt(ply * 4 + bar, _mat.compose(_pos, _quat, _scl));
        frames.setColorAt(ply * 4 + bar, mixHex(STEEL, ACCENT_DEEP, read));
      }

      /* Men. The line's own piece also answers the pulse, so the eye is handed
         from board to board rather than left to find the thread. */
      const arrival = bump(pulseAt - ply / (PLIES - 1), PULSE_W);
      MEN.forEach((man, m) => {
        const mesh = lathes.get(man.piece);
        if (!mesh) return;
        const slot = manSlots[m][ply];
        const [file, rank] = man.squares[ply];
        const pop = m === LINE ? read * 0.06 + arrival * 0.1 : read * 0.035;
        _pos.set(fileX(file), y + PLY_TILE_H / 2, rankZ(rank));
        _quat.identity();
        _scl.setScalar(manScale * (1 + pop));
        mesh.setMatrixAt(slot, _mat.compose(_pos, _quat, _scl));
        mesh.setColorAt(
          slot,
          man.dark
            ? mixHex(MAN_DARK, ACCENT_DEEP, m === LINE ? arrival * 0.55 : 0)
            : mixHex(MAN_LIGHT, ACCENT, read * 0.18)
        );
      });
    }
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    frames.instanceMatrix.needsUpdate = true;
    if (frames.instanceColor) frames.instanceColor.needsUpdate = true;
    for (const mesh of lathes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    /* The thread lights as the pulse runs it. Positions never change — see the
       build above — so this is colour only. */
    for (let ply = 0; ply < PLIES - 1; ply++) {
      threads.setColorAt(
        ply,
        mixHex(
          STEEL,
          ACCENT_DEEP,
          0.6 + 0.4 * bump(pulseAt - (ply + 0.5) / (PLIES - 1), PULSE_W)
        )
      );
    }
    if (threads.instanceColor) threads.instanceColor.needsUpdate = true;

    /* ── Evaluation ────────────────────────────────────────────────────
       Stepped by the wave rather than by a clock of its own: the bar is revised
       once per board, arriving and leaving each ply at zero rate, so the pass
       restarting is not a jump. The drift on top is the small restlessness of a
       live evaluation, on a period that shares no factor with the wave's. */
    const depth =
      clamp01((frontY - PLY_BOTTOM) / ((PLIES - 1) * PLY_STEP)) * (PLIES - 1);
    const from = Math.min(PLIES - 2, Math.floor(depth));
    const score = clamp01(
      PLY_SCORES[from] +
        (PLY_SCORES[from + 1] - PLY_SCORES[from]) *
          smoothstep(0, 1, depth - from) +
        0.022 * Math.sin(t * 0.79) +
        0.011 * Math.sin(t * 1.93 + 1.1)
    );
    const split = 0.09 + score * 0.82;
    const height = GAUGE_HALF_H * 2;
    advantage.scale.y = height * split;
    advantage.position.y = -GAUGE_HALF_H + (height * split) / 2;
    remainder.scale.y = height * (1 - split);
    remainder.position.y = GAUGE_HALF_H - (height * (1 - split)) / 2;

    /* The only line material in the scene, so the only thing the host's
       small-canvas boost still has to carry. It firms up as the wave clears the
       deepest board, because a search that has reached full depth is the moment
       the bar's reading is worth anything. */
    gaugeOutlineMaterial.opacity = lineAlpha(
      0.28 + 0.3 * bump(frontY - plyY(PLIES - 1), 0.3),
      boost
    );
  };

  /* Run once before the first render rather than leaving it to the first
     update. Three only compiles the instanced-colour path into a shader if
     `instanceColor` exists the first time the material is used, so a mesh that
     gets its colours a frame later renders that frame — and every frame after
     it — in flat white. Calling the real frame function is also the only
     version of this that cannot drift out of step with it. */
  frame(0, 1);
  tiles.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  frames.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  threads.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  for (const mesh of lathes.values()) {
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  }

  return {
    group,
    /* The whole stack levitates, so it gets a wide, weak pool rather than a
       tight strong one. The radius is the board's, which is wide and shallow —
       and the DOM shadow is a flattened ellipse, so for once the two agree. */
    ground: { y: PLY_BOTTOM - PLY_TILE_H / 2, radius: 0.78, alpha: 0.55 },
    update: frame,
    dispose: own.dispose,
  };
}

/* ---------------------------------------------------------------------- */

const BUILDERS: Record<FeatureSceneId, () => FeatureScene> = {
  customise: createCustomiseScene,
  bots: createBotsScene,
  analysis: createAnalysisScene,
};

/** Reference footprint the DOM contact shadow's authored width corresponds to.
    Scenes report their own radius; the host divides by this to get the
    multiplier the CSS scales by, so a scene with a smaller base casts a
    smaller pool without anyone editing a stylesheet. */
export const SCENE_REFERENCE_RADIUS = 1.15;

export function createFeatureScene(id: FeatureSceneId): FeatureScene {
  return BUILDERS[id]();
}
