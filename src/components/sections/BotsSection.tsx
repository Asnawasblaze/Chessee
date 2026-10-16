import { useRef } from "react";
import Headline from "../textFx/Headline";
import ScrambleText from "../textFx/ScrambleText";
import { gsap, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./sections.css";

const BOTS = [
  { name: "Pawn Pete", elo: 400, glyph: "♟", style: "Hangs pieces. Forgives you.", span: "s", tone: "a" },
  { name: "Rook Riley", elo: 900, glyph: "♜", style: "Solid, patient, a little predictable.", span: "m", tone: "b" },
  { name: "Knight Kai", elo: 1400, glyph: "♞", style: "Loves forks and awkward jumps.", span: "l", tone: "c" },
  { name: "Bishop Bea", elo: 1800, glyph: "♝", style: "Long diagonals, longer grudges.", span: "m", tone: "a" },
  { name: "Queen Quill", elo: 2300, glyph: "♛", style: "Attacks from move three.", span: "s", tone: "b" },
  { name: "The Engine", elo: 3200, glyph: "♚", style: "Does not blink. Does not blunder.", span: "l", tone: "d" },
] as const;

export default function BotsSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || prefersReducedMotion()) return;
      const cards = gsap.utils.toArray<HTMLElement>(".bot-card", el);
      gsap.from(cards, {
        y: 80,
        autoAlpha: 0,
        rotate: (i: number) => (i % 2 ? 2 : -2),
        duration: 0.9,
        ease: "expo.out",
        stagger: 0.08,
        scrollTrigger: { trigger: ".bots-grid", start: "top 80%", once: true },
      });

      const cleanups = cards.map((card) => {
        const glyph = card.querySelector<HTMLElement>(".bot-glyph");
        const move = (e: PointerEvent) => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          gsap.to(card, { rotateY: x * 8, rotateX: -y * 8, duration: 0.4, ease: "power2.out" });
          gsap.to(glyph, { x: x * 28, y: y * 28, duration: 0.5, ease: "power2.out" });
        };
        const leave = () => {
          gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.7, ease: "elastic.out(1,0.5)" });
          gsap.to(glyph, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1,0.5)" });
        };
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerleave", leave);
        return () => {
          card.removeEventListener("pointermove", move);
          card.removeEventListener("pointerleave", leave);
        };
      });
      return () => cleanups.forEach((c) => c());
    },
    { scope: root },
  );

  return (
    <section ref={root} id="bots" className="bots" aria-label="Bot opponents">
      <div className="bots-head">
        <span className="fx-eyebrow">Meet your sparring partners</span>
        <Headline
          as="h2"
          className="fx-h1"
          lines={["Six bots.", "One wants", "you dead."]}
          accent={["dead."]}
        />
      </div>

      <ul className="bots-grid">
        {BOTS.map((b) => (
          <li key={b.name} className={`bot-card bot-card--${b.tone} bot-card--${b.span}`} data-scramble-host>
            <span className="bot-elo fx-pixel">
              <ScrambleText text={`ELO ${b.elo}`} />
            </span>
            <span className="bot-glyph" aria-hidden="true">
              {b.glyph}
            </span>
            <div className="bot-meta">
              <h3 className="fx-h4">{b.name}</h3>
              <p>{b.style}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
