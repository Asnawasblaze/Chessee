import { useLayoutEffect, useRef, type ElementType, type ReactNode } from "react";
import {
  gsap,
  ScrollTrigger,
  prefersReducedMotion,
  scrambleTo,
  useGSAP,
} from "./scramble";

interface Props {
  text: string;
  as?: ElementType;
  className?: string;
  /** Re-scramble when the pointer or keyboard focus lands on the nearest interactive parent. */
  hover?: boolean;
  /** Decode from noise the first time the element scrolls into view. */
  onView?: boolean;
  delay?: number;
  duration?: number;
  children?: ReactNode;
}

/* A label whose real text is always in the DOM (and in aria-label); the noise
   is only ever painted over it. */
export default function ScrambleText({
  text,
  as: Tag = "span",
  className,
  hover = true,
  onView = false,
  delay = 0,
  duration = 0.8,
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = text;
  }, [text]);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;

      const target = hover
        ? ((el.closest("a, button, [data-scramble-host]") as HTMLElement | null) ?? el)
        : null;
      const play = () => scrambleTo(el, text, { duration: 0.55 });

      target?.addEventListener("pointerenter", play);
      target?.addEventListener("focus", play);

      let trigger: ScrollTrigger | undefined;
      if (onView) {
        gsap.set(el, { autoAlpha: 0 });
        trigger = ScrollTrigger.create({
          trigger: el,
          start: "top 88%",
          once: true,
          onEnter: () => {
            gsap.set(el, { autoAlpha: 1 });
            el.textContent = "";
            scrambleTo(el, text, { duration, delay });
          },
        });
      }

      return () => {
        target?.removeEventListener("pointerenter", play);
        target?.removeEventListener("focus", play);
        trigger?.kill();
        el.textContent = text;
      };
    },
    { dependencies: [text, hover, onView, delay, duration], scope: ref },
  );

  /* React renders the element empty; the text is written imperatively so the
     scramble can rewrite it without orphaning a React-owned text node. */
  return <Tag ref={ref} className={className} aria-label={text} />;
}
