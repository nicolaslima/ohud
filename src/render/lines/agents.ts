import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderAgents(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAgents) return null;
  const agents = ctx.transcript.agents;
  if (agents.length === 0) return null;
  const c = ctx.config.colors;
  const parts = agents.map((a) => {
    const sym = a.status === "running" ? "◐" : "✓";
    const modelTag = a.model ? ` [${a.model}]` : "";
    const desc = a.description ? `: ${a.description}` : "";
    const elapsed = a.endTime ? "" : ` (${formatElapsed(a.startTime)})`;
    return `${color(c.label, sym)} ${a.type}${modelTag}${desc}${color(c.label, elapsed)}`;
  });
  return parts.join(color(c.label, " | "));
}

function formatElapsed(start: Date): string {
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
