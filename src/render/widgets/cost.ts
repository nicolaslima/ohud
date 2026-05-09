// src/render/widgets/cost.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderCost } from "../lines/cost.js";
import { maxLineWidth } from "./_util.js";

export const costWidget: Widget = {
  id: "cost",
  group: "metrics",
  priority: 70,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderCost(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },

  // Hidden in Hush mode by user feedback (commit ref: this PR plan section 4.3)
  renderHush(_ctx: RenderContext): null {
    return null;
  },
};
