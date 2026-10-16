import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural chess pieces.
 *
 * Pieces are composed from primitives rather than lathed from hand-drawn
 * profiles. Splines through hand-placed control points overshoot in ways that
 * are hard to predict without eyeballing every iteration; primitives give a
 * clean, deliberately minimal silhouette that stays readable at hero scale and
 * costs nothing to reason about. Only the knight needs a real outline, and that
 * comes from an extruded 2D path.
 *
 * Conventions: one board square is 1 world unit, every piece stands on y = 0
 * with its base at the origin, and the knight faces -z (white's forward).
 */

const RADIAL = 40;
const SPHERE_W = 26;
const SPHERE_H = 18;
const TORUS_RAD = 40;
const TORUS_TUBE = 14;

/** Strips everything except position/normal/uv and de-indexes, so merges never fail. */
function normalize(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  g.clearGroups();
  return g;
}

function merge(parts) {
  const merged = mergeGeometries(parts.map(normalize), false);
  merged.computeVertexNormals();
  return merged;
}

/** Tapered cylinder whose *bottom* sits at `y`. */
function tube(rBottom, rTop, height, y, { open = false } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, RADIAL, 1, open);
  g.translate(0, y + height / 2, 0);
  return g;
}

function band(radius, tubeRadius, y) {
  const g = new THREE.TorusGeometry(radius, tubeRadius, TORUS_TUBE, TORUS_RAD);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function ball(radius, y, scale = [1, 1, 1]) {
  const g = new THREE.SphereGeometry(radius, SPHERE_W, SPHERE_H);
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(0, y, 0);
  return g;
}

function slab(w, h, d, y, x = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  g.translate(x, y, z);
  return g;
}

/** Shared plinth so every piece reads as part of one set. */
function plinth() {
  return [
    tube(0.345, 0.315, 0.052, 0),
    band(0.33, 0.024, 0.052),
    tube(0.3, 0.245, 0.05, 0.052),
    tube(0.245, 0.215, 0.028, 0.102),
  ];
}

const PLINTH_TOP = 0.13;

function pawn() {
  return merge([
    ...plinth(),
    tube(0.15, 0.118, 0.24, PLINTH_TOP),
    band(0.158, 0.032, PLINTH_TOP + 0.245),
    tube(0.1, 0.096, 0.055, PLINTH_TOP + 0.27),
    ball(0.152, PLINTH_TOP + 0.44),
  ]);
}

function rook() {
  const parts = [
    ...plinth(),
    tube(0.245, 0.208, 0.4, PLINTH_TOP),
    band(0.222, 0.026, PLINTH_TOP + 0.06),
    band(0.216, 0.026, PLINTH_TOP + 0.36),
    tube(0.238, 0.248, 0.13, PLINTH_TOP + 0.4),
    band(0.252, 0.022, PLINTH_TOP + 0.5),
  ];

  // Four battlements. Placed on the diagonals so the silhouette reads from the
  // default camera angle instead of hiding behind the front face.
  const crownY = PLINTH_TOP + 0.53;
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const box = slab(0.115, 0.115, 0.115, crownY + 0.055, 0, 0);
    box.rotateY(angle);
    box.translate(Math.cos(angle) * 0.15, 0, Math.sin(angle) * 0.15);
    parts.push(box);
  }

  return merge(parts);
}

function knightHeadShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.22, 0);
  s.lineTo(0.2, 0);
  s.quadraticCurveTo(0.27, 0.14, 0.17, 0.28); // throat
  s.quadraticCurveTo(0.11, 0.4, 0.22, 0.47); // jaw pushes forward
  s.quadraticCurveTo(0.34, 0.53, 0.315, 0.635); // muzzle
  s.quadraticCurveTo(0.295, 0.705, 0.185, 0.68); // upper lip back
  s.lineTo(0.105, 0.63); // under the brow
  s.quadraticCurveTo(0.04, 0.72, 0.1, 0.86); // forehead into front ear
  s.lineTo(0.035, 0.75); // notch between ears
  s.lineTo(-0.035, 0.885); // back ear
  s.lineTo(-0.115, 0.71);
  // Tighter mane than a wide sweep: a fat back turns the silhouette into a slab
  // when the piece is viewed from behind.
  s.quadraticCurveTo(-0.27, 0.46, -0.2, 0);
  return s;
}

function knight() {
  const head = new THREE.ExtrudeGeometry(knightHeadShape(), {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.022,
    bevelOffset: 0,
    bevelSegments: 3,
    curveSegments: 14,
  });

  // The extrude runs along +z; recentre it and stand it on the plinth. Then
  // rotate so the silhouette faces -z, which is white's forward direction.
  head.computeBoundingBox();
  const bb = head.boundingBox;
  head.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  head.rotateY(-Math.PI / 2);
  head.translate(0, PLINTH_TOP - 0.01, 0);

  // Eyes. Two 3 mm beads are the cheapest way to make an extruded flat
  // silhouette read as a horse rather than an abstract wedge — they catch a
  // specular highlight from any angle.
  const eyes = [-1, 1].map((sign) =>
    ball(0.028, PLINTH_TOP + 0.63).translate(sign * 0.108, 0, -0.075)
  );

  return merge([
    ...plinth(),
    tube(0.21, 0.185, 0.06, PLINTH_TOP - 0.055),
    head,
    ...eyes,
  ]);
}

function bishop() {
  return merge([
    ...plinth(),
    tube(0.2, 0.105, 0.36, PLINTH_TOP),
    band(0.172, 0.028, PLINTH_TOP + 0.055),
    band(0.126, 0.026, PLINTH_TOP + 0.33),
    ball(0.163, PLINTH_TOP + 0.52, [0.94, 1.42, 0.94]),
    band(0.09, 0.02, PLINTH_TOP + 0.72),
    ball(0.052, PLINTH_TOP + 0.775),
  ]);
}

function queen() {
  const parts = [
    ...plinth(),
    tube(0.235, 0.118, 0.42, PLINTH_TOP),
    band(0.2, 0.03, PLINTH_TOP + 0.06),
    band(0.132, 0.024, PLINTH_TOP + 0.4),
    tube(0.12, 0.258, 0.15, PLINTH_TOP + 0.42),
    band(0.256, 0.026, PLINTH_TOP + 0.575),
  ];

  const crownY = PLINTH_TOP + 0.63;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI * 2) / 8;
    parts.push(ball(0.046, crownY, [1, 1, 1]).translate(Math.cos(angle) * 0.215, 0, Math.sin(angle) * 0.215));
  }

  parts.push(ball(0.082, crownY + 0.045));
  parts.push(ball(0.034, crownY + 0.13));

  return merge(parts);
}

function king() {
  const crownY = PLINTH_TOP + 0.66;
  return merge([
    ...plinth(),
    tube(0.24, 0.132, 0.46, PLINTH_TOP),
    band(0.205, 0.03, PLINTH_TOP + 0.065),
    band(0.146, 0.026, PLINTH_TOP + 0.43),
    tube(0.135, 0.245, 0.16, PLINTH_TOP + 0.45),
    band(0.243, 0.028, PLINTH_TOP + 0.612),
    ball(0.064, crownY - 0.005, [1, 0.8, 1]),
    slab(0.056, 0.24, 0.056, crownY + 0.14),
    slab(0.165, 0.056, 0.056, crownY + 0.165),
  ]);
}

const BUILDERS = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };

/**
 * Builds one geometry per piece type. Heights are measured after the fact so
 * callers (hover labels, capture animations, arc clearance) can position things
 * relative to the real top of each piece.
 */
export function createPieceGeometries() {
  const result = {};
  for (const [type, build] of Object.entries(BUILDERS)) {
    const geometry = build();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.height = geometry.boundingBox.max.y;
    result[type] = geometry;
  }
  return result;
}
