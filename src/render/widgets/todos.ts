// src/render/widgets/todos.ts
import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderTodos } from "../lines/todos.js";
import { maxLineWidth } from "./_util.js";

export const todosWidget: Widget = {
  id: "todos",
  group: "activity",
  priority: 70,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderTodos(ctx);
    if (body == null) return null;
    // id/group injected by orchestrator
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
