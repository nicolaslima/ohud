// src/config.ts
import { readFile } from "node:fs/promises";
import type { HudConfig } from "./types.js";

export const DEFAULT_CONFIG: HudConfig = {
  lineLayout: "expanded",
  pathLevels: 1,
  maxWidth: null,
  elementOrder: [
    "project", "context", "apiTime", "usage", "cost", "promptCache",
    "memory", "environment", "tools", "agents", "todos",
  ],
  display: {
    mergeGroups: [["context", "apiTime"], ["context", "usage"]],
    showModel: true,
    showContextBar: true,
    contextValue: "percent",
    showApiTime: true,
    showUsage: true,
    usageBarEnabled: true,
    usageCompact: false,
    showResetLabel: true,
    timeFormat: "relative",
    sevenDayThreshold: 80,
    externalUsagePath: "",
    externalUsageFreshnessMs: 300000,
    showCost: false,
    showPromptCache: false,
    promptCacheTtlSeconds: 300,
    showTools: false,
    showAgents: false,
    showTodos: false,
    showConfigCounts: false,
    showDuration: false,
    showSpeed: false,
    showMemoryUsage: false,
    showEffortLevel: true,
  },
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  colors: {
    context: "green",
    apiTime: "brightBlue",
    usage: "brightBlue",
    warning: "yellow",
    usageWarning: "brightMagenta",
    critical: "red",
    model: "cyan",
    project: "yellow",
    git: "magenta",
    gitBranch: "cyan",
    label: "dim",
  },
  ollama: {
    host: "http://localhost:11434",
    probeCacheTtlSeconds: 60,
    probeTimeoutMs: 500,
  },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== "object" || Array.isArray(override)) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[k];
    if (baseVal && typeof baseVal === "object" && !Array.isArray(baseVal)) {
      result[k] = deepMerge(baseVal, v);
    } else {
      result[k] = v;
    }
  }
  return result as T;
}

export async function loadConfig(path: string): Promise<HudConfig> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return DEFAULT_CONFIG; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return DEFAULT_CONFIG; }
  return deepMerge(DEFAULT_CONFIG, parsed);
}
