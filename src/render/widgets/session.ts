// src/render/widgets/session.ts
//
// Session-time cell for HushLayout.
// Emits a "session time H:MM:SS" (or M:SS) cell showing elapsed wall-clock
// time since the first transcript entry.
//
// Priority 30 — shown in metrics group; lower priority than errors (35) so
// errors survive truncation while session time may drop first.

import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { ParsedTranscript, RenderContext } from "../../types.js";

/**
 * Format elapsed seconds as a compact "starts" duration:
 *   0..59s    → "<1m"
 *   60..3599  → "Mm"        (e.g. "5m", "59m")
 *   ≥ 1h      → "HhMm"      (e.g. "2h33m", "12h5m")
 * No seconds component — at this scale they are noise.
 */
function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return "<1m";
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  if (h === 0) return `${m}m`;
  return `${h}h${m}m`;
}

/**
 * Returns a HushCell for session elapsed time, or null when the transcript or
 * sessionStart is unavailable.
 *
 * @param transcript  Parsed transcript (may be null when file is unreadable).
 * @param now         Current epoch ms (injected for testability).
 */
export function renderSessionTimeCell(
  transcript: ParsedTranscript | null,
  now: number,
): HushCell | null {
  if (transcript == null) return null;
  const sessionStart = transcript.sessionStart;
  if (sessionStart == null) return null;

  const elapsedMs = now - sessionStart.getTime();
  // Guard against clock skew (future sessionStart)
  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));

  return {
    text: `starts ${formatElapsed(elapsedSec)}`,
    attention: "muted",
    group: "metrics",
    priority: 30,
  };
}

export const sessionTimeWidget: Widget = {
  id: "sessionTime",
  group: "metrics",
  priority: 30,
  minWidth: 16,

  render(ctx: RenderContext): WidgetCell | null {
    const cell = renderSessionTimeCell(ctx.transcript as ParsedTranscript, Date.now());
    if (cell == null) return null;
    return { body: cell.text, visualWidth: cell.text.length };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    return renderSessionTimeCell(ctx.transcript as ParsedTranscript, Date.now());
  },
};
