// src/render/lines/tools.ts
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { basename } from "../path.js";
import type { RenderContext, ToolEntry } from "../../types.js";

interface RunningGroup {
  name: string;
  target?: string;
  count: number;
}

export function renderTools(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTools) return null;
  const tools = ctx.transcript.tools;
  if (tools.length === 0) return null;

  const running = tools.filter((t) => t.status === "running");
  const completed = tools.filter((t) => t.status === "completed");
  const c = ctx.config.colors;
  const parts: string[] = [];
  for (const g of groupRunning(running).values()) {
    const targetSuffix = g.target ? `: ${basename(g.target)}` : "";
    const countSuffix = g.count > 1 ? ` ×${g.count}` : "";
    parts.push(`${color(c.label, glyph("running", ctx.config.display.glyphs))} ${g.name}${countSuffix}${targetSuffix}`);
  }
  const tally = countByName(completed);
  for (const [name, count] of tally) parts.push(`${color(c.label, glyph("done", ctx.config.display.glyphs))} ${name}${count > 1 ? ` ×${count}` : ""}`);
  return parts.join(color(c.label, " | "));
}

// Group running tools by `(name, target)`. When the same `name` appears with
// distinct targets, collapse to a single entry without target — the target
// suffix would be ambiguous (which file?), so we drop it and just show the
// count. Insertion order is preserved (Map iteration order).
function groupRunning(entries: ToolEntry[]): Map<string, RunningGroup> {
  const out = new Map<string, RunningGroup>();
  for (const t of entries) {
    const sameNameAny = [...out.values()].find((g) => g.name === t.name);
    if (sameNameAny && sameNameAny.target !== t.target) {
      // Different targets for same name — collapse target, bump count.
      sameNameAny.target = undefined;
      sameNameAny.count += 1;
      continue;
    }
    const key = `${t.name}\0${t.target ?? ""}`;
    const existing = out.get(key);
    if (existing) existing.count += 1;
    else out.set(key, { name: t.name, target: t.target, count: 1 });
  }
  return out;
}

function countByName(entries: ToolEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}
