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
// project name, branch, or model. The counter URL is computed deterministically
// from `stdin.session_id` provided via the LayoutContext, and points to
// `~/.cache/ohud/sessions/{session_id}.txt`. A fire-and-forget call to
// `writeSessionFile` ensures the file exists for the user to click into.
//
// Cell identification (via subId — survives spread-and-override pipelines):
//   subId="icon"   → brand icon (full intensity, no dim)
//   subId="name"   → project name → embedded in sentence as "{name} on …"
//   subId="branch" → git branch → "on {branch}"
//   subId="model"  → model label → "using {model}"
//   id="context"   → context % cell → "with context {N}% used"
//   group="metrics" (other) → extras list (cache, tokens, session time, errors, rate)
//   group="activity" → activity line cells

import * as os from "node:os";
import * as path from "node:path";
import type { WidgetCell, HushCell } from "../widget.js";
import type { Layout, LayoutContext } from "./index.js";
import type { HudConfig, ParsedTranscript } from "../../types.js";
import { isColorDisabled } from "../colors.js";
import { dim } from "../dim.js";
import { spinnerFrame } from "../spinner.js";
import { link as osc8 } from "../hyperlink.js";
import { visibleWidth, truncateLine } from "../width.js";
import { writeSessionFile } from "../../session-state.js";

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

  // primaryText + secondaryText path (e.g. "Edit" + "×2")
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
  // Detect a trailing "+N more" cell and lift its count so we can re-emit
  // a unified indicator after additional drops.
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

  // Last resort: hard truncate when even an empty list overflows
  if (visibleWidth(result) > termWidth) {
    result = truncateLine(result, termWidth);
  }
  return result;
}

/**
 * Render a single metrics cell to a dim styled string with optional threshold color.
 * Threshold color (yellow/red) wraps the dim text — color outside dim.
 * Muted/normal cells with a baseColor use the combined dim+color SGR
 * (e.g. cyan promptCache cell renders as \x1b[2;36m...\x1b[22;39m).
 */
function renderMetricsCell(cell: HushCell, env: NodeJS.ProcessEnv): string {
  const noColor = isColorDisabled(env);
  const text = cell.text;
  switch (cell.attention) {
    case "warning":
      if (!noColor) return `\x1b[33m${dim(text, env)}\x1b[39m`;
      return text;
    case "danger":
      if (!noColor) return `\x1b[31m${dim(text, env)}\x1b[39m`;
      return text;
    case "normal":
      // Normal-attention metrics cells with baseColor use full color (no dim).
      if (!noColor && cell.baseColor) return applyColor(text, cell.baseColor, env);
      return text;
    default:
      // muted (default) — combine dim with baseColor when present.
      return applyDimColor(text, cell.baseColor, env);
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

/**
 * Compute the deterministic OSC 8 URL for the session summary file.
 *   file://~/.cache/ohud/sessions/{sessionId}.txt
 * Returns null when sessionId is missing or empty.
 */
function sessionFileUrl(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  const filePath = path.join(os.homedir(), ".cache/ohud/sessions", `${sessionId}.txt`);
  return `file://${filePath}`;
}

/** Best-effort fire-and-forget for the session-file write. Errors are swallowed. */
function fireSessionFileWrite(layoutCtx: LayoutContext | undefined): void {
  const sessionId = layoutCtx?.stdin?.session_id;
  const transcript = layoutCtx?.transcript;
  if (!sessionId || !transcript) return;
  // writeSessionFile types ParsedTranscript but only reads TranscriptData fields
  // (sessionStart, tools, hasError) — safe to cast.
  // Defensive: writeSessionFile is async; do not await — no need to block render.
  // Errors (permission denied, disk full, etc.) are intentionally swallowed —
  // the hyperlink target may not resolve, but the statusline output stays clean.
  void writeSessionFile(sessionId, transcript as ParsedTranscript).catch(() => {
    /* swallow — link-target write failures must not surface in the statusline */
  });
}

export const hushLayout: Layout = {
  name: "hush",

  pack(
    cells: (WidgetCell | HushCell)[],
    termWidth: number,
    config: HudConfig,
    layoutCtx?: LayoutContext,
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
    const bulletGlyph = noColor ? "•" : "\x1b[2m•\x1b[22m";
    const bulletSep = `${pad}${bulletGlyph}${pad}`;

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
    // subId="name"   → project name (e.g. "ohud", "myapp", "claude-code")
    // subId="branch" → git branch
    // subId="model"  → model label
    //
    // subId survives the { ...cell, id: w.id } spread in render/index.ts
    // because render/index.ts only overrides `id` (the widget id), not `subId`.

    const iconCell    = headerCells.find((c) => c.subId === "icon");
    const nameCell    = headerCells.find((c) => c.subId === "name");
    const branchCell  = headerCells.find((c) => c.subId === "branch");
    const modelCell   = headerCells.find((c) => c.subId === "model");

    const iconText = iconCell?.text ?? "";

    // -----------------------------------------------------------------------
    // Build the header line as bullet-separated cells.
    // -----------------------------------------------------------------------
    // Order is intentional and tuned for left-to-right scanning:
    //   model → project → git → context → session-time → rate → tokens/s → errors
    // Cell text is dimmed by default; threshold attention (warning/danger)
    // overrides with subtle yellow/red wrapping. identityColors=true (off by
    // default) lets baseColor tint specific cells like model/branch — kept
    // intentionally subtle, never saturated.

    const dimStr = (s: string) => dim(s, env);

    function renderCell(c: HushCell): string {
      const txt = c.text;
      if (!noColor && c.attention === "warning") return `\x1b[33m${dimStr(txt)}\x1b[39m`;
      if (!noColor && c.attention === "danger")  return `\x1b[31m${dimStr(txt)}\x1b[39m`;
      if (toggles.identityColors && c.baseColor) return applyColor(txt, c.baseColor, env);
      return dimStr(txt);
    }

    // Header cells in display order, only including those actually present.
    const headerOrdered: HushCell[] = [];
    if (modelCell)  headerOrdered.push(modelCell);
    if (nameCell)   headerOrdered.push(nameCell);
    if (branchCell) headerOrdered.push(branchCell);

    // Metrics cells in display order — pull by id from the registry.
    const metricsOrder = ["context", "sessionTime", "usage", "tokensPerSec", "errors"];
    const metricsOrdered: HushCell[] = [];
    for (const id of metricsOrder) {
      const c = metricsCells.find((m) => m.id === id);
      if (c) metricsOrdered.push(c);
    }
    // Append any other metrics cells not in the explicit order (forward-compat).
    for (const c of metricsCells) {
      if (!metricsOrder.includes(c.id ?? "")) metricsOrdered.push(c);
    }

    const allCells = [...headerOrdered, ...metricsOrdered];
    const cellSegments = allCells.map(renderCell).filter(Boolean);
    const headerBody = cellSegments.join(bulletSep);
    const sentenceStr = iconText
      ? (headerBody ? `${iconText} ${headerBody}` : iconText)
      : headerBody;

    // No separate extras path in the card layout — everything flows on one
    // line with bullet separators, wrapping handled below.
    const extrasStr = "";

    // -----------------------------------------------------------------------
    // Activity cells & OSC 8 counter (production-wired)
    // -----------------------------------------------------------------------
    const cappedActivity = capActivityCells(activityCells);

    // Count total tools represented by the activity cells.
    //
    // The multiplicity suffix "×N" may live in EITHER:
    //   - cell.secondaryText  — the future-proofed/structured shape, used by
    //     widgets that split name and count for separate styling (primary/
    //     secondary) — preferred location for new widgets.
    //   - cell.text           — the current toolsWidget shape, where the count
    //     is baked into the rendered text (e.g. "Edit ×2" or "✓ Edit ×3").
    //
    // We check secondaryText first, fall back to text — this absorbs both
    // shapes without coupling the layout to a specific widget's emission style.
    // A "+N more" cell adds N (representing N hidden cells, each undercounted
    // here as 1 — acceptable since hidden cells were truncated anyway).
    const totalToolCount = (() => {
      let n = 0;
      for (const c of cappedActivity) {
        const moreM = /^\+(\d+) more$/.exec(c.text);
        if (moreM) {
          n += Number.parseInt(moreM[1]!, 10);
        } else {
          const countM = /×(\d+)/.exec(c.secondaryText ?? c.text ?? "");
          n += countM ? Number.parseInt(countM[1]!, 10) : 1;
        }
      }
      return n;
    })();

    // OSC 8 counter wiring:
    //   1. Compute file:// URL deterministically from stdin.session_id.
    //   2. Fire-and-forget writeSessionFile so the file actually exists when
    //      the user clicks (writes are debounced inside session-state.ts).
    //   3. Wrap the ⌗N counter in OSC 8 via the existing hyperlink helper.
    //      No URL → plain text fallback (link() returns text untouched).
    const fileUrl = sessionFileUrl(layoutCtx?.stdin?.session_id);
    let counterText = "";
    if (cappedActivity.length > 0 && totalToolCount > 0) {
      // Trigger session-file write only when we'll actually emit a counter.
      if (fileUrl && layoutCtx?.transcript) {
        fireSessionFileWrite(layoutCtx);
      }
      const counterLabel = `⌗${totalToolCount}`;
      const dimmed = dimStr(counterLabel);
      counterText = osc8(dimmed, fileUrl ?? undefined, toggles.hyperlinks);
    }

    const hasActivity = cappedActivity.length > 0;
    const indent = "  ";
    const lines: string[] = [];

    // -----------------------------------------------------------------------
    // Width-aware layout: sentence + extras on 1 or 2 lines
    // -----------------------------------------------------------------------
    // The sentence is suppressed entirely when no project/branch/model/context
    // cells were provided AND no extras exist — this is the activity-only
    // input shape. In production the projectWidget always emits cells, so the
    // sentence is always present; this guard exists for tests and safety.
    const hasHeaderContent = iconText !== "" || allCells.length > 0;

    if (hasHeaderContent) {
      // Card layout: a single line of bullet-joined cells. We do not split
      // overflow across two lines because that would invert the visual
      // priority — the user wants every cell on the same scan line. If the
      // line exceeds termWidth we let the terminal wrap (or trust priority
      // truncation already handled cell drops upstream).
      lines.push(sentenceStr);
    }

    // -----------------------------------------------------------------------
    // Activity line — indents 2 spaces when it follows a sentence; renders
    // flush-left when it's the only line (no sentence content above it).
    // -----------------------------------------------------------------------
    if (hasActivity) {
      const actIndent = lines.length > 0 ? indent : "";
      const actLine = packActivityLine(
        cappedActivity,
        counterText,
        now,
        mode,
        env,
        toggles,
        termWidth,
        actIndent,
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
