// src/render/widgets/usage.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { barColorForPercent } from "../thresholds.js";
import { maxLineWidth } from "./_util.js";

export const usageWidget: Widget = {
  id: "usage",
  group: "metrics",
  priority: 80,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderUsage(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    if (ctx.mode !== "anthropic") return null;
    if (!ctx.config.display.showUsage) return null;
    if (!ctx.usageData) return null;

    const { fiveHour, sevenDay } = ctx.usageData;
    // Hush-specific thresholds override the global warning/critical thresholds.
    const warn = ctx.config.display.hush?.thresholds?.warning ?? ctx.config.display.warningThreshold;
    const crit = ctx.config.display.hush?.thresholds?.danger  ?? ctx.config.display.criticalThreshold;

    // Suppressed when both 5h and 7d < 50%
    const fiveHourPct = fiveHour ?? 0;
    const sevenDayPct = sevenDay ?? 0;
    if (fiveHourPct < 50 && sevenDayPct < 50) return null;

    const parts: string[] = [];
    if (fiveHour !== null) parts.push(`5h ${fiveHour}%`);
    if (sevenDay !== null && sevenDay >= ctx.config.display.sevenDayThreshold) {
      parts.push(`7d ${sevenDay}%`);
    }
    if (parts.length === 0) return null;

    // Attention based on the higher of the two usage values
    const maxPct = Math.max(fiveHourPct, sevenDayPct);
    const attention =
      maxPct >= crit ? "danger" :
      maxPct >= warn ? "warning" :
      maxPct >= 50   ? "normal" :
      "muted";

    return {
      group: "metrics",
      text: parts.join(" "),
      attention,
    };
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/usage.ts)
// ---------------------------------------------------------------------------

const BAR_WIDTH = 10;

function renderUsage(ctx: RenderContext): string | null {
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

function formatWindow(ctx: RenderContext, label: string, pct: number, resetAt: Date | null): string {
  const c = ctx.config.colors;
  const lineColor = barColorForPercent(pct, {
    default: c.usage,
    warning: c.usageWarning,
    critical: c.critical,
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold,
  });

  let core: string;
  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor((pct * BAR_WIDTH) / 100);
    const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(BAR_WIDTH - filled);
    core = `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  } else {
    core = color(lineColor, `${label}: ${pct}%`);
  }

  if (ctx.config.display.showResetLabel && resetAt) {
    core += " " + color(c.label, formatReset(resetAt, ctx.config.display.timeFormat));
  }
  return core;
}

function formatReset(resetAt: Date, fmt: "relative" | "absolute" | "both"): string {
  const deltaMs = resetAt.getTime() - Date.now();
  const rel = relativeTime(deltaMs);
  if (fmt === "relative") return `resets in ${rel}`;
  const abs = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (fmt === "absolute") return `resets at ${abs}`;
  return `resets in ${rel} (${abs})`;
}

function relativeTime(ms: number): string {
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `~${min}m`;
  const h = Math.floor(min / 60);
  const remM = min % 60;
  return remM > 0 ? `~${h}h${remM}m` : `~${h}h`;
}
