// src/render/widgets/tools.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderTools } from "../lines/tools.js";
import { maxLineWidth } from "./_util.js";

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
};
