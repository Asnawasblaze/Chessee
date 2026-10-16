import { useEffect, useRef } from "react";
import { createStarField } from "./starFieldEngine";
import useNearViewport from "./useNearViewport";
import "./SpaceField.css";

/* ---------------------------------------------------------------------- */
/* SpaceField — the sky on the far side of the tunnel's eye                 */
/* ---------------------------------------------------------------------- */

/* One component used by two chapters, and the sharing is the whole point
 * rather than a convenience.
 *
 * The Why chapter's last layer opens the night it closes on into open space, and
 * the pricing chapter opens in that same space. Between the two there is roughly
 * a screen of ordinary scrolling — the Why stage's own height rolling off the
 * top, which no amount of timeline work can remove, since a pinned element has to
 * unpin somewhere. So the reader watches one sky scroll up and the next scroll in,
 * and if those two skies differ in *any* respect the join reads as a seam ruled
 * across the page at the exact moment the chapter is supposed to feel continuous.
 *
 * Two decisions follow from that, and both are load-bearing:
 *
 *   - The base tone is flat. Not a gradient, not a radial hotspot — one value,
 *     --space-base, top to bottom. A field with a bright centre has a *position*,
 *     and two fields with two positions scrolling past each other read as two
 *     places. Anything that wants a brighter region paints it itself, on top,
 *     masked away from its own edges (see .pricing-core).
 *   - The star patterns are stated once, here. Duplicating forty lines of
 *     background-size triples into two stylesheets would work on the day it was
 *     written and drift the first time either one was touched — and the failure
 *     mode is not a broken layout, it is a faint horizontal line the reader
 *     cannot name.
 *
 * The one thing that cannot match is the pattern's *phase*: each field's
 * background-position is relative to its own box, so the dot grid resets at the
 * join. At 91-331px spacings and under 0.6 alpha on a near-black base that is
 * below the threshold of anything anyone can see, which is why it is an
 * acceptable cost and the base tone is not.
 *
 * Three layers rather than one because the parallax between them is what makes
 * the handover read as travel: both chapters expand them at different rates per
 * depth (the threshold in WhySection.css, off an inherited custom property, and
 * the approach in PricingSection.tsx, off a timeline — at the same factors, on
 * purpose), so the near field rushes past while the far field barely moves.
 *
 * ── The stars are a canvas now, not a tiled gradient ─────────────────────
 * Each of those three layers holds a canvas, and one engine draws all three (see
 * starFieldEngine.ts for the full reasoning and the cost). The short version is
 * that a tiled `radial-gradient` is a lattice of identical dots, and the moment
 * the sky stopped being scenery — this chapter opens on it, and the reader is
 * asked to look straight at it while a title assembles out of it — the lattice
 * became the thing you see. Real stars buy a magnitude distribution, colour,
 * per-star scintillation, and a field that answers the pointer: three depths of
 * parallax, stars that brighten and part around the cursor, a ring on press, and
 * the occasional meteor.
 *
 * The three layers stay as three DOM elements, and that is a constraint rather
 * than a preference: both chapters' timelines own `transform` on
 * `.space-stars-far/mid/near` to drive the dive and the approach. The canvases
 * sit inside them and are scaled by the compositor along with everything else,
 * so the engine never has to know that either animation exists.
 */
interface SpaceFieldProps {
  className?: string;
  /**
   * Adds the two nebula masses.
   *
   * Off by default, and the default is the interesting case: the sky the Why
   * chapter's threshold opens onto is deliberately bare, so that the join
   * described above has nothing in it but a flat tone and some stars. The pricing
   * chapter turns them on and crosses them over each other during its own
   * timeline, which is what makes its sky somewhere the reader has arrived rather
   * than more of the sky they arrived through.
   *
   * They are wrapped in a masked layer rather than positioned inside the field
   * directly: both masses are 100px-blurred and one sits at 4% from the top, so
   * unwrapped its tail lands on the field's first row — which is the row that
   * has to match the bare sky above it exactly.
   */
  nebula?: boolean;
}

export default function SpaceField({
  className,
  nebula = false,
}: SpaceFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLCanvasElement>(null);
  const midRef = useRef<HTMLCanvasElement>(null);
  const nearRef = useRef<HTMLCanvasElement>(null);

  /* Three canvases per field and two fields on the page, each buffer sized to
     the viewport — six full-screen allocations, the largest single block of the
     page's canvas memory, for a sky the reader does not reach until 9,600px
     down. Held back until the chapter is approaching; see useNearViewport. */
  const near = useNearViewport(fieldRef);

  useEffect(() => {
    if (!near) return undefined;
    const field = fieldRef.current;
    const canvases = [farRef.current, midRef.current, nearRef.current];
    if (!field || canvases.some((canvas) => !canvas)) return undefined;

    const stars = createStarField(field, canvases as HTMLCanvasElement[]);
    return () => stars.destroy();
  }, [near]);

  return (
    <div
      className={`space-field${className ? ` ${className}` : ""}`}
      ref={fieldRef}
      aria-hidden="true"
    >
      {nebula ? (
        <span className="space-nebulae">
          <span className="space-nebula space-nebula-a" />
          <span className="space-nebula space-nebula-b" />
        </span>
      ) : null}
      {/* Order is depth order, and the class names are the contract both
          chapters' timelines animate against. */}
      <span className="space-stars space-stars-far">
        <canvas ref={farRef} className="space-stars__canvas" />
      </span>
      <span className="space-stars space-stars-mid">
        <canvas ref={midRef} className="space-stars__canvas" />
      </span>
      <span className="space-stars space-stars-near">
        <canvas ref={nearRef} className="space-stars__canvas" />
      </span>
    </div>
  );
}
