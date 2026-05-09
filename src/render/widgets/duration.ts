// src/render/widgets/duration.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderDuration } from "../lines/duration.js";
import { maxLineWidth } from "./_util.js";

// Time thresholds for duration attention
const DURATION_WARNING_MS  = 8  * 60 * 60 * 1000;  //  8h
const DURATION_DANGER_MS   = 12 * 60 * 60 * 1000;  // 12h
const DURATION_NORMAL_MS   =  4 * 60 * 60 * 1000;  //  4h

export const durationWidget: Widget = {
  id: "duration",
  group: "metrics",
  priority: 40,
  minWidth: 12,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderDuration(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    if (!ctx.config.display.showDuration && !ctx.config.display.showSpeed) return null;
    const ms = ctx.stdin.cost?.total_duration_ms;
    if (typeof ms !== "number" || ms <= 0) return null;

    const text = formatDurationHush(ms);

    const attention =
      ms >= DURATION_DANGER_MS   ? "danger" :
      ms >= DURATION_WARNING_MS  ? "warning" :
      ms >= DURATION_NORMAL_MS   ? "normal" :
      "muted";

    return {
      group: "metrics",
      text,
      attention,
    };
  },
};

function formatDurationHush(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
