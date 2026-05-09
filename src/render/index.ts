// src/render/index.ts
import { color } from "./colors.js";
import type { RenderContext } from "../types.js";
import type { WidgetCell, HushCell } from "./widget.js";
import { visibleWidgets } from "./widgets/index.js";
import { LAYOUTS, type LayoutName } from "./layout/index.js";
import { detectTerminalWidth } from "./width.js";

/** Runtime narrowing: a config file's `display.layout` is structurally `string`
 *  at parse time (JSON has no enum), so the TS-level `"row" | "hush"` typing
 *  isn't enough. This guard catches malformed values like `"tracks"` and lets
 *  us fall back to RowLayout deterministically. */
function isValidLayout(name: string): name is LayoutName {
  return name === "row" || name === "hush";
}

export function render(ctx: RenderContext): string {
  const widgets = visibleWidgets(ctx.config);

  // Read layout dynamically from config (added in Task C). Bad/unknown values
  // resolve to "row" via runtime narrowing, NOT via the type system (a user
  // with an out-of-date schema in their config.json must not crash the bundle).
  const rawLayout = ctx.config.display.layout;
  const layoutName: LayoutName =
    typeof rawLayout === "string" && isValidLayout(rawLayout) ? rawLayout : "row";
  const layout = LAYOUTS[layoutName];
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
        return arr.map((cell) => ({ ...cell, id: w.id, group: w.group, priority: cell.priority ?? w.priority }));
      }
      const c = w.render(ctx);
      return c ? [{ ...c, id: w.id, group: w.group }] : [];
    });

  // Pass stdin + transcript to the layout — HushLayout uses session_id to
  // compute the OSC 8 hyperlink target on the ⌗N counter and fires off a
  // session summary file write so the link resolves to a real file.
  const outputLines = layout.pack(cells, termWidth, ctx.config, {
    stdin: ctx.stdin,
    transcript: ctx.transcript,
  });

  // Fallback: if no content, return minimum sentinel
  if (outputLines.length === 0 || outputLines.every((l) => l.trim() === "")) {
    return color(ctx.config.colors.label, "ohud");
  }

  return outputLines.join("\n");
}
