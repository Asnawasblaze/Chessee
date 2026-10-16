import * as THREE from "three";

export type ThemeKey =
  | "bgDark"
  | "bgDark2"
  | "bgBright"
  | "inkOnDark"
  | "inkOnBright"
  | "accent1"
  | "accent2"
  | "accent3";

const VARS: Record<ThemeKey, string> = {
  bgDark: "--bg-dark-rgb",
  bgDark2: "--bg-dark-2-rgb",
  bgBright: "--bg-bright-rgb",
  inkOnDark: "--ink-on-dark-rgb",
  inkOnBright: "--ink-on-bright-rgb",
  accent1: "--accent-1-rgb",
  accent2: "--accent-2-rgb",
  accent3: "--accent-3-rgb",
};

export function themeRgb(key: ThemeKey): [number, number, number] {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(VARS[key])
    .trim();
  const [r = 0, g = 0, b = 0] = raw.split(",").map((n) => Number(n.trim()) / 255);
  return [r, g, b];
}

export function themeColor(key: ThemeKey, out = new THREE.Color()) {
  const [r, g, b] = themeRgb(key);
  return out.setRGB(r, g, b, THREE.SRGBColorSpace);
}

/* Derived tints: mix a theme colour toward white or black so a scene can keep
   its old light/dark ramp while following whichever palette is active. */
export function themeTint(key: ThemeKey, toward: "white" | "black", amount: number) {
  const c = themeColor(key);
  return c.lerp(new THREE.Color(toward === "white" ? 0xffffff : 0x000000), amount);
}

/* Calls back on every theme change, after the data attribute has updated. */
export function onThemeChange(cb: () => void) {
  const handler = () => requestAnimationFrame(cb);
  window.addEventListener("chessee:style", handler);
  return () => window.removeEventListener("chessee:style", handler);
}
