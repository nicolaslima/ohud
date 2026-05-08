// src/mode.ts
import type { OllamaProbeResult, RenderMode, StdinData } from "./types.js";

export function resolveMode(stdin: StdinData, probe: OllamaProbeResult): RenderMode {
  if (!probe.daemonOk) return "anthropic";
  if (probe.cloudModels.length === 0) return "anthropic";

  const candidates = [stdin.model?.id, stdin.model?.display_name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (candidates.length === 0) return "anthropic";

  const cloudNames = new Set(probe.cloudModels.flatMap((m) => [m.name, m.model]));
  const isCloud = candidates.some((c) => cloudNames.has(c));
  return isCloud ? "ollama" : "anthropic";
}
