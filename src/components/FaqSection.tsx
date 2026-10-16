import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./FaqSection.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ---------------------------------------------------------------------- */
/* FAQ — the page's one calm chapter                                       */
/* ---------------------------------------------------------------------- */

/* Where this sits: directly after pricing, as the last thing before the
 * footer. It continues the dark register (#000106, same as .pricing-tail) so
 * there is nothing to transition between.
 *
 * Deliberately *not* a pinned, scrubbed chapter like the four above it. Those
 * sections are being watched; this one is being read, and by a reader who
 * arrived with a specific question — usually about billing. Taking scroll
 * away from someone hunting for an answer is the one place on this page where
 * choreography would cost more than it earns. So: an ordinary section, an
 * accordion the reader drives, and motion limited to a one-off reveal and the
 * open/close itself.
 *
 * Pattern: WAI-ARIA accordion. Each question is a real <button> inside a
 * heading, wired to its panel with aria-expanded / aria-controls, plus roving
 * arrow-key navigation between the headers. One panel open at a time, which
 * keeps the section's height stable enough that opening an answer never
 * pushes the one you were reading off screen.
 *
 * Motion personality: Premium, same as the rest of the page — decelerating,
 * no overshoot, exits ~35% shorter than entrances. */

interface Faq {
  id: string;
  /** Mono kicker, so the list can be scanned by topic before it is read. */
  topic: string;
  question: string;
  /** Lead paragraph. */
  answer: string;
  /** Optional enumerated detail — only the analysis answer has one. */
  points?: string[];
  /** Line after the list, where there is one. */
  tail?: string;
}

/* Copy is taken verbatim in substance from landing-contents.md; spelling is
   normalised to the -ise forms the rest of the page uses. */
const FAQS: Faq[] = [
  {
    id: "customise",
    topic: "Customisation",
    question: "Can I customise everything on the Basic plan?",
    answer:
      "Yes \u2014 even on Basic you can customise game controls, engine settings and the interface itself. Theme options are the one thing held back on this tier; higher plans unlock more themes and deeper customisation.",
  },
  {
    id: "accuracy",
    topic: "Analysis",
    question: "How accurate is the analysis, and how detailed is it?",
    answer:
      "Every analysis is powered by Stockfish, one of the strongest chess engines available. For any position you get:",
    points: [
      "Win, draw and loss probability",
      "The best available move",
      "The tactical sequence it predicts",
    ],
    tail: "All of it laid out in a clean, easy-to-read format.",
  },
  {
    id: "free",
    topic: "Pricing",
    question: "Can I use every feature for free?",
    answer:
      "Yes \u2014 every feature is available on the free tier. Usage runs on a token system: you get a set number of free tokens each day to play against bots or run engine analysis. That keeps it fair, and keeps the engines from being abused.",
  },
  {
    id: "support",
    topic: "Community",
    question: "How do I ask questions or share feedback?",
    answer:
      "Join our Discord \u2014 it is the best place for questions, support and feature suggestions, and we genuinely read all of them. Found a bug? Report it in support and we will reward you with bonus tokens once it has been reviewed.",
  },
];

/* Premium timing, in seconds. The panel is being driven by a click rather than
   by scroll, so these are real durations instead of the scroll-unit fractions
   the pinned chapters use — the ratio between them is the same. */
const OPEN_DUR = 0.44;
const CLOSE_DUR = 0.28;

export default function FaqSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const panelsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const headersRef = useRef<(HTMLButtonElement | null)[]>([]);
  /* The first pass only sets the resting state — without this the default-open
     panel would animate itself open on mount, which reads as the page doing
     something the reader didn't ask for. */
  const mountedRef = useRef(false);

  /* First answer open by default. It shows the pattern is interactive without
     the reader having to guess, and the question it answers is the one most
     people arrive with. */
  const [open, setOpen] = useState<string | null>(FAQS[0].id);

  const toggle = useCallback((id: string) => {
    setOpen((prev) => (prev === id ? null : id));
  }, []);

  /* ── Panel open / close ──────────────────────────────────────────────
     Height is tweened rather than transitioned so the closed state can be
     `height: 0` *and* `visibility: hidden` in one pass — GSAP's autoAlpha
     handles the second half, which is what keeps a collapsed answer out of
     the tab order and off the accessibility tree instead of merely clipped. */
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    FAQS.forEach((item) => {
      const panel = panelsRef.current[item.id];
      if (!panel) return;
      const isOpen = item.id === open;

      if (!mountedRef.current || reduce) {
        gsap.set(panel, {
          height: isOpen ? "auto" : 0,
          autoAlpha: isOpen ? 1 : 0,
        });
        return;
      }

      gsap.to(panel, {
        height: isOpen ? "auto" : 0,
        autoAlpha: isOpen ? 1 : 0,
        duration: isOpen ? OPEN_DUR : CLOSE_DUR,
        ease: isOpen ? "power2.out" : "power2.in",
        /* A reader clicking through questions faster than the tween runs must
           not queue two conflicting height tweens on the same panel. */
        overwrite: "auto",
      });
    });

    /* ScrollSmoother caches the document height and derives the maximum scroll
       from it, so a panel that changes the page's height without a refresh
       leaves the last section unreachable. Deferred past the tween rather than
       run per-frame: a refresh re-measures every pinned chapter above this one,
       and one at the end is enough. */
    let settle: gsap.core.Tween | null = null;
    if (mountedRef.current && !reduce) {
      settle = gsap.delayedCall(OPEN_DUR + 0.05, () => ScrollTrigger.refresh());
    } else {
      ScrollTrigger.refresh();
    }

    mountedRef.current = true;
    return () => {
      settle?.kill();
    };
  }, [open]);

  /* ── Keyboard navigation between headers ─────────────────────────────
     Enter/Space are the button's own; these are the accordion pattern's
     additions, so a keyboard reader can move down the questions without
     tabbing through the answer they just opened. */
  const onHeaderKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
      const last = FAQS.length - 1;
      let next: number | null = null;

      if (e.key === "ArrowDown") next = i === last ? 0 : i + 1;
      else if (e.key === "ArrowUp") next = i === 0 ? last : i - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      if (next === null) return;

      e.preventDefault();
      headersRef.current[next]?.focus();
    },
    []
  );

  /* ── Entrance ────────────────────────────────────────────────────────
     One-off, not scrubbed: the section is a reading surface, so it arrives
     once and then holds still. */
  useGSAP(
    () => {
      const mm = gsap.matchMedia(sectionRef);

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".faq-reveal", {
          autoAlpha: 0,
          y: 24,
          duration: 0.6,
          ease: "power2.out",
          stagger: 0.07,
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 74%",
            once: true,
          },
        });
      });

      return () => mm.revert();
    },
    { scope: sectionRef }
  );

  return (
    <section
      id="faq"
      className="faq-section"
      ref={sectionRef}
      aria-labelledby="faq-title"
    >
      <div className="faq-atmosphere" aria-hidden="true">
        <span className="faq-glow" />
        <span className="faq-grain" />
      </div>

      <div className="faq-inner">
        {/* Left rail. Sticky on wide screens so the chapter keeps its title
            while the reader works down the list. */}
        <header className="faq-head">
          <span className="faq-eyebrow faq-reveal">
            <i aria-hidden="true" />
            Answers
          </span>
          <h2 className="faq-title faq-reveal" id="faq-title">
            Questions,
            <em> answered</em>
          </h2>
          <p className="faq-standfirst faq-reveal">
            The four things people ask before they start. If yours is not here,
            it is one message away.
          </p>
          <a className="faq-ask faq-reveal" href="/discord">
            <span className="faq-ask-icon" aria-hidden="true">
              {/* Speech mark, drawn rather than an emoji so it inherits the
                  accent ink and stays crisp at any scale. */}
              <svg viewBox="0 0 24 24">
                <path
                  d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l5-4h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="faq-ask-copy">
              <b>Ask us on Discord</b>
              <i>Questions, support, feature requests</i>
            </span>
          </a>
        </header>

        <div className="faq-list">
          {FAQS.map((item, i) => {
            const isOpen = item.id === open;
            return (
              <div
                className={`faq-item faq-reveal${isOpen ? " is-open" : ""}`}
                key={item.id}
              >
                {/* The heading carries the level so the list is navigable by
                    headings; the button inside it carries the interaction. */}
                <h3 className="faq-q">
                  <button
                    type="button"
                    className="faq-trigger"
                    id={`faq-h-${item.id}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-p-${item.id}`}
                    onClick={() => toggle(item.id)}
                    onKeyDown={(e) => onHeaderKeyDown(e, i)}
                    ref={(el) => {
                      headersRef.current[i] = el;
                    }}
                  >
                    <span className="faq-topic" aria-hidden="true">
                      {item.topic}
                    </span>
                    <span className="faq-question">{item.question}</span>
                    {/* Plus that becomes a minus: two bars, one of which
                        rotates away. Cheaper than swapping icons, and the
                        rotation is the affordance. */}
                    <span className="faq-mark" aria-hidden="true">
                      <i />
                      <i />
                    </span>
                  </button>
                </h3>

                <div
                  className="faq-panel"
                  id={`faq-p-${item.id}`}
                  role="region"
                  aria-labelledby={`faq-h-${item.id}`}
                  ref={(el) => {
                    panelsRef.current[item.id] = el;
                  }}
                >
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                    {item.points ? (
                      <ul className="faq-points">
                        {item.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    ) : null}
                    {item.tail ? (
                      <p className="faq-answer-tail">{item.tail}</p>
                    ) : null}
                    {item.id === "support" ? (
                      <p className="faq-answer-links">
                        <a href="/discord">Join the Discord</a>
                        <a href="/support">Report a bug</a>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
