// src/render/widgets/duration.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderDuration } from "../lines/duration.js";
import { maxLineWidth } from "./_util.js";

export const durationWidget: Widget = {
  id: "duration",
  group: "metrics",
  priority: 40,
  minWidth: 12,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderDuration(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
