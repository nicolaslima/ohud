// src/render/lines/api-time.ts
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import type { RenderContext } from "../../types.js";

export function renderApiTime(ctx: RenderContext): string | null {
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
