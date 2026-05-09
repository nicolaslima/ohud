// src/render/layout/hush.ts
//
// HushLayout — Pure-inspired minimal statusline.
//
// Three operational principles:
// 1. Conditional bracket suppression — null cells AND their separators vanish.
// 2. Contextual dimming — dim by default; full color only when threshold crossed.
// 3. Compact-when-idle — single line when no activity; 2 lines when busy.
//
// Cell rendering pipeline (per non-null HushCell):
//   1. Start with plain `text`.
//   2. Prepend spinner glyph if animate === "spinner".
//   3. Apply ANSI color based on attention + baseColor.
//   4. Wrap in OSC 8 hyperlink if link is non-empty.
//
// Separator between cells: two spaces ("  ").

import type { WidgetCell, HushCell } from "../widget.js";
import type { Layout } from "./index.js";
import type { HudConfig } from "../../types.js";
import { dim } from "../dim.js";
import { spinnerFrame } from "../spinner.js";
import { link as osc8 } from "../hyperlink.js";
import { truncateLine } from "../width.js";

const SEP = "  ";

// SGR digit codes for baseline palette (used for both standalone and dim+color combos).
const SGR_FG: Record<string, string> = {
  cyan:    "36",
  green:   "32",
  blue:    "34",
  magenta: "35",
  yellow:  "33",
  red:     "31",
};

const RESET_FG = "\x1b[39m";

function colorDisabled(env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return true;
  if (env.TERM === "dumb") return true;
  return false;
}

function applyColor(text: string, colorName: string, env: NodeJS.ProcessEnv): string {
  if (colorDisabled(env)) return text;
  const code = SGR_FG[colorName];
  if (!code) return text;
  return `\x1b[${code}m${text}${RESET_FG}`;
}

/**
 * Combine dim (SGR 2) with a baseline color in a single SGR sequence:
 *   "\x1b[2;{code}m{text}\x1b[22;39m"
 *
 * When baseColor is missing/unknown OR colors are disabled (NO_COLOR/TERM=dumb),
 * fall back to plain `dim()` (which itself returns plain text in NO_COLOR mode).
 */
function applyDimColor(text: string, colorName: string | undefined, env: NodeJS.ProcessEnv): string {
  if (colorDisabled(env)) return text;            // dim() would also return text; short-circuit
  if (!colorName) return dim(text, env);          // no baseColor → plain dim
  const code = SGR_FG[colorName];
  if (!code) return dim(text, env);               // unknown color → plain dim
  return `\x1b[2;${code}m${text}\x1b[22;39m`;
}

/** Resolve the glyph mode from config. */
function glyphMode(config: HudConfig): "unicode" | "ascii" {
  const g = config.display.glyphs;
  if (g === "unicode") return "unicode";
  if (g === "ascii") return "ascii";
  // "auto" — check LANG
  const lang = process.env.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8")) return "unicode";
  if (process.env.LC_ALL?.includes("UTF-8")) return "unicode";
  return "ascii";
}

/** Render a single HushCell to a styled string. */
function renderCell(
  cell: HushCell,
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
): string {
  let text = cell.text;

  // Step 2: prepend spinner glyph for animated cells
  if (cell.animate === "spinner") {
    const glyph = spinnerFrame(now, mode);
    text = `${glyph} ${text}`;
  }

  // Step 3: apply ANSI color by attention level
  const noColor = colorDisabled(env);
  switch (cell.attention) {
    case "muted":
      // Per plan section 4.5: muted cells with baseColor combine dim+color
      // (e.g. done tools → \x1b[2;32m; promptCache → \x1b[2;36m).
      // Muted cells without baseColor fall through to plain \x1b[2m.
      text = applyDimColor(text, cell.baseColor, env);
      break;
    case "normal":
      if (!noColor && cell.baseColor) {
        text = applyColor(text, cell.baseColor, env);
      }
      break;
    case "warning":
      if (!noColor) text = `\x1b[33m${text}${RESET_FG}`;
      break;
    case "danger":
      if (!noColor) text = `\x1b[31m${text}${RESET_FG}`;
      break;
  }

  // Step 4: wrap in OSC 8 hyperlink if present (links are metadata, not color)
  if (cell.link) {
    text = osc8(text, cell.link, true);
  }

  return text;
}

export const hushLayout: Layout = {
  name: "hush",

  pack(
    cells: (WidgetCell | HushCell)[],
    termWidth: number,
    config: HudConfig,
  ): string[] {
    // Only handle HushCell instances — skip WidgetCells (shouldn't appear in hush mode).
    const hushCells = cells.filter((c): c is HushCell => "text" in c && "attention" in c);

    const now = Date.now();
    const mode = glyphMode(config);
    const env = process.env;

    // Partition into groups
    const headerCells   = hushCells.filter((c) => c.group === "header");
    const metricsCells  = hushCells.filter((c) => c.group === "metrics");
    const activityCells = hushCells.filter((c) => c.group === "activity");

    // Build line 1: header + metrics joined with SEP
    const line1Parts = [...headerCells, ...metricsCells].map((c) =>
      renderCell(c, now, mode, env),
    );
    const line1 = line1Parts.join(SEP);

    // Build line 2: activity cells
    const line2Parts = activityCells.map((c) => renderCell(c, now, mode, env));
    const line2 = line2Parts.join(SEP);

    const lines: string[] = [];
    if (line1) lines.push(truncateLine(line1, termWidth));

    // compactWhenIdle: if no activity, omit line 2 (default true)
    // When compactWhenIdle is explicitly false, always emit line 2.
    const compactWhenIdle = config.display.hush?.compactWhenIdle !== false; // default true

    if (compactWhenIdle) {
      if (line2) lines.push(truncateLine(line2, termWidth));
    } else {
      // Always emit line 2 even if empty
      lines.push(truncateLine(line2, termWidth));
    }

    return lines;
  },
};
