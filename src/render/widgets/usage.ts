// src/render/widgets/usage.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderUsage } from "../lines/usage.js";
import { maxLineWidth } from "./_util.js";

export const usageWidget: Widget = {
  id: "usage",
  group: "metrics",
  priority: 80,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderUsage(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
