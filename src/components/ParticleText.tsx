import {
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type Ref,
} from "react";
import { createRectCache } from "./rectCache";
import { qualityPixelRatio } from "./renderQuality";
import useNearViewport from "./useNearViewport";
import "./ParticleText.css";

/* ---------------------------------------------------------------------- */
/* ParticleText — vendored from React Bits                                 */
/* ---------------------------------------------------------------------- */

/* The string is drawn once into an offscreen canvas, sampled on a pixel grid,
 * and every opaque sample becomes a particle that flies in from a scattered
 * start to its place in the glyph. It replaces the Why chapter's per-glyph
 * headline entirely: the chapter now asks its question in a field of particles
 * that the reader can push around, and that blows away down the tunnel when the
 * descent starts.
 *
 * Three changes from the published source:
 *
 *   - `handleRef` exposes `disperse()` and `gather()`. As published the
 *     scatter-and-reform can only be replayed by `trigger: "hover" | "click"`,
 *     and there is no way to take the text *away* at all. The chapter needs the
 *     title to leave on a scroll position, once, and to come back if the reader
 *     scrolls up — so the field gained a real exit (particles thrown outward,
 *     fading, then the loop parks itself) and both directions are callable.
 *   - Pointer tracking moved from the canvas to the window. The title sits in a
 *     `pointer-events: none` layer above the shatter effect, which owns the
 *     pointer for this section; listening on the canvas would mean either
 *     swallowing those events or never receiving any. Window-level also means
 *     the particles start parting as the cursor approaches rather than the
 *     instant it crosses the canvas edge.
 *   - `trigger` is gone with the canvas listeners it depended on, and
 *     `particleBudget` is exposed: the upstream cap of 5200 particles is sized
 *     for a 360px-tall demo box, and this canvas is the full viewport.
 */

export interface ParticleTextHandle {
  /** Throw the field outward and fade it out. No-op under reduced motion. */
  disperse: (duration?: number) => void;
  /**
   * Bring it back from a scattered start.
   *
   * Idempotent: a field that is already assembled, or already assembling, is
   * left alone. Both chapters that use this call it from a ScrollTrigger which
   * can fire more than once for the same arrival (onEnter, onEnterBack, and a
   * refresh while active all mean "the title should be up"), and a second
   * assembly on top of a finished one reads as the word blowing apart for no
   * reason — which is precisely the bug this guard exists to stop. Safe to call
   * before the field has measured itself: the request is queued and runs as
   * soon as there are particles to move.
   */
  gather: () => void;
}

export interface ParticleTextProps {
  text?: string;
  particleSize?: number;
  density?: number;
  color?: string;
  highlightColor?: string;
  scatter?: number;
  /**
   * How far the throw carries, if it should not be as far as `scatter`.
   *
   * These were one number and they cannot be, because the entrance and the exit
   * are constrained by different things. The entrance only has to *start* off
   * the letterforms, and any particle whose start position is off the canvas
   * simply flies in from the edge — nothing is lost. The exit has to stay on the
   * canvas to be seen at all: a particle outside it is not drawn, so a throw
   * that reaches further than the box does not read as a scatter, it reads as
   * the word thinning out and blinking off along a straight edge.
   *
   * And the throw reaches a long way — `scatter × (1.8 … 3.4)` by depth, so a
   * scatter tuned to give a headline a decent fly-in puts the exit three to four
   * times the box's half-height away. Worse, position runs on `easeOutCubic`
   * while alpha runs on `1 − p²`: a particle is 87% of the way out while still
   * at three-quarters opacity, so it crosses the edge at very nearly full
   * brightness. Every part of the exit a reader can see happens in the first
   * third of its travel.
   *
   * Defaults to `scatter`, so a caller that has room (or does not throw the
   * field away at all) is unaffected.
   */
  exitScatter?: number;
  gatherDuration?: number;
  stagger?: number;
  pointerRepel?: number;
  repelRadius?: number;
  idleDrift?: number;
  fontSize?: number | string;
  fontWeight?: number | string;
  fontFamily?: string;
  /** Canvas shadow bloom. Costly at this particle count — see the note below. */
  glow?: boolean;
  /** Upper bound on particle count. */
  particleBudget?: number;
  /**
   * Assemble as soon as the field has measured itself.
   *
   * True keeps the published behaviour — mount, sample, fly in. Both chapters
   * here pass false, because their assembly is an event on the page: the title
   * has to be written as the reader arrives at it, and a field that assembles on
   * mount has spent its one entrance four screens above the section it belongs
   * to, off screen, where nobody sees it. Worse, it then has to be scattered
   * again to play the entrance the reader *is* looking at. False leaves the
   * canvas empty until `gather()` is called.
   */
  autoStart?: boolean;
  className?: string;
  style?: CSSProperties;
  handleRef?: Ref<ParticleTextHandle>;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Particle {
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  exitX: number;
  exitY: number;
  size: number;
  color: string;
  seed: number;
  depth: number;
  delay: number;
}

type Mode = "gathering" | "idle" | "dispersing" | "hidden";

const hexToRgb = (hex: string): Rgb | null => {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  r: Math.round(from.r + (to.r - from.r) * amount),
  g: Math.round(from.g + (to.g - from.g) * amount),
  b: Math.round(from.b + (to.b - from.b) * amount),
});

const rgbToCss = (rgb: Rgb) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const resolveFontSize = (
  value: number | string,
  container: HTMLElement,
  fontWeight: number | string,
  fontFamily: string
) => {
  if (typeof value === "number") return value;

  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.fontSize = value;
  probe.style.fontWeight = String(fontWeight);
  probe.style.fontFamily = fontFamily;
  container.appendChild(probe);
  const size = parseFloat(window.getComputedStyle(probe).fontSize) || 96;
  probe.remove();
  return size;
};

const waitForFonts = async (font: string) => {
  if (!("fonts" in document)) return;
  try {
    await document.fonts.load(font);
  } catch {
    /* A face that refuses to load is a fallback metric, not a failure. */
  }
  await document.fonts.ready;
};

export default function ParticleText({
  text = "React Bits",
  particleSize = 2,
  density = 4,
  color = "#ffffff",
  highlightColor = "#8b5cf6",
  scatter = 180,
  exitScatter,
  gatherDuration = 1600,
  stagger = 420,
  pointerRepel = 40,
  repelRadius = 120,
  idleDrift = 0.7,
  fontSize = "clamp(3rem, 12vw, 8rem)",
  fontWeight = 800,
  fontFamily = "inherit",
  glow = true,
  particleBudget = 5200,
  autoStart = true,
  className = "",
  style,
  handleRef,
}: ParticleTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /* The imperative surface is created inside the effect below, where the
     particle array lives, and published here so useImperativeHandle can hand
     it out without the effect having to re-run. */
  const apiRef = useRef<ParticleTextHandle | null>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      disperse: (duration?: number) => apiRef.current?.disperse(duration),
      gather: () => apiRef.current?.gather(),
    }),
    []
  );

  /* A viewport-sized 2D buffer and a few thousand particles sampled off a
     glyph raster, 18,000px down the page. Held back until the pricing chapter is
     approaching — see useNearViewport. */
  const near = useNearViewport(containerRef);

  useEffect(() => {
    if (!near) return undefined;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let particles: Particle[] = [];
    let animationFrame: number | null = null;
    let resizeFrame: number | null = null;
    let buildId = 0;
    /* "hidden" is the parked state — nothing drawn, loop stopped — which is
       exactly the right starting point for a field whose entrance belongs to a
       scroll position rather than to mount. */
    let mode: Mode = autoStart ? "gathering" : "hidden";
    /* A gather asked for before the first sample finished. The chapters fire
       theirs from a ScrollTrigger that can be created and evaluated before the
       webfont the glyphs are sampled from has landed. */
    let pendingGather = false;
    let phaseStart = 0;
    let exitDuration = 1600;
    let reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const pointer = {
      active: false,
      x: 0,
      y: 0,
      smoothX: 0,
      smoothY: 0,
    };

    const rect = createRectCache(canvas);

    const startGather = (fromScatter = true) => {
      if (!particles.length) return;
      const spread = reducedMotion ? 0 : scatter;

      particles.forEach((particle) => {
        if (fromScatter) {
          const angle = particle.seed * Math.PI * 2;
          const distance = spread * (0.35 + particle.depth * 0.75);
          particle.x =
            particle.targetX +
            Math.cos(angle) * distance +
            (particle.depth - 0.5) * spread * 0.55;
          particle.y =
            particle.targetY +
            Math.sin(angle) * distance +
            (particle.seed - 0.5) * spread * 0.55;
        }

        particle.startX = particle.x;
        particle.startY = particle.y;
        particle.delay = reducedMotion ? 0 : particle.seed * stagger;
      });

      phaseStart = performance.now();
      mode = "gathering";
      ensureRenderLoop();
    };

    /* The exit. Every particle is thrown along its own seeded heading — away
       from the middle of the field rather than radially from its glyph, so the
       whole line reads as being pulled apart down the tunnel rather than each
       letter bursting on the spot — and fades as it goes. Position eases out
       (fast off the mark, drifting at the end) while alpha accelerates away,
       which is the "enter decelerates, exit accelerates" rule applied to the
       two channels separately: the field is gone before the last particles have
       stopped moving. */
    const startDisperse = (duration?: number) => {
      if (reducedMotion || !particles.length) return;
      if (mode === "dispersing" || mode === "hidden") return;
      exitDuration = Math.max(200, duration ?? 1600);

      /* See the prop's note: the throw is measured separately from the entrance
         because it is the one direction that has to finish inside the canvas. */
      const throwScatter = exitScatter ?? scatter;

      particles.forEach((particle) => {
        const angle = particle.seed * Math.PI * 2;
        const bias = (particle.targetX - width / 2) / Math.max(1, width / 2);
        const reach = throwScatter * (1.8 + particle.depth * 1.6);
        particle.startX = particle.x;
        particle.startY = particle.y;
        particle.exitX =
          particle.x + Math.cos(angle) * reach + bias * throwScatter * 1.4;
        particle.exitY =
          particle.y + Math.sin(angle) * reach - reach * 0.15;
        particle.delay = particle.seed * exitDuration * 0.35;
      });

      phaseStart = performance.now();
      mode = "dispersing";
      ensureRenderLoop();
    };

    /* See the note on the handle. Assembled or assembling is already the
       requested state, so the request is dropped rather than replayed. */
    const requestGather = () => {
      if (mode === "gathering" || mode === "idle") return;
      if (!particles.length) {
        pendingGather = true;
        return;
      }
      startGather(true);
    };

    apiRef.current = {
      disperse: startDisperse,
      gather: requestGather,
    };

    const drawParticle = (particle: Particle) => {
      const size = particle.size;
      ctx.fillStyle = particle.color;

      if (size <= 2.1) {
        ctx.fillRect(
          particle.x - size / 2,
          particle.y - size / 2,
          size,
          size
        );
        return;
      }

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    };

    const render = (now: number) => {
      /* Checked here as well as in ensureRenderLoop: a frame can already be
         queued when the field scrolls out of view or the tab is hidden. */
      if (!canRun()) {
        animationFrame = null;
        return;
      }

      if (mode === "hidden") {
        /* Cleared before bailing rather than at the top of every frame: an
           unconditional full-canvas clearRect ran even on the frames that
           immediately returned, which a window-level pointermove could
           trigger from anywhere on the page. */
        ctx.clearRect(0, 0, width, height);
        animationFrame = null;
        return;
      }

      ctx.clearRect(0, 0, width, height);

      /* Per-draw shadow blur is the single most expensive thing this component
         can do — at a few thousand particles it is the frame budget — so it is
         opt-in. Callers that want bloom should prefer a compositor filter on
         the canvas element itself instead. */
      if (glow && !reducedMotion) {
        ctx.shadowBlur = particleSize * 3;
        ctx.shadowColor = highlightColor;
      } else {
        ctx.shadowBlur = 0;
      }

      /* Two lags stack on this interaction — the cursor is smoothed into
         `smooth*` here, and each particle then eases toward the position that
         smoothed cursor implies (`follow`, below). At the published 0.18/0.22
         the compound delay was around 150ms, which reads as the field noticing
         the cursor a moment after it has gone past. Raised on both so the hole
         tracks the pointer; still eased, so the field has weight. */
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.34;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.34;

      let complete = true;

      particles.forEach((particle) => {
        let baseX = particle.targetX;
        let baseY = particle.targetY;
        let alpha = 1;

        if (mode === "dispersing") {
          const local = (now - phaseStart - particle.delay) / exitDuration;
          const progress = clamp(local, 0, 1);
          const eased = easeOutCubic(progress);
          baseX = particle.startX + (particle.exitX - particle.startX) * eased;
          baseY = particle.startY + (particle.exitY - particle.startY) * eased;
          alpha = 1 - progress * progress;
          if (progress < 1) complete = false;
        } else if (mode === "gathering") {
          const local =
            (now - phaseStart - particle.delay) /
            Math.max(1, reducedMotion ? 1 : gatherDuration);
          const progress = clamp(local, 0, 1);
          const eased = easeOutCubic(progress);
          baseX = particle.startX + (particle.targetX - particle.startX) * eased;
          baseY = particle.startY + (particle.targetY - particle.startY) * eased;
          alpha = clamp(0.35 + progress * 0.65, 0, 1);
          if (progress < 1) complete = false;
        } else if (!reducedMotion && idleDrift > 0) {
          const driftTime = now * 0.001;
          baseX +=
            Math.sin(driftTime * 0.9 + particle.seed * 10) *
            idleDrift *
            particle.depth;
          baseY +=
            Math.cos(driftTime * 0.75 + particle.depth * 10) *
            idleDrift *
            particle.depth;
        }

        /* No pointer repulsion on the way out: the field is leaving, and a
           cursor still carving a hole in it reads as the exit stalling. */
        if (
          pointer.active &&
          mode !== "dispersing" &&
          !reducedMotion &&
          pointerRepel > 0 &&
          repelRadius > 0
        ) {
          const dx = baseX - pointer.smoothX;
          const dy = baseY - pointer.smoothY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < repelRadius) {
            const force =
              Math.pow(1 - distance / repelRadius, 2) * pointerRepel;
            baseX += (dx / distance) * force;
            baseY += (dy / distance) * force;
          }
        }

        /* See the note on the pointer smoothing above: this is the second half
           of the same lag. 0.36 settles in ~6 frames instead of ~12, which is
           the difference between the field parting around the cursor and the
           field catching up with it. */
        const follow = reducedMotion || mode === "dispersing" ? 1 : 0.36;
        particle.x += (baseX - particle.x) * follow;
        particle.y += (baseY - particle.y) * follow;

        ctx.globalAlpha = alpha;
        drawParticle(particle);
      });

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      if (complete) {
        if (mode === "gathering") mode = "idle";
        else if (mode === "dispersing") {
          /* Parked: nothing left to draw, so the loop stops rather than
             clearing an empty canvas sixty times a second for the rest of the
             descent. */
          mode = "hidden";
          ctx.clearRect(0, 0, width, height);
          animationFrame = null;
          return;
        }
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    /* ── When the loop is allowed to run ──────────────────────────────────
       In `idle` mode with `idleDrift > 0` the field never completes, so the
       loop re-arms itself forever. That was fine on the assumption that the
       consumer disperses the field on the way past — but the pricing chapter
       only does that above 1140px, so on every phone the reader would reach
       the heading, the word would assemble, and a full particle pass plus two
       stacked compositor blurs would then run at display rate for the rest of
       the session: through every other section, and in a background tab.

       Two gates fix it, and they are the same two the star field already has:
       don't run while off screen, and don't run while the tab is hidden. */
    let offscreen = false;
    let pageHidden = document.hidden;
    const canRun = () => !offscreen && !pageHidden;

    function ensureRenderLoop() {
      if (animationFrame === null && canRun()) {
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    function stopRenderLoop() {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    }

    const sampleText = async () => {
      const currentBuild = ++buildId;
      const box = container.getBoundingClientRect();
      width = Math.floor(box.width);
      height = Math.floor(box.height);

      if (width <= 0 || height <= 0) return;

      dpr = qualityPixelRatio();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const computed = window.getComputedStyle(container);
      const resolvedFamily =
        fontFamily === "inherit"
          ? computed.fontFamily || "sans-serif"
          : fontFamily;
      let resolvedSize = resolveFontSize(
        fontSize,
        container,
        fontWeight,
        resolvedFamily
      );
      let font = `${fontWeight} ${resolvedSize}px ${resolvedFamily}`;

      await waitForFonts(font);
      if (currentBuild !== buildId) return;

      const offscreen = document.createElement("canvas");
      const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;

      const content = String(text || " ");
      const maxTextWidth = width * 0.92;
      offCtx.font = font;
      let metrics = offCtx.measureText(content);
      const measuredWidth = Math.max(1, metrics.width);
      if (measuredWidth > maxTextWidth) {
        resolvedSize = Math.max(
          18,
          resolvedSize * (maxTextWidth / measuredWidth)
        );
        font = `${fontWeight} ${resolvedSize}px ${resolvedFamily}`;
        await waitForFonts(font);
        if (currentBuild !== buildId) return;
        offCtx.font = font;
        metrics = offCtx.measureText(content);
      }

      const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
      const right = Math.ceil(
        metrics.actualBoundingBoxRight || metrics.width
      );
      const ascent = Math.ceil(
        metrics.actualBoundingBoxAscent || resolvedSize * 0.78
      );
      const descent = Math.ceil(
        metrics.actualBoundingBoxDescent || resolvedSize * 0.22
      );
      const padding = Math.max(12, Math.ceil(resolvedSize * 0.08));
      const textWidth = Math.max(1, left + right);
      const textHeight = Math.max(1, ascent + descent);

      offscreen.width = textWidth + padding * 2;
      offscreen.height = textHeight + padding * 2;
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      offCtx.font = font;
      offCtx.textAlign = "left";
      offCtx.textBaseline = "alphabetic";
      offCtx.fillStyle = "#ffffff";
      offCtx.fillText(content, padding - left, padding + ascent);

      const imageData = offCtx.getImageData(
        0,
        0,
        offscreen.width,
        offscreen.height
      );
      const targets: { x: number; y: number; alpha: number }[] = [];
      const step = Math.max(2, Math.floor(density));

      for (let y = 0; y < offscreen.height; y += step) {
        for (let x = 0; x < offscreen.width; x += step) {
          const alpha = imageData.data[(y * offscreen.width + x) * 4 + 3];
          if (alpha > 40) {
            targets.push({
              x: width / 2 - offscreen.width / 2 + x,
              y: height / 2 - offscreen.height / 2 + y,
              alpha: alpha / 255,
            });
          }
        }
      }

      const maxParticles = Math.max(
        600,
        Math.min(particleBudget, Math.floor((width * height) / 90))
      );
      const stride = Math.max(1, Math.ceil(targets.length / maxParticles));
      const baseRgb = hexToRgb(color);
      const highlightRgb = hexToRgb(highlightColor);
      const selected = targets.filter((_, index) => index % stride === 0);

      particles = selected.map((target, index) => {
        const seed = ((index * 9301 + 49297) % 233280) / 233280;
        const depth = 0.45 + (((index * 233 + 97) % 1000) / 1000) * 0.9;
        const blend =
          baseRgb && highlightRgb
            ? clamp(target.x / Math.max(1, width) + (seed - 0.5) * 0.35, 0, 1)
            : 0;
        const particleColor =
          baseRgb && highlightRgb
            ? rgbToCss(mixRgb(baseRgb, highlightRgb, blend))
            : color;
        const angle = seed * Math.PI * 2;
        const distance = (reducedMotion ? 0 : scatter) * (0.35 + depth * 0.75);
        const startX =
          target.x + Math.cos(angle) * distance + (seed - 0.5) * scatter * 0.45;
        const startY =
          target.y +
          Math.sin(angle) * distance +
          (depth - 0.9) * scatter * 0.45;

        return {
          x: reducedMotion ? target.x : startX,
          y: reducedMotion ? target.y : startY,
          startX,
          startY,
          targetX: target.x,
          targetY: target.y,
          exitX: target.x,
          exitY: target.y,
          size: Math.max(0.6, particleSize * (0.75 + target.alpha * 0.45)),
          color: particleColor,
          seed,
          depth,
          delay: seed * stagger,
        };
      });

      pointer.x = width / 2;
      pointer.y = height / 2;
      pointer.smoothX = pointer.x;
      pointer.smoothY = pointer.y;

      const snapToTargets = () => {
        particles.forEach((particle) => {
          particle.x = particle.targetX;
          particle.y = particle.targetY;
          particle.startX = particle.targetX;
          particle.startY = particle.targetY;
          particle.delay = 0;
        });
      };

      if (reducedMotion) {
        pendingGather = false;
        snapToTargets();
        mode = "idle";
      } else if (pendingGather) {
        /* Asked to assemble before there was anything to assemble. The fresh
           particles are already sitting on their scattered starts, so this
           gathers from where they are rather than re-scattering them. */
        pendingGather = false;
        startGather(false);
      } else if (mode === "hidden") {
        /* Either parked before its entrance, or re-measured while dispersed — a
           resize mid-descent. Both want an empty canvas: the field's entrance
           is a scroll event, and a title the reader has already scrolled past
           must not snap back. */
        ctx.clearRect(0, 0, width, height);
      } else if (mode === "idle") {
        /* Re-measured while the word was up. It stays up, in place. Anything
           else means every resize — and a pin engaging counts as one, since it
           changes the stage's box — replays the entrance in the middle of the
           frame the reader is reading. */
        snapToTargets();
      } else {
        startGather(false);
      }

      ensureRenderLoop();
    };

    const queueSample = () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        void sampleText();
      });
    };

    /* Window-level, and mapped through the cached rect: the title layer does
       not take pointer events (the shatter effect underneath owns them), and
       the particles should start parting as the cursor approaches rather than
       when it crosses an edge. */
    const handlePointerMove = (event: PointerEvent) => {
      const box = rect.current;
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.active = true;
      if (mode === "idle") ensureRenderLoop();
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    const reduceMotionQuery = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    );
    const handleReduceMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      void sampleText();
    };

    reduceMotionQuery?.addEventListener("change", handleReduceMotionChange);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.addEventListener("pointerleave", handlePointerLeave);

    /* A margin so the field is already running by the time it is actually
       visible — resuming exactly on the boundary would show one unanimated
       frame during a fast scroll. */
    const visibility = new IntersectionObserver(
      ([entry]) => {
        offscreen = !entry.isIntersecting;
        if (offscreen) stopRenderLoop();
        else if (mode !== "hidden") ensureRenderLoop();
      },
      { rootMargin: "15% 0px" }
    );
    visibility.observe(container);

    const handleVisibilityChange = () => {
      pageHidden = document.hidden;
      if (pageHidden) stopRenderLoop();
      else if (mode !== "hidden") ensureRenderLoop();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const resizeObserver = new ResizeObserver(queueSample);
    resizeObserver.observe(container);
    void sampleText();

    return () => {
      buildId += 1;
      apiRef.current = null;
      rect.destroy();
      resizeObserver.disconnect();
      visibility.disconnect();
      reduceMotionQuery?.removeEventListener(
        "change",
        handleReduceMotionChange
      );
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [
    near,
    text,
    particleSize,
    density,
    color,
    highlightColor,
    scatter,
    exitScatter,
    gatherDuration,
    stagger,
    pointerRepel,
    repelRadius,
    idleDrift,
    fontSize,
    fontWeight,
    fontFamily,
    glow,
    particleBudget,
    autoStart,
  ]);

  return (
    <div
      ref={containerRef}
      className={`particle-text ${className}`.trim()}
      style={style}
    >
      <canvas ref={canvasRef} className="particle-text__canvas" aria-hidden />
      <span className="particle-text__sr">{text}</span>
    </div>
  );
}
