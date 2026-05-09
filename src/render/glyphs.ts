// src/render/glyphs.ts
// Glyph table with three tiers: nerd / unicode / ascii.
//
// `auto` resolution NEVER promotes to nerd — Nerd Fonts require a font install
// that env vars cannot reliably detect. Users opt in explicitly via config
// (`display.glyphs: "nerd"`), ideally after eyeballing the test row in
// `/ohud doctor`.
//
// Keys absent from NERD fall through to UNICODE, so partial coverage is OK.

export type GlyphMode = "unicode" | "ascii" | "auto" | "nerd";
export type GlyphKey =
  | "bolt" | "clock" | "running" | "done"
  | "todo" | "active" | "sep"
  | "barFull" | "barEmpty"
  | "up" | "down";

const UNICODE: Record<GlyphKey, string> = {
  bolt:     "⚡",
  clock:    "⏱",
  running:  "◐",
  done:     "✓",
  todo:     "▹",
  active:   "▸",
  sep:      "│",
  barFull:  "█",
  barEmpty: "░",
  up:       "↑",
  down:     "↓",
};

// Nerd Fonts overrides — only the most-visible keys. Unset keys fall through
// to UNICODE. Codepoints from the Nerd Fonts cheat sheet
// (https://www.nerdfonts.com/cheat-sheet).
const NERD: Partial<Record<GlyphKey, string>> = {
  done:    "",   // nf-fa-check
  running: "",   // nf-fa-spinner
  bolt:    "",   // nf-fa-bolt
  clock:   "",   // nf-fa-clock_o
  active:  "",   // nf-fa-chevron_right
};

const ASCII: Record<GlyphKey, string> = {
  bolt:     "*",
  clock:    "t",
  running:  "o",
  done:     "x",
  todo:     "-",
  active:   ">",
  sep:      "|",
  barFull:  "#",
  barEmpty: ".",
  up:       "^",
  down:     "v",
};

function autoMode(): "unicode" | "ascii" {
  const lang = process.env.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8")) return "unicode";
  if (process.env.LC_ALL?.includes("UTF-8")) return "unicode";
  return "ascii";
}

export function glyph(key: GlyphKey, mode: GlyphMode): string {
  const resolved = mode === "auto" ? autoMode() : mode;
  if (resolved === "nerd")  return NERD[key] ?? UNICODE[key];
  if (resolved === "ascii") return ASCII[key];
  return UNICODE[key];
}
