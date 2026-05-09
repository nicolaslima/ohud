// src/render/widgets/project.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderProject } from "../lines/project.js";
import { visibleWidth } from "../width.js";

export const projectWidget: Widget = {
  id: "project",
  group: "header",
  priority: 100,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderProject(ctx);
    if (body == null) return null;
    return { id: "project", group: "header", body, visualWidth: visibleWidth(body) };
  },
};
