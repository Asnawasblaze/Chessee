import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import primaryImg from "../assets/new-primary.webp";
import secondaryImg from "../assets/secondary.webp";
import "./LoadingScreen.css";

gsap.registerPlugin(useGSAP);

// Boot-log lines, cycled while real assets are still loading — keeps the
// screen's chess-engine voice instead of a generic "Loading…" spinner.
const STATUS_LINES = [
  "Calibrating engine…",
  "Loading position…",
  "Rendering board…",
  "Syncing HUD telemetry…",
];

// Floor so a cached/instant load doesn't just flash the boot sequence, and
// a ceiling so a slow network can't hold the page hostage indefinitely.
const MIN_VISIBLE_MS = 1100;
const MAX_WAIT_MS = 6000;

function randInt(n: number) {
  return Math.floor(Math.random() * n);
}

/** Resolves once the image has loaded — or failed, since a broken asset
 * shouldn't hold the loader open forever. */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface LoadingScreenProps {
  /** Called once the exit animation has finished — the parent unmounts
   * this component and lifts `inert` off the real content at that point. */
  onDone: () => void;
}

export default function LoadingScreen({ onDone }: LoadingScreenProps) {
  const barFillRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const emblemRef = useRef<HTMLDivElement>(null);
  const progress = useRef({ p: 0 });

  // Body scroll lock while the boot sequence covers the page.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useGSAP(
    (_context, contextSafe) => {
      let cancelled = false;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      const writeProgress = () => {
        const pct = Math.round(progress.current.p);
        if (barFillRef.current) {
          barFillRef.current.style.width = `${progress.current.p}%`;
        }
        if (percentRef.current) percentRef.current.textContent = String(pct);
      };

      const bumpTo = (value: number, duration: number) => {
        gsap.to(progress.current, {
          p: value,
          duration,
          ease: "power1.out",
          overwrite: "auto",
          onUpdate: writeProgress,
        });
      };

      let statusIndex = 0;
      const cycleStatus = contextSafe!(() => {
        const el = statusRef.current;
        if (!el) return;
        statusIndex = (statusIndex + 1) % STATUS_LINES.length;
        gsap.to(el, {
          autoAlpha: 0,
          y: -4,
          duration: 0.15,
          ease: "power2.in",
          onComplete: () => {
            el.textContent = STATUS_LINES[statusIndex];
            gsap.fromTo(
              el,
              { autoAlpha: 0, y: 4 },
              { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" }
            );
          },
        });
      });

      let statusTimer = 0;
      let trickleTimer = 0;

      if (!reduceMotion) {
        statusTimer = window.setInterval(cycleStatus, 950);
        bumpTo(18, 0.5);
        trickleTimer = window.setInterval(() => {
          if (progress.current.p < 82) {
            bumpTo(Math.min(82, progress.current.p + randInt(8) + 4), 0.6);
          }
        }, 550);
      }

      const runExit = contextSafe!(() => {
        window.clearInterval(statusTimer);
        window.clearInterval(trickleTimer);

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          onComplete: onDone,
        });

        if (reduceMotion) {
          tl.to(frameRef.current, { autoAlpha: 0, duration: 0.25 });
          return;
        }

        // Completion flare — same beat as the hero HUD's own
        // "holo-revised" cue, reused here so the two screens speak one
        // motion language.
        tl.addLabel("ready")
          .to(emblemRef.current, {
            "--emblem-glow": 1,
            duration: 0.3,
            ease: "power2.out",
          })
          .to(
            frameRef.current,
            {
              autoAlpha: 0,
              y: -14,
              filter: "blur(6px)",
              duration: 0.55,
              ease: "power2.in",
            },
            "ready+=0.15"
          );
      });

      const assetsReady = Promise.all([
        preloadImage(primaryImg),
        preloadImage(secondaryImg),
        document.fonts ? document.fonts.ready : Promise.resolve(),
      ]);

      Promise.race([
        Promise.all([assetsReady, delay(MIN_VISIBLE_MS)]),
        delay(MAX_WAIT_MS),
      ]).then(() => {
        if (cancelled) return;
        bumpTo(100, 0.4);
        gsap.delayedCall(reduceMotion ? 0.1 : 0.5, runExit);
      });

      return () => {
        cancelled = true;
        window.clearInterval(statusTimer);
        window.clearInterval(trickleTimer);
      };
    },
    { dependencies: [] }
  );

  return (
    <div
      ref={frameRef}
      className="loading-screen"
      role="status"
      aria-live="polite"
      aria-label="Chessee is loading"
    >
      <span className="loading-corner corner-tl" aria-hidden="true" />
      <span className="loading-corner corner-tr" aria-hidden="true" />
      <span className="loading-corner corner-bl" aria-hidden="true" />
      <span className="loading-corner corner-br" aria-hidden="true" />
      <div className="loading-grid" aria-hidden="true" />
      <div className="loading-scan" aria-hidden="true" />

      <div className="loading-content">
        <div ref={emblemRef} className="loading-emblem" aria-hidden="true">
          <span className="loading-emblem-ring ring-dash" />
          <span className="loading-emblem-ring ring-pulse" />
          <span className="loading-emblem-glyph">♞</span>
        </div>

        <p className="loading-wordmark">CHESSEE</p>

        <div className="loading-bar" aria-hidden="true">
          <div ref={barFillRef} className="loading-bar-fill" />
        </div>

        <div className="loading-readout">
          <span ref={statusRef} className="loading-status">
            {STATUS_LINES[0]}
          </span>
          <span className="loading-percent">
            <span ref={percentRef}>0</span>
            <i>%</i>
          </span>
        </div>
      </div>
    </div>
  );
}
