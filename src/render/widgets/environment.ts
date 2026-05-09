// src/render/widgets/environment.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { maxLineWidth } from "./_util.js";

export const environmentWidget: Widget = {
  id: "environment",
  group: "activity",
  priority: 30,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderEnvironment(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  // Hidden in Hush mode by user feedback (plan section 4.3)
  renderHush(_ctx: RenderContext): null {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/environment.ts)
// ---------------------------------------------------------------------------

function renderEnvironment(ctx: RenderContext): string | null {
  if (!ctx.config.display.showConfigCounts) return null;
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd;
  if (!dir) return null;
  const counts = countAll(dir);
  const c = ctx.config.colors;
  const parts: string[] = [
    `${counts.claudeMd} CLAUDE.md`,
    `${counts.rules} rules`,
    `${counts.mcps} MCPs`,
    `${counts.hooks} hooks`,
  ];
  return color(c.label, parts.join(" | "));
}

interface Counts {
  claudeMd: number;
  rules: number;
  mcps: number;
  hooks: number;
}

function countAll(startDir: string): Counts {
  const home = homedir();
  let claudeMd = 0;
  let dir = startDir;
  while (dir && dir.length > 1 && dir.startsWith(home)) {
    if (existsSync(join(dir, "CLAUDE.md"))) claudeMd += 1;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const settings = readSettings(join(home, ".claude/settings.json"));
  const mcps = Object.keys((settings?.mcpServers ?? {}) as Record<string, unknown>).length;
  const hooks = countHooks(settings?.hooks);
  const rules = readRules(startDir);
  return { claudeMd, rules, mcps, hooks };
}

function readSettings(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countHooks(hooks: unknown): number {
  if (!hooks || typeof hooks !== "object") return 0;
  let n = 0;
  for (const v of Object.values(hooks as Record<string, unknown>)) {
    if (Array.isArray(v)) n += v.length;
  }
  return n;
}

function readRules(startDir: string): number {
  const path = join(startDir, ".claude/rules.md");
  if (!existsSync(path)) return 0;
  try {
    const content = readFileSync(path, "utf8");
    return content.split("\n").filter((l) => /^[-*]\s+\S/.test(l)).length;
  } catch {
    return 0;
  }
}
