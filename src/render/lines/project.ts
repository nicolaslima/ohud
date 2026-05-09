// src/render/lines/project.ts
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import type { RenderContext } from "../../types.js";

export function renderProject(ctx: RenderContext): string {
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

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : "";
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
