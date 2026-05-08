import type { StdinEffort } from "./types.js";

export function resolveEffortLevel(effort: StdinEffort | string | null | undefined): string | undefined {
  if (effort == null) return undefined;
  if (typeof effort === "string") return effort.toLowerCase();
  if (typeof effort === "object" && typeof effort.level === "string") return effort.level.toLowerCase();
  return undefined;
}
