// src/render/threshold-color.ts
//
// Shared threshold-based color helper for Hush widgets.
// Wraps dimmed text in SGR foreground color codes based on a percentage value
// vs configurable warning/danger thresholds.
//
// Color codes go OUTSIDE any existing dim wrap, producing:
//   \x1b[31m\x1b[2mtext\x1b[22m\x1b[39m
//
// The reset code \x1b[39m resets foreground only, preserving dim if the
// caller supplied already-dimmed text from dim().

export interface Thresholds {
  /** Percentage at which yellow begins (exclusive — > warning triggers yellow). Default 60. */
  warning: number;
  /** Percentage at which red begins (inclusive — >= danger triggers red). Default 75. */
  danger: number;
}

/**
 * Returns the input text wrapped in the appropriate SGR color code based on
 * percentage value vs thresholds. Caller passes already-dimmed text for the
 * neutral case; below-or-at-warning returns the input unchanged.
 *
 * Boundaries:
 *   pctValue <= thresholds.warning  → neutral (return dimmedText unchanged)
 *   pctValue >  thresholds.warning  → yellow  (\x1b[33m...\x1b[39m)
 *   pctValue >= thresholds.danger   → red     (\x1b[31m...\x1b[39m)
 *
 * Edge cases:
 *   NaN / Infinity / negative → neutral (return dimmedText unchanged)
 *   colorEnabled=false        → return dimmedText unchanged
 */
export function applyThresholdColor(
  pctValue: number,
  dimmedText: string,
  thresholds: Thresholds,
  colorEnabled: boolean,
): string {
  // Guard: non-finite or negative values are treated as neutral
  if (!colorEnabled) return dimmedText;
  if (!Number.isFinite(pctValue) || pctValue < 0) return dimmedText;

  // Red check first (higher threshold takes precedence)
  if (pctValue >= thresholds.danger) {
    return `\x1b[31m${dimmedText}\x1b[39m`;
  }
  // Yellow: strictly above warning threshold
  if (pctValue > thresholds.warning) {
    return `\x1b[33m${dimmedText}\x1b[39m`;
  }
  // Neutral
  return dimmedText;
}
