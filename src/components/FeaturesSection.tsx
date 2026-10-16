import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Clouds from "./Clouds";
import { REFRESH_PRIORITY } from "./scrollOrder";
import { scrollOffset } from "./smoothScroll";
import { registerAnchorLanding } from "./anchorScroll";
import { beatSettle, settleReach, snapHold } from "./beatSnap";
import { BEAT_VH, SCRUB } from "./pacing";
import "./FeaturesSection.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ---------------------------------------------------------------------- */
/* Scroll choreography                                                     */
/* ---------------------------------------------------------------------- */

/* There is exactly one cloud layer for the whole transition, and scroll is
   the only thing that drives it: it rises out of the bottom of the frame as
   the hero's dark run-out band appears, thickens into the whiteout, then
   clears onto the light theme — and unwinds the same way scrolling back up.

   The scroll range is authored in viewport heights. LEAD is the head start
   the fog gets *before* this section reaches the viewport bottom, which is
   the stretch where it's only mist hanging below the artwork. */
const LEAD = 0.5;

/* ── The readable hold ───────────────────────────────────────────────────
   Scroll distance the chapter keeps *after* its last line has landed, so the
   copy is a frame the reader arrives at rather than one they pass through.

   This is the fix for the worst pacing on the page. The section was two
   viewports tall, the copy was authored to finish at 0.98 of the resulting
   range, and 0.98 of a 2.5-viewport range on a 900px frame leaves 45px of
   scroll — two notches of a wheel — between the last word arriving and the pin
   releasing into the next chapter. The whole chapter therefore read as a long,
   expensive fog transition that ended by flashing five lines of type, and every
   attempt to fix it by slowing the copy down made it worse: the beats were
   already tuned, and stretching them just meant reading type that was still
   moving.

   Nothing about the fog or the copy changes here. The section simply gets a
   readable frame's worth of extra height, all of it added *after* the copy is
   set — see `s` below, which keeps every authored beat at the physical distance
   it was tuned at rather than stretching it into the new room. */
const HOLD = BEAT_VH;

/* The section's own height, in viewport heights. Declared in the CSS too — see
   `.features-section` — and the two have to agree: the timeline's whole ratio is
   derived from this number and the pin adds no spacing of its own. */
const SPAN = 2 + HOLD;

/* The timeline's scroll range: the section's height plus the head start the fog
   gets above it. Measuring from `top bottom+=LEAD` to `bottom bottom` gives
   (SPAN + LEAD) viewports, and the stage first fills the screen (1 + LEAD)
   viewports in:

     progress 0                – fog is still below the fold
     progress ENTER            – this section's top reaches the viewport
                                 bottom; the hero's band is mid-frame
     progress PEAK             – the stage fills the screen and the curtain
                                 is opaque: the only safe frame to swap the
                                 page from the dark palette to the light one
     progress COPY_END         – the last line of copy is in
     progress 1                – the stage unpins */
const RANGE = SPAN + LEAD;

const PEAK = (1 + LEAD) / RANGE;

/* Progress at which this section's top reaches the viewport bottom — the end
   of the lead-in. Up to here the fog is only a band of mist hanging under the
   artwork; after it, the surge to whiteout begins. */
const ENTER = LEAD / RANGE;

/* The reveal after PEAK was authored against a 2-viewport range. LEAD and now
   HOLD both made the range longer, so scaling those durations keeps every beat
   the same *physical* scroll distance it was tuned at instead of stretching it —
   which is what turns HOLD into hold rather than into a slower reveal. */
const s = (fraction: number) => fraction * (2 / RANGE);

/* Where the copy finishes: the cue is the last thing in, opening at s(0.36)
   past PEAK and running for s(0.12). Derived rather than measured, so the hold
   below cannot silently disappear if a beat is retimed. */
const COPY_END = PEAK + s(0.48);

/* Where a nav jump to #features lands, and the frame a gesture settles onto.
   The section's top edge is PEAK — the opaque middle of the whiteout, and a
   deliberately empty frame — so the top of the section is the one place in the
   chapter not worth linking to. A little past COPY_END: everything is set,
   nothing is still moving, and there is most of the hold left to run so the
   reader is not delivered onto the last frame before the pin releases. */
const ANCHOR_AT = COPY_END + (1 - COPY_END) * 0.3;

/* Progress at which the artwork itself starts dissolving (see the hero
   opacity tween below). Until then the fog is not allowed to climb over the
   picture; after it, the artwork is on its way out anyway, so the fog can
   take the whole frame for the whiteout. */
const HERO_DISSOLVE = PEAK - s(0.24);

/* How far past the artwork's bottom edge the fog is allowed to reach while
   the picture is still up. 40px is inside the part of the frame the hero's
   own gradient has already taken to ~90% black, so the fog never lies over
   artwork you can actually see — it stays *below* the image and grows as the
   image scrolls up out of the way. */
const MIST_LIFT = 40;

/* Extra climb (in viewport heights) once the artwork is dissolving, so the
   curtain is full-frame well before the palette swap. */
const MIST_OPEN = 1.3;

/* Fog drifts up at a fraction of the scroll speed. Without it the texture is
   pinned to the viewport while the mask moves with the page, which is what
   makes the cloud look like it re-draws on every scroll step instead of
   sitting in the scene. */
const MIST_DRIFT = 0.08;
const MIST_DRIFT_MAX = 120;

/* Density the mist holds through the lead-in, before the whiteout surge. */
const MIST_BAND_OPACITY = 0.3;

// Motion personality: Premium (elegant, no overshoot). Fog is a "gas"
// material, so everything here is deliberately slow and eased gently —
// the mist never snaps.
const TITLE = "Features";

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  // The WebGL mist stays mounted for the whole page (see the `paused` prop
  // passed below) and is only *paused* while the section is out of reach of
  // the viewport. It used to be mounted/unmounted here instead, which tore
  // down and rebuilt the GL context + recompiled every shader each time the
  // curtain came back into range — cheap in absolute terms, but enough to
  // read as the cloud visibly "popping in" a beat after it should already
  // be there. Pausing keeps the context (and its compiled shaders/textures)
  // alive, so re-arming is just resuming a loop, not rebuilding one.
  //
  // A second full-screen cloud simulation running alongside the hero's for
  // the whole page would still be wasted work — the hero's own instance
  // pauses itself when it scrolls out of view (IntersectionObserver in
  // Clouds.tsx), but this curtain is `position: fixed` and would therefore
  // always read as on-screen and never pause on its own. Hence the explicit
  // arm/disarm scroll trigger below controls the pause instead.
  const [mistArmed, setMistArmed] = useState(false);

  useGSAP(
    () => {
      const section = sectionRef.current;
      const stage = stageRef.current;
      const curtain = curtainRef.current;
      if (!section || !stage || !curtain) return;

      /* Holds the stage to the top of the frame for the section's second
         viewport — the sticky behaviour the CSS used to carry (see the note on
         .features-stage for why it can't any more). Created unconditionally
         rather than inside the matchMedia below, because this is layout, not
         choreography: the reduced-motion path drops the fog timeline but still
         needs the title to hold the frame rather than fly past it.

         `pinSpacing: false` because the section already reserves the room: it is
         SPAN viewports tall by declaration and the timeline's whole ratio (see
         PEAK) is authored against that, so letting the pin add its own spacer
         would both stretch the page and desynchronise the fog. The stage is
         therefore held for the section's last (SPAN - 1) viewports, which is
         where the copy arrives and where HOLD's readable frame sits. */
      const pin = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
        anticipatePin: 1,
        refreshPriority: REFRESH_PRIORITY.features,
      });

      /* The curtain is portaled to the document body (see the render below for
         why), so it is outside this effect's `scope` and a scoped selector
         string would no longer find anything inside it. Resolved to real
         elements once here instead — GSAP only applies the scope to *strings*,
         so passing the nodes themselves works from anywhere in the document. */
      const veil = curtain.querySelector(".features-veil");
      const mist = curtain.querySelector<HTMLElement>(".features-mist");
      const mistLayer = curtain.querySelector(".features-mist-layer");

      const arm = ScrollTrigger.create({
        trigger: section,
        // A short head start on the timeline's own range (which begins at
        // `top bottom+=LEAD`), no more. This used to be armed a further 1.2
        // viewports out so that shader compilation happened away from the
        // moment the fog became visible — Clouds now draws one warm-up frame
        // at construction instead (see the render(0) call there), so the
        // pipeline is already hot and the layer can stay parked until it is
        // nearly needed. That matters because a running cloud layer competes
        // with the hero's for the shared per-frame render budget.
        start: `top bottom+=${(LEAD + 0.25) * 100}%`,
        end: "bottom top",
        refreshPriority: REFRESH_PRIORITY.features,
        onToggle: (self) => setMistArmed(self.isActive),
      });
      if (arm.isActive) setMistArmed(true);

      /* Reached across components on purpose. The curtain is a full-viewport
         overlay, so while the fog thickens the dark chapter above is *behind*
         it — and fog occludes what's behind it. Without the dissolve that
         chapter just scrolled away at full brightness under the haze, leaving
         a hard horizontal edge where it stopped and this section's dark base
         began.

         Both targets are found by marker attribute rather than by class,
         because "the dark chapter directly above" is not always the hero:
         WhySection now sits between them and carries the markers instead.
         Resolved lazily (see resolveDissolve/measureSeam) since that section
         is code-split and may still be loading when this effect runs, with
         the hero as the fallback for the frames before it lands. */
      // Proxy the timeline scrubs; the value is written to the real element in
      // the tween's onUpdate (see the dissolve tween below for why).
      const dissolve = { v: 1 };
      let dissolveEl: HTMLElement | null = null;
      const resolveDissolve = () => {
        dissolveEl ??=
          document.querySelector<HTMLElement>("[data-fog-dissolve]") ??
          document.querySelector<HTMLElement>(".hero-section");
        return dissolveEl;
      };
      /* The dark chapter's run-out band. Its top edge is the line the fog has
         to sit across. Two queries rather than one selector list: `.hero-tail`
         comes *earlier* in the document than the marked band, and
         querySelector returns the first match in document order, so a list
         would always resolve to the fallback. */
      const findSeam = () =>
        document.querySelector<HTMLElement>("[data-fog-seam]") ??
        document.querySelector<HTMLElement>(".hero-tail");
      let seamEl = findSeam();

      /* `seamEl`'s position in the *document* is static — only scrollY moves
         it around the viewport. Reading `getBoundingClientRect()` from
         inside the per-frame tick (as this used to do) forces a synchronous
         layout every time it runs alongside GSAP's own per-frame style
         writes elsewhere in this timeline, which is real, measurable jank:
         a Chrome performance trace on this exact scroll attributed ~4.3s of
         forced reflow across a 3.8s scroll test to this call. Caching the
         element's absolute offset once (and re-measuring only on resize)
         turns the per-frame cost into plain arithmetic that never touches
         layout, which is what removes the stutter in both the cloud's
         reveal and the dark/light swap it's gated on. */
      let seamAbsoluteTop = 0;
      // `window.innerHeight` is *also* a forced-reflow trigger, not just
      // `getBoundingClientRect()` — reading it right after this same tick's
      // GSAP tweens have written style/transform to a dozen elements is
      // exactly what makes the browser flush that pending layout work
      // synchronously. Cached alongside the seam measurement for the same
      // reason.
      let viewportHeight = window.innerHeight;
      const measureSeam = () => {
        viewportHeight = window.innerHeight;
        // Re-resolved every time, not just on the first pass: the marked band
        // belongs to a lazily-loaded section, so the element this should be
        // measuring can appear after the initial measurement.
        seamEl = findSeam();
        if (!seamEl) return;
        /* `scrollOffset()`, not `window.scrollY`: with the smoother running the
           content is painted at an eased offset a fraction behind the native
           scroll position, and `getBoundingClientRect()` reports where the
           element *is drawn*. Adding the native scroll to a smoothed rect would
           bake the current lag into a value that is supposed to be constant. */
        seamAbsoluteTop = seamEl.getBoundingClientRect().top + scrollOffset();
      };
      measureSeam();
      window.addEventListener("resize", measureSeam);

      /* Scroll offset was the last piece. Reading `window.scrollY` live inside
         the per-frame tick could itself force a synchronous layout — with
         `.features-stage` using `position: sticky`, resolving the current scroll
         position can need an up-to-date layout, and doing that in the same tick
         as GSAP's pending style writes is what flushes them. It used to be
         cached off a passive scroll listener for that reason.
         `scrollOffset()` supersedes both concerns: while the smoother is
         running it returns the smoother's own cached, already-eased offset —
         plain arithmetic, no layout, and the value the content is *painted* at
         rather than the value the document has scrolled to. That second part is
         what keeps the fog's edge welded to the artwork's bottom edge instead
         of racing ahead of it by however far the smoother is currently
         behind. */
      // Covers the cases resize doesn't: late-loading hero artwork or web
      // fonts shifting `.hero-tail` down the document after this measured
      // it once. ScrollTrigger already refreshes on those (its own resize
      // + load handling), so piggybacking on that event re-measures the
      // seam exactly when it might actually be stale.
      ScrollTrigger.addEventListener("refresh", measureSeam);


      /* The one piece of per-scroll work: where the fog's top edge is, in
         viewport pixels. It tracks the artwork's bottom edge as that edge
         scrolls up the screen and climbs further over it as the transition
         builds, so the fog is always eating the picture from below rather
         than fading in on top of it. Written to a custom property that both
         the cloud layer and the bright veil are masked by, so a single
         number keeps them in step. Clamps to 0 well before PEAK, which is
         what lets the curtain go fully opaque. */
      /* Last written --mist-top, so trackSeam can skip the write once a value
         has stopped moving. NaN rather than 0 so the very first call — where
         "stopped moving" is meaningless — always writes. */
      let lastTop = Number.NaN;
      const trackSeam = (progress: number) => {
        const vh = viewportHeight;
        const feather = Math.min(280, Math.max(130, vh * 0.24));
        const seam = seamEl ? seamAbsoluteTop - scrollOffset() : 0;
        // Locked to the artwork's bottom edge, so the fog's edge moves at
        // exactly the scroll speed instead of racing the page — which is what
        // made it read as a jump on every scroll step. The band grows because
        // the picture leaves, not because the mask accelerates.
        const opening = Math.max(
          0,
          (progress - HERO_DISSOLVE) / (PEAK - HERO_DISSOLVE)
        );
        // Squared, so the extra climb starts from zero *rate* rather than
        // kicking in at full speed — otherwise the fog's edge visibly changes
        // gear the moment the artwork begins to dissolve.
        const open = opening * opening;
        // Allowed to go negative by the full feather, which pushes the soft
        // leading edge off the top of the screen. Without that headroom the
        // curtain keeps a semi-transparent ramp across the top of the frame
        // even at peak, and the palette swap shows through it.
        const top = Math.max(
          -feather - 2,
          Math.min(vh, seam - MIST_LIFT - MIST_OPEN * vh * open)
        );
        const drift = Math.max(
          -MIST_DRIFT_MAX,
          Math.min(0, (seam - vh) * MIST_DRIFT)
        );
        /* Skipped once a value has stopped moving, which is most frames a
           reader who has stopped scrolling sits through. `arm` gates *whether*
           this runs at all, but a reader parked anywhere inside the armed range
           — not just at rest between chapters, mid-fog counts too — was still
           getting three `setProperty` calls every animation frame for as long
           as they held still, because `progress` had not changed and neither
           had anything this computes from it. The three properties always move
           together (all three are functions of the same `seam`/`progress`
           pair), so one guard on the cheapest of them covers all three. */
        if (Math.abs(top - lastTop) < 0.05) return;
        lastTop = top;
        curtain.style.setProperty("--mist-feather", `${feather.toFixed(1)}px`);
        curtain.style.setProperty("--mist-top", `${top.toFixed(1)}px`);
        curtain.style.setProperty("--mist-drift", `${drift.toFixed(1)}px`);
      };

      const mm = gsap.matchMedia(sectionRef);

      mm.add("(prefers-reduced-motion: reduce)", () => {
        // No fog transition: land straight on the light theme with the copy
        // already in place.
        gsap.set(".features-sky", { opacity: 1 });
        gsap.set(curtain, { opacity: 0, "--mist-top": "0px" });
        gsap.set(
          [
            ".features-letter",
            ".features-eyebrow",
            ".features-lede",
            ".features-cue",
          ],
          { opacity: 1, y: 0, filter: "blur(0px)" }
        );
        gsap.set(".features-rule", { opacity: 1, scaleX: 1 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({
          // Durations here are *scroll progress fractions*, not seconds, so
          // the timeline's total length is exactly 1.
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: `top bottom+=${LEAD * 100}%`,
            end: "bottom bottom",
            // Slight lag so a flick of the wheel doesn't tear through the
            // fog — mist should feel like it has mass. The page's one scrub
            // value (see pacing.ts), where this used to run lighter at 0.55:
            // this chapter's curtain is a full-viewport overlay, so a reader
            // crossing it felt the whole page's response to the wheel change
            // and then change back.
            scrub: SCRUB,
            // The curtain is a fixed, full-viewport overlay, so its scrub
            // lag isn't just cosmetic: on a fast fling the eased scrub
            // tween keeps catching up via rAF for a beat *after* the real
            // scroll position (and the pinned feature story under it) has
            // already moved on, which briefly paints a half-finished dark
            // fog band over content the user has already scrolled past.
            // fastScrollEnd snaps the timeline straight to its end/start
            // once scroll velocity crosses the threshold instead of
            // leaving it to visibly catch up afterwards.
            fastScrollEnd: true,
            /* Must refresh *after* the Why chapter's pin has re-applied its
               spacing, otherwise this trigger measures the section at its
               un-pinned position — four viewports too high — and the fog
               timeline sits at its end before the reader ever gets here. See
               scrollOrder.ts. */
            refreshPriority: REFRESH_PRIORITY.features,
          },
        });

        /* Nav links to #features aim at the frame where the title has come out
           of the fog rather than at the section's top edge — see ANCHOR_AT.
           Resolved on click, since this trigger's range is re-measured every
           time a chapter below the fold finishes loading. */
        const unregisterAnchor = registerAnchorLanding("features", () => {
          const st = tl.scrollTrigger;
          return st ? st.start + (st.end - st.start) * ANCHOR_AT : 0;
        });

        /* Comes to rest on the frame the copy is set on — the same one the nav
           link above aims at, so a jump and a scroll leave the reader looking at
           the same thing.
         *
         * One rest, and reach-limited, which is the whole difference between this
         * chapter and the two built out of beats. Almost all of this range is fog:
         * a continuous state with no readable frame in it and no wrong place to
         * stop, so a reader who stops in the mist is left in the mist. It is only
         * the last half screen before the settled frame that gets closed up — the
         * stretch where the copy is arriving and stopping means reading type that
         * is still moving. Without the limit a stop anywhere in the whiteout would
         * glide the reader a screen and a half forward, which is a decision about
         * where they wanted to be rather than a correction. */
        const stopSettling = tl.scrollTrigger
          ? beatSettle(
              tl.scrollTrigger,
              [ANCHOR_AT],
              snapHold(RANGE),
              settleReach(RANGE)
            )
          : undefined;

        /* The mask has to sit on the artwork's real edge, so it's driven off
           the frame clock rather than scroll callbacks: those only fire while
           the trigger is active and can skip ticks, which leaves the fog's
           edge parked at a stale position mid-scroll. Gated on `arm`, so it
           costs nothing anywhere else on the page. */
        const onTick = () => {
          if (!arm.isActive) return;
          trackSeam(tl.scrollTrigger?.progress ?? 0);
        };
        gsap.ticker.add(onTick);
        trackSeam(tl.scrollTrigger?.progress ?? 0);

        /* ── Primary layer: the mist surges in and fills the screen ─────── */
        /* The bright wash leads and the cloud texture rides on top of it.
           Order matters: fog scatters light, so the curtain has to go *pale*
           first. With the veil arriving late instead, the low-opacity fog sat
           over the dark stage and read as dirty smoke, and the hard edge
           where the hero's artwork ends stayed legible right through it. */
        /* The veil (the bright scatter, i.e. the actual whiteout) keeps its
           cubic ease-in: the fog's *perceived* density runs well ahead of
           its opacity, so a linear or quadratic wash had the screen white by
           a quarter of the way in, with the hero swallowed long before it had
           finished scrolling off.

           The cloud texture is a step ahead of it (quadratic), which is what
           puts visible cloud over the hero's dark run-out band (.hero-tail)
           while the veil is still a thin haze — clouds drifting across the
           darkness first, then the surge to white, then the clear onto the
           light theme. */
        /* Two stages on one layer, which is what lets a single cloud instance
           play both parts:

           Lead-in (0 → ENTER): the mist materialises early and then holds at
           a low density, dim (brightness 0.42) so over the near-black band it
           reads as moonlit fog rather than a pale wash arriving too soon.
           Front-loaded ease, so it is *already there* by the time you reach
           the band instead of appearing under you.

           Surge (ENTER → PEAK): density and brightness run up together while
           the veil behind goes white — the whiteout. */
        tl.fromTo(
          mist,
          { opacity: 0, filter: "brightness(0.38)" },
          {
            opacity: MIST_BAND_OPACITY,
            duration: ENTER,
            ease: "power1.out",
          },
          0
        )
          .to(
            mist,
            {
              opacity: 1,
              filter: "brightness(1)",
              duration: PEAK - ENTER,
              ease: "power2.in",
            },
            ENTER
          )
          /* Slow expansion across the whole build, so the fog is always
             drifting toward the viewer rather than sitting still. On the inner
             layer, because .features-mist carries the scroll-driven drift
             transform and GSAP would overwrite it. */
          .fromTo(
            mistLayer,
            { scale: 1.3 },
            { scale: 1.04, duration: PEAK, ease: "power1.in" },
            0
          )
          .fromTo(
            veil,
            { opacity: 0 },
            { opacity: 0.95, duration: PEAK - ENTER, ease: "power2.in" },
            ENTER
          )

          /* The scene behind the fog dissolves into it. Driven through a proxy
             object and written in onUpdate rather than tweened on the element
             directly, because GSAP resolves a tween's target when the tween is
             *created* — and the dark chapter above is code-split, so at that
             moment it may not be in the DOM yet. Resolving on first update
             instead means the dissolve always lands on whatever is actually
             above this section. */
          .to(
            dissolve,
            {
              v: 0,
              duration: s(0.2),
              ease: "power2.in",
              onUpdate: () => {
                const el = resolveDissolve();
                if (!el) return;
                // Cleared rather than set to "1" at rest, so the element goes
                // back to having no inline opacity at all once the fog has
                // unwound.
                el.style.opacity = dissolve.v >= 1 ? "" : String(dissolve.v);
              },
            },
            PEAK - s(0.24)
          )

          /* ── Ambient layer: dark → light, hidden under the whiteout ─────
             Starts *at* PEAK, not before it. Before PEAK the hero's dark
             run-out band is still on screen above this section, so swapping
             early puts a dark/light edge under a curtain that is dense but
             not yet fully opaque — measurably a ~14 luma line across the
             frame. From PEAK on, the stage fills the screen, so the swap has
             no edge in it and reads as nothing more than the fog brightening
             as it clears.

             Deliberately *faster* than the veil/mist fade-out below, not
             matched to it. The curtain (veil + cloud) sits on a layer in
             front of the page, so what actually shows through at any pixel
             is `curtainAlpha * curtain + (1 - curtainAlpha) * pageBelow` —
             and the black stage bleeds through in proportion to
             `(1 - curtainAlpha) * (1 - skyOpacity)`. Running the sky's rise
             on the *same* clock as the curtain's fall (as this used to)
             keeps that product away from zero for the whole crossfade: the
             cloud is never a flat sheet — cover/density leave real per-pixel
             gaps in the texture — so exactly while curtainAlpha is dipping
             through those gaps, skyOpacity is *also* still only half risen,
             and the near-black stage (#000106) shows through both at once.
             Measured at the fade's midpoint that is a real ~15-20% dark
             bleed in the cloud's sparser regions — which is what reads as
             the cloud itself flashing dark right before the light theme
             locks in. Front-loading the sky to be fully opaque well inside
             the veil/mist's own fade window closes that gap structurally:
             by the time the curtain's coverage has dropped enough to matter,
             skyOpacity is already ~1, so there's nothing dark left for a gap
             to reveal regardless of how gappy the cloud texture is. */
          .fromTo(
            ".features-sky",
            { opacity: 0 },
            { opacity: 1, duration: s(0.22), ease: "power2.out" },
            PEAK
          )

          /* ── The fog clears ───────────────────────────────────────────── */
          /* Slower than the sky's own rise above, on purpose — see the note
             there. The veil is what keeps the cloud's coverage gaps reading
             white rather than showing whatever is actually behind the
             curtain; letting it (and the cloud texture riding on it) take
             longer to clear than the sky takes to arrive means the light
             theme is already fully in place underneath before the curtain
             thins out, so there is no near-black stage left for a gap to
             expose.

             `power1.in`, not `.out` — the direction matters as much as the
             duration. An ease-out curve loses opacity fastest at its *start*,
             which is the instant right after PEAK — exactly where the sky's
             own ease-out is climbing fastest off of 0. Both curves peaking
             their rate of change at the same moment, in opposite directions,
             is the worst pairing available: veil is thinnest precisely when
             sky is still darkest. An ease-in curve holds the veil close to
             full opacity through that opening stretch instead — its own
             fastest drop lands later, by which point sky has already had
             most of its own (faster, shorter) duration to climb. Modelled
             against the real curves, `.out` here peaks the black stage's
             bleed-through the cloud's coverage gaps at ~16%, a few frames
             past PEAK; `.in` cuts that to ~5% with no distinct spike. */
          .to(veil, { opacity: 0, duration: s(0.42), ease: "power1.in" }, PEAK)
          .to(mist, { opacity: 0, duration: s(0.4), ease: "power1.out" }, PEAK)
          .to(
            mistLayer,
            { scale: 1, duration: s(0.4), ease: "power1.out" },
            PEAK
          )

          /* ── Secondary layer: the title condenses out of the mist ─────── */
          .fromTo(
            ".features-letter",
            { opacity: 0, yPercent: 34, filter: "blur(20px)" },
            {
              opacity: 1,
              yPercent: 0,
              filter: "blur(0px)",
              duration: s(0.16),
              // Micro cascade: the whole word is through in ~0.1 of the
              // scroll range, so it reads as one word forming, not eight
              // letters arriving.
              stagger: s(0.014),
              ease: "power2.out",
            },
            PEAK + s(0.06)
          )
          .fromTo(
            ".features-eyebrow",
            { opacity: 0, y: 14, filter: "blur(10px)" },
            {
              opacity: 1,
              y: 0,
              filter: "blur(0px)",
              duration: s(0.14),
              ease: "power2.out",
            },
            PEAK + s(0.04)
          )
          .fromTo(
            ".features-rule",
            { opacity: 0, scaleX: 0 },
            { opacity: 1, scaleX: 1, duration: s(0.18), ease: "power2.out" },
            PEAK + s(0.2)
          )
          .fromTo(
            ".features-lede",
            { opacity: 0, y: 20, filter: "blur(12px)" },
            {
              opacity: 1,
              y: 0,
              filter: "blur(0px)",
              duration: s(0.18),
              ease: "power2.out",
            },
            PEAK + s(0.22)
          )
          .fromTo(
            ".features-cue",
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: s(0.12), ease: "power2.out" },
            PEAK + s(0.36)
          )

          /* Counter-motion: the copy keeps drifting up gently after it has
             landed, at a fraction of the scroll speed, so the pinned frame
             doesn't feel frozen for the last stretch. */
          .fromTo(
            ".features-intro",
            { y: 34 },
            { y: -20, duration: 1 - PEAK, ease: "none" },
            PEAK
          );

        return () => {
          unregisterAnchor();
          stopSettling?.();
          gsap.ticker.remove(onTick);
          tl.scrollTrigger?.kill();
          tl.kill();
        };
      });

      return () => {
        pin.kill();
        arm.kill();
        mm.revert();
        // The dissolve writes inline opacity onto an element in another
        // component, so it has to be handed back clean.
        if (dissolveEl) dissolveEl.style.opacity = "";
        window.removeEventListener("resize", measureSeam);
        ScrollTrigger.removeEventListener("refresh", measureSeam);
      };
    },
    { scope: sectionRef }
  );

  return (
    <section id="features" className="features-section" ref={sectionRef}>
      {/* Fixed transition curtain, rendered into the document body rather than
          into this section.

          It has to cover the *whole* viewport — including the hero still on
          screen above — so it was already outside .features-stage. The portal
          is the other half of that: ScrollSmoother transforms #smooth-content,
          and a `position: fixed` element inside a transformed ancestor is fixed
          to that ancestor, not to the screen, so left in place the curtain
          would scroll away with the page instead of holding the frame. The body
          is outside the smoothed content, so here it is genuinely viewport-
          fixed. z-index 60 keeps it over every chapter and under the loading
          screen. It always finishes fully transparent, so nothing lingers over
          the sections that follow. */}
      {createPortal(
        <div className="features-curtain" aria-hidden="true" ref={curtainRef}>
        {/* Mask + counter-shift split (see FeaturesSection.css for the full
            reasoning): the mask box's `transform` is what moves the fog's
            edge every tick — compositor-only, no repaint — while this inner
            layer cancels that same transform out so the fog/veil themselves
            stay visually pinned to the viewport instead of sliding with the
            mask. */}
        <div className="features-curtain-mask">
          <div className="features-curtain-content">
            <div className="features-veil" />
            <div className="features-mist">
              {/* Always mounted (see the `mistArmed`/`paused` note above) so
                  the GL context and compiled shaders survive scrolling away
                  from and back into range — only the render loop is
                  paused/resumed. */}
              <Clouds
                className="features-mist-layer"
                paused={!mistArmed}
                // The only cloud layer in the transition, so the settings
                // have to serve both ends of it: enough structure to read
                // as mist hanging under the artwork early on, enough
                // coverage to go opaque at the peak. The final whiteout is
                // carried by .features-veil behind it, which is why the
                // coverage here doesn't need to be pushed all the way to a
                // flat wall. density/cover matched to the hero's own fog
                // (density 0, cover 0.13) — this layer was noticeably
                // chunkier than the hero's mist even before the CSS opacity
                // fade-in was taken into account, since that fade only dims
                // the texture, it doesn't thin it out. A little density is
                // kept (rather than 0) so the field still has visible
                // structure to build into a wall by the whiteout, but the
                // base coverage now matches.
                scale={2.8}
                speed={0.5}
                cover={0.13}
                density={0.4}
                shading={0.55}
                color={[0.93, 0.96, 1]}
                opacity={0.98}
                // Must stay 0: the composite pass ramps its drop shadow by
                // (1 - mist), so any shadow here would darken exactly the
                // gaps the reveal depends on.
                shadow={0}
                wind={0.5}
                windRadius={190}
                // Full-screen fog is soft by nature, so the field can run
                // below native resolution for a cheaper frame.
                quality={0.75}
              >
                <div className="features-mist-void" />
              </Clouds>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      <div className="features-stage" ref={stageRef}>
        {/* Light theme, faded in underneath the whiteout. The stage's own
            base is the hero's exact background colour, so while the fog is
            still building there is no visible seam where this section slides
            up over the hero. */}
        <div className="features-sky" aria-hidden="true">
          <span className="features-fog features-fog-a" />
          <span className="features-fog features-fog-b" />
          <span className="features-grain" />
        </div>

        <div className="features-intro">
          <span className="features-eyebrow">
            <i aria-hidden="true" />
            What&rsquo;s inside
          </span>
          <h2 className="features-title" aria-label={TITLE}>
            {TITLE.split("").map((char, i) => (
              <span
                className="features-letter"
                key={`${char}-${i}`}
                aria-hidden="true"
              >
                {char}
              </span>
            ))}
          </h2>
          <span className="features-rule" aria-hidden="true" />
          <p className="features-lede">
            Everything you see is yours to shape — powerful bots to play
            against, and analysis deep enough to explain every move rather
            than just score it.
          </p>
          <span className="features-cue" aria-hidden="true">
            <i />
            Keep scrolling
          </span>
        </div>
      </div>
    </section>
  );
}
