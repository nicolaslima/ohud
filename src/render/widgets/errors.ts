// src/render/widgets/errors.ts
//
// Error-count cell for HushLayout.
// Surfaces the count of tools where hasError===true.
//
// Priority 35 — highest among metrics cells; retained under width pressure
// because any tool error is worth surfacing to the user.
//
// Attention levels:
//   1–2 errors → "warning" (yellow)  — worth noticing, not yet alarming
//   3+  errors → "danger"  (red)     — multiple failures; urgent
//
// Rationale: threshold of 3 chosen to distinguish isolated failures (a single
// bad Bash invocation) from a pattern of repeated errors across different tools.

import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { ParsedTranscript, RenderContext } from "../../types.js";

/**
 * Returns a HushCell showing the count of tool errors in the transcript,
 * or null when no errors are present.
 *
 * @param transcript  Parsed transcript (may be null when file is unreadable).
 */
export function renderErrorCountCell(
  transcript: ParsedTranscript | null,
): HushCell | null {
  if (transcript == null) return null;

  const count = transcript.tools.filter((t) => t.hasError === true).length;
  if (count === 0) return null;

  // 1–2 errors → warning; 3+ → danger
  const attention: HushCell["attention"] = count >= 3 ? "danger" : "warning";

  return {
    text: `errors ${count}`,
    attention,
    group: "metrics",
    priority: 35,
  };
}

export const errorsWidget: Widget = {
  id: "errors",
  group: "metrics",
  priority: 35,
  minWidth: 10,

  render(ctx: RenderContext): WidgetCell | null {
    const cell = renderErrorCountCell(ctx.transcript as ParsedTranscript);
    if (cell == null) return null;
    return { body: cell.text, visualWidth: cell.text.length };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    return renderErrorCountCell(ctx.transcript as ParsedTranscript);
  },
};
