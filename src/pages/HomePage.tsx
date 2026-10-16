import { Suspense, lazy, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { useGSAP } from "@gsap/react";
import HeroSection from "../components/HeroSection";
import FeaturesSection from "../components/FeaturesSection";
import LoadingScreen from "../components/LoadingScreen";
import EffectBoundary from "../components/EffectBoundary";
import { installAnchorScroll } from "../components/anchorScroll";

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollSmoother);

/* Both model-driven chapters are code-split to keep three.js (and two .glb
   payloads) out of the initial hero bundle. React starts fetching a lazy
   chunk as soon as it renders, so both are already on the wire while the
   reader is still on the hero — the split defers the parse cost, not the
   download. Why Chessee sits directly under the hero, so it is the more
   urgent of the two, and it is declared first for that reason: its chunk is
   requested before the feature story's. */
const WhySection = lazy(() => import("../components/WhySection"));
const FeatureStory = lazy(() => import("../components/FeatureStory"));
/* Pricing carries no 3D payload, but it is the furthest section down the page
   and it is another pinned, scrubbed timeline — splitting it keeps its GSAP
   choreography out of the hero's critical path along with the other two. */
const PricingSection = lazy(() => import("../components/PricingSection"));
/* Last two, and the only sections the reader can be certain to reach only
   after everything above has loaded — so they ride at the back of the queue.
   Neither pins or scrubs; the FAQ's accordion is the page's only piece of
   click-driven motion. */
const FaqSection = lazy(() => import("../components/FaqSection"));
const SiteFooter = lazy(() => import("../components/SiteFooter"));

export default function HomePage() {
  const [loading, setLoading] = useState(true);

  /* ── Smoothed scrolling ────────────────────────────────────────────────
     Every chapter below is a pinned, scrubbed ScrollTrigger timeline, and on
     the native scroller those two things run on different threads: the browser
     scrolls on the compositor while ScrollTrigger repositions the pinned
     section on the main thread. When a frame's worth of that goes out of sync
     the compositor scrolls the `position: fixed` pinned section *with* the
     page for a beat and paints the pin spacer behind it — which is exactly the
     dark band that used to flash under the feature story mid-scroll, and why
     the chapters read as separate pages snapping past each other rather than
     one continuous scene.

     ScrollSmoother moves the whole scroll onto the JavaScript thread and
     drives the page from the same tick ScrollTrigger updates in, so a pin can
     no longer lag the scroll by a frame. The eased offset is the other half of
     the answer to "make it feel premium": it gives the page real inertia
     instead of the wheel's discrete steps, which is what the section-to-section
     handovers were missing. */
  useGSAP(() => {
    const mm = gsap.matchMedia();

    /* Reduced motion keeps the native scroller untouched. Every chapter has a
       static, scroll-independent fallback in that mode, and inertia is the one
       thing the preference is explicitly asking not to have. */
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const smoother = ScrollSmoother.create({
        wrapper: "#smooth-wrapper",
        content: "#smooth-content",
        /* Half a beat of catch-up, not a whole one. This used to be 1: enough
           to read as weight on its own, but every pinned chapter also carries
           its own `scrub: 0.7` lag (pacing.ts), and the two stack — the
           smoother eases the scroll position itself, then each chapter eases
           its playhead *again* relative to that already-eased position. At 1
           the page's reply to a single wheel notch was the sum of both lags,
           which reads less like weight and more like the page not answering.
           0.5 keeps enough inertia that a fling still carries past where the
           wheel stopped, without adding a second full lag on top of the
           scrub every chapter already has. */
        smooth: 0.5,
        /* Wheel and touch go through the smoother too, so a fling can't
           outrun a pin the way a raw compositor scroll can. */
        normalizeScroll: true,
        /* Mobile browsers resize the viewport when the address bar hides,
           which would otherwise re-measure every pin mid-scroll. */
        ignoreMobileResize: true,
        /* Nothing on the page uses data-speed / data-lag, so skip the DOM
           scan those would need on every refresh. */
        effects: false,
      });

      return () => smoother.kill();
    });

    return () => mm.revert();
  });

  /* ── In-page anchors ───────────────────────────────────────────────────
     The nav, the footer columns and "Back to top" are all fragment links, and
     the browser's own fragment navigation cannot serve them on this page: it
     scrolls the smoother's clipped wrapper instead of the document, which
     leaves every ScrollTrigger at scroll 0 and the frame blank. Installed
     outside the matchMedia above because it is needed in both motion modes —
     see anchorScroll.ts. */
  useEffect(installAnchorScroll, []);

  return (
    <>
      {loading ? (
        <LoadingScreen onDone={() => setLoading(false)} />
      ) : null}
      {/* The smoother transforms #smooth-content, so anything that has to stay
          welded to the viewport (the loading screen above, and the fog curtain
          FeaturesSection portals to the body) must live outside it — a
          `position: fixed` element inside a transformed ancestor is fixed to
          that ancestor, not to the screen. */}
      <div id="smooth-wrapper">
        <div id="smooth-content">
          {/* `inert` keeps the real page out of the tab order and off the a11y
              tree while the boot sequence is covering it, without paying the
              cost (and entrance-animation restart) of unmounting/remounting
              the hero. */}
          {/* Every chapter is wrapped, and the reason is one line of React
              semantics: an error escaping a render or an effect unmounts the
              whole tree, and every chapter here drives at least one WebGL layer.
              A browser that refuses a context — acceleration off, a blocklisted
              driver, or a page that has used up its context budget — used to
              take the entire document with it and leave an empty #root. The
              layers guard themselves individually too (see the try/catch in each
              renderer); this is the net under all of them, so the worst case is
              one chapter missing rather than a blank page. */}
          <div inert={loading || undefined}>
            <EffectBoundary label="HeroSection">
              <HeroSection />
            </EffectBoundary>
            <EffectBoundary label="FeaturesSection">
              <FeaturesSection />
            </EffectBoundary>
            <Suspense fallback={null}>
              <EffectBoundary label="FeatureStory">
                <FeatureStory />
              </EffectBoundary>
            </Suspense>
            {/* Closing argument, and the page's second dark chapter. Placed
                after the feature story so the reader meets the product first
                and the "why" lands as the conclusion; it opens with its own
                dusk band (see WhySection.css) which takes the light editorial
                chapter back down to the hero's near-black. */}
            <Suspense fallback={null}>
              <EffectBoundary label="WhySection">
                <WhySection />
              </EffectBoundary>
            </Suspense>
            {/* The ask, and the far side of the Why chapter's closing dive. That
                chapter ends by travelling through the light tunnel's vanishing
                point into open space, and this one opens in the same space — same
                shared sky component, same base tone, no run-out band between them.
                The screen of ordinary scrolling in between (a pinned stage has to
                unpin somewhere) is this section's approach: see the two triggers
                in PricingSection.tsx.

                The only chapter on the page whose copy is not choreographed: the
                price table is an ordinary grid, readable at every scroll position,
                and what the scroll drives here is the background it is read
                against. */}
            <Suspense fallback={null}>
              <EffectBoundary label="PricingSection">
                <PricingSection />
              </EffectBoundary>
            </Suspense>
            {/* Objections, then the sign-off. The FAQ continues the pricing
                tail's flat #000106 and the footer steps below it to black, so
                the page closes on a value change rather than a transition. */}
            <Suspense fallback={null}>
              <EffectBoundary label="FaqSection">
                <FaqSection />
              </EffectBoundary>
              <EffectBoundary label="SiteFooter">
                <SiteFooter />
              </EffectBoundary>
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
