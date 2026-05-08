// tests/render-lines.test.ts
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProject } from "../src/render/lines/project.js";
import { renderContext } from "../src/render/lines/context.js";
import { renderApiTime } from "../src/render/lines/api-time.js";
import { renderUsage } from "../src/render/lines/usage.js";
import { renderCost } from "../src/render/lines/cost.js";
import { renderPromptCache } from "../src/render/lines/prompt-cache.js";
import { renderTools } from "../src/render/lines/tools.js";
import { renderAgents } from "../src/render/lines/agents.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { RenderContext, StdinData } from "../src/types.js";

const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", n), "utf8")) as StdinData;

function makeCtx(stdin: StdinData, mode: "ollama" | "anthropic"): RenderContext {
  return {
    mode, stdin,
    transcript: { tools: [], agents: [], todos: [] },
    gitStatus: { branch: "main", dirty: true, ahead: 0, behind: 0 },
    config: structuredClone(DEFAULT_CONFIG),
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

test("api-time line in ollama mode with totalDurationNs", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.transcript.totalDurationNs = 12 * 60 * 1_000_000_000 + 30 * 1_000_000_000;
  const out = renderApiTime(ctx);
  expect(out).toContain("GPU");
  expect(out).toContain("12m 30s");
});

test("api-time line falls back to API time when transcript empty", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.stdin.cost = { total_api_duration_ms: 75_000 };
  const out = renderApiTime(ctx);
  expect(out).toContain("API");
  expect(out).toContain("1m 15s");
});

test("api-time line null in anthropic mode", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  expect(renderApiTime(makeCtx(stdin, "anthropic"))).toBeNull();
});

test("usage line — bar with 5h", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 25, sevenDay: 41, fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000), sevenDayResetAt: null };
  const out = renderUsage(ctx);
  expect(out).toContain("Usage");
  expect(out).toContain("25%");
});

test("usage line — null in ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  expect(renderUsage(ctx)).toBeNull();
});

test("usage line — null when usageData missing", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  expect(renderUsage(ctx)).toBeNull();
});

test("usage line — adds 7d when above threshold", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 50, sevenDay: 90, fiveHourResetAt: null, sevenDayResetAt: null };
  ctx.config.display.sevenDayThreshold = 80;
  const out = renderUsage(ctx);
  expect(out).toContain("90%");
});

test("cost line shows native value", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showCost = true;
  ctx.costData = { totalUsd: 0.42, source: "native" };
  const out = renderCost(ctx);
  expect(out).toContain("$0.42");
});

test("cost line null when toggle off", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.costData = { totalUsd: 0.42, source: "native" };
  expect(renderCost(ctx)).toBeNull();
});

test("cost line null in ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.config.display.showCost = true;
  ctx.costData = { totalUsd: 0.42, source: "native" };
  expect(renderCost(ctx)).toBeNull();
});

test("prompt cache line — anthropic mode opt-in", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showPromptCache = true;
  ctx.transcript.lastAssistantResponseAt = new Date(Date.now() - 60_000);
  const out = renderPromptCache(ctx);
  expect(out).toContain("cache");
  expect(out).toMatch(/\d+m \d+s|\d+s/);
});

test("prompt cache line null in ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.config.display.showPromptCache = true;
  expect(renderPromptCache(ctx)).toBeNull();
});

test("tools line shows running and counts of completed", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTools = true;
  ctx.transcript.tools = [
    { id: "1", name: "Edit", target: "auth.ts", status: "running", startTime: new Date() },
    { id: "2", name: "Read", status: "completed", startTime: new Date() },
    { id: "3", name: "Read", status: "completed", startTime: new Date() },
    { id: "4", name: "Read", status: "completed", startTime: new Date() },
  ];
  const out = renderTools(ctx);
  expect(out).toContain("Edit");
  expect(out).toContain("auth.ts");
  expect(out).toContain("Read ×3");
});

test("tools line null when toggle off", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  expect(renderTools(ctx)).toBeNull();
});

test("agents line shows running agent", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  ctx.transcript.agents = [
    { id: "1", type: "explore", description: "Finding auth code", model: "haiku", status: "running", startTime: new Date(Date.now() - 90_000) },
  ];
  const out = renderAgents(ctx);
  expect(out).toContain("explore");
  expect(out).toContain("haiku");
  expect(out).toContain("Finding auth code");
});

test("agents line null with no agents", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  expect(renderAgents(ctx)).toBeNull();
});
