// src/render/widgets/prompt-cache.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderPromptCache } from "../lines/prompt-cache.js";
import { maxLineWidth } from "./_util.js";

export const promptCacheWidget: Widget = {
  id: "promptCache",
  group: "metrics",
  priority: 60,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderPromptCache(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },
};
