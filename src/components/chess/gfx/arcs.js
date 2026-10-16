import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { clamp, easeOutCubic, easeInOutCubic } from './ease.js';

const POOL_SIZE = 28;
const TUBULAR = 64;
/** Cross-section segments. Twelve is where the decagon stops showing as facets
    along the brightest part of the stroke. */
const RADIAL = 14;

/**
 * Builds one reusable "unit tube": a cylindrical mesh whose vertices carry the
 * parameter `aT` along the tube and `aAngle` around it. The vertex shader then
 * sweeps it along a quadratic bezier supplied as uniforms, so every arc in the
 * scene shares a single geometry and spawning one is just a uniform update.
 */
function createUnitTube() {
  const count = (TUBULAR + 1) * (RADIAL + 1);
  const position = new Float32Array(count * 3);
  const aT = new Float32Array(count);
  const aAngle = new Float32Array(count);

  let v = 0;
  for (let i = 0; i <= TUBULAR; i += 1) {
    const t = i / TUBULAR;
    for (let j = 0; j <= RADIAL; j += 1) {
      const angle = (j / RADIAL) * Math.PI * 2;
      position[v * 3 + 0] = t;
      position[v * 3 + 1] = Math.cos(angle) * 0.05;
      position[v * 3 + 2] = Math.sin(angle) * 0.05;
      aT[v] = t;
      aAngle[v] = angle;
      v += 1;
    }
  }

  const indices = [];
  for (let i = 0; i < TUBULAR; i += 1) {
    for (let j = 0; j < RADIAL; j += 1) {
      const a = i * (RADIAL + 1) + j;
      const b = a + RADIAL + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
  return geometry;
}

const VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aAngle;

  uniform vec3 uP0;
  uniform vec3 uP1;
  uniform vec3 uP2;
  uniform float uRadius;

  varying float vT;
  varying float vAxis;

  vec3 bezier(float t) {
    float u = 1.0 - t;
    return u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2;
  }

  vec3 bezierTangent(float t) {
    return 2.0 * (1.0 - t) * (uP1 - uP0) + 2.0 * t * (uP2 - uP1);
  }

  void main() {
    vT = aT;

    vec3 center = bezier(aT);
    vec3 tangent = normalize(bezierTangent(aT) + vec3(1e-5));

    // Stable frame: pick the world axis least aligned with the tangent.
    vec3 helper = abs(tangent.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 nrm = normalize(cross(tangent, helper));
    vec3 bin = normalize(cross(tangent, nrm));

    // Thin at the ends, full in the middle. A clean sweep, no wobble: the arc
    // is a statement about a move, and it should hold still enough to be read.
    float taper = 0.20 + 0.80 * pow(sin(aT * 3.14159265), 0.62);
    float radius = uRadius * taper;

    vec3 offset = (cos(aAngle) * nrm + sin(aAngle) * bin) * radius;
    vec3 world = center + offset;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vec3 viewNormal = normalize(mat3(modelViewMatrix) * normalize(offset));

    // 1 where the surface faces the camera — that is, along the tube's
    // screen-space centreline — falling to 0 at its silhouette. Naming it for
    // what it measures matters: read as a rim term and inverted, which is what
    // used to happen here, it draws the arc as a hollow pipe.
    vAxis = abs(dot(viewNormal, normalize(-mv.xyz)));

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHeadColor;
  uniform float uTime;
  uniform float uProgress;
  uniform float uFade;
  uniform float uHead;
  uniform float uHeadGain;
  uniform float uDashes;
  uniform float uIntensity;

  varying float vT;
  varying float vAxis;

  void main() {
    // Taken before the discard below. Derivatives are undefined for fragments
    // neighbouring a discarded one, and the dash filter depends on this being
    // right at the tip, which is exactly where the discards are.
    float rate = fwidth(vT);

    // Draw-in: the arc extends from origin to destination.
    if (vT > uProgress) discard;

    // Bright along the axis, soft toward the silhouette: a filament of light,
    // which is what a line of play looks like. The faint outer term gives the
    // stroke a definite edge without turning it back into a pipe.
    //
    // The axis exponent was 1.7, which spread the energy far enough across the
    // tube's width that a predicted line read as a haze with a bright middle
    // rather than as a line. At 2.4 the same total energy is concentrated into a
    // narrower core, so the stroke has an edge the eye can follow — and the
    // outer term is pulled down to match, because a soft halo around a tight
    // core is what was reading as blur in the first place.
    float axis = clamp(vAxis, 0.0, 1.0);
    float body = pow(axis, 2.4) * 0.74 + pow(1.0 - axis, 3.2) * 0.06;

    // Dashes carry the direction of travel. The pattern is faded out as soon as
    // it stops being resolvable, because a dash thinner than a pixel does not
    // read as motion — it reads as crawling noise, which is what a fixed dash
    // count gave on short arcs and at distance.
    float resolved = 1.0 - smoothstep(0.08, 0.3, rate * uDashes);
    float flow = fract(vT * uDashes - uTime * 0.55);
    float dash = smoothstep(0.0, 0.5, flow) * smoothstep(1.0, 0.5, flow);
    body += dash * dash * pow(axis, 1.7) * 0.18 * resolved;

    // The travelling head. uHeadGain retires it after arrival so nothing is
    // left parked and glowing on the destination square.
    float head = exp(-pow((vT - uHead) * 9.0, 2.0)) * uHeadGain;

    // Soft ends. The tube is open at both tips, so without this it shows its
    // own mouth as a ring and stubs into the board instead of resolving into it.
    float ends = smoothstep(0.0, 0.055, vT) * smoothstep(1.0, 0.945, vT);
    float tip = smoothstep(uProgress, uProgress - 0.05, vT);

    float energy = (body + head) * ends * tip * uFade * uIntensity;
    if (energy < 0.002) discard;

    // Premultiplied, with alpha pinned to 1. Three's additive blending is
    // src * srcAlpha + dst, so carrying the energy in both channels — as this
    // did — squares it, crushing the mid-tones and exaggerating the falloff.
    vec3 color = mix(uColor, uHeadColor, clamp(head * 0.8, 0.0, 1.0));
    gl_FragColor = vec4(color * energy, 1.0);
  }
`;

/**
 * Arc styling per semantic role.
 *
 * `best` is deliberately the only one with real presence. Candidates sit well
 * below it so the eye picks the played move out of the fan immediately instead
 * of having to compare five equally bright ribbons.
 *
 * Intensities are lower than they look because the tube is drawn double-sided
 * into an additive buffer, so front and back both contribute and the centre of
 * the stroke reads at roughly twice these numbers. They are set so the body of
 * an arc lands under the bloom threshold and only the travelling head crosses
 * it — the head is the part worth a halo.
 *
 * Dash counts are low. Twenty-plus dashes over a two-square move puts each one
 * near a pixel wide, and the shader has to throw the pattern away rather than
 * let it crawl.
 */
const KINDS = {
  best: { color: PALETTE.destination, head: 0xf2fbff, radius: 0.062, dashes: 14, intensity: 0.48, apex: 1.5 },
  candidate: { color: PALETTE.candidate, head: PALETTE.cyan, radius: 0.03, dashes: 10, intensity: 0.18, apex: 2.0 },
  threat: { color: PALETTE.capture, head: 0xffd7de, radius: 0.044, dashes: 16, intensity: 0.4, apex: 1.3 },
  probe: { color: PALETTE.cyan, head: 0xeaf8ff, radius: 0.034, dashes: 12, intensity: 0.3, apex: 1.7 },
  defend: { color: PALETTE.teal, head: 0xd9fff4, radius: 0.032, dashes: 10, intensity: 0.26, apex: 1.6 },

  // Forecasts. `tactic` is a link in a predicted winning sequence: sits just
  // under `best` so a whole chain of them reads as one line of play rather than
  // as several competing best moves. `reply` is the opponent's predicted answer
  // and is quieter still, with a taller apex so it clears the move that was
  // just played instead of overlapping it.
  // Both are lifted a little, to pay back the energy the tightened axis falloff
  // took out of the stroke's shoulders. The body of a `tactic` arc lands at
  // roughly 0.62 doubled-sided, still clear of the 0.85 bloom threshold, so the
  // line is brighter and crisper without becoming another source of light.
  tactic: { color: PALETTE.tactic, head: 0xffe6c2, radius: 0.048, dashes: 12, intensity: 0.42, apex: 1.7 },
  reply: { color: PALETTE.forecast, head: 0xdfe4ff, radius: 0.036, dashes: 14, intensity: 0.32, apex: 2.2 },
};

export class MoveArcs {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'move-arcs';

    this.geometry = createUnitTube();
    this.slots = [];

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uP0: { value: new THREE.Vector3() },
          uP1: { value: new THREE.Vector3() },
          uP2: { value: new THREE.Vector3() },
          uRadius: { value: 0.04 },
          uColor: { value: new THREE.Color(PALETTE.cyan) },
          uHeadColor: { value: new THREE.Color(0xffffff) },
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uFade: { value: 0 },
          uHead: { value: 0 },
          uHeadGain: { value: 0 },
          uDashes: { value: 14 },
          uIntensity: { value: 1 },
        },
      });

      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);

      this.slots.push({ mesh, material, active: false, kind: null });
    }
  }

  #freeSlot() {
    let slot = this.slots.find((s) => !s.active);
    if (slot) return slot;
    // Recycle whichever arc is closest to finishing.
    slot = this.slots.reduce((oldest, s) => (s.age / s.life > oldest.age / oldest.life ? s : oldest));
    return slot;
  }

  /**
   * @param {object} options
   * @param {THREE.Vector3} options.from   world start (board surface)
   * @param {THREE.Vector3} options.to     world end
   * @param {string} options.kind          key of KINDS
   * @param {number} [options.life]        seconds until fully faded
   * @param {number} [options.delay]       seconds before it starts drawing
   * @param {number} [options.spread]      lateral offset index, separates overlaps
   * @param {number} [options.travel]      seconds for the draw-in
   */
  spawn({
    from,
    to,
    kind = 'candidate',
    life = 1.6,
    delay = 0,
    spread = 0,
    travel = 0.42,
    apexScale = 1,
    hold = 0,
  }) {
    const style = KINDS[kind] ?? KINDS.candidate;
    const slot = this.#freeSlot();
    const u = slot.material.uniforms;

    // Lifted clear of the board's inlay seam and ripple planes, which sit at
    // 0.012 and 0.02. An arc that starts inside them terminates in a hard
    // intersection instead of rising off the square.
    const p0 = new THREE.Vector3(from.x, from.y + 0.2, from.z);
    const p2 = new THREE.Vector3(to.x, to.y + 0.2, to.z);
    const distance = p0.distanceTo(p2);

    const mid = p0.clone().add(p2).multiplyScalar(0.5);
    mid.y += (0.55 + distance * 0.2) * style.apex * apexScale;

    // Push overlapping arcs sideways so a fan of candidates stays legible.
    if (spread !== 0) {
      const dir = p2.clone().sub(p0).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const sign = spread % 2 === 0 ? 1 : -1;
      const magnitude = Math.ceil(spread / 2) * 0.34;
      mid.addScaledVector(side, sign * magnitude);
      mid.y += Math.ceil(spread / 2) * 0.12;
    }

    u.uP0.value.copy(p0);
    u.uP1.value.copy(mid);
    u.uP2.value.copy(p2);
    u.uColor.value.set(style.color);
    u.uHeadColor.value.set(style.head);
    u.uRadius.value = style.radius;
    u.uDashes.value = style.dashes;
    u.uIntensity.value = style.intensity;
    u.uProgress.value = 0;
    u.uFade.value = 0;
    u.uHead.value = 0;
    u.uHeadGain.value = 0;

    slot.active = true;
    slot.kind = kind;
    slot.age = -delay;
    slot.life = life;
    slot.travel = travel;
    slot.hold = hold;
    slot.forcedFade = null;
    slot.mesh.visible = false;

    return slot;
  }

  /** Quickly retire arcs, optionally only those of a given kind. */
  retire(kind = null, over = 0.22) {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (kind && slot.kind !== kind) continue;
      slot.forcedFade = slot.forcedFade ?? { time: 0, duration: over, from: slot.material.uniforms.uFade.value };
    }
  }

  clear() {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
      slot.material.uniforms.uFade.value = 0;
    }
  }

  update(dt, time) {
    for (const slot of this.slots) {
      if (!slot.active) continue;

      slot.age += dt;
      if (slot.age < 0) continue;

      slot.mesh.visible = true;
      const u = slot.material.uniforms;
      u.uTime.value = time;

      const drawT = clamp(slot.age / slot.travel);
      u.uProgress.value = easeOutCubic(drawT);
      u.uHead.value = easeInOutCubic(drawT);
      // The head belongs to the draw-in. Once the arc has arrived it retires,
      // leaving the line itself rather than a bright dot sitting on the square.
      u.uHeadGain.value = 0.9 * (1 - clamp((slot.age - slot.travel) / 0.3));

      if (slot.forcedFade) {
        slot.forcedFade.time += dt;
        const f = clamp(slot.forcedFade.time / slot.forcedFade.duration);
        u.uFade.value = slot.forcedFade.from * (1 - f);
        if (f >= 1) {
          slot.active = false;
          slot.mesh.visible = false;
        }
        continue;
      }

      // Fade in with the draw-in, hold, then fade out over the tail.
      const fadeIn = clamp(slot.age / 0.14);
      const tailStart = slot.life * 0.55 + slot.hold;
      const fadeOut = slot.age <= tailStart ? 1 : clamp(1 - (slot.age - tailStart) / (slot.life - tailStart + 0.001));
      u.uFade.value = fadeIn * fadeOut * fadeOut;

      if (slot.age >= slot.life + slot.hold) {
        slot.active = false;
        slot.mesh.visible = false;
        u.uFade.value = 0;
      }
    }
  }

  dispose() {
    this.geometry.dispose();
    for (const slot of this.slots) slot.material.dispose();
  }
}
