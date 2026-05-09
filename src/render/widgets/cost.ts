// src/render/widgets/cost.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderCost } from "../lines/cost.js";
import { visibleWidth } from "../width.js";

export const costWidget: Widget = {
  id: "cost",
  group: "metrics",
  priority: 70,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderCost(ctx);
    if (body == null) return null;
    return { id: "cost", group: "metrics", body, visualWidth: visibleWidth(body) };
  },
};
