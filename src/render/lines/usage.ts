// src/render/lines/usage.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderUsage(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.config.display.showUsage) return null;
  if (!ctx.usageData) return null;

  const { fiveHour, sevenDay } = ctx.usageData;
  const parts: string[] = [];

  if (fiveHour !== null) parts.push(formatWindow(ctx, "5h", fiveHour, ctx.usageData.fiveHourResetAt));
  if (sevenDay !== null && sevenDay >= ctx.config.display.sevenDayThreshold) {
    parts.push(formatWindow(ctx, "7d", sevenDay, ctx.usageData.sevenDayResetAt));
  }
  if (parts.length === 0) return null;

  const c = ctx.config.colors;
  return `${color(c.label, "Usage")} ${parts.join(" | ")}`;
}

function formatWindow(ctx: RenderContext, label: string, pct: number, _resetAt: Date | null): string {
  const c = ctx.config.colors;
  let lineColor = c.usage;
  if (pct >= 85) lineColor = c.critical;
  else if (pct >= 60) lineColor = c.usageWarning;

  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor((pct * BAR_WIDTH) / 100);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    return `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  }
  return color(lineColor, `${label}: ${pct}%`);
}
