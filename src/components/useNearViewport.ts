import { useEffect, useState, type RefObject } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/* ---------------------------------------------------------------------- */
/* useNearViewport — hold a canvas layer back until it is worth building    */
/* ---------------------------------------------------------------------- */

/* The page is a little over 19,000px tall and carries fifteen canvases: four
 * live WebGL contexts and eleven full-viewport 2D buffers. Every one of them
 * used to be built on mount, which meant the browser constructed every scene in
 * the document — the feature story's three.js stage 4,700px down, the Why
 * chapter's figure at 9,600px, six star fields, the pricing wordmark's particle
 * canvas at 18,000px — before the reader had seen the hero.
 *
 * That is one long synchronous task, and it is long enough to matter. Profiling
 * the boot at a 1080p viewport put 9.1s of self time inside three.js alone,
 * split across `getContext`, `onFirstUse` and `WebGLRenderer.setSize` — context
 * creation and drawing-buffer allocation, repeated per layer. A plain 1-second
 * `setTimeout` chain running alongside it recorded a single 10.3s gap, so
 * nothing else on the main thread ran either: not the boot screen's own exit
 * timer, not its progress tween. The loading curtain stayed up for 16 seconds
 * and the page was a near-black screen for all of it. Larger viewport, longer
 * block, because every buffer is sized to it.
 *
 * So a layer waits until its chapter is approaching. `lead` viewports of notice
 * is enough for a scene to build before it is looked at, and the chapters are
 * far enough apart (2,400-4,500px) that they no longer contend with each other
 * or with the hero.
 *
 * Two properties this deliberately has:
 *
 *   - It latches. Once a layer is up it stays up, so scrolling back and forth
 *     across a chapter boundary cannot tear a WebGL context down and rebuild it
 *     — which would be both expensive and visible, and would hand the chapters'
 *     timelines a fresh instance mid-scrub.
 *   - It fails open. No element to measure, or anything unexpected, and the
 *     layer builds immediately. A deferral is an optimisation; being wrong about
 *     it must never be the reason something is missing.
 *
 * Built on ScrollTrigger rather than IntersectionObserver, and that is a
 * requirement rather than a preference: ScrollSmoother puts `overflow: hidden`
 * on a viewport-sized, `position: fixed` #smooth-wrapper, and an observer's
 * `rootMargin` expands the root — not the clip rect of an ancestor between the
 * target and that root. The margin would be swallowed and every layer would
 * start building at the moment it scrolled into view, which is the one moment it
 * must not. ScrollTrigger measures against the smoother's own scroll position,
 * which is the coordinate space the rest of the page already works in.
 */
export default function useNearViewport(
  ref: RefObject<HTMLElement | null>,
  /** Viewports of notice before the element arrives. */
  lead = 1.5
): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return undefined;

    const el = ref.current;
    if (!el) {
      setNear(true);
      return undefined;
    }

    /* Already within reach on first layout — a hero-adjacent layer, or a reload
       that restored the reader partway down the page. Skip the trigger entirely
       so those cases cost nothing and cannot be late. */
    const box = el.getBoundingClientRect();
    const reach = window.innerHeight * lead;
    if (box.top < window.innerHeight + reach && box.bottom > -reach) {
      setNear(true);
      return undefined;
    }

    const pct = Math.round(lead * 100);
    const trigger = ScrollTrigger.create({
      trigger: el,
      start: `top bottom+=${pct}%`,
      end: `bottom top-=${pct}%`,
      /* `onRefresh` fires as part of creation, so a trigger that is already
         inside its range at setup resolves on the spot rather than waiting for
         the next scroll event. */
      onRefresh: (self) => {
        if (self.isActive) setNear(true);
      },
      onToggle: (self) => {
        if (self.isActive) setNear(true);
      },
    });

    return () => trigger.kill();
  }, [ref, lead, near]);

  return near;
}
