import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrambleTextPlugin, SplitText);

export { gsap, ScrollTrigger, SplitText, useGSAP };

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The active font system publishes its scramble alphabet as a quoted string in
   --scramble-chars, so the noise always matches the typeface on screen. */
export function scrambleChars(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--scramble-chars")
    .trim();
  if (!raw) return "upperCase";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed) return parsed;
  } catch {
    /* fall through to quote stripping */
  }
  return raw.replace(/^["']|["']$/g, "") || "upperCase";
}

interface ScrambleOptions {
  duration?: number;
  delay?: number;
  chars?: string;
  speed?: number;
}

export function scrambleTo(
  el: Element,
  text: string,
  { duration = 0.9, delay = 0, chars, speed = 0.6 }: ScrambleOptions = {},
) {
  if (prefersReducedMotion()) {
    el.textContent = text;
    return null;
  }
  return gsap.to(el, {
    duration,
    delay,
    ease: "none",
    overwrite: true,
    scrambleText: {
      text,
      chars: chars ?? scrambleChars(),
      speed,
      revealDelay: 0.12,
      tweenLength: false,
    },
  });
}
