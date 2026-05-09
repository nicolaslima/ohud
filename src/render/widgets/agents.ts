// src/render/widgets/agents.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderAgents } from "../lines/agents.js";
import { visibleWidth } from "../width.js";

export const agentsWidget: Widget = {
  id: "agents",
  group: "activity",
  priority: 85,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderAgents(ctx);
    if (body == null) return null;
    return { id: "agents", group: "activity", body, visualWidth: visibleWidth(body) };
  },
};
