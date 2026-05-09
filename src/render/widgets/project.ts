// src/render/widgets/project.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph, iconForMode } from "../glyphs.js";
import { basename } from "../path.js";
import { maxLineWidth } from "./_util.js";

export const projectWidget: Widget = {
  id: "project",
  group: "header",
  priority: 100,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderProject(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell[] {
    const cells: HushCell[] = [];

    // --- Sub-cell 0: brand icon (full intensity — no dim, no link) ---
    // The icon identifies the session backend (✱ for Anthropic, ◆ for Ollama).
    const iconText = iconForMode(ctx.mode, ctx.config.display.glyphs);
    if (iconText) {
      cells.push({
        subId: "icon",
        group: "header",
        text: iconText,
        attention: "normal",
      });
    }

    // --- Sub-cell 1: project name (no link in prose design) ---
    const projectDir = ctx.stdin.workspace?.project_dir?.trim() ?? "";
    let projectName: string;
    if (projectDir) {
      projectName = basename(projectDir) || projectDir;
    } else {
      const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd ?? "";
      const parts = dir.split("/").filter(Boolean);
      projectName = parts.slice(-ctx.config.pathLevels).join("/") || "ohud";
    }
    cells.push({
      subId: "name",
      group: "header",
      text: projectName,
      attention: "normal",
      baseColor: "cyan",
    });

    // --- Sub-cell 2: git branch (green=clean, yellow=dirty; no link in prose design) ---
    if (ctx.config.gitStatus.enabled && ctx.gitStatus) {
      const dirty = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty;
      const dirtyMark = dirty
        ? (ctx.config.display.glyphs === "ascii" ? " *" : " ●")
        : "";
      const branchText = ctx.gitStatus.branch + dirtyMark;
      const attention = dirty ? "warning" : "normal";
      cells.push({
        subId: "branch",
        group: "header",
        text: branchText,
        attention,
        baseColor: dirty ? undefined : "green",
      });
    }

    // --- Sub-cell 3: model label (no link in prose design) ---
    if (ctx.config.display.showModel) {
      const rawId = ctx.stdin.model?.id ?? "";
      const modelLabel = formatModelLabel(rawId);
      if (modelLabel) {
        cells.push({
          subId: "model",
          group: "header",
          text: modelLabel,
          attention: "normal",
          baseColor: "blue",
        });
      }
    }

    return cells;
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/project.ts)
// ---------------------------------------------------------------------------

function renderProject(ctx: RenderContext): string {
  const c = ctx.config;
  const modelLabel = modelBadge(ctx);
  const projectLabel = projectPath(ctx);
  const gitLabel = gitBlock(ctx);
  const effortLabel = effortBlock(ctx);

  const parts: string[] = [];
  if (c.display.showModel && modelLabel) parts.push(color(c.colors.model, `[${modelLabel}]`));
  if (projectLabel) parts.push(color(c.colors.project, projectLabel));
  if (gitLabel) parts.push(gitLabel);
  if (effortLabel) parts.push(effortLabel);
  return parts.join(color(c.colors.label, ` ${glyph("sep", c.display.glyphs)} `));
}

function modelBadge(ctx: RenderContext): string {
  const name = ctx.stdin.model?.display_name ?? ctx.stdin.model?.id ?? "model";
  if (ctx.mode !== "ollama") return name;
  const cloudInfo = ctx.cloudModels.find((m) => m.name === ctx.stdin.model?.id || m.model === ctx.stdin.model?.id);
  const param = cloudInfo?.details?.parameter_size;
  return param ? `${name} ${glyph("bolt", ctx.config.display.glyphs)} ${param}` : name;
}

function projectPath(ctx: RenderContext): string {
  // Prefer workspace.project_dir basename — stable repo root regardless of worktree.
  const projectDir = ctx.stdin.workspace?.project_dir?.trim() ?? "";
  if (projectDir) {
    const base = basename(projectDir);
    if (base) return base;
  }
  // Fallback: current_dir (or cwd) sliced by pathLevels.
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd ?? "";
  if (!dir) return "";
  const parts = dir.split("/").filter(Boolean);
  const n = ctx.config.pathLevels;
  return parts.slice(-n).join("/");
}

function gitBlock(ctx: RenderContext): string {
  if (!ctx.config.gitStatus.enabled || !ctx.gitStatus) return "";
  const c = ctx.config.colors;
  const wrapper = (s: string) => color(c.git, s);
  const dirtyMark = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty ? "*" : "";
  const branch = color(c.gitBranch, ctx.gitStatus.branch + dirtyMark);

  let aheadBehind = "";
  if (ctx.config.gitStatus.showAheadBehind) {
    const a = ctx.gitStatus.ahead;
    const b = ctx.gitStatus.behind;
    if (a > 0 || b > 0) {
      const aColor =
        ctx.config.gitStatus.pushCriticalThreshold > 0 && a >= ctx.config.gitStatus.pushCriticalThreshold ? c.critical
        : ctx.config.gitStatus.pushWarningThreshold > 0 && a >= ctx.config.gitStatus.pushWarningThreshold ? c.warning
        : c.gitBranch;
      aheadBehind = ` ${color(aColor, `${glyph("up", ctx.config.display.glyphs)}${a}`)} ${color(c.gitBranch, `${glyph("down", ctx.config.display.glyphs)}${b}`)}`;
    }
  }
  return `${wrapper("git:(")}${branch}${aheadBehind}${wrapper(")")}`;
}

function effortBlock(ctx: RenderContext): string {
  if (!ctx.config.display.showEffortLevel || !ctx.effortLevel) return "";
  return color(ctx.config.colors.label, `effort:${ctx.effortLevel}`);
}

/** Condense a model display_name or id to a compact label.
 *  Kept for backward compatibility — consumed by agents.ts.
 *  New code should use formatModelLabel() instead.
 *  "claude-opus-4-7-1m" → "opus-4.7"  (strips context-window suffix first)
 *  "claude-opus-4-7" → "opus-4.7"
 *  "Claude Opus 4.7" → "opus-4.7" (lowercase, strip "claude ")
 *  Anything else returned as-is. */
export function condenseModelId(nameOrId: string): string {
  let s = nameOrId.trim();
  // Strip context-window suffix FIRST: -1m, [1m], -200k, [200k], etc.
  s = s.replace(/(-?(\[)?(\d+m|\d+k)\]?)$/i, "");
  // Strip leading "claude-" or "claude " prefix
  if (s.toLowerCase().startsWith("claude-")) s = s.slice(7);
  else if (s.toLowerCase().startsWith("claude ")) s = s.slice(7);
  // Replace hyphens-between-digits with dots: "opus-4-7" → "opus-4.7"
  s = s.replace(/(\d)-(\d)/g, "$1.$2").toLowerCase();
  return s;
}

// Default context-window sizes by model family (when no explicit suffix found).
// Keys are matched against the lowercased first word segment of the name after
// stripping the "claude-" prefix.
const DEFAULT_CONTEXT: Record<string, string> = {
  // Anthropic
  opus:   "1M",
  sonnet: "200K",
  haiku:  "200K",
  // Ollama Cloud — context windows from the published model cards.
  kimi:    "1M",
  qwen3:   "256K",
  glm:     "128K",
  gpt:     "128K",
  deepseek:"128K",
  llama:   "128K",
  mistral: "128K",
};

/**
 * Format a model id into a friendly label with explicit context-window suffix.
 *
 *   "claude-opus-4-7-1m"       → "Opus 4.7 (1M)"
 *   "claude-opus-4-7"          → "Opus 4.7 (1M)"   ← default lookup
 *   "claude-sonnet-4-6"        → "Sonnet 4.6 (200K)"
 *   "claude-haiku-4-5-20251001"→ "Haiku 4.5 (200K)" ← date stamp stripped
 *   "kimi-k2-6-262k"           → "Kimi K2.6 (262K)"
 *   "gpt-oss-20b-128k"         → "Gpt-Oss 20B (128K)"
 *   "something-weird"          → "something-weird"  ← passthrough
 */
export function formatModelLabel(nameOrId: string): string {
  let s = nameOrId.trim();
  if (!s) return s;

  // Step 1: Strip leading "claude-" prefix (case-insensitive).
  if (s.toLowerCase().startsWith("claude-")) s = s.slice(7);

  // Step 1b: Strip Ollama-style tag suffix (":cloud", ":dev", ":latest", etc.)
  // Ollama model ids are typically "<family>-<version>:<tag>". The tag is a
  // deployment label, not part of the model identity for display purposes.
  s = s.replace(/:[a-zA-Z0-9_-]+$/, "");

  // Step 2: Strip trailing date-stamps like -20251001 (8 consecutive digits).
  s = s.replace(/-\d{8}$/, "");

  // Step 3: Extract explicit context-size suffix.
  // Last hyphen-segment matching digits + unit letter (k/m, case-insensitive).
  let contextLabel: string | null = null;
  const ctxMatch = /^(.*)-(\d+[kKmM])$/.exec(s);
  if (ctxMatch) {
    s = ctxMatch[1]!;
    const raw = ctxMatch[2]!;
    // Uppercase the unit letter (k→K, m→M); digit part stays as-is.
    contextLabel = raw.slice(0, -1) + raw.slice(-1).toUpperCase();
  }

  // Step 4: Build the friendly name.
  //
  // Segments are split on "-", then grouped into:
  //   - word prefix: consecutive pure-alpha segments before any digit-bearing one
  //   - version suffix: remaining segments (may mix alpha+digit and digit tokens)
  //
  // Word prefix: each segment is capitalised; they are hyphen-joined together.
  //   "gpt-oss" → "Gpt-Oss"   "kimi" → "Kimi"   "opus" → "Opus"
  //
  // Version suffix segments are emitted as space-joined "version tokens":
  //   - alpha+digit (starts letter): capitalise first letter; pure-digit segments
  //     that immediately follow are dot-appended ("k2" + "6" → "K2.6")
  //   - digit+alpha (starts digit, ends letter, e.g. "20b"): uppercase the letter
  //   - pure digit ("4", "7"): dot-append to the previous token (so "4-7" → "4.7")
  const segments = s.split("-");

  // Find the split point: first segment that contains any digit.
  let splitIdx = segments.findIndex((seg) => /\d/.test(seg));
  if (splitIdx === -1) splitIdx = segments.length; // all-alpha

  const wordSegs    = segments.slice(0, splitIdx);
  const versionSegs = segments.slice(splitIdx);

  // Word prefix: capitalise each, hyphen-join.
  const wordPrefix = wordSegs
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("-");

  // Version suffix: build dot-separated version tokens.
  const versionTokens: string[] = [];
  for (const seg of versionSegs) {
    if (/^\d+$/.test(seg)) {
      // Pure digit: dot-append to previous token, or start new token if none.
      if (versionTokens.length > 0) {
        versionTokens[versionTokens.length - 1] += "." + seg;
      } else {
        versionTokens.push(seg);
      }
    } else if (/^[a-zA-Z]/.test(seg)) {
      // Starts with letter and contains digit ("k2"): capitalise first letter.
      // Subsequent pure-digit segments will dot-append to this token.
      versionTokens.push(seg.charAt(0).toUpperCase() + seg.slice(1));
    } else {
      // Digit-leading with trailing alpha suffix ("20b"): uppercase the letter.
      const unitMatch = /^(\d+)([a-zA-Z]+)$/.exec(seg);
      versionTokens.push(unitMatch ? unitMatch[1]! + unitMatch[2]!.toUpperCase() : seg);
    }
  }
  const versionSuffix = versionTokens.join(" ");

  const friendlyName = [wordPrefix, versionSuffix].filter(Boolean).join(" ");

  // Step 5: If no explicit context suffix, look up by model family (first word segment).
  if (contextLabel === null) {
    const firstWord = (wordSegs[0] ?? segments[0] ?? "").toLowerCase();
    contextLabel = DEFAULT_CONTEXT[firstWord] ?? null;
  }

  // Step 6: Compose final label.
  if (contextLabel) return `${friendlyName} (${contextLabel})`;
  // Passthrough: no family match and no explicit suffix — return original.
  return nameOrId.trim();
}

