// src/render/widgets/agents.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext, AgentEntry } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { maxLineWidth } from "./_util.js";

export const agentsWidget: Widget = {
  id: "agents",
  group: "activity",
  priority: 85,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderAgents(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator. renderAgents emits `\n` for ≥2
    // running agents; use maxLineWidth so visualWidth reflects the widest
    // physical row, not the sum.
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell[] | null {
    if (!ctx.config.display.showAgents) return null;
    const agents = ctx.transcript.agents;
    if (agents.length === 0) return null;

    const running   = agents.filter((a) => a.status === "running");
    const completed = agents.filter((a) => a.status === "completed");
    const cells: HushCell[] = [];

    // Running agents: one cell per agent, with spinner animation
    for (const a of running) {
      const modelTag = a.model ? ` [${a.model}]` : "";
      cells.push({
        group: "activity",
        text: `${a.type}${modelTag}`,
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
      });
    }

    // Completed agents: tally by type, dim green
    const tally = countByType(completed);
    for (const [type, count] of tally) {
      const countSuffix = count > 1 ? ` ×${count}` : "";
      cells.push({
        group: "activity",
        text: `✓ ${type}${countSuffix}`,
        attention: "muted",
        baseColor: "green",
      });
    }

    return cells.length > 0 ? cells : null;
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/agents.ts)
// ---------------------------------------------------------------------------

function renderAgents(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAgents) return null;
  const agents = ctx.transcript.agents;
  if (agents.length === 0) return null;
  const c = ctx.config.colors;

  const running = agents.filter((a) => a.status === "running");
  const completed = agents.filter((a) => a.status === "completed");

  const lines: string[] = [];

  if (running.length === 1) {
    // Single running: keep on one line (backward compat).
    lines.push(formatRunningAgent(running[0]!, ctx));
  } else if (running.length >= 2) {
    // Multiple running: one line per agent — avoids wide truncation.
    for (const a of running) lines.push(formatRunningAgent(a, ctx));
  }

  // Trailing completed summary if any: tally by type, single line.
  if (completed.length > 0) {
    const tally = countByType(completed);
    const completedParts: string[] = [];
    for (const [type, count] of tally) {
      completedParts.push(`${color(c.label, glyph("done", ctx.config.display.glyphs))} ${type}${count > 1 ? ` ×${count}` : ""}`);
    }
    lines.push(completedParts.join(color(c.label, " | ")));
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function formatRunningAgent(a: AgentEntry, ctx: RenderContext): string {
  const c = ctx.config.colors;
  const sym = glyph("running", ctx.config.display.glyphs);
  const modelTag = a.model ? ` [${a.model}]` : "";
  const desc = a.description ? `: ${a.description}` : "";
  const elapsed = a.endTime ? "" : ` (${formatElapsed(a.startTime)})`;
  return `${color(c.label, sym)} ${a.type}${modelTag}${desc}${color(c.label, elapsed)}`;
}

function countByType(entries: AgentEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return m;
}

function formatElapsed(start: Date): string {
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
