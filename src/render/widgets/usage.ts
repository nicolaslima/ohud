// src/render/widgets/usage.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderUsage } from "../lines/usage.js";
import { maxLineWidth } from "./_util.js";

export const usageWidget: Widget = {
  id: "usage",
  group: "metrics",
  priority: 80,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderUsage(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
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
