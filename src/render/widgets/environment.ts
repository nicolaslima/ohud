// src/render/widgets/environment.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderEnvironment } from "../lines/environment.js";
import { visibleWidth } from "../width.js";

export const environmentWidget: Widget = {
  id: "environment",
  group: "activity",
  priority: 30,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderEnvironment(ctx);
    if (body == null) return null;
    return { id: "environment", group: "activity", body, visualWidth: visibleWidth(body) };
  },
};
