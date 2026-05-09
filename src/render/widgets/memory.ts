// src/render/widgets/memory.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { barColorForPercent } from "../thresholds.js";
import { maxLineWidth } from "./_util.js";

export const memoryWidget: Widget = {
  id: "memory",
  group: "metrics",
  priority: 50,
  minWidth: 18,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderMemory(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  // Hidden in Hush mode by user feedback (plan section 4.3)
  renderHush(_ctx: RenderContext): null {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/memory.ts)
// ---------------------------------------------------------------------------

const BAR_WIDTH = 10;

function renderMemory(ctx: RenderContext): string | null {
  if (!ctx.config.display.showMemoryUsage) return null;
  if (ctx.config.lineLayout !== "expanded") return null;
  if (!ctx.memoryInfo) return null;
  const c = ctx.config.colors;
  const barColor = barColorForPercent(ctx.memoryInfo.usedPercent, {
    default: c.usage,
    warning: c.warning,
    critical: c.critical,
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold,
  });
  const filled = Math.floor((ctx.memoryInfo.usedPercent * BAR_WIDTH) / 100);
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(BAR_WIDTH - filled);
  const usedGb = (ctx.memoryInfo.usedBytes / 1_000_000_000).toFixed(1);
  const totalGb = (ctx.memoryInfo.totalBytes / 1_000_000_000).toFixed(1);
  return `${color(c.label, "RAM")} ${color(barColor, bar)} ${color(c.label, `${ctx.memoryInfo.usedPercent}% (${usedGb} GB / ${totalGb} GB)`)}`;
}
