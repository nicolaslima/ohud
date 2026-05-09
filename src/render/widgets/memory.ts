// src/render/widgets/memory.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderMemory } from "../lines/memory.js";
import { visibleWidth } from "../width.js";

export const memoryWidget: Widget = {
  id: "memory",
  group: "metrics",
  priority: 50,
  minWidth: 18,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderMemory(ctx);
    if (body == null) return null;
    return { id: "memory", group: "metrics", body, visualWidth: visibleWidth(body) };
  },
};
