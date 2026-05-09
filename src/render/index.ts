// src/render/index.ts
import { color } from "./colors.js";
import type { RenderContext } from "../types.js";
import type { WidgetCell, HushCell } from "./widget.js";
import { visibleWidgets } from "./widgets/index.js";
import { LAYOUTS } from "./layout/index.js";
import { detectTerminalWidth } from "./width.js";

export function render(ctx: RenderContext): string {
  const widgets = visibleWidgets(ctx.config);

  // Read layout dynamically from config (added in Task C). Falls back to "row"
  // for any config file that pre-dates Task C or omits display.layout.
  const layoutName = ctx.config.display.layout ?? "row";
  const layout = LAYOUTS[layoutName] ?? LAYOUTS.row;
  const termWidth = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);

  // Render each widget to cells, choosing hush render path when appropriate.
  // renderHush() may return a HushCell array (e.g. project emits name+branch+model
  // as separate sub-cells). Flatten all results into a single cells array.
  const cells = widgets
    .flatMap((w): (WidgetCell | HushCell)[] => {
      if (layoutName === "hush" && w.renderHush) {
        const c = w.renderHush(ctx);
        if (!c) return [];
        const arr = Array.isArray(c) ? c : [c];
        return arr.map((cell) => ({ ...cell, id: w.id, group: w.group }));
      }
      const c = w.render(ctx);
      return c ? [{ ...c, id: w.id, group: w.group }] : [];
    });

  const outputLines = layout.pack(cells, termWidth, ctx.config);

  // Fallback: if no content, return minimum sentinel
  if (outputLines.length === 0 || outputLines.every((l) => l.trim() === "")) {
    return color(ctx.config.colors.label, "ohud");
  }

  return outputLines.join("\n");
}
