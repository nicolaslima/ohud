// tests/render-lines.test.ts
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProject } from "../src/render/lines/project.js";
import { renderContext } from "../src/render/lines/context.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { RenderContext, StdinData } from "../src/types.js";

const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", n), "utf8")) as StdinData;

function makeCtx(stdin: StdinData, mode: "ollama" | "anthropic"): RenderContext {
  return {
    mode, stdin,
    transcript: { tools: [], agents: [], todos: [] },
    gitStatus: { branch: "main", dirty: true, ahead: 0, behind: 0 },
    config: DEFAULT_CONFIG,
    usageData: null, costData: null, memoryInfo: null, cloudModels: [],
  };
}

test("project line — ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const out = renderProject(makeCtx(stdin, "ollama"));
  expect(out).toContain("glm-5:cloud");
  expect(out).toContain("ohud");
  expect(out).toContain("main");
  expect(out).toContain("*"); // dirty marker
});

test("project line — anthropic mode", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const out = renderProject(makeCtx(stdin, "anthropic"));
  expect(out).toContain("Opus");
  expect(out).toContain("ohud");
});

test("context line — under threshold", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const out = renderContext(makeCtx(stdin, "anthropic"));
  expect(out).toContain("Context");
  expect(out).toContain("45%");
});

test("context line — empty when used_percentage missing", () => {
  const stdin: StdinData = { context_window: {} };
  const out = renderContext(makeCtx(stdin, "anthropic"));
  expect(out).toBeNull();
});
