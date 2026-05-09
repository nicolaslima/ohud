// src/render/lines/memory.ts
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderMemory(ctx: RenderContext): string | null {
  if (!ctx.config.display.showMemoryUsage) return null;
  if (ctx.config.lineLayout !== "expanded") return null;
  if (!ctx.memoryInfo) return null;
  const c = ctx.config.colors;
  const filled = Math.floor((ctx.memoryInfo.usedPercent * BAR_WIDTH) / 100);
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(BAR_WIDTH - filled);
  const usedGb = (ctx.memoryInfo.usedBytes / 1_000_000_000).toFixed(1);
  const totalGb = (ctx.memoryInfo.totalBytes / 1_000_000_000).toFixed(1);
  return `${color(c.label, "RAM")} ${color(c.usage, bar)} ${color(c.label, `${ctx.memoryInfo.usedPercent}% (${usedGb} GB / ${totalGb} GB)`)}`;
}
