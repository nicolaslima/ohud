// src/render/widgets/cost.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { formatUsd } from "../../cost.js";
import { maxLineWidth } from "./_util.js";

export const costWidget: Widget = {
  id: "cost",
  group: "metrics",
  priority: 70,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderCost(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  // Hidden in Hush mode by user feedback (plan section 4.3)
  renderHush(_ctx: RenderContext): null {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/cost.ts)
// ---------------------------------------------------------------------------

function renderCost(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.costData) return null;
  // Gating:
  //   showCost: true  → explicit opt-in, render whenever costData is present
  //   showCost: false → only auto-display on extra-usage signal: native cost > 0
  if (!ctx.config.display.showCost) {
    if (ctx.costData.source !== "native" || ctx.costData.totalUsd <= 0) return null;
  }
  const c = ctx.config.colors;
  const suffix = ctx.costData.source === "estimate" ? color(c.label, " (est)") : "";
  return `${color(c.label, "Cost")} ${color(c.label, formatUsd(ctx.costData.totalUsd))}${suffix}`;
}
