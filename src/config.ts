// src/config.ts
import { readFile } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    warningThreshold: 60,
    criticalThreshold: 75,
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
    glyphs: "auto",
    layout: "row",
    hush: { compactWhenIdle: true, hyperlinks: true, animate: true, motion: "subtle", density: "compact", identityColors: false, icon: "auto", thresholds: { warning: 60, danger: 75 } },
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
    daemonTtlSeconds: 5,
    cloudModelsTtlSeconds: 120,
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

function logParseError(configPath: string, message: string): void {
  try {
    const logDir = join(homedir(), ".claude/plugins/ohud");
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, "last-errors.log");
    const stamp = new Date().toISOString();
    appendFileSync(logPath, `[${stamp}] parse error: ${message} (file: ${configPath})\n`);
  } catch { /* best-effort */ }
}

export async function loadConfig(path: string): Promise<HudConfig> {
  const base = structuredClone(DEFAULT_CONFIG);
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return base; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logParseError(path, msg);
    return base;
  }
  return deepMerge(base, parsed);
}
