import { useSyncExternalStore } from "react";
import {
  COLOR_THEMES,
  FONT_SYSTEMS,
  type ColorThemeId,
  type FontSystemId,
} from "./themes";

export interface StyleState {
  fontSystem: FontSystemId;
  colorTheme: ColorThemeId;
}

const KEY = "chessee:style";
const DEFAULTS: StyleState = { fontSystem: "geist", colorTheme: "ultraviolet" };

const isFont = (v: unknown): v is FontSystemId =>
  FONT_SYSTEMS.some((f) => f.id === v);
const isTheme = (v: unknown): v is ColorThemeId =>
  COLOR_THEMES.some((t) => t.id === v);

function readInitial(): StyleState {
  const state = { ...DEFAULTS };
  if (typeof window === "undefined") return state;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (isFont(saved.fontSystem)) state.fontSystem = saved.fontSystem;
    if (isTheme(saved.colorTheme)) state.colorTheme = saved.colorTheme;
  } catch {
    /* ignore corrupt storage */
  }
  const q = new URLSearchParams(window.location.search);
  const f = q.get("font");
  const t = q.get("theme");
  if (isFont(f)) state.fontSystem = f;
  if (isTheme(t)) state.colorTheme = t;
  return state;
}

let state: StyleState = readInitial();
const listeners = new Set<() => void>();
const loaded = new Set<string>();

export function preloadFontSystem(id: FontSystemId) {
  const sys = FONT_SYSTEMS.find((f) => f.id === id);
  if (!sys?.href || loaded.has(sys.href)) return;
  loaded.add(sys.href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = sys.href;
  document.head.appendChild(link);
}

function apply(root: HTMLElement) {
  root.dataset.font = state.fontSystem;
  root.dataset.theme = state.colorTheme;
  const sys = FONT_SYSTEMS.find((f) => f.id === state.fontSystem);
  if (sys) root.style.setProperty("--scramble-chars", JSON.stringify(sys.scramble));
}

export function initStyle() {
  preloadFontSystem(state.fontSystem);
  apply(document.documentElement);
}

function set(next: Partial<StyleState>) {
  const prev = state;
  state = { ...state, ...next };
  if (prev.fontSystem !== state.fontSystem) preloadFontSystem(state.fontSystem);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  apply(root);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((l) => l());
  window.dispatchEvent(
    new CustomEvent("chessee:style", {
      detail: { ...state, fontChanged: prev.fontSystem !== state.fontSystem },
    }),
  );
  window.setTimeout(() => root.classList.remove("theme-switching"), 600);
}

export const setFontSystem = (fontSystem: FontSystemId) => set({ fontSystem });
export const setColorTheme = (colorTheme: ColorThemeId) => set({ colorTheme });

export function cycleFont() {
  const i = FONT_SYSTEMS.findIndex((f) => f.id === state.fontSystem);
  setFontSystem(FONT_SYSTEMS[(i + 1) % FONT_SYSTEMS.length].id);
}
export function cycleTheme() {
  const i = COLOR_THEMES.findIndex((t) => t.id === state.colorTheme);
  setColorTheme(COLOR_THEMES[(i + 1) % COLOR_THEMES.length].id);
}
export function shuffleStyle() {
  const f = FONT_SYSTEMS[Math.floor(Math.random() * FONT_SYSTEMS.length)].id;
  const t = COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)].id;
  set({ fontSystem: f, colorTheme: t });
}
export function resetStyle() {
  set({ ...DEFAULTS });
}
export function shareUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set("font", state.fontSystem);
  u.searchParams.set("theme", state.colorTheme);
  return u.toString();
}

export function useStyleState() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => DEFAULTS,
  );
}

export const getStyleState = () => state;
