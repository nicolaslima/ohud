// src/render/lines/tools.ts
import { color } from "../colors.js";
import type { RenderContext, ToolEntry } from "../../types.js";

export function renderTools(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTools) return null;
  const tools = ctx.transcript.tools;
  if (tools.length === 0) return null;

  const running = tools.filter((t) => t.status === "running");
  const completed = tools.filter((t) => t.status === "completed");
  const c = ctx.config.colors;
  const parts: string[] = [];
  for (const t of running) parts.push(`${color(c.label, "◐")} ${t.name}${t.target ? `: ${basename(t.target)}` : ""}`);
  const tally = countByName(completed);
  for (const [name, count] of tally) parts.push(`${color(c.label, "✓")} ${name}${count > 1 ? ` ×${count}` : ""}`);
  return parts.join(color(c.label, " | "));
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function countByName(entries: ToolEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}
