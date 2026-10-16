/* ---------------------------------------------------------------------- */
/* renderQuality — one quality tier for every layer on the page            */
/* ---------------------------------------------------------------------- */

/* The page runs six live WebGL contexts (the hero's fog, the features mist
 * curtain, the feature story's stage, and the Why chapter's board, shatter pass
 * and pawn) plus several 2D canvases. Each of those used to decide its own
 * resolution, and four of the six did not decide anything at all — they clamped
 * `devicePixelRatio` to a hardcoded 2 regardless of what the machine could
 * actually push. On a four-core laptop with an integrated GPU that is six
 * full-viewport buffers at 2x, which is the page's whole frame budget spent on
 * samples nobody asked for.
 *
 * This module is the single answer to "how hard should this machine be pushed".
 * The heuristic itself is lifted from chessScene's `detectQuality`, which was
 * the only layer that had one, so the board's behaviour is unchanged on any
 * given machine; what changes is that the other layers now agree with it
 * instead of ignoring the question.
 *
 * ── Why the tier is page-wide and not per-layer ────────────────────────────
 *
 * chessScene measured its own container. That is the right input for "how much
 * detail does this element deserve" and the wrong one for "how much can this
 * GPU do", because the thing being rationed is one shared device pushing six
 * canvases. A small board on a struggling machine is still on a struggling
 * machine. So the input here is the viewport, and the answer is computed once.
 *
 * ── Why it is decided once and never revisited ─────────────────────────────
 *
 * Deliberately not reactive. The tier feeds `new WebGLRenderer({ antialias })`,
 * which is fixed at construction — changing it later means tearing down a
 * context and recompiling every shader in that layer, and doing that in
 * response to a window resize would stutter far worse than the tier it was
 * correcting for. Rotating a phone does not change what its GPU can do.
 */

export type QualityTier = "low" | "medium" | "high";

export interface QualitySettings {
  tier: QualityTier;
  /**
   * Ceiling for `devicePixelRatio`. Note what a cap below the display's own
   * density actually buys: the canvas is stretched over its CSS box either way,
   * so a cap does not make the picture smaller, it makes it *softer*. That is a
   * real cost and the reason `high` stays at 2 — it is a trade worth making only
   * once the alternative is dropped frames.
   */
  dprCap: number;
  /**
   * MSAA on the default framebuffer. Off at the low tier: a full-viewport
   * multisampled buffer is 4x the memory and costs a resolve blit every frame,
   * which is the single most expensive thing a weak GPU is asked for here.
   */
  antialias: boolean;
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  /* Two cores or an explicit data-saver request. Soft but smooth: at this tier
     the page has already lost the argument about fidelity. */
  low: { tier: "low", dprCap: 1.25, antialias: false },
  /* Four cores, or a frame large enough that area alone is the problem — a
     4K-ish viewport asks for 4x the fill of a laptop at the same dpr. */
  medium: { tier: "medium", dprCap: 1.5, antialias: true },
  /* Unchanged from what every layer did before this module existed. */
  high: { tier: "high", dprCap: 2, antialias: true },
};

/** `navigator.connection` is not in the DOM lib and not on every browser. */
function prefersReducedData(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true;
}

function detect(): QualitySettings {
  /* Data-saver is an explicit request from the reader rather than a guess about
     their hardware, so it outranks the measurements below. */
  if (prefersReducedData()) return SETTINGS.low;

  const cores = navigator.hardwareConcurrency ?? 4;

  /* Viewport area in **CSS pixels**, not device pixels. Multiplying by dpr²
     here is a trap the board fell into once and the comment it left is worth
     repeating: it reads a dense display as a large one and pushes it down a
     tier, and the tier below caps dpr harder — so a 2x phone ends up with a
     1.25x buffer stretched across it, which looks like a blurry render rather
     than a cheap one. How much work a frame is worth is a question about the
     layout; how many samples that work is drawn at is `dprCap`, decided
     separately and applied after. */
  const pixels = window.innerWidth * window.innerHeight;

  if (cores <= 2) return SETTINGS.low;

  /* The area rule is only a backstop, and it is worth being clear about what for.
     Anything with a weak CPU is already caught by the core count above, so what
     is left is the strong-machine-enormous-frame case: six full-viewport passes
     is a lot of pixels however many cores are behind them. It should therefore
     trip on 4K-class frames and nothing smaller.
     
     6e6, not the 3.4e6 this heuristic used to carry. That number was written
     against a single element's box; reused against the viewport it means
     something far stricter than intended, and it pushed every 1440p desktop
     (3.69M CSS px) down a tier no matter how capable — including a 16-core
     machine, which is precisely the hardware that should get the top tier.
     
     Where 6e6 falls: 1080p 2.07M, 1440p 3.69M and 3440x1440 ultrawide 4.95M all
     stay high; 4K 8.29M steps down. Ultrawide is closer to 1440p than to 4K, so
     it belongs on the high side of the line. */
  if (cores <= 4 || pixels > 6e6) return SETTINGS.medium;
  return SETTINGS.high;
}

let cached: QualitySettings | null = null;

/** The page's quality tier. Computed on first call, then fixed. */
export function renderQuality(): QualitySettings {
  cached ??= detect();
  return cached;
}

/**
 * This machine's usable pixel ratio — `devicePixelRatio` under the tier's cap.
 *
 * Read at call time rather than cached, because `devicePixelRatio` genuinely
 * does change during a session (dragging a window between monitors, browser
 * zoom) and every caller already re-reads it from inside a resize handler.
 */
export function qualityPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, renderQuality().dprCap);
}
