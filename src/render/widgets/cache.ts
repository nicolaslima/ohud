// src/render/widgets/cache.ts
//
// Cache hit-ratio cell for HushLayout.
// Emits "cache N% hit" based on current_usage token fields from StdinData.
//
// Priority 25 — metrics group; shown above tokens (20), below session time (30).

import type { HushCell } from "../widget.js";
import type { StdinData } from "../../types.js";

/**
 * Returns a HushCell showing the prompt-cache hit ratio for the current turn,
 * or null when both cache fields are absent/zero (no caching activity).
 *
 * Denominator definition:
 *   total_input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * Rationale: the Anthropic API bills for all three token categories as input.
 * "cache_read" alone would double-count because input_tokens already excludes
 * cached tokens in some billing contexts, but since Claude Code's stdin reports
 * all three independently, summing them gives the most robust total that works
 * whether or not input_tokens already includes cache tokens.
 *
 * Hit ratio = cache_read / total_input (clamped to [0, 1]).
 * When total_input = 0 but cache_read > 0, ratio is reported as 100%.
 *
 * @param stdin  Raw stdin payload from Claude Code.
 */
export function renderCacheCell(stdin: StdinData): HushCell | null {
  const usage = stdin.context_window?.current_usage;
  if (usage == null) return null;

  const creation = usage.cache_creation_input_tokens ?? 0;
  const read     = usage.cache_read_input_tokens     ?? 0;

  // Only emit when some caching activity occurred
  if (creation === 0 && read === 0) return null;

  const input = usage.input_tokens ?? 0;
  // total_input = all three token categories
  const total = input + creation + read;

  const rawRatio = total > 0 ? read / total : (read > 0 ? 1 : 0);
  // Clamp defensively: malformed payloads (negative input_tokens, etc.) could
  // otherwise produce ratios outside [0, 1] and render "cache 142% hit".
  const hitRatio = Math.max(0, Math.min(1, rawRatio));
  const pct = Math.floor(hitRatio * 100);

  return {
    text: `cache ${pct}% hit`,
    attention: "muted",
    group: "metrics",
    priority: 25, // between session time (30) and tokens (20)
  };
}
