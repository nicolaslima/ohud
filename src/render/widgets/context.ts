// src/render/widgets/context.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderContext } from "../lines/context.js";
import { maxLineWidth } from "./_util.js";

export const contextWidget: Widget = {
  id: "context",
  group: "metrics",
  priority: 90,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderContext(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
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
