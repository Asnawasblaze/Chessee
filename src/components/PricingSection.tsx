import {
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import SpaceField from "./SpaceField";
import { REFRESH_PRIORITY } from "./scrollOrder";
import { SCRUB } from "./pacing";
import "./PricingSection.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ---------------------------------------------------------------------- */
/* Pricing — four plans read against a travelling sky                      */
/* ---------------------------------------------------------------------- */

/* Where this sits in the page: straight after the Why chapter closes to black,
   as the ask. The reader has had the product (features), the story and the
   argument; this is the only section that wants something from them.
 *
 * ── The reveal is gone, and what replaced it ─────────────────────────────
 * This chapter used to be a four-act pinned performance. The title held a frame,
 * was thrown apart, and a hand of four cards climbed up out of the bottom of the
 * screen, squared up, fanned across the frame and turned over one at a time —
 * three and a half screens of pin, of which the first two and a half had the
 * terms printed on the *back* of what the reader was looking at.
 *
 * Every argument for it was an argument about the gesture, and none of them
 * answered the only question a price table has to: can it be read? A reader who
 * stopped mid-flip was looking at four blanks. A reader who arrived from the nav
 * had to be teleported past the choreography to a scroll position where the
 * prices existed (there was a `registerAnchorLanding` for it, and a focus handler
 * that scrolled the page when a CTA took the keyboard, because tabbing into a
 * face-down card is not a thing that can be styled around). All of that is
 * removed. The cards are one panel each, face up, in an ordinary grid, readable
 * at the first frame and at every frame after it.
 *
 * What carries the chapter instead is the background, and it is the only thing in
 * the section that animates:
 *
 *   The backdrop.  One viewport of sky — the same star field component the Why
 *                  chapter used to share a join with — held in the frame by a pin
 *                  for the length of the chapter while the copy scrolls over it.
 *                  Pinned rather than `position: sticky` because the page runs
 *                  under ScrollSmoother; see the note on .pricing-backdrop in the
 *                  stylesheet.
 *   The approach.  Act 1, and its own trigger, because it has to run *before* the
 *                  pin exists: the screen of scrolling between the Why chapter
 *                  ending and this chapter's first row reaching the top of the
 *                  frame. It cannot be removed — a pinned element has to unpin
 *                  somewhere — so it is given something to be. The sky expands
 *                  outward from rest (the frame is coasting, not accelerating),
 *                  the brighter region ahead comes up, and the title rides in on
 *                  the leading edge of the newly revealed sky.
 *   Act 2.         The chapter's own light, on the pin's own trigger. Three
 *                  masses low in the frame rise and spread as the reader scrolls
 *                  out of the title frame and into the table, and the table pool
 *                  comes up with them.
 *   Act 3.         The close. The frame sinks back to the base tone the run-out
 *                  band opens on and the vignette tightens, so the chapter hands
 *                  over to the FAQ on a value it can prove rather than one it
 *                  approximates.
 *
 * Two triggers, and the split is not cosmetic: each one's progress space is a
 * distance the reader can actually feel (a screen of approach, then the chapter's
 * own travel), where one trigger across both would make every authored position
 * depend on the ratio between them — which moves with the viewport's height.
 *
 * The two never write the same property on the same element, which is the other
 * half of why they can coexist. Both are scrubbed, so both re-render on every
 * refresh and the last writer wins; sharing a property between them means a
 * resize deep in the chapter has one of them reassert a state the reader left
 * behind. So the approach owns `scale` on the star layers and `autoAlpha` on the
 * arrival wash, and the pin's timeline owns the drift, the two washes below it
 * and everything keyed to --p-dusk. One owner per property.
 *
 * Motion personality: Premium — decelerating entrances, no overshoot, the same
 * constants the rest of the page is tuned at. */

interface Tier {
  id: string;
  name: string;
  /** Chess piece the tier is keyed to, per the pricing brief. */
  glyph: string;
  piece: string;
  /** Tier ink, and the same colour as space-separated channels so the panels
   *  can mix their own tints with `rgb(var(--tier-rgb) / a)` without needing
   *  a second hard-coded rgba per opacity step. */
  ink: string;
  rgb: string;
  amount: string;
  period: string;
  /** Set on the tier the brief marks as Most Popular. */
  badge?: string;
  /** Prose description, where the content has one. */
  note?: string;
  /** "Everything in <previous>, plus" — the line that makes the ladder read. */
  inherits?: string;
  features: string[];
  cta: string;
}

/* Copy is taken verbatim in substance from landing-contents.md; only the
   punctuation and the shorthand for the depth/time limits are tightened so the
   lines fit a card without wrapping to three rows. */
const TIERS: Tier[] = [
  {
    id: "basic",
    name: "Basic",
    glyph: "\u265E",
    piece: "Knight",
    ink: "#a8bcc8",
    rgb: "168 188 200",
    amount: "Free",
    period: "forever",
    note: "Everything you need to start playing and analysing.",
    features: [
      "10 free game tokens every day",
      "Full access to the Position Editor",
      "Play vs Bot, with or without analysis",
      "Play vs Stockfish, with or without analysis",
      "Browser-based analysis (WASM engine)",
      "Dark and light themes",
    ],
    cta: "Start now",
  },
  {
    id: "gold",
    name: "Gold",
    glyph: "\u265C",
    piece: "Rook",
    ink: "#e9bd6b",
    rgb: "233 189 107",
    amount: "$10",
    period: "/ month",
    note: "More tokens, and faster server-powered analysis.",
    inherits: "Everything in Basic, plus",
    features: [
      "25 free game tokens every day",
      "4\u00d7 game tokens from watching ads",
      "Exclusive Gold theme",
      "Server-based analysis, past WASM",
      "Analysis depth up to 20",
      "Analysis time up to 10 seconds",
    ],
    cta: "Get Gold",
  },
  {
    id: "platinum",
    name: "Platinum",
    glyph: "\u265B",
    piece: "Queen",
    /* The recommended tier carries the page's own accent, so the eye lands on
       it before it reads a single badge. */
    ink: "#9bd8ed",
    rgb: "155 216 237",
    amount: "$19",
    period: "/ month",
    badge: "Most popular",
    /* The one line of copy in this array that is not in the source content. The
       other three tiers have a description and this one did not, which left a
       two-line hole in the middle of the recommended card — and the recommended
       card is the one place on the page where a gap reads as an omission rather
       than as space. Written out of its own feature list rather than invented:
       separate time controls, depth 30, 20 seconds. */
    note: "Separate clocks and deeper analysis, for serious study.",
    inherits: "Everything in Gold, plus",
    features: [
      "40 free game tokens every day",
      "7\u00d7 game tokens from watching ads",
      "Exclusive Platinum theme",
      "Separate time controls for you and the bot",
      "Analysis depth up to 30",
      "Analysis time up to 20 seconds",
    ],
    cta: "Get Platinum",
  },
  {
    id: "diamond",
    name: "Diamond",
    glyph: "\u265A",
    piece: "King",
    ink: "#c9c4ff",
    rgb: "201 196 255",
    amount: "$50",
    period: "/ month",
    note: "The complete toolkit \u2014 maximum power and customisation.",
    inherits: "Everything in Platinum, plus",
    features: [
      "100 free game tokens every day",
      "10\u00d7 game tokens from watching ads",
      "Diamond theme",
      "Custom Theme Builder",
      "Analysis depth up to 45",
      "Analysis time up to 30 seconds",
      "Early access to beta features",
    ],
    cta: "Get Diamond",
  },
];

/* ── Pointer response on a card ──────────────────────────────────────────
   One cue, one pointer: a soft specular highlight sits under it, written out as
   two custom properties on the card and consumed in CSS (see `--px` / `--py` on
   .pricing-card), because the transition that fades the layer belongs to the
   stylesheet and a tween would fight it.
 *
 * The lean is gone. A card that rotates on two axes under the pointer also
 * rotates the six lines of feature copy a reader is trying to compare against the
 * card next to it, and a price table is the one composition on this page whose
 * entire job is that comparison. What is left is the light — which reads as a
 * material surface without moving the type off axis. */

/* The star layers' scales across the approach, and a contract with the chapter
   above as much as a choice: the Why chapter's threshold (see .why-threshold in
   WhySection.css) mounts this same field in its own last frame and expands its
   three depths by these exact factors, off its own progress, over the exact same
   screen of scroll. The two triggers are measured from either side of one join —
   this one starts where that section's last row reaches the fold, which is where
   that one starts too — so matching the rates is enough to make the fields
   travelling at the same speed as they cross each other. Change these and the
   other three lines have to change with them.

   Starting at 1, the field's own resting scale, because nothing is handing off an
   in-progress scale: the threshold starts from rest on the same frame this does.
 *
 * The scale stops at the end of the approach and the pin's timeline takes over
 * with a *drift* rather than more scale, for two reasons: the star layers are
 * canvases, so scaling them past ~1.5 starts to show as softness, and a translate
 * at these depths reads as the frame coasting rather than the sky simply growing.
 * It is also what keeps the two timelines off each other's properties. */
const SKY_FROM = { far: 1, mid: 1, near: 1 };
const SKY_TO = { far: 1.1, mid: 1.24, near: 1.48 };

export default function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  /* The pin and every background position are measured off the chapter rather
     than the section, so the section is free to carry the run-out band
     underneath without either of them measuring it. */
  const chapterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  /* The hovered card's box, measured once on entry rather than on every move.
     Two reasons, and the second is the important one: a rect read per
     `pointermove` forces a style recalculation on a frame whose transforms the
     scrub is already writing, and — since the hover state itself lifts and leans
     the panel — measuring mid-hover would feed the lean its own output. One card
     can be hovered at a time, so one slot is enough. */
  const hoverBox = useRef<DOMRect | null>(null);

  const beginPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    hoverBox.current = event.currentTarget.getBoundingClientRect();
  }, []);

  const trackPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const box = hoverBox.current ?? card.getBoundingClientRect();
    if (!box.width || !box.height) return;

    /* Where the highlight sits, as a percentage of the card, straight through. */
    card.style.setProperty(
      "--px",
      `${(((event.clientX - box.left) / box.width) * 100).toFixed(2)}%`
    );
    card.style.setProperty(
      "--py",
      `${(((event.clientY - box.top) / box.height) * 100).toFixed(2)}%`
    );
  }, []);

  /* Nothing is reset on the way out. The highlight's position is left where the
     pointer left it so the layer fades out from there — reset to centre, it would
     visibly slide back across the card as it disappears. Only the cached rect
     goes. */
  const endPointer = useCallback(() => {
    hoverBox.current = null;
  }, []);

  useGSAP(
    () => {
      const chapter = chapterRef.current;
      const backdrop = backdropRef.current;
      if (!chapter || !backdrop) return;

      /* Bodoni is a webfont and both the tier names and the prices are set in
         it, so the chapter's height — and every trigger position after it on the
         page — is measured against fallback metrics until it lands. */
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      const mm = gsap.matchMedia(sectionRef);

      /* Reduced motion: no pin, no scrub, no background ramp. The backdrop holds
         itself in the frame with `position: sticky` instead (there is no
         ScrollSmoother in this branch, so sticky works — see the stylesheet), and
         the washes are simply on, at the values the ramp would have spent the
         chapter reaching.

         The layout is not branched. There is only one layout now, and that is the
         point of the rework: what differs between a reader who wants motion and
         one who does not is how the background behaves, not whether the prices
         can be read. */
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(".pricing-rule", { autoAlpha: 1, scaleX: 1 });
        gsap.set(".pricing-standfirst", { autoAlpha: 1, y: 0 });
        gsap.set(".pricing-core", { autoAlpha: 0.7 });
        gsap.set(".pricing-bloom", { autoAlpha: 0.8 });
        gsap.set(".pricing-table-light", { autoAlpha: 0.5 });
        /* The closing wash is on here too, at about half, and it is not
           decoration: the backdrop's last row hands straight over to the run-out
           band, and without it that row is a lit sky meeting a flat tone. Half
           strength is enough for the join and light enough that the frame is still
           a sky rather than a dark card. */
        gsap.set(".pricing-dusk", { autoAlpha: 0.55 });
        gsap.set(backdrop, { "--p-dusk": 0.5 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        /* ── The frame the chapter opens on ────────────────────────────────
           The title, the rule, the standfirst and the cue are all plain and
           on screen from the first frame — no assembly, no fade, no slide.
           Only the background (the sky, the light, the parallax) still
           animates as the reader scrolls through the chapter. */
        gsap.set(".pricing-rule", { autoAlpha: 1, scaleX: 1 });
        gsap.set(".pricing-standfirst", { autoAlpha: 1, y: 0 });
        gsap.set(".pricing-cue", { autoAlpha: 1, y: 0 });

        /* ── The approach ─────────────────────────────────────────────────
           The screen of scrolling between the Why chapter's pin releasing and
           this chapter's first row reaching the top of the frame, and the reason
           it is no longer a blank stretch.
         *
         * It cannot be removed. When the Why stage unpins it still has its own
         * 100svh to roll off the top before this chapter's top can reach the
         * viewport top — measured at 1241px on a 900px frame. Overlapping the two
         * sections with a negative margin does not help either: this chapter's
         * sky is opaque, so the overlap slides a page-sized sheet up over a frame
         * that is still frozen.
         *
         * So it gets given something to be. `start: "top bottom"` is the moment
         * this chapter's first row crosses the bottom of the screen, which is also
         * the moment the Why stage begins to leave; `end: "top top"` is the moment
         * the pin below takes over. */
        const headRise = () => {
          const head = chapter.querySelector<HTMLElement>(".pricing-head");
          const title = chapter.querySelector<HTMLElement>(".pricing-title-plain");
          if (!head || !title) return 0;
          /* The word's centre, measured down from the chapter's first row: the
             head is the stage's first child and the stage's top is the chapter's
             top, so these two offsets sum to it. */
          const mid = head.offsetTop + title.offsetTop + title.offsetHeight / 2;
          return Math.max(0, mid - window.innerHeight * 0.11);
        };

        const approach = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: chapter,
            start: "top bottom",
            end: "top top",
            scrub: SCRUB,
            refreshPriority: REFRESH_PRIORITY.pricing,
            invalidateOnRefresh: true,
          },
        });

        approach
          /* Coasting: three star fields expanding outward from rest, at three
             rates. See SKY_FROM for why the starting scale is 1. */
          .fromTo(
            ".pricing-sky .space-stars-far",
            { scale: SKY_FROM.far },
            { scale: SKY_TO.far, duration: 1 },
            0
          )
          .fromTo(
            ".pricing-sky .space-stars-mid",
            { scale: SKY_FROM.mid },
            { scale: SKY_TO.mid, duration: 1 },
            0
          )
          .fromTo(
            ".pricing-sky .space-stars-near",
            { scale: SKY_FROM.near },
            { scale: SKY_TO.near, duration: 1 },
            0
          )
          /* The brighter region the reader is heading into. Decelerating, so most
             of it has happened by the time the pin takes over and the title frame
             does not open on a background that is still changing colour. Nothing
             below ever writes this layer again — the closing wash darkens it
             instead of arguing with it. */
          .fromTo(
            ".pricing-core",
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.8, ease: "power2.out" },
            0.1
          )
          /* ── The word rides the leading edge of the new sky ──────────────
             The head is a full frame with its column centred, so left alone the
             word sits about a third of a screen below the chapter's first row —
             which means for most of the approach the reader is watching a sky come
             up with no title in it, or with the title still under the fold. The
             chapter announces itself as an empty galaxy and only names itself once
             the pin has almost engaged.

             Both extremes have been tried and both are wrong. Static: the word
             arrives a screen late, which is the complaint above. A full
             counter-scroll — lifting the layer by exactly the distance the chapter's
             top is still short of the viewport's — parks it dead centre from the
             fold onward and motionless for the whole approach *plus* the title
             frame's own screen, which reads as a title stuck to the glass following
             the reader down the page rather than one held in a frame.

             So the head is lifted by its own offset instead of by the viewport's,
             and released across the approach. The word travels — plainly moving with
             the sky rather than glued to the screen — but it travels *inside the top
             of the revealed sky* the whole way. `power2.in` rather than the
             timeline's linear default because the shape is the point: released
             linearly the word starts at the sky's leading edge and then falls
             steadily behind it, where easing in holds nearly all of the lift through
             the first half. At p = 1 the lift is zero, so the pin inherits a layer at
             rest in its own flow position and nothing shifts at the handover.

             Less a tenth of a viewport of clearance, which is what keeps this
             honest: the particle field is a scatter radius taller than its
             letterforms, and lifting by the full offset would push the top of the
             word over the section above at the exact moment the sky's first row
             appears.

             Function-based and re-read on every invalidate: the offset comes out of
             layout, and the head's height is svh while the title's box is a clamp,
             so a resize changes it. */
          .fromTo(
            ".pricing-head",
            { y: () => -headRise() },
            { y: 0, duration: 1, ease: "power2.in" },
            0
          );

        /* ── The chapter: the backdrop held, and the light changing on it ──
           One scrubbed timeline, and the pin hangs off its own trigger so the two
           can never disagree about where the chapter starts and stops.

           `pinSpacing: false` because the backdrop's box is already cancelled out
           by the stage's negative top margin (see the stylesheet); letting
           ScrollTrigger add its own spacer would insert a screen of empty page
           between the title and the table. `end: "bottom bottom"` releases the pin
           at the exact scroll position where the chapter's last row reaches the
           bottom of the frame, which is where the run-out band takes over.

           Positions below are fractions of that travel. The chapter is roughly two
           frames of content plus a closing stretch, so the title frame holds at 0,
           the table is centred around 0.8, and the last fifth is the reader leaving
           — which is what the three acts are timed against. */
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: chapter,
            start: "top top",
            end: "bottom bottom",
            pin: backdrop,
            pinSpacing: false,
            // A little lag so the frame feels like it carries mass rather than
            // snapping to the wheel. One value for the whole page — see pacing.ts.
            scrub: SCRUB,
            // Without this, a fast fling leaves the scrub still easing toward a
            // scroll position the reader has already left.
            fastScrollEnd: true,
            anticipatePin: 1,
            // Last in document order among the page's scroll sections, so it
            // refreshes last and measures against every pin above it — see
            // scrollOrder.ts for why the order has to be declared at all.
            refreshPriority: REFRESH_PRIORITY.pricing,
            invalidateOnRefresh: true,
          },
        });

        tl
          /* ── Ambient ────────────────────────────────────────────────────
             Runs the whole chapter so the frame is never frozen: the sky keeps
             travelling, the two masses cross each other, and the floor recedes.
             Nothing here is an event — it is what makes the held frame a place
             rather than a picture of one.

             Drift rather than more scale (see SKY_TO), in the same 1:2:3.3 ratio as
             the parallax the pointer drives inside the field, so the two motions
             belong to one space. Well inside the margin the layers' own scale gives
             them, so no edge can come into frame. */
          .fromTo(
            ".pricing-sky .space-stars-far",
            { yPercent: 0 },
            { yPercent: -1.1, duration: 1 },
            0
          )
          .fromTo(
            ".pricing-sky .space-stars-mid",
            { yPercent: 0, xPercent: 0 },
            { yPercent: -2.2, xPercent: -0.5, duration: 1 },
            0
          )
          .fromTo(
            ".pricing-sky .space-stars-near",
            { yPercent: 0, xPercent: 0 },
            { yPercent: -3.6, xPercent: -1.2, duration: 1 },
            0
          )
          /* The two nebula masses cross the frame against each other, so the sky is
             never the same shape twice. They belong to the shared field rather than
             to this chapter's markup — the Why chapter renders the same component
             with `nebula` off, so these two elements only exist here and this
             timeline is their only owner. */
          .fromTo(
            ".pricing-sky .space-nebula-a",
            { yPercent: -7, xPercent: 5, autoAlpha: 0.5 },
            { yPercent: 10, xPercent: -4, autoAlpha: 1, duration: 1 },
            0
          )
          .fromTo(
            ".pricing-sky .space-nebula-b",
            { yPercent: 9, xPercent: -6, autoAlpha: 0.65 },
            { yPercent: -8, xPercent: 4, autoAlpha: 1, duration: 1 },
            0
          )
          /* Scrubbed as a registered length rather than as a transform, because the
             element's own transform carries the perspective and rotateX that make it
             a floor instead of a flat grid, and GSAP would recompose the list and
             drop them. */
          .fromTo(
            ".pricing-files",
            { "--p-files-y": "24px" },
            { "--p-files-y": "-20px", duration: 1 },
            0
          )
          /* The light's own position, driven as one number so the wash below can
             move its stops with it. Linear on purpose: this is the chapter's clock,
             and the acts ease against it rather than it easing against them. */
          .fromTo(backdrop, { "--p-dusk": 0 }, { "--p-dusk": 1, duration: 1 }, 0)

          /* ── Act 2: the chapter's own light ─────────────────────────────
             Comes up as the reader scrolls out of the title frame and into the
             table, and is fully up by the time the row is centred — so the cards
             arrive lit rather than being lit once they have arrived. */
          .fromTo(
            ".pricing-bloom",
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.4, ease: "power2.out" },
            0.34
          )
          .fromTo(
            ".pricing-table-light",
            { autoAlpha: 0.16 },
            { autoAlpha: 0.7, duration: 0.38, ease: "power2.out" },
            0.4
          )

          /* ── Act 3: the close ───────────────────────────────────────────
             The last fifth, where the reader is already leaving. The vignette
             narrows onto the table and the frame sinks back to the tone it arrived
             on, so the chapter hands over on the value the run-out band opens with
             rather than on a lit sky cut off by a gradient.

             Both are single tweens on their own property. Nothing takes the bloom or
             the table pool back down — the closing wash sits above both and darkens
             them, which is one layer doing the work instead of three tweens racing
             to agree about it. */
          .fromTo(
            ".pricing-vignette",
            { autoAlpha: 0.72 },
            { autoAlpha: 1, duration: 0.24, ease: "power2.in" },
            0.76
          )
          .fromTo(
            ".pricing-dusk",
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.22, ease: "power2.in" },
            0.78
          );

        /* Everything created inside this matchMedia context is reverted by GSAP
           when the context stops matching, both timelines included. */
      });
    },
    { scope: sectionRef }
  );

  return (
    <section
      id="pricing"
      className="pricing-section"
      ref={sectionRef}
      aria-labelledby="pricing-title"
    >
      <div className="pricing-chapter" ref={chapterRef}>
        {/* ── The background ──────────────────────────────────────────────
            One viewport of sky, held in the frame for the length of the chapter
            and the only thing in this section that moves. Everything in here is
            decoration, so the whole layer is out of the accessibility tree. */}
        <div className="pricing-backdrop" ref={backdropRef} aria-hidden="true">
          {/* The sky, and the second of two instances of it: the Why chapter's
              threshold opens on the same component so the two are already one
              surface by the time the join between the sections crosses the frame.
              The nebula is on here and off there, which is the difference between
              the place the reader arrives at and the bare sky they arrive through
              — and the component masks the masses away from its own top edge, so
              this frame's first row stays the plain field that one ends on. */}
          <SpaceField className="pricing-sky" nebula />
          {/* The brighter region ahead. Kept out of the sky component precisely
              because it has a position, and a field with a position cannot be the
              thing two chapters share. */}
          <span className="pricing-core" />
          {/* Act 2 and act 3 of the background change: the chapter's own light
              rising under the table, and the dark that closes the frame back to
              the base tone the run-out band opens on. */}
          <span className="pricing-bloom" />
          <span className="pricing-dusk" />
          {/* The surface the cards sit on: a pool of table light, a receding rank
              grid on the board's 8-cell rhythm, the table's far edge — then grain
              and a vignette as frame furniture over the lot. */}
          <div className="pricing-atmosphere">
            <span className="pricing-table-light" />
            <span className="pricing-files" />
            <span className="pricing-horizon" />
            <span className="pricing-grain" />
            <span className="pricing-vignette" />
          </div>
        </div>

        <div className="pricing-stage">
          {/* ── The title ─────────────────────────────────────────────────
              A frame of its own, centred, because the composition already has a
              subject — the sky the reader has just come through — and type set to
              one side of it would be a headline ignoring what it is standing
              in. */}
          <div className="pricing-head">
            <h2 className="pricing-title-plain" id="pricing-title">
              Pricing
            </h2>

            <span className="pricing-rule" aria-hidden="true" />

            {/* One line, and it does the cue's talking: says where to go, in the
                chapter's own display face. */}
            <p className="pricing-standfirst">
              Scroll down to explore the pricing you need
            </p>

            {/* Scroll indicator, and wordless: the line above says where to go, so
                repeating it in a label would be the same instruction twice. What
                is left is the direction itself — a light falling down a track, and
                a chevron landing a beat after it. */}
            <span className="pricing-cue" aria-hidden="true">
              <i>
                <b />
              </i>
              <svg viewBox="0 0 24 24">
                <path
                  d="M12 5v14m0 0-6-6m6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          {/* ── The row ───────────────────────────────────────────────────
              Four plans as one grid, one surface each, read top to bottom in the
              order a reader actually decides in: what tier this is → what it costs
              → what it is for → the button → what you get. Nothing is hidden,
              nothing turns over, and nothing here depends on a scroll position, so
              the accessibility tree and the frame say the same thing. */}
          <div className="pricing-plans">
            {TIERS.map((tier) => (
              <article
                className={`pricing-card${tier.badge ? " is-featured" : ""}`}
                key={tier.id}
                /* Pointer-lit, and only on the card the pointer is actually on —
                   the handlers write two custom properties and read one cached
                   rect, so a row of four costs nothing until one of them is
                   hovered. `pointerenter` rather than `mouseenter` so a stylus and
                   a trackpad get the same card as a mouse; touch never fires a
                   sustained move over a card, so it simply never lights up, which
                   is the right answer for a device with no hover. */
                onPointerEnter={beginPointer}
                onPointerMove={trackPointer}
                onPointerLeave={endPointer}
                style={
                  {
                    "--tier": tier.ink,
                    "--tier-rgb": tier.rgb,
                  } as CSSProperties
                }
              >
                <div className="pricing-panel">
                  {/* The panel's finish: one pointer-lit specular layer over the
                      whole surface. The foil ring that used to sit inside the cut
                      edge is gone — the panel is a single surface now, so its own
                      1px rim and top-edge catch do that job without a second
                      composited layer per card. */}
                  <span className="pricing-sheen" aria-hidden="true" />

                  {/* ── What the tier is, and what it costs ───────────────
                      Every row in here is on a reserved height, so the four
                      cards' names, prices, descriptions and buttons each land on
                      one shared line across the row. That alignment is the whole
                      point of a price table: the eye compares along a row, and a
                      row that steps because one tier has no description line is a
                      row the reader has to re-find four times. */}
                  <header className="pricing-head-band">
                    {/* A row of its own, reserved on all four cards whether or
                        not the tier carries a badge. Beside the tier name it fit
                        at two columns and collided at four — "Platinum" plus a
                        105px seal is wider than a 236px card's text column — and a
                        badge that crowds the name it is meant to promote promotes
                        nothing. Reserved rather than conditional so the names,
                        prices and buttons below it stay on one line across the
                        row. */}
                    <span className="pricing-badge-slot">
                      {tier.badge ? (
                        <span className="pricing-badge">{tier.badge}</span>
                      ) : null}
                    </span>

                    <div className="pricing-flag">
                      <span className="pricing-glyph" aria-hidden="true">
                        {tier.glyph}
                      </span>
                      <span className="pricing-ident">
                        <h3 className="pricing-tier">{tier.name}</h3>
                        <span className="pricing-piece">{tier.piece}</span>
                      </span>
                    </div>

                    <p className="pricing-price">
                      <em>{tier.amount}</em>
                      <i>{tier.period}</i>
                    </p>

                    {/* Two lines of room, always — see the note on
                        .pricing-note. */}
                    <p className="pricing-note">{tier.note}</p>
                  </header>

                  {/* Directly under the price, not under the list. A reader who
                      has decided at the price should not have to travel six
                      feature lines to act on it, and putting the button here also
                      lands all four buttons on one line regardless of how many
                      features the tier has. */}
                  <a
                    className={`pricing-cta${tier.badge ? " is-primary" : ""}`}
                    href="#pricing"
                    aria-label={`${tier.cta} — ${tier.name} plan`}
                  >
                    <span>{tier.cta}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M4 12h15m0 0-6-6m6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>

                  <div className="pricing-included">
                    {/* "Everything in Gold, plus" is what makes the ladder read;
                        the entry tier has nothing below it to inherit from, so it
                        gets the plain structural label instead of an empty rule. */}
                    <p className="pricing-inherits">
                      {tier.inherits ?? "What's included"}
                    </p>
                    <ul className="pricing-features">
                      {tier.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="pricing-footnote">
            Prices in USD &middot; cancel anytime &middot; tokens reset every day
          </p>
        </div>
      </div>

      {/* Run-out, so the page does not step straight from this chapter's sky to
          the FAQ's near-black. */}
      <div className="pricing-tail" aria-hidden="true" />
    </section>
  );
}
