import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";

/* Scroll helpers for a page whose scroller may or may not be smoothed.
 *
 * HomePage installs ScrollSmoother, which keeps the document's native scroll
 * position as the source of truth but paints the page at an *eased* offset a
 * fraction behind it. That split matters to anything that positions itself
 * against what is currently on screen: `window.scrollY` is where the page will
 * be, `ScrollSmoother.scrollTop()` is where it is being drawn right now.
 *
 * Kept in its own module for the same reason scrollOrder.ts and beatSnap.ts
 * are: three of the four chapters that need it are code-split, so importing it
 * from one of those lazy chunks would drag that chunk back into the initial
 * bundle.
 */

/**
 * The page's *visual* scroll offset — the value the content is actually
 * rendered at this frame. Falls back to the native position when the smoother
 * isn't running (reduced motion), where the two are the same thing.
 *
 * Cheap: a cached number on the smoother instance, no layout read.
 */
export const scrollOffset = () =>
  ScrollSmoother.get()?.scrollTop() ?? window.scrollY;

/**
 * Jump to an absolute document offset — the chapter index's beat buttons, the
 * pricing focus handler, and every in-page anchor (see anchorScroll.ts).
 *
 * One write, and deliberately not an animated one. Three levers were measured
 * here and this is the only one that leaves the page in a state it can be
 * scrolled on from:
 *
 *  - `smoother.scrollTo(y, true)` — the obvious call — sets the *native* scroll
 *    and waits for the smoother to catch up. With `normalizeScroll` on (see
 *    HomePage) the plugin reads its normalizer's own cached position instead,
 *    so nothing ever picks the new value up: measured on a jump to the Why
 *    chapter, native scroll 5429 with the content still painted at 0. The
 *    destination's ScrollTriggers never advance, so the reader gets a blank
 *    frame with the scrollbar parked halfway down the page. This is what the
 *    nav links used to do.
 *  - Animating the position — writing it every frame, however it is written —
 *    races two things that also write it: the smoother's own scrub, and the
 *    snap correction each pinned chapter arms a tenth of a second after the
 *    scroll position last changed. That correction gets created mid-travel,
 *    resolved against a position the jump has already left, and hands the page
 *    back to the top of the document a beat after it arrives. Intermittently,
 *    which is worse than reliably.
 *  - `ScrollTrigger.getScrollFunc(scroller)` is the scroller's own accessor. It
 *    writes through the smoother's scrollerProxy — moving the painted content
 *    and the native scrollbar together — and records the value ScrollTrigger
 *    reads back, so every trigger on the page agrees about where the page is.
 *    Nothing is left mid-flight for a snap to argue with.
 *
 * The arrival still isn't a dead cut: every chapter's own timeline scrubs to
 * its new progress with the `scrub` easing it was authored with, so the frame
 * composes itself over the next beat rather than appearing whole.
 */
export function scrollToOffset(y: number) {
  const smoother = ScrollSmoother.get();
  if (!smoother) {
    /* Reduced motion — the only mode without a smoother. Jump, don't travel:
       that is what the preference is asking for (see index.css). */
    window.scrollTo({ top: y, behavior: "auto" });
    return;
  }
  /* Whole pixels, and not for tidiness: it keeps the position a chapter's beat
     settle resolves and the position the page is actually at from disagreeing
     by a fraction of a pixel, which is the difference between arriving and
     arriving-then-being-corrected. */
  ScrollTrigger.getScrollFunc(smoother.wrapper())(Math.round(y));
}

/* One proxy object for every glide on the page, so `overwrite: true` below
   resolves two corrections that overlap: the second replaces the first instead
   of both writing the scroll position on the same frame. */
const glide = { y: 0 };

/**
 * Eased travel to an absolute document offset, for the short corrections where
 * a cut would read as a glitch — the beat settle in the pinned chapters (see
 * beatSnap.ts), which moves the page by a fraction of a viewport.
 *
 * Distinct from scrollToOffset above because the two want opposite things. A
 * jump crosses the whole page and has to be certain: one write, nothing left
 * in flight. A settle covers a few hundred pixels and has to feel like the
 * page coming to rest, which means frames — and it can afford them, because it
 * only ever runs once the reader has stopped scrolling.
 */
export function glideToOffset(y: number) {
  const smoother = ScrollSmoother.get();
  if (!smoother) {
    window.scrollTo({ top: y, behavior: "auto" });
    return;
  }
  const setScroll = ScrollTrigger.getScrollFunc(smoother.wrapper());
  /* `scrollOffset()` for the starting value rather than reading it back off the
     scroll function: same number (the smoother's painted offset is what the
     scroller reports), and it is typed as the getter it is. */
  glide.y = scrollOffset();
  gsap.to(glide, {
    y: Math.round(y),
    /* Constant *rate*, not a constant duration, and the difference is the whole
       reason this line is tuned rather than guessed: the settle is the one piece
       of motion on the page the reader did not ask for, so the one thing it must
       never do is move at a speed they did not.
     *
     * This used to be `clamp(0.3, 0.7, Δ / 1200)`, which is a constant duration
     * dressed up as a rate — every correction longer than 840px hit the ceiling
     * and then went faster the further it had to go. A 300px tidy-up travelled
     * at 1000px/s and a 1200px one at 1700px/s, so the page's own corrections
     * were the most obvious place its speed changed. Dividing by the rate and
     * raising the ceiling keeps everything between ~390px and ~1235px — which is
     * every correction a beat one screen tall can produce — at the same
     * 1300px/s.
     *
     * The floor stays: below ~390px the distance is small enough that a shorter
     * tween reads as a snap, and a 0.3s minimum keeps a nudge feeling like the
     * page settling rather than flicking. Symmetric ease, no overshoot. */
    duration: gsap.utils.clamp(0.3, 0.95, Math.abs(y - glide.y) / 1300),
    ease: "power2.inOut",
    overwrite: true,
    onUpdate: () => setScroll(glide.y),
  });
}
