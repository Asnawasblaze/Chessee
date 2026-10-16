import { useRef } from "react";
import Headline from "../textFx/Headline";
import { gsap, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./sections.css";

const STEPS = [
  { when: "Now", title: "Open beta", body: "Online play, six bots, and the AI coach that explains your mistakes.", done: true },
  { when: "Next", title: "Ranked ladders", body: "Seasons, placement games and tiers from Wood to Grandmaster.", done: false },
  { when: "Later", title: "Clubs & tournaments", body: "Build a club, host brackets, and stream boards to your friends.", done: false },
  { when: "Soon", title: "Mobile apps", body: "Same account, same rating, in your pocket on iOS and Android.", done: false },
] as const;

export default function RoadmapSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || prefersReducedMotion()) return;
      gsap.fromTo(
        ".road-line-fill",
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          transformOrigin: "top",
          scrollTrigger: { trigger: ".road-list", start: "top 70%", end: "bottom 60%", scrub: 0.5 },
        },
      );
      gsap.utils.toArray<HTMLElement>(".road-step", el).forEach((s) => {
        gsap.from(s, {
          x: 60,
          autoAlpha: 0,
          duration: 0.9,
          ease: "expo.out",
          scrollTrigger: { trigger: s, start: "top 82%", once: true },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="roadmap" className="road" aria-label="Roadmap">
      <div className="road-head">
        <span className="fx-eyebrow">Where this is going</span>
        <Headline as="h2" className="fx-h1" lines={["The road", "ahead."]} accent={["ahead."]} />
      </div>
      <ol className="road-list">
        <span className="road-line" aria-hidden="true">
          <span className="road-line-fill" />
        </span>
        {STEPS.map((s) => (
          <li key={s.title} className={`road-step${s.done ? " is-done" : ""}`}>
            <span className="road-when fx-pixel">{s.when}</span>
            <div>
              <h3 className="fx-h3">{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
