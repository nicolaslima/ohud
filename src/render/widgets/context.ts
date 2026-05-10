// src/render/widgets/context.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { barColorForPercent } from "../thresholds.js";
import { maxLineWidth } from "./_util.js";

export const contextWidget: Widget = {
  id: "context",
  group: "metrics",
  priority: 90,
  minWidth: 22,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderContext(ctx);
    if (body == null) return null;
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

    // Format: "context 310/1M (31%)" — used tokens / total tokens (percent).
    // The total comes from Ollama probe when available (more accurate for
    // remote models), otherwise from stdin's reported context_window_size.
    const stdinTotal = ctx.stdin.context_window?.context_window_size;
    const probeTotal = ctx.mode === "ollama"
      ? ctx.cloudModels.find((m) => m.name === ctx.stdin.model?.id || m.model === ctx.stdin.model?.id)?.context_length
      : undefined;
    const total = probeTotal ?? stdinTotal;
    const used = ctx.stdin.context_window?.current_usage?.input_tokens ?? null;

    let text: string;
    if (typeof total === "number" && total > 0 && typeof used === "number") {
      text = `context ${formatTokens(used)}/${formatTokens(total)} (${rounded}%)`;
    } else {
      text = `context ${rounded}%`;
    }

    return {
      group: "metrics",
      text,
      attention,
    };
  },
};

/** Format a token count compactly. 1234 → "1.2k", 262144 → "262k", 1_000_000 → "1M". */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return (Math.round(m * 10) / 10).toString().replace(/\.0$/, "") + "M";
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return (Math.round(k * 10) / 10).toString().replace(/\.0$/, "") + "k";
  }
  return String(Math.round(n));
}

/** Round context window size to nearest 100k or 1M for display. */
function formatCapacity(size: number): string {
  const millions = size / 1_000_000;
  if (millions >= 0.95) return `${Math.round(millions)}M`;
  const hundreds = Math.round(size / 100_000) * 100;
  return `${hundreds}k`;
}

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/context.ts)
// ---------------------------------------------------------------------------

const BAR_WIDTH = 10;

function renderContext(ctx: RenderContext): string | null {
  if (!ctx.config.display.showContextBar) return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);

  const c = ctx.config.colors;
  const barColor = barColorForPercent(rounded, {
    default: c.context,
    warning: c.warning,
    critical: c.critical,
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold,
  });

  const filled = Math.floor((rounded * BAR_WIDTH) / 100);
  const empty = BAR_WIDTH - filled;
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(empty);
  const valuePart = formatValue(ctx, rounded);

  return `${color(c.label, "Context")} ${color(barColor, bar)} ${color(barColor, valuePart)}`;
}

function formatValue(ctx: RenderContext, rounded: number): string {
  const cw = ctx.stdin.context_window;
  const total = cw?.context_window_size ?? 0;
  const used = cw?.total_input_tokens ?? 0;
  const fmt = (n: number) => `${(n / 1000).toFixed(0)}k`;
  switch (ctx.config.display.contextValue) {
    case "tokens": return `${fmt(used)}/${fmt(total)}`;
    case "remaining": return `${100 - rounded}%`;
    case "both": return `${rounded}% (${fmt(used)}/${fmt(total)})`;
    default: return `${rounded}%`;
  }
}
