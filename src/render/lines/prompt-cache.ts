// src/render/lines/prompt-cache.ts
import { color } from "../colors.js";
import { promptCacheRemainingMs, formatPromptCache } from "../../prompt-cache.js";
import type { RenderContext } from "../../types.js";

export function renderPromptCache(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.config.display.showPromptCache) return null;
  const remaining = promptCacheRemainingMs(
    ctx.transcript.lastAssistantResponseAt,
    ctx.config.display.promptCacheTtlSeconds,
  );
  if (remaining === null) return null;
  const c = ctx.config.colors;
  return `${color(c.label, "cache")} ${color(c.label, formatPromptCache(remaining))}`;
}
