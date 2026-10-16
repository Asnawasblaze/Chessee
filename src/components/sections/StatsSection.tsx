import { useRef } from "react";
import { gsap, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./sections.css";

const STATS = [
  { value: 2400000, suffix: "+", label: "Games played", fmt: "m" },
  { value: 180000, suffix: "", label: "Active players", fmt: "k" },
  { value: 96, suffix: "%", label: "Say they improved", fmt: "n" },
  { value: 12, suffix: "ms", label: "Move latency", fmt: "n" },
] as const;

const format = (n: number, fmt: string) => {
  if (fmt === "m") return `${(n / 1_000_000).toFixed(1)}M`;
  if (fmt === "k") return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
};

export default function StatsSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const nums = el.querySelectorAll<HTMLElement>(".stat-num");
      if (prefersReducedMotion()) return;
      nums.forEach((n) => {
        const target = Number(n.dataset.value);
        const fmt = n.dataset.fmt ?? "n";
        const o = { v: 0 };
        n.textContent = format(0, fmt);
        gsap.to(o, {
          v: target,
          duration: 2,
          ease: "power3.out",
          onUpdate: () => {
            n.textContent = format(o.v, fmt);
          },
          scrollTrigger: { trigger: n, start: "top 88%", once: true },
        });
      });
      gsap.from(".stat", {
        yPercent: 40,
        autoAlpha: 0,
        stagger: 0.1,
        duration: 0.9,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 75%", once: true },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="stats" aria-label="Chessee in numbers">
      <ul className="stats-grid">
        {STATS.map((s) => (
          <li key={s.label} className="stat">
            <p className="stat-figure fx-display">
              <span
                className="stat-num"
                data-value={s.value}
                data-fmt={s.fmt}
                aria-label={`${format(s.value, s.fmt)}${s.suffix}`}
              >
                {format(s.value, s.fmt)}
              </span>
              <span className="stat-suffix">{s.suffix}</span>
            </p>
            <p className="stat-label fx-label">{s.label}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
