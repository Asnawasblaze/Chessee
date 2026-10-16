import * as THREE from 'three';

import { PALETTE } from './palette.js';
import { FILES, isLightSquare, squareToWorld, indexToSquare } from '../logic/board.js';
import { clamp, damp, easeOutQuint } from './ease.js';

const TILE_SIZE = 0.965;
const TILE_HEIGHT = 0.14;
const RIPPLE_POOL = 12;

/**
 * The board: 64 instanced tiles that each carry their own emissive value, a
 * machined frame, engraved coordinates, a bracket cursor and a pool of
 * shockwave rings.
 *
 * Per-tile glow is an instanced attribute injected into MeshStandardMaterial
 * rather than 64 separate materials. One draw call, and highlighting a square
 * is just a buffer write.
 */
export class BoardMesh {
  constructor({ envMap }) {
    this.group = new THREE.Group();
    this.group.name = 'board';

    this.squares = [];
    this.tileState = [];
    this.indexBySquare = new Map();

    this.#createTiles(envMap);
    this.#createFrame(envMap);
    this.#createHalo();
    this.#createLabels();
    this.#createSelector();
    this.#createRipples();

    this.heatmap = null;
    this.heatmapStrength = 0;
    this._color = new THREE.Color();
  }

  #createTiles(envMap) {
    const geometry = new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE);

    // Low metalness on purpose. A metal has no diffuse response, so at the 0.68
    // this used to run at the tile colour was almost entirely replaced by
    // reflections of a dark environment, and the checker pattern went with it.
    // Honed stone, not polished chrome.
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.18,
      envMap,
      envMapIntensity: 0.45,
      emissive: 0x000000,
    });

    // Inject a per-instance emissive term. `aGlow` already carries colour *
    // intensity, so the fragment shader just adds it.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute vec3 aGlow;\nvarying vec3 vGlow;\n${shader.vertexShader}`.replace(
        'void main() {',
        'void main() {\n\tvGlow = aGlow;'
      );
      shader.fragmentShader = `varying vec3 vGlow;\n${shader.fragmentShader}`.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vGlow;'
      );
    };
    material.customProgramCacheKey = () => 'board-tile-glow';

    const mesh = new THREE.InstancedMesh(geometry, material, 64);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'tiles';

    const glow = new Float32Array(64 * 3);
    geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 3));

    const matrix = new THREE.Matrix4();
    const light = new THREE.Color(PALETTE.tileLight);
    const dark = new THREE.Color(PALETTE.tileDark);

    let i = 0;
    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = indexToSquare(file, rank);
        const p = squareToWorld(square, -TILE_HEIGHT / 2);
        matrix.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, isLightSquare(square) ? light : dark);

        this.squares[i] = square;
        this.indexBySquare.set(square, i);
        this.tileState[i] = {
          color: new THREE.Color(0x000000),
          intensity: 0,
          decay: 2.4,
          hold: 0,
        };
        i += 1;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.tiles = mesh;
    this.glowAttribute = geometry.getAttribute('aGlow');
    this.group.add(mesh);
  }

  #createFrame(envMap) {
    const outer = 4.62;
    const inner = 4.02;
    const radius = 0.34;

    const shape = new THREE.Shape();
    // Rounded outer rectangle.
    shape.moveTo(-outer + radius, -outer);
    shape.lineTo(outer - radius, -outer);
    shape.quadraticCurveTo(outer, -outer, outer, -outer + radius);
    shape.lineTo(outer, outer - radius);
    shape.quadraticCurveTo(outer, outer, outer - radius, outer);
    shape.lineTo(-outer + radius, outer);
    shape.quadraticCurveTo(-outer, outer, -outer, outer - radius);
    shape.lineTo(-outer, -outer + radius);
    shape.quadraticCurveTo(-outer, -outer, -outer + radius, -outer);

    const hole = new THREE.Path();
    hole.moveTo(-inner, -inner);
    hole.lineTo(inner, -inner);
    hole.lineTo(inner, inner);
    hole.lineTo(-inner, inner);
    shape.holes.push(hole);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.2,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.025,
      bevelSegments: 2,
      curveSegments: 10,
    });

    // rotateX(-90°) maps the extrude axis (+z) onto +y, so the ring stands up
    // from y = 0. Shift it down until only a 0.06 lip clears the tile surface —
    // any taller and the frame becomes a wall that hides the first rank and
    // swallows the coordinate labels.
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.16, 0);

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x10151f,
      roughness: 0.34,
      metalness: 0.9,
      clearcoat: 0.7,
      clearcoatRoughness: 0.28,
      envMap,
      envMapIntensity: 1.2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'frame';
    this.frame = mesh;
    this.group.add(mesh);

    // Thin emissive seam between frame and tiles: reads as a lit inlay.
    // It has to be an outline, not a filled quad, or it becomes an additive
    // sheet across the whole playing surface.
    const seamShape = new THREE.Shape();
    seamShape.moveTo(-4.015, -4.015);
    seamShape.lineTo(4.015, -4.015);
    seamShape.lineTo(4.015, 4.015);
    seamShape.lineTo(-4.015, 4.015);
    const seamHole = new THREE.Path();
    seamHole.moveTo(-3.955, -3.955);
    seamHole.lineTo(3.955, -3.955);
    seamHole.lineTo(3.955, 3.955);
    seamHole.lineTo(-3.955, 3.955);
    seamShape.holes.push(seamHole);

    const seamGeometry = new THREE.ShapeGeometry(seamShape);
    seamGeometry.rotateX(-Math.PI / 2);

    const seamMaterial = new THREE.MeshBasicMaterial({
      color: 0x63a8c8,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const seam = new THREE.Mesh(seamGeometry, seamMaterial);
    seam.position.y = 0.012;
    this.group.add(seam);
  }

  /** Soft halo under the board so it reads as levitating rather than pasted on. */
  #createHalo() {
    const geometry = new THREE.PlaneGeometry(20, 20);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x6f9dc4) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vPos;
        void main() {
          float d = length(vPos);
          // A wide, low pool of light under the board so it reads as levitating
          // rather than pasted on. Static and dim: the board must read as lit,
          // not as a light source.
          float glow = exp(-d * 0.55) * 0.09;
          glow += exp(-pow(abs(d - 4.9) * 1.6, 2.0)) * 0.07;
          gl_FragColor = vec4(uColor * glow, glow * 0.8);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.5;
    this.haloMaterial = material;
    this.group.add(mesh);
  }

  #createLabels() {
    const group = new THREE.Group();
    group.name = 'coordinates';

    const makeLabel = (text) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      ctx.font = '600 74px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#dbe7f4';
      ctx.fillText(text, 64, 70);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;

      // Normal blending and a fixed opacity. These are labels: their job is to
      // be readable, which rules out both additive blending (no blacks, so they
      // wash out over a lit tile) and any kind of fade cycle.
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      });

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), material);
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    };

    // y must clear the frame's top lip (0.06) or the labels render inside it.
    for (let i = 0; i < 8; i += 1) {
      const file = makeLabel(FILES[i]);
      file.position.set(i - 3.5, 0.075, 4.3);
      group.add(file);

      const rank = makeLabel(String(i + 1));
      rank.position.set(-4.3, 0.075, 3.5 - i);
      group.add(rank);
    }

    this.labels = group;
    this.group.add(group);
  }

  /** Corner-bracket cursor that tracks the hovered square. */
  #createSelector() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(PALETTE.cyan) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUvC;
        void main() {
          vUvC = uv - 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUvC;

        void main() {
          vec2 p = abs(vUvC) * 2.0;   // 0..1 from centre outwards
          float edge = max(p.x, p.y);
          float along = min(p.x, p.y);

          // Bracket: near the outline, but only close to the corners.
          float outline = smoothstep(0.78, 0.84, edge) * smoothstep(1.0, 0.94, edge);
          float corner = smoothstep(0.34, 0.62, along);
          float mark = outline * corner;

          float alpha = mark * uOpacity;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor * 1.4, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.18), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.016;
    mesh.visible = true;
    this.selector = mesh;
    this.selectorMaterial = material;
    this.selectorTarget = new THREE.Vector3(0, 0.016, 0);
    this.group.add(mesh);
  }

  #createRipples() {
    this.ripples = [];
    const geometry = new THREE.RingGeometry(0.05, 1, 96, 1);

    for (let i = 0; i < RIPPLE_POOL; i += 1) {
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 1 },
          uColor: { value: new THREE.Color(PALETTE.cyan) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uProgress;
          uniform vec3 uColor;
          varying vec2 vLocal;
          void main() {
            float r = length(vLocal);
            // Ring only. The soft filled interior this used to carry turned each
            // ripple into a translucent disc several squares across, sitting on
            // top of the pieces it was supposed to be drawing attention to.
            float front = 1.0 - smoothstep(0.0, 0.14, abs(r - 1.0));
            float fade = 1.0 - uProgress;
            float alpha = front * 0.5 * fade * fade;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(uColor * 1.2, alpha);
          }
        `,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.position.y = 0.02;
      this.group.add(mesh);
      this.ripples.push({ mesh, material, progress: 1, duration: 1, scale: 2.4 });
    }
  }

  /* ----------------------------------------------------------------- public */

  /** Light a square. `decay` controls how fast it falls off (0 = latch on). */
  highlight(square, color = PALETTE.cyan, intensity = 1, decay = 2.4) {
    const index = this.indexBySquare.get(square);
    if (index === undefined) return;
    const state = this.tileState[index];
    state.color.set(color);
    state.intensity = Math.max(state.intensity, intensity);
    state.decay = decay;
  }

  /** Brief bright flash, e.g. the square a piece just left. */
  flash(square, color = PALETTE.cyan, intensity = 2.2) {
    this.highlight(square, color, intensity, 3.6);
  }

  /**
   * Expanding ring centred on a square. `scale` is its final radius in squares,
   * so anything much above 1.5 stops reading as "this square" and starts
   * reading as "this region".
   */
  ripple(square, color = PALETTE.cyan, { scale = 1.3, duration = 0.95 } = {}) {
    const slot = this.ripples.find((r) => r.progress >= 1) ?? this.ripples[0];
    const p = squareToWorld(square);
    slot.mesh.position.set(p.x, 0.02, p.z);
    slot.material.uniforms.uColor.value.set(color);
    slot.progress = 0;
    slot.duration = duration;
    slot.scale = scale;
    slot.mesh.visible = true;
  }

  moveSelector(square) {
    if (!square) {
      this.selectorVisible = false;
      return;
    }
    const p = squareToWorld(square);
    this.selectorTarget.set(p.x, 0.016, p.z);
    this.selectorVisible = true;
  }

  /**
   * Square-control overlay. `map` is square -> net control (white positive).
   * Fades in and out via `strength`.
   */
  setHeatmap(map) {
    this.heatmap = map;
  }

  setHeatmapStrength(value) {
    this.heatmapTarget = value;
  }

  update(dt) {
    const array = this.glowAttribute.array;

    this.heatmapStrength = damp(this.heatmapStrength, this.heatmapTarget ?? 0, 6, dt);

    for (let i = 0; i < 64; i += 1) {
      const state = this.tileState[i];
      if (state.decay > 0) {
        state.intensity *= Math.exp(-state.decay * dt);
        if (state.intensity < 0.001) state.intensity = 0;
      }

      // No idle baseline. A tile is lit only when something is actually
      // happening on it, so any glow on the board carries information: origin,
      // destination, capture, check, or square control under x-ray.
      let r = state.color.r * state.intensity;
      let g = state.color.g * state.intensity;
      let b = state.color.b * state.intensity;

      if (this.heatmap && this.heatmapStrength > 0.002) {
        const control = this.heatmap.get(this.squares[i]) ?? 0;
        // Enough to tint a square, not enough to hide which colour it is.
        const amount = clamp(Math.abs(control) / 3) * this.heatmapStrength * 0.45;
        if (control > 0) {
          r += amount * 0.25;
          g += amount * 0.75;
          b += amount * 1.0;
        } else if (control < 0) {
          r += amount * 1.0;
          g += amount * 0.28;
          b += amount * 0.42;
        }
      }

      array[i * 3 + 0] = r;
      array[i * 3 + 1] = g;
      array[i * 3 + 2] = b;
    }
    this.glowAttribute.needsUpdate = true;

    // Ripples.
    for (const slot of this.ripples) {
      if (slot.progress >= 1) {
        if (slot.mesh.visible) slot.mesh.visible = false;
        continue;
      }
      slot.progress = clamp(slot.progress + dt / slot.duration);
      const eased = easeOutQuint(slot.progress);
      slot.mesh.scale.setScalar(0.25 + eased * slot.scale);
      slot.material.uniforms.uProgress.value = slot.progress;
    }

    // Cursor.
    const sm = this.selectorMaterial.uniforms;
    sm.uOpacity.value = damp(sm.uOpacity.value, this.selectorVisible ? 1 : 0, 10, dt);
    this.selector.position.x = damp(this.selector.position.x, this.selectorTarget.x, 18, dt);
    this.selector.position.z = damp(this.selector.position.z, this.selectorTarget.z, 18, dt);
  }

  dispose() {
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      if (child.material?.map) child.material.map.dispose();
      child.material?.dispose?.();
    });
  }
}

export { TILE_HEIGHT };
