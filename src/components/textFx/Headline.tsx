import { useLayoutEffect, useRef, type ElementType } from "react";
import { useStyleState } from "../../theme/styleStore";
import {
  gsap,
  ScrollTrigger,
  prefersReducedMotion,
  scrambleChars,
  useGSAP,
} from "./scramble";
import "./textFx.css";

interface Props {
  /** Lines of the headline. Each line is one masked, decoded row. */
  lines: string[];
  /** Words (case-insensitive) that land last and take the accent colour. */
  accent?: string[];
  as?: ElementType;
  className?: string;
  /** Wait for an external event (e.g. an intro) before playing. */
  paused?: boolean;
  /** Play immediately instead of waiting for scroll-enter. */
  immediate?: boolean;
  /** "dark" paints bright ink, "bright" paints dark ink. */
  tone?: "dark" | "bright";
}

/* Masked line rise, then every word decodes from noise with the accent word
   resolving last. Words are measured and pinned to min-width while they
   scramble, so a proportional font does not make the line jitter. */
export default function Headline({
  lines,
  accent = [],
  as: Tag = "h2",
  className = "",
  paused = false,
  immediate = false,
  tone = "dark",
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const { fontSystem } = useStyleState();
  const accentSet = accent.map((a) => a.toLowerCase());
  const label = lines.join(" ");

  /* Word spans render empty and are filled here: the scramble rewrites their
     text, which React must not own. */
  useLayoutEffect(() => {
    ref.current
      ?.querySelectorAll<HTMLElement>(".hl-word")
      .forEach((w) => {
        w.textContent = w.dataset.word ?? "";
      });
  }, [label]);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || paused) return;
      const rows = root.querySelectorAll<HTMLElement>(".hl-row");
      const words = root.querySelectorAll<HTMLElement>(".hl-word");

      if (prefersReducedMotion()) {
        gsap.set(rows, { clearProps: "all" });
        return;
      }

      words.forEach((w) => {
        w.style.minWidth = `${w.getBoundingClientRect().width}px`;
      });
      gsap.set(rows, { yPercent: 110, rotate: 3 });

      const run = () => {
        const tl = gsap.timeline();
        tl.to(rows, {
          yPercent: 0,
          rotate: 0,
          duration: 0.9,
          ease: "expo.out",
          stagger: 0.1,
        });
        const chars = scrambleChars();
        words.forEach((w, i) => {
          const final = w.dataset.word ?? "";
          const isAccent = w.classList.contains("hl-accent");
          w.textContent = "";
          tl.to(
            w,
            {
              duration: 0.8 + (isAccent ? 0.5 : 0),
              ease: "none",
              scrambleText: {
                text: final,
                chars,
                speed: 0.55,
                revealDelay: 0.1,
                tweenLength: false,
              },
            },
            0.15 + i * 0.06 + (isAccent ? 0.35 : 0),
          );
        });
        tl.add(() => {
          words.forEach((w) => (w.style.minWidth = ""));
        });
      };

      if (immediate) {
        run();
        return;
      }
      const st = ScrollTrigger.create({
        trigger: root,
        start: "top 85%",
        once: true,
        onEnter: run,
      });
      return () => st.kill();
    },
    { dependencies: [paused, immediate, fontSystem, label], scope: ref },
  );

  return (
    <Tag
      ref={ref}
      className={`hl hl--${tone} ${className}`}
      aria-label={label}
    >
      {lines.map((line, li) => (
        <span className="hl-mask" key={li} aria-hidden="true">
          <span className="hl-row">
            {line.split(" ").map((word, wi, arr) => (
              <span key={wi}>
                <span
                  className={`hl-word${
                    accentSet.includes(word.toLowerCase().replace(/[.,!?]/g, ""))
                      ? " hl-accent"
                      : ""
                  }`}
                  data-word={word}
                />
                {wi < arr.length - 1 ? " " : null}
              </span>
            ))}
          </span>
        </span>
      ))}
    </Tag>
  );
}
