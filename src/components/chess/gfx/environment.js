import * as THREE from 'three';

import { PALETTE } from './palette.js';

/**
 * Builds a studio-ish environment map entirely in a 2D canvas, then runs it
 * through PMREM. No external HDRI to download, no loading spinner, and the
 * highlights can be tuned to match the palette exactly.
 */
export function createEnvironmentMap(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#101a2c');
  sky.addColorStop(0.45, '#080d17');
  sky.addColorStop(0.62, '#04060b');
  sky.addColorStop(1, '#020308');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft area-light blobs. These are what you actually read as reflections on
  // the pieces, so they are placed to rake across the board from two sides.
  const blob = (x, y, r, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  blob(230, 120, 210, '#e8f4ff', 0.95);
  blob(760, 96, 170, '#5fd8ff', 0.7);
  blob(520, 210, 260, '#1b3a63', 0.5);
  blob(940, 250, 150, '#ffb469', 0.45);
  blob(60, 300, 190, '#2a4f8a', 0.4);

  // A dim horizon band keeps the lower hemisphere from going pure black, which
  // would make the metal read as flat.
  const horizon = ctx.createLinearGradient(0, 230, 0, 300);
  horizon.addColorStop(0, 'rgba(120,170,230,0.16)');
  horizon.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 230, canvas.width, 70);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(texture).texture;

  pmrem.dispose();
  texture.dispose();

  return envMap;
}

/**
 * Key + fill + rim rig. The key spot is the only shadow caster; the fill spot
 * exists purely so the half of the board facing away from the key does not fall
 * to black, which is what happens with a single raking source over 8 units.
 */
export function createLighting(scene) {
  // Ambient and sky are the legibility budget: they decide whether a piece in
  // shadow still reads as a piece. Everything else is shaping.
  const ambient = new THREE.AmbientLight(PALETTE.ambient, 0.58);
  const sky = new THREE.HemisphereLight(0x9fc4ec, 0x0a1020, 0.32);

  const key = new THREE.SpotLight(0xffffff, 125, 40, 0.78, 0.5, 1.75);
  key.position.set(-4.5, 13, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 3;

  const keyTarget = new THREE.Object3D();
  keyTarget.position.set(0, 0, 0);
  key.target = keyTarget;

  const fill = new THREE.SpotLight(0xbfd8f5, 52, 40, 0.85, 0.6, 1.7);
  fill.position.set(6, 10.5, -7);
  fill.target = keyTarget;

  // Cool/warm rim pair. Their whole job is to put a bright edge on the pieces
  // so they separate from a dark background — a product-photography trick, and
  // the reason they are dim and near-neutral. Turned up they stop describing
  // the pieces and start colouring the whole board instead.
  const rimCool = new THREE.PointLight(0x9fc4ec, 16, 26, 2);
  rimCool.position.set(8.5, 2.6, -7.5);

  const rimWarm = new THREE.PointLight(0xffd6a8, 8, 24, 2);
  rimWarm.position.set(-8.5, 2.2, 7.5);

  scene.add(ambient, sky, key, keyTarget, fill, rimCool, rimWarm);

  return { ambient, sky, key, fill, rimCool, rimWarm };
}

/**
 * The space the board sits in: a graded backdrop, a faint floor grid for scale,
 * and a thin haze of dust to give the volume some depth.
 *
 * Everything here is set dressing and is treated as such. It is static or very
 * nearly so, and dim enough that you would have to look for it. The rotating
 * scan rings, radar sweep and aurora bands that used to live here all animated
 * continuously in the viewer's peripheral vision, which is exactly where the
 * eye is most sensitive to movement, and they were pulling attention off the
 * board every second of the loop.
 */
export class Atmosphere {
  /**
   * @param {object} opts
   * @param {boolean} [opts.backdrop] draw the graded sphere the board sits in.
   *   Off in the landing page, where this scene is a *layer* rather than a
   *   picture: the canvas is composited over the chapter's own night, its
   *   drifting glows and its rank grid, and an opaque sphere at radius 90 would
   *   paint over every one of them. What replaces it is the surface underneath,
   *   which is the same near-black by design — so the board keeps its ground
   *   without the scene claiming the whole frame.
   */
  constructor({ reducedMotion = false, quality = 'high', backdrop = true } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'atmosphere';
    this.reducedMotion = reducedMotion;
    this.uniformsList = [];

    if (backdrop) this.group.add(this.#createBackdrop());
    this.group.add(this.#createFloor());
    this.group.add(this.#createDust(quality === 'low' ? 220 : quality === 'medium' ? 380 : 560));
  }

  #track(material) {
    this.uniformsList.push(material.uniforms);
    return material;
  }

  #createBackdrop() {
    const geometry = new THREE.SphereGeometry(90, 48, 32);
    const material = this.#track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x0c1421) },
          uBottom: { value: new THREE.Color(0x03050a) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vWorld = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          varying vec3 vWorld;

          // Cheap value noise, only used to break up banding.
          float hash(vec3 p) {
            return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          }

          void main() {
            vec3 dir = normalize(vWorld);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 color = mix(uBottom, uTop, pow(h, 0.85));

            // Dither to kill gradient banding on wide screens.
            color += (hash(dir * 512.0) - 0.5) * 0.012;

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      })
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'backdrop';
    return mesh;
  }

  #createFloor() {
    const geometry = new THREE.PlaneGeometry(120, 120, 1, 1);
    const material = this.#track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: {
          uColor: { value: new THREE.Color(0x5c86a8) },
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

          // Anti-aliased grid line using screen-space derivatives.
          float gridLine(vec2 p, float spacing, float width) {
            vec2 g = abs(fract(p / spacing - 0.5) - 0.5) / fwidth(p / spacing);
            return 1.0 - min(min(g.x, g.y) / width, 1.0);
          }

          void main() {
            float dist = length(vPos);
            // Tight fade: the floor exists to give the board a ground plane and
            // a sense of scale. Let it run to the horizon and it out-competes
            // the board for attention.
            float fade = smoothstep(26.0, 3.0, dist);

            float fine = gridLine(vPos, 1.0, 1.3) * 0.05;
            float coarse = gridLine(vPos, 8.0, 1.6) * 0.14;

            float energy = (fine + coarse) * fade;
            if (energy < 0.002) discard;
            gl_FragColor = vec4(uColor * energy, energy);
          }
        `,
      })
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2.35;
    mesh.name = 'floor';
    return mesh;
  }

  #createDust(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const radius = 3 + Math.pow(Math.random(), 0.6) * 22;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -2.2 + Math.random() * 16;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i] = Math.random() * 100;
      sizes[i] = 0.6 + Math.random() * 2.6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = this.#track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: Math.min(window.devicePixelRatio ?? 1, 2) },
          uColor: { value: new THREE.Color(0xb8cee4) },
          uMotion: { value: this.reducedMotion ? 0.25 : 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          attribute float aSize;
          uniform float uTime;
          uniform float uPixelRatio;
          uniform float uMotion;

          void main() {
            vec3 p = position;

            // Slow helical drift: rise, wrap, and sway. No twinkle — a few
            // hundred points flickering independently is visual noise, and at
            // this opacity the drift alone is enough to read as air.
            float t = uTime * uMotion;
            p.y = mod(p.y + 2.2 + t * (0.16 + fract(aSeed) * 0.22), 18.0) - 2.2;
            p.x += sin(t * 0.24 + aSeed) * 0.55;
            p.z += cos(t * 0.19 + aSeed * 1.7) * 0.55;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aSize * uPixelRatio * (20.0 / max(0.001, -mv.z));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;

          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float d = length(uv);
            if (d > 0.5) discard;
            float core = pow(smoothstep(0.5, 0.0, d), 2.2);
            float alpha = core * 0.16;
            gl_FragColor = vec4(uColor * alpha, alpha);
          }
        `,
      })
    );

    const points = new THREE.Points(geometry, material);
    points.name = 'dust';
    points.frustumCulled = false;
    return points;
  }

  update(time) {
    for (const uniforms of this.uniformsList) {
      if (uniforms.uTime) uniforms.uTime.value = time;
    }
  }

  dispose() {
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  }
}
