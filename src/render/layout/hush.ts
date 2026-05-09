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
//   1. Start with plain `text` (or primaryText + secondaryText if both present).
//   2. Prepend spinner glyph if animate === "spinner".
//   3. Apply ANSI color based on attention + baseColor.
//   4. Wrap in OSC 8 hyperlink if link is non-empty.
//
// Separator system (3-tier):
//   WITHIN_SEP  — cells of the same group (e.g. project sub-cells: name, branch, model)
//   BETWEEN_SEP — cells from different groups on the same line
//   Density "compact" (default): WITHIN=" ", BETWEEN="  "
//   Density "comfortable":       WITHIN=" · ", BETWEEN="    "
//   Density "airy":              WITHIN="  ", BETWEEN="      "

import type { WidgetCell, HushCell } from "../widget.js";
import type { Layout } from "./index.js";
import type { HudConfig } from "../../types.js";
import { isColorDisabled } from "../colors.js";
import { dim } from "../dim.js";
import { spinnerFrame } from "../spinner.js";
import { link as osc8 } from "../hyperlink.js";
import { truncateLine } from "../width.js";

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

// Hard caps for activity cells
const MAX_RUNNING = 3;
const MAX_DONE    = 4;

function applyColor(text: string, colorName: string, env: NodeJS.ProcessEnv): string {
  if (isColorDisabled(env)) return text;
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
  if (isColorDisabled(env)) return text;          // dim() would also return text; short-circuit
  if (!colorName) return dim(text, env);          // no baseColor → plain dim
  const code = SGR_FG[colorName];
  if (!code) return dim(text, env);               // unknown color → plain dim
  return `\x1b[2;${code}m${text}\x1b[22;39m`;
}

/**
 * Resolve the glyph mode from config, using the provided env for LANG/LC_ALL.
 * Accepts an optional `env` param so callers can inject a custom environment
 * for testing (avoids direct reads of `process.env` inside the function).
 */
export function glyphMode(config: HudConfig, env?: NodeJS.ProcessEnv): "unicode" | "ascii" {
  const g = config.display.glyphs;
  if (g === "unicode") return "unicode";
  if (g === "ascii") return "ascii";
  // "auto" — check LANG/LC_ALL from the provided env (or process.env as fallback)
  const e = env ?? process.env;
  const lang = e.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8")) return "unicode";
  if (e.LC_ALL?.includes("UTF-8")) return "unicode";
  return "ascii";
}

/** Separator pair resolved from density setting. */
interface Separators {
  within: string;   // between cells of the same group
  between: string;  // between cells of different groups
}

/**
 * Build the 3-tier separator set for a density.
 *
 * The middle-dot `·` (U+00B7) wrapped in dim SGR is the visual signature of
 * Hush. It carries *cohesion* — cells of the same group share the dot —
 * while group boundaries are marked by absence of dot plus extra spacing.
 * This produces a readable "dot pattern, then break, then dot pattern" rhythm:
 *
 *     ohud · develop · opus-4.7    22% of 1M    rate 52%/5h    cache 4m
 *     └─────── header ───────┘  └ metrics ┘  └ metrics ┘  └ metrics ┘
 *
 * - compact     : within=` · ` ; between=`   ` (3 spaces) — terse
 * - comfortable : within=` · ` ; between=`    ` (4 spaces) — balanced
 * - airy        : within=`  `  ; between=`      ` (6 spaces) — gridless
 *
 * In NO_COLOR/dumb-term environments the dot stays but the dim wrap is
 * suppressed (still semantic, just full-bright).
 */
function resolveSeparators(
  density: "compact" | "comfortable" | "airy" | undefined,
  env: NodeJS.ProcessEnv,
): Separators {
  const noColor = isColorDisabled(env);
  const dot = noColor ? "·" : "\x1b[2m·\x1b[22m";
  switch (density) {
    case "comfortable": return { within: ` ${dot} `, between: "    " };
    case "airy":        return { within: "  ",       between: "      " };
    default:            return { within: ` ${dot} `, between: "   " };  // compact
  }
}

/** Toggles read once per pack() call, sourced from `config.display.hush.*`. */
interface HushToggles {
  /** Emit OSC 8 hyperlinks (default true). */
  hyperlinks: boolean;
  /** Whether the spinner glyph is emitted at all (default true). */
  animate: boolean;
  /** Whether the spinner advances frames across ticks. False keeps it on frame 0 ("still" motion). */
  motion: boolean;
  /** Show cyan/green/blue identity colors (default false). */
  identityColors: boolean;
}

/**
 * Resolve the effective baseColor for a cell, respecting identityColors toggle.
 * identityColors=false suppresses baseColor ONLY on header group cells.
 * Non-header cells (metrics/activity) always keep their baseColor.
 */
function effectiveBaseColor(
  cell: HushCell,
  toggles: HushToggles,
): string | undefined {
  if (!cell.baseColor) return undefined;
  if (cell.group !== "header") return cell.baseColor;
  // Header cell: suppress when identityColors is off
  return toggles.identityColors ? cell.baseColor : undefined;
}

/** Render a single HushCell to a styled string. */
function renderCell(
  cell: HushCell,
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
  toggles: HushToggles,
): string {
  const noColor = isColorDisabled(env);

  // Resolve text: use primaryText+secondaryText if both present, else fallback to text
  let text: string;
  if (cell.primaryText !== undefined && cell.secondaryText !== undefined) {
    const primary = cell.primaryText;
    const secondary = cell.secondaryText;
    // Compose: primary gets baseColor, secondary gets dim
    let primaryStyled = primary;
    const color = effectiveBaseColor(cell, toggles);
    if (!noColor && color) {
      primaryStyled = applyColor(primary, color, env);
    }
    const secondaryStyled = dim(secondary, env);
    text = `${primaryStyled} ${secondaryStyled}`;
    // Apply spinner if needed; motion=still freezes on frame 0.
    if (cell.animate === "spinner" && toggles.animate) {
      const glyph = spinnerFrame(toggles.motion ? now : 0, mode);
      text = `${glyph} ${text}`;
    }
    // Wrap in OSC 8 if present
    if (cell.link) {
      text = osc8(text, cell.link, toggles.hyperlinks);
    }
    return text;
  }

  text = cell.text;

  // Step 2: prepend spinner glyph for animated cells (gated by hush.animate);
  // motion=still freezes on frame 0.
  if (cell.animate === "spinner" && toggles.animate) {
    const glyph = spinnerFrame(toggles.motion ? now : 0, mode);
    text = `${glyph} ${text}`;
  }

  // Step 3: apply ANSI color by attention level
  // identityColors=false: strip baseColor from header cells only
  switch (cell.attention) {
    case "muted":
      // Muted cells with baseColor combine dim+color (e.g. done tools → \x1b[2;32m).
      text = applyDimColor(text, effectiveBaseColor(cell, toggles), env);
      break;
    case "normal":
      {
        const color = effectiveBaseColor(cell, toggles);
        if (!noColor && color) text = applyColor(text, color, env);
      }
      break;
    case "warning":
      if (!noColor) text = `\x1b[33m${text}${RESET_FG}`;
      break;
    case "danger":
      if (!noColor) text = `\x1b[31m${text}${RESET_FG}`;
      break;
  }

  // Step 4: wrap in OSC 8 hyperlink if present (links are metadata, not color).
  // Gated by hush.hyperlinks for terminals that mishandle OSC 8.
  if (cell.link) {
    text = osc8(text, cell.link, toggles.hyperlinks);
  }

  return text;
}

/** Join rendered cells respecting 3-tier separator system. */
function joinCells(
  renderedPairs: Array<{ rendered: string; group: string | undefined }>,
  seps: Separators,
): string {
  if (renderedPairs.length === 0) return "";
  let result = renderedPairs[0]!.rendered;
  for (let i = 1; i < renderedPairs.length; i++) {
    const prev = renderedPairs[i - 1]!;
    const curr = renderedPairs[i]!;
    const sep = prev.group === curr.group ? seps.within : seps.between;
    result += sep + curr.rendered;
  }
  return result;
}

/**
 * Cap activity cells: max MAX_RUNNING running + MAX_DONE done.
 * Returns capped array + a "+N more" muted cell when cells were dropped.
 */
function capActivityCells(cells: HushCell[]): HushCell[] {
  const running = cells.filter((c) => c.animate === "spinner");
  const done    = cells.filter((c) => c.animate !== "spinner");

  const cappedRunning = running.slice(0, MAX_RUNNING);
  const cappedDone    = done.slice(0, MAX_DONE);

  const dropped = (running.length - cappedRunning.length) + (done.length - cappedDone.length);
  const result: HushCell[] = [...cappedRunning, ...cappedDone];

  if (dropped > 0) {
    result.push({
      text: `+${dropped} more`,
      attention: "muted",
      group: "activity",
    });
  }

  return result;
}

/**
 * Priority-aware truncation: when rendered line exceeds termWidth,
 * drop cells of lowest priority first until it fits.
 * Header cells (highest priority) are kept last.
 */
function truncateByPriority(
  cells: HushCell[],
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
  toggles: HushToggles,
  seps: Separators,
  termWidth: number,
): string {
  // Build rendered pairs preserving group info
  const renderPairs = (cs: HushCell[]) =>
    cs.map((c) => ({ rendered: renderCell(c, now, mode, env, toggles), group: c.group }));

  // Quick check if full set fits
  let result = joinCells(renderPairs(cells), seps);
  if (stripAnsiWidth(result) <= termWidth) return result;

  // Sort by priority ascending (lowest first = drop first), stable within same priority
  // Header cells always have highest priority and are never dropped
  const sorted = [...cells].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    return pa - pb; // ascending: lowest priority first for dropping
  });

  // Greedily drop lowest-priority cells until it fits
  const kept = [...sorted];
  while (kept.length > 1) {
    // Remove lowest-priority (front of sorted array)
    kept.shift();
    // Rebuild in original order (preserve original relative ordering)
    const original = cells.filter((c) => kept.includes(c));
    result = joinCells(renderPairs(original), seps);
    if (stripAnsiWidth(result) <= termWidth) return result;
  }

  // Fallback: truncate hard
  return truncateLine(joinCells(renderPairs(cells.slice(0, 1)), seps), termWidth);
}

/**
 * Pack the activity line, dropping whole cells (newest first, so done before
 * running since done sit at the tail of capActivityCells output) when overflowed.
 * Regenerates the trailing "+N more" indicator with the cumulative drop count.
 *
 * Replaces a previous `truncateLine` call that cut mid-string (producing
 * artifacts like `Bas…` truncating "Bash"). Cell-level granularity keeps the
 * activity readable.
 */
function packActivityLine(
  cells: HushCell[],
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
  toggles: HushToggles,
  seps: Separators,
  termWidth: number,
): string {
  const renderPairs = (cs: HushCell[]) =>
    cs.map((c) => ({ rendered: renderCell(c, now, mode, env, toggles), group: c.group }));

  // Detect a trailing "+N more" cell from capActivityCells and lift its count
  // so we can re-emit a unified indicator after additional drops.
  const last = cells[cells.length - 1];
  const moreMatch = last ? /^\+(\d+) more$/.exec(last.text) : null;
  const initialMore = moreMatch ? Number.parseInt(moreMatch[1]!, 10) : 0;
  const main: HushCell[] = moreMatch ? cells.slice(0, -1) : [...cells];

  let droppedExtra = 0;
  const build = (): string => {
    const total = initialMore + droppedExtra;
    const tail: HushCell[] = total > 0
      ? [{ text: `+${total} more`, attention: "muted", group: "activity" }]
      : [];
    return joinCells(renderPairs([...main, ...tail]), seps);
  };

  let result = build();
  while (stripAnsiWidth(result) > termWidth && main.length > 0) {
    main.pop();   // drop newest cell (done first, then newest running)
    droppedExtra += 1;
    result = build();
  }
  // Last resort: hard truncate when even an empty list overflows (very narrow term)
  if (stripAnsiWidth(result) > termWidth) {
    result = truncateLine(result, termWidth);
  }
  return result;
}

/** Approximate visual width by stripping ANSI SGR codes and OSC 8 sequences. */
function stripAnsiWidth(s: string): number {
  return s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\]8;;[^\x07]*\x07[^\x1b]*\x1b\]8;;\x07/g, (m) => {
      // OSC 8 link: keep only the visible text (between the two BEL terminators)
      const inner = m.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\]8;;\x07/g, "");
      return inner;
    })
    .length;
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
    const env = process.env;
    const mode = glyphMode(config, env);
    const density = config.display.hush?.density ?? "compact";
    const seps = resolveSeparators(density, env);

    // Read user toggles from config; defaults preserve prior behaviour.
    // `motion === "still"` freezes the spinner on frame 0; "subtle" (or unset)
    // lets it cycle once per second.
    const toggles: HushToggles = {
      hyperlinks:     config.display.hush?.hyperlinks     !== false,
      animate:        config.display.hush?.animate        !== false,
      motion:         config.display.hush?.motion         !== "still",
      identityColors: config.display.hush?.identityColors === true,
    };

    // Partition into groups
    const headerCells   = hushCells.filter((c) => c.group === "header");
    const metricsCells  = hushCells.filter((c) => c.group === "metrics");
    const activityCells = hushCells.filter((c) => c.group === "activity");

    // Cap activity cells before layout
    const cappedActivity = capActivityCells(activityCells);

    // Build line 1: header + metrics joined with group-aware separators
    const line1Cells = [...headerCells, ...metricsCells];
    const line1 = truncateByPriority(line1Cells, now, mode, env, toggles, seps, termWidth);

    // Build line 2: activity cells, with cell-level (not string) truncation
    // so we never split a tool name mid-word under width pressure.
    const line2 = packActivityLine(cappedActivity, now, mode, env, toggles, seps, termWidth);

    const lines: string[] = [];
    if (line1) lines.push(line1);

    // compactWhenIdle: if no activity, omit line 2 (default true)
    const compactWhenIdle = config.display.hush?.compactWhenIdle !== false; // default true

    if (compactWhenIdle) {
      if (line2) lines.push(line2);
    } else {
      // Always emit line 2 even if empty
      lines.push(line2);
    }

    return lines;
  },
};
