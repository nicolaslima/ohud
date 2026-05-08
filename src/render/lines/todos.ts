// src/render/lines/todos.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderTodos(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTodos) return null;
  const todos = ctx.transcript.todos;
  if (todos.length === 0) return null;
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const c = ctx.config.colors;
  const head = inProgress ? `${color(c.label, "▸")} ${inProgress.content}` : `${color(c.label, "▹")} no active todo`;
  return `${head} ${color(c.label, `(${completed}/${total})`)}`;
}
