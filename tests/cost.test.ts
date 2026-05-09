// tests/cost.test.ts
import { test, expect } from "bun:test";
import { resolveSessionCost, formatUsd } from "../src/cost.js";
import { costWidget } from "../src/render/widgets/cost.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { RenderContext, StdinData, SessionTokens } from "../src/types.js";

/** Helper: call costWidget.render(ctx) and return body or null */
function renderCost(ctx: RenderContext): string | null {
  const cell = costWidget.render(ctx);
  return cell ? cell.body : null;
}

function makeAnthropicCtx(): RenderContext {
  return {
    mode: "anthropic",
    stdin: {},
    transcript: { tools: [], agents: [], todos: [] },
    gitStatus: null,
    config: structuredClone(DEFAULT_CONFIG),
    usageData: null,
    costData: null,
    memoryInfo: null,
    cloudModels: [],
  };
}

test("uses native total_cost_usd when present", () => {
  const stdin: StdinData = { model: { id: "claude-opus-4-7" }, cost: { total_cost_usd: 0.42 } };
  const r = resolveSessionCost(stdin, undefined);
  expect(r?.totalUsd).toBeCloseTo(0.42);
  expect(r?.source).toBe("native");
});

test("estimates from sessionTokens when native cost missing", () => {
  const stdin: StdinData = { model: { display_name: "Opus 4.7" }, cost: null };
  const tokens: SessionTokens = { inputTokens: 1_000_000, outputTokens: 200_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const r = resolveSessionCost(stdin, tokens);
  // Opus 4: $15/M in, $75/M out → 15 + 15 = 30
  expect(r?.totalUsd).toBeCloseTo(30.0);
  expect(r?.source).toBe("estimate");
});

test("returns null for unknown model with no native cost", () => {
  const stdin: StdinData = { model: { id: "unknown-model" }, cost: null };
  const tokens: SessionTokens = { inputTokens: 100, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 };
  expect(resolveSessionCost(stdin, tokens)).toBeNull();
});

test("hides cost for Bedrock model ids", () => {
  const stdin: StdinData = { model: { id: "anthropic.claude-3-5-sonnet-20241022-v2:0" }, cost: { total_cost_usd: 1.5 } };
  expect(resolveSessionCost(stdin, undefined)).toBeNull();
});

test("formatUsd thresholds", () => {
  expect(formatUsd(2.5)).toBe("$2.50");
  expect(formatUsd(0.123)).toBe("$0.123");
  expect(formatUsd(0.012)).toBe("$0.0120");
});

test("renderCost: showCost=false + native > 0 → renders (extra-usage signal)", () => {
  const ctx = makeAnthropicCtx();
  ctx.config.display.showCost = false;
  ctx.costData = { totalUsd: 0.42, source: "native" };
  const out = renderCost(ctx);
  expect(out).not.toBeNull();
  expect(out).toContain("$0.42");
  expect(out).not.toContain("(est)");
});

test("renderCost: showCost=false + estimate → null (no extra-usage signal)", () => {
  const ctx = makeAnthropicCtx();
  ctx.config.display.showCost = false;
  ctx.costData = { totalUsd: 0.38, source: "estimate" };
  expect(renderCost(ctx)).toBeNull();
});

test("renderCost: showCost=false + costData null → null", () => {
  const ctx = makeAnthropicCtx();
  ctx.config.display.showCost = false;
  ctx.costData = null;
  expect(renderCost(ctx)).toBeNull();
});

test("renderCost: showCost=false + native = 0 → null (zero is not extra-usage)", () => {
  const ctx = makeAnthropicCtx();
  ctx.config.display.showCost = false;
  ctx.costData = { totalUsd: 0, source: "native" };
  expect(renderCost(ctx)).toBeNull();
});

test("renderCost: showCost=true + estimate → renders (explicit opt-in)", () => {
  const ctx = makeAnthropicCtx();
  ctx.config.display.showCost = true;
  ctx.costData = { totalUsd: 0.38, source: "estimate" };
  const out = renderCost(ctx);
  expect(out).not.toBeNull();
  expect(out).toContain("$0.380");
  expect(out).toContain("(est)");
});
