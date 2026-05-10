// src/render/widgets/session.ts
//
// Session-time cell for HushLayout.
// Emits a "session time H:MM:SS" (or M:SS) cell showing elapsed wall-clock
// time since the first transcript entry.
//
// Priority 30 — shown in metrics group; lower priority than errors (35) so
// errors survive truncation while session time may drop first.

import type { Widget, WidgetCell, HushCell } from "../widget.js";
import type { ParsedTranscript, RenderContext, StdinData } from "../../types.js";

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
 * Returns a HushCell for session elapsed time, or null when neither the
 * transcript nor stdin has any duration signal.
 *
 * Source priority:
 *   1. transcript.sessionStart  — most accurate (first JSONL entry timestamp);
 *      survives across statusline ticks because the transcript is on disk.
 *   2. stdin.cost.total_duration_ms — Claude Code's own duration counter;
 *      works even when the transcript is unreadable or fresh.
 *
 * @param transcript  Parsed transcript (may be null when file is unreadable).
 * @param stdin       Claude Code stdin payload (may be undefined in tests).
 * @param now         Current epoch ms (injected for testability).
 */
export function renderSessionTimeCell(
  transcript: ParsedTranscript | null,
  stdin: StdinData | undefined,
  now: number,
): HushCell | null {
  let elapsedSec: number | null = null;

  if (transcript?.sessionStart) {
    const elapsedMs = now - transcript.sessionStart.getTime();
    elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
  } else {
    const dms = stdin?.cost?.total_duration_ms;
    if (typeof dms === "number" && dms > 0) {
      elapsedSec = Math.floor(dms / 1000);
    }
  }

  if (elapsedSec === null) return null;

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
    const cell = renderSessionTimeCell(ctx.transcript as ParsedTranscript, ctx.stdin, Date.now());
    if (cell == null) return null;
    return { body: cell.text, visualWidth: cell.text.length };
  },

  renderHush(ctx: RenderContext): HushCell | null {
    return renderSessionTimeCell(ctx.transcript as ParsedTranscript, ctx.stdin, Date.now());
  },
};
