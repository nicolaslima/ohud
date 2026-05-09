// src/render/index.ts
import { color } from "./colors.js";
import { glyph } from "./glyphs.js";
import type { RenderContext } from "../types.js";
import { renderProject } from "./lines/project.js";
import { renderContext } from "./lines/context.js";
import { renderApiTime } from "./lines/api-time.js";
import { renderUsage } from "./lines/usage.js";
import { renderCost } from "./lines/cost.js";
import { renderPromptCache } from "./lines/prompt-cache.js";
import { renderTools } from "./lines/tools.js";
import { renderAgents } from "./lines/agents.js";
import { renderTodos } from "./lines/todos.js";
import { renderEnvironment } from "./lines/environment.js";
import { renderMemory } from "./lines/memory.js";
import { renderDuration } from "./lines/duration.js";
import { detectTerminalWidth, truncateLine } from "./width.js";

type LineFn = (ctx: RenderContext) => string | null;

const LINE_REGISTRY: Record<string, LineFn> = {
  project: renderProject,
  context: renderContext,
  apiTime: renderApiTime,
  usage: renderUsage,
  cost: renderCost,
  promptCache: renderPromptCache,
  tools: renderTools,
  agents: renderAgents,
  todos: renderTodos,
  environment: renderEnvironment,
  memory: renderMemory,
  duration: renderDuration,
};

export function render(ctx: RenderContext): string {
  const order = ctx.config.elementOrder;
  const lines: string[] = [];

  // Line 1: project
  if (order.includes("project")) {
    const p = renderProject(ctx);
    if (p) lines.push(p);
  }

  // Line 2: context (left) merged with apiTime|usage (right) per mergeGroups
  const merged = collectMerged(ctx);
  if (merged) lines.push(merged);

  // Subsequent lines: in elementOrder, skipping already-rendered ones
  const rendered = new Set<string>(["project", "context", "apiTime", "usage"]);
  for (const key of order) {
    if (rendered.has(key)) continue;
    const fn = LINE_REGISTRY[key];
    if (!fn) continue;
    const out = fn(ctx);
    if (out) lines.push(out);
    rendered.add(key);
  }

  const max = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);
  const truncated = lines.map((l) => truncateLine(l, max));

  // Fallback: if no content, return minimum sentinel
  if (truncated.length === 0 || truncated.every((l) => l.trim() === "")) {
    return color(ctx.config.colors.label, "ohud");
  }
  return truncated.join("\n");
}

function collectMerged(ctx: RenderContext): string | null {
  const ctxLine = renderContext(ctx);
  const right = ctx.mode === "ollama" ? renderApiTime(ctx) : renderUsage(ctx);
  if (ctxLine && right) {
    const sep = color(ctx.config.colors.label, glyph("sep", ctx.config.display.glyphs));
    return `${ctxLine} ${sep} ${right}`;
  }
  return ctxLine ?? right ?? null;
}
