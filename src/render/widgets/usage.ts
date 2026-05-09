// src/render/widgets/usage.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderUsage } from "../lines/usage.js";
import { visibleWidth } from "../width.js";

export const usageWidget: Widget = {
  id: "usage",
  group: "metrics",
  priority: 80,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderUsage(ctx);
    if (body == null) return null;
    return { id: "usage", group: "metrics", body, visualWidth: visibleWidth(body) };
  },
};
