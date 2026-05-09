// src/render/layout/index.ts
import type { WidgetCell, HushCell } from "../widget.js";
import type { HudConfig, StdinData, ParsedTranscript, TranscriptData } from "../../types.js";
import { rowLayout } from "./row.js";
import { hushLayout } from "./hush.js";

export type LayoutName = "row" | "hush";

/**
 * Optional plumbing for layouts that need session-level data (e.g. HushLayout
 * needs `stdin.session_id` to compute the OSC 8 hyperlink target on the ⌗N
 * counter, and `transcript` to write the session summary file).
 *
 * Kept optional and minimal — RowLayout ignores it; HushLayout reads
 * `stdin.session_id` for the deterministic file path.
 */
export interface LayoutContext {
  stdin?: StdinData;
  transcript?: TranscriptData | ParsedTranscript;
}

export interface Layout {
  readonly name: LayoutName;
  pack(
    cells: (WidgetCell | HushCell)[],
    termWidth: number,
    config: HudConfig,
    layoutCtx?: LayoutContext,
  ): string[];
}

export const LAYOUTS: Record<LayoutName, Layout> = {
  row: rowLayout,
  hush: hushLayout,
};
