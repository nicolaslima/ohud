// src/render/widgets/agents.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
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
};
