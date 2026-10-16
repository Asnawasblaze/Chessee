import { useRef } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./sections.css";

const WORDS_A = ["BLITZ", "RAPID", "PUZZLE STORM", "CHESS960", "ELO CLIMB", "BOT DUELS"];
const WORDS_B = ["THINK", "SACRIFICE", "CHECKMATE", "OUTPLAY", "GAMBIT", "ZUGZWANG"];

function Track({ words, dir }: { words: string[]; dir: 1 | -1 }) {
  const run = [...words, ...words];
  return (
    <div className="ribbon-track" data-dir={dir}>
      {[0, 1].map((copy) => (
        <div className="ribbon-run" key={copy} aria-hidden={copy === 1 || undefined}>
          {run.map((w, i) => (
            <span className="ribbon-item" key={`${copy}-${i}`}>
              {w}
              <i className="ribbon-pip" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* Two crossing ribbons. Each loops forever; scroll velocity pushes the loop
   faster in the scroll direction so the band feels attached to the page. */
export default function MarqueeRibbons() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || prefersReducedMotion()) return;
      const tracks = el.querySelectorAll<HTMLElement>(".ribbon-track");
      const tweens = Array.from(tracks).map((t) => {
        const dir = Number(t.dataset.dir);
        gsap.set(t, { xPercent: dir === 1 ? -50 : 0 });
        return gsap.to(t, {
          xPercent: dir === 1 ? 0 : -50,
          duration: 30,
          ease: "none",
          repeat: -1,
        });
      });

      const st = ScrollTrigger.create({
        trigger: el,
        start: "top bottom",
        end: "bottom top",
        onUpdate: (self) => {
          const v = Math.min(Math.abs(self.getVelocity()) / 350, 5);
          tweens.forEach((tw) => {
            gsap.to(tw, { timeScale: 1 + v, duration: 0.2, overwrite: true });
            gsap.to(tw, { timeScale: 1, duration: 1.2, delay: 0.2, overwrite: "auto" });
          });
        },
      });
      return () => {
        st.kill();
        tweens.forEach((t) => t.kill());
      };
    },
    { scope: root },
  );

  return (
    <section ref={root} className="ribbons" aria-label="Game modes ticker">
      <div className="ribbon ribbon--a">
        <Track words={WORDS_A} dir={-1} />
      </div>
      <div className="ribbon ribbon--b">
        <Track words={WORDS_B} dir={1} />
      </div>
    </section>
  );
}
