// src/render/widgets/prompt-cache.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderPromptCache } from "../lines/prompt-cache.js";
import { visibleWidth } from "../width.js";

export const promptCacheWidget: Widget = {
  id: "promptCache",
  group: "metrics",
  priority: 60,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderPromptCache(ctx);
    if (body == null) return null;
    return { id: "promptCache", group: "metrics", body, visualWidth: visibleWidth(body) };
  },
};
