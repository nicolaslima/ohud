// src/render/widgets/api-time.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderApiTime } from "../lines/api-time.js";
import { maxLineWidth } from "./_util.js";

export const apiTimeWidget: Widget = {
  id: "apiTime",
  group: "metrics",
  priority: 82,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderApiTime(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    if (ctx.mode !== "ollama") return null;
    if (!ctx.config.display.showApiTime) return null;
    const ms = ctx.stdin.cost?.total_api_duration_ms;
    if (typeof ms !== "number" || ms <= 0) return null;

    // Threshold rules: <100ms muted, 100..499 normal, 500..1499 warning, >=1500 danger
    const attention =
      ms >= 1500 ? "danger" :
      ms >= 500  ? "warning" :
      ms >= 100  ? "normal" :
      "muted";

    return {
      group: "metrics",
      text: formatApiTime(ms),
      attention,
    };
  },
};

function formatApiTime(ms: number): string {
  if (ms >= 1000) {
    const s = (ms / 1000).toFixed(1);
    return `${s}s`;
  }
  return `${Math.round(ms)}ms`;
}
