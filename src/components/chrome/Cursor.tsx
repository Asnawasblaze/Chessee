import { useEffect, useRef } from "react";
import gsap from "gsap";
import "./chrome.css";

/* A square, pixel-grid follower that echoes the logo's shards. It grows over
   anything interactive and turns into a labelled disc over [data-cursor="..."]
   (the DRAG disc on the horizontal modes track). The native cursor stays
   visible, so this is purely additive and never traps a pointer. */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = dot.current;
    if (!fine || reduced || !el) return;

    gsap.set(el, { xPercent: -50, yPercent: -50, autoAlpha: 0 });
    const x = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3.out" });

    const move = (e: PointerEvent) => {
      x(e.clientX);
      y(e.clientY);
      gsap.to(el, { autoAlpha: 1, duration: 0.2, overwrite: "auto" });
      const t = (e.target as HTMLElement | null)?.closest?.(
        "[data-cursor], a, button, summary, input, [role='button']",
      ) as HTMLElement | null;
      const text = t?.dataset.cursor ?? "";
      if (label.current) label.current.textContent = text;
      el.dataset.state = text ? "label" : t ? "hover" : "idle";
    };
    const leave = () => gsap.to(el, { autoAlpha: 0, duration: 0.2 });

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={dot} className="cx" data-state="idle" aria-hidden="true">
      <span ref={label} className="cx-label" />
    </div>
  );
}
