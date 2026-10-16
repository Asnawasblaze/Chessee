import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { createPieceGeometries } from './pieceGeometry.js';
import { squareToWorld, PIECE_NAMES, PIECE_VALUES } from '../logic/board.js';
import { clamp, damp, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuint } from './ease.js';

const CAPTURE_COLOR = new THREE.Color(PALETTE.capture);

/**
 * How far the real board recedes while a line is being imagined over it, and how
 * much further a piece goes when the line captures it.
 *
 * The dim is what makes a predicted line legible at all. Without it the imagined
 * pieces and the real ones sit at the same weight, and the board reads as one
 * impossible position with pieces in duplicate rather than as a thought about a
 * real position.
 */
const PHANTOM_DIM = 0.5;
const PHANTOM_CAPTURED = 0.82;

/** Opacity of the ghost making the move right now, and of ones already placed. */
const GHOST_MOVING = 0.62;
const GHOST_SETTLED = 0.3;

/** Arc apex per move flavour. Knights hop, sliders skim, captures strike. */
function arcHeightFor({ type, capture, distance, isCastleRook }) {
  if (isCastleRook) return 0.35;
  if (type === 'n') return 1.35 + distance * 0.05;
  if (capture) return 0.55 + distance * 0.12;
  return 0.14 + distance * 0.05;
}

export class PieceSet {
  /**
   * @param {object} opts
   * @param {THREE.Texture} opts.envMap  PMREM environment for the metal.
   */
  constructor({ envMap }) {
    this.group = new THREE.Group();
    this.group.name = 'pieces';

    this.geometries = createPieceGeometries();
    this.envMap = envMap;

    // Emissive is held very low on both sides. Its only purpose is to stop a
    // piece falling to pure black when it turns away from the key light. Push
    // it up and the pieces start glowing from the inside, which destroys the
    // one distinction the viewer needs most: which side is which.
    this.baseMaterials = {
      w: new THREE.MeshPhysicalMaterial({
        // Not pure white: an albedo near 1.0 clips before the tone mapper gets
        // a chance to hold any form, and the pieces read as blank silhouettes.
        color: PALETTE.pieceWhite,
        roughness: 0.28,
        metalness: 0.12,
        clearcoat: 0.8,
        clearcoatRoughness: 0.18,
        envMap,
        envMapIntensity: 0.8,
        emissive: new THREE.Color(0x1a2a3c),
        emissiveIntensity: 0.05,
      }),
      // Dark, but with a clearcoat and enough environment response to keep a
      // bright edge. The silhouette has to survive on the half of the board
      // facing away from the key light, which is what the rim lights are for.
      b: new THREE.MeshPhysicalMaterial({
        color: PALETTE.pieceBlack,
        roughness: 0.34,
        metalness: 0.32,
        clearcoat: 0.9,
        clearcoatRoughness: 0.18,
        envMap,
        envMapIntensity: 1.1,
        emissive: new THREE.Color(0x1a232f),
        emissiveIntensity: 0.14,
      }),
    };

    /** @type {Map<string, object>} */
    this.entries = new Map();
    this.hovered = null;
    this.xray = false;

    // The imagined layer. Ghosts live in their own group so a line can be wiped
    // without touching the real pieces, and their meshes are pooled because a
    // loop plays several lines and material churn would cost shader programs.
    this.ghostGroup = new THREE.Group();
    this.ghostGroup.name = 'ghosts';
    this.group.add(this.ghostGroup);
    /** @type {Array<{mesh: THREE.Mesh, material: THREE.Material, busy: boolean}>} */
    this.ghostSlots = [];
    /** Imagined pieces, keyed by the identity of the piece they stand for. */
    this.ghostByKey = new Map();
    this.ghostEvents = [];
    this.ghostClock = 0;
    this.ghostTint = new THREE.Color(PALETTE.tactic);
    this.ghostScratch = new THREE.Color();
    this.phantom = false;
  }

  get raycastTargets() {
    return [...this.entries.values()].filter((e) => !e.removed).map((e) => e.mesh);
  }

  entryForObject(object) {
    return object?.userData?.entry ?? null;
  }

  /** (Re)creates meshes to match a board state. Used on load and on every loop. */
  build(boardState, { animateIn = true } = {}) {
    this.clear();

    for (const piece of boardState.pieces()) {
      const geometry = this.geometries[piece.type];
      const material = this.baseMaterials[piece.color].clone();
      material.envMap = this.envMap;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = true;

      const target = squareToWorld(piece.square);
      mesh.position.set(target.x, 0, target.z);
      mesh.rotation.y = piece.color === 'b' ? Math.PI : 0;

      const entry = {
        id: piece.id,
        type: piece.type,
        color: piece.color,
        square: piece.square,
        mesh,
        material,
        height: geometry.userData.height,
        baseEmissive: material.emissiveIntensity,
        baseEmissiveColor: material.emissive.clone(),
        baseRotationY: mesh.rotation.y,
        anim: null,
        hover: 0,
        glow: 0,
        removed: false,
        lift: 0,
        // How far this piece is currently being imagined away, and the damped
        // value chasing it.
        phantom: 0,
        dim: 0,
      };

      mesh.userData.entry = entry;
      this.entries.set(piece.id, entry);
      this.group.add(mesh);

      if (animateIn) {
        const distance = Math.hypot(target.x, target.z);
        entry.anim = {
          kind: 'spawn',
          time: -distance * 0.055 - Math.random() * 0.08,
          duration: 0.75,
        };
        mesh.scale.setScalar(0.001);
        material.transparent = true;
        material.opacity = 0;
      }
    }
  }

  clear() {
    for (const entry of this.entries.values()) {
      this.group.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.clear();
    this.hovered = null;
    this.dropGhosts();
  }

  /* ------------------------------------------------------------------ ghosts */

  /**
   * Plays a predicted line out on the board as a phantom sequence.
   *
   * A diagram of where the pieces end up does not read as analysis — it reads as
   * clutter, and it leaves the viewer with no idea a line is being considered at
   * all. So the line is *performed*: a translucent copy of each piece glides
   * along its move, in order, and stays where it lands so the imagined position
   * accumulates. Whichever ghost is moving right now is the brightest, and that
   * is what carries the sequence.
   *
   * The real board dims underneath for the duration, then comes back when the
   * thinking is done. Ghosts are flat additive silhouettes, cast no shadow and
   * are never raycast, so they cannot be mistaken for the position itself.
   *
   * Events are pre-resolved by the caller, which owns the chess: this method
   * knows nothing about legality, only who moves where and when.
   *
   * @param {Array<object>} events `{ key, type, color, from, to, at, travel,
   *   capture?, capturesKey?, dimsEntryId?, promotion?, isCastleRook? }`
   * @param {object} [opts]
   * @param {number} [opts.tint] colour of the imagined layer
   */
  playGhostLine(events, { tint = PALETTE.tactic } = {}) {
    this.dropGhosts();

    // Additive, so the tint has to be pre-dimmed: a full-strength amber added on
    // top of a light square clips to white and the silhouette disappears.
    this.ghostTint.set(tint).multiplyScalar(0.45);
    this.ghostEvents = events.map((event) => ({ ...event, fired: false }));
    this.ghostClock = 0;
    this.phantom = true;

    for (const entry of this.entries.values()) {
      if (!entry.removed) entry.phantom = PHANTOM_DIM;
    }
  }

  /** True while a line is being imagined over the board. */
  get thinking() {
    return this.phantom;
  }

  /** Fades the imagined line out and brings the real board back up. */
  clearGhosts({ fade = 0.28 } = {}) {
    this.phantom = false;
    this.ghostEvents = [];
    for (const ghost of this.ghostByKey.values()) {
      ghost.out = ghost.out ?? { time: 0, duration: fade, from: ghost.opacity };
    }
    for (const entry of this.entries.values()) entry.phantom = 0;
  }

  /** Drops the imagined line immediately and restores the board. */
  dropGhosts() {
    for (const ghost of this.ghostByKey.values()) this.#releaseGhost(ghost);
    this.ghostByKey.clear();
    this.ghostEvents = [];
    this.ghostClock = 0;
    this.phantom = false;
    for (const entry of this.entries.values()) entry.phantom = 0;
  }

  /**
   * Ghost meshes are pooled and only released with the set.
   *
   * A line can involve half a dozen pieces and a loop plays several lines, so
   * creating and disposing materials per line would churn shader programs for no
   * reason. Geometry is swapped per use instead, which is free.
   */
  #ghostSlot() {
    const free = this.ghostSlots.find((slot) => !slot.busy);
    if (free) return free;

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geometries.p, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.ghostGroup.add(mesh);

    const slot = { mesh, material, busy: false };
    this.ghostSlots.push(slot);
    return slot;
  }

  #releaseGhost(ghost) {
    ghost.slot.busy = false;
    ghost.slot.mesh.visible = false;
    ghost.slot.material.opacity = 0;
  }

  /** Starts one imagined move, creating the ghost that makes it if needed. */
  #fireGhostEvent(event) {
    let ghost = this.ghostByKey.get(event.key);

    if (!ghost) {
      const slot = this.#ghostSlot();
      slot.busy = true;
      slot.mesh.geometry = this.geometries[event.type] ?? this.geometries.p;
      // Per-piece tint, so the side running the combination and the side being
      // forced to answer read as two voices in one line. A piece never changes
      // side mid-line, so this is stable even when it moves twice.
      slot.material.color.copy(
        event.tint == null ? this.ghostTint : this.ghostScratch.set(event.tint).multiplyScalar(0.45)
      );
      slot.mesh.rotation.set(0, event.color === 'b' ? Math.PI : 0, 0);
      slot.mesh.scale.setScalar(1);
      const start = squareToWorld(event.from);
      slot.mesh.position.set(start.x, 0, start.z);
      slot.mesh.visible = true;
      ghost = { slot, opacity: 0, target: GHOST_MOVING, anim: null, out: null };
      this.ghostByKey.set(event.key, ghost);
    }

    // A promotion changes the silhouette part-way through the line.
    if (event.promotion && this.geometries[event.promotion]) {
      ghost.slot.mesh.geometry = this.geometries[event.promotion];
    }

    const from = ghost.slot.mesh.position.clone();
    const to = squareToWorld(event.to);
    const target = new THREE.Vector3(to.x, 0, to.z);
    // Same arc flavours as a real move, so an imagined knight still hops and an
    // imagined capture still strikes.
    const apex = arcHeightFor({
      type: event.type,
      capture: Boolean(event.capture),
      distance: from.distanceTo(target),
      isCastleRook: Boolean(event.isCastleRook),
    });
    const mid = from.clone().add(target).multiplyScalar(0.5);
    mid.y += apex;

    ghost.anim = {
      time: 0,
      duration: Math.max(0.08, event.travel ?? 0.24),
      curve: new THREE.QuadraticBezierCurve3(from, mid, target),
      to: target,
      onLand: () => {
        // Something the line takes has to leave, or the imagined position ends up
        // with two pieces standing on one square.
        if (event.capturesKey) {
          const victim = this.ghostByKey.get(event.capturesKey);
          if (victim) victim.out = victim.out ?? { time: 0, duration: 0.24, from: victim.opacity };
        }
        // A real piece the line captures is dimmed further rather than removed:
        // it is still on the board, it is only being imagined away.
        if (event.dimsEntryId) {
          const entry = this.entries.get(event.dimsEntryId);
          if (entry && !entry.removed) entry.phantom = PHANTOM_CAPTURED;
        }
      },
    };
    ghost.target = GHOST_MOVING;
  }

  #updateGhosts(dt) {
    if (this.ghostEvents.length) {
      this.ghostClock += dt;
      for (const event of this.ghostEvents) {
        if (event.fired || event.at > this.ghostClock) continue;
        event.fired = true;
        this.#fireGhostEvent(event);
      }
    }

    if (!this.ghostByKey.size) return;

    let expired = false;
    for (const ghost of this.ghostByKey.values()) {
      const slot = ghost.slot;
      const material = slot.material;
      slot.mesh.visible = true;

      if (ghost.out) {
        ghost.out.time += dt;
        const t = clamp(ghost.out.time / ghost.out.duration);
        ghost.opacity = ghost.out.from * (1 - t);
        material.opacity = ghost.opacity;
        if (t >= 1) expired = true;
        continue;
      }

      if (ghost.anim) {
        const anim = ghost.anim;
        anim.time += dt;
        const t = clamp(anim.time / anim.duration);
        anim.curve.getPoint(easeInOutCubic(t), slot.mesh.position);
        const stretch = 1 + Math.sin(t * Math.PI) * 0.06;
        slot.mesh.scale.set(1 / stretch, stretch, 1 / stretch);

        if (t >= 1) {
          slot.mesh.position.copy(anim.to);
          slot.mesh.scale.setScalar(1);
          ghost.anim = null;
          // Settle back, so the ghost that moves next is clearly the live thought.
          ghost.target = GHOST_SETTLED;
          anim.onLand?.();
        }
      }

      ghost.opacity = damp(ghost.opacity, ghost.target, 9, dt);
      material.opacity = ghost.opacity;
    }

    if (!expired) return;
    for (const [key, ghost] of [...this.ghostByKey]) {
      if (!ghost.out || ghost.out.time < ghost.out.duration) continue;
      this.#releaseGhost(ghost);
      this.ghostByKey.delete(key);
    }
  }

  /**
   * Damps a real piece towards however far it is currently being imagined away.
   * Skipped while its own animation owns the opacity, and short-circuited when
   * there is nothing to do, which is the usual case.
   */
  #updatePhantom(entry, dt) {
    const target = entry.phantom ?? 0;
    if (target === 0 && (entry.dim ?? 0) === 0) return;

    entry.dim = damp(entry.dim ?? 0, target, 7, dt);
    if (target === 0 && entry.dim < 0.005) entry.dim = 0;
    if (entry.anim) return;

    const base = this.xray ? 0.34 : 1;
    const wantTransparent = this.xray || entry.dim > 0;
    if (entry.material.transparent !== wantTransparent) {
      entry.material.transparent = wantTransparent;
      entry.material.needsUpdate = true;
    }
    entry.material.opacity = base * (1 - entry.dim * 0.8);
  }

  /* ------------------------------------------------------------------ pieces */

  get(id) {
    return this.entries.get(id) ?? null;
  }

  /** Snap a piece to a square with no animation. */
  place(id, square) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const target = squareToWorld(square);
    entry.square = square;
    entry.mesh.position.set(target.x, 0, target.z);
  }

  /**
   * Animate a piece along an arc to its destination.
   * @returns {object|null} the animation record (also stored on the entry).
   */
  animateMove(id, toSquare, { duration = 0.5, capture = false, isCastleRook = false, onLand } = {}) {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const from = entry.mesh.position.clone();
    const to = squareToWorld(toSquare);
    const target = new THREE.Vector3(to.x, 0, to.z);
    const distance = from.distanceTo(target);

    const apex = arcHeightFor({ type: entry.type, capture, distance, isCastleRook });
    const mid = from.clone().add(target).multiplyScalar(0.5);
    mid.y += apex;

    entry.square = toSquare;
    entry.anim = {
      kind: 'move',
      time: 0,
      duration,
      curve: new THREE.QuadraticBezierCurve3(from, mid, target),
      from,
      target,
      capture,
      onLand,
      landed: false,
      lean: Math.atan2(target.x - from.x, target.z - from.z),
    };

    return entry.anim;
  }

  /** Captured piece: flash, spin, shrink out of existence. */
  animateCapture(id, { duration = 0.5 } = {}) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.material.transparent = true;
    entry.material.needsUpdate = true;
    entry.anim = { kind: 'capture', time: 0, duration };
  }

  /** Whole-set dissolve used at the end of the loop before the board resets. */
  dissolve({ duration = 0.9 } = {}) {
    for (const entry of this.entries.values()) {
      if (entry.removed) continue;
      entry.material.transparent = true;
      entry.material.needsUpdate = true;
      const distance = Math.hypot(entry.mesh.position.x, entry.mesh.position.z);
      entry.anim = {
        kind: 'dissolve',
        time: -distance * 0.045,
        duration,
      };
    }
  }

  setHovered(entry) {
    if (this.hovered === entry) return;
    this.hovered = entry;
  }

  setXray(enabled) {
    this.xray = enabled;
    for (const entry of this.entries.values()) {
      entry.material.transparent = enabled || entry.material.opacity < 1;
      entry.material.opacity = enabled ? 0.34 : 1;
      entry.material.depthWrite = !enabled;
      entry.material.needsUpdate = true;
      entry.mesh.castShadow = !enabled;
    }
  }

  /** Transient emissive kick, e.g. when a piece is the subject of analysis. */
  pulse(id, amount = 1) {
    const entry = this.entries.get(id);
    if (entry) entry.glow = Math.max(entry.glow, amount);
  }

  static describe(entry) {
    return {
      name: PIECE_NAMES[entry.type],
      color: entry.color === 'w' ? 'White' : 'Black',
      value: PIECE_VALUES[entry.type],
      square: entry.square,
    };
  }

  update(dt) {
    this.#updateGhosts(dt);

    for (const entry of this.entries.values()) {
      if (entry.removed) continue;

      const { mesh, material, anim } = entry;

      if (anim) {
        anim.time += dt;
        const t = clamp(anim.time / anim.duration);

        if (anim.kind === 'move') {
          const eased = easeInOutCubic(t);
          anim.curve.getPoint(eased, mesh.position);

          // Lean into the direction of travel, then straighten on landing.
          const leanAmount = Math.sin(t * Math.PI) * 0.16;
          mesh.rotation.x = Math.cos(anim.lean) * -leanAmount;
          mesh.rotation.z = Math.sin(anim.lean) * leanAmount;

          // Squash on take-off, stretch mid-flight.
          const stretch = 1 + Math.sin(t * Math.PI) * 0.05;
          mesh.scale.set(1 / stretch, stretch, 1 / stretch);

          entry.glow = Math.max(entry.glow, 0.22 * Math.sin(t * Math.PI));

          if (t >= 1) {
            mesh.position.copy(anim.target);
            mesh.rotation.set(0, entry.baseRotationY, 0);
            mesh.scale.setScalar(1);
            if (!anim.landed) {
              anim.landed = true;
              anim.onLand?.(entry);
            }
            entry.glow = Math.max(entry.glow, 1);
            entry.anim = null;
          }
        } else if (anim.kind === 'capture') {
          // Lift, turn away, fade out. The turn is slow enough to follow: the
          // point is to show which piece left the board, not to spin it.
          const rise = easeOutCubic(t);
          mesh.position.y = rise * 0.7;
          mesh.rotation.y = entry.baseRotationY + easeOutCubic(t) * 1.6;
          mesh.rotation.x = t * 0.5;
          const shrink = Math.max(0.0001, 1 - easeOutQuint(t));
          mesh.scale.setScalar(shrink);
          material.opacity = 1 - t;
          material.emissive.lerpColors(entry.baseEmissiveColor, CAPTURE_COLOR, Math.sin(t * Math.PI) * 0.7);
          material.emissiveIntensity = entry.baseEmissive + Math.sin(t * Math.PI) * 0.8;

          if (t >= 1) {
            entry.removed = true;
            mesh.visible = false;
            entry.anim = null;
          }
        } else if (anim.kind === 'dissolve') {
          if (anim.time < 0) continue;
          const e = easeOutCubic(t);
          mesh.position.y = e * 1.6;
          material.opacity = 1 - e;
          mesh.scale.setScalar(Math.max(0.0001, 1 - e * 0.6));
          if (t >= 1) {
            entry.removed = true;
            mesh.visible = false;
            entry.anim = null;
          }
        } else if (anim.kind === 'spawn') {
          if (anim.time < 0) continue;
          const e = easeOutBack(t, 1.35);
          mesh.scale.setScalar(Math.max(0.0001, e));
          mesh.position.y = (1 - easeOutCubic(t)) * -0.9;
          material.opacity = clamp(t * 1.6);
          entry.glow = Math.max(entry.glow, 1 - t);
          if (t >= 1) {
            mesh.scale.setScalar(1);
            mesh.position.y = 0;
            material.opacity = this.xray ? 0.34 : 1;
            material.transparent = this.xray;
            material.needsUpdate = true;
            entry.anim = null;
          }
        }
      }

      // Hover response: lift, brighten, and a whisper of yaw.
      const hoverTarget = this.hovered === entry ? 1 : 0;
      entry.hover = damp(entry.hover, hoverTarget, 12, dt);
      entry.glow = damp(entry.glow, 0, 3.4, dt);

      if (!entry.anim) {
        entry.lift = entry.hover * 0.13;
        mesh.position.y = entry.lift;
        mesh.rotation.y = entry.baseRotationY + entry.hover * 0.24;
      }

      // Emissive responds to hover and to being the subject of analysis, and to
      // nothing else. There is no idle shimmer: 32 pieces breathing out of phase
      // is movement everywhere and information nowhere.
      if (anim?.kind !== 'capture' && anim?.kind !== 'dissolve') {
        material.emissiveIntensity = entry.baseEmissive + entry.hover * 0.5 + entry.glow * 0.7;
      }

      this.#updatePhantom(entry, dt);
    }
  }

  dispose() {
    this.clear();
    this.dropGhosts();
    for (const slot of this.ghostSlots) slot.material.dispose();
    this.ghostSlots.length = 0;
    Object.values(this.geometries).forEach((g) => g.dispose());
    Object.values(this.baseMaterials).forEach((m) => m.dispose());
  }
}
