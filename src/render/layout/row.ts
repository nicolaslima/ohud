// src/render/layout/row.ts
import type { WidgetCell, HushCell } from "../widget.js";
import type { Layout } from "./index.js";
import type { HudConfig } from "../../types.js";
import { truncateLine } from "../width.js";
import { color } from "../colors.js";
import { glyph } from "../glyphs.js";

/**
 * RowLayout — drop-in replacement for the pre-Widget render(ctx) behavior.
 * Produces byte-identical output to the old imperative renderer.
 *
 * Responsibilities:
 * 1. Project cell (id=project, group=header) → line 1.
 * 2. Context cell (id=context) merged with apiTime OR usage → line 2 (` │ ` separator).
 * 3. Remaining cells in elementOrder order.
 * 4. Lines containing `\n` are split into multiple physical lines.
 * 5. Empty lines filtered.
 * 6. All lines truncated to termWidth.
 */
export const rowLayout: Layout = {
  name: "row",

  pack(
    cells: (WidgetCell | HushCell)[],
    termWidth: number,
    config: HudConfig,
  ): string[] {
    const lines: string[] = [];

    // Helper: split on embedded newlines, filter empty
    function pushLines(out: string): void {
      for (const ln of out.split("\n")) {
        if (ln.length > 0) lines.push(ln);
      }
    }

    // Narrow to WidgetCell — HushCells are not expected in Task A,
    // but defensively fall back to using `text` as body.
    function bodyOf(cell: WidgetCell | HushCell): string {
      if ("body" in cell) return cell.body;
      return (cell as HushCell).text;
    }

    // Build a lookup by id for quick access.
    const byId = new Map<string, WidgetCell | HushCell>();
    for (const c of cells) {
      if (c.id) byId.set(c.id, c);
    }

    // --- Line 1: project ---
    const projectCell = byId.get("project");
    if (projectCell) {
      pushLines(bodyOf(projectCell));
    }

    // --- Line 2: context merged with apiTime|usage ---
    const ctxCell = byId.get("context");
    // In ollama mode, apiTime appears; in anthropic mode, usage appears.
    // The original collectMerged picks apiTime for ollama, usage for anthropic.
    // We replicate that via cell presence (apiTime widget returns null in anthropic,
    // usage widget returns null in ollama).
    const rightCell = byId.get("apiTime") ?? byId.get("usage");

    let mergedLine: string | null = null;
    if (ctxCell && rightCell) {
      const sep = color(config.colors.label, glyph("sep", config.display.glyphs));
      mergedLine = `${bodyOf(ctxCell)} ${sep} ${bodyOf(rightCell)}`;
    } else if (ctxCell) {
      mergedLine = bodyOf(ctxCell);
    } else if (rightCell) {
      mergedLine = bodyOf(rightCell);
    }
    if (mergedLine) pushLines(mergedLine);

    // --- Subsequent lines: follow elementOrder, skip already-rendered ---
    const rendered = new Set<string>(["project", "context", "apiTime", "usage"]);
    for (const key of config.elementOrder) {
      if (rendered.has(key)) continue;
      const cell = byId.get(key);
      if (!cell) continue;
      pushLines(bodyOf(cell));
      rendered.add(key);
    }

    // Truncate all lines to termWidth
    return lines.map((l) => truncateLine(l, termWidth));
  },
};
