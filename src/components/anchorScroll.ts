import { scrollOffset, scrollToOffset } from "./smoothScroll";

/* In-page anchor navigation for a smoothed, pinned page.
 *
 * Two things break a plain `<a href="#features">` here, and both of them look
 * to the reader like the link opened a blank page:
 *
 * 1. ScrollSmoother makes #smooth-wrapper `position: fixed; overflow: hidden`
 *    and translates #smooth-content inside it. That makes the wrapper the
 *    target's nearest *scrollable* ancestor — `overflow: hidden` is still
 *    programmatically scrollable — so the browser's fragment navigation
 *    scrolls the wrapper's own scrollTop instead of the document. The content
 *    slides up inside a clipped box while `window.scrollY` never moves, which
 *    means every ScrollTrigger on the page is still sitting at scroll 0: the
 *    pinned chapters stay in their pre-entrance state (opacity 0, blurred)
 *    and the frame is empty. Measured on the Features link: wrapper.scrollTop
 *    952, window.scrollY 0.
 *
 * 2. Even with the right scroller, "the top of the section" is not always the
 *    frame worth landing on. Each chapter is a pinned, scrubbed timeline, so a
 *    section's top edge is the *start* of its choreography: for the features
 *    chapter that start is the opaque middle of the fog whiteout, and for the
 *    Why chapter it is the dusk band a few hundred pixels above the point the
 *    title card pins. Both are empty frames by design. Chapters that have a
 *    better answer declare it through registerAnchorLanding below.
 *
 * So the jump is taken over: resolve where the chapter actually reads, and
 * scroll there the same way a chapter-index jump does.
 */

/* Chapters that know better than their own top edge where a jump should land.
   Resolved at click time, not at registration, because every one of these is a
   position inside a pinned trigger's range and those ranges move as the
   code-split chapters below the fold arrive. */
const landings = new Map<string, () => number>();

/**
 * A chapter declaring the scroll position a nav jump to `id` should come to
 * rest at — normally the same settled frame its own chapter index aims for.
 *
 * Worth declaring because a scrubbed chapter's *first* frame is rarely its
 * readable one: the features chapter opens in the middle of the fog whiteout,
 * and the Why chapter's top edge is the dusk band a few hundred pixels above
 * the point its title card pins. Landing on either reads as a broken link.
 *
 * Returns its own teardown, so a chapter that unmounts (or reverts under
 * `prefers-reduced-motion`, where none of these timelines exist) falls back to
 * plain "top of the section" behaviour.
 */
export function registerAnchorLanding(id: string, resolve: () => number) {
  landings.set(id, resolve);
  return () => {
    if (landings.get(id) === resolve) landings.delete(id);
  };
}

/** The scroll position that puts `el`'s top edge at the top of the viewport. */
function topOffset(el: HTMLElement) {
  /* A pinned section is `position: fixed` while its pin is active, so its own
     rect reports where it is stuck to the screen, not where it lives in the
     document. Its pin-spacer is the box still holding that place, so measure
     that instead. (Only the feature story pins itself; the other chapters pin
     an inner stage, which leaves the section in flow either way.) */
  const box =
    el.parentElement?.classList.contains("pin-spacer") ? el.parentElement : el;
  /* `scrollOffset()`, not `window.scrollY` — same reason FeaturesSection's seam
     measurement uses it. `getBoundingClientRect()` reports where the element is
     *drawn*, and the smoother paints the page at an eased offset a fraction
     behind the native scroll position, so adding the native scroll would bake
     the current lag into an absolute document offset. Measured mid-flight that
     error is not small: a click taken while the page was still easing came out
     1358px past the pricing chapter's real top.
     No special case for pins *above* the target: each one holds its scroll
     distance open with a spacer, so the document offset already includes it. */
  return box.getBoundingClientRect().top + scrollOffset();
}

/**
 * Scroll to a section by element id. Returns false if nothing on the page
 * carries that id — the placeholder targets (#start, #login, #signup) among
 * them — so the caller can leave the browser's default alone.
 */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  scrollToOffset(landings.get(id)?.() ?? topOffset(el));
  /* Deliberately *not* moving focus into the section, which is what the
     browser's own fragment navigation would have done. Focus inside
     #smooth-content makes the clipped wrapper the keyboard's scroll container,
     and the next Page Down then scrolls that instead of the page: measured from
     the Why chapter, one Page Down after the jump put the reader back at the
     top of the document. Leaving focus on the link is the more useful half of
     the trade — the keyboard keeps scrolling the page, the link stays in the
     tab order, and each pinned chapter carries its own chapter index for
     reaching the beats inside it. */
  resetWrapper();
  return true;
}

/* Belt and braces. Anything that gets the browser to scroll an element into
   view on its own — a focus() call that ignores preventScroll, an assistive
   technology, an autofill panel — moves the wrapper rather than the page, and
   the wrapper never scrolls back on its own because nothing else reads or
   writes it. Zeroing it keeps that permanently invisible. */
function resetWrapper() {
  const wrapper = document.getElementById("smooth-wrapper");
  if (wrapper && wrapper.scrollTop) wrapper.scrollTop = 0;
}

/**
 * Delegated handler for every in-page anchor on the page — the hero's primary
 * nav, the footer's column links and "Back to top", the CTAs. Delegation
 * rather than per-link handlers because the chapters that own most of these
 * links are code-split and mount long after this is installed.
 *
 * Returns its own teardown.
 */
export function installAnchorScroll() {
  const onClick = (event: MouseEvent) => {
    // Leave modified clicks and anything already handled to the browser.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      'a[href^="#"]'
    );
    if (!link || link.target === "_blank") return;
    const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
    if (!id || !scrollToId(id)) return;
    /* Only once the jump is actually taken. A dead anchor (#start and friends)
       keeps the browser's behaviour, which for a missing target is to do
       nothing at all. */
    event.preventDefault();
  };

  document.addEventListener("click", onClick);

  /* A page loaded *with* a fragment already in the URL — a reload, or a link
     shared before this handler existed — hits problem 1 above during startup,
     before the smoother is even created, and the chapter it names may be one
     of the code-split ones that isn't in the DOM yet to scroll to. Both are
     answered by dropping the fragment and starting at the top: the hero is a
     recoverable place to be, a blank frame is not. `replaceState` so it
     doesn't cost the reader a history entry. */
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
    resetWrapper();
  }

  return () => document.removeEventListener("click", onClick);
}
