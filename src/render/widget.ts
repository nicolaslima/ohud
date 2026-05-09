// src/render/widget.ts
import type { RenderContext } from "../types.js";

/** A widget produces zero or one cell per tick. */
export interface Widget {
  readonly id: string;
  readonly group: WidgetGroup;
  readonly priority: number;
  readonly minWidth: number;
  readonly preferredWidth?: number;

  /** Verbose render — used by RowLayout. Returns existing-style ANSI output. */
  render(ctx: RenderContext): WidgetCell | null;

  /** Optional minimal render — used by HushLayout. If absent, HushLayout falls back to render() with ANSI stripped. */
  renderHush?(ctx: RenderContext): HushCell | null;
}

export type WidgetGroup = "header" | "metrics" | "activity";

/** Verbose cell (RowLayout). */
export interface WidgetCell {
  id?: string;
  group?: WidgetGroup;
  body: string;       // ANSI-colored
  visualWidth: number;
}

/** Minimal cell (HushLayout). */
export interface HushCell {
  id?: string;
  group?: WidgetGroup;
  text: string;                              // PLAIN — no ANSI codes
  attention: "muted" | "normal" | "warning" | "danger";
}
