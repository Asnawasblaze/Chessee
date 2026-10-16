import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  createFeatureScene,
  SCENE_REFERENCE_RADIUS,
  type FeatureScene,
  type FeatureSceneId,
} from "./featureScenes";
import useNearViewport from "./useNearViewport";
import { qualityPixelRatio, renderQuality } from "./renderQuality";

/* ---------------------------------------------------------------------- */
/* The features chapter's 3D stage                                         */
/* ---------------------------------------------------------------------- */

/* Same division of labour the chapter's other layers use: the *pose* is
 * authored elsewhere — FeatureStory owns the ScrollTrigger and scrubs these
 * numbers as the reader moves through the three features — and this component
 * only renders it. Every frame it eases its displayed transform toward
 * `poseRef.current`, crossfades between the three scenes according to the pose's
 * `beat`, and draws.
 *
 * One renderer for all three scenes, not three renderers. That is not a
 * micro-optimisation: browsers cap how many live WebGL contexts a page may hold
 * (roughly 8-16) and evict the oldest when the cap is reached, and this page
 * already runs six counting this one — the hero's fog, the features mist
 * curtain, this stage, and the Why chapter's board, shatter pass and pawn. Two
 * more would put the page within range of the cap on a browser at the low end
 * of it. So the three scenes are three subtrees of one scene graph, only one of
 * which is fully visible at a time, and the two that are not on screen cost
 * nothing but a `visible = false`.
 *
 * Note the star fields are *not* in that count: SpaceField is a 2D canvas
 * (getContext("2d") in starFieldEngine), not a GL layer.
 *
 * See featureScenes.ts for what each scene actually is, and chessPieces.ts for
 * why none of it needs a .glb.
 */

export interface FeaturePose {
  /**
   * Which scene is showing, as a *continuous* index. 0, 1 and 2 are the three
   * settled scenes; anything in between crossfades its two neighbours.
   *
   * Continuous rather than an integer on purpose. The scroll timeline tweens
   * this like any other number, so the handover between two features is a real
   * dissolve the reader scrubs through — an integer would make it a cut, and a
   * cut in the middle of a scrubbed pin reads as a bug.
   */
  beat: number;
  /** Yaw offset, radians. Small: each scene owns its own motion. */
  ry: number;
  /** Pitch offset, radians. */
  rx: number;
  /** Uniform scale. */
  scale: number;
  /** Vertical offset in world units. */
  y: number;
}

interface FeatureVisualProps {
  poseRef: RefObject<FeaturePose>;
  /**
   * The scene for each beat, in beat order. Must be a stable reference — it is
   * an effect dependency, so an array literal built during render would tear
   * down and rebuild every scene on every render.
   */
  scenes: readonly FeatureSceneId[];
  className?: string;
  /**
   * Optional element the renderer publishes its per-frame ground metrics to, as
   * CSS custom properties. Also carries `data-fv-off` when the renderer could
   * not start at all, so a shadow authored against the visual can take itself
   * off the page rather than sit there under nothing.
   *
   *   --fv-base    px from the canvas' vertical centre to where the active
   *                scene's floor projects (positive = downward)
   *   --fv-spread  ~1 multiplier for how wide the contact shadow should be
   *   --fv-alpha   0-1 shadow strength
   *
   * The three scenes have genuinely different footprints — a full board, a
   * readout ring, a stack of plies — and two of the three levitate. A hardcoded
   * CSS offset can only ever be right for one of them, so the renderer, which
   * is the only thing that knows where each floor projects to, publishes it.
   * Written on this element rather than an ancestor because custom properties
   * inherit: setting them higher up would invalidate style for the whole stage
   * subtree on every frame.
   */
  metricsRef?: RefObject<HTMLElement | null>;
}

/* Premium personality: elegant, no overshoot, and weight in everything. A low
   lerp factor means the displayed pose trails the scrubbed target slightly
   rather than snapping to it, which is what sells the scenes as objects with
   mass rather than as values being written. */
const POSE_EASE = 0.1;
const POINTER_EASE = 0.08;
/* Pointer parallax is deliberately tiny — ambient life, not a turntable. The
   scroll owns the real motion and each scene owns its own loop. */
const POINTER_YAW = 0.2;
const POINTER_PITCH = 0.12;

/* ── Crossfade ──────────────────────────────────────────────────────────
   The outgoing scene recedes and the incoming one arrives slightly nearer, so
   the two are never ambiguously ordered in depth. That matters for more than
   composition: both are semi-transparent mid-fade, and three sorts the
   transparent pass back-to-front per object, so a definite depth separation is
   what guarantees the arriving scene composites *over* the leaving one instead
   of flickering between orders as the reader scrubs. */
const FADE_DEPTH_BACK = -1.7;
const FADE_DEPTH_FRONT = 0.35;
const FADE_SCALE_MIN = 0.78;
/** Rise on the way in, rise on the way out — matching the copy's own cascade. */
const FADE_RISE = 0.34;
const FADE_TURN = 0.42;

/* Camera. Raised and aimed slightly down rather than sitting on the axis: two
   of the three scenes are built around horizontal planes (a board, a stack of
   plies) and an on-axis camera sees those edge-on, as bright horizontal lines.
   ~21° of pitch is enough to read a board's surface while leaving upright
   pieces upright — tilting the *objects* instead would have laid the pieces
   over with them. */
const CAMERA_FOV = 38;
const CAMERA_POSITION = new THREE.Vector3(0, 2.05, 5.4);
const CAMERA_TARGET = new THREE.Vector3(0, -0.08, 0);

/* ── Fitting the scenes to the canvas ───────────────────────────────────
   The envelope the three scenes actually occupy, in world units, measured across
   a full loop of each: the ply stack is the widest at ~2.7 across (its own sway
   swings the corners of the deepest plies out past their static extent) and the
   tallest at ~2.6.

   Both axes matter, and only one of them used to. The camera's field is fixed
   *vertically*, so the fit was derived from width alone and capped at 1 — which
   was right for the desktop slot (6 of 12 columns against a full-height stage,
   aspect ~0.78) and badly wrong for the mobile one. There the canvas is the full
   620px wide against a 200-300px band, aspect ~2.3, and a fit capped at 1 left
   the scenes at their authored size: 29% of the available width, two thirds of
   the band's height, everything rendered at a third of the linear size it was
   composed at. Which is most of the reason the chapter numeral behind them
   looked like part of the same drawing — the scenes had no presence to lose.

   So the fit takes whichever axis binds and is allowed to grow past 1 when there
   is room. The two fill targets are what the desktop slot already resolved to,
   so that framing is unchanged and the wide-short canvas is the only one that
   moves. */
/* Measured across a full loop of all three scenes, then given a little room.
   The widest and tallest is the ply stack; its own sway swings the corners of
   the deepest plies past their static extent, so neither number can be read off
   the scene's authored dimensions. Both are slight over-estimates already (a
   rotated object's bounding box is the box of its box), but the margin matters
   more than the last 3% of size: a scene edit that pushed either span past its
   constant would crop at the frame edge with nothing to say so. */
const SCENE_SPAN_W = 2.74;
const SCENE_SPAN_H = 2.66;
const FILL_W = 0.86;
const FILL_H = 0.8;

/* ── Hairline survival ──────────────────────────────────────────────────
   WebGL draws every line exactly one device pixel wide, whatever the scene's
   scale and whatever `linewidth` says — the parameter is inert outside the core
   profile. With the pixel ratio capped at 2, a hairline on the mobile canvas is
   therefore half a CSS pixel, and at the 22-34% alpha these are authored at it
   is simply not there: the board's frame, the engine's wireframe cage, the ply
   grids and the whole search tree all thin out to nothing while the numeral
   behind them keeps its full 1.25px CSS stroke.

   Width cannot be fixed. Contrast can, and it is the honest trade: below the
   reference height the line materials are pushed toward full opacity so a
   half-pixel line still lands. Above it the boost is 1 and nothing changes. */
const LINE_REFERENCE_H = 620;
const LINE_BOOST_MAX = 2.4;

/** Frozen frame the reduced-motion path holds, in seconds into each loop. */
const STILL_AT = 3.1;

/** Used only for the frames before the owner's timeline has set a pose. */
const FALLBACK_POSE: FeaturePose = { beat: 0, ry: 0, rx: 0, scale: 1, y: 0 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Every distinct material in a scene, flipped to `transparent` so the crossfade
 * has an opacity channel to work with.
 *
 * Collected by walking the graph rather than declared by each scene builder, so
 * a builder cannot forget to list one and leave a single mesh hanging at full
 * strength through a dissolve.
 *
 * Flipped once, at build, and never flipped back. `transparent` is part of
 * three's program cache key — an opaque material compiles with `#define OPAQUE`,
 * which forces alpha to 1 in the fragment shader and makes `opacity` a no-op —
 * so toggling it per fade would compile a second program variant for every
 * material the first time the reader scrolled between two features. A one-time
 * shader compile in the middle of a scrubbed pin is a visible hitch; the cost of
 * staying transparent is per-object sorting and no early-z for about twenty
 * objects, which is not measurable. `depthWrite` is deliberately left alone, so
 * the solids still occlude themselves correctly.
 */
function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      // Scenes share materials between meshes (every gyroscope ring is the same
      // metal), and writing one twice a frame is just wasted work.
      if (seen.has(entry)) continue;
      seen.add(entry);
      entry.transparent = true;
      materials.push(entry);
    }
  });
  return materials;
}

/**
 * One material's opacity, held for the length of a single draw.
 *
 * The dim is applied *after* the scenes have updated and undone again as soon as
 * the frame is on screen, rather than written once from a base captured at
 * build time. All three scenes animate opacities of their own — the engine's
 * wireframe cage breathes, each ply lights up as the scan crosses it, the
 * selection ring pulses — so a build-time base is stale for exactly the
 * materials that carry the most motion, and multiplying in place without
 * restoring would compound frame over frame until everything faded to nothing.
 * Capturing whatever the scene just wrote, scaling it, drawing, and putting it
 * back is the only version that is correct for both kinds of material and needs
 * no cooperation from the scene builders at all.
 */
interface SavedOpacity {
  material: THREE.Material;
  opacity: number;
}

export default function FeatureVisual({
  poseRef,
  scenes,
  className,
  metricsRef,
}: FeatureVisualProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  /* Three scenes and a live WebGL context, 4,700px down the page. Built when the
     chapter is approaching rather than on mount — see useNearViewport for the
     boot-time cost that this removes. */
  const near = useNearViewport(mountRef);

  useEffect(() => {
    if (!near) return;
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    /* ── Renderer ─────────────────────────────────────────────────────
       three.js throws out of this constructor when the browser refuses a
       context — hardware acceleration off, a blocklisted driver, or a page that
       has used up its context budget. An exception escaping an effect unmounts
       the tree above it, so an unguarded `new WebGLRenderer` is a blank page.
       These scenes are decoration: they opt out instead. */
    // Cleared up front so a remount that succeeds takes the flag off again.
    metricsRef?.current?.removeAttribute("data-fv-off");

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: renderQuality().antialias,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.warn("FeatureVisual: WebGL unavailable, scenes disabled.", error);
      /* Nothing will ever be published to the metrics element, so tell it: it
         exists to position a contact shadow under a figure, and a shadow under
         an absent figure is a smudge on an empty floor. An attribute rather
         than a value in --fv-alpha, because the scroll timeline may already
         have written an inline opacity there and inline styles win. */
      metricsRef?.current?.setAttribute("data-fv-off", "");
      return;
    }
    renderer.setPixelRatio(qualityPixelRatio());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    /* 1.0, where the Why chapter's dark stage runs at 0.92 and the old knight
       ran at 1.15. That knight was near-black on a white page and needed the
       lift; these scenes contain near-white board tiles and a pale evaluation
       bar, and at 1.15 those clip to flat white and lose their form entirely. */
    renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    /* ── Scene + camera ───────────────────────────────────────────────── */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.copy(CAMERA_POSITION);
    camera.lookAt(CAMERA_TARGET);
    /* The renderer refreshes these during `render()`, but `publishMetrics()`
       below projects through the camera *before* the first draw. Without this
       the first published metric is computed against an identity view matrix
       and the contact shadow starts life somewhere off the canvas. */
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    /* ── Environment ───────────────────────────────────────────────────
       Directional lights alone give metal specular *dots*, not reflections, so
       polished pieces read as painted plastic with three bright spots on them.
       A pre-filtered room probe gives every polished surface something to
       actually mirror. Built procedurally — no HDR asset to download — and
       generated once. */
    const pmrem = new THREE.PMREMGenerator(renderer);
    /* Held in a variable rather than constructed inline so teardown can dispose
       it: RoomEnvironment builds real geometry and materials, and they outlive
       the render target baked from them. */
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    /* ── Lighting ──────────────────────────────────────────────────────
       Tuned for a near-white stage carrying a mix of dark polished pieces and
       pale board tiles, which pull in opposite directions: enough key to give
       the metal a highlight, not enough to blow the ivory tiles out. A cool
       hemisphere keeps the dark pieces' shadow sides from going to pure black,
       and the rim from behind traces every silhouette against the page. */
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9dc0d2, 0.5);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff6ea, 1.55);
    key.position.set(4, 6, 5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xcfe9f7, 0.7);
    fill.position.set(-6, 1.5, 3);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xdff3ff, 1.5);
    rim.position.set(-2.5, 4.5, -6);
    scene.add(rim);

    // A tight specular pop, so polished edges get a highlight that moves as
    // the scenes turn — without it the metal reads matte and flat.
    const spec = new THREE.PointLight(0xffffff, 7, 26, 2);
    spec.position.set(2.6, 3.4, 4);
    scene.add(spec);

    /* ── Scenes ────────────────────────────────────────────────────────
       The pivot carries the pose. Each scene sits under its own holder, which
       carries the crossfade — so a scene is free to animate its own group's
       transform (the analysis stack sways on its own clock) without the two
       fighting over the same properties. */
    const pivot = new THREE.Group();
    scene.add(pivot);

    const built = scenes.map((id) => {
      const feature: FeatureScene = createFeatureScene(id);
      const holder = new THREE.Group();
      holder.add(feature.group);
      pivot.add(holder);
      return {
        feature,
        holder,
        materials: collectMaterials(feature.group),
        /** Crossfade weight this frame. Also what the metrics blend by. */
        weight: 0,
      };
    });

    /* Pooled: the dim below runs on every frame of a crossfade, and at most two
       scenes' materials are ever in flight at once. */
    const saved: SavedOpacity[] = [];
    let savedCount = 0;

    /* ── Pointer parallax ─────────────────────────────────────────────── */
    const pointer = { x: 0, y: 0 };
    const pointerTarget = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    if (!prefersReduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }

    /* ── Sizing ───────────────────────────────────────────────────────── */
    /* Cached so the per-frame metrics write is pure arithmetic: reading
       clientHeight inside the render loop would force a layout flush every
       frame, competing with the scrubbed ScrollTrigger on the same section. */
    /* Visible height in world units at the plane the camera is aimed at. Fixed
       by the lens and the distance, so it is computed once rather than per
       resize — the fit below is the only thing the canvas' shape changes. */
    const fieldHeight =
      2 *
      CAMERA_POSITION.distanceTo(CAMERA_TARGET) *
      Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

    let canvasHeight = 1;
    let fitScale = 1;
    let lineBoost = 1;
    /* Forces the next frame through the reduced-motion short-circuit below.
       Resizing the drawing buffer clears it, so a resize that happens while the
       loop is stopped (the chapter is off screen) would otherwise leave a blank
       canvas for the reader to scroll back into. */
    let needsDraw = true;
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      canvasHeight = h;
      fitScale = Math.min(
        (fieldHeight * FILL_H) / SCENE_SPAN_H,
        (fieldHeight * camera.aspect * FILL_W) / SCENE_SPAN_W
      );
      lineBoost = Math.min(LINE_BOOST_MAX, Math.max(1, LINE_REFERENCE_H / h));
      needsDraw = true;
      renderFrame();
    };

    /* ── Metrics ──────────────────────────────────────────────────────── */
    const groundPoint = new THREE.Vector3();
    let publishedBase = Number.NaN;
    let publishedSpread = Number.NaN;
    let publishedAlpha = Number.NaN;

    const publishMetrics = (scale: number) => {
      const element = metricsRef?.current;
      if (!element) return;

      /* Blended across whichever scenes are showing, so the shadow travels and
         resizes through a crossfade rather than jumping when the active scene
         changes. */
      let sum = 0;
      let groundY = 0;
      let radius = 0;
      let alpha = 0;
      for (const entry of built) {
        const w = entry.weight;
        if (!(w > 0)) continue;
        sum += w;
        groundY += entry.feature.ground.y * w;
        radius += entry.feature.ground.radius * w;
        alpha += entry.feature.ground.alpha * w;
      }
      if (sum <= 0) return;
      groundY /= sum;
      radius /= sum;
      alpha /= sum;

      groundPoint
        .set(0, groundY, 0)
        .applyMatrix4(pivot.matrixWorld)
        .project(camera);
      // NDC y is +1 at the top of the frame, so the lowest point on screen is
      // the smallest ndc.y.
      const basePx = (-groundPoint.y * canvasHeight) / 2;
      const spread = (radius / SCENE_REFERENCE_RADIUS) * scale;

      if (
        Math.abs(basePx - publishedBase) < 0.25 &&
        Math.abs(spread - publishedSpread) < 0.002 &&
        Math.abs(alpha - publishedAlpha) < 0.005
      ) {
        return;
      }
      publishedBase = basePx;
      publishedSpread = spread;
      publishedAlpha = alpha;
      element.style.setProperty("--fv-base", `${basePx.toFixed(1)}px`);
      element.style.setProperty("--fv-spread", spread.toFixed(3));
      element.style.setProperty("--fv-alpha", alpha.toFixed(3));
    };

    /* ── Frame ────────────────────────────────────────────────────────── */
    const displayed: FeaturePose = { ...(poseRef.current ?? FALLBACK_POSE) };
    let clock = prefersReduced ? STILL_AT : 0;
    let lastNow = 0;

    function renderFrame(now?: number) {
      const target = poseRef.current ?? FALLBACK_POSE;

      /* Reduced motion holds a single frozen frame of every loop, so the only
         thing that can make a new frame worth drawing is the pose changing —
         and it does change once, *after* this effect has run: React commits
         child effects before parent ones, so FeatureStory's timeline sets the
         pose a beat after this component has already drawn. Hence a live loop
         that costs five comparisons a frame rather than a single eager draw,
         which would have frozen the visual on whatever the pose happened to be
         at mount. */
      if (
        prefersReduced &&
        !needsDraw &&
        displayed.beat === target.beat &&
        displayed.ry === target.ry &&
        displayed.rx === target.rx &&
        displayed.scale === target.scale &&
        displayed.y === target.y
      ) {
        return;
      }
      needsDraw = false;

      /* A wall clock rather than `now / 1000`: every scene loops on it, and a
         backgrounded tab or a stalled main thread hands back a `now` that has
         jumped seconds — which would teleport all three loops. Clamping the
         step means the worst a hitch can do is slow the loops down.

         `now` is absent for the draws that happen outside the loop (the first
         frame, and every resize). Those must not advance the clock at all: they
         have no timestamp to measure from, and treating a missing one as zero
         ran the loops *backwards* by however long the page had been open. */
      if (now !== undefined) {
        const dt = lastNow
          ? Math.max(0, Math.min(0.05, (now - lastNow) / 1000))
          : 0;
        lastNow = now;
        if (!prefersReduced) clock += dt;
      }

      // Nothing to ease toward in reduced motion: the pose is set once and
      // never scrubbed, so it is adopted whole.
      const ease = prefersReduced ? 1 : POSE_EASE;
      displayed.beat += (target.beat - displayed.beat) * ease;
      displayed.ry += (target.ry - displayed.ry) * ease;
      displayed.rx += (target.rx - displayed.rx) * ease;
      displayed.scale += (target.scale - displayed.scale) * ease;
      displayed.y += (target.y - displayed.y) * ease;

      pointer.x += (pointerTarget.x - pointer.x) * POINTER_EASE;
      pointer.y += (pointerTarget.y - pointer.y) * POINTER_EASE;

      const scale = displayed.scale * fitScale;
      pivot.rotation.y = displayed.ry + pointer.x * POINTER_YAW;
      pivot.rotation.x = displayed.rx + pointer.y * POINTER_PITCH;
      pivot.scale.setScalar(scale);
      pivot.position.y = displayed.y;

      for (let i = 0; i < built.length; i++) {
        const entry = built[i];
        const raw = clamp01(1 - Math.abs(displayed.beat - i));
        // Hermite, so a scene arrives and leaves at zero rate: a linear fade
        // makes the handover's start and end both visible as kinks.
        const w = raw * raw * (3 - 2 * raw);
        const away = 1 - w;
        const visible = raw > 0.0015;
        entry.holder.visible = visible;
        if (!visible) {
          entry.weight = 0;
          continue;
        }

        const leaving = displayed.beat > i;
        entry.holder.position.z =
          away * (leaving ? FADE_DEPTH_BACK : FADE_DEPTH_FRONT);
        entry.holder.position.y = away * (leaving ? FADE_RISE : -FADE_RISE);
        entry.holder.rotation.y = away * (leaving ? -FADE_TURN : FADE_TURN);
        entry.holder.scale.setScalar(FADE_SCALE_MIN + (1 - FADE_SCALE_MIN) * w);
        entry.weight = w;

        // Only the scenes actually on screen advance their loops. Two of the
        // three are usually invisible, and their per-frame work is the bulk of
        // this component's cost.
        entry.feature.update(clock, lineBoost);
      }

      /* publishMetrics reads pivot.matrixWorld, so the transform above has to
         be flushed before it — the renderer would otherwise only do it a line
         later, leaving the shadow one frame behind the scenes. */
      pivot.updateMatrixWorld(true);
      publishMetrics(scale);

      // Dim whatever the scenes just wrote (see SavedOpacity), draw, restore.
      savedCount = 0;
      for (const entry of built) {
        if (!entry.holder.visible || entry.weight > 0.999) continue;
        for (const material of entry.materials) {
          let slot = saved[savedCount];
          if (!slot) {
            slot = { material, opacity: 0 };
            saved[savedCount] = slot;
          }
          slot.material = material;
          slot.opacity = material.opacity;
          material.opacity = slot.opacity * entry.weight;
          savedCount++;
        }
      }

      renderer.render(scene, camera);

      for (let i = 0; i < savedCount; i++) {
        saved[i].material.opacity = saved[i].opacity;
      }
    }

    /* ── Loop ─────────────────────────────────────────────────────────
       Only runs while the stage is on screen and the tab is visible (see the
       gate below), so a chapter scrolled far out of view — or a page left in a
       background tab — isn't burning a frame budget the rest of the page is
       competing for. */
    let raf = 0;
    let running = false;
    const tick = (now: number) => {
      renderFrame(now);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running) return;
      running = true;
      // Reset, so the clamped step above doesn't spend the first frame back
      // catching up on however long the chapter was off screen.
      lastNow = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    /* Sizes the buffer *and* draws the first frame (see resize), so the scenes
       are already correct the moment the chapter scrolls in rather than one
       frame after it. */
    resize();

    /* Two independent conditions, resolved through one `sync()` — the same shape
       ChessBoard uses, and for the same reason: either is enough to stop the
       frame. A hidden tab used to keep this loop nominally running; rAF
       throttling capped the damage but the page still held three three.js
       renderers doing work nobody could see. */
    let onScreen = false;
    let pageVisible = !document.hidden;
    const sync = () => {
      if (onScreen && pageVisible) start();
      else stop();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 }
    );
    io.observe(mount);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    /* ── Teardown ─────────────────────────────────────────────────────── */
    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      for (const entry of built) entry.feature.dispose();
      scene.environment = null;
      envRT.dispose();
      roomEnv.dispose();
      renderer.dispose();
      /* `dispose()` releases three's own GPU objects but explicitly does *not*
         release the WebGL context — that is `forceContextLoss()`, a separate
         call. Without it every unmount abandons a live context that the browser
         only reclaims at GC, against a per-page cap of roughly 8-16 after which
         the oldest is evicted. React StrictMode makes this immediate rather
         than theoretical: it mounts, unmounts and remounts every effect, so in
         development the page held two contexts per layer from the first paint. */
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [near, poseRef, metricsRef, scenes]);

  return <div className={className} ref={mountRef} aria-hidden="true" />;
}
