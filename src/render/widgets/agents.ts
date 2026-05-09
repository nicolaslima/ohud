// src/render/widgets/agents.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext, AgentEntry } from "../../types.js";
import { renderAgents } from "../lines/agents.js";
import { maxLineWidth } from "./_util.js";

export const agentsWidget: Widget = {
  id: "agents",
  group: "activity",
  priority: 85,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderAgents(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator. renderAgents emits `\n` for ≥2
    // running agents; use maxLineWidth so visualWidth reflects the widest
    // physical row, not the sum.
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell[] | null {
    if (!ctx.config.display.showAgents) return null;
    const agents = ctx.transcript.agents;
    if (agents.length === 0) return null;

    const running   = agents.filter((a) => a.status === "running");
    const completed = agents.filter((a) => a.status === "completed");
    const cells: HushCell[] = [];

    // Running agents: one cell per agent, with spinner animation
    for (const a of running) {
      const modelTag = a.model ? ` [${a.model}]` : "";
      cells.push({
        group: "activity",
        text: `${a.type}${modelTag}`,
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
      });
    }

    // Completed agents: tally by type, dim green
    const tally = countByType(completed);
    for (const [type, count] of tally) {
      const countSuffix = count > 1 ? ` ×${count}` : "";
      cells.push({
        group: "activity",
        text: `✓ ${type}${countSuffix}`,
        attention: "muted",
        baseColor: "green",
      });
    }

    return cells.length > 0 ? cells : null;
  },
};

function countByType(entries: AgentEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return m;
}
