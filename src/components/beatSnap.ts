import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { glideToOffset, scrollOffset } from "./smoothScroll";
import { BEAT_VH } from "./pacing";

/* Beat snapping for the page's pinned, scrubbed chapters.
 *
 * Both the Why chapter and the feature story are built out of discrete beats —
 * a paragraph or a feature that arrives, holds, and leaves. Between two of
 * those holds the scroll range is almost entirely one beat leaving and the
 * next arriving, so wherever a gesture happens to stop, the reader is likely
 * left mid-transition: a half-faded headline, a paragraph still coming into
 * focus, a ledger still cascading in. Snapping resolves every gesture onto a
 * beat instead, which is what makes every beat readable whether the reader
 * creeps or flings.
 *
 * Shared because the two chapters have to feel like the same page. It lives in
 * its own module rather than in either of them because both are code-split, so
 * importing it from one lazy chunk into the other would drag that whole chunk
 * back in — the same reason scrollOrder.ts is separate.
 *
 * ── Why this drives the correction itself ──────────────────────────────────
 *
 * This used to be a ScrollTrigger `snap` config, which is the obvious way to
 * do it and is not usable on this page. ScrollTrigger performs a snap by
 * tweening the *scroller's* scroll position, and that tween carries an
 * interruption guard: every frame it compares the position it expects against
 * the position it reads back, and if the two differ it assumes the reader has
 * grabbed the scrollbar, abandons its own target and writes whatever it just
 * read instead.
 *
 * Under ScrollSmoother that read comes back as 0 now and then — the smoother
 * publishes the painted offset through a cached accessor, and the cache can
 * report the top of the document for a frame while the page is a couple of
 * thousand pixels down it. The guard then does exactly what it promises:
 * writes the position it read. So an ordinary scroll into the feature story
 * would, every so often, throw the reader back to the hero. Captured mid
 * scroll at 2560: the snap resolved a correct forward target of 3000, and the
 * write that landed was 0.
 *
 * Resolving the beat is ours either way (see beatSnapper). All that changes
 * here is who performs the travel: on scrollEnd, once, through the page's own
 * scroll helper — which writes the position a single time rather than steering
 * it frame by frame, so there is nothing to mistake for a reader's gesture.
 */

/* Slack around a settled frame, in *viewport heights* rather than in trigger
 * progress: the chapters have wildly different pin lengths (3, 3.5, 4.4 and 7.2
 * viewports), and what has to match between them is the physical distance the
 * reader can drift before a beat change is committed — roughly one wheel notch.
 * Divide by a section's own scroll budget to get its progress-space hold. */
const SNAP_HOLD_VH = 0.12;

/** Resolves a section's hold in the 0→1 progress space of its own trigger. */
export const snapHold = (totalVh: number) => SNAP_HOLD_VH / totalVh;

/* How far a settle is allowed to travel, for the chapters that pass a limit —
 * see the `reach` argument below. Half a readable frame: far enough to finish
 * an arrival the reader stopped in the middle of, not far enough to be a
 * decision about where they wanted to be.
 *
 * A number rather than Infinity because two of the four chapters have rests
 * that are screens apart, and the reason is not that their pacing is uneven
 * — it is that the scroll between their rests is one continuous move (fog
 * thickening, a hand being dealt) rather than a beat leaving and the next
 * arriving. A reader who stops in the middle of one of those is looking at a
 * legitimate frame, so the correct correction is none. */
const SETTLE_REACH_VH = BEAT_VH * 0.5;

/** Resolves that reach in the 0→1 progress space of a trigger's own range. */
export const settleReach = (totalVh: number) => SETTLE_REACH_VH / totalVh;

/* How long a settled page waits before correcting itself. The wait is re-armed
   on every scroll, so this is measured from the reader's last input, not from
   the start of the gesture. Matches the delay the ScrollTrigger config used. */
const SETTLE_DELAY = 0.12;

/* Corrections closer than this are not worth making: the frame is already the
   settled one, and writing the scroll position would only risk interrupting
   whatever else is mid-flight. Also what stops the settle from answering its
   own scroll. */
const NEAR_ENOUGH = 2;

/* Deliberately not GSAP's built-in `directional` snap, for two reasons:
 *
 *  - it always moves to the neighbouring point in the direction of travel, so
 *    the smallest nudge off a settled beat commits the next one, and
 *  - with no point left in that direction it falls back to the nearest one,
 *    which at the first and last beat means being pulled back into the beat
 *    the reader is trying to scroll away from — the section becomes a trap.
 *
 * Instead: hold the current beat within `hold`, otherwise step exactly one
 * beat in the direction the reader was scrolling — so an overscroll of any
 * size lands on a whole beat rather than mid-entrance — and don't snap at all
 * once there is no beat left ahead, which is what keeps the section escapable
 * at both ends.
 */
function beatSnapper(points: number[], hold: number, reach: number) {
  const beats = [...points].sort((a, b) => a - b);

  return (value: number, forward: boolean) => {
    const ahead = beats.filter((p) => (forward ? p > value : p < value));
    /* Leaving the section: scrolling up out of the first beat's entrance, or
       down off the last beat's hold. Returning the value unchanged means "no
       correction" — it resolves to the scroll position the reader is already
       at. */
    if (!ahead.length) return value;

    /* The beat behind the reader, i.e. the one they are parked on. */
    const passed = beats.filter((p) => (forward ? p <= value : p >= value));
    if (passed.length) {
      const anchor = forward ? Math.max(...passed) : Math.min(...passed);
      if (Math.abs(value - anchor) <= hold) return anchor;
    }

    const next = forward ? Math.min(...ahead) : Math.max(...ahead);
    /* Out of reach, so leave it alone. Only ever true for a chapter that opted
       into a limit (see SETTLE_REACH_VH); the beat chapters pass Infinity,
       where every gesture commits the neighbouring beat exactly as before.
       Without this a chapter whose rests are a couple of screens apart would
       answer the smallest nudge by gliding the reader a couple of screens — the
       correction becomes the fastest thing on the page, which is the opposite
       of what it is for. */
    if (Math.abs(next - value) > reach) return value;

    return next;
  };
}

/**
 * Come to rest on one of `points` (progress values along `trigger`'s own
 * range), with `hold` slack around each, whenever the reader stops scrolling
 * inside it.
 *
 * `reach` caps how far a correction may travel, in the same progress space. Omit
 * it for a chapter built of adjacent beats, where every frame between two rests
 * is a transition and the correction should always be taken. Pass
 * `settleReach(totalVh)` for a chapter whose rests are further apart than one
 * readable frame, where the scroll in between is a move worth stopping in.
 *
 * Returns its own teardown.
 */
export function beatSettle(
  trigger: ScrollTrigger,
  points: number[],
  hold: number,
  reach = Infinity
) {
  const resolve = beatSnapper(points, hold, reach);

  const settle = () => {
    /* Only while the chapter owns the frame. Outside its pin the reader is
       somewhere else on the page and its beats are none of its business. */
    if (!trigger.isActive) return;
    const span = trigger.end - trigger.start;
    if (span <= 0) return;
    /* Measured from where the page is *painted*, not from the trigger's
       progress: the pinned timelines run on a `scrub`, so progress is still
       catching up for a beat after the scroll stops, and a correction resolved
       from a value that is still moving aims behind the reader. */
    const at = (scrollOffset() - trigger.start) / span;
    const target = trigger.start + resolve(at, trigger.direction >= 0) * span;
    if (Math.abs(target - scrollOffset()) < NEAR_ENOUGH) return;
    glideToOffset(target);
  };

  /* Queued on scrollEnd — which ScrollTrigger dispatches once scrolling has
     actually stopped — and cancelled again the moment a new gesture starts, so
     a reader who is still moving is never nudged mid-scroll. The short wait on
     top of that covers the gap between a wheel's last notch and the smoother's
     own catch-up finishing. */
  const wait = gsap.delayedCall(SETTLE_DELAY, settle).pause();
  const cancel = () => wait.pause(0);
  const queue = () => wait.restart(true);

  ScrollTrigger.addEventListener("scrollStart", cancel);
  ScrollTrigger.addEventListener("scrollEnd", queue);

  return () => {
    ScrollTrigger.removeEventListener("scrollStart", cancel);
    ScrollTrigger.removeEventListener("scrollEnd", queue);
    wait.kill();
  };
}
