import { useRef } from "react";
import Headline from "../textFx/Headline";
import { gsap, ScrollTrigger, useGSAP } from "../textFx/scramble";
import "./sections.css";

const MODES = [
  {
    name: "Blitz",
    clock: "3 + 2",
    glyph: "♞",
    line: "Three minutes. Every second is a decision.",
    body: "Fast boards with a small increment. The AI coach flags the exact move where the clock beat you.",
    tone: "a",
  },
  {
    name: "Rapid",
    clock: "10 + 0",
    glyph: "♜",
    line: "Room to breathe. Room to be wrong.",
    body: "Long enough to calculate, short enough to stay honest. Best for climbing your rating steadily.",
    tone: "b",
  },
  {
    name: "Puzzle Storm",
    clock: "3:00",
    glyph: "♛",
    line: "Solve as many as you can before it ends.",
    body: "Tactics get harder with every correct answer. One mistake costs time, not the run.",
    tone: "c",
  },
  {
    name: "Chess960",
    clock: "5 + 3",
    glyph: "♝",
    line: "Same pieces. Shuffled back rank.",
    body: "No memorised openings, just principles. Every game starts from one of 960 positions.",
    tone: "a",
  },
  {
    name: "Bot Duel",
    clock: "∞",
    glyph: "♚",
    line: "Pick an opponent. Dial the Elo.",
    body: "From a beginner who hangs pieces to an engine that never blinks, with hints you can switch off.",
    tone: "b",
  },
] as const;

export default function ModesSection() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      const t = track.current;
      if (!section || !t) return;
      const mm = gsap.matchMedia();

      mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
        const distance = () => Math.max(0, t.scrollWidth - window.innerWidth + 96);
        const tween = gsap.to(t, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });

        const cards = t.querySelectorAll<HTMLElement>(".mode-card");
        cards.forEach((card) => {
          const glyph = card.querySelector(".mode-glyph");
          gsap.fromTo(
            glyph,
            { rotate: -14, yPercent: 20 },
            {
              rotate: 10,
              yPercent: -12,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                containerAnimation: tween,
                start: "left right",
                end: "right left",
                scrub: true,
              },
            },
          );
        });
        return () => {
          ScrollTrigger.getAll().forEach((s) => {
            if (s.trigger === section) s.kill();
          });
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="modes" className="modes" aria-label="Game modes">
      <div className="modes-head">
        <span className="fx-eyebrow fx-eyebrow--bright">Pick your pace</span>
        <Headline
          as="h2"
          tone="bright"
          className="fx-h1 modes-title"
          lines={["Five ways", "to lose sleep."]}
          accent={["lose"]}
        />
        <p className="modes-sub fx-lead">Scroll sideways through every mode. Each one trains something different.</p>
      </div>

      <div className="modes-viewport">
        <div ref={track} className="modes-track">
          {MODES.map((m, i) => (
            <article key={m.name} className={`mode-card mode-card--${m.tone}`}>
              <header className="mode-top">
                <span className="fx-pixel">{String(i + 1).padStart(2, "0")}</span>
                <span className="mode-clock fx-pixel">{m.clock}</span>
              </header>
              <span className="mode-glyph" aria-hidden="true">
                {m.glyph}
              </span>
              <h3 className="fx-h3 mode-name">{m.name}</h3>
              <p className="mode-line">{m.line}</p>
              <p className="mode-body">{m.body}</p>
              <a className="mode-link" href="#pricing">
                Play {m.name}
                <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
