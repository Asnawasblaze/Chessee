import { useRef, useState, type FormEvent } from "react";
import { COFFEE_URL, LOGO_SRC, SOCIALS } from "../../config/site";
import PillButton from "../chrome/PillButton";
import ScrambleText from "../textFx/ScrambleText";
import { gsap, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./sections.css";

const COLUMNS = [
  {
    title: "Play",
    links: [
      { label: "Blitz", href: "#modes" },
      { label: "Rapid", href: "#modes" },
      { label: "Puzzle Storm", href: "#modes" },
      { label: "Bot duels", href: "#bots" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Features", href: "#features" },
      { label: "AI coach", href: "#feature-story" },
      { label: "Roadmap", href: "#roadmap" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Pricing", href: "#pricing" },
      { label: "Buy me a coffee", href: COFFEE_URL },
      { label: "Contact", href: "mailto:hello@chessee.gg" },
    ],
  },
] as const;

const WORD = "CHESSEE".split("");

export default function BigFooter() {
  const root = useRef<HTMLElement>(null);
  const [sent, setSent] = useState(false);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || prefersReducedMotion()) return;
      gsap.from(".bf-letter", {
        yPercent: 105,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.07,
        scrollTrigger: { trigger: ".bf-word", start: "top 92%", once: true },
      });
    },
    { scope: root },
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <footer ref={root} className="bf" aria-label="Site footer">
      <div className="bf-top">
        <div className="bf-cta">
          <p className="fx-h2 fx-display bf-cta-line">Ready for your first move?</p>
          <PillButton href="#pricing" label="Play now" big />
        </div>

        <nav className="bf-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title} className="bf-col">
              <h3 className="fx-label">{c.title}</h3>
              <ul>
                {c.links.map((l) => {
                  const ext = l.href.startsWith("http");
                  return (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      >
                        <ScrambleText text={l.label} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <form className="bf-news" onSubmit={onSubmit}>
          <label htmlFor="bf-email" className="fx-label">
            Get patch notes
          </label>
          {sent ? (
            <p className="bf-thanks" role="status">
              You are on the list.
            </p>
          ) : (
            <div className="bf-news-row">
              <input id="bf-email" type="email" required placeholder="you@email.com" autoComplete="email" />
              <button type="submit">Join</button>
            </div>
          )}
          <ul className="bf-socials">
            {SOCIALS.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  <ScrambleText text={s.label} />
                </a>
              </li>
            ))}
          </ul>
        </form>
      </div>

      <div className="bf-word" aria-hidden="true">
        {WORD.map((ch, i) => (
          <span className="bf-mask" key={i}>
            <span className="bf-letter">{ch}</span>
          </span>
        ))}
      </div>

      <div className="bf-bottom">
        <img src={LOGO_SRC} alt="" width={56} height={37} />
        <span className="fx-meta">© {new Date().getFullYear()} Chessee. All rights reserved.</span>
        <a className="fx-meta bf-top-link" href="#top">
          Back to top ↑
        </a>
      </div>
    </footer>
  );
}
