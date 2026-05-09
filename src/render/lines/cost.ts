// src/render/lines/cost.ts
import { color } from "../colors.js";
import { formatUsd } from "../../cost.js";
import type { RenderContext } from "../../types.js";

export function renderCost(ctx: RenderContext): string | null {
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
