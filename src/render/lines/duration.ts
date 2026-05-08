// src/render/lines/duration.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderDuration(ctx: RenderContext): string | null {
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

function computeTokensPerSecond(ctx: RenderContext): number | null {
  const eval_count = ctx.transcript.totalEvalCount;
  const eval_dur_ns = ctx.transcript.totalEvalDurationNs;
  if (typeof eval_count === "number" && typeof eval_dur_ns === "number" && eval_dur_ns > 0) {
    return (eval_count * 1_000_000_000) / eval_dur_ns;
  }
  return null;
}
