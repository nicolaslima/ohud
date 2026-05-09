// src/render/layout/index.ts
import type { WidgetCell, HushCell } from "../widget.js";
import type { HudConfig } from "../../types.js";
import { rowLayout } from "./row.js";
import { hushLayout } from "./hush.js";

export type LayoutName = "row" | "hush";

export interface Layout {
  readonly name: LayoutName;
  pack(cells: (WidgetCell | HushCell)[], termWidth: number, config: HudConfig): string[];
}

export const LAYOUTS: Record<LayoutName, Layout> = {
  row: rowLayout,
  hush: hushLayout,
};
