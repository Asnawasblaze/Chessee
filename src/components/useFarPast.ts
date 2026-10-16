import { useEffect, useState, type RefObject } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/* ---------------------------------------------------------------------- */
/* useFarPast — release a chapter's WebGL contexts once it is truly behind */
/* ---------------------------------------------------------------------- */

/* useNearViewport (see that file) answers "is this chapter worth building
 * yet" and, once yes, never reconsiders — rebuilding a context while the
 * reader scrolls back and forth across a chapter boundary would be both
 * expensive and visible, so every layer on the page latches open forever
 * once built.
 *
 * That is the right call near a chapter. It stops being the right call once
 * the reader has scrolled *far* past one: nothing on this page ever tears a
 * context down again, so the count only grows as the reader continues
 * downward, and browsers cap how many a document may hold at once (roughly
 * 8-16) and evict the oldest silently on refusal. The Why chapter alone
 * holds three at once (the board, the shatter pass, the pawn) on top of
 * whatever the hero and the feature story built earlier — by the time a
 * reader reaches the FAQ or the footer, every one of those three is
 * unreachable, invisible, and still spending its slot in that budget.
 *
 * This hook is the other half of that lifecycle: once an element is far
 * enough behind the reader, it returns true, and a caller can unmount its
 * heavy layer(s) on that signal — which runs their existing effect cleanup
 * (dispose, forceContextLoss, listener removal) exactly as an unmount always
 * has. Scrolling back near the element flips it back to false, which
 * remounts and naturally rebuilds. The one-time rebuild stutter this can
 * cause is an accepted, bounded cost — it only happens after a scroll large
 * enough that the reader is not mid-gesture across the boundary.
 *
 * Two thresholds rather than one, and that asymmetry is load-bearing:
 *
 *   - `releaseAt` is generous (many viewports) so release only fires once
 *     the reader is genuinely done with the chapter, not just past its
 *     bottom edge.
 *   - `rearmAt` is smaller and re-arms only once the reader has scrolled
 *     back to within a *closer* distance than where release fired. Without
 *     that gap, a reader sitting exactly at the release boundary — where
 *     small scroll jitter is common (a trackpad's momentum tail, a resize
 *     from a mobile address bar) — would flip the layer on and off every
 *     time the position crossed one line.
 *
 * Built on ScrollTrigger rather than IntersectionObserver for the same
 * reason useNearViewport is: ScrollSmoother clips the scroller inside a
 * viewport-sized, `position: fixed` ancestor, and an IntersectionObserver's
 * `rootMargin` cannot see past that clip to a target many viewports away.
 * ScrollTrigger measures against the smoother's own scroll position, which
 * stays correct at any distance.
 */
export default function useFarPast(
  ref: RefObject<HTMLElement | null>,
  /** Viewports past the element's bottom before it releases. */
  releaseAt = 4,
  /** Viewports past the element's bottom the reader must return within
   *  before it re-arms. Smaller than `releaseAt` on purpose — see above. */
  rearmAt = 2.5
): boolean {
  const [far, setFar] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const trigger = ScrollTrigger.create({
      trigger: el,
      /* `start` is where the release check begins to matter and `end` is
         where the element is fully behind the reader. Both measure the
         element's bottom against the viewport's *top* edge pushed upward by
         N viewports (`top-=N%`), which is what "N viewports past the
         element" means: the element's bottom has to leave through the top of
         the fold and then keep going. The earlier form said `bottom+=N%`,
         which puts the scroller marker N viewports *below* the fold and so
         resolves to a scroll position reached before the element has even
         left the viewport — on WhySection that put both thresholds inside
         the chapter's own pin, so its heavy layers were torn down partway
         through the final beat, and it inverted them (`end` earlier than
         `start`), which ScrollTrigger clamps back to `end = start`, leaving
         the hysteresis band these two arguments exist for with zero length.
         onUpdate (not onToggle) is what this needs: the two thresholds are
         read live against the trigger's own progress rather than the trigger
         having only one boundary to fire at. */
      start: `bottom top-=${Math.round(rearmAt * 100)}%`,
      end: `bottom top-=${Math.round(releaseAt * 100)}%`,
      onUpdate: (self) => {
        /* progress is 0 at `start` and 1 at `end`; past `end` it stays
           clamped at 1 rather than continuing to grow, so a reader who
           scrolls a further ten viewports down still reads as "released"
           rather than the trigger needing to track them the whole way. */
        if (self.progress >= 1) setFar(true);
        else if (self.progress <= 0) setFar(false);
        /* Between the two thresholds: hold whatever state was last set.
           This is the hysteresis band — the element stays released until
           the reader has scrolled all the way back past `start`, and stays
           built until they have scrolled all the way past `end`. */
      },
      /* onUpdate only runs while the trigger is active, so a reader who
         arrives far past the chapter in one movement — an anchor jump, or a
         reload that restores the scroll position — can cross the whole band
         without a single update firing. onLeave covers that case; onLeaveBack
         is its mirror for arriving back above the band the same way. */
      onLeave: () => setFar(true),
      onLeaveBack: () => setFar(false),
    });

    return () => trigger.kill();
    /* Same dependency shape as useNearViewport: the ref, and the numbers
       that shape the trigger's own start/end. Both are passed as literals
       by every current caller, so this effect building the trigger once and
       never rebuilding it in practice is the common case either way. */
  }, [ref, releaseAt, rearmAt]);

  return far;
}
