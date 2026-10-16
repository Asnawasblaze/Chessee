/* ---------------------------------------------------------------------- */
/* fpsGovernor — a decoupled, opt-in step-down for live quality knobs      */
/* ---------------------------------------------------------------------- */

/* renderQuality.ts is deliberately static: cores, viewport area and
 * `saveData`, decided once and never revisited, because the settings it
 * feeds (antialias, the pixel-ratio cap) are fixed at `WebGLRenderer`
 * construction and changing them mid-session means tearing a context down
 * and recompiling every shader in it — a stutter far worse than the tier it
 * would be correcting for.
 *
 * That reasoning does not apply to every knob on the page. Clouds already
 * exposes `fps`/`quality`/`maxFieldPixels` as live options a caller can
 * change any time via `setOptions` — no context rebuild, no shader
 * recompile, just a different number read on the next frame — and Shatter
 * exposes `tileSize`/`refraction` the same way. Those are exactly the case
 * renderQuality's own tradeoff doesn't cover: a machine that *looks* capable
 * from the static signals (plenty of cores, a modest viewport) but isn't
 * actually keeping up in practice — a throttled or shared integrated GPU, a
 * background process eating the frame budget, a VM. Static detection has no
 * way to see that; only measuring actual frame time does.
 *
 * This module is that measurement, kept deliberately small and deliberately
 * separate from renderQuality: it never touches antialias or the DPR cap,
 * it has no opinion about WebGLRenderer construction, and it is entirely
 * optional — an engine that never calls `sample()` behaves exactly as it did
 * before this module existed.
 *
 * ── Shape of the decision ────────────────────────────────────────────────
 *
 *   - A grace period at the start of every render loop's life, so a load-time
 *     hitch (shader compile, texture upload, GC from everything else the
 *     page just built) cannot be mistaken for a sustained problem.
 *   - After that, a rolling average over a window of frames — a single slow
 *     frame is not a verdict, a sustained run of them is.
 *   - One step down, not a continuous slider. Landing on a single lower
 *     rung and staying there is a decision a caller can act on (swap in a
 *     cheaper set of option values); a number that drifts every frame is not
 *     — it would mean re-diffing and re-uploading options continuously,
 *     which is itself real work, on the exact machine least able to spare
 *     it.
 *   - No automatic recovery within a governor's lifetime. Stepping back up
 *     the moment frame time looks better for a window risks oscillating
 *     around the threshold on a machine that is marginal rather than
 *     failing, which would mean the visible quality changing back and forth
 *     under the reader's eyes — worse than staying at the lower rung. A
 *     caller that wants a fresh read (after a resize, or a chapter the
 *     reader has scrolled back into after a long absence) creates a new
 *     governor via `reset()`.
 */

export interface FpsGovernorOptions {
  /** Frames to ignore before sampling begins. */
  graceFrames?: number;
  /** Frames the rolling average is computed over. */
  windowFrames?: number;
  /** Average FPS below which, sustained for a full window, triggers a
   *  step down. */
  threshold?: number;
}

export interface FpsGovernor {
  /**
   * Feed one frame's timestamp in. Returns `true` the one time this frame is
   * what tips the governor into the degraded state — a caller uses that
   * edge to swap its option values once, rather than checking `degraded`
   * unconditionally every frame.
   */
  sample: (now: number) => boolean;
  /** Whether the governor has already stepped down. */
  readonly degraded: boolean;
  /** Starts over: clears the degraded flag and the sampling window. */
  reset: () => void;
}

const DEFAULTS: Required<FpsGovernorOptions> = {
  /* ~1s at 60fps. Long enough that the initial shader-compile/texture-upload
     hitch every engine on this page already pays once at construction (see
     cloudsEngine's own "one synchronous draw at construction" note) is well
     behind the window before sampling starts. */
  graceFrames: 60,
  /* ~0.6s at 60fps, short enough to react within a chapter's own pin rather
     than only diagnosing it after the reader has scrolled past. */
  windowFrames: 36,
  /* Below half the common 60Hz/120Hz display rates' shared floor. A window
     averaging under this is not a single dropped frame — vsync alone would
     not produce it — so it reads as the frame budget genuinely not being
     met, not as display jitter. */
  threshold: 40,
};

export function createFpsGovernor(
  options: FpsGovernorOptions = {}
): FpsGovernor {
  const config = { ...DEFAULTS, ...options };
  let frame = 0;
  let last = -1;
  let windowStart = -1;
  let windowFrameCount = 0;
  let degraded = false;

  function reset() {
    frame = 0;
    last = -1;
    windowStart = -1;
    windowFrameCount = 0;
    degraded = false;
  }

  function sample(now: number): boolean {
    const prevLast = last;
    last = now;

    /* A gap much larger than a dropped frame — an effect whose loop pauses
       itself between bursts (Shatter stops entirely once its pointer motion
       settles, and only resumes on the next gesture) can leave many real
       seconds between two samples with nothing slow about either one. Without
       this, `elapsed` below would span that idle gap and read as a
       catastrophically low average fps that never actually happened. Treated
       as a fresh start rather than a data point: the grace period and window
       both restart from here, exactly as they would for a brand new
       governor. 250ms is generous next to this page's own frame-pacing caps
       (Clouds runs as low as 20fps degraded, which is 50ms/frame) while still
       well under any real idle gap worth distrusting. */
    if (prevLast >= 0 && now - prevLast > 250) {
      frame = 0;
      windowStart = -1;
      windowFrameCount = 0;
    }

    frame += 1;

    if (degraded) return false;
    if (frame <= config.graceFrames) return false;

    /* First sample after the grace period opens the window rather than
       measuring into it — there is no previous timestamp from *inside* the
       window yet to measure a delta against. */
    if (windowStart < 0 || prevLast < 0) {
      windowStart = now;
      windowFrameCount = 0;
      return false;
    }

    windowFrameCount += 1;
    const elapsed = now - windowStart;
    if (windowFrameCount < config.windowFrames || elapsed <= 0) return false;

    const avgFps = (windowFrameCount * 1000) / elapsed;
    if (avgFps < config.threshold) {
      degraded = true;
      return true;
    }

    /* Window met its count without tripping the threshold: start a fresh one
       rather than letting the average creep forward one frame at a time,
       which would let a single sustained bad stretch get diluted by a much
       longer good one that happened to precede it in the same running
       average. */
    windowStart = now;
    windowFrameCount = 0;
    return false;
  }

  return {
    sample,
    get degraded() {
      return degraded;
    },
    reset,
  };
}
