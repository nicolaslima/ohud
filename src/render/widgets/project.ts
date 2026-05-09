// src/render/widgets/project.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderProject } from "../lines/project.js";
import { maxLineWidth } from "./_util.js";

export const projectWidget: Widget = {
  id: "project",
  group: "header",
  priority: 100,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderProject(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
