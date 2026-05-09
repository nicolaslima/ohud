// src/render/widgets/_util.ts
// Internal helpers shared by widget files.
import { visibleWidth } from "../width.js";

/**
 * Compute the visual width of the widest line in a possibly-multi-line body.
 * `visibleWidth(body)` would count `\n` as a 1-width char and sum all rows,
 * which is wrong for budgeting layouts. Use this for any widget whose
 * underlying renderer may emit `\n` (e.g. agents with multiple running entries).
 */
export function maxLineWidth(s: string): number {
  return Math.max(0, ...s.split("\n").map(visibleWidth));
}
