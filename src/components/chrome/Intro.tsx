import { useRef, useState } from "react";
import { LOGO_SRC } from "../../config/site";
import { gsap, prefersReducedMotion, useGSAP } from "../textFx/scramble";
import "./chrome.css";

const COLS = 12;
const ROWS = 7;
const SHARDS = 22;
const SEEN_KEY = "chessee:intro-seen";

export const INTRO_DONE_EVENT = "chessee:intro-done";

const alreadySeen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

/* Pixel-grid curtain that replaces the old progress-bar loader. Nothing here
   waits on network: the page is already rendering underneath, and the curtain
   dissolves tile by tile in a diagonal wave while shards assemble the knight,
   which then flies into the nav logo slot. */
export default function Intro() {
  const root = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(() => prefersReducedMotion() || alreadySeen());

  useGSAP(
    () => {
      const el = root.current;
      if (gone || !el) {
        window.dispatchEvent(new Event(INTRO_DONE_EVENT));
        return;
      }
      const tiles = el.querySelectorAll(".intro-tile");
      const shards = el.querySelectorAll<HTMLElement>(".intro-shard");
      const logo = el.querySelector<HTMLElement>(".intro-logo");
      if (!logo) return;

      const finish = () => {
        try {
          sessionStorage.setItem(SEEN_KEY, "1");
        } catch {
          /* private mode */
        }
        window.dispatchEvent(new Event(INTRO_DONE_EVENT));
        setGone(true);
      };

      gsap.set(logo, { autoAlpha: 0, scale: 0.8 });
      shards.forEach((s) => {
        const a = Math.random() * Math.PI * 2;
        const r = 160 + Math.random() * 280;
        gsap.set(s, { x: Math.cos(a) * r, y: Math.sin(a) * r, autoAlpha: 0 });
      });

      const tl = gsap.timeline({ onComplete: finish });
      tl.to(shards, {
        x: 0,
        y: 0,
        autoAlpha: 1,
        duration: 0.55,
        ease: "power3.in",
        stagger: { each: 0.012, from: "random" },
      })
        .to(shards, { autoAlpha: 0, duration: 0.12 })
        .to(logo, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, "<")
        .add(() => {
          const slot = document.querySelector<HTMLElement>("[data-nav-logo]");
          if (!slot) return;
          const a = logo.getBoundingClientRect();
          const b = slot.getBoundingClientRect();
          gsap.to(logo, {
            x: b.left + b.width / 2 - (a.left + a.width / 2),
            y: b.top + b.height / 2 - (a.top + a.height / 2),
            scale: b.width / a.width,
            duration: 0.7,
            ease: "expo.inOut",
          });
        }, "+=0.15")
        .to(
          tiles,
          {
            autoAlpha: 0,
            duration: 0.35,
            ease: "none",
            stagger: {
              grid: [ROWS, COLS],
              from: "start",
              amount: 0.7,
              axis: undefined,
            },
          },
          "<0.1",
        )
        .to(logo, { autoAlpha: 0, duration: 0.2 }, "-=0.2");
    },
    { scope: root },
  );

  if (gone) return null;

  return (
    <div ref={root} className="intro" aria-hidden="true">
      {Array.from({ length: COLS * ROWS }, (_, i) => (
        <span key={i} className="intro-tile" />
      ))}
      <div className="intro-center">
        {Array.from({ length: SHARDS }, (_, i) => (
          <span key={i} className="intro-shard" />
        ))}
        <img className="intro-logo" src={LOGO_SRC} alt="" />
      </div>
    </div>
  );
}
