// src/render/widgets/todos.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";
import { maxLineWidth } from "./_util.js";

export const todosWidget: Widget = {
  id: "todos",
  group: "activity",
  priority: 70,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderTodos(ctx);
    if (body == null) return null;
    return { body, visualWidth: maxLineWidth(body) };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    if (!ctx.config.display.showTodos) return null;
    const todos = ctx.transcript.todos;
    // Show only if there is an in-progress todo
    const inProgress = todos.find((t) => t.status === "in_progress");
    if (!inProgress) return null;

    return {
      group: "activity",
      text: `▸ ${inProgress.content}`,
      attention: "warning",
    };
  },
};

// ---------------------------------------------------------------------------
// Row render implementation (moved from src/render/lines/todos.ts)
// ---------------------------------------------------------------------------

function renderTodos(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTodos) return null;
  const todos = ctx.transcript.todos;
  if (todos.length === 0) return null;
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const c = ctx.config.colors;
  const head = inProgress ? `${color(c.label, glyph("active", ctx.config.display.glyphs))} ${inProgress.content}` : `${color(c.label, glyph("todo", ctx.config.display.glyphs))} no active todo`;
  return `${head} ${color(c.label, `(${completed}/${total})`)}`;
}
