export type FontSystemId =
  | "geist"
  | "poster"
  | "quirk"
  | "arcade"
  | "tournament"
  | "brutal";

export type ColorThemeId =
  | "ultraviolet"
  | "poster"
  | "acid"
  | "ember"
  | "mint"
  | "bubblegum";

export interface FontSystem {
  id: FontSystemId;
  name: string;
  display: string;
  text: string;
  note: string;
  /* Google Fonts stylesheet to lazy-load. Geist Spec self-hosts Geist and only
     needs Manrope, which index.html already loads. */
  href: string | null;
  scramble: string;
}

export interface ColorTheme {
  id: ColorThemeId;
  name: string;
  swatch: [string, string, string, string];
}

const G = "https://fonts.googleapis.com/css2?";

export const FONT_SYSTEMS: FontSystem[] = [
  {
    id: "geist",
    name: "Geist Spec",
    display: "Manrope",
    text: "Geist Sans",
    note: "Manrope 800, Geist Sans, Geist Pixel Square",
    href: null,
    scramble: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/+*",
  },
  {
    id: "poster",
    name: "Poster",
    display: "Gabarito",
    text: "DM Mono",
    note: "Heavy geometric, tight",
    href: `${G}family=Gabarito:wght@800;900&family=DM+Mono:wght@400;500&display=swap`,
    scramble: "ABCDEFGHIJKLMNOPQRSTUVWXYZ#@&!?",
  },
  {
    id: "quirk",
    name: "Quirk",
    display: "Bricolage Grotesque",
    text: "Space Mono",
    note: "Ink-trap oddities, condensed",
    href: `${G}family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,800&family=Space+Mono:wght@400;700&display=swap`,
    scramble: "abcdefghijklmnopqrstuvwxyz%$#@*",
  },
  {
    id: "arcade",
    name: "Arcade",
    display: "Dela Gothic One",
    text: "Pixelify Sans",
    note: "Chunky gothic, pixel labels",
    href: `${G}family=Dela+Gothic+One&family=Pixelify+Sans:wght@500;700&display=swap`,
    scramble: "█▓▒░▀▄■□",
  },
  {
    id: "tournament",
    name: "Tournament",
    display: "Big Shoulders Display",
    text: "Martian Mono",
    note: "Tall scoreboard condensed",
    href: `${G}family=Big+Shoulders+Display:wght@900&family=Martian+Mono:wght@400;600&display=swap`,
    scramble: "0123456789/\\|-+",
  },
  {
    id: "brutal",
    name: "Brutal",
    display: "Archivo",
    text: "IBM Plex Mono",
    note: "Heavy, narrow, industrial",
    href: `${G}family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500&display=swap`,
    scramble: "#%&/\\|<>[]{}",
  },
];

export const COLOR_THEMES: ColorTheme[] = [
  { id: "ultraviolet", name: "Ultraviolet", swatch: ["#07050e", "#8b5cf6", "#c8ff2e", "#d9ccff"] },
  { id: "poster", name: "Poster", swatch: ["#0b0b0f", "#ffb347", "#ffe500", "#fff6e5"] },
  { id: "acid", name: "Acid", swatch: ["#050505", "#ff2e93", "#d7ff2e", "#d7ff2e"] },
  { id: "ember", name: "Ember", swatch: ["#0e0807", "#ff4b1f", "#ffb000", "#ffe9d6"] },
  { id: "mint", name: "Mint Arcade", swatch: ["#04100d", "#19e68c", "#ffe24a", "#c8ffe9"] },
  { id: "bubblegum", name: "Bubblegum", swatch: ["#12061a", "#ff3ea5", "#ffe24a", "#ffd3f0"] },
];
