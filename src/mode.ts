// src/mode.ts
import type { OllamaProbeResult, RenderMode, StdinData } from "./types.js";

export function resolveMode(stdin: StdinData, probe: OllamaProbeResult): RenderMode {
  if (!probe.daemonOk) return "anthropic";

  const candidates = [stdin.model?.id, stdin.model?.display_name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (candidates.length === 0) return "anthropic";

  // Strong heuristic: explicit :cloud suffix wins regardless of cloudModels list
  if (candidates.some((c) => c.endsWith(":cloud"))) return "ollama";

  if (probe.cloudModels.length === 0) return "anthropic";

  // Fallback: exact match against probe-listed names (case-sensitive)
  const cloudNames = new Set(probe.cloudModels.flatMap((m) => [m.name, m.model]));
  return candidates.some((c) => cloudNames.has(c)) ? "ollama" : "anthropic";
}
