// src/render/widgets/prompt-cache.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderPromptCache } from "../lines/prompt-cache.js";
import { maxLineWidth } from "./_util.js";
import { promptCacheRemainingMs, formatPromptCache } from "../../prompt-cache.js";

// Suppress if cache freshness < 60 seconds remaining
const MIN_REMAINING_MS = 60_000;

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

  renderHush(ctx: RenderContext): HushCell | null {
    if (ctx.mode !== "anthropic") return null;
    if (!ctx.config.display.showPromptCache) return null;
    const remaining = promptCacheRemainingMs(
      ctx.transcript.lastAssistantResponseAt,
      ctx.config.display.promptCacheTtlSeconds,
    );
    if (remaining === null || remaining < MIN_REMAINING_MS) return null;

    return {
      group: "metrics",
      text: `cache ${formatPromptCache(remaining)}`,
      attention: "muted",
      baseColor: "cyan",
    };
  },
};
