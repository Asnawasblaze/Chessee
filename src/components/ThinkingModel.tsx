import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import modelUrl from "../assets/thinking-model.glb";
import useNearViewport from "./useNearViewport";
import { qualityPixelRatio, renderQuality } from "./renderQuality";

/* ---------------------------------------------------------------------- */
/* Scroll-driven "thinking pawn" — the Why chapter's centrepiece           */
/* ---------------------------------------------------------------------- */

/* Same division of labour as FeatureVisual: the pose is authored by the
   section that owns the ScrollTrigger (WhySection), and this component only
   renders it — easing the displayed transform toward `poseRef.current` every
   frame so the figure carries mass instead of snapping to the wheel.

   It is a separate component from that one rather than a shared renderer with a
   `scene` prop because the *rig* is the difference, not the geometry.
   FeatureVisual is lit for a near-white editorial page: a bright key, a strong
   hemisphere, and a room probe at full strength so pale board tiles and dark
   polished pieces both read. Here the stage is #000106, so the figure has to be
   drawn by its edges — a hard cool rim from behind, a restrained key, and the
   environment probe pulled right down so the room's white ceiling doesn't lift
   the background out of black. Sharing one component would mean a rig prop that
   is really two rigs. */
export interface ThinkPose {
  /** Yaw — the primary rotation the scroll timeline turns through. */
  ry: number;
  /** Pitch — small tilt, keeps each staged pose distinct. */
  rx: number;
  /** Uniform scale. 1 = the authored hero size (see MODEL_HEIGHT). */
  scale: number;
  /**
   * Horizontal offset as a fraction of the frame's visible half-width
   * (0 = centred, 1 = the right edge), not world units. The stage is
   * full-bleed, so its aspect ratio swings from ~2 on a desktop to ~0.5 on a
   * phone — a world-unit offset that framed the figure on the right of a
   * laptop pushed it clean off a portrait screen. Fractions of the *visible*
   * extent are viewport-independent.
   */
  x: number;
  /** Vertical offset, as a fraction of the visible half-height. */
  y: number;
}

/**
 * Live state for the dither post pass. Read every frame, the same way
 * `poseRef` is — so a scroll timeline can scrub grayscale/invert/dither on
 * while the figure falls, rather than only being able to set them once at
 * mount via the module constants below. `dither` and `grayscale`/`invert`
 * are kept as 0-1 numbers rather than booleans because GSAP tweens numbers,
 * not booleans, so a crossfade between "color" and "grayscale" needs a
 * fractional value to animate through (see uGrayscale's blend in the
 * fragment shader).
 */
export interface DitherState {
  /** 0 = full colour, 1 = fully desaturated. Tweenable in between. */
  grayscale: number;
  /** 0 = normal, 1 = fully inverted. */
  invert: number;
  /** 0 = dither pass off (raw render), 1 = dither pass on. */
  dither: number;
}

interface ThinkingModelProps {
  poseRef: RefObject<ThinkPose>;
  className?: string;
  /**
   * Optional live dither state. When omitted, the module constants
   * (DITHER_GRAYSCALE / DITHER_INVERT / DITHER_ENABLED) are used once at
   * mount and never change, same as before this prop existed.
   */
  ditherRef?: RefObject<DitherState>;
  /**
   * Optional element the renderer publishes its per-frame ground metrics to,
   * as CSS custom properties:
   *
   *   --think-base    px from the canvas' vertical centre down to where the
   *                   silhouette bottoms out
   *   --think-x       px from the canvas' horizontal centre to the figure's
   *                   projected centre (it travels sideways, so a fixed
   *                   shadow position would detach from it)
   *   --think-spread  ~1 multiplier for the contact shadow's width
   *   --think-alpha   0-1 shadow strength, weakest when the figure is lifted
   *
   * Measured by projecting the model's bounding box rather than derived in
   * CSS: only the renderer knows where the base actually lands once yaw,
   * pitch and scale are all in play.
   *
   * Also carries `data-think-off` when the renderer could not start at all, so
   * lighting authored against the figure can take itself off the stage rather
   * than sit there lighting nothing.
   */
  metricsRef?: RefObject<HTMLElement | null>;
}

/* Stone/pewter figure — rigid material, so 0% overshoot and a long settle.
   A low lerp factor is what makes the displayed pose trail the scrubbed
   target slightly, which is where the weight comes from. */
const POSE_EASE = 0.085;
const POINTER_EASE = 0.075;
/* Ambient life only — the scroll owns the real rotation, so the pointer is
   allowed a couple of degrees and no more. */
const POINTER_YAW = 0.18;
const POINTER_PITCH = 0.11;

/* Height the figure is normalised to, in world units. The camera below sees
   4.13 units at the pivot plane, so 2.86 puts the pawn at ~69% of the frame
   height at scale 1 — large enough to carry the title across it, with the
   shaft of light and the contact shadow still readable underneath. */
const MODEL_HEIGHT = 2.86;

/* Idle: a slow breath plus an even slower sway, both deliberately under the
   threshold where they read as an animation. A figure that is *thinking*
   should never be perfectly still between scroll beats. Premium personality —
   long period, sine in/out by construction, no overshoot. */
const IDLE_PERIOD = 8200;
const IDLE_RISE = 0.016;
const IDLE_SWAY = 0.013;

/* ---------------------------------------------------------------------- */
/* Dither pass — CanvasUI's DitheredObject technique (see                  */
/* dithered-object.md), grafted onto this renderer rather than swapped in  */
/* wholesale.                                                              */
/* ---------------------------------------------------------------------- */

/* The packaged <DitheredObject> is a self-contained widget: its own camera,
   its own studio light rig, its own idle float. This figure's rise/turn/
   recede is scrubbed by WhySection's scroll timeline and pinned to the title
   card's dissolve — swapping the whole renderer for the widget would drop
   that choreography. What's borrowed instead is just the technique: render
   the existing pose-driven scene to an offscreen target, then run that
   through the doc's Bayer-matrix post shader before it hits the canvas. */
const DITHER_ENABLED = true;
/* Size of the dither cells in CSS pixels. */
const DITHER_GRID_SIZE = 3;
/* Extra pixelation stacked on top of the grid size. */
const DITHER_PIXEL_SIZE_RATIO = 1;
/* Off, not on: grayscale is the doc default, but it would flatten the rig's
   rim-light palette (the cool blue that ties the pawn to the page's accent)
   to pure black-and-white. Keeping color means the threshold pass below
   still zeroes the dim cells to black — the dither read — while a lit edge
   keeps its own hue instead of going neutral.

   These three are only the *initial* uniform values now (read once, at
   material creation, same as before). Passing a `ditherRef` overrides them
   every frame — see DitherState above — which is how a scroll timeline can
   turn grayscale on mid-fall without a remount. Leave `ditherRef` unset and
   this component behaves exactly as it did before that prop existed. */
const DITHER_GRAYSCALE = true;
const DITHER_INVERT = false;

const DITHER_VERT = `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DITHER_FRAG = `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uGridSize;
uniform float uPixelSizeRatio;
uniform float uGrayscale;
uniform float uInvert;
uniform float uDither;

const mat4 THRESHOLDS = mat4(
  0.94118, 0.29412, 0.76471, 0.05882,
  0.47059, 0.70588, 0.23529, 0.52941,
  0.82353, 0.11765, 0.88235, 0.17647,
  0.35294, 0.58824, 0.41176, 0.64706
);

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

float thresholdAt(vec2 cellCoord) {
  ivec2 p = ivec2(mod(cellCoord, 4.0));
  return THRESHOLDS[p.x][p.y];
}

/* The two grades, split out of main() because both branches below need them and
   only one of them used to have them.

   Desaturated toward luma, not toward the "level" value main() computes for the
   threshold read: that one is the sum of the three channels, so it runs to 3.0,
   and mixing toward it does not drain the colour out of the figure — it blows
   the figure out to white, which on a rim-lit model against a dark board read
   as the pawn turning to chrome rather than losing its colour. Rec. 709
   coefficients preserve the value the pixel already had. */
vec3 desaturate(vec3 color) {
  float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(color, vec3(gray), clamp(uGrayscale, 0.0, 1.0));
}

vec3 inverted(vec3 color) {
  return mix(color, 1.0 - color, clamp(uInvert, 0.0, 1.0));
}

void main() {
  vec2 fragCoord = vUv * uResolution;

  /* ── No halftone, but still a colour grade ──────────────────────────────
     uDither is a switch, not a blend: below 0.5 the screen is off and the
     figure is drawn at full resolution. What this branch must *not* do is take
     the grade off with the screen, and that is exactly what it used to do —
     it returned the raw texture, so the Why chapter's ramp from uDither 1 to
     0.32 crossed the threshold here and handed the figure its colour straight
     back mid-scroll, with uGrayscale pinned at 1 and having no effect. A
     grayscale marker came out bronze.

     The screen and the desaturation are two independent things the scroll
     timeline scrubs, and they have to stay independent. */
  if (uDither < 0.5) {
    vec4 raw = texture(tDiffuse, vUv);
    outColor = vec4(inverted(desaturate(toSrgb(raw.rgb))) * raw.a, raw.a);
    return;
  }
  float pixelSize = uGridSize * uPixelSizeRatio;

  vec2 pixelUv = (floor(fragCoord / pixelSize) + 0.5) * pixelSize / uResolution;
  vec4 tex = texture(tDiffuse, pixelUv);
  vec3 color = toSrgb(tex.rgb);

  float level = dot(color, vec3(1.0));
  /* mix() rather than a > 0.5 branch: uGrayscale/uInvert are scrubbed live by a
     scroll timeline (see DitherState), and a hard cut would pop between colour
     and grayscale on a single frame instead of crossfading through it. The
     dither read below still keys off the un-mixed level value, so the threshold
     pass -- which is the point of this effect -- stays exactly as legible
     mid-crossfade as it is at either end.

     Order matters and is not the same as the branch above: the threshold sits
     between the two grades, because it paints cells flat black and an invert has
     to be able to turn those white. */
  color = desaturate(color);
  if (level < thresholdAt(fragCoord / uGridSize)) color = vec3(0.0);
  color = inverted(color);

  outColor = vec4(color * tex.a, tex.a);
}`;

export default function ThinkingModel({
  poseRef,
  className,
  ditherRef,
  metricsRef,
}: ThinkingModelProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  /* A lit scene, a loaded .glb and a live WebGL context, 9,600px down the page.
     Built when the chapter is approaching rather than on mount — see
     useNearViewport for the boot-time cost that this removes. */
  const near = useNearViewport(mountRef);

  useEffect(() => {
    if (!near) return;
    const mount = mountRef.current;
    if (!mount) return;
    /* Captured once, same as `mount` above — this effect's cleanup (and the
       async load-error path) read it too, and a ref read inside a closure
       that can outlive the render it was created in is exactly what
       react-hooks/exhaustive-deps flags. metricsRef itself is a stable
       ref object passed by the parent whose `.current` only ever points at
       one DOM node for the lifetime of this effect, so capturing it here is
       equivalent to reading it fresh each time, just without the lint
       warning that assumption can't otherwise be proven from. */
    const metricsEl = metricsRef?.current ?? null;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    /* Cleared up front rather than only set on failure, so a remount that
       succeeds takes the flag off again — see the note on the catch below. */
    metricsEl?.removeAttribute("data-think-off");

    /* ── Renderer ─────────────────────────────────────────────────────
       Guarded for the reason spelled out in FeatureVisual: three.js throws out
       of this constructor when no context is available, and an exception
       escaping an effect takes the whole React tree with it. This chapter asks
       for three contexts of its own (this, the board, the shatter pass), so it
       is the most likely place on the page to be refused one. */
    const quality = renderQuality();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        /* Note this only affects the *default* framebuffer, which this layer
           barely draws to — the scene goes through `ditherTarget` and only the
           dither pass lands here. The samples that matter are that target's,
           set below. */
        antialias: quality.antialias,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.warn("ThinkingModel: WebGL unavailable, figure disabled.", error);
      /* Tells whatever owns the metrics element that nothing will be published
         to it. Its whole purpose is to position lighting against a figure that
         is no longer there, and a ground pool under an empty stage reads as a
         smudge on the glass rather than as a missing 3D model — so the flag has
         to be an attribute the stylesheet can act on, not a value in
         --think-alpha: a scroll timeline may already have written an inline
         opacity onto that element, and inline styles win. */
      metricsEl?.setAttribute("data-think-off", "");
      return;
    }
    renderer.setPixelRatio(qualityPixelRatio());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Below 1: the rig is built to blow out the rim, and filmic tone mapping
    // rolls the highlights off. Exposing at 1 pushed the pawn's lit shoulder
    // to a flat white against a black stage.
    renderer.toneMappingExposure = 0.92;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    /* ── Scene + camera ───────────────────────────────────────────────── */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 6);

    /* ── Dither post pass ─────────────────────────────────────────────
       The pawn scene renders to this offscreen target first; the Bayer pass
       below reads it back and is what actually lands on the canvas.

       Samples scale with the tier, and 4x was never worth its price here even
       at the top: the dither step quantises the result to a Bayer grid, which
       throws away most of the edge gradient MSAA exists to produce. What it
       does still buy is a smoother *luminance* into the threshold, so the
       silhouette breaks up a little less raggedly — worth 4x on a machine that
       can spare it, worth nothing on one that cannot. This is the most
       expensive single thing the Why chapter asks for on a weak GPU: a
       full-viewport multisampled target, resolved once per frame, in the one
       chapter that already runs three contexts at once. */
    const ditherSamples =
      quality.tier === "high" ? 4 : quality.tier === "medium" ? 2 : 0;
    /* The offscreen target's own resolution, as a fraction of the canvas'
       native backing size. The dither branch already quantises to a
       `uGridSize`-px Bayer cell, and the raw-passthrough branch (uDither < 0.5,
       used while the screen is crossfading on or off) reads the same texture
       through a plain bilinear `texture()` tap — so a smaller target upsamples
       into either branch without a visible seam, and every fragment shader
       invocation below native res is one this layer doesn't pay for. Full
       resolution stays at `medium`/`high` (the dither quantisation is already
       most of the fidelity that resolution buys once past a certain scale);
       `low` halves the linear size, which is a quarter of the pixels this
       chapter's single most expensive pass touches. */
    const ditherResScale = quality.tier === "low" ? 0.5 : 1;
    const ditherTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: ditherSamples,
    });
    ditherTarget.texture.colorSpace = THREE.SRGBColorSpace;

    const ditherMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DITHER_VERT,
      fragmentShader: DITHER_FRAG,
      uniforms: {
        tDiffuse: { value: ditherTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uGridSize: { value: DITHER_GRID_SIZE },
        uPixelSizeRatio: { value: DITHER_PIXEL_SIZE_RATIO },
        uGrayscale: { value: DITHER_GRAYSCALE ? 1 : 0 },
        uInvert: { value: DITHER_INVERT ? 1 : 0 },
        uDither: { value: DITHER_ENABLED ? 1 : 0 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const ditherGeometry = new THREE.BufferGeometry();
    ditherGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3
      )
    );
    const ditherMesh = new THREE.Mesh(ditherGeometry, ditherMaterial);
    ditherMesh.frustumCulled = false;
    const ditherScene = new THREE.Scene();
    ditherScene.add(ditherMesh);
    const ditherCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderOnce = () => {
      renderer.setRenderTarget(ditherTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(ditherScene, ditherCamera);
    };

    /* ── Environment ───────────────────────────────────────────────────
       A procedural room probe, same as the knight, but at a fraction of the
       intensity (see envMapIntensity below). Without any probe the stone
       reads as flat vertex shading; at the knight's 0.85 the room's bright
       ceiling fills the shadow side and the figure stops sitting in the
       dark. */
    const pmrem = new THREE.PMREMGenerator(renderer);
    /* Held rather than constructed inline so teardown can dispose it — see the
       matching note in KnightModel. */
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    /* ── Lighting ──────────────────────────────────────────────────────
       A dark stage is drawn by edges, not by fill. The rim from behind-left
       is the brightest thing in the rig and traces the pawn's silhouette in
       the page's own accent; the key is a cool overhead shaft from the front
       that catches the crown and the leaning shoulder; the fill is barely
       there and only exists so the shadow side reads as dark grey stone
       instead of a hole in the page. */
    const hemi = new THREE.HemisphereLight(0xa8dcef, 0x00040a, 0.32);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xe8f6ff, 1.85);
    key.position.set(2.6, 6.2, 3.4);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x6f93a6, 0.42);
    fill.position.set(-5, 0.6, 2.4);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x9bd8ed, 4.2);
    rim.position.set(-3.2, 3.4, -5.6);
    scene.add(rim);

    // Second rim from the opposite side at half strength, so the silhouette
    // stays legible through the full yaw range instead of losing its edge
    // whenever the figure turns away from the main rim.
    const rimB = new THREE.DirectionalLight(0xcfeeff, 1.9);
    rimB.position.set(4.4, 2.2, -4.2);
    scene.add(rimB);

    // Tight specular so the polished surfaces get a highlight that travels as
    // the figure turns — without it the stone reads matte and dead.
    const spec = new THREE.PointLight(0xffffff, 9, 26, 2);
    spec.position.set(1.9, 2.9, 3.6);
    scene.add(spec);

    /* ── Model ─────────────────────────────────────────────────────────
       The pivot carries the scroll/pointer transform; the loaded mesh is
       re-parented under it and offset so its own centre sits on the pivot's
       origin, so rotation happens about the figure's middle regardless of
       where the export's origin is (this one sits on the base, at y=0). */
    const pivot = new THREE.Group();
    scene.add(pivot);

    let disposed = false;
    /* Set on a GLTFLoader decode failure — see the load error callback below
       — so the render loop can refuse to restart for a stage with nothing on
       it. Checked in sync(), same shape as the on-screen/tab-visible gate it
       sits next to. */
    let loadFailed = false;
    const localBounds = new THREE.Box3(
      new THREE.Vector3(-0.5, -MODEL_HEIGHT / 2, -0.5),
      new THREE.Vector3(0.5, MODEL_HEIGHT / 2, 0.5)
    );

    /* Same as the knight: meshopt-compressed and quantised geometry, 1.03 MB
       down to 235 kB. EXT_meshopt_compression is a *required* extension, so the
       decoder is not optional — without it the pawn never loads. */
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;

        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (!mat || !("metalness" in mat)) return;
          /* Uniform metalness/roughness rather than the export's own
             metallicRoughness map. That map was a 7.4MB PNG — three quarters
             of the asset — for a figure that is one material throughout, so
             it was stripped from the .glb and the values are set here
             instead: polished stone with a trace of metal, which is what
             lets the rim lights above draw the silhouette. */
          mat.metalness = 0.38;
          mat.roughness = 0.44;
          // Low, for the reason in the Environment note above.
          mat.envMapIntensity = 0.32;
        });

        /* Centre + normalise. Order matters: `model.scale` scales about the
           mesh's *local* origin, so the centring offset has to be expressed
           in post-scale units — scale first, then translate by the scaled
           centre. Subtracting the raw centre instead leaves the figure off
           by `center * (1 - norm)`, which for a model exported at ~98 units
           tall is most of the frame. */
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // Normalised on height, not the longest axis: the camera framing
        // below assumes a known headroom.
        const norm = MODEL_HEIGHT / (size.y || 1);
        model.scale.setScalar(norm);
        model.position.copy(center).multiplyScalar(-norm);

        localBounds.min.set(
          (-size.x * norm) / 2,
          (-size.y * norm) / 2,
          (-size.z * norm) / 2
        );
        localBounds.max.set(
          (size.x * norm) / 2,
          (size.y * norm) / 2,
          (size.z * norm) / 2
        );

        pivot.add(model);
        mount.dataset.loaded = "true";
        renderOnce();
      },
      undefined,
      (err) => {
        if (disposed) return;
        console.error("Failed to load thinking model:", err);
        /* EXT_meshopt_compression is a *required* extension (see the note
           above `loader`), so a decode failure here — a browser without
           WASM SIMD, a corrupted fetch, MeshoptDecoder failing to
           initialise — leaves the pivot with no model in it forever. Without
           this flag the renderer, the render loop and the dither pipeline
           all kept running for an empty lit stage indefinitely: three full
           per-frame passes spent on a canvas that will never show anything.
           Same signal the WebGL-creation-failure path already sets, and for
           the same reason — the ground pool has no floor to publish for
           either. */
        loadFailed = true;
        metricsEl?.setAttribute("data-think-off", "");
        stop();
      }
    );

    /* ── Pointer parallax ─────────────────────────────────────────────── */
    const pointer = { x: 0, y: 0 };
    const pointerTarget = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      if (prefersReduced) return;
      pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    /* ── Sizing ───────────────────────────────────────────────────────── */
    // Cached so the per-frame metrics write is pure arithmetic: reading
    // clientHeight inside the loop would force a layout flush every frame,
    // competing with the scrubbed ScrollTrigger on the same section.
    let canvasWidth = 1;
    let canvasHeight = 1;
    /* Half the world-space extent the camera sees at the pivot plane, which
       is what ThinkPose's fractional x/y are multiplied by. Recomputed on
       resize because the horizontal one depends on the aspect ratio. */
    let halfH = 1;
    let halfW = 1;
    /* Aspect fit. The camera's vertical field is fixed, so a pose authored at
       scale 0.92 fills the same *fraction of the height* on every screen — and
       on a portrait phone that is a figure running nearly the full frame with
       the copy stacked on top of it. Tapering the scale on narrow frames keeps
       the figure a companion to the type rather than a backdrop the type has
       to survive. 1 from roughly 4:3 upward, ~0.7 on a phone. */
    let fitScale = 1;
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const pr = qualityPixelRatio();
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      canvasWidth = w;
      canvasHeight = h;
      halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      halfW = halfH * camera.aspect;
      fitScale = 0.56 + 0.44 * Math.min(1, camera.aspect / 1.35);
      // The dither pass reads the grid at native pixels, so uResolution has to
      // match the canvas' real backing size (CSS size × pixel ratio) — that
      // uniform drives the Bayer cell math and has to stay in the same space
      // as gl_FragCoord regardless of how big the target actually is.
      // ditherTarget itself is allowed to be smaller (see ditherResScale):
      // it's a texture the shader samples with a bilinear tap, not a 1:1
      // canvas backing buffer.
      const nativeW = Math.max(Math.round(w * pr), 1);
      const nativeH = Math.max(Math.round(h * pr), 1);
      ditherTarget.setSize(
        Math.max(Math.round(nativeW * ditherResScale), 1),
        Math.max(Math.round(nativeH * ditherResScale), 1)
      );
      ditherMaterial.uniforms.uResolution.value.set(nativeW, nativeH);
      ditherMaterial.uniforms.uGridSize.value = DITHER_GRID_SIZE * pr;
      renderOnce();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    /* ── Render loop ──────────────────────────────────────────────────
       Only runs while the stage is on screen and the tab is visible (see the
       gate below), so a figure scrolled out of view isn't burning frame budget
       the rest of the page competes for. */
    const displayed = { ry: 0, rx: 0, scale: 1, x: 0, y: 0 };
    let raf = 0;
    let running = false;
    let publishedBase = Number.NaN;
    let publishedX = Number.NaN;
    const corner = new THREE.Vector3();

    /* Projects the pivot's eight bounding-box corners and returns where the
       silhouette bottoms out and where it is centred horizontally, in CSS
       pixels relative to the canvas centre. Exact under rotation, tilt,
       scale and translation — which matters because the pose changes all
       four between acts. */
    const measure = () => {
      let bottom = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? localBounds.max.x : localBounds.min.x,
          i & 2 ? localBounds.max.y : localBounds.min.y,
          i & 4 ? localBounds.max.z : localBounds.min.z
        );
        corner.applyMatrix4(pivot.matrixWorld).project(camera);
        // NDC y is +1 at the top, so the lowest point on screen is min ndc.y.
        bottom = Math.max(bottom, -corner.y);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
      }
      return {
        base: (bottom * canvasHeight) / 2,
        cx: (((minX + maxX) / 2) * canvasWidth) / 2,
      };
    };

    const publishMetrics = (scale: number, lift: number) => {
      const el = metricsEl;
      if (!el) return;
      const { base, cx } = measure();
      /* Skipped while the pose is settled, which is most frames — but gated on
         *both* readings, not just the vertical one. `base` only moves when the
         figure's scale or height does, so a pose that travels purely sideways
         published nothing: the figure crossed the frame and the light it stands in
         stayed where it was. Cheap to check, and the two are published together
         anyway, so there is no reason for one of them to decide for the other. */
      if (
        Math.abs(base - publishedBase) < 0.25 &&
        Math.abs(cx - publishedX) < 0.25
      ) {
        return;
      }
      publishedBase = base;
      publishedX = cx;
      el.style.setProperty("--think-base", `${base.toFixed(1)}px`);
      el.style.setProperty("--think-x", `${cx.toFixed(1)}px`);
      el.style.setProperty("--think-spread", scale.toFixed(3));
      // A figure lifted further off the floor casts a wider, weaker shadow —
      // the one cue that reads as real contact rather than a blurred blob.
      el.style.setProperty("--think-alpha", (1 - lift * 0.45).toFixed(3));
    };

    const tick = (now: number) => {
      const target = poseRef.current;
      if (target) {
        displayed.ry += (target.ry - displayed.ry) * POSE_EASE;
        displayed.rx += (target.rx - displayed.rx) * POSE_EASE;
        displayed.scale += (target.scale - displayed.scale) * POSE_EASE;
        displayed.x += (target.x - displayed.x) * POSE_EASE;
        displayed.y += (target.y - displayed.y) * POSE_EASE;
      }

      // Written straight through, no easing: this is a shader uniform, not a
      // physical pose, and the scroll timeline driving it already owns its
      // own easing (see WhySection's scrub). Cheap enough to set every frame
      // unconditionally rather than diffing first — three uniform writes is
      // nothing next to the render calls either side of it.
      const dither = ditherRef?.current;
      if (dither) {
        ditherMaterial.uniforms.uGrayscale.value = dither.grayscale;
        ditherMaterial.uniforms.uInvert.value = dither.invert;
        ditherMaterial.uniforms.uDither.value = dither.dither;
      }

      pointer.x += (pointerTarget.x - pointer.x) * POINTER_EASE;
      pointer.y += (pointerTarget.y - pointer.y) * POINTER_EASE;

      const phase = prefersReduced ? 0 : (now / IDLE_PERIOD) * Math.PI * 2;
      const idleY = Math.sin(phase) * IDLE_RISE;
      const idleSway = Math.sin(phase * 0.58) * IDLE_SWAY;

      const scale = displayed.scale * fitScale;
      pivot.rotation.y = displayed.ry + pointer.x * POINTER_YAW + idleSway;
      pivot.rotation.x = displayed.rx + pointer.y * POINTER_PITCH;
      pivot.scale.setScalar(scale);

      /* x/y are fractions of the travel the figure actually *has*, not of the
         raw half-frame: the figure's own projected size and a small margin are
         taken off first. Authoring against the raw half-width instead put the
         act-2 pose (x ≈ 0.46) two thirds of the way off the right edge of a
         portrait phone, because a 2:1 desktop frame is four times wider in
         world units than a 1:2 one at the same camera. Subtracting the
         figure's half-extent means x = 1 is "as far over as it can go and
         still be whole", at every aspect ratio. */
      const halfModel =
        Math.max(localBounds.max.x, localBounds.max.z) * scale;
      const travelX = Math.max(0, halfW - halfModel - halfW * 0.06);
      const travelY = Math.max(
        0,
        halfH - localBounds.max.y * scale - halfH * 0.05
      );
      pivot.position.set(
        displayed.x * travelX,
        displayed.y * travelY + idleY,
        0
      );

      // measure() reads pivot.matrixWorld, so the transform above has to be
      // flushed before it — otherwise the shadow sits one frame behind.
      pivot.updateMatrixWorld(true);
      publishMetrics(
        scale,
        // 0 at the lowest authored pose, 1 at the highest, so the ground
        // pool reacts to the figure rising between beats.
        Math.min(1, Math.max(0, (displayed.y + 0.22) / 0.3))
      );

      renderOnce();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || loadFailed) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    /* On screen *and* the tab is visible. Same shape as ChessBoard's gate: two
       independent conditions, either one enough to stop the frame. This layer is
       the most expensive on the page — two full-viewport passes per frame — so
       it is the one that least deserves to keep drawing into a hidden tab. */
    let onScreen = false;
    let pageVisible = !document.hidden;
    const sync = () => {
      if (onScreen && pageVisible) start();
      else stop();
    };

    const onVisibility = () => {
      pageVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 }
    );
    io.observe(mount);

    /* ── Teardown ─────────────────────────────────────────────────────── */
    return () => {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      /* Same flag the WebGL-refusal path sets, and for the same underlying
         reason: metricsEl's custom properties are inline styles this
         component wrote, and unmounting does not revert them on its own. A
         clean unmount used to be a theoretical case — useNearViewport never
         reverted, so this effect only ever tore down on StrictMode's dev
         double-invoke or a real navigation, neither of which left a stale
         `why-contact` on screen to notice. useFarPast (see WhySection) now
         unmounts this component for real while the page is still up, so the
         ground pool has to be told there is no floor left to publish for it,
         the same way it already is when the renderer never started at all. */
      metricsEl?.setAttribute("data-think-off", "");
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        const kill = (m: THREE.Material) => {
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          std.normalMap?.dispose();
          std.roughnessMap?.dispose();
          std.metalnessMap?.dispose();
          m.dispose();
        };
        if (Array.isArray(mat)) mat.forEach(kill);
        else if (mat) kill(mat);
      });
      scene.environment = null;
      envRT.dispose();
      roomEnv.dispose();
      ditherTarget.dispose();
      ditherGeometry.dispose();
      ditherMaterial.dispose();
      renderer.dispose();
      /* `dispose()` does not release the WebGL context; `forceContextLoss()`
         does. See the fuller note in FeatureVisual — this page runs six live
         contexts, and StrictMode was doubling the three three.js ones. */
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [near, poseRef, ditherRef, metricsRef]);

  return <div className={className} ref={mountRef} aria-hidden="true" />;
}