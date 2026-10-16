/* ---------------------------------------------------------------------- */
/* SpaceField — star engine                                                */
/* ---------------------------------------------------------------------- */

/* Split out of SpaceField.tsx for the same reason cloudsEngine is split out of
 * Clouds.tsx: Vite's fast-refresh only preserves state for a module that
 * exports components and nothing else.
 *
 * ── What replaced what ───────────────────────────────────────────────────
 * The sky used to be three `radial-gradient` dot patterns tiled at 91-419px
 * spacings, with a keyframed opacity on each layer for twinkle. That was the
 * right call while the sky was scenery: no per-frame cost at all, and both
 * chapters could scale the layers for parallax with a transform.
 *
 * It cannot be the right call once the sky is the subject. A tiled pattern is
 * a *grid* — every star the same size, the same colour and the same brightness,
 * repeating on a fixed pitch — and once it is the largest thing in the frame the
 * eye finds the lattice, at which point the chapter is set against wallpaper
 * rather than against space. Whole-layer opacity twinkle has the same problem
 * one level up: three hundred stars brightening in unison is a light being
 * dimmed, not a star field.
 *
 * So the stars are real objects now, and what that buys is per-star everything:
 *
 *   Distribution.  Positions are drawn from a seeded PRNG, so they are irregular
 *                  but stable — the same sky every reload, and a resize remaps it
 *                  rather than reshuffling it.
 *   Magnitude.     Brightness is a steep power curve: mostly faint, a handful
 *                  bright. That single distribution is most of what makes a
 *                  scatter of dots read as a sky, and it is exactly what a tiled
 *                  pattern cannot express.
 *   Colour.        A stellar-ish mix — blue-white through white to amber — rather
 *                  than one ink at three opacities.
 *   Scintillation. Two sine components per star at unrelated rates, so the field
 *                  shimmers without ever pulsing as a unit.
 *   Response.      The whole reason for the rewrite. See below.
 *
 * ── Interaction ─────────────────────────────────────────────────────────
 * Three responses, each chosen so the field reads as a place the reader is
 * inside rather than a texture behind the type:
 *
 *   Parallax.  The three depths shift against the pointer by very different
 *              amounts (3px / 9px / 22px). Motion parallax is the depth cue the
 *              flat version had to fake with a scale, and it costs one translate
 *              per layer.
 *   Attention. Stars near the cursor brighten, swell slightly and ease away from
 *              it. Local, deliberately: the field is disturbed where the reader
 *              is looking and undisturbed everywhere else, which is what makes it
 *              feel like matter rather than like a hover state.
 *   Pulse.     A press sends a ring outward, brightening stars as it passes. The
 *              one response that is worth having on a page where the sky is not
 *              clickable — it answers the gesture without claiming to be a
 *              control.
 *
 * Plus meteors, which are not interactive at all and are the cheapest realism in
 * the file: a sky that produces an event every twenty seconds or so is a sky the
 * reader keeps watching.
 *
 * ── Cost ────────────────────────────────────────────────────────────────
 * Both chapters that mount this already sit under WebGL contexts, so the budget
 * is small and the shape of the code follows from it:
 *
 *   - ~430 stars at 1440×730, counts derived from area, hard-capped per layer.
 *   - Glow is a pre-rendered sprite per (colour, size) bucket — 5×4 small
 *     offscreen canvases, built once — so a frame is `drawImage` calls, never
 *     per-star gradient construction. A gradient per star per frame is the frame
 *     budget at this count; this is a few hundred blits.
 *   - `lighter` compositing, so overlapping glows sum the way light does instead
 *     of alpha-blending into flat patches.
 *   - The loop is paused whenever the field is off screen (IntersectionObserver)
 *     or the tab is hidden. Two fields are mounted on this page and at most one
 *     of them is ever in frame.
 *   - Reduced motion draws one static frame and never starts a loop.
 *
 * The three layer canvases stay in three separate DOM elements rather than being
 * merged into one, because both chapters' timelines own `transform` on those
 * elements to drive the dive and the approach. That constraint is load-bearing:
 * see the scale tweens in WhySection and PricingSection.
 */

export interface StarFieldInstance {
  resize: () => void;
  destroy: () => void;
}

interface LayerSpec {
  /** One star per this many CSS px² of field. */
  area: number;
  max: number;
  /** Radius range in CSS px, before the magnitude curve. */
  size: [number, number];
  alpha: [number, number];
  /** Peak pointer-parallax offset, in CSS px. */
  parallax: number;
  /** Scintillation amplitude range. */
  twinkle: [number, number];
  /** Idle drift amplitude in CSS px — the field is never quite still. */
  drift: number;
  /** Glow radius as a multiple of the core radius. 0 draws a bare core. */
  glow: number;
  /** Fraction of the layer's stars bright enough to throw diffraction spikes. */
  spikes: number;
  /** Meteors only belong on the depth that is close enough to have them. */
  meteors: boolean;
}

/* Far is dense, tiny and dim; near is sparse, large and bright. The ratios
   between the three are what carry depth once the pointer starts moving them
   against each other. */
const LAYERS: LayerSpec[] = [
  {
    area: 3400,
    max: 560,
    size: [0.4, 1.05],
    alpha: [0.22, 0.6],
    parallax: 3,
    twinkle: [0.05, 0.18],
    drift: 0.5,
    glow: 0,
    spikes: 0,
    meteors: false,
  },
  {
    area: 9000,
    max: 260,
    size: [0.75, 1.7],
    alpha: [0.34, 0.82],
    parallax: 9,
    twinkle: [0.1, 0.3],
    drift: 1,
    glow: 2.6,
    spikes: 0.1,
    meteors: false,
  },
  {
    area: 26000,
    max: 110,
    size: [1.3, 2.9],
    alpha: [0.5, 1],
    parallax: 22,
    twinkle: [0.14, 0.4],
    drift: 1.7,
    glow: 3.6,
    spikes: 0.34,
    meteors: true,
  },
];

/* Roughly the visible spectral sequence, weighted the way a naked-eye sky is:
   mostly blue-white and white, a few warm ones. The two coolest are pulled
   toward the page's own palette rather than being physically exact — this is a
   sky in a chapter, and it has to sit under a cyan accent. */
const STAR_COLORS: [number, number, number][] = [
  [198, 219, 255],
  [232, 240, 255],
  [255, 255, 255],
  [255, 236, 208],
  [255, 209, 163],
];
const COLOR_WEIGHTS = [0.3, 0.28, 0.22, 0.14, 0.06];

const SIZE_BUCKETS = 4;

/** Deterministic PRNG, so the sky is the same one on every load and a resize
 *  remaps the stars it already has instead of dealing a new sky. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

interface Star {
  /** Normalised, so a resize is a remap rather than a reshuffle. */
  nx: number;
  ny: number;
  radius: number;
  alpha: number;
  colorIndex: number;
  bucket: number;
  /** Scintillation: two components at unrelated rates. */
  twAmp: number;
  twRate: number;
  twPhase: number;
  driftRate: number;
  driftPhase: number;
  spike: boolean;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  span: number;
  length: number;
}

interface Pulse {
  x: number;
  y: number;
  born: number;
}

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  spec: LayerSpec;
  pool: Star[];
  count: number;
  offsetX: number;
  offsetY: number;
  meteor: Meteor | null;
  nextMeteor: number;
}

/** Pre-rendered glow, one per (colour, size bucket). Shared across every field
 *  on the page — there are at most twenty of these and they never change. */
const spriteCache = new Map<string, HTMLCanvasElement>();

const glowSprite = (colorIndex: number, radius: number, dpr: number) => {
  const key = `${colorIndex}:${radius.toFixed(2)}:${dpr.toFixed(2)}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const [r, g, b] = STAR_COLORS[colorIndex];
  const size = Math.max(4, Math.ceil(radius * 2 * dpr));
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext("2d");
  if (sctx) {
    const mid = size / 2;
    const gradient = sctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    /* A tight white core inside a wide, fast-falling halo. The three inner
       stops are what stop it reading as a fuzzy blob: a star is a point with
       light around it, not a disc. */
    gradient.addColorStop(0, `rgba(255,255,255,0.95)`);
    gradient.addColorStop(0.12, `rgba(${r},${g},${b},0.85)`);
    gradient.addColorStop(0.34, `rgba(${r},${g},${b},0.28)`);
    gradient.addColorStop(0.62, `rgba(${r},${g},${b},0.07)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, size, size);
  }
  spriteCache.set(key, sprite);
  return sprite;
};

const pickColor = (rand: () => number) => {
  const roll = rand();
  let acc = 0;
  for (let i = 0; i < COLOR_WEIGHTS.length; i += 1) {
    acc += COLOR_WEIGHTS[i];
    if (roll <= acc) return i;
  }
  return COLOR_WEIGHTS.length - 1;
};

/* Pointer influence. Local and short-range on purpose: the field parts around
   the cursor and is untouched a hand's width away, which is what separates
   "matter" from "a hover state on the background". */
const ATTENTION_RADIUS = 170;
const ATTENTION_LIFT = 0.55;
const ATTENTION_SWELL = 0.5;
const ATTENTION_PUSH = 7;

const PULSE_MS = 1100;
const PULSE_REACH = 620;
const PULSE_WIDTH = 90;
const MAX_PULSES = 3;

export function createStarField(
  field: HTMLElement,
  canvases: HTMLCanvasElement[]
): StarFieldInstance {
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame: number | null = null;
  let resizeFrame: number | null = null;
  let offscreen = false;
  let hidden = document.visibilityState === "hidden";
  let reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const pulses: Pulse[] = [];
  const pointer = {
    active: false,
    x: 0,
    y: 0,
    smoothX: 0,
    smoothY: 0,
    /* Normalised -1..1 around the centre, smoothed, and what the parallax is
       driven from. */
    px: 0,
    py: 0,
    smoothPx: 0,
    smoothPy: 0,
  };

  const layers: Layer[] = canvases
    .map((canvas, index): Layer | null => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const spec = LAYERS[index] ?? LAYERS[LAYERS.length - 1];
      const rand = mulberry32(0x51f00d + index * 7919);
      const pool: Star[] = [];

      for (let i = 0; i < spec.max; i += 1) {
        /* Steep curve: most stars sit at the bottom of the brightness range,
           a few carry the frame. This one line is most of the realism. */
        const magnitude = Math.pow(rand(), 2.3);
        const colorIndex = pickColor(rand);
        const radius =
          spec.size[0] + (spec.size[1] - spec.size[0]) * magnitude;
        pool.push({
          nx: rand(),
          ny: rand(),
          radius,
          alpha: spec.alpha[0] + (spec.alpha[1] - spec.alpha[0]) * magnitude,
          colorIndex,
          bucket: Math.min(
            SIZE_BUCKETS - 1,
            Math.floor(magnitude * SIZE_BUCKETS)
          ),
          twAmp:
            spec.twinkle[0] + (spec.twinkle[1] - spec.twinkle[0]) * rand(),
          /* Unrelated rates per star, so nothing in the field ever comes into
             phase with anything else. */
          twRate: 0.35 + rand() * 1.5,
          twPhase: rand() * Math.PI * 2,
          driftRate: 0.06 + rand() * 0.14,
          driftPhase: rand() * Math.PI * 2,
          spike: rand() < spec.spikes && magnitude > 0.62,
        });
      }

      return {
        canvas,
        ctx,
        spec,
        pool,
        count: 0,
        offsetX: 0,
        offsetY: 0,
        meteor: null,
        /* Staggered from the outset so the first one is not always ten seconds
           in. */
        nextMeteor: performance.now() + 4000 + Math.random() * 14000,
      };
    })
    .filter((layer): layer is Layer => layer !== null);

  const rect = { left: 0, top: 0, dirty: true };
  const invalidateRect = () => {
    rect.dirty = true;
  };
  const readRect = () => {
    if (rect.dirty) {
      const box = field.getBoundingClientRect();
      rect.left = box.left;
      rect.top = box.top;
      rect.dirty = false;
    }
    return rect;
  };

  const measure = () => {
    const box = field.getBoundingClientRect();
    width = Math.max(1, Math.floor(box.width));
    height = Math.max(1, Math.floor(box.height));
    /* 1.75 rather than the usual 2: this is a field of soft points with no
       edges to alias, and the fill cost is the whole budget on a 3x phone. */
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    layers.forEach((layer) => {
      layer.canvas.width = Math.max(1, Math.round(width * dpr));
      layer.canvas.height = Math.max(1, Math.round(height * dpr));
      layer.canvas.style.width = "100%";
      layer.canvas.style.height = "100%";
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      /* Count follows area, so a phone gets a sky at the same density rather
         than the same number of stars spread thin. Taken off the front of a
         fixed pool: a resize adds or drops stars at the tail and never deals a
         different sky. */
      layer.count = Math.min(
        layer.spec.max,
        Math.max(24, Math.round((width * height) / layer.spec.area))
      );
    });

    rect.dirty = true;
  };

  const drawStar = (
    layer: Layer,
    star: Star,
    x: number,
    y: number,
    radius: number,
    alpha: number
  ) => {
    const ctx = layer.ctx;
    ctx.globalAlpha = clamp(alpha, 0, 1);

    if (layer.spec.glow > 0) {
      const bucketRadius =
        (layer.spec.size[0] +
          ((layer.spec.size[1] - layer.spec.size[0]) *
            (star.bucket + 0.5)) /
            SIZE_BUCKETS) *
        layer.spec.glow;
      const sprite = glowSprite(star.colorIndex, bucketRadius, dpr);
      /* The sprite is a bucket, the draw size is the star's own — so a hundred
         stars share four bitmaps and still come out at a hundred sizes. */
      const size = radius * layer.spec.glow * 2;
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);

      if (star.spike) {
        /* Diffraction spikes, four of them, only on the brightest few. This is
           the difference between a bright dot and something the eye reads as
           very far away and very luminous. */
        const reach = radius * 5.2;
        const [r, g, b] = STAR_COLORS[star.colorIndex];
        ctx.globalAlpha = clamp(alpha * 0.5, 0, 1);
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = Math.max(0.5, radius * 0.28);
        ctx.beginPath();
        ctx.moveTo(x - reach, y);
        ctx.lineTo(x + reach, y);
        ctx.moveTo(x, y - reach * 0.72);
        ctx.lineTo(x, y + reach * 0.72);
        ctx.stroke();
        ctx.globalAlpha = clamp(alpha, 0, 1);
      }
    }

    const [r, g, b] = STAR_COLORS[star.colorIndex];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    if (radius <= 0.75) {
      /* Under a pixel and a half, a rect is both cheaper and sharper than an
         arc — and the far layer is almost entirely made of these. */
      const d = Math.max(0.7, radius * 2);
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawMeteor = (layer: Layer, meteor: Meteor) => {
    const ctx = layer.ctx;
    const progress = meteor.life / meteor.span;
    /* In fast, out faster, and gone before it reaches the far edge — a meteor
       that fades out mid-flight is what one looks like. */
    const alpha = Math.sin(Math.PI * progress) * 0.9;
    if (alpha <= 0.01) return;

    const len = Math.hypot(meteor.vx, meteor.vy) || 1;
    const tailX = meteor.x - (meteor.vx / len) * meteor.length;
    const tailY = meteor.y - (meteor.vy / len) * meteor.length;
    const gradient = ctx.createLinearGradient(
      meteor.x,
      meteor.y,
      tailX,
      tailY
    );
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.35, `rgba(206,224,255,${alpha * 0.42})`);
    gradient.addColorStop(1, "rgba(206,224,255,0)");

    ctx.globalAlpha = 1;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(meteor.x, meteor.y);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(meteor.x, meteor.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  };

  const render = (now: number) => {
    const seconds = now * 0.001;

    if (!reducedMotion) {
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;
      /* Slower than the attention lag: parallax is the frame moving, and a
         frame that snaps to the cursor reads as a jitter rather than as depth. */
      pointer.smoothPx += (pointer.px - pointer.smoothPx) * 0.055;
      pointer.smoothPy += (pointer.py - pointer.smoothPy) * 0.055;
    }

    /* Retire spent pulses from the front — there are at most three. */
    while (pulses.length && now - pulses[0].born > PULSE_MS) pulses.shift();

    layers.forEach((layer) => {
      const ctx = layer.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      const spec = layer.spec;
      const ox = reducedMotion ? 0 : -pointer.smoothPx * spec.parallax;
      const oy = reducedMotion ? 0 : -pointer.smoothPy * spec.parallax;

      for (let i = 0; i < layer.count; i += 1) {
        const star = layer.pool[i];
        let x = star.nx * width + ox;
        let y = star.ny * height + oy;
        let radius = star.radius;
        let alpha = star.alpha;

        if (!reducedMotion) {
          /* Idle drift, so the field is alive with the pointer nowhere near
             it. Sub-pixel by design: it should read as air, not as movement. */
          x +=
            Math.sin(seconds * star.driftRate + star.driftPhase) * spec.drift;
          y +=
            Math.cos(seconds * star.driftRate * 0.82 + star.driftPhase) *
            spec.drift;

          /* Scintillation. Two components, so the field never pulses as one. */
          const tw =
            Math.sin(seconds * star.twRate + star.twPhase) * 0.62 +
            Math.sin(seconds * star.twRate * 1.73 + star.twPhase * 1.7) * 0.38;
          alpha *= 1 + tw * star.twAmp;

          if (pointer.active) {
            const dx = x - pointer.smoothX;
            const dy = y - pointer.smoothY;
            const distance = Math.hypot(dx, dy);
            if (distance < ATTENTION_RADIUS && distance > 0.001) {
              /* Squared falloff: a defined bright spot under the cursor rather
                 than a broad wash that follows it around. */
              const force = Math.pow(1 - distance / ATTENTION_RADIUS, 2);
              alpha += ATTENTION_LIFT * force;
              radius *= 1 + ATTENTION_SWELL * force;
              const push = (ATTENTION_PUSH * force * spec.parallax) / 22;
              x += (dx / distance) * push;
              y += (dy / distance) * push;
            }
          }

          /* Outside the `active` guard on purpose: a press is a pointer event
             of its own, and a tap on a touch screen produces no move to set the
             field's cursor state first. */
          if (pulses.length) {
            for (let p = 0; p < pulses.length; p += 1) {
              const pulse = pulses[p];
              const age = (now - pulse.born) / PULSE_MS;
              if (age < 0 || age > 1) continue;
              /* Decelerating ring, fading as it goes: a disturbance spending
                 itself, not a circle being drawn. */
              const ring = PULSE_REACH * (1 - Math.pow(1 - age, 2.2));
              const gap = Math.abs(
                Math.hypot(x - pulse.x, y - pulse.y) - ring
              );
              if (gap < PULSE_WIDTH) {
                alpha += (1 - gap / PULSE_WIDTH) * (1 - age) * 0.75;
              }
            }
          }
        }

        drawStar(layer, star, x, y, radius, alpha);
      }

      if (spec.meteors && !reducedMotion) {
        if (!layer.meteor && now >= layer.nextMeteor) {
          /* Shallow, downward, and always from somewhere off the left or the
             top — a meteor that starts inside the frame has no origin. */
          const fromTop = Math.random() < 0.55;
          const speed = 0.9 + Math.random() * 0.7;
          const angle = (18 + Math.random() * 26) * (Math.PI / 180);
          layer.meteor = {
            x: fromTop ? Math.random() * width * 0.7 : -40,
            y: fromTop ? -30 : Math.random() * height * 0.55,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0,
            span: 900 + Math.random() * 700,
            length: 90 + Math.random() * 120,
          };
        }

        const meteor = layer.meteor;
        if (meteor) {
          /* Advanced on the frame's own clock rather than on a delta, which is
             fine at this scale and keeps the loop free of dt bookkeeping: the
             streak is on screen for under a second. */
          meteor.life += 16.7;
          meteor.x += meteor.vx * 16.7;
          meteor.y += meteor.vy * 16.7;
          drawMeteor(layer, meteor);
          if (meteor.life >= meteor.span) {
            layer.meteor = null;
            layer.nextMeteor = now + 9000 + Math.random() * 22000;
          }
        }
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    });

    /* Asks whether it should still be running rather than assuming it is, so a
       single frame can be drawn on demand — after a resize, say — without
       starting a loop nobody asked for. */
    frame = shouldRun() ? window.requestAnimationFrame(render) : null;
  };

  function shouldRun() {
    return !reducedMotion && !offscreen && !hidden;
  }

  const start = () => {
    if (frame === null && shouldRun()) {
      frame = window.requestAnimationFrame(render);
    }
  };

  const stop = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const sync = () => {
    if (shouldRun()) start();
    else stop();
  };

  /* One frame, now, whatever the loop is doing.
   *
   * The reason this exists is a race that leaves the sky blank: setting a
   * canvas' width clears it, so any re-measure hands back three empty layers —
   * and if the field goes off screen in the same tick (scrolling out of the
   * chapter re-measures *and* trips the IntersectionObserver) the loop is
   * stopped before it ever redraws them. The reader then scrolls back to a
   * starless sky. Cancelling first is what keeps this from forking a second
   * loop when one is already running. */
  const drawOnce = () => {
    stop();
    render(performance.now());
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (reducedMotion) return;
    const box = readRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    pointer.x = x;
    pointer.y = y;
    pointer.px = clamp((x / Math.max(1, width)) * 2 - 1, -1, 1);
    pointer.py = clamp((y / Math.max(1, height)) * 2 - 1, -1, 1);
    pointer.active = true;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (reducedMotion || offscreen) return;
    const box = readRect();
    if (pulses.length >= MAX_PULSES) pulses.shift();
    pulses.push({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      born: performance.now(),
    });
  };

  const handlePointerLeave = () => {
    pointer.active = false;
  };

  const handleVisibility = () => {
    hidden = document.visibilityState === "hidden";
    sync();
  };

  const queueResize = () => {
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null;
      measure();
      drawOnce();
    });
  };

  const reduceQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const handleReduceChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    if (reducedMotion) {
      pointer.active = false;
      pointer.smoothPx = 0;
      pointer.smoothPy = 0;
    }
    /* Either way the field has to be repainted: switching the preference on
       parks the stars where they are, switching it off has to un-park them. */
    drawOnce();
  };

  measure();
  /* One frame up front, whether or not the loop is going to run: the sky has to
     be there the moment the section is scrolled into, and a field that is only
     drawn once the IntersectionObserver has fired arrives a frame late. */
  drawOnce();

  /* At most one of the two fields on this page is ever in frame, and neither is
     ever the thing the reader is looking at while the other is. */
  const io = new IntersectionObserver(
    (entries) => {
      offscreen = !entries.some((entry) => entry.isIntersecting);
      sync();
    },
    { rootMargin: "12% 0px" }
  );
  io.observe(field);

  const ro = new ResizeObserver(queueResize);
  ro.observe(field);

  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  window.addEventListener("pointerdown", handlePointerDown, { passive: true });
  document.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("scroll", invalidateRect, {
    passive: true,
    capture: true,
  });
  window.addEventListener("resize", invalidateRect);
  document.addEventListener("visibilitychange", handleVisibility);
  reduceQuery?.addEventListener("change", handleReduceChange);

  sync();

  return {
    resize: queueResize,
    destroy: () => {
      stop();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("scroll", invalidateRect, { capture: true });
      window.removeEventListener("resize", invalidateRect);
      document.removeEventListener("visibilitychange", handleVisibility);
      reduceQuery?.removeEventListener("change", handleReduceChange);
    },
  };
}
