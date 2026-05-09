// src/render/widgets/context.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderContext } from "../lines/context.js";
import { maxLineWidth } from "./_util.js";

export const contextWidget: Widget = {
  id: "context",
  group: "metrics",
  priority: 90,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderContext(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
