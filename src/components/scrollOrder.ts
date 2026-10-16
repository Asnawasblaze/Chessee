/* Refresh order for the page's scroll-driven sections, highest first, matching
 * document order: features fog → feature story → why → pricing.
 *
 * ScrollTrigger sorts a refresh by each trigger's *current* start value, which
 * is fine until a pinned section's own start is stale — then it re-measures out
 * of order, while the pins above it still have their spacing reverted, and
 * lands on an un-pinned position it never recovers from. That is easy to hit
 * here: two of the three sections are code-split, so they create their triggers
 * after the eagerly-mounted one, each adding several viewports of scroll
 * distance to the page as they do.
 *
 * Declaring the order explicitly removes the dependency on measurement timing
 * altogether. Kept in its own module because these numbers only mean anything
 * relative to each other, and because the sections that need them sit on both
 * sides of a code-split boundary — importing the constant from one of the lazy
 * chunks would drag that chunk back into the initial bundle.
 */
/* Every section names a value explicitly, including the last one. 0 is what an
 * unconfigured ScrollTrigger gets, so leaving the bottom section on it would
 * put it in a tie with any trigger that never opted in — and ties fall back to
 * creation order, which is the thing this map exists to stop mattering. */
export const REFRESH_PRIORITY = {
  features: 4,
  story: 3,
  why: 2,
  pricing: 1,
} as const;
