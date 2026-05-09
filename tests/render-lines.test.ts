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
import { renderTodos } from "../src/render/lines/todos.js";
import { renderEnvironment } from "../src/render/lines/environment.js";
import { renderMemory } from "../src/render/lines/memory.js";
import { renderDuration } from "../src/render/lines/duration.js";
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

test("project line prefers project_dir basename over current_dir worktree slice", () => {
  const stdin: StdinData = {
    model: { id: "x", display_name: "x" },
    workspace: {
      project_dir: "/Users/me/code/claude-code",
      current_dir: "/Users/me/code/claude-code/.worktrees/release+setup-plugin-structure",
    },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.gitStatus = null;
  const out = renderProject(ctx);
  expect(out).toContain("claude-code");
  expect(out).not.toContain("release+setup-plugin-structure");
  expect(out).not.toContain(".worktrees");
});

test("project line falls back to current_dir basename when project_dir absent (pathLevels=1)", () => {
  const stdin: StdinData = {
    model: { id: "x", display_name: "x" },
    workspace: { current_dir: "/foo/bar/baz" },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.gitStatus = null;
  ctx.config.pathLevels = 1;
  const out = renderProject(ctx);
  expect(out).toContain("baz");
  expect(out).not.toContain("bar/baz");
});

test("project line falls back to current_dir when project_dir is empty string", () => {
  const stdin: StdinData = {
    model: { id: "x", display_name: "x" },
    workspace: { project_dir: "", current_dir: "/foo/bar/baz" },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.gitStatus = null;
  ctx.config.pathLevels = 1;
  const out = renderProject(ctx);
  expect(out).toContain("baz");
});

test("project line falls back to current_dir when project_dir is just root", () => {
  const stdin: StdinData = {
    model: { id: "x", display_name: "x" },
    workspace: { project_dir: "/", current_dir: "/foo/bar/baz" },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.gitStatus = null;
  ctx.config.pathLevels = 1;
  const out = renderProject(ctx);
  expect(out).toContain("baz");
});

test("project line — pathLevels=2 still applies in current_dir fallback", () => {
  const stdin: StdinData = {
    model: { id: "x", display_name: "x" },
    workspace: { current_dir: "/foo/bar/baz" },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.gitStatus = null;
  ctx.config.pathLevels = 2;
  const out = renderProject(ctx);
  expect(out).toContain("bar/baz");
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

test("api-time line in ollama mode uses total_api_duration_ms", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.stdin.cost = { total_api_duration_ms: 75_000 };
  const out = renderApiTime(ctx);
  expect(out).toContain("API");
  expect(out).toContain("⏱");
  expect(out).toContain("1m 15s");
});

test("api-time line returns null when no API duration available", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.stdin.cost = {};
  expect(renderApiTime(ctx)).toBeNull();
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

test("cost line null when toggle off and only estimate available", () => {
  // showCost=false (default) hides estimates; only native cost > 0 auto-shows.
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.costData = { totalUsd: 0.42, source: "estimate" };
  expect(renderCost(ctx)).toBeNull();
});

test("cost line auto-shows on extra-usage (toggle off + native > 0)", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.costData = { totalUsd: 0.42, source: "native" };
  const out = renderCost(ctx);
  expect(out).toContain("$0.42");
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

test("tools line dedups N parallel running tools with same target — `Edit ×N: foo.ts`", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTools = true;
  ctx.transcript.tools = [
    { id: "1", name: "Edit", target: "foo.ts", status: "running", startTime: new Date() },
    { id: "2", name: "Edit", target: "foo.ts", status: "running", startTime: new Date() },
    { id: "3", name: "Edit", target: "foo.ts", status: "running", startTime: new Date() },
  ];
  const out = renderTools(ctx) ?? "";
  expect(out).toContain("Edit ×3");
  expect(out).toContain("foo.ts");
  // Only one Edit running entry (not three).
  const editMatches = out.match(/Edit/g) ?? [];
  expect(editMatches.length).toBe(1);
});

test("tools line drops target when N parallel tools have different targets — `Edit ×N`", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTools = true;
  ctx.transcript.tools = [
    { id: "1", name: "Edit", target: "foo.ts", status: "running", startTime: new Date() },
    { id: "2", name: "Edit", target: "bar.ts", status: "running", startTime: new Date() },
  ];
  const out = renderTools(ctx) ?? "";
  expect(out).toContain("Edit ×2");
  expect(out).not.toContain("foo.ts");
  expect(out).not.toContain("bar.ts");
});

test("tools line keeps separate entries for distinct tool names", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTools = true;
  ctx.transcript.tools = [
    { id: "1", name: "Edit", target: "foo.ts", status: "running", startTime: new Date() },
    { id: "2", name: "Read", target: "bar.ts", status: "running", startTime: new Date() },
  ];
  const out = renderTools(ctx) ?? "";
  expect(out).toContain("Edit");
  expect(out).toContain("Read");
  expect(out).toContain("foo.ts");
  expect(out).toContain("bar.ts");
  expect(out).not.toContain("×");
});

test("tools line — single running, no target → just glyph + name", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTools = true;
  ctx.transcript.tools = [
    { id: "1", name: "Skill", status: "running", startTime: new Date() },
  ];
  const out = renderTools(ctx) ?? "";
  expect(out).toContain("Skill");
  expect(out).not.toContain("×");
  expect(out).not.toContain(":");
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
  // Single running → single line (backward compat).
  expect(out!.split("\n").length).toBe(1);
});

test("agents line — 2 running agents emit 2 lines", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  ctx.transcript.agents = [
    { id: "1", type: "explore", description: "A", status: "running", startTime: new Date() },
    { id: "2", type: "review", description: "B", status: "running", startTime: new Date() },
  ];
  const out = renderAgents(ctx) ?? "";
  const lines = out.split("\n");
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain("explore");
  expect(lines[0]).toContain("A");
  expect(lines[1]).toContain("review");
  expect(lines[1]).toContain("B");
});

test("agents line — 3 running + 2 completed → 3 running lines + 1 completed-summary line", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  ctx.transcript.agents = [
    { id: "1", type: "explore", status: "running", startTime: new Date() },
    { id: "2", type: "review", status: "running", startTime: new Date() },
    { id: "3", type: "debug", status: "running", startTime: new Date() },
    { id: "4", type: "explore", status: "completed", startTime: new Date(), endTime: new Date() },
    { id: "5", type: "explore", status: "completed", startTime: new Date(), endTime: new Date() },
  ];
  const out = renderAgents(ctx) ?? "";
  const lines = out.split("\n");
  expect(lines.length).toBe(4);
  expect(lines[3]).toContain("explore ×2");
});

test("agents line — 0 running + 3 completed → single completed-summary line", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  ctx.transcript.agents = [
    { id: "1", type: "explore", status: "completed", startTime: new Date(), endTime: new Date() },
    { id: "2", type: "explore", status: "completed", startTime: new Date(), endTime: new Date() },
    { id: "3", type: "review", status: "completed", startTime: new Date(), endTime: new Date() },
  ];
  const out = renderAgents(ctx) ?? "";
  const lines = out.split("\n");
  expect(lines.length).toBe(1);
  expect(out).toContain("explore ×2");
  expect(out).toContain("review");
});

test("agents line null with no agents", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  expect(renderAgents(ctx)).toBeNull();
});

test("todos line shows in-progress + counts", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTodos = true;
  ctx.transcript.todos = [
    { content: "Fix auth bug", status: "in_progress" },
    { content: "Write tests", status: "pending" },
    { content: "Update docs", status: "completed" },
  ];
  const out = renderTodos(ctx);
  expect(out).toContain("Fix auth bug");
  expect(out).toContain("(1/3)");
});

test("todos line null when no todos", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showTodos = true;
  expect(renderTodos(ctx)).toBeNull();
});

test("environment line null when toggle off", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  expect(renderEnvironment(ctx)).toBeNull();
});

test("environment line shows zero when nothing found", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  stdin.workspace = { current_dir: "/tmp/nonexistent-dir-for-test" };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showConfigCounts = true;
  const out = renderEnvironment(ctx);
  expect(out).toContain("CLAUDE.md");
});

test("memory line null when toggle off", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  expect(renderMemory(ctx)).toBeNull();
});

test("memory line renders when memoryInfo provided", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryInfo = { totalBytes: 32_000_000_000, usedBytes: 12_300_000_000, freeBytes: 19_700_000_000, usedPercent: 38 };
  const out = renderMemory(ctx);
  expect(out).toContain("RAM");
  expect(out).toContain("38%");
});

test("context line uses warning color at 60% (new threshold)", () => {
  const stdin: StdinData = {
    context_window: { used_percentage: 60, context_window_size: 200_000, total_input_tokens: 120_000 },
  };
  const ctx = makeCtx(stdin, "anthropic");
  // default colors: warning=yellow → ANSI \x1b[33m
  const out = renderContext(ctx);
  expect(out).toContain("\x1b[33m"); // yellow
  expect(out).not.toContain("\x1b[31m"); // not red
});

test("context line uses critical color at 75% (new threshold)", () => {
  const stdin: StdinData = {
    context_window: { used_percentage: 75, context_window_size: 200_000, total_input_tokens: 150_000 },
  };
  const ctx = makeCtx(stdin, "anthropic");
  const out = renderContext(ctx);
  expect(out).toContain("\x1b[31m"); // red
});

test("context line uses default color below 60% (new threshold)", () => {
  const stdin: StdinData = {
    context_window: { used_percentage: 59, context_window_size: 200_000, total_input_tokens: 118_000 },
  };
  const ctx = makeCtx(stdin, "anthropic");
  const out = renderContext(ctx);
  expect(out).toContain("\x1b[32m"); // green (context default)
  expect(out).not.toContain("\x1b[33m"); // not yellow
  expect(out).not.toContain("\x1b[31m"); // not red
});

test("usage line uses usageWarning color at 60% (new threshold)", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 60, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null };
  const out = renderUsage(ctx);
  // brightMagenta = \x1b[95m
  expect(out).toContain("\x1b[95m");
  expect(out).not.toContain("\x1b[31m"); // not red
});

test("usage line uses critical color at 75% (new threshold)", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 75, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null };
  const out = renderUsage(ctx);
  expect(out).toContain("\x1b[31m"); // red
});

test("memory line uses warning color at 65%", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryInfo = { totalBytes: 16_000_000_000, usedBytes: 10_400_000_000, freeBytes: 5_600_000_000, usedPercent: 65 };
  const out = renderMemory(ctx);
  expect(out).toContain("\x1b[33m"); // yellow (warning)
  expect(out).not.toContain("\x1b[31m"); // not red
});

test("memory line uses critical color at 76%", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryInfo = { totalBytes: 16_000_000_000, usedBytes: 12_160_000_000, freeBytes: 3_840_000_000, usedPercent: 76 };
  const out = renderMemory(ctx);
  expect(out).toContain("\x1b[31m"); // red (critical)
});

test("memory line uses default color below threshold (38%)", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryInfo = { totalBytes: 32_000_000_000, usedBytes: 12_300_000_000, freeBytes: 19_700_000_000, usedPercent: 38 };
  const out = renderMemory(ctx);
  // brightBlue = \x1b[94m (usage default)
  expect(out).toContain("\x1b[94m");
  expect(out).not.toContain("\x1b[33m"); // not yellow
  expect(out).not.toContain("\x1b[31m"); // not red
});

test("custom warningThreshold flows through to context renderer", () => {
  const stdin: StdinData = {
    context_window: { used_percentage: 50, context_window_size: 200_000, total_input_tokens: 100_000 },
  };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.warningThreshold = 40;
  ctx.config.display.criticalThreshold = 90;
  const out = renderContext(ctx);
  expect(out).toContain("\x1b[33m"); // yellow at 50% with warning=40
});

test("duration line shows session time", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  stdin.cost = { total_duration_ms: 5 * 60_000 };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showDuration = true;
  const out = renderDuration(ctx);
  expect(out).toContain("⏱");
  expect(out).toContain("5m");
});

test("duration line null when toggle off", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  expect(renderDuration(ctx)).toBeNull();
});

test("project line includes effort level when showEffortLevel and effortLevel set", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showEffortLevel = true;
  ctx.effortLevel = "max";
  const out = renderProject(ctx);
  expect(out).toContain("max");
  expect(out).toContain("effort:");
});

test("git block includes ahead/behind when showAheadBehind", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.gitStatus.showAheadBehind = true;
  ctx.gitStatus = { branch: "main", dirty: false, ahead: 3, behind: 1 };
  const out = renderProject(ctx);
  expect(out).toMatch(/main.*↑3.*↓1/);
});

test("git block omits ahead/behind when both zero", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.gitStatus.showAheadBehind = true;
  ctx.gitStatus = { branch: "main", dirty: false, ahead: 0, behind: 0 };
  const out = renderProject(ctx);
  expect(out).not.toContain("↑");
  expect(out).not.toContain("↓");
});

test("usage line shows reset label when showResetLabel + timeFormat=relative", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showUsage = true;
  ctx.config.display.showResetLabel = true;
  ctx.config.display.timeFormat = "relative";
  ctx.config.display.usageBarEnabled = false;
  ctx.usageData = {
    fiveHour: 50, sevenDay: null,
    fiveHourResetAt: new Date(Date.now() + 3_600_000),
    sevenDayResetAt: null,
  };
  const out = renderUsage(ctx);
  expect(out).toMatch(/resets in/);
  expect(out).toMatch(/~1h|~59m/);
});

test("usage line omits reset label when showResetLabel=false", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showUsage = true;
  ctx.config.display.showResetLabel = false;
  ctx.config.display.timeFormat = "relative";
  ctx.config.display.usageBarEnabled = false;
  ctx.usageData = {
    fiveHour: 50, sevenDay: null,
    fiveHourResetAt: new Date(Date.now() + 3_600_000),
    sevenDayResetAt: null,
  };
  const out = renderUsage(ctx);
  expect(out).not.toMatch(/resets/);
});

// Integration tests for render orchestrator
import { render } from "../src/render/index.js";

test("render orchestrator emits multi-line output for ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.stdin.cost = { total_api_duration_ms: 120_000 };
  const out = render(ctx);
  expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
  expect(out).toContain("Context");
  expect(out).toContain("API");
});

test("render orchestrator falls back to anthropic mode", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null };
  const out = render(ctx);
  expect(out).toContain("Context");
  expect(out).toContain("Usage");
});

test("render orchestrator splits multi-line renderer output into separate lines", () => {
  // Agents renderer returns "line1\nline2" when 2+ running agents — orchestrator
  // must split on `\n` so each becomes an independent (truncatable) line.
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showAgents = true;
  ctx.transcript.agents = [
    { id: "1", type: "explore", description: "AAAA", status: "running", startTime: new Date() },
    { id: "2", type: "review", description: "BBBB", status: "running", startTime: new Date() },
  ];
  const out = render(ctx);
  const agentLines = out.split("\n").filter((l) => l.includes("explore") || l.includes("review"));
  // explore and review must each be on their own line.
  expect(agentLines.length).toBe(2);
  expect(agentLines.some((l) => l.includes("explore") && !l.includes("review"))).toBe(true);
  expect(agentLines.some((l) => l.includes("review") && !l.includes("explore"))).toBe(true);
});

test("render returns minimum line (model name) when all renderers null", () => {
  const stdin: StdinData = { model: { display_name: "claude" }, workspace: {} };
  const ctx = makeCtx(stdin, "anthropic");
  ctx.config.display.showModel = false;
  ctx.config.display.showContextBar = false;
  ctx.config.display.showApiTime = false;
  ctx.config.display.showUsage = false;
  ctx.config.display.showCost = false;
  ctx.config.display.showPromptCache = false;
  ctx.config.display.showTools = false;
  ctx.config.display.showAgents = false;
  ctx.config.display.showTodos = false;
  ctx.config.display.showDuration = false;
  ctx.config.display.showSpeed = false;
  ctx.config.display.showMemoryUsage = false;
  ctx.config.display.showEffortLevel = false;
  ctx.config.gitStatus.enabled = false;
  const out = render(ctx);
  expect(out.length).toBeGreaterThan(0);
  expect(out).toContain("ohud");
});
