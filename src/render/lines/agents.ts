import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import type { RenderContext, AgentEntry } from "../../types.js";

export function renderAgents(ctx: RenderContext): string | null {
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
