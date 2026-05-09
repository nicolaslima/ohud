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

  /** Optional minimal render — used by HushLayout. If absent, HushLayout falls back to render() with ANSI stripped.
   *  May return an array to emit multiple sub-cells (e.g., project widget emits name + branch + model). */
  renderHush?(ctx: RenderContext): HushCell | HushCell[] | null;
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
  /** Sub-identifier preserved through spread-and-override in render pipelines.
   *  Used by HushLayout to distinguish cells emitted by the same widget:
   *  e.g. "icon", "name", "branch", "model" from projectWidget. */
  subId?: string;
  group?: WidgetGroup;
  text: string;                              // PLAIN — no ANSI codes
  attention: "muted" | "normal" | "warning" | "danger";
  link?: string;                             // optional OSC 8 URL
  animate?: "spinner" | null;               // optional animation hint: "spinner" for running activity
  /** Optional baseline color key used by HushLayout for "normal" and "muted" attention cells.
   *  When absent, "normal" attention cells render without additional color (default fg).
   *  Must be one of the supported SGR palette entries in HushLayout. */
  baseColor?: "cyan" | "green" | "blue" | "magenta" | "yellow" | "red";
  /** Priority inherited from the emitting Widget — used by HushLayout for overflow truncation. */
  priority?: number;
  /** Primary text portion rendered with baseColor (e.g. tool name "Edit"). */
  primaryText?: string;
  /** Secondary text portion rendered dim (e.g. count "×6"). */
  secondaryText?: string;
}
