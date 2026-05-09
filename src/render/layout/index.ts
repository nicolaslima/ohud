// src/render/layout/index.ts
import type { WidgetCell, HushCell } from "../widget.js";
import type { HudConfig } from "../../types.js";

export type LayoutName = "row" | "hush";

export interface Layout {
  readonly name: LayoutName;
  pack(cells: (WidgetCell | HushCell)[], termWidth: number, config: HudConfig): string[];
}

import { rowLayout } from "./row.js";

export const LAYOUTS: Record<LayoutName, Layout> = {
  row: rowLayout,
  hush: rowLayout, // stub — Task B replaces with hushLayout
};
