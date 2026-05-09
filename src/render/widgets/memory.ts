// src/render/widgets/memory.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderMemory } from "../lines/memory.js";
import { maxLineWidth } from "./_util.js";

export const memoryWidget: Widget = {
  id: "memory",
  group: "metrics",
  priority: 50,
  minWidth: 18,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderMemory(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },

  // Hidden in Hush mode by user feedback (commit ref: this PR plan section 4.3)
  renderHush(_ctx: RenderContext): null {
    return null;
  },
};
