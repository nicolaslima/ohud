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

/** Icon override modes for iconForMode(). "auto" = derive from session mode. */
export type IconMode = "auto" | "anthropic" | "ollama" | "none";

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

// ---------------------------------------------------------------------------
// iconForMode — brand icon picker for the prose statusline
// ---------------------------------------------------------------------------
//
// Icons are kept in a small inline table rather than merged with the GlyphKey
// tables above, because they carry semantic meaning tied to the session mode
// (anthropic/ollama) rather than a UI concept (bolt, clock…). Keeping them
// separate avoids polluting GlyphKey with brand identifiers.
//
// NOTE: 🦙 (U+1F999) falls in the emoji range 0x1F300–0x1FAFF, so wcwidth()
// in src/render/width.ts already counts it as width-2 via the emoji block
// check. No explicit WIDTH_2_GLYPHS entry is needed.

type IconVariant = "anthropic" | "ollama";

const ICON_UNICODE: Record<IconVariant, string> = {
  anthropic: "✱",   // U+2731 EIGHT SPOKED ASTERISK
  ollama:    "◆",   // U+25C6 BLACK DIAMOND (width-1, distinct from anthropic's asterisk)
};

// nf-fa-asterisk (U+F069) for anthropic; ollama has no Nerd Font glyph → falls back.
const ICON_NERD: Partial<Record<IconVariant, string>> = {
  anthropic: "",   // nf-fa-asterisk U+F069
  ollama:    "",   // nf-fae-llama U+E27B
};

const ICON_ASCII: Record<IconVariant, string> = {
  anthropic: "*",
  ollama:    "o",
};

/**
 * Pick the brand icon for the current session mode.
 *
 * @param mode     Session mode ("anthropic" | "ollama" | any other string treated as "unknown")
 * @param glyphMode The terminal glyph tier (unicode / ascii / nerd / auto)
 * @param override  "auto" = derive from mode; "anthropic"/"ollama" = use that brand; "none" = ""
 */
export function iconForMode(
  mode: import("../types.js").RenderMode,
  glyphMode: GlyphMode,
  override: IconMode = "auto",
): string {
  // Resolve which brand icon to use
  let variant: IconVariant | null;
  if (override === "none") return "";
  if (override === "auto") {
    if (mode === "anthropic") variant = "anthropic";
    else if (mode === "ollama") variant = "ollama";
    else variant = null; // unknown mode → no icon
  } else {
    variant = override; // explicit brand override
  }

  if (variant === null) return "";

  // Resolve glyph tier — icons take a slightly different path than the
  // generic glyph() helper:
  //
  //   - For UI glyphs (bolt, clock, spinner) we deliberately never promote
  //     "auto" to "nerd" because they tick constantly and a box character
  //     on every frame would be visually noisy.
  //   - For brand icons we DO promote "auto" → "nerd" because the icon
  //     appears once per line and the only non-emoji llama in common use
  //     is the Nerd Font codepoint U+E27B. Falling back to ◆ in unicode
  //     mode loses the brand's personality. Users who don't have Nerd
  //     Fonts installed can opt out via `display.glyphs: "unicode"`.
  let tier: "unicode" | "ascii" | "nerd";
  if (glyphMode === "auto")        tier = autoMode() === "ascii" ? "ascii" : "nerd";
  else                              tier = glyphMode;

  if (tier === "ascii") return ICON_ASCII[variant];
  if (tier === "nerd")  return ICON_NERD[variant] ?? ICON_UNICODE[variant];
  return ICON_UNICODE[variant];
}
