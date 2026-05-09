// src/render/glyphs.ts
// Glyph table with Unicode ↔ ASCII fallback (H8).
// Consumers call: glyph("bolt", ctx.config.display.glyphs)

export type GlyphMode = "unicode" | "ascii" | "auto";
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
  return resolved === "ascii" ? ASCII[key] : UNICODE[key];
}
