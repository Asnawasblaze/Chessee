import { useRef } from "react";
import TextHoverEffect from "./TextHoverEffect";
import "./SiteFooter.css";

/* ---------------------------------------------------------------------- */
/* Footer — the page's last word                                          */
/* ---------------------------------------------------------------------- */

/* Two bands. The upper one is a sign-off: the wordmark, the hero's promise
 * restated in one line, and the hero's own CTA repeated — a reader who has come
 * this far has read the whole argument, and the worst thing to hand them is a
 * dead end. The lower one is the utility strip: navigation back into the page,
 * where to reach us, the legal links and the engine credit. The wordmark is
 * watermarked behind both, not given a band of its own.
 *
 * No animation. Nothing below the fold's last fold needs choreography, and the
 * page has spent five chapters earning the right to just stop. */

interface Column {
  title: string;
  links: { label: string; href: string; note?: string }[];
}

/* Product links are in-page anchors, matching the section ids the chapters
   already declare (see WhySection / FeaturesSection / PricingSection).
   Everything outside the page points at app routes — /discord and /support are
   the two the FAQ copy names; swap in real destinations when they exist. */
const COLUMNS: Column[] = [
  {
    title: "The page",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it reads a position", href: "#feature-story" },
      { label: "Why Chessee", href: "#why" },
      { label: "Plans & pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Play",
    links: [
      { label: "Play vs Bot", href: "#start" },
      { label: "Play vs Stockfish", href: "#start" },
      { label: "Position Editor", href: "#start" },
      { label: "Analysis controls", href: "#start" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Discord", href: "/discord", note: "Questions & feedback" },
      { label: "Support", href: "/support" },
      { label: "Report a bug", href: "/support", note: "Earns bonus tokens" },
    ],
  },
];

export default function SiteFooter() {
  /* The whole footer drives the wordmark's reveal. The mark itself lives in a
     pointer-events:none layer, so tracking has to be delegated to something
     that actually receives the pointer — and using the footer means the light
     follows the cursor across the columns too, not only across the letters. */
  const footerRef = useRef<HTMLElement>(null);

  return (
    <footer
      className="site-footer"
      aria-labelledby="footer-title"
      ref={footerRef}
    >
      <div className="footer-atmosphere" aria-hidden="true">
        <span className="footer-glow" />
      </div>

      <div className="footer-inner">
        {/* ── Background wordmark ──────────────────────────────────────── */}
        {/* Behind the sign-off and the columns rather than in a band of its
            own: at this weight it reads as a watermark pressed into the
            surface, which is what a mark at footer scale should do. The
            resting stroke is low enough that link labels sit clear of it, and
            the reveal still lights from a pointer anywhere in the footer. */}
        <div className="footer-bg-mark" aria-hidden="true">
          {/* Set in caps rather than lowercased by CSS: text-transform on SVG
              <text> is uneven across engines, and the mark is a fixed string. */}
          <TextHoverEffect text="CHESSEE" targetRef={footerRef} />
        </div>

        {/* ── Sign-off ────────────────────────────────────────────────── */}
        <div className="footer-sign">
          <div className="footer-brand">
            <span className="footer-mark" aria-hidden="true">
              {"\u265E"}
            </span>
            <span className="footer-wordmark">Chessee</span>
          </div>
          <p className="footer-line" id="footer-title">
            See the board like a real grandmaster.
          </p>
          <a className="footer-cta" href="#start">
            Start analysing
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
          <p className="footer-tokens">
            Free forever on Basic &middot; 10 tokens every day &middot; no card
            needed
          </p>
        </div>

        {/* ── Utility ─────────────────────────────────────────────────── */}
        <nav className="footer-nav" aria-label="Footer">
          {COLUMNS.map((column) => (
            <div className="footer-col" key={column.title}>
              <h2 className="footer-col-title">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <a href={link.href}>
                      {link.label}
                      {link.note ? <i>{link.note}</i> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="footer-base">
        <p className="footer-legal">
          &copy; {new Date().getFullYear()} Chessee. All rights reserved.
        </p>
        <p className="footer-credit">
          Analysis powered by{" "}
          <a href="https://stockfishchess.org" rel="noreferrer noopener">
            Stockfish
          </a>
        </p>
        <ul className="footer-fine">
          <li>
            <a href="/privacy">Privacy</a>
          </li>
          <li>
            <a href="/terms">Terms</a>
          </li>
          <li>
            {/* Back to the hero. An in-page anchor rather than a scroll handler
                so it still works if the smoother never initialises. */}
            <a href="#top">Back to top</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
