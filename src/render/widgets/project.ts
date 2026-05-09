// src/render/widgets/project.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
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

    // --- Sub-cell 1: project name (cyan, OSC 8 → file://project_dir) ---
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
      group: "header",
      text: projectName,
      attention: "normal",
      baseColor: "cyan",
      link: projectDir ? `file://${projectDir}` : undefined,
    });

    // --- Sub-cell 2: git branch (green=clean, yellow=dirty, OSC 8 → remote URL if detectable) ---
    if (ctx.config.gitStatus.enabled && ctx.gitStatus) {
      const dirty = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty;
      const branchText = ctx.gitStatus.branch + (dirty ? "*" : "");
      const attention = dirty ? "warning" : "normal";
      const branchLink = remoteUrlToHttp(ctx.gitStatus.remoteUrl);
      cells.push({
        group: "header",
        text: branchText,
        attention,
        baseColor: dirty ? undefined : "green", // warning overrides to yellow; clean uses green
        link: branchLink,
      });
    }

    // --- Sub-cell 3: model id (blue, OSC 8 → Anthropic docs anchor) ---
    if (ctx.config.display.showModel) {
      const rawId = ctx.stdin.model?.id ?? "";
      // Condense using the raw id (e.g. "claude-opus-4-7" → "opus-4.7")
      // Prefer id over display_name because display_name may have spaces in the version
      const modelLabel = condenseModelId(rawId);
      if (modelLabel) {
        // Build anchor: "claude-opus-4-7" → "claude-opus-47"
        const anchor = rawId.replace(/\./g, "");
        const modelUrl = anchor
          ? `https://docs.anthropic.com/en/docs/about-claude/models#${anchor}`
          : undefined;
        cells.push({
          group: "header",
          text: modelLabel,
          attention: "normal",
          baseColor: "blue",
          link: modelUrl,
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
 *  "claude-opus-4-7" → "opus-4.7"
 *  "Claude Opus 4.7" → "opus-4.7" (lowercase, strip "claude ")
 *  Anything else returned as-is. */
function condenseModelId(nameOrId: string): string {
  // Strip leading "claude-" or "claude " prefix
  let s = nameOrId.trim();
  if (s.toLowerCase().startsWith("claude-")) s = s.slice(7);
  else if (s.toLowerCase().startsWith("claude ")) s = s.slice(7);
  // Replace hyphens-between-digits with dots: "opus-4-7" → "opus-4.7"
  s = s.replace(/(\d)-(\d)/g, "$1.$2").toLowerCase();
  return s;
}

/** Translate a git remote URL into a browseable HTTP(S) URL.
 *
 *   git@github.com:owner/repo.git    → https://github.com/owner/repo
 *   https://github.com/owner/repo.git → https://github.com/owner/repo
 *   git@gitlab.com:owner/repo.git    → https://gitlab.com/owner/repo
 *   https://gitlab.com/owner/repo    → https://gitlab.com/owner/repo
 *
 * Returns undefined for URLs that don't match a known host pattern.
 */
function remoteUrlToHttp(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const url = remoteUrl.trim();
  if (!url) return undefined;

  // SSH form: git@host:owner/repo(.git)
  const sshMatch = /^git@(github\.com|gitlab\.com|bitbucket\.org):(.+?)(?:\.git)?$/.exec(url);
  if (sshMatch) {
    const host = sshMatch[1]!;
    const path = sshMatch[2]!;
    return `https://${host}/${path}`;
  }

  // HTTP(S) form for known hosts: strip trailing .git
  const httpsMatch = /^(https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^?#]+?)(?:\.git)?\/?$/.exec(url);
  if (httpsMatch) {
    return httpsMatch[1]!;
  }

  return undefined;
}
