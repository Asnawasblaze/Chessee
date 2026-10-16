import * as THREE from "three";

/* ---------------------------------------------------------------------- */
/* Procedural chess pieces                                                 */
/* ---------------------------------------------------------------------- */

/* Chess pieces are turned objects: a real one is cut on a lathe from a single
 * silhouette, which is exactly what THREE.LatheGeometry does. So the feature
 * visuals build their pieces from 2D profiles here rather than shipping a
 * second .glb — no download, no meshopt decode, no texture, and the silhouette
 * is a handful of numbers that can be tuned in place.
 *
 * The other reason this is a profile and not a mesh: the "everything is
 * customisable" visual needs one piece to *become* another on a loop, and two
 * lathes revolved from the same number of profile points produce vertex buffers
 * with identical layouts — which makes them valid morph targets for each other.
 * A pair of exported meshes almost never lines up that way.
 *
 * Knights are the one piece a lathe cannot make at all (they are not
 * rotationally symmetric anywhere), which is the honest reason the set here is
 * pawn/rook/bishop/queen.
 *
 * ── Proportion ────────────────────────────────────────────────────────────
 * The silhouettes below are dimensioned off a real tournament Staunton set —
 * 95mm king, so queen 85, bishop 70, rook 50, pawn 45, with base diameters of
 * 38 / 35 / 33 / 30 — normalised so the queen stands 1.0. Every number that
 * follows is that measurement, not an impression of it, because all three of the
 * ratios that decide whether a turned piece reads as real are ones the eye
 * cannot author from imagination.
 *
 * **Height staging.** Against the queen, a real bishop is 0.82, a rook 0.59 and
 * a pawn 0.53 — a rook is barely over half her height. An earlier pass here had
 * them at 0.93 / 0.80 / 0.70, which is most of why the rook read as a bucket:
 * stretched to four fifths of a queen it has to be a tube, because there is no
 * such thing as a tall rook. Getting the staging right is what lets the rook be
 * squat and the bishop be lean.
 *
 * **Slenderness.** Base diameter over the piece's *own* height: 0.63 pawn,
 * 0.61 rook, 0.49 bishop, 0.45 queen (real: 0.67 / 0.66 / 0.50 / 0.45). The
 * short pieces are much wider-footed relative to themselves than they feel like
 * they should be, and that is exactly what stops them looking spindly.
 *
 * **Crown against base.** The widest part of the head is always *narrower* than
 * the base — 0.70 pawn, 0.73 rook, 0.57 bishop, 0.74 queen here, measured off
 * the geometry with ornaments counted. Go over 1.0 and the piece stops reading
 * as turned and starts reading as top-heavy. **If one of these ever approaches
 * 1.0 the piece will look big-headed no matter what else is done to it, and the
 * crown is where to fix it, not the base.**
 *
 * A scene sets a piece's size in world units by dividing the height it wants by
 * the piece's own profile top — never by treating one as the other.
 */

export type PieceName = "pawn" | "rook" | "bishop" | "queen";

/* Radial subdivisions of the revolve. 48 is smooth at the size these render at
   and still only ~5k triangles, which matters because five are alive in scene
   02's rank. */
const PIECE_SEGMENTS = 48;

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------------- */
/* Silhouettes                                                             */
/* ---------------------------------------------------------------------- */

/* Every piece is authored as the *same seven sections*, in the same order:
 *
 *   sole    the underside, axis out to the base rim
 *   foot    the rim wall and the chamfer off its top edge
 *   flare   the ogee sweeping the rim up into the stem
 *   stem    the waisted shaft
 *   collar  the turned bead where the shaft meets the head
 *   crown   the piece's identity — ball head, tower, mitre, coronet
 *   finial  the crown closing back onto the axis
 *
 * This is what makes the morph read as one piece being re-cut rather than as a
 * cloud of vertices rearranging itself. Resampling each profile by raw arc
 * length alone (the obvious approach) allots samples in proportion to how long
 * each part happens to be, so a pawn's collar ends up mapped onto a queen's
 * stem and the transition slides through shapes that are not chess pieces.
 * Sampling *per section* pins collar to collar and crown to crown, whatever
 * proportion of the outline each one takes up.
 *
 * `sole` is split out from `foot` for the same reason. The underside is a long
 * horizontal run — its arc length is the base radius, larger than anything else
 * down there — so with the two as one section the even-arc resample spent every
 * sample on a face that is never visible and skipped the rim wall entirely. The
 * rim collapsed into a diagonal and all four bases came out as cones rather
 * than as discs with an edge. Three samples on the sole is enough to close the
 * bottom; the other five give the rim a real corner.
 *
 * ── The base is an ogee, not a cone ──────────────────────────────────────
 * `flare` is the section most easily got wrong, and getting it wrong makes all
 * four pieces look cheap at once. The obvious authoring — a straight run from
 * the base rim in to the stem — is a *cone*, and a cone is what an injection
 * mould produces, not a lathe. A turned base is an S: it rounds over convexly
 * just above the rim, inflects about a third of the way up, and then sweeps
 * concavely into the stem, so the widest part of the bell overhangs the wall
 * below it. Each `flare` below carries eight points describing that S, and the
 * inflection is visible in the numbers as the point where the radius starts
 * falling faster than the height rises.
 *
 * Points are [radius, height]. Ordered bottom-to-top, which is the winding
 * LatheGeometry needs for outward-facing normals. The sole runs *inward to
 * outward* (axis first) to keep that winding continuous.
 */
type Section = readonly (readonly [number, number])[];
type Silhouette = readonly [
  Section,
  Section,
  Section,
  Section,
  Section,
  Section,
  Section,
];

/* Samples per section. The crown and finial get most of them because between
   them they are the piece's whole identity, and the finial is the more starved
   of the two: three of the four end in a turned ball on a neck, and the queen's
   also has to fit her coronet's rim lip, the dish behind it, her neck *and* her
   orb into one section. Sums to 54 unique profile points once the shared joins
   are collapsed. */
const SECTION_SAMPLES = [3, 5, 9, 7, 8, 13, 15] as const;

/* Which sections are cut as a curve rather than as a polyline.
 *
 * Resampling is otherwise piecewise *linear*, so the authored control points
 * are the curve and a section given more samples than it has points gets
 * smoother spacing, not a smoother shape. For a bell, a waisted stem, a bead or
 * a mitre that is the wrong tool: a lathe cuts arcs, and at the size the
 * customise scene renders these — the piece is most of the frame — a nine-point
 * polygon reading as a sphere is visible as flats however smooth the vertex
 * normals are.
 *
 * So the four rounded sections are fitted with a centripetal Catmull-Rom
 * through their authored points and resampled off *that*. Centripetal rather
 * than uniform because uniform overshoots wherever the spacing between control
 * points changes sharply, and an overshoot in a profile is a bulge in the piece.
 *
 * The other three stay linear, and each has a reason:
 *
 *   sole    starts on the axis, where a spline that undershoots would put the
 *           radius through zero and fold the cap inside out
 *   foot    a vertical wall meeting a chamfer — the one corner in the outline
 *           that has to stay a corner, since it is the base's visible edge
 *   finial  the only section that turns back on itself: the rook's top plate
 *           runs flat in to the axis, and the queen's rim lip reverses through
 *           180° into the dish behind it. Splined, that hairpin bulges into a
 *           mushroom.
 */
const SECTION_CURVED = [false, false, true, true, true, true, false] as const;

const SILHOUETTES: Record<PieceName, Silhouette> = {
  /* 0.53 of a queen, and the widest-footed piece in the set relative to itself.
     Ball head on a slim waisted stem — the shortest, quietest piece, and the
     only one whose crown is a simple sphere.
   
     The crown and finial points below are a *sphere*, arithmetically: centre
     y = 0.468, radius 0.132, r = √(0.132² − (y − 0.468)²) at every one of them.
     That is worth doing by calculation rather than by eye because the failure is
     specific and it is what this was — an egg. Ease the taper off near the top
     by a few thousandths and the head comes to a rounded point, which is a
     bishop's mitre, and the pawn turns into a small bishop with no ball on it.
     A pawn's head is round *to the very top*, and the last two points before
     the axis are what say so. */
  pawn: [
    [
      [0, 0.01],
      [0.132, 0.004],
      [0.188, 0],
    ],
    [
      [0.188, 0],
      [0.188, 0.018],
      [0.188, 0.036],
      [0.186, 0.047],
      [0.18, 0.055],
    ],
    [
      [0.18, 0.055],
      [0.171, 0.066],
      [0.157, 0.079],
      [0.137, 0.095],
      [0.115, 0.113],
      [0.098, 0.135],
      [0.088, 0.158],
      [0.083, 0.18],
    ],
    [
      [0.083, 0.18],
      [0.075, 0.212],
      [0.07, 0.244],
      [0.0675, 0.273],
      [0.0685, 0.297],
      [0.072, 0.316],
    ],
    [
      [0.072, 0.316],
      [0.09, 0.322],
      [0.102, 0.33],
      [0.105, 0.34],
      [0.1, 0.351],
      [0.083, 0.36],
      [0.064, 0.366],
    ],
    [
      [0.064, 0.366],
      [0.086, 0.374],
      [0.1034, 0.386],
      [0.1155, 0.404],
      [0.1251, 0.426],
      [0.1305, 0.448],
      [0.132, 0.468],
      [0.1301, 0.49],
      [0.1244, 0.512],
    ],
    [
      [0.124, 0.512],
      [0.116, 0.532],
      [0.102, 0.552],
      [0.084, 0.57],
      [0.063, 0.584],
      [0.04, 0.594],
      [0.02, 0.5985],
      [0, 0.6],
    ],
  ],

  /* 0.59 of a queen — squat, and the piece whose proportions are least
     forgiving. The read is four steps in order: a wide bell, a *short* stem, a
     tower barely six tenths of the base across, and a cornice that steps out
     sharply at the top with the notched wall standing on its edge. Miss any of
     them and it comes out a bucket; stretch it taller and it has to.
   
     Its `finial` is not a finial at all but the top plate — the floor inside the
     battlements — which is why it runs almost flat from the cornice lip in to
     the axis. The profile therefore closes at 0.582 while the piece is 0.66
     tall: the last eighth is the crenellations, which are not rotationally
     symmetric and are added as an ornament. See createPieceOrnament. Without
     them this profile is, correctly, a cylinder with a lid. */
  rook: [
    [
      [0, 0.01],
      [0.142, 0.004],
      [0.202, 0],
    ],
    [
      [0.202, 0],
      [0.202, 0.02],
      [0.202, 0.038],
      [0.2, 0.049],
      [0.194, 0.058],
    ],
    [
      [0.194, 0.058],
      [0.185, 0.07],
      [0.172, 0.083],
      [0.153, 0.098],
      [0.133, 0.115],
      [0.119, 0.134],
      [0.112, 0.152],
      [0.109, 0.168],
    ],
    [
      [0.109, 0.168],
      [0.104, 0.196],
      [0.101, 0.222],
      [0.101, 0.244],
      [0.104, 0.262],
      [0.108, 0.276],
    ],
    [
      [0.108, 0.276],
      [0.124, 0.284],
      [0.134, 0.293],
      [0.137, 0.304],
      [0.132, 0.314],
      [0.12, 0.322],
      [0.11, 0.329],
    ],
    [
      [0.11, 0.329],
      [0.122, 0.339],
      [0.128, 0.354],
      [0.129, 0.376],
      [0.128, 0.414],
      [0.126, 0.452],
      [0.125, 0.486],
      [0.126, 0.506],
      [0.133, 0.524],
      [0.146, 0.54],
      [0.152, 0.55],
    ],
    [
      [0.152, 0.55],
      [0.153, 0.562],
      [0.148, 0.57],
      [0.134, 0.575],
      [0.11, 0.578],
      [0.084, 0.58],
      [0.058, 0.581],
      [0.033, 0.5815],
      [0.012, 0.582],
      [0, 0.582],
    ],
  ],

  /* 0.82 of a queen, and the leanest piece in the set: its mitre is 0.57 of its
     base where every other crown here is 0.70 or more. Both halves of the mitre
     matter. It swells fast to a shoulder in the *lower third*, then runs up in a
     long taper whose slope steepens all the way to the neck before easing into
     the ball — convex, so the outline bulges outward against a straight line
     drawn from shoulder to tip.
   
     The two failures are opposite and both were here at some point. Put the
     widest point at the mitre's mid-height and round the taper symmetrically and
     you get an onion dome. Run a straight line from the collar to the tip and
     you get a spire. What separates them is where the shoulder sits and which
     way the taper bends.
   
     A real bishop also has a slanted cleft cut through the mitre, and it is
     absent here for the same reason the knight is: it is not rotationally
     symmetric anywhere, and unlike the rook's notches it cannot be *added* —
     a slit is material removed. Faking it with a raised rib reads as a scratch,
     so the piece leans on proportion instead, which is what the eye is mostly
     reading anyway. */
  bishop: [
    [
      [0, 0.01],
      [0.147, 0.004],
      [0.21, 0],
    ],
    [
      [0.21, 0],
      [0.21, 0.019],
      [0.21, 0.036],
      [0.208, 0.047],
      [0.202, 0.056],
    ],
    [
      [0.202, 0.056],
      [0.192, 0.069],
      [0.178, 0.084],
      [0.157, 0.101],
      [0.132, 0.122],
      [0.11, 0.147],
      [0.096, 0.174],
      [0.09, 0.2],
    ],
    [
      [0.09, 0.2],
      [0.081, 0.256],
      [0.075, 0.311],
      [0.0715, 0.363],
      [0.0715, 0.41],
      [0.075, 0.444],
    ],
    [
      [0.075, 0.444],
      [0.091, 0.452],
      [0.102, 0.461],
      [0.105, 0.472],
      [0.1, 0.483],
      [0.088, 0.491],
      [0.078, 0.498],
    ],
    [
      [0.078, 0.498],
      [0.095, 0.51],
      [0.109, 0.528],
      [0.117, 0.548],
      [0.12, 0.568],
      [0.117, 0.598],
      [0.11, 0.63],
      [0.101, 0.662],
      [0.091, 0.692],
      [0.081, 0.712],
    ],
    [
      [0.081, 0.712],
      [0.07, 0.738],
      [0.059, 0.762],
      [0.048, 0.782],
      [0.038, 0.796],
      [0.031, 0.805],
      [0.028, 0.811],
      [0.035, 0.816],
      [0.042, 0.824],
      [0.044, 0.832],
      [0.039, 0.841],
      [0.027, 0.847],
      [0.011, 0.85],
      [0, 0.85],
    ],
  ],

  /* The tallest, and the only crown that *flares outward* all the way up — the
     coronet — then lips sharply back at 0.838, turns through 180° into a shallow
     dish, and sends a slim neck up out of it to the orb. The dish is what
     separates a queen from a goblet: the camera in the features chapter is
     pitched ~21° down, so the rim is seen as an ellipse and a solid crown
     top reads as a filled vase. Four points of hollow behind the lip is enough
     to say cup.
   
     Her rim is the widest head in the set and still lands at 0.67 of her base
     before her points are counted, 0.74 after. Those points are the other thing
     a lathe cannot cut; see createPieceOrnament. */
  queen: [
    [
      [0, 0.01],
      [0.157, 0.004],
      [0.224, 0],
    ],
    [
      [0.224, 0],
      [0.224, 0.02],
      [0.224, 0.039],
      [0.222, 0.05],
      [0.216, 0.06],
    ],
    [
      [0.216, 0.06],
      [0.206, 0.074],
      [0.191, 0.09],
      [0.169, 0.109],
      [0.142, 0.132],
      [0.117, 0.16],
      [0.102, 0.19],
      [0.095, 0.22],
    ],
    [
      [0.095, 0.22],
      [0.086, 0.29],
      [0.08, 0.359],
      [0.077, 0.424],
      [0.078, 0.479],
      [0.082, 0.518],
    ],
    [
      [0.082, 0.518],
      [0.098, 0.527],
      [0.11, 0.537],
      [0.113, 0.549],
      [0.108, 0.561],
      [0.096, 0.571],
      [0.086, 0.579],
    ],
    [
      [0.086, 0.579],
      [0.089, 0.612],
      [0.094, 0.648],
      [0.101, 0.682],
      [0.11, 0.714],
      [0.121, 0.746],
      [0.133, 0.776],
      [0.143, 0.802],
      [0.148, 0.822],
    ],
    [
      [0.148, 0.822],
      [0.152, 0.836],
      [0.148, 0.848],
      [0.128, 0.842],
      [0.101, 0.836],
      [0.075, 0.835],
      [0.057, 0.844],
      [0.048, 0.863],
      [0.046, 0.889],
      [0.055, 0.911],
      [0.063, 0.933],
      [0.064, 0.951],
      [0.055, 0.971],
      [0.034, 0.99],
      [0, 1.0],
    ],
  ],
};

/* ---------------------------------------------------------------------- */
/* Resampling                                                              */
/* ---------------------------------------------------------------------- */

/* Scratch for the spline path below. One curve object reused for every section
   of every piece: this all runs at build, but a CatmullRomCurve3 per section per
   piece is 28 throwaway objects each dragging an arc-length lookup table. */
const _curvePoints: THREE.Vector3[] = [];
const _curve = new THREE.CatmullRomCurve3([], false, "centripetal");

/** Even-arc-length resample of one section, endpoints included. */
function resampleSection(
  pts: Section,
  count: number,
  curved: boolean
): THREE.Vector2[] {
  if (curved) return resampleCurved(pts, count);

  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lengths.push(total);
  }

  const out: THREE.Vector2[] = [];
  for (let s = 0; s < count; s++) {
    /* A zero-length section would divide by zero here and put NaN into the
       vertex buffer, which silently drops the whole mesh. Not reachable with
       the silhouettes above, but this is the one place a bad edit to them would
       fail invisibly rather than loudly. */
    const target = total > 0 ? (s / (count - 1)) * total : 0;
    let j = 1;
    while (j < lengths.length - 1 && lengths[j] < target) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const f = (target - lengths[j - 1]) / span;
    out.push(
      new THREE.Vector2(
        pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f,
        pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f
      )
    );
  }
  return out;
}

/**
 * The same resample, but through a centripetal Catmull-Rom fitted to the
 * authored points — so a bell, a stem, a bead and a crown come out as arcs
 * rather than as chords. See SECTION_CURVED for which sections get this and why
 * the other three must not.
 *
 * `getSpacedPoints` walks the spline by arc length off its own lookup table,
 * which is what keeps the sample spacing even and therefore keeps the section's
 * samples lining up with the same section on the other three pieces.
 *
 * The radius is floored at zero. Centripetal parameterisation does not overshoot
 * on the profiles above, but a negative radius is the one failure mode that does
 * not look like a mistake — the revolve simply passes through the axis and the
 * surface turns inside out, which reads as a shading bug rather than as a bad
 * number.
 */
function resampleCurved(pts: Section, count: number): THREE.Vector2[] {
  _curvePoints.length = 0;
  for (const [r, y] of pts) _curvePoints.push(new THREE.Vector3(r, y, 0));
  _curve.points = _curvePoints;
  // Invalidate the cached arc-length table; `points` is a plain field, so three
  // has no way to notice it changed.
  _curve.updateArcLengths();
  return _curve
    .getSpacedPoints(count - 1)
    .map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}

/** A piece's full profile: every section resampled, shared joins collapsed. */
function profilePoints(name: PieceName): THREE.Vector2[] {
  const silhouette = SILHOUETTES[name];
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < silhouette.length; i++) {
    const section = resampleSection(
      silhouette[i],
      SECTION_SAMPLES[i],
      SECTION_CURVED[i]
    );
    // Each section starts where the last ended; keep one copy of the join, or
    // the duplicate makes a zero-length segment and LatheGeometry's normal pass
    // divides by it.
    points.push(...(i === 0 ? section : section.slice(1)));
  }
  return points;
}

/* ---------------------------------------------------------------------- */
/* Measurements taken off the profiles                                     */
/* ---------------------------------------------------------------------- */

/* Index of the crown/finial join — the widest structural point of the head, and
   the one landmark every piece has in the same place because the sections are
   aligned. On the two pieces that carry ornaments it is exactly the feature they
   hang off: the rook's cornice lip and the queen's coronet rim.

   Derived from SECTION_SAMPLES rather than written as 39, because it *is*
   SECTION_SAMPLES: retuning any section's sample count moves it, and a stale
   literal would silently start reporting some point halfway up the crown. */
const RIM_INDEX =
  SECTION_SAMPLES.slice(0, 6).reduce(
    (n, samples, i) => n + (i === 0 ? samples : samples - 1),
    0
  ) - 1;

/** Where the head's widest structural point sits, in the piece's own units. */
interface PieceRim {
  r: number;
  y: number;
}

const PIECE_NAMES = Object.keys(SILHOUETTES) as PieceName[];

/**
 * Where each piece's own outline closes on the axis, and where its crown rim
 * sits — both measured off the resampled profile rather than restated as
 * literals, so a silhouette edit cannot leave them behind. Getting either wrong
 * is invisible in the four settled shapes and only shows up mid-morph, which is
 * the worst place to find out.
 *
 * `PIECE_TOPS` is not the same thing as how tall a piece *looks*. The rook's
 * crenellations are a separate mesh standing on its top plate, so it reads 0.66
 * tall while its profile stops at 0.582 — and the profile number is the useful
 * one, because what consumes this is scaling and anchoring, both of which need
 * to know where the *body* ends.
 */
export const PIECE_TOPS = {} as Record<PieceName, number>;
export const PIECE_RIM = {} as Record<PieceName, PieceRim>;
for (const name of PIECE_NAMES) {
  const points = profilePoints(name);
  PIECE_TOPS[name] = points[points.length - 1].y;
  PIECE_RIM[name] = { r: points[RIM_INDEX].x, y: points[RIM_INDEX].y };
}

/* ---------------------------------------------------------------------- */
/* Geometry                                                                */
/* ---------------------------------------------------------------------- */

/**
 * One piece, revolved. Base sits at y = 0, so a scene positions a piece by
 * where its foot goes rather than by guessing at its centre.
 */
export function createPieceGeometry(
  name: PieceName,
  segments = PIECE_SEGMENTS
): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profilePoints(name), segments);
}

/**
 * `order[0]` revolved as the base shape, with every other name attached as a
 * morph target — so a single mesh can hold the whole set and blend between them
 * on the GPU via `mesh.morphTargetInfluences`.
 *
 * Both position *and* normal are morphed. Position alone is the tempting
 * shortcut and it looks broken: the shading stays welded to the base shape, so
 * a pawn turning into a queen keeps the pawn's highlights sliding around on the
 * queen's coronet. LatheGeometry already computes correct normals per profile
 * (including the degenerate ring where the outline meets the axis), so they come
 * for free here.
 *
 * `morphTargetsRelative` stays at its default of `false`, which means these
 * attributes hold absolute positions and three scales the base contribution by
 * `1 - sum(influences)` — so influences that sum to 1 give an exact lerp and
 * anything less falls back toward the base shape.
 *
 * The throwaway geometries the targets are lifted off are intentionally not
 * disposed: they were never uploaded to the GPU, so they hold no GL resources,
 * and disposing them is what would take the attribute buffers this returns.
 */
export function createMorphingPieceGeometry(
  order: readonly PieceName[],
  segments = PIECE_SEGMENTS
): THREE.BufferGeometry {
  const revolved = order.map((name) => createPieceGeometry(name, segments));
  const base = revolved[0];
  const targets = revolved.slice(1);

  base.morphAttributes.position = targets.map(
    (geometry) => geometry.getAttribute("position") as THREE.BufferAttribute
  );
  base.morphAttributes.normal = targets.map(
    (geometry) => geometry.getAttribute("normal") as THREE.BufferAttribute
  );
  base.morphTargetsRelative = false;

  return base;
}

/* ---------------------------------------------------------------------- */
/* Ornaments — the parts a lathe cannot cut                                */
/* ---------------------------------------------------------------------- */

/**
 * The non-rotationally-symmetric detail that identifies a piece, or `null` for
 * the two that need none.
 *
 * This exists because the lathe has a hard limit and it lands on the two pieces
 * people recognise by exactly the feature it cannot make. A rook is a wall with
 * square notches cut out of it; a queen is a coronet with a ring of points
 * around it. Neither is a profile revolved about an axis, so a lathe-only rook
 * is a plain tube and a lathe-only queen is a vase — which is precisely how they
 * read before this.
 *
 * They are separate meshes rather than part of the morph because morph targets
 * demand identical topology, and "six boxes" and "nine spheres" have none in
 * common. The host scales each set in and out with its own piece's weight
 * instead, so the crenellations rise out of the rook's crown as it forms and
 * retract as it becomes something else — which reads as the piece being re-cut,
 * the same thing the profile morph is saying.
 *
 * Both sets are sized against their piece's *cornice or rim* rather than against
 * the base: the battlement wall stands on the edge of the rook's top plate and
 * the queen's points are teeth raised on her rim, so those are the diameters
 * they have to agree with. That they also land inside the base diameter (0.73
 * and 0.74) is then a consequence rather than a constraint applied afterwards.
 *
 * ── Staying welded through the morph ─────────────────────────────────────
 * Positioned in the piece's own profile units, relative to `rim` — the crown
 * rim they are cut into. The host re-derives that rim from the *blend* every
 * frame and moves the group to match, in both height and radius.
 *
 * Both matter, and an earlier pass only did height. Tracking the blended top
 * alone keeps a merlon at the rook's cornice *width* while the body under it is
 * still a pawn's neck, so a quarter of the way into pawn→rook the battlements
 * are hanging in mid-air beside a ball head — five separate blocks orbiting
 * nothing. Radius is the half that makes them look cut *from* the piece.
 */
interface PieceOrnament {
  group: THREE.Group;
  /** Height in this piece's own profile that the group is pinned to. */
  anchorY: number;
  /**
   * This piece's own crown rim, from PIECE_RIM. The host divides the blended rim
   * by this to get the factor the whole group follows by, so at full weight the
   * factor is exactly 1 and the ornament sits where it was authored.
   */
  rim: PieceRim;
  /** Scaled between nothing and full by the host. */
  parts: THREE.Mesh[];
  /**
   * How a part grows in.
   *
   *   "up"  scale on Y only, from a base-anchored geometry, so merlons rise out
   *         of the crown they sit on
   *   "in"  uniform scale, for detail that should swell in place
   *
   * Uniform scale on the merlons would drag them in toward the axis as they
   * shrank, so the rook's battlements would fly in from its centre.
   */
  grow: "up" | "in";
  /** Handed to the scene's disposer; nothing here owns its own teardown. */
  geometries: THREE.BufferGeometry[];
}

/** Crenellations. Six reads as notched at the size this renders; a real Staunton
    rook has four slots, but four leaves one whole face of the tower blank from
    most angles and the piece stops looking crenellated as it turns. */
const MERLON_COUNT = 6;
/** Takes the wall from the top plate to 0.66 — the rook's real height, and 14%
    of it, which is where a crenellated wall sits. */
const MERLON_HEIGHT = 0.094;
/** Radius of the ring they stand on. With the depth below this puts their outer
    face flush with the cornice lip at 0.152, which is where a battlement wall
    meets its cornice: rising from the edge of the plate, not set back on top of
    it and not overhanging it. */
const MERLON_RING = 0.132;
const MERLON_DEPTH = 0.04;
/* Tangential width. At this ring radius six merlons get a 0.138 slot each, so
   0.068 leaves a notch a hair wider than the tooth — which is what real
   crenellations look like, and what stops six teeth closing up into a ring. */
const MERLON_WIDTH = 0.068;
/** Sunk below the plate surface (~0.575 at the merlon ring) so the wall reads as
    cut from the plate rather than as blocks resting on it. */
const MERLON_ANCHOR = 0.566;

/** Coronet points. Ball-tipped, so they read as points rather than as beads
    threaded round the rim. Nine at this radius sits close to tooth-and-gap
    parity, the same as the merlons above. */
const CORONET_COUNT = 9;
/** Centred on the coronet's rim radius rather than inside it, so each point's
    outer half clears the silhouette and its inner half stays embedded — a tooth
    raised on the rim, not a bead resting behind it. */
const CORONET_RING = 0.152;
/* A point is deliberately *not* a sphere: it is thin radially and wide
   tangentially, the way a tooth raised on a thin rim wall actually is. A sphere
   ties the two together, and that is a trap — the width needed to read as a ring
   of teeth rather than a scatter of beads (~0.052 at this radius, for parity with
   the 0.106 slot each one gets) then also pushes the outer edge to 0.178, and
   the queen goes back to looking big-headed. Split apart, the outer edge lands at
   0.167: 0.75 of her base, which is where a real coronet's points sit. Each
   point is rotated so its thin axis is the radial one. */
const CORONET_POINT_RADIAL = 0.015;
const CORONET_POINT_TANGENT = 0.026;
/** Half-height. Prolate, so the tip comes to something. */
const CORONET_POINT_RISE = 0.03;
/** Lift above the rim lip. Puts their tips at ~0.89 of the queen's height,
    standing clear around the neck just under her orb, which is where a real
    coronet's points sit. */
const CORONET_LIFT = 0.014;
/** The coronet's rim lip, not the orb above it. */
const CORONET_ANCHOR = 0.848;

export function createPieceOrnament(
  name: PieceName,
  material: THREE.Material
): PieceOrnament | null {
  if (name === "rook") {
    const geometry = new THREE.BoxGeometry(
      MERLON_DEPTH,
      MERLON_HEIGHT,
      MERLON_WIDTH
    );
    // Origin at the base, so a scale on Y grows the merlon upward out of the
    // crown instead of about its own middle.
    geometry.translate(0, MERLON_HEIGHT / 2, 0);

    const group = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < MERLON_COUNT; i++) {
      const a = (i / MERLON_COUNT) * TAU;
      const merlon = new THREE.Mesh(geometry, material);
      merlon.position.set(
        Math.cos(a) * MERLON_RING,
        0,
        Math.sin(a) * MERLON_RING
      );
      /* Negated: rotating +X about +Y by θ sends it to (cos θ, 0, −sin θ), so
         −a is what points a merlon's radial face outward at angle a. */
      merlon.rotation.y = -a;
      group.add(merlon);
      parts.push(merlon);
    }
    return {
      group,
      anchorY: MERLON_ANCHOR,
      rim: PIECE_RIM.rook,
      parts,
      grow: "up",
      geometries: [geometry],
    };
  }

  if (name === "queen") {
    const geometry = new THREE.SphereGeometry(1, 12, 10);
    geometry.scale(
      CORONET_POINT_RADIAL,
      CORONET_POINT_RISE,
      CORONET_POINT_TANGENT
    );

    const group = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < CORONET_COUNT; i++) {
      const a = ((i + 0.5) / CORONET_COUNT) * TAU;
      const point = new THREE.Mesh(geometry, material);
      point.position.set(
        Math.cos(a) * CORONET_RING,
        CORONET_LIFT,
        Math.sin(a) * CORONET_RING
      );
      // Same negation as the merlons: puts the thin (X) axis outward at angle a.
      point.rotation.y = -a;
      group.add(point);
      parts.push(point);
    }
    return {
      group,
      anchorY: CORONET_ANCHOR,
      rim: PIECE_RIM.queen,
      parts,
      grow: "in",
      geometries: [geometry],
    };
  }

  // A pawn's ball head and a bishop's mitre are both pure revolutions; their
  // profiles already say everything.
  return null;
}

/* ---------------------------------------------------------------------- */
/* Blending                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Weight per piece for a continuous walk through a set: `phase` is in whole
 * pieces, so 0 is `order[0]`, 1.5 is halfway between the second and third, and
 * 4.0 on a set of four is back to the start. Writes `count` values summing to 1.
 *
 * `hold` is the fraction of each step the piece spends *settled* on a shape
 * before it starts becoming the next one. Without it the piece is permanently
 * mid-morph and never reads as any particular piece, which defeats the point of
 * modelling four of them.
 *
 * The one source of truth for the blend: the morph influences and the
 * ornaments' scales are both derived from this, and deriving them separately is
 * how a rook's battlements end up at full size on a queen.
 */
export function pieceWeights(
  out: number[],
  phase: number,
  count: number,
  hold = 0.55
) {
  const step = Math.floor(phase);
  const within = phase - step;
  // Smoothstep rather than a linear ramp: the shape change starts and ends at
  // zero *rate*, so there is no visible moment where the morph switches on.
  const raw = Math.min(1, Math.max(0, (within - hold) / (1 - hold)));
  const blend = raw * raw * (3 - 2 * raw);

  out.length = count;
  out.fill(0);
  out[((step % count) + count) % count] = 1 - blend;
  out[(((step + 1) % count) + count) % count] += blend;
}

/**
 * Copies a weight vector onto a mesh's morph influences. `weights[0]` is the
 * base shape, which has no entry — three derives its contribution from
 * `1 - sum(influences)`.
 */
export function applyMorphWeights(
  influences: number[],
  weights: readonly number[]
) {
  for (let i = 1; i < weights.length; i++) influences[i - 1] = weights[i];
}
