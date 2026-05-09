// src/render/index.ts
import { color } from "./colors.js";
import type { RenderContext } from "../types.js";
import type { WidgetCell, HushCell } from "./widget.js";
import { visibleWidgets } from "./widgets/index.js";
import { LAYOUTS } from "./layout/index.js";
import { detectTerminalWidth } from "./width.js";

export function render(ctx: RenderContext): string {
  const widgets = visibleWidgets(ctx.config);

  // Task A: only RowLayout exists. Task B will wire "hush" properly.
  // Cast to avoid referencing the layout config field which doesn't exist yet
  // in HudConfig (added in Task C). Fallback to "row" always for now.
  const layoutName = "row" as const;
  const layout = LAYOUTS[layoutName];
  const termWidth = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);

  // Render each widget to a cell. WidgetCells for RowLayout (Task A only uses render()).
  const cells = widgets
    .map((w): WidgetCell | HushCell | null => {
      const c = w.render(ctx);
      return c ? { ...c, id: w.id, group: w.group } : null;
    })
    .filter((c): c is WidgetCell | HushCell => c !== null);

  const outputLines = layout.pack(cells, termWidth, ctx.config);

  // Fallback: if no content, return minimum sentinel
  if (outputLines.length === 0 || outputLines.every((l) => l.trim() === "")) {
    return color(ctx.config.colors.label, "ohud");
  }

  return outputLines.join("\n");
}
