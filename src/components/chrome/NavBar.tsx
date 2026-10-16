import { useRef, useState } from "react";
import { COFFEE_URL, LOGO_SRC, NAV_LINKS, PLAY_URL } from "../../config/site";
import { gsap, ScrollTrigger, useGSAP } from "../textFx/scramble";
import ScrambleText from "../textFx/ScrambleText";
import PillButton from "./PillButton";
import MenuOverlay from "./MenuOverlay";
import "./chrome.css";

const CupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 4h8v4a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4Zm8 1h1.5a1.5 1.5 0 0 1 0 3H10" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export default function NavBar() {
  const root = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("");

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const st = ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          const hide = self.direction === 1 && self.scroll() > 240;
          gsap.to(el, {
            yPercent: hide ? -130 : 0,
            duration: 0.45,
            ease: "power3.out",
            overwrite: "auto",
          });
          let current = "";
          NAV_LINKS.forEach((l) => {
            const target = document.querySelector(l.href);
            if (target && target.getBoundingClientRect().top <= window.innerHeight * 0.45) {
              current = l.href;
            }
          });
          setActive((prev) => (prev === current ? prev : current));
        },
      });
      return () => st.kill();
    },
    { scope: root },
  );

  return (
    <>
      <header ref={root} className="nav">
        <a className="nav-logo" href="#top" aria-label="Chessee, back to top" data-nav-logo>
          <img src={LOGO_SRC} alt="" width={78} height={52} />
        </a>

        <nav className="nav-pill" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              className="nav-link"
              href={l.href}
              aria-current={active === l.href ? "true" : undefined}
            >
              <ScrambleText text={l.label} />
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <PillButton
            href={COFFEE_URL}
            label="Buy me a coffee"
            variant="ghost"
            external
            icon={<CupIcon />}
            className="nav-hide-sm"
          />
          <PillButton href={PLAY_URL} label="Play" />
          <button
            type="button"
            className="nav-menu"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="nav-menu-icon" aria-hidden="true">
              <i />
              <i />
            </span>
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </header>
      <MenuOverlay open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
