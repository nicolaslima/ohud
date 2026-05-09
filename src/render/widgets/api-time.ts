// src/render/widgets/api-time.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderApiTime } from "../lines/api-time.js";
import { maxLineWidth } from "./_util.js";

export const apiTimeWidget: Widget = {
  id: "apiTime",
  group: "metrics",
  priority: 82,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderApiTime(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
