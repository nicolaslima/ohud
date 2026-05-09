// src/render/widgets/todos.ts
import type { Widget, WidgetCell } from "../widget.js";
import type { RenderContext } from "../../types.js";
import { renderTodos } from "../lines/todos.js";
import { visibleWidth } from "../width.js";

export const todosWidget: Widget = {
  id: "todos",
  group: "activity",
  priority: 70,
  minWidth: 20,

  render(ctx: RenderContext): WidgetCell | null {
    const body = renderTodos(ctx);
    if (body == null) return null;
    return { id: "todos", group: "activity", body, visualWidth: visibleWidth(body) };
  },
};
