import { useEffect, useRef, useState } from "react";
import {
  COLOR_THEMES,
  FONT_SYSTEMS,
} from "../theme/themes";
import {
  cycleFont,
  cycleTheme,
  preloadFontSystem,
  resetStyle,
  setColorTheme,
  setFontSystem,
  shareUrl,
  shuffleStyle,
  useStyleState,
} from "../theme/styleStore";
import "./StyleLab.css";

export default function StyleLab() {
  const { fontSystem, colorTheme } = useStyleState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const theme = COLOR_THEMES.find((t) => t.id === colorTheme)!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") cycleFont();
      else if (e.key === "t" || e.key === "T") cycleTheme();
      else if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="stylelab" ref={rootRef} data-cursor="hover">
      <button
        type="button"
        className="stylelab-pill"
        aria-expanded={open}
        aria-controls="stylelab-panel"
        aria-label="Open style lab: fonts and colour themes"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="stylelab-aa">Aa</span>
        <span className="stylelab-dots" aria-hidden="true">
          {theme.swatch.slice(1).map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
      </button>

      {open ? (
        <div className="stylelab-panel" id="stylelab-panel" role="dialog" aria-label="Style lab">
          <div className="stylelab-head">
            <span className="fx-eyebrow">Style lab</span>
            <span className="fx-meta stylelab-hint">F fonts / T colours</span>
          </div>

          <p className="fx-label stylelab-title">Font system</p>
          <div className="stylelab-fonts">
            {FONT_SYSTEMS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="stylelab-font"
                aria-pressed={f.id === fontSystem}
                onPointerEnter={() => preloadFontSystem(f.id)}
                onFocus={() => preloadFontSystem(f.id)}
                onClick={() => setFontSystem(f.id)}
              >
                <span className="stylelab-font-name">{f.name}</span>
                <span
                  className="stylelab-font-sample"
                  style={{ fontFamily: `"${f.display}", sans-serif`, fontWeight: 800 }}
                >
                  Checkmate
                </span>
                <span
                  className="stylelab-font-text"
                  style={{ fontFamily: `"${f.text}", sans-serif` }}
                >
                  Play. Analyze.
                </span>
                {f.id === "geist" ? (
                  <span className="stylelab-font-px" style={{ fontFamily: '"Geist Pixel Square"' }}>
                    ELO 2840
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <p className="fx-label stylelab-title">Colour theme</p>
          <div className="stylelab-themes">
            {COLOR_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="stylelab-theme"
                aria-pressed={t.id === colorTheme}
                onClick={() => setColorTheme(t.id)}
              >
                <span
                  className="stylelab-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatch[0]} 0 45%, ${t.swatch[1]} 45% 70%, ${t.swatch[2]} 70% 85%, ${t.swatch[3]} 85%)`,
                  }}
                />
                <span className="stylelab-theme-name">{t.name}</span>
              </button>
            ))}
          </div>

          <div className="stylelab-actions">
            <button type="button" onClick={shuffleStyle}>Shuffle</button>
            <button type="button" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            <button type="button" onClick={resetStyle}>Reset</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
