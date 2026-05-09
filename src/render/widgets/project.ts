// src/render/widgets/project.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderProject } from "../lines/project.js";
import { maxLineWidth } from "./_util.js";
import { basename } from "../path.js";

export const projectWidget: Widget = {
  id: "project",
  group: "header",
  priority: 100,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderProject(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
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
