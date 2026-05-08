// src/cost.ts
import type { SessionCostDisplay, SessionTokens, StdinData } from "./types.js";

interface ModelPricing { inputUsdPerM: number; outputUsdPerM: number; }

// Pricing snapshot — verify against https://www.anthropic.com/pricing periodically.
// Last verified: 2026-05-08.
const PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
  { pattern: /\bopus 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 15, outputUsdPerM: 75 } },
  { pattern: /\bsonnet 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bsonnet 3 [57]\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bhaiku 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 1, outputUsdPerM: 5 } },
  { pattern: /\bhaiku 3 5\b/i, pricing: { inputUsdPerM: 0.8, outputUsdPerM: 4 } },
  { pattern: /\bopusplan\b/i, pricing: { inputUsdPerM: 15, outputUsdPerM: 75 } },
  { pattern: /\bsonnetplan\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bhaikuplan\b/i, pricing: { inputUsdPerM: 0.8, outputUsdPerM: 4 } },
];
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const TOKENS_PER_M = 1_000_000;

function normalize(name: string): string {
  return name.toLowerCase().replace(/^claude\s+/, "").replace(/\([^)]*\)/g, " ").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isBedrockModelId(id?: string): boolean {
  return !!id && id.toLowerCase().includes("anthropic.claude-");
}

export function isVertexModelId(id?: string): boolean {
  return !!id && id.includes("@");
}

function matchPricing(name: string): ModelPricing | null {
  const n = normalize(name);
  for (const e of PRICING) if (e.pattern.test(n)) return e.pricing;
  return null;
}

function estimate(stdin: StdinData, tokens: SessionTokens): number | null {
  const candidates = [stdin.model?.display_name, stdin.model?.id].filter((v): v is string => !!v);
  let pricing: ModelPricing | null = null;
  for (const c of candidates) { pricing = matchPricing(c); if (pricing) break; }
  if (!pricing) return null;
  const total = tokens.inputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens + tokens.outputTokens;
  if (total === 0) return null;
  const usd = (tokens.inputTokens * pricing.inputUsdPerM
    + tokens.cacheCreationTokens * pricing.inputUsdPerM * CACHE_WRITE_MULTIPLIER
    + tokens.cacheReadTokens * pricing.inputUsdPerM * CACHE_READ_MULTIPLIER
    + tokens.outputTokens * pricing.outputUsdPerM) / TOKENS_PER_M;
  return usd;
}

export function resolveSessionCost(stdin: StdinData, tokens: SessionTokens | undefined): SessionCostDisplay | null {
  if (isBedrockModelId(stdin.model?.id) || isVertexModelId(stdin.model?.id)) return null;
  const native = stdin.cost?.total_cost_usd;
  if (typeof native === "number" && Number.isFinite(native)) {
    return { totalUsd: native, source: "native" };
  }
  if (!tokens) return null;
  const est = estimate(stdin, tokens);
  if (est === null) return null;
  return { totalUsd: est, source: "estimate" };
}

export function formatUsd(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}
