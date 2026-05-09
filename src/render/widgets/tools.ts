// src/render/widgets/tools.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderTools } from "../lines/tools.js";
import { visibleWidth } from "../width.js";

export const toolsWidget: Widget = {
  id: "tools",
  group: "activity",
  priority: 90,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderTools(ctx);
    if (body == null) return null;
    return { id: "tools", group: "activity", body, visualWidth: visibleWidth(body) };
  },
};
