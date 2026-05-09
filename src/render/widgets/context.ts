// src/render/widgets/context.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { barColorForPercent } from "../thresholds.js";
import { maxLineWidth } from "./_util.js";

export const contextWidget: Widget = {
  id: "context",
  group: "metrics",
  priority: 90,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderContext(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    if (!ctx.config.display.showContextBar) return null;
    const pct = ctx.stdin.context_window?.used_percentage;
    if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
    const rounded = Math.round(pct);

    // Hush-specific thresholds override the global warning/critical thresholds.
    // Falls through to display.warningThreshold/criticalThreshold (defaults 60/75).
    const warn = ctx.config.display.hush?.thresholds?.warning ?? ctx.config.display.warningThreshold;
    const crit = ctx.config.display.hush?.thresholds?.danger  ?? ctx.config.display.criticalThreshold;

    const attention =
      rounded >= crit ? "danger" :
      rounded >= warn ? "warning" :
      "muted";

    return {
      group: "metrics",
      text: `${rounded}%`,
      attention,
    };
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/context.ts)
// ---------------------------------------------------------------------------

const BAR_WIDTH = 10;

function renderContext(ctx: RenderContext): string | null {
  if (!ctx.config.display.showContextBar) return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);

  const c = ctx.config.colors;
  const barColor = barColorForPercent(rounded, {
    default: c.context,
    warning: c.warning,
    critical: c.critical,
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold,
  });

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
