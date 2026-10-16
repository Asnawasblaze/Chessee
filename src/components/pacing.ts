/* How fast the page reads.
 *
 * Every chapter on this page is a pinned, scrubbed timeline, and each one used
 * to decide on its own how much scroll a readable frame was worth and how much
 * lag to put between the wheel and the frame. The numbers drifted apart, and
 * what the reader felt was not four chapters with four personalities — it was
 * one page whose speed changed without warning:
 *
 *   - the fog chapter finished its copy at 0.98 of its own range, so the five
 *     lines it exists to show were fully set for about 36px of scroll before
 *     the pin released;
 *   - a Why beat got 0.85 of a screen while a feature-story beat got a full
 *     one, despite the Why beat carrying a kicker, a heading *and* a paragraph;
 *   - the pricing chapter spent 1.9 screens dealing a hand and then held the
 *     readable result for half of one;
 *   - and the scrub sat at 0.55, 0.6 or 0.7 depending on which chapter you
 *     happened to be in, so the page's response to the same gesture changed
 *     three times on the way down.
 *
 * So the two numbers that decide pacing live here instead, and every chapter
 * derives from them. Changing the reading speed of the whole page is now one
 * edit, and no chapter can quietly become the fast one again.
 *
 * Its own module for the same reason scrollOrder.ts and beatSnap.ts are: three
 * of the four chapters that read these are code-split, so importing the
 * constants from one of those lazy chunks would drag the chunk back into the
 * initial bundle.
 */

/** ── Scroll response ───────────────────────────────────────────────────────
 *
 * Seconds of catch-up between the scroll position and the frame it renders.
 * This is the page's *weight*: it is what makes a pinned chapter feel like it
 * carries mass rather than being dragged by the wheel.
 *
 * One value for every scrubbed trigger on the page, and that is the point of
 * it. Scrub lag is not a per-chapter flourish — the reader cannot see it as
 * one, they can only feel that the page suddenly answers faster or slower than
 * it did a screen ago. 0.7 is the value the three pinned chapters were already
 * tuned at; the two background ramps that ran lighter (0.55 and 0.6) are the
 * ones that moved.
 */
export const SCRUB = 0.7;

/** ── Reading distance ─────────────────────────────────────────────────────
 *
 * Scroll distance, in viewport heights, for one readable frame: a feature, a
 * beat of the argument, a title card, a settled price table. It covers the
 * frame arriving *and* the hold after it, so the reader who stops anywhere
 * inside it is looking at something finished.
 *
 * A full screen because that is the largest of the values the chapters had
 * arrived at independently, and pacing has to level up rather than down: a
 * frame given less scroll than the copy on it needs is a frame that flies past,
 * and there is no amount of easing that fixes it. The page is about two screens
 * longer for it, which is the trade the whole change is.
 *
 * Not freely reducible, either. The feature story authors its beat internals as
 * absolute offsets from the beat's start (`at + 0.76` for the exit, `at + 0.98`
 * for the hide), so a unit below ~1 would run one beat's exit into the next
 * beat's entrance. Anything smaller means re-timing those against the unit
 * first.
 */
export const BEAT_VH = 1;
