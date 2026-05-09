// tests/mode.test.ts
//
// Task C: model.id-first mode detection.
//
// New rule (replaces daemon-probe-first):
//   1. model.id starts with "claude-" (case-insensitive) → "anthropic"
//   2. model.id non-empty and NOT "claude-" → "ollama"
//   3. model.id absent/empty → daemon-probe fallback (daemonOk → "ollama" else "anthropic")

import { test, expect } from "bun:test";
import { resolveMode } from "../src/mode.js";
import type { OllamaProbeResult, StdinData } from "../src/types.js";

const probeOk = (cloud: string[] = []): OllamaProbeResult => ({
  daemonOk: true,
  cloudModels: cloud.map((m) => ({ name: m, model: m, remote_host: "https://ollama.com:443" })),
  fetchedAt: Date.now(),
  cloudModelsAt: Date.now(),
  host: "http://localhost:11434",
});

const probeDown = (): OllamaProbeResult => ({
  daemonOk: false,
  cloudModels: [],
  fetchedAt: Date.now(),
  cloudModelsAt: Date.now(),
  host: "http://localhost:11434",
});

// ─── Rule 1: claude-* prefix → anthropic, regardless of daemon state ──────────

test("claude-opus-4-7 → anthropic (daemon ok, cloud list populated)", () => {
  const stdin: StdinData = { model: { id: "claude-opus-4-7" } };
  expect(resolveMode(stdin, probeOk(["claude-opus-4-7:cloud"]))).toBe("anthropic");
});

test("claude-3-5-sonnet → anthropic even when routed via Ollama", () => {
  // R2 finding: Ollama's /v1/messages endpoint may expose Anthropic model ids.
  // model.id is authoritative — daemon-probe is irrelevant here.
  const stdin: StdinData = { model: { id: "claude-3-5-sonnet" } };
  expect(resolveMode(stdin, probeOk(["claude-3-5-sonnet:cloud"]))).toBe("anthropic");
});

test("claude-opus-4-7 → anthropic when daemon is offline", () => {
  const stdin: StdinData = { model: { id: "claude-opus-4-7" } };
  expect(resolveMode(stdin, probeDown())).toBe("anthropic");
});

test("case-insensitive: Claude-Opus-4-7 → anthropic", () => {
  const stdin: StdinData = { model: { id: "Claude-Opus-4-7" } };
  expect(resolveMode(stdin, probeOk())).toBe("anthropic");
});

// ─── Rule 2: non-claude, non-empty model.id → ollama ─────────────────────────

test("qwen3-coder → ollama", () => {
  const stdin: StdinData = { model: { id: "qwen3-coder" } };
  expect(resolveMode(stdin, probeOk())).toBe("ollama");
});

test("glm-5:cloud → ollama (daemon ok, in cloud list)", () => {
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probeOk(["glm-5:cloud"]))).toBe("ollama");
});

test("glm-5:cloud → ollama even when daemon is offline (model.id is authoritative)", () => {
  // Old logic returned "anthropic" here because it checked daemonOk first.
  // New logic: model.id is non-empty and doesn't start with "claude-" → "ollama".
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probeDown())).toBe("ollama");
});

test("kimi-k2.6:cloud → ollama (model.id present)", () => {
  const stdin: StdinData = { model: { id: "kimi-k2.6:cloud" } };
  expect(resolveMode(stdin, probeOk(["different:cloud"]))).toBe("ollama");
});

test("glm-5 (no :cloud suffix) → ollama when model.id is present", () => {
  // Old logic required cloud list match. New logic: any non-claude model.id → "ollama".
  const stdin: StdinData = { model: { id: "glm-5" } };
  expect(resolveMode(stdin, probeOk())).toBe("ollama");
});

// ─── Rule 3 (fallback): model.id absent/empty → daemon-probe ─────────────────

test("no model.id + daemonOk=true → ollama (fallback)", () => {
  const stdin: StdinData = {};
  expect(resolveMode(stdin, probeOk(["glm-5:cloud"]))).toBe("ollama");
});

test("no model.id + daemonOk=false → anthropic (fallback)", () => {
  const stdin: StdinData = {};
  expect(resolveMode(stdin, probeDown())).toBe("anthropic");
});

test("empty model.id string + daemonOk=true → ollama (fallback)", () => {
  const stdin: StdinData = { model: { id: "" } };
  expect(resolveMode(stdin, probeOk())).toBe("ollama");
});

test("empty model.id string + daemonOk=false → anthropic (fallback)", () => {
  const stdin: StdinData = { model: { id: "" } };
  expect(resolveMode(stdin, probeDown())).toBe("anthropic");
});

test("model.display_name only (no model.id) + daemonOk=true → ollama (fallback via probe)", () => {
  // display_name is not used by new logic; only model.id matters.
  // With no id, we fall through to daemon-probe fallback.
  const stdin: StdinData = { model: { display_name: "glm-5:cloud" } };
  expect(resolveMode(stdin, probeOk(["glm-5:cloud"]))).toBe("ollama");
});
