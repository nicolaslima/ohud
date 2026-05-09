// src/mode.ts
//
// Mode detection: determine whether the active session is "ollama" or "anthropic".
//
// R2 research finding: Ollama exposes an Anthropic-compatible /v1/messages endpoint,
// which breaks the previous daemon-probe-based heuristic. When a user routes Anthropic
// SDK calls through Ollama, the daemon IS running (daemonOk=true) but the model ID
// begins with "claude-", making the old probe-first logic incorrectly classify the
// session as "ollama".
//
// New rule (Task C): model.id is authoritative.
//   1. If model.id starts with "claude-" (case-insensitive) → "anthropic".
//   2. If model.id is non-empty and does NOT start with "claude-" → "ollama".
//   3. Fallback (model.id absent or empty): use daemon-probe result as before
//      — daemonOk=true → "ollama", daemonOk=false → "anthropic".
//
// This preserves the daemon-probe fallback for legacy/test scenarios that do not
// supply a model.id (e.g. empty stdin, old Claude Code versions).

import type { OllamaProbeResult, RenderMode, StdinData } from "./types.js";

export function resolveMode(stdin: StdinData, probe: OllamaProbeResult): RenderMode {
  const id = stdin.model?.id?.toLowerCase() ?? "";

  // Rule 1: claude-* prefix is definitively Anthropic, regardless of daemon state.
  if (id.startsWith("claude-")) return "anthropic";

  // Rule 2: any other non-empty model id is an Ollama model.
  if (id.length > 0) return "ollama";

  // Rule 3 (fallback): model.id absent — fall back to daemon-probe result.
  return probe.daemonOk ? "ollama" : "anthropic";
}
