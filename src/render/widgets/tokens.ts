// src/render/widgets/tokens.ts
//
// Tokens-per-second cell for HushLayout.
// Emits "N tks/s" using computeTokensPerSecond from the transcript parser.
//
// Priority 20 — lowest among metrics cells; drops first under width pressure.

import type { HushCell } from "../widget.js";
import type { ParsedTranscript } from "../../types.js";
import { computeTokensPerSecond } from "../../transcript.js";

/**
 * Returns a HushCell showing approximate tokens per second for the session,
 * or null when the transcript is unavailable or insufficient data exists to
 * compute a meaningful rate (< 2 assistant messages or < 1s elapsed).
 *
 * @param transcript  Parsed transcript (may be null when file is unreadable).
 */
export function renderTokensPerSecCell(
  transcript: ParsedTranscript | null,
): HushCell | null {
  if (transcript == null) return null;

  const tps = computeTokensPerSecond(transcript);
  if (tps == null) return null;

  return {
    text: `${tps} tks/s`,
    attention: "muted",
    group: "metrics",
    priority: 20, // lowest priority — first to drop under width pressure
  };
}
