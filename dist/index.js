import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";

// src/stdin.ts
var DEFAULT_FIRST_BYTE_TIMEOUT_MS = 250;
var DEFAULT_IDLE_TIMEOUT_MS = 30;
var DEFAULT_MAX_BYTES = 256 * 1024;
async function readStdin(stream = process.stdin, options = {}) {
  if (stream.isTTY)
    return null;
  const firstByteTimeout = options.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    stream.setEncoding("utf8");
  } catch {
    return null;
  }
  return await new Promise((resolve) => {
    let raw = "";
    let settled = false;
    let firstByteTimer;
    let idleTimer;
    const cleanup = () => {
      if (firstByteTimer)
        clearTimeout(firstByteTimer);
      if (idleTimer)
        clearTimeout(idleTimer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      try {
        stream.pause();
      } catch {}
    };
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const tryParse = () => {
      const trimmed = raw.trim();
      if (!trimmed)
        return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    };
    const scheduleIdleParse = () => {
      if (idleTimer)
        clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(tryParse()), idleTimeout);
    };
    const onData = (chunk) => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = undefined;
      }
      raw += String(chunk);
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        finish(null);
        return;
      }
      scheduleIdleParse();
    };
    const onEnd = () => finish(tryParse());
    const onError = () => finish(null);
    firstByteTimer = setTimeout(() => finish(null), firstByteTimeout);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

// src/ollama-probe.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function probeCachePath(sessionId) {
  return join(tmpdir(), `ohud-probe-${sessionId}.json`);
}
async function fetchWithTimeout(url, timeoutMs, fetchImpl) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function readCache(path, ttlMs) {
  if (!existsSync(path))
    return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > ttlMs)
      return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeCache(path, data) {
  try {
    writeFileSync(path, JSON.stringify(data));
  } catch {}
}
async function probeOllama(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = probeCachePath(opts.sessionId);
  const ttlMs = opts.ttlSeconds * 1000;
  const cached = readCache(cachePath, ttlMs);
  if (cached)
    return cached;
  const versionRes = await fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl);
  if (!versionRes || !versionRes.ok) {
    const result2 = { daemonOk: false, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result2);
    return result2;
  }
  const tagsRes = await fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl);
  if (!tagsRes || !tagsRes.ok) {
    const result2 = { daemonOk: true, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result2);
    return result2;
  }
  let parsed = {};
  try {
    parsed = await tagsRes.json();
  } catch {}
  const cloudModels = (parsed.models ?? []).filter((m) => typeof m.remote_host === "string" && m.remote_host.length > 0);
  const result = { daemonOk: true, cloudModels, fetchedAt: Date.now() };
  writeCache(cachePath, result);
  return result;
}

// src/mode.ts
function resolveMode(stdin, probe) {
  if (!probe.daemonOk)
    return "anthropic";
  if (probe.cloudModels.length === 0)
    return "anthropic";
  const candidates = [stdin.model?.id, stdin.model?.display_name].filter((v) => typeof v === "string" && v.length > 0);
  if (candidates.length === 0)
    return "anthropic";
  const cloudNames = new Set(probe.cloudModels.flatMap((m) => [m.name, m.model]));
  const isCloud = candidates.some((c) => cloudNames.has(c));
  return isCloud ? "ollama" : "anthropic";
}

// src/transcript.ts
import { readFile } from "node:fs/promises";
async function parseTranscript(path) {
  const empty = { tools: [], agents: [], todos: [] };
  if (!path)
    return empty;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return empty;
  }
  const lines = raw.split(`
`).filter((l) => l.length > 0);
  const tools = new Map;
  const agents = new Map;
  let latestTodos = [];
  const tokens = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0
  };
  let totalDurationNs = 0;
  let totalEvalCount = 0;
  let totalEvalDurationNs = 0;
  let sawOllamaTiming = false;
  let sessionStart;
  let lastAssistantResponseAt;
  let sessionName;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const type = entry.type;
    const ts = typeof entry.timestamp === "string" ? new Date(entry.timestamp) : undefined;
    if (ts && !sessionStart)
      sessionStart = ts;
    if (type === "summary" && typeof entry.summary === "string") {
      sessionName = entry.summary;
      continue;
    }
    if (type !== "assistant" && type !== "user")
      continue;
    const message = entry.message;
    if (!message)
      continue;
    if (type === "assistant" && message.usage) {
      tokens.inputTokens += Number(message.usage.input_tokens ?? 0);
      tokens.outputTokens += Number(message.usage.output_tokens ?? 0);
      tokens.cacheCreationTokens += Number(message.usage.cache_creation_input_tokens ?? 0);
      tokens.cacheReadTokens += Number(message.usage.cache_read_input_tokens ?? 0);
      if (ts)
        lastAssistantResponseAt = ts;
      const found = findOllamaTiming(entry);
      if (found.total_duration) {
        totalDurationNs += found.total_duration;
        sawOllamaTiming = true;
      }
      if (found.eval_count)
        totalEvalCount += found.eval_count;
      if (found.eval_duration)
        totalEvalDurationNs += found.eval_duration;
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block !== "object" || block === null)
          continue;
        const b = block;
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          if (b.name === "TodoWrite" && b.input && typeof b.input === "object") {
            const inp = b.input;
            if (Array.isArray(inp.todos))
              latestTodos = inp.todos;
          } else if (b.name === "Task" && b.input && typeof b.input === "object") {
            const inp = b.input;
            agents.set(b.id, {
              id: b.id,
              type: inp.subagent_type ?? "agent",
              description: inp.description,
              model: inp.model,
              status: "running",
              startTime: ts ?? new Date
            });
          } else {
            tools.set(b.id, {
              id: b.id,
              name: b.name,
              target: extractTarget(b.input),
              status: "running",
              startTime: ts ?? new Date
            });
          }
        }
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          const tool = tools.get(b.tool_use_id);
          if (tool) {
            tool.status = "completed";
            tool.endTime = ts;
          }
          const agent = agents.get(b.tool_use_id);
          if (agent) {
            agent.status = "completed";
            agent.endTime = ts;
          }
        }
      }
    }
  }
  const result = {
    tools: [...tools.values()],
    agents: [...agents.values()],
    todos: latestTodos,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined
  };
  if (sawOllamaTiming) {
    result.totalDurationNs = totalDurationNs;
    result.totalEvalCount = totalEvalCount;
    result.totalEvalDurationNs = totalEvalDurationNs;
  }
  return result;
}
function extractTarget(input) {
  if (typeof input !== "object" || input === null)
    return;
  const i = input;
  if (typeof i.file_path === "string")
    return i.file_path;
  if (typeof i.path === "string")
    return i.path;
  if (typeof i.command === "string")
    return i.command;
  if (typeof i.pattern === "string")
    return i.pattern;
  return;
}
function findOllamaTiming(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== "object")
    return {};
  if (Array.isArray(obj)) {
    return obj.reduce((acc2, v) => mergeTiming(acc2, findOllamaTiming(v, depth + 1)), {});
  }
  const o = obj;
  let acc = {};
  if (typeof o.total_duration === "number")
    acc.total_duration = o.total_duration;
  if (typeof o.eval_count === "number")
    acc.eval_count = o.eval_count;
  if (typeof o.eval_duration === "number")
    acc.eval_duration = o.eval_duration;
  for (const v of Object.values(o))
    acc = mergeTiming(acc, findOllamaTiming(v, depth + 1));
  return acc;
}
function mergeTiming(a, b) {
  return {
    total_duration: a.total_duration ?? b.total_duration,
    eval_count: a.eval_count ?? b.eval_count,
    eval_duration: a.eval_duration ?? b.eval_duration
  };
}

// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var exec = promisify(execFile);
async function git(cwd, args) {
  try {
    const { stdout } = await exec("git", args, { cwd, timeout: 1000 });
    return stdout;
  } catch {
    return null;
  }
}
async function getGitStatus(cwd) {
  if (!cwd)
    return null;
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside)
    return null;
  const branch = (await git(cwd, ["branch", "--show-current"]))?.trim() ?? "";
  const status = await git(cwd, ["status", "--porcelain=v1"]);
  const dirty = !!(status && status.trim().length > 0);
  let ahead = 0;
  let behind = 0;
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (counts) {
    const [b, a] = counts.trim().split(/\s+/).map(Number);
    if (Number.isFinite(a))
      ahead = a;
    if (Number.isFinite(b))
      behind = b;
  }
  return { branch, dirty, ahead, behind };
}

// src/config.ts
import { readFile as readFile2 } from "node:fs/promises";
var DEFAULT_CONFIG = {
  lineLayout: "expanded",
  pathLevels: 1,
  maxWidth: null,
  elementOrder: [
    "project",
    "context",
    "apiTime",
    "usage",
    "cost",
    "promptCache",
    "memory",
    "environment",
    "tools",
    "agents",
    "todos"
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
    showOutputStyle: false,
    showDuration: false,
    showSpeed: false,
    showMemoryUsage: false,
    showTokenBreakdown: true,
    showSessionName: false,
    showClaudeCodeVersion: false,
    showEffortLevel: true
  },
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
    showFileStats: false,
    branchOverflow: "truncate"
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
    label: "dim"
  },
  ollama: {
    host: "http://localhost:11434",
    probeCacheTtlSeconds: 60,
    probeTimeoutMs: 500
  }
};
function deepMerge(base, override) {
  if (override === null || typeof override !== "object" || Array.isArray(override))
    return base;
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const baseVal = base[k];
    if (baseVal && typeof baseVal === "object" && !Array.isArray(baseVal)) {
      result[k] = deepMerge(baseVal, v);
    } else {
      result[k] = v;
    }
  }
  return result;
}
async function loadConfig(path) {
  let raw;
  try {
    raw = await readFile2(path, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
  return deepMerge(DEFAULT_CONFIG, parsed);
}

// src/usage.ts
import { readFile as readFile3 } from "node:fs/promises";
function clamp(p) {
  if (typeof p !== "number" || !Number.isFinite(p))
    return null;
  return Math.round(Math.min(100, Math.max(0, p)));
}
function epochToDate(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
    return null;
  return new Date(v * 1000);
}
function isoToDate(v) {
  if (v == null)
    return null;
  if (typeof v === "number")
    return epochToDate(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fromStdin(stdin) {
  const rl = stdin.rate_limits;
  if (!rl)
    return null;
  const five = clamp(rl.five_hour?.used_percentage);
  const seven = clamp(rl.seven_day?.used_percentage);
  if (five === null && seven === null)
    return null;
  return {
    fiveHour: five,
    sevenDay: seven,
    fiveHourResetAt: epochToDate(rl.five_hour?.resets_at),
    sevenDayResetAt: epochToDate(rl.seven_day?.resets_at)
  };
}
async function fromExternalSnapshot(path, freshnessMs, now = Date.now) {
  if (!path)
    return null;
  let raw;
  try {
    raw = await readFile3(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const updatedAt = isoToDate(parsed.updated_at ?? null);
  if (!updatedAt)
    return null;
  if (now() - updatedAt.getTime() > freshnessMs)
    return null;
  const five = clamp(parsed.five_hour?.used_percentage);
  const seven = clamp(parsed.seven_day?.used_percentage);
  if (five === null && seven === null)
    return null;
  return {
    fiveHour: five,
    sevenDay: seven,
    fiveHourResetAt: isoToDate(parsed.five_hour?.resets_at ?? null),
    sevenDayResetAt: isoToDate(parsed.seven_day?.resets_at ?? null)
  };
}

// src/cost.ts
var PRICING = [
  { pattern: /\bopus 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 15, outputUsdPerM: 75 } },
  { pattern: /\bsonnet 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bsonnet 3 [57]\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bhaiku 4(?: \d+)?\b/i, pricing: { inputUsdPerM: 1, outputUsdPerM: 5 } },
  { pattern: /\bhaiku 3 5\b/i, pricing: { inputUsdPerM: 0.8, outputUsdPerM: 4 } },
  { pattern: /\bopusplan\b/i, pricing: { inputUsdPerM: 15, outputUsdPerM: 75 } },
  { pattern: /\bsonnetplan\b/i, pricing: { inputUsdPerM: 3, outputUsdPerM: 15 } },
  { pattern: /\bhaikuplan\b/i, pricing: { inputUsdPerM: 0.8, outputUsdPerM: 4 } }
];
var CACHE_WRITE_MULTIPLIER = 1.25;
var CACHE_READ_MULTIPLIER = 0.1;
var TOKENS_PER_M = 1e6;
function normalize(name) {
  return name.toLowerCase().replace(/^claude\s+/, "").replace(/\([^)]*\)/g, " ").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}
function isBedrockModelId(id) {
  return !!id && id.toLowerCase().includes("anthropic.claude-");
}
function isVertexModelId(id) {
  return !!id && id.includes("@");
}
function matchPricing(name) {
  const n = normalize(name);
  for (const e of PRICING)
    if (e.pattern.test(n))
      return e.pricing;
  return null;
}
function estimate(stdin, tokens) {
  const candidates = [stdin.model?.display_name, stdin.model?.id].filter((v) => !!v);
  let pricing = null;
  for (const c of candidates) {
    pricing = matchPricing(c);
    if (pricing)
      break;
  }
  if (!pricing)
    return null;
  const total = tokens.inputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens + tokens.outputTokens;
  if (total === 0)
    return null;
  const usd = (tokens.inputTokens * pricing.inputUsdPerM + tokens.cacheCreationTokens * pricing.inputUsdPerM * CACHE_WRITE_MULTIPLIER + tokens.cacheReadTokens * pricing.inputUsdPerM * CACHE_READ_MULTIPLIER + tokens.outputTokens * pricing.outputUsdPerM) / TOKENS_PER_M;
  return usd;
}
function resolveSessionCost(stdin, tokens) {
  if (isBedrockModelId(stdin.model?.id) || isVertexModelId(stdin.model?.id))
    return null;
  const native = stdin.cost?.total_cost_usd;
  if (typeof native === "number" && Number.isFinite(native)) {
    return { totalUsd: native, source: "native" };
  }
  if (!tokens)
    return null;
  const est = estimate(stdin, tokens);
  if (est === null)
    return null;
  return { totalUsd: est, source: "estimate" };
}
function formatUsd(amount) {
  if (amount >= 1)
    return `$${amount.toFixed(2)}`;
  if (amount >= 0.1)
    return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

// src/memory.ts
import { freemem, totalmem } from "node:os";
function getMemoryUsage() {
  const total = totalmem();
  const free = freemem();
  const used = Math.max(0, total - free);
  const usedPercent = total > 0 ? Math.round(used / total * 100) : 0;
  return { totalBytes: total, usedBytes: used, freeBytes: free, usedPercent };
}

// src/effort.ts
function resolveEffortLevel(effort) {
  if (effort == null)
    return;
  if (typeof effort === "string")
    return effort.toLowerCase();
  if (typeof effort === "object" && typeof effort.level === "string")
    return effort.level.toLowerCase();
  return;
}

// src/render/colors.ts
var RESET = "\x1B[0m";
var NAMED = {
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  brightBlue: "\x1B[94m",
  brightMagenta: "\x1B[95m"
};
function color(spec, text) {
  if (NAMED[spec])
    return `${NAMED[spec]}${text}${RESET}`;
  if (/^\d+$/.test(spec)) {
    const n = Number.parseInt(spec, 10);
    if (n >= 0 && n <= 255)
      return `\x1B[38;5;${n}m${text}${RESET}`;
  }
  const m = /^#([0-9a-f]{6})$/i.exec(spec);
  if (m) {
    const hex = m[1];
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `\x1B[38;2;${r};${g};${b}m${text}${RESET}`;
  }
  return text;
}

// src/render/lines/project.ts
function renderProject(ctx) {
  const c = ctx.config;
  const modelLabel = modelBadge(ctx);
  const projectLabel = projectPath(ctx);
  const gitLabel = gitBlock(ctx);
  const parts = [];
  if (c.display.showModel && modelLabel)
    parts.push(color(c.colors.model, `[${modelLabel}]`));
  if (projectLabel)
    parts.push(color(c.colors.project, projectLabel));
  if (gitLabel)
    parts.push(gitLabel);
  return parts.join(color(c.colors.label, " │ "));
}
function modelBadge(ctx) {
  const name = ctx.stdin.model?.display_name ?? ctx.stdin.model?.id ?? "model";
  if (ctx.mode !== "ollama")
    return name;
  const cloudInfo = ctx.cloudModels.find((m) => m.name === ctx.stdin.model?.id || m.model === ctx.stdin.model?.id);
  const param = cloudInfo?.details?.parameter_size;
  return param ? `${name} ⚡ ${param}` : name;
}
function projectPath(ctx) {
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd ?? "";
  if (!dir)
    return "";
  const parts = dir.split("/").filter(Boolean);
  const n = ctx.config.pathLevels;
  return parts.slice(-n).join("/");
}
function gitBlock(ctx) {
  if (!ctx.config.gitStatus.enabled || !ctx.gitStatus)
    return "";
  const c = ctx.config.colors;
  const wrapper = (s) => color(c.git, s);
  const branch = color(c.gitBranch, ctx.gitStatus.branch + (ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty ? "*" : ""));
  return `${wrapper("git:(")}${branch}${wrapper(")")}`;
}

// src/render/lines/context.ts
var BAR_WIDTH = 10;
function renderContext(ctx) {
  if (!ctx.config.display.showContextBar)
    return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct))
    return null;
  const rounded = Math.round(pct);
  const c = ctx.config.colors;
  let barColor = c.context;
  if (rounded >= 85)
    barColor = c.critical;
  else if (rounded >= 70)
    barColor = c.warning;
  const filled = Math.floor(rounded * BAR_WIDTH / 100);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const valuePart = formatValue(ctx, rounded);
  return `${color(c.label, "Context")} ${color(barColor, bar)} ${color(barColor, valuePart)}`;
}
function formatValue(ctx, rounded) {
  const cw = ctx.stdin.context_window;
  const total = cw?.context_window_size ?? 0;
  const used = cw?.total_input_tokens ?? 0;
  const fmt = (n) => `${(n / 1000).toFixed(0)}k`;
  switch (ctx.config.display.contextValue) {
    case "tokens":
      return `${fmt(used)}/${fmt(total)}`;
    case "remaining":
      return `${100 - rounded}%`;
    case "both":
      return `${rounded}% (${fmt(used)}/${fmt(total)})`;
    default:
      return `${rounded}%`;
  }
}

// src/render/lines/api-time.ts
function renderApiTime(ctx) {
  if (ctx.mode !== "ollama")
    return null;
  if (!ctx.config.display.showApiTime)
    return null;
  const c = ctx.config.colors;
  const ns = ctx.transcript.totalDurationNs;
  if (typeof ns === "number" && ns > 0) {
    return `${color(c.label, "GPU")} ${color(c.apiTime, `⏱ ${formatDuration(ns / 1e6)}`)}`;
  }
  const apiMs = ctx.stdin.cost?.total_api_duration_ms;
  if (typeof apiMs === "number" && apiMs > 0) {
    return `${color(c.label, "API")} ${color(c.apiTime, `⏱ ${formatDuration(apiMs)}`)}`;
  }
  return null;
}
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  if (h > 0)
    return `${h}h ${m}m ${s}s`;
  if (m > 0)
    return `${m}m ${s}s`;
  return `${s}s`;
}

// src/render/lines/usage.ts
var BAR_WIDTH2 = 10;
function renderUsage(ctx) {
  if (ctx.mode !== "anthropic")
    return null;
  if (!ctx.config.display.showUsage)
    return null;
  if (!ctx.usageData)
    return null;
  const { fiveHour, sevenDay } = ctx.usageData;
  const parts = [];
  if (fiveHour !== null)
    parts.push(formatWindow(ctx, "5h", fiveHour, ctx.usageData.fiveHourResetAt));
  if (sevenDay !== null && sevenDay >= ctx.config.display.sevenDayThreshold) {
    parts.push(formatWindow(ctx, "7d", sevenDay, ctx.usageData.sevenDayResetAt));
  }
  if (parts.length === 0)
    return null;
  const c = ctx.config.colors;
  return `${color(c.label, "Usage")} ${parts.join(" | ")}`;
}
function formatWindow(ctx, label, pct, _resetAt) {
  const c = ctx.config.colors;
  let lineColor = c.usage;
  if (pct >= 85)
    lineColor = c.critical;
  else if (pct >= 60)
    lineColor = c.usageWarning;
  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor(pct * BAR_WIDTH2 / 100);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH2 - filled);
    return `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  }
  return color(lineColor, `${label}: ${pct}%`);
}

// src/render/lines/cost.ts
function renderCost(ctx) {
  if (ctx.mode !== "anthropic")
    return null;
  if (!ctx.config.display.showCost)
    return null;
  if (!ctx.costData)
    return null;
  const c = ctx.config.colors;
  const suffix = ctx.costData.source === "estimate" ? color(c.label, " (est)") : "";
  return `${color(c.label, "Cost")} ${color(c.label, formatUsd(ctx.costData.totalUsd))}${suffix}`;
}

// src/prompt-cache.ts
function promptCacheRemainingMs(lastResponseAt, ttlSeconds, now = Date.now) {
  if (!lastResponseAt)
    return null;
  const elapsedMs = now() - lastResponseAt.getTime();
  const ttlMs = ttlSeconds * 1000;
  return Math.max(0, ttlMs - elapsedMs);
}
function formatPromptCache(remainingMs) {
  if (remainingMs === 0)
    return "expired";
  const seconds = Math.floor(remainingMs / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}

// src/render/lines/prompt-cache.ts
function renderPromptCache(ctx) {
  if (ctx.mode !== "anthropic")
    return null;
  if (!ctx.config.display.showPromptCache)
    return null;
  const remaining = promptCacheRemainingMs(ctx.transcript.lastAssistantResponseAt, ctx.config.display.promptCacheTtlSeconds);
  if (remaining === null)
    return null;
  const c = ctx.config.colors;
  return `${color(c.label, "cache")} ${color(c.label, formatPromptCache(remaining))}`;
}

// src/render/lines/tools.ts
function renderTools(ctx) {
  if (!ctx.config.display.showTools)
    return null;
  const tools = ctx.transcript.tools;
  if (tools.length === 0)
    return null;
  const running = tools.filter((t) => t.status === "running");
  const completed = tools.filter((t) => t.status === "completed");
  const c = ctx.config.colors;
  const parts = [];
  for (const t of running)
    parts.push(`${color(c.label, "◐")} ${t.name}${t.target ? `: ${basename(t.target)}` : ""}`);
  const tally = countByName(completed);
  for (const [name, count] of tally)
    parts.push(`${color(c.label, "✓")} ${name}${count > 1 ? ` ×${count}` : ""}`);
  return parts.join(color(c.label, " | "));
}
function basename(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}
function countByName(entries) {
  const m = new Map;
  for (const e of entries)
    m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}

// src/render/lines/agents.ts
function renderAgents(ctx) {
  if (!ctx.config.display.showAgents)
    return null;
  const agents = ctx.transcript.agents;
  if (agents.length === 0)
    return null;
  const c = ctx.config.colors;
  const parts = agents.map((a) => {
    const sym = a.status === "running" ? "◐" : "✓";
    const modelTag = a.model ? ` [${a.model}]` : "";
    const desc = a.description ? `: ${a.description}` : "";
    const elapsed = a.endTime ? "" : ` (${formatElapsed(a.startTime)})`;
    return `${color(c.label, sym)} ${a.type}${modelTag}${desc}${color(c.label, elapsed)}`;
  });
  return parts.join(color(c.label, " | "));
}
function formatElapsed(start) {
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// src/render/lines/todos.ts
function renderTodos(ctx) {
  if (!ctx.config.display.showTodos)
    return null;
  const todos = ctx.transcript.todos;
  if (todos.length === 0)
    return null;
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const c = ctx.config.colors;
  const head = inProgress ? `${color(c.label, "▸")} ${inProgress.content}` : `${color(c.label, "▹")} no active todo`;
  return `${head} ${color(c.label, `(${completed}/${total})`)}`;
}

// src/render/lines/environment.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { homedir } from "node:os";
function renderEnvironment(ctx) {
  if (!ctx.config.display.showConfigCounts)
    return null;
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd;
  if (!dir)
    return null;
  const counts = countAll(dir);
  const c = ctx.config.colors;
  const parts = [
    `${counts.claudeMd} CLAUDE.md`,
    `${counts.rules} rules`,
    `${counts.mcps} MCPs`,
    `${counts.hooks} hooks`
  ];
  return color(c.label, parts.join(" | "));
}
function countAll(startDir) {
  const home = homedir();
  let claudeMd = 0;
  let dir = startDir;
  while (dir && dir.length > 1 && dir.startsWith(home)) {
    if (existsSync2(join2(dir, "CLAUDE.md")))
      claudeMd += 1;
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  const settings = readSettings(join2(home, ".claude/settings.json"));
  const mcps = Object.keys(settings?.mcpServers ?? {}).length;
  const hooks = countHooks(settings?.hooks);
  const rules = readRules(startDir);
  return { claudeMd, rules, mcps, hooks };
}
function readSettings(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return null;
  }
}
function countHooks(hooks) {
  if (!hooks || typeof hooks !== "object")
    return 0;
  let n = 0;
  for (const v of Object.values(hooks)) {
    if (Array.isArray(v))
      n += v.length;
  }
  return n;
}
function readRules(startDir) {
  const path = join2(startDir, ".claude/rules.md");
  if (!existsSync2(path))
    return 0;
  try {
    const content = readFileSync2(path, "utf8");
    return content.split(`
`).filter((l) => /^[-*]\s+\S/.test(l)).length;
  } catch {
    return 0;
  }
}

// src/render/lines/memory.ts
var BAR_WIDTH3 = 10;
function renderMemory(ctx) {
  if (!ctx.config.display.showMemoryUsage)
    return null;
  if (ctx.config.lineLayout !== "expanded")
    return null;
  if (!ctx.memoryInfo)
    return null;
  const c = ctx.config.colors;
  const filled = Math.floor(ctx.memoryInfo.usedPercent * BAR_WIDTH3 / 100);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH3 - filled);
  const usedGb = (ctx.memoryInfo.usedBytes / 1e9).toFixed(1);
  const totalGb = (ctx.memoryInfo.totalBytes / 1e9).toFixed(1);
  return `${color(c.label, "RAM")} ${color(c.usage, bar)} ${color(c.label, `${ctx.memoryInfo.usedPercent}% (${usedGb} GB / ${totalGb} GB)`)}`;
}

// src/render/lines/duration.ts
function renderDuration(ctx) {
  const showDuration = ctx.config.display.showDuration;
  const showSpeed = ctx.config.display.showSpeed;
  if (!showDuration && !showSpeed)
    return null;
  const c = ctx.config.colors;
  const parts = [];
  if (showDuration) {
    const ms = ctx.stdin.cost?.total_duration_ms;
    if (typeof ms === "number" && ms > 0)
      parts.push(`⏱ ${formatHms(ms)}`);
  }
  if (showSpeed) {
    const tps = computeTokensPerSecond(ctx);
    if (tps !== null)
      parts.push(`out: ${tps.toFixed(1)} tok/s`);
  }
  if (parts.length === 0)
    return null;
  return color(c.label, parts.join(" | "));
}
function formatHms(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m` : `${s}s`;
}
function computeTokensPerSecond(ctx) {
  const eval_count = ctx.transcript.totalEvalCount;
  const eval_dur_ns = ctx.transcript.totalEvalDurationNs;
  if (typeof eval_count === "number" && typeof eval_dur_ns === "number" && eval_dur_ns > 0) {
    return eval_count * 1e9 / eval_dur_ns;
  }
  return null;
}

// src/render/index.ts
var LINE_REGISTRY = {
  project: renderProject,
  context: renderContext,
  apiTime: renderApiTime,
  usage: renderUsage,
  cost: renderCost,
  promptCache: renderPromptCache,
  tools: renderTools,
  agents: renderAgents,
  todos: renderTodos,
  environment: renderEnvironment,
  memory: renderMemory,
  duration: renderDuration
};
function render(ctx) {
  const order = ctx.config.elementOrder;
  const lines = [];
  if (order.includes("project")) {
    const p = renderProject(ctx);
    if (p)
      lines.push(p);
  }
  const merged = collectMerged(ctx);
  if (merged)
    lines.push(merged);
  const rendered = new Set(["project", "context", "apiTime", "usage"]);
  for (const key of order) {
    if (rendered.has(key))
      continue;
    const fn = LINE_REGISTRY[key];
    if (!fn)
      continue;
    const out = fn(ctx);
    if (out)
      lines.push(out);
    rendered.add(key);
  }
  return lines.join(`
`);
}
function collectMerged(ctx) {
  const ctxLine = renderContext(ctx);
  const right = ctx.mode === "ollama" ? renderApiTime(ctx) : renderUsage(ctx);
  if (ctxLine && right) {
    const sep = color(ctx.config.colors.label, "│");
    return `${ctxLine} ${sep} ${right}`;
  }
  return ctxLine ?? right ?? null;
}

// src/index.ts
var CONFIG_PATH = join3(homedir2(), ".claude/plugins/ohud/config.json");
async function main() {
  const T0 = process.hrtime.bigint();
  const profile = process.env.OHUD_PROFILE === "1";
  try {
    const stdin = await readStdin();
    if (!stdin) {
      console.log("ohud: no stdin (setup verification)");
      return;
    }
    const config = await loadConfig(CONFIG_PATH);
    const sessionId = stdin.session_id ?? "default";
    const probe = await probeOllama({
      host: config.ollama.host,
      sessionId,
      ttlSeconds: config.ollama.probeCacheTtlSeconds,
      timeoutMs: config.ollama.probeTimeoutMs
    });
    const mode = resolveMode(stdin, probe);
    const [transcript, gitStatus] = await Promise.all([
      parseTranscript(stdin.transcript_path ?? ""),
      config.gitStatus.enabled ? getGitStatus(stdin.workspace?.current_dir ?? stdin.cwd) : Promise.resolve(null)
    ]);
    let usageData = null;
    let costData = null;
    if (mode === "anthropic") {
      usageData = fromStdin(stdin);
      if (!usageData && config.display.externalUsagePath) {
        usageData = await fromExternalSnapshot(config.display.externalUsagePath, config.display.externalUsageFreshnessMs);
      }
      costData = config.display.showCost ? resolveSessionCost(stdin, transcript.sessionTokens) : null;
    }
    const memoryInfo = config.display.showMemoryUsage && config.lineLayout === "expanded" ? getMemoryUsage() : null;
    const effortLevel = config.display.showEffortLevel ? resolveEffortLevel(stdin.effort) : undefined;
    const ctx = {
      mode,
      stdin,
      transcript,
      gitStatus,
      config,
      usageData,
      costData,
      memoryInfo,
      cloudModels: probe.cloudModels,
      effortLevel
    };
    const output = render(ctx);
    if (profile) {
      const elapsedMs = Number(process.hrtime.bigint() - T0) / 1e6;
      process.stderr.write(`ohud-profile: total=${elapsedMs.toFixed(1)}ms
`);
    }
    if (output)
      console.log(output);
  } catch (err) {
    console.error("ohud: error", err instanceof Error ? err.message : String(err));
  }
}
if (__require.main == __require.module) {
  main();
}
export {
  main
};
