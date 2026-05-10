// src/render/widgets/duration.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
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
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(_ctx: RenderContext): HushCell | null {
    // Suppressed in hush layout: sessionTimeWidget renders the same signal
    // ("starts Hh Mm") with a clearer label, and ALWAYS shows (not gated on
    // a 4h threshold). The row layout still gets durationWidget via render().
    return null;
  },
};

// Suppress unused-warning for thresholds — they remain useful for the row
// path's coloring and we want them documented at module top.
void DURATION_WARNING_MS; void DURATION_DANGER_MS; void DURATION_NORMAL_MS;

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/duration.ts)
// ---------------------------------------------------------------------------

function renderDuration(ctx: RenderContext): string | null {
  const showDuration = ctx.config.display.showDuration;
  const showSpeed = ctx.config.display.showSpeed;
  if (!showDuration && !showSpeed) return null;

  const c = ctx.config.colors;
  const parts: string[] = [];

  if (showDuration) {
    const ms = ctx.stdin.cost?.total_duration_ms;
    if (typeof ms === "number" && ms > 0) parts.push(`⏱ ${formatHms(ms)}`);
  }
  if (showSpeed) {
    const tps = computeTokensPerSecond(ctx);
    if (tps !== null) parts.push(`out: ${tps.toFixed(1)} tok/s`);
  }
  if (parts.length === 0) return null;
  return color(c.label, parts.join(" | "));
}

function formatHms(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m` : `${s}s`;
}

function computeTokensPerSecond(_ctx: RenderContext): number | null {
  return null;
}
