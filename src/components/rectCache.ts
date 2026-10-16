/* ---------------------------------------------------------------------- */
/* Cached bounding rect                                                    */
/* ---------------------------------------------------------------------- */

/* Dependency of the vendored <Shatter> (see Shatter.tsx): it maps every
 * pointermove into element-local coordinates, and doing that against a live
 * getBoundingClientRect() means one forced layout flush per mouse move — on a
 * page where a scrubbed, pinned ScrollTrigger is already writing to the same
 * subtree every frame. The upstream package ships this helper alongside the
 * component; it isn't published separately, so it is reimplemented here to the
 * same contract: a `current` rect that is only re-read when something could
 * have moved it.
 *
 * Invalidated rather than recomputed on each event: scroll, resize and the
 * element's own resize all mark the cache dirty, and the next read pays for the
 * measurement. A pointer sweeping across a settled frame therefore costs
 * nothing.
 *
 * The scroll listener is capturing and on the window, which is what makes this
 * correct under ScrollSmoother: the smoother scrolls the real document (so
 * window scroll events do fire) but paints #smooth-content at an eased offset,
 * and it also scrolls its own wrapper in some gesture paths — capture catches
 * both without having to know which element is doing the scrolling.
 */
export interface RectCache {
  /** The element's rect, re-measured only if something may have moved it. */
  readonly current: DOMRect;
  destroy(): void;
}

export function createRectCache(el: Element): RectCache {
  let rect = el.getBoundingClientRect();
  let dirty = false;

  const invalidate = () => {
    dirty = true;
  };

  window.addEventListener("scroll", invalidate, {
    passive: true,
    capture: true,
  });
  window.addEventListener("resize", invalidate);
  const ro = new ResizeObserver(invalidate);
  ro.observe(el);

  return {
    get current() {
      if (dirty) {
        rect = el.getBoundingClientRect();
        dirty = false;
      }
      return rect;
    },
    destroy() {
      window.removeEventListener("scroll", invalidate, { capture: true });
      window.removeEventListener("resize", invalidate);
      ro.disconnect();
    },
  };
}
