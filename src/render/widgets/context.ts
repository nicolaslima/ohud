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
    const warn = ctx.config.display.warningThreshold;   // default 60
    const crit = ctx.config.display.criticalThreshold;  // default 75

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
