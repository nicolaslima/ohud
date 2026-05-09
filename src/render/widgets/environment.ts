// src/render/widgets/environment.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderEnvironment } from "../lines/environment.js";
import { maxLineWidth } from "./_util.js";

export const environmentWidget: Widget = {
  id: "environment",
  group: "activity",
  priority: 30,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderEnvironment(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
