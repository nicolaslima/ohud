// src/render/widgets/tools.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext, ToolEntry } from "../../types.js";
import { renderTools } from "../lines/tools.js";
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
    // id/group injected by orchestrator. Use maxLineWidth in case
    // a future renderer emits multi-line bodies.
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
