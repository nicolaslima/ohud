// tests/mode.test.ts
import { test, expect } from "bun:test";
import { resolveMode } from "../src/mode.js";
import type { OllamaProbeResult, StdinData } from "../src/types.js";

const probeOk = (cloud: string[]): OllamaProbeResult => ({
  daemonOk: true,
  cloudModels: cloud.map((m) => ({ name: m, model: m, remote_host: "https://ollama.com:443" })),
  fetchedAt: Date.now(),
  cloudModelsAt: Date.now(),
  host: "http://localhost:11434",
});

test("ollama mode when daemon ok + model in cloud list", () => {
  const probe = probeOk(["glm-5:cloud"]);
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probe)).toBe("ollama");
});

test("anthropic mode when daemon offline", () => {
  const probe: OllamaProbeResult = { daemonOk: false, cloudModels: [], fetchedAt: Date.now(), cloudModelsAt: Date.now(), host: "http://localhost:11434" };
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probe)).toBe("anthropic");
});

test("anthropic mode when no cloud models installed and model id has no :cloud suffix", () => {
  const probe: OllamaProbeResult = { daemonOk: true, cloudModels: [], fetchedAt: Date.now(), cloudModelsAt: Date.now(), host: "http://localhost:11434" };
  const stdin: StdinData = { model: { id: "glm-5" } };
  expect(resolveMode(stdin, probe)).toBe("anthropic");
});

test("anthropic mode when current model is not in cloud list", () => {
  const probe = probeOk(["glm-5:cloud"]);
  const stdin: StdinData = { model: { id: "claude-opus-4-7" } };
  expect(resolveMode(stdin, probe)).toBe("anthropic");
});

test("anthropic mode when stdin.model.id missing", () => {
  const probe = probeOk(["glm-5:cloud"]);
  const stdin: StdinData = {};
  expect(resolveMode(stdin, probe)).toBe("anthropic");
});

test("matches via stdin.model.display_name as fallback", () => {
  const probe = probeOk(["glm-5:cloud"]);
  const stdin: StdinData = { model: { display_name: "glm-5:cloud" } };
  expect(resolveMode(stdin, probe)).toBe("ollama");
});

test("resolveMode returns 'ollama' when stdin.model.id ends with :cloud, even if names don't match exactly", () => {
  const stdin = { model: { id: "kimi-k2.6:cloud" } };
  const probe = {
    daemonOk: true,
    cloudModels: [{ name: "different:cloud", model: "different:cloud" } as any],
    fetchedAt: Date.now(), cloudModelsAt: Date.now(), host: "x",
  };
  expect(resolveMode(stdin as any, probe as any)).toBe("ollama");
});

test("resolveMode falls back to anthropic when cloudModels empty and no :cloud suffix", () => {
  const stdin = { model: { id: "kimi-k2" } };
  const probe = {
    daemonOk: true, cloudModels: [],
    fetchedAt: 0, cloudModelsAt: 0, host: "x",
  };
  expect(resolveMode(stdin as any, probe as any)).toBe("anthropic");
});
