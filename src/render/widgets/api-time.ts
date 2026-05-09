// src/render/widgets/api-time.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { maxLineWidth } from "./_util.js";

export const apiTimeWidget: Widget = {
  id: "apiTime",
  group: "metrics",
  priority: 82,
  minWidth: 14,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderApiTime(ctx);
    if (body == null) return null;
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

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/api-time.ts)
// ---------------------------------------------------------------------------

function renderApiTime(ctx: RenderContext): string | null {
  if (ctx.mode !== "ollama") return null;
  if (!ctx.config.display.showApiTime) return null;
  const c = ctx.config.colors;
  const apiMs = ctx.stdin.cost?.total_api_duration_ms;
  if (typeof apiMs === "number" && apiMs > 0) {
    return `${color(c.label, "API")} ${color(c.apiTime, `${glyph("clock", ctx.config.display.glyphs)} ${formatDuration(apiMs)}`)}`;
  }
  return null;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
