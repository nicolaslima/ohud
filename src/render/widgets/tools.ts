// src/render/widgets/tools.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext, ToolEntry } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { basename } from "../path.js";
import { maxLineWidth } from "./_util.js";

interface RunningGroup {
  name: string;
  count: number;
}

export const toolsWidget: Widget = {
  id: "tools",
  group: "activity",
  priority: 90,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderTools(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell[] | null {
    if (!ctx.config.display.showTools) return null;
    const tools = ctx.transcript.tools;
    if (tools.length === 0) return null;

    const running  = tools.filter((t) => t.status === "running");
    const done     = tools.filter((t) => t.status === "completed");
    const cells: HushCell[] = [];

    // Running tools: one HushCell per unique name group, with spinner animation
    for (const g of groupByName(running).values()) {
      const countSuffix = g.count > 1 ? ` ×${g.count}` : "";
      cells.push({
        group: "activity",
        text: `${g.name}${countSuffix}`,
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
      });
    }

    // Done tools: static check mark, dim green
    const tally = countByName(done);
    for (const [name, count] of tally) {
      const countSuffix = count > 1 ? ` ×${count}` : "";
      cells.push({
        group: "activity",
        text: `✓ ${name}${countSuffix}`,
        attention: "muted",
        baseColor: "green",
      });
    }

    return cells.length > 0 ? cells : null;
  },
};

function groupByName(entries: ToolEntry[]): Map<string, RunningGroup> {
  const out = new Map<string, RunningGroup>();
  for (const t of entries) {
    const existing = out.get(t.name);
    if (existing) existing.count += 1;
    else out.set(t.name, { name: t.name, count: 1 });
  }
  return out;
}

function countByName(entries: ToolEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/tools.ts)
// ---------------------------------------------------------------------------

interface RunningGroupRow {
  name: string;
  target?: string;
  count: number;
}

function renderTools(ctx: RenderContext): string | null {
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
function groupRunning(entries: ToolEntry[]): Map<string, RunningGroupRow> {
  const out = new Map<string, RunningGroupRow>();
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
