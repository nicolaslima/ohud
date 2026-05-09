// src/render/layout/hush.ts
//
// HushLayout — Descriptive prose statusline.
//
// Produces a sentence-style output reading like natural language:
//   ✱ ohud on develop using Opus 4.7 (1M) with context 24% used • cache 87% hit • 102 tks/s • session time 1:23:45 • rate 45%/5h
//
// Layout rules:
// 1. Default text style: dim (\x1b[2m…\x1b[22m). Applied to ALL prose text.
// 2. The icon is the only character at full intensity (no dim wrapping).
// 3. Separator between extras clauses: " • " with density-based padding.
//    compact=1 space each side, comfortable=2, airy=3.
// 4. Connector words (on, using, with, used) stay dimmed and lowercase.
// 5. Threshold colors override the context-pct clause and metrics with warning/danger.
// 6. Activity line indents 2 spaces.
//
// Three output lines possible:
//   Line 1 (always):   sentence [+ extras inline when they fit]
//   Line 2 (overflow): "  " + extras tail (when sentence+extras exceed termWidth)
//   Line 3 (activity): "  " + ▸ tool • ▹ tool … ⌗N  (when tools/agents are active)
//
// OSC 8 hyperlinks: ONLY on the ⌗N tools counter (activity line). No links on
// project name, branch, or model.
//
// Cell identification:
//   id="icon"    → brand icon (full intensity, no dim)
//   id="project" → [name, branch?, model?] emitted by projectWidget.renderHush
//   id="context" → context % cell; becomes the "with context N% used" clause
//   group="metrics" (other) → extras list
//   group="activity" → activity line cells

import type { WidgetCell, HushCell } from "../widget.js";
import type { Layout } from "./index.js";
import type { HudConfig } from "../../types.js";
import { isColorDisabled } from "../colors.js";
import { dim } from "../dim.js";
import { spinnerFrame } from "../spinner.js";
import { link as osc8 } from "../hyperlink.js";
import { visibleWidth, truncateLine } from "../width.js";

// SGR digit codes for baseline palette.
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
 * Combine dim (SGR 2) with a baseline color in a single SGR sequence.
 * When baseColor is missing/unknown OR colors are disabled, fall back to plain dim().
 */
function applyDimColor(text: string, colorName: string | undefined, env: NodeJS.ProcessEnv): string {
  if (isColorDisabled(env)) return text;
  if (!colorName) return dim(text, env);
  const code = SGR_FG[colorName];
  if (!code) return dim(text, env);
  return `\x1b[2;${code}m${text}\x1b[22;39m`;
}

/**
 * Resolve the glyph mode from config, using the provided env for LANG/LC_ALL.
 * Exported for testability.
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

/** Toggles read once per pack() call. */
interface HushToggles {
  hyperlinks:     boolean;
  animate:        boolean;
  motion:         boolean;
  identityColors: boolean;
}

/** Render a single activity HushCell to a styled string. */
function renderActivityCell(
  cell: HushCell,
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
  toggles: HushToggles,
): string {
  const noColor = isColorDisabled(env);

  // primaryText + secondaryText path
  if (cell.primaryText !== undefined && cell.secondaryText !== undefined) {
    let primaryStyled = cell.primaryText;
    if (!noColor && cell.baseColor) {
      primaryStyled = applyColor(cell.primaryText, cell.baseColor, env);
    }
    const secondaryStyled = dim(cell.secondaryText, env);
    let text = `${primaryStyled} ${secondaryStyled}`;
    if (cell.animate === "spinner" && toggles.animate) {
      const g = spinnerFrame(toggles.motion ? now : 0, mode);
      text = `${g} ${text}`;
    }
    if (cell.link) {
      text = osc8(text, cell.link, toggles.hyperlinks);
    }
    return text;
  }

  let text = cell.text;

  if (cell.animate === "spinner" && toggles.animate) {
    const g = spinnerFrame(toggles.motion ? now : 0, mode);
    text = `${g} ${text}`;
  }

  switch (cell.attention) {
    case "muted":
      text = applyDimColor(text, cell.baseColor, env);
      break;
    case "normal":
      if (!noColor && cell.baseColor) text = applyColor(text, cell.baseColor, env);
      break;
    case "warning":
      if (!noColor) text = `\x1b[33m${text}${RESET_FG}`;
      break;
    case "danger":
      if (!noColor) text = `\x1b[31m${text}${RESET_FG}`;
      break;
  }

  if (cell.link) {
    text = osc8(text, cell.link, toggles.hyperlinks);
  }

  return text;
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
 * Pack the activity line, dropping whole cells (newest first) when overflowed.
 * Regenerates the trailing "+N more" indicator with the cumulative drop count.
 * The counterText (hyperlinked ⌗N) is always appended at the end.
 */
function packActivityLine(
  cells: HushCell[],
  counterText: string,
  now: number,
  mode: "unicode" | "ascii",
  env: NodeJS.ProcessEnv,
  toggles: HushToggles,
  termWidth: number,
  indent: string,
  bulletSep: string,
): string {
  // Detect a trailing "+N more" cell and lift its count
  const last = cells[cells.length - 1];
  const moreMatch = last ? /^\+(\d+) more$/.exec(last.text) : null;
  const initialMore = moreMatch ? Number.parseInt(moreMatch[1]!, 10) : 0;
  const main: HushCell[] = moreMatch ? cells.slice(0, -1) : [...cells];

  const buildActivityStr = (cs: HushCell[], droppedExtra: number): string => {
    const rendered = cs.map((c) => renderActivityCell(c, now, mode, env, toggles));
    const total = initialMore + droppedExtra;
    if (total > 0) rendered.push(dim(`+${total} more`, env));

    let line = rendered.join(bulletSep);
    // Counter appended at end with double space (hierarchy cue)
    if (counterText) {
      line = line ? `${line}  ${counterText}` : counterText;
    }
    return indent + line;
  };

  let droppedExtra = 0;
  let result = buildActivityStr(main, droppedExtra);

  while (visibleWidth(result) > termWidth && main.length > 0) {
    main.pop();
    droppedExtra += 1;
    result = buildActivityStr(main, droppedExtra);
  }

  // Last resort: hard truncate
  if (visibleWidth(result) > termWidth) {
    result = truncateLine(result, termWidth);
  }
  return result;
}

/**
 * Render a single metrics cell to a dim styled string with optional threshold color.
 */
function renderMetricsCell(cell: HushCell, env: NodeJS.ProcessEnv): string {
  const noColor = isColorDisabled(env);
  const text = cell.text;
  switch (cell.attention) {
    case "warning":
      // Wrap dim text in yellow — threshold color goes outside dim
      if (!noColor) return `\x1b[33m${dim(text, env)}\x1b[39m`;
      return text;
    case "danger":
      if (!noColor) return `\x1b[31m${dim(text, env)}\x1b[39m`;
      return text;
    default:
      return dim(text, env);
  }
}

/** Resolve bullet padding (spaces on each side) from density setting. */
function bulletPadding(density: "compact" | "comfortable" | "airy" | undefined): number {
  switch (density) {
    case "comfortable": return 2;
    case "airy":        return 3;
    default:            return 1;  // compact (default)
  }
}

/** Build the " • extras" string with density-based padding. */
function buildExtras(
  metricsCells: HushCell[],
  env: NodeJS.ProcessEnv,
  padding: number,
): string {
  if (metricsCells.length === 0) return "";
  const noColor = isColorDisabled(env);
  const pad = " ".repeat(padding);
  const bullet = noColor ? "•" : "\x1b[2m•\x1b[22m";
  const sep = `${pad}${bullet}${pad}`;

  const rendered = metricsCells.map((cell) => renderMetricsCell(cell, env));
  return sep + rendered.join(sep);
}

export const hushLayout: Layout = {
  name: "hush",

  pack(
    cells: (WidgetCell | HushCell)[],
    termWidth: number,
    config: HudConfig,
  ): string[] {
    // Only handle HushCell instances — skip WidgetCells.
    const hushCells = cells.filter((c): c is HushCell => "text" in c && "attention" in c);

    const now = Date.now();
    const env = process.env;
    const mode = glyphMode(config, env);
    const noColor = isColorDisabled(env);
    const density = config.display.hush?.density ?? "compact";
    const padding = bulletPadding(density);
    const pad = " ".repeat(padding);
    const bullet = noColor ? "•" : "\x1b[2m•\x1b[22m";
    const bulletSep = `${pad}${bullet}${pad}`;

    const toggles: HushToggles = {
      hyperlinks:     config.display.hush?.hyperlinks     !== false,
      animate:        config.display.hush?.animate        !== false,
      motion:         config.display.hush?.motion         !== "still",
      identityColors: config.display.hush?.identityColors === true,
    };

    // Partition into groups by cell.group
    const headerCells   = hushCells.filter((c) => c.group === "header");
    const metricsCells  = hushCells.filter((c) => c.group === "metrics");
    const activityCells = hushCells.filter((c) => c.group === "activity");

    // -------------------------------------------------------------------------
    // Identify structured header parts via subId
    // -------------------------------------------------------------------------
    // subId="icon"   → brand icon (full intensity — no dim)
    // subId="name"   → project name
    // subId="branch" → git branch
    // subId="model"  → model label
    //
    // subId survives the { ...cell, id: w.id } spread in render/index.ts because
    // render/index.ts only overrides `id` (the widget id), not `subId`.
    //
    // When NO cells carry a subId (raw test cells / legacy path), fall back to
    // the old join-with-separator approach so legacy tests remain valid.
    const hasStructuredHeader =
      headerCells.some((c) => c.subId === "icon" || c.subId === "name" || c.subId === "branch" || c.subId === "model") ||
      metricsCells.some((c) => c.id === "context");

    if (!hasStructuredHeader) {
      // -----------------------------------------------------------------------
      // LEGACY / UNSTRUCTURED path — used by raw-cell tests that don't set subId.
      // Joins all cells with the old 3-tier separator system.
      // This preserves Section 15/18/19 test behavior for raw-cell inputs.
      // -----------------------------------------------------------------------
      return legacyPack(hushCells, termWidth, config, now, env, mode, toggles, bulletSep, noColor, padding, bullet);
    }

    // -----------------------------------------------------------------------
    // PROSE path — structured cells from project/context/etc widgets
    // -----------------------------------------------------------------------

    const iconCell    = headerCells.find((c) => c.subId === "icon");
    const branchCell2 = headerCells.find((c) => c.subId === "branch");
    const modelCell2  = headerCells.find((c) => c.subId === "model");
    const contextCell = metricsCells.find((c) => c.id === "context");
    // Extras: all metrics cells EXCEPT the context cell
    const extrasCells = metricsCells.filter((c) => c.id !== "context");

    const iconText    = iconCell?.text ?? "";
    const branchName  = branchCell2?.text ?? "";
    const modelLabel  = modelCell2?.text ?? "";
    const contextText = contextCell?.text ?? "";

    // -----------------------------------------------------------------------
    // Build the prose sentence
    // -----------------------------------------------------------------------

    const dimStr = (s: string) => dim(s, env);

    const segments: string[] = [];

    // "ohud"
    segments.push(dimStr("ohud"));

    // " on {branch}"
    if (branchName) {
      segments.push(dimStr(" on "));
      segments.push(toggles.identityColors
        ? applyColor(branchName, "green", env)
        : dimStr(branchName));
    }

    // " using {model}"
    if (modelLabel) {
      segments.push(dimStr(" using "));
      segments.push(toggles.identityColors
        ? applyColor(modelLabel, "blue", env)
        : dimStr(modelLabel));
    }

    // " with context {pct}% used"
    if (contextText) {
      segments.push(dimStr(" with context "));
      const attention = contextCell?.attention ?? "muted";
      if (attention === "warning" && !noColor) {
        segments.push(`\x1b[33m${dimStr(contextText)}\x1b[39m`);
      } else if (attention === "danger" && !noColor) {
        segments.push(`\x1b[31m${dimStr(contextText)}\x1b[39m`);
      } else {
        segments.push(dimStr(contextText));
      }
      segments.push(dimStr(" used"));
    }

    const sentenceBody = segments.join("");
    // Icon at full intensity (no dim), followed by a space
    const sentenceStr = iconText ? `${iconText} ${sentenceBody}` : sentenceBody;

    // -----------------------------------------------------------------------
    // Build extras
    // -----------------------------------------------------------------------
    const extrasStr = buildExtras(extrasCells, env, padding);

    // -----------------------------------------------------------------------
    // Activity cells
    // -----------------------------------------------------------------------
    const cappedActivity = capActivityCells(activityCells);

    // Count total tools represented by the activity cells
    const totalToolCount = (() => {
      let n = 0;
      for (const c of cappedActivity) {
        const moreM = /^\+(\d+) more$/.exec(c.text);
        if (moreM) {
          n += Number.parseInt(moreM[1]!, 10);
        } else {
          const countM = /×(\d+)/.exec(c.text);
          n += countM ? Number.parseInt(countM[1]!, 10) : 1;
        }
      }
      return n;
    })();

    // Build OSC 8 counter: ⌗N linked to session file
    // fire-and-forget writeSessionFile; path is predictable from session_id.
    // Since pack() doesn't receive ctx directly, we check if any cell
    // carries a session file link hint via subId="session-link".
    const sessionFileCell = hushCells.find((c) => c.subId === "session-link");
    const sessionFileUrl  = sessionFileCell?.link;

    let counterText = "";
    if (cappedActivity.length > 0 && totalToolCount > 0) {
      const counterLabel = `⌗${totalToolCount}`;
      const raw = dimStr(counterLabel);
      counterText = sessionFileUrl && toggles.hyperlinks
        ? osc8(raw, sessionFileUrl, true)
        : raw;
    }

    const hasActivity = cappedActivity.length > 0;
    const indent = "  ";
    const lines: string[] = [];

    // -----------------------------------------------------------------------
    // Width-aware layout: sentence + extras on 1 or 2 lines
    // -----------------------------------------------------------------------
    const fullLine = sentenceStr + extrasStr;

    if (!extrasStr || visibleWidth(fullLine) <= termWidth) {
      // Everything fits (or no extras) — single line
      lines.push(fullLine);
    } else {
      // Extras overflow — wrap to line 2 with indent
      lines.push(sentenceStr);
      // extrasStr starts with the separator (pad+bullet+pad), trim the leading pad
      // and replace with indent so it reads: "  • cache ..."
      const extrasBody = extrasStr.trimStart();
      lines.push(indent + extrasBody);
    }

    // -----------------------------------------------------------------------
    // Activity line
    // -----------------------------------------------------------------------
    if (hasActivity) {
      const actLine = packActivityLine(
        cappedActivity,
        counterText,
        now,
        mode,
        env,
        toggles,
        termWidth,
        indent,
        bulletSep,
      );
      lines.push(actLine);
    } else {
      // compactWhenIdle: emit empty line 2 when false
      const compactWhenIdle = config.display.hush?.compactWhenIdle !== false;
      if (!compactWhenIdle && lines.length === 1) {
        lines.push("");
      }
    }

    return lines;
  },
};

// ---------------------------------------------------------------------------
// Legacy / unstructured pack — for raw-cell tests and backward compat
// ---------------------------------------------------------------------------
// This path is taken when input cells carry NO structural ids (id="project",
// id="context", etc.). It reproduces the old 3-tier separator behavior so that
// tests passing bare HushCell arrays without ids continue to work.
//
// Specifically used by:
//   - Section 15 density separator tests (makeTwoCells)
//   - Section 18 priority truncation tests
//   - Section 19 primaryText+secondaryText tests
//   - Any direct cell injection tests

function legacyPack(
  hushCells: HushCell[],
  termWidth: number,
  config: HudConfig,
  now: number,
  env: NodeJS.ProcessEnv,
  mode: "unicode" | "ascii",
  toggles: HushToggles,
  bulletSep: string,
  noColor: boolean,
  padding: number,
  bullet: string,
): string[] {
  const headerCells   = hushCells.filter((c) => c.group === "header");
  const metricsCells  = hushCells.filter((c) => c.group === "metrics");
  const activityCells = hushCells.filter((c) => c.group === "activity");

  // Old separator system
  const pad = " ".repeat(padding);
  const withinSep = `${pad}${bullet}${pad}`;
  const betweenSpaces = padding === 1 ? 3 : padding === 2 ? 4 : 6;
  const betweenSep = " ".repeat(betweenSpaces);

  // Render each cell
  function renderCell(cell: HushCell): string {
    const noC = isColorDisabled(env);

    // primaryText + secondaryText
    if (cell.primaryText !== undefined && cell.secondaryText !== undefined) {
      let primaryStyled = cell.primaryText;
      if (!noC && cell.baseColor && cell.attention === "normal") {
        primaryStyled = applyColor(cell.primaryText, cell.baseColor, env);
      }
      const secondaryStyled = dim(cell.secondaryText, env);
      let text = `${primaryStyled} ${secondaryStyled}`;
      if (cell.animate === "spinner" && toggles.animate) {
        const g = spinnerFrame(toggles.motion ? now : 0, mode);
        text = `${g} ${text}`;
      }
      if (cell.link) text = osc8(text, cell.link, toggles.hyperlinks);
      return text;
    }

    let text = cell.text;
    if (cell.animate === "spinner" && toggles.animate) {
      const g = spinnerFrame(toggles.motion ? now : 0, mode);
      text = `${g} ${text}`;
    }

    // identityColors: suppress header cell baseColor when off
    const effectiveBaseColor = (() => {
      if (!cell.baseColor) return undefined;
      if (cell.group !== "header") return cell.baseColor;
      return toggles.identityColors ? cell.baseColor : undefined;
    })();

    switch (cell.attention) {
      case "muted":
        text = applyDimColor(text, effectiveBaseColor, env);
        break;
      case "normal":
        if (!noC && effectiveBaseColor) text = applyColor(text, effectiveBaseColor, env);
        break;
      case "warning":
        if (!noC) text = `\x1b[33m${text}${RESET_FG}`;
        break;
      case "danger":
        if (!noC) text = `\x1b[31m${text}${RESET_FG}`;
        break;
    }

    if (cell.link) text = osc8(text, cell.link, toggles.hyperlinks);
    return text;
  }

  // Join rendered cells with group-aware separators
  function joinCellsLegacy(cs: HushCell[]): string {
    if (cs.length === 0) return "";
    let result = renderCell(cs[0]!);
    for (let i = 1; i < cs.length; i++) {
      const prev = cs[i - 1]!;
      const curr = cs[i]!;
      const sep = prev.group === curr.group ? withinSep : betweenSep;
      result += sep + renderCell(curr);
    }
    return result;
  }

  // Priority-aware truncation for line 1
  function truncateByPriority(cs: HushCell[]): string {
    const joined = joinCellsLegacy(cs);
    if (visibleWidth(joined) <= termWidth) return joined;

    const sorted = [...cs].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const kept = [...sorted];
    while (kept.length > 1) {
      kept.shift();
      const original = cs.filter((c) => kept.includes(c));
      const r = joinCellsLegacy(original);
      if (visibleWidth(r) <= termWidth) return r;
    }
    return truncateLine(joinCellsLegacy(cs.slice(0, 1)), termWidth);
  }

  // Cap and pack activity line
  const cappedActivity = capActivityCells(activityCells);

  function packLegacyActivity(): string {
    if (cappedActivity.length === 0) return "";

    const last = cappedActivity[cappedActivity.length - 1];
    const moreMatch = last ? /^\+(\d+) more$/.exec(last.text) : null;
    const initialMore = moreMatch ? Number.parseInt(moreMatch[1]!, 10) : 0;
    const main: HushCell[] = moreMatch ? cappedActivity.slice(0, -1) : [...cappedActivity];

    const build = (cs: HushCell[], dropped: number): string => {
      const rendered = cs.map((c) => renderCell(c));
      const total = initialMore + dropped;
      if (total > 0) rendered.push(dim(`+${total} more`, env));
      return rendered.join(withinSep);
    };

    let droppedExtra = 0;
    let result = build(main, droppedExtra);
    while (visibleWidth(result) > termWidth && main.length > 0) {
      main.pop();
      droppedExtra += 1;
      result = build(main, droppedExtra);
    }
    if (visibleWidth(result) > termWidth) result = truncateLine(result, termWidth);
    return result;
  }

  const line1Cells = [...headerCells, ...metricsCells];
  const line1 = truncateByPriority(line1Cells);
  const line2 = packLegacyActivity();

  const lines: string[] = [];
  if (line1) lines.push(line1);

  const compactWhenIdle = config.display.hush?.compactWhenIdle !== false;
  if (compactWhenIdle) {
    if (line2) lines.push(line2);
  } else {
    lines.push(line2);
  }

  return lines;
}
