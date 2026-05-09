// src/render/lines/context.ts
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderContext(ctx: RenderContext): string | null {
  if (!ctx.config.display.showContextBar) return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);

  const c = ctx.config.colors;
  let barColor = c.context;
  if (rounded >= 85) barColor = c.critical;
  else if (rounded >= 70) barColor = c.warning;

  const filled = Math.floor((rounded * BAR_WIDTH) / 100);
  const empty = BAR_WIDTH - filled;
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(empty);
  const valuePart = formatValue(ctx, rounded);

  return `${color(c.label, "Context")} ${color(barColor, bar)} ${color(barColor, valuePart)}`;
}

function formatValue(ctx: RenderContext, rounded: number): string {
  const cw = ctx.stdin.context_window;
  const total = cw?.context_window_size ?? 0;
  const used = cw?.total_input_tokens ?? 0;
  const fmt = (n: number) => `${(n / 1000).toFixed(0)}k`;
  switch (ctx.config.display.contextValue) {
    case "tokens": return `${fmt(used)}/${fmt(total)}`;
    case "remaining": return `${100 - rounded}%`;
    case "both": return `${rounded}% (${fmt(used)}/${fmt(total)})`;
    default: return `${rounded}%`;
  }
}
