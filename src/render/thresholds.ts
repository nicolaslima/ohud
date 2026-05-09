// src/render/thresholds.ts
/** Pick the appropriate color spec for a percentage bar based on the standard 60/75 scale. */
export function barColorForPercent(
  pct: number,
  palette: { default: string; warning: string; critical: string },
  thresholds: { warning: number; critical: number } = { warning: 60, critical: 75 },
): string {
  if (pct >= thresholds.critical) return palette.critical;
  if (pct >= thresholds.warning) return palette.warning;
  return palette.default;
}
