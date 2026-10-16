import { useCallback, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import EffectBoundary from "./EffectBoundary";
import FeatureVisual, { type FeaturePose } from "./FeatureVisual";
import type { FeatureSceneId } from "./featureScenes";
import { REFRESH_PRIORITY } from "./scrollOrder";
import { beatSettle, snapHold } from "./beatSnap";
import { BEAT_VH, SCRUB } from "./pacing";
import { scrollToOffset } from "./smoothScroll";
import { registerAnchorLanding } from "./anchorScroll";
import "./FeatureStory.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ---------------------------------------------------------------------- */
/* Features — pinned editorial story, one 3D scene per feature             */
/* ---------------------------------------------------------------------- */

/* Art direction: Editorial Grid / Magazine crossed with Swiss Modernism —
   an asymmetric 12-column stage, a Didone display face, hairline rules and a
   monospaced spec ledger. Explicitly *not* a card layout: the copy sits
   directly on the page like a spread, and depth comes from layering the
   chapter numeral behind the visual and letting the headline cross over the
   visual's column, rather than from a floating panel with a shadow.

   One pinned, scrubbed timeline drives everything — which 3D scene is showing,
   the chapter numeral, the headline wipe, the key terms and the chapter index —
   so nothing can drift out of sync.

   Each feature has its *own* looping 3D scene rather than a third pose of one
   shared model. Three poses of a knight said the same thing three times: the
   reader saw a piece turn and had to take on trust that the turn had anything
   to do with the heading beside it. See featureScenes.ts for what the three
   scenes are; the scroll timeline here only decides which one is on screen, and
   crossfades between them through `pose.beat`.

   Copy is landing-contents.md's Features section and nothing else. Each beat
   is one of that file's three entries: its heading is the headline, its
   sentence is the lede, and the terms the sentence itself names are pulled
   out underneath it as scannable keys. Nothing here states anything the
   content file doesn't — an earlier pass invented editorial kickers and a
   ledger of specs (an Elo range, a ply count, tier pricing) that no source
   copy supports, and those are gone rather than reworded. */

/* A lede segment. `{ mark }` is the one phrase in the sentence set in full
   ink — authored as parts rather than as one string so the emphasis is real
   markup instead of an HTML string, and so it can only ever wrap words that
   are actually in the source sentence. */
type LedePart = string | { mark: string };

interface Feature {
  id: string;
  index: string;
  /** The content file's heading for this feature, verbatim. */
  title: string;
  /** The content file's sentence for this feature, split for emphasis. */
  lede: LedePart[];
  /* The terms that same sentence names, lifted out as keys the eye can take
     in without reading the paragraph. Not a spec sheet: no values, because
     the source quotes no figures for these features. */
  points: string[];
  /** The looping 3D scene that states this feature. See featureScenes.ts. */
  scene: FeatureSceneId;
  /** How that scene is framed while this feature is the one being read. */
  pose: FeaturePose;
}

const FEATURES: Feature[] = [
  {
    id: "customise",
    index: "01",
    title: "Everything is customisable",
    lede: [
      "You can customise everything that you see without any restriction — ",
      { mark: "until it feels like yours" },
      ".",
    ],
    /* The source's own list — "the board, pieces, appearance, engine
       controls, gameplay controls, etc..." — moved out of the sentence and
       set as keys. The trailing "etc..." becomes the last, muted key rather
       than being dropped or turned into a claim. */
    points: [
      "Board",
      "Pieces",
      "Appearance",
      "Engine controls",
      "Gameplay controls",
      "…and more",
    ],
    scene: "customise",
    pose: { beat: 0, ry: 0.15, rx: 0.03, scale: 1.02, y: 0.02 },
  },
  {
    id: "bots",
    index: "02",
    title: "Gives powerful bots to play",
    lede: [
      "It offers powerful chess bots and engine so that you can play with them ",
      { mark: "with or without our top level analysis" },
      " — and practice every position from the powerful bots like Stockfish.",
    ],
    points: [
      "Powerful bots",
      "Powerful engine",
      "Stockfish",
      "Practice every position",
    ],
    scene: "bots",
    pose: { beat: 1, ry: -0.17, rx: -0.02, scale: 1, y: -0.01 },
  },
  {
    id: "analysis",
    index: "03",
    title: "In-depth analysis",
    lede: [
      "Chessee gives you a very detailed and very high level analysis ",
      { mark: "for free" },
      " — and you can always customise the analysis controls anytime in game.",
    ],
    points: [
      "Very detailed",
      "Very high level",
      "Analysis controls",
      "Anytime in game",
    ],
    scene: "analysis",
    pose: { beat: 2, ry: 0.1, rx: 0.04, scale: 1, y: 0 },
  },
];

/* Passed straight to the renderer, which builds one scene per entry and treats
   `pose.beat` as an index into it. Hoisted to module scope because it is an
   effect dependency down there: an array literal in the JSX below would be a
   new reference on every render, and every render would tear down and rebuild
   all three scenes and the WebGL context under them. */
const SCENES: readonly FeatureSceneId[] = FEATURES.map(
  (feature) => feature.scene
);

/* One scroll "unit" per feature; the pin lasts this many viewport heights.
   Sourced from pacing.ts rather than declared here, because "how much scroll a
   readable frame is worth" is a decision about the whole page and not about this
   chapter — this is the value the other three are now levelled to. */
const UNIT = BEAT_VH;
/* Where the visual sits before the first beat has landed: the first feature's
   scene already (beat 0 — the chapter should not open on a dissolve), but turned
   a little further, held back and undersized, so it settles into frame as the
   reader arrives rather than being there waiting for them. */
const START_POSE: FeaturePose = {
  beat: 0,
  ry: -0.3,
  rx: 0.02,
  scale: 0.86,
  y: -0.14,
};

/* ---------------------------------------------------------------------- */
/* Beat snapping                                                           */
/* ---------------------------------------------------------------------- */

/* Where inside a beat the reader is meant to come to rest, as a fraction of
   that beat's scroll unit. The key terms are the last thing in and their
   stagger finishes at ~0.76 of the unit, which is also where the exit
   starts, so 0.68 is the frame where everything has landed and nothing has
   begun to leave. Both the chapter index jumps and the snapping below aim
   at it, so a jump and a scroll put the reader on the same frame. */
const BEAT_FOCUS = 0.68;

/** A beat's settled frame, as progress along the pin's own 0→1 range. */
const beatProgress = (i: number) =>
  (i * UNIT + BEAT_FOCUS) / (FEATURES.length * UNIT);

const BEATS = FEATURES.map((_, i) => beatProgress(i));

/* Slack around a settled beat before a gesture commits the next one. Shared
   with the Why chapter — see beatSnap.ts for what the resolver does, why it
   isn't GSAP's built-in `directional` snap, and why the correction is driven
   from scrollEnd rather than by ScrollTrigger's own `snap`. */
const HOLD = snapHold(FEATURES.length * UNIT);

/* Motion personality: Premium — elegant, no overshoot, decelerating
   entrances. Durations below are *fractions of a scroll unit*, not seconds.
   Entrances are ~55% longer than exits (ENTER vs LEAVE), which is the
   enter-beats-exit rule: readers care about what arrives. */
const ENTER = 0.34;
const LEAVE = 0.22;
// Micro cascade — the whole headline is through in well under a beat, so it
// reads as one line forming rather than five words arriving separately.
const WORD_STAGGER = 0.035;
const ROW_STAGGER = 0.04;

/** Splits a headline into words wrapped for a per-word clip reveal. */
function TitleWords({ title }: { title: string }) {
  return (
    <>
      {title.split(" ").map((word, i) => (
        <span className="fs-word" key={`${word}-${i}`}>
          <i>{word}</i>
        </span>
      ))}
    </>
  );
}

/** The lede, with its one marked phrase carried through as real emphasis. */
function Lede({ parts }: { parts: LedePart[] }) {
  return (
    <p className="fs-lede">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <em className="fs-mark" key={i}>
            {part.mark}
          </em>
        )
      )}
    </p>
  );
}

export default function FeatureStory() {
  const sectionRef = useRef<HTMLElement>(null);
  // Live pose the renderer reads every frame. GSAP scrubs these numbers;
  // FeatureVisual eases its displayed transform toward them, which is where the
  // weighty settle between features comes from — and `beat` is the one that
  // decides which scene is on screen.
  const poseRef = useRef<FeaturePose>({ ...START_POSE });
  // The contact shadow. FeatureVisual writes the active scene's ground metrics
  // here as custom properties each frame, so the shadow tracks whichever of the
  // three footprints is currently showing.
  const contactRef = useRef<HTMLSpanElement>(null);
  // The pin's ScrollTrigger, kept so the chapter index can scroll to a beat.
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);

  /* Chapter index → jump to a beat. The rail used to be decoration only:
     three dots with no affordance and nothing a keyboard could reach, so the
     three features were accessible by scroll alone. These are real buttons
     that seek the pin's own scroll range, which also gives assistive tech a
     way to reach beats 2 and 3. */
  const goToBeat = useCallback((i: number) => {
    const st = triggerRef.current;
    if (!st) {
      // Reduced-motion / static layout: the beats are laid out in flow.
      document
        .getElementById(`feature-${FEATURES[i].id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    /* Same frame the scroll snapping lands on (see BEAT_FOCUS), so a jump and
       a scroll are indistinguishable once they settle — and so the snap that
       fires when this smooth scroll ends resolves to where it already is
       instead of nudging the reader somewhere else. */
    const at = beatProgress(i);
    scrollToOffset(st.start + (st.end - st.start) * at);
  }, []);

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;

      const beats = gsap.utils.toArray<HTMLElement>(".fs-beat");
      const numerals = gsap.utils.toArray<HTMLElement>(".fs-numeral");
      const n = FEATURES.length;

      /* Bodoni is a webfont and the headline sizes are large, so the stage's
         height (and therefore every trigger position after it) is measured
         against fallback metrics until it lands. */
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      const mm = gsap.matchMedia(sectionRef);

      /* Reduced motion: no pin, no scrub. Lay the beats out as a normal
         editorial stack, hold the visual on the middle feature's scene with
         every loop frozen (see FeatureVisual), and let the reader scroll past. */
      mm.add("(prefers-reduced-motion: reduce)", () => {
        section.classList.add("is-static");
        gsap.set(poseRef.current, FEATURES[1].pose);
        gsap.set(beats, { autoAlpha: 1, y: 0 });
        gsap.set(".fs-word i", { yPercent: 0 });
        gsap.set([".fs-kicker", ".fs-lede", ".fs-point"], {
          autoAlpha: 1,
          y: 0,
        });
        gsap.set(".fs-rule", { autoAlpha: 1, scaleX: 1 });
        gsap.set(numerals, { autoAlpha: 0 });
        gsap.set(numerals[0], { autoAlpha: 1 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(poseRef.current, START_POSE);
        // Every beat starts hidden and stacked; the timeline brings each in
        // turn. autoAlpha also flips visibility, so an inactive beat can't
        // trap pointer events over the live one.
        gsap.set(beats, { autoAlpha: 0 });
        gsap.set(".fs-word i", { yPercent: 108 });
        gsap.set(".fs-kicker", { autoAlpha: 0, y: 18 });
        gsap.set(".fs-rule", { autoAlpha: 0, scaleX: 0 });
        gsap.set(".fs-lede", { autoAlpha: 0, y: 26 });
        gsap.set(".fs-point", { autoAlpha: 0, y: 14 });
        gsap.set(numerals, { autoAlpha: 0, yPercent: 12 });

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            /* `n * UNIT`, not `n`. The two are the same number while UNIT is 1,
               which is exactly why this was worth correcting: the pin's length
               and the timeline's own duration (see the ambient tweens below,
               which run for `n * UNIT`) have to be the same distance or every
               beat position in this file means something different from what it
               says. */
            end: `+=${n * UNIT * 100}%`,
            pin: true,
            // A little lag so the visual and the copy feel like they carry
            // mass rather than snapping to the wheel. One value for the whole
            // page — see pacing.ts.
            scrub: SCRUB,
            // On a fast fling this section's own scrub would otherwise keep
            // easing the scene/copy toward the scroll position for a beat
            // after the user has already left the pin, which reads as the
            // beat "catching up" after arriving. Snap straight through once
            // scroll velocity crosses the threshold instead.
            fastScrollEnd: true,
            /* No `snap` here: the beats are still where every gesture comes to
               rest, but the correction is performed by beatSettle below rather
               than by ScrollTrigger, whose snap tween intermittently threw the
               reader back to the top of the page. See beatSnap.ts. */
            anticipatePin: 1,
            // Last of the page's scroll sections, so it refreshes last and
            // measures against every pin above it — see scrollOrder.ts.
            refreshPriority: REFRESH_PRIORITY.story,
            onUpdate: (self) => {
              const i = Math.min(n - 1, Math.floor(self.progress * n));
              setActive((prev) => (prev === i ? prev : i));
            },
          },
        });
        triggerRef.current = tl.scrollTrigger ?? null;

        /* Comes to rest on a settled beat however hard the reader flings. */
        const stopSettling = tl.scrollTrigger
          ? beatSettle(tl.scrollTrigger, BEATS, HOLD)
          : undefined;

        /* Links to #feature-story land on the first beat's settled frame — the
           same one the chapter index's first item aims for — rather than on the
           pin's start, where the beat has not arrived yet. */
        const unregisterAnchor = registerAnchorLanding("feature-story", () => {
          const st = triggerRef.current;
          return st ? st.start + (st.end - st.start) * beatProgress(0) : 0;
        });

        /* ── Ambient layer ──────────────────────────────────────────────
           Runs the whole length of the pin so the frame is never frozen:
           the floor grid recedes, and the numeral stack drifts *down* while
           the copy column drifts *up* — counter-motion at a fraction of the
           scroll speed, which is what gives the flat stage depth. */
        tl.fromTo(
          ".fs-floor",
          { "--fs-floor-y": "22px" },
          { "--fs-floor-y": "-16px", duration: n * UNIT },
          0
        )
          .fromTo(
            ".fs-numeral-stack",
            { yPercent: -4 },
            { yPercent: 5, duration: n * UNIT },
            0
          )
          .fromTo(".fs-copy", { y: 26 }, { y: -26, duration: n * UNIT }, 0)
          // Chapter index fill tracks progress across the whole pin. Written
          // as a custom property so the CSS decides which axis it fills on
          // (vertical rail on desktop, horizontal on narrow screens).
          .fromTo(
            ".fs-index",
            { "--fs-progress": 0 },
            { "--fs-progress": 1, duration: n * UNIT },
            0
          );

        FEATURES.forEach((feature, i) => {
          const at = i * UNIT;
          const beat = beats[i];
          const q = gsap.utils.selector(beat);

          /* Primary: the visual hands over to this feature's scene. Chained
             from the previous pose automatically since each `.to` targets the
             same live object at an increasing time — and because `beat` is
             tweened rather than set, the handover is a dissolve the reader
             scrubs through, running for 58% of the beat. Rigid material, so it
             takes the longest of anything here and never overshoots. */
          tl.to(poseRef.current, { ...feature.pose, duration: UNIT * 0.58 }, at);

          /* Primary: the chapter numeral changes. It is the largest thing on
             the stage, so it leads — the copy is read as belonging to a
             chapter that has already turned over. */
          tl.fromTo(
            numerals[i],
            { autoAlpha: 0, yPercent: 12 },
            { autoAlpha: 1, yPercent: 0, duration: ENTER, ease: "power2.out" },
            at + 0.04
          );
          if (i > 0) {
            tl.to(
              numerals[i - 1],
              {
                autoAlpha: 0,
                yPercent: -12,
                duration: LEAVE,
                ease: "power2.in",
              },
              at + 0.02
            );
          }

          // The beat's own container just gates pointer events / visibility;
          // the visible motion is on its parts.
          tl.set(beat, { autoAlpha: 1 }, at + 0.05);

          /* Secondary: kicker → headline wipe → rule → lede → ledger. A
             single cascade down the block, so the eye is led through it in
             reading order instead of everything arriving at once. */
          tl.to(
            q(".fs-kicker"),
            { autoAlpha: 1, y: 0, duration: ENTER * 0.7, ease: "power2.out" },
            at + 0.08
          )
            /* The headline rises out of its own line box rather than fading
               in — a wipe reads as type being set, and it keeps the Didone's
               hairlines crisp the whole way (a blur or opacity ramp on
               high-contrast serif type turns the thin strokes to mush). */
            .to(
              q(".fs-word i"),
              {
                yPercent: 0,
                duration: ENTER,
                ease: "power3.out",
                stagger: WORD_STAGGER,
              },
              at + 0.12
            )
            .to(
              q(".fs-rule"),
              { autoAlpha: 1, scaleX: 1, duration: ENTER, ease: "power2.out" },
              at + 0.26
            )
            .to(
              q(".fs-lede"),
              { autoAlpha: 1, y: 0, duration: ENTER, ease: "power2.out" },
              at + 0.3
            )
            .to(
              q(".fs-point"),
              {
                autoAlpha: 1,
                y: 0,
                duration: ENTER * 0.7,
                ease: "power2.out",
                stagger: ROW_STAGGER,
              },
              at + 0.4
            );

          /* The beat leaves before the next takes over — faster than it
             arrived, and upward, so it reads as the spread turning. All but
             the last, which holds through the release. */
          if (i < n - 1) {
            tl.to(
              q(".fs-word i"),
              {
                yPercent: -108,
                duration: LEAVE,
                ease: "power2.in",
                stagger: WORD_STAGGER * 0.5,
              },
              at + 0.76
            )
              .to(
                [
                  q(".fs-kicker"),
                  q(".fs-rule"),
                  q(".fs-lede"),
                  q(".fs-point"),
                ],
                {
                  autoAlpha: 0,
                  y: -22,
                  duration: LEAVE,
                  ease: "power2.in",
                },
                at + 0.78
              )
              .set(beat, { autoAlpha: 0 }, at + 0.98);
          }
        });

        return () => {
          stopSettling?.();
          unregisterAnchor();
          triggerRef.current = null;
        };
      });
    },
    { scope: sectionRef }
  );

  return (
    <section id="feature-story" className="feature-story" ref={sectionRef}>
      <div className="fs-stage">
        {/* ── Ambient background ─────────────────────────────────────────
            The same drifting light the fog reveal cleared into, plus a
            receding floor grid on an 8-cell rhythm and a hair of horizon
            light, so each scene stands on something board-like instead of
            floating in an empty half. */}
        <div className="fs-atmosphere" aria-hidden="true">
          <span className="fs-glow fs-glow-a" />
          <span className="fs-glow fs-glow-b" />
          <span className="fs-floor" />
          <span className="fs-horizon" />
          <span className="fs-grain" />
        </div>

        {/* Oversized chapter numeral, set in the display face and left
            unfilled. Sits *behind* the visual and bleeds off the left edge —
            the layer that gives the stage depth and fills the space the old
            layout left blank. */}
        <div className="fs-numeral-stack" aria-hidden="true">
          {FEATURES.map((f) => (
            <span className="fs-numeral" key={f.id}>
              {f.index}
            </span>
          ))}
        </div>

        {/* One WebGL context for all three scenes — see the note in
            FeatureVisual for why that is a correctness requirement on this page
            and not a nicety. Bounded, because every effect layer here is
            decoration and none of them is allowed to be the reason the chapter
            fails to render. */}
        <EffectBoundary label="FeatureVisual">
          <FeatureVisual
            className="fs-visual"
            scenes={SCENES}
            poseRef={poseRef}
            metricsRef={contactRef}
          />
        </EffectBoundary>
        {/* Contact shadow, tinted with the page's ink rather than black, so the
            scene reads as standing on the floor grid. Its offset, spread and
            strength are published straight from the renderer (see
            FeatureVisual's metricsRef) rather than guessed in CSS: the three
            scenes have three different footprints and two of them levitate, so
            a single authored offset could only ever be right for one. */}
        <span className="fs-contact" aria-hidden="true" ref={contactRef} />

        {/* ── Chapter index ──────────────────────────────────────────── */}
        <nav className="fs-index" aria-label="Feature chapters">
          <span className="fs-index-track" aria-hidden="true" />
          <span className="fs-index-fill" aria-hidden="true" />
          <ul>
            {FEATURES.map((f, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="fs-index-node"
                  aria-current={active === i ? "true" : undefined}
                  onClick={() => goToBeat(i)}
                >
                  <i aria-hidden="true" />
                  <em>{f.index}</em>
                  {/* The feature's own heading, so the rail names the beats
                      with the same words the page does. */}
                  <span className="fs-index-name">{f.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── The spread ─────────────────────────────────────────────────
            Beats occupy the same grid cell and are swapped by the timeline,
            so exactly one is ever readable or interactive. Inactive beats are
            taken out of the a11y tree; the chapter index above is how a
            keyboard or screen-reader user moves between them. */}
        <div className="fs-copy">
          {FEATURES.map((feature, i) => (
            <article
              className="fs-beat"
              id={`feature-${feature.id}`}
              key={feature.id}
              aria-hidden={active === i ? undefined : "true"}
              inert={active === i ? undefined : true}
            >
              {/* Wayfinder only. The eyebrow used to carry an invented
                  strapline ("Make it yours"); with that gone the line is the
                  counter alone, which is the one thing here the content file
                  implies rather than states. */}
              <p className="fs-kicker">
                <span className="fs-kicker-rule" aria-hidden="true" />
                <span className="fs-kicker-count">
                  {feature.index}
                  <span aria-hidden="true"> / 03</span>
                </span>
              </p>

              <h3 className="fs-title">
                <TitleWords title={feature.title} />
              </h3>

              <span className="fs-rule" aria-hidden="true" />

              <Lede parts={feature.lede} />

              <ul className="fs-points">
                {feature.points.map((point) => (
                  <li
                    className="fs-point"
                    key={point}
                    /* The source's "etc...", set back a step so it doesn't
                       read as another named feature. */
                    data-soft={point.startsWith("…") || undefined}
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
