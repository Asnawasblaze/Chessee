import { useEffect, useRef, useState } from "react";
import { COFFEE_URL, NAV_LINKS, SOCIALS } from "../../config/site";
import { gsap, prefersReducedMotion, scrambleTo, useGSAP } from "../textFx/scramble";
import "./chrome.css";

const TILES = 60;
const LINKS = [...NAV_LINKS, { label: "Buy me a coffee", href: COFFEE_URL }] as const;

function useClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

export default function MenuOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const time = useClock();

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const tiles = el.querySelectorAll(".menu-tile");
      const links = el.querySelectorAll(".menu-link");
      const idx = el.querySelectorAll<HTMLElement>(".menu-index");
      const foot = el.querySelector(".menu-foot");

      if (prefersReducedMotion()) {
        tl.current = null;
        return;
      }
      gsap.set(links, { yPercent: 110 });
      gsap.set(foot, { autoAlpha: 0 });
      const t = gsap.timeline({ paused: true });
      t.to(tiles, {
        scale: 1,
        duration: 0.45,
        ease: "power3.out",
        stagger: { each: 0.008, from: "random" },
      })
        .to(links, { yPercent: 0, duration: 0.8, ease: "expo.out", stagger: 0.07 }, "-=0.15")
        .add(() => idx.forEach((n) => scrambleTo(n, n.dataset.index ?? "", { duration: 0.6 })), "<")
        .to(foot, { autoAlpha: 1, duration: 0.4 }, "-=0.5");
      tl.current = t;
      return () => {
        t.kill();
      };
    },
    { scope: root },
  );

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (open) {
      if (tl.current) tl.current.timeScale(1).play();
      else gsap.set(el.querySelectorAll(".menu-tile"), { scale: 1 });
      document.body.style.overflow = "hidden";
      el.querySelector<HTMLElement>(".menu-link")?.focus({ preventScroll: true });
    } else {
      if (tl.current) tl.current.timeScale(1.8).reverse();
      else gsap.set(el.querySelectorAll(".menu-tile"), { scale: 0 });
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !root.current) return;
      const f = Array.from(
        root.current.querySelectorAll<HTMLElement>("a[href], button"),
      ).filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      ref={root}
      id="site-menu"
      className="menu"
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      aria-hidden={!open}
      {...(!open ? { inert: true } : {})}
    >
      <div className="menu-tiles" aria-hidden="true">
        {Array.from({ length: TILES }, (_, i) => (
          <span key={i} className="menu-tile" />
        ))}
      </div>

      <ul className="menu-links">
        {LINKS.map((l, i) => {
          const external = l.href.startsWith("http");
          return (
            <li key={l.label} className="menu-item">
              <a
                className="menu-link"
                href={l.href}
                onClick={onClose}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <span className="menu-index" data-index={String(i + 1).padStart(2, "0")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {l.label}
              </a>
            </li>
          );
        })}
      </ul>

      <div className="menu-foot">
        <span>Local time {time}</span>
        <div className="menu-socials">
          {SOCIALS.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
