#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { homedir as homedir4 } from "node:os";
import { join as join5 } from "node:path";
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3 } from "node:fs";

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
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function probeCachePath(sessionId) {
  return join(tmpdir(), `ohud-probe-${sessionId}.json`);
}
async function fetchWithTimeout(url, timeoutMs, fetchImpl) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function readCache(path) {
  if (!existsSync(path))
    return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeCache(path, data) {
  try {
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  } catch {}
}
async function probeOllama(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = probeCachePath(opts.sessionId);
  const cached = readCache(cachePath);
  const now = Date.now();
  if (cached && cached.host === opts.host) {
    const daemonAge = now - cached.fetchedAt;
    const cloudAge = now - (cached.cloudModelsAt ?? cached.fetchedAt);
    const daemonFresh = daemonAge < opts.daemonTtlSeconds * 1000 && cached.daemonOk;
    const cloudFresh = cloudAge < opts.cloudModelsTtlSeconds * 1000;
    if (daemonFresh && cloudFresh)
      return cached;
  }
  const [versionRes, tagsRes] = await Promise.all([
    fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl),
    fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl)
  ]);
  if (!versionRes || !versionRes.ok) {
    const result2 = {
      daemonOk: false,
      cloudModels: cached?.host === opts.host ? cached.cloudModels : [],
      fetchedAt: now,
      cloudModelsAt: cached?.cloudModelsAt ?? now,
      host: opts.host
    };
    writeCache(cachePath, result2);
    return result2;
  }
  if (!tagsRes || !tagsRes.ok) {
    const result2 = {
      daemonOk: true,
      cloudModels: cached?.host === opts.host ? cached.cloudModels : [],
      fetchedAt: now,
      cloudModelsAt: cached?.cloudModelsAt ?? now,
      host: opts.host
    };
    writeCache(cachePath, result2);
    return result2;
  }
  let parsed = {};
  try {
    parsed = await tagsRes.json();
  } catch {}
  const cloudModels = (parsed.models ?? []).filter((m) => typeof m.remote_host === "string" && m.remote_host.length > 0);
  const result = {
    daemonOk: true,
    cloudModels,
    fetchedAt: now,
    cloudModelsAt: now,
    host: opts.host
  };
  writeCache(cachePath, result);
  return result;
}

// src/doctor.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/config.ts
import { readFile } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
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
    hush: { compactWhenIdle: true, hyperlinks: true, animate: true, density: "compact", identityColors: false }
  },
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0
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
    daemonTtlSeconds: 5,
    cloudModelsTtlSeconds: 120,
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
function logParseError(configPath, message) {
  try {
    const logDir = join2(homedir(), ".claude/plugins/ohud");
    mkdirSync(logDir, { recursive: true });
    const logPath = join2(logDir, "last-errors.log");
    const stamp = new Date().toISOString();
    appendFileSync(logPath, `[${stamp}] parse error: ${message} (file: ${configPath})
`);
  } catch {}
}
async function loadConfig(path) {
  const base = structuredClone(DEFAULT_CONFIG);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return base;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logParseError(path, msg);
    return base;
  }
  return deepMerge(base, parsed);
}

// src/doctor.ts
var FLAG_LAYOUT = {
  showModel: "both",
  showContextBar: "both",
  contextValue: "both",
  showApiTime: "both",
  showUsage: "both",
  showEffortLevel: "both",
  glyphs: "both",
  layout: "both",
  hush: "both",
  usageBarEnabled: "row",
  usageCompact: "row",
  showResetLabel: "row",
  showCost: "row",
  showMemoryUsage: "row",
  showSpeed: "row",
  showPromptCache: "both",
  showTools: "both",
  showAgents: "both",
  showTodos: "both",
  showDuration: "both",
  showConfigCounts: "both",
  timeFormat: "both",
  sevenDayThreshold: "both",
  warningThreshold: "both",
  criticalThreshold: "both",
  externalUsagePath: "both",
  externalUsageFreshnessMs: "both",
  promptCacheTtlSeconds: "both"
};
var GIT_CONSUMED = new Set([
  "enabled",
  "showDirty",
  "showAheadBehind",
  "pushWarningThreshold",
  "pushCriticalThreshold"
]);
async function runDoctor(opts) {
  const lines = [];
  const pkg = readPackageJson();
  lines.push(`ohud version: ${pkg.version}`);
  lines.push(`runtime: ${process.version} (process.argv0=${process.argv0})`);
  const bundle = opts.bundlePath ?? resolveBundlePath();
  lines.push(`resolved bundle: ${bundle} (exists: ${existsSync2(bundle) ? "yes" : "no"})`);
  const cfg = await loadConfig(opts.configPath);
  const probe = await probeOllama({
    host: opts.host,
    sessionId: "doctor",
    daemonTtlSeconds: 0,
    cloudModelsTtlSeconds: 0,
    timeoutMs: 1500
  });
  lines.push(`probe: live (cache bypassed) — daemonOk: ${probe.daemonOk ? "yes" : "no"}`);
  lines.push(`cloud models: ${probe.cloudModels.map((m) => m.name).join(", ") || "(none)"}`);
  lines.push(`mode: ${probe.daemonOk && probe.cloudModels.length > 0 ? "ollama-capable" : "anthropic"}`);
  const activeLayout = cfg.display.layout ?? "row";
  lines.push(`Active layout: ${activeLayout}`);
  lines.push(`Daemon probe: ${probe.daemonOk ? "ok" : "fail"}`);
  lines.push(`Mode resolution rule: model.id starts with "claude-" → anthropic; ` + `otherwise → ollama; missing → daemon-probe fallback (currently ` + `${probe.daemonOk ? "ollama" : "anthropic"}).`);
  const lastModePath = join3(homedir2(), ".claude/plugins/ohud/last-mode.json");
  if (existsSync2(lastModePath)) {
    try {
      const raw = readFileSync2(lastModePath, "utf8");
      const parsed = JSON.parse(raw);
      const modeStr = parsed.mode ?? "unknown";
      const modelPart = parsed.modelId ? ` (model.id=${parsed.modelId})` : "";
      lines.push(`Last rendered mode: ${modeStr}${modelPart}`);
    } catch {}
  }
  if (activeLayout === "hush") {
    const h = cfg.display.hush ?? {};
    lines.push(`Hush config: compactWhenIdle=${h.compactWhenIdle ?? true}, hyperlinks=${h.hyperlinks ?? true}, animate=${h.animate ?? true}`);
  }
  const { annotations, warnings } = buildFlagAnnotations(cfg, activeLayout);
  lines.push(`
active config flags (consumed?):`);
  lines.push(annotations);
  if (warnings.length > 0) {
    lines.push(`
lint warnings:`);
    for (const w of warnings)
      lines.push(`  ${w}`);
  }
  const errLog = join3(homedir2(), ".claude/plugins/ohud/last-errors.log");
  if (existsSync2(errLog)) {
    lines.push(`
last errors (${errLog}):`);
    try {
      lines.push(readFileSync2(errLog, "utf8").split(`
`).slice(-5).join(`
`));
    } catch {}
  }
  return lines.join(`
`);
}
function buildFlagAnnotations(cfg, activeLayout) {
  const out = [];
  const warnings = [];
  for (const [k, v] of Object.entries(cfg.display)) {
    const affinity = FLAG_LAYOUT[k];
    let tag;
    if (!affinity) {
      tag = "unknown flag";
    } else if (affinity === "both") {
      tag = "consumed in both";
    } else if (affinity === "row") {
      if (activeLayout === "hush") {
        tag = "silenced — wrong layout";
        if (v === true) {
          warnings.push(`⚠ display.${k}: true but layout=hush silences this flag — remove or switch to layout=row`);
        }
      } else {
        tag = "consumed in row";
      }
    } else {
      if (activeLayout === "row") {
        tag = "silenced — wrong layout";
        if (v === true) {
          warnings.push(`⚠ display.${k}: true but layout=row silences this flag — remove or switch to layout=hush`);
        }
      } else {
        tag = "consumed in hush";
      }
    }
    out.push(`  display.${k}: ${JSON.stringify(v)} (${tag})`);
  }
  for (const [k, v] of Object.entries(cfg.gitStatus)) {
    const tag = GIT_CONSUMED.has(k) ? "consumed in both" : "unknown flag";
    out.push(`  gitStatus.${k}: ${JSON.stringify(v)} (${tag})`);
  }
  return { annotations: out.join(`
`), warnings };
}
function resolveBundlePath() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root)
    return join3(root, "dist", "index.js");
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return join3(homedir2(), ".claude/plugins/cache/ohud/ohud/0.1.0/dist/index.js");
  }
}
function readPackageJson() {
  try {
    const here = new URL("../package.json", import.meta.url).pathname;
    const raw = readFileSync2(here, "utf8");
    return JSON.parse(raw);
  } catch {
    return { version: "unknown" };
  }
}
function writeLastModeState(mode, modelId) {
  try {
    const dir = join3(homedir2(), ".claude/plugins/ohud");
    mkdirSync2(dir, { recursive: true });
    const path = join3(dir, "last-mode.json");
    writeFileSync2(path, JSON.stringify({ mode, modelId, updatedAt: new Date().toISOString() }));
  } catch {}
}

// src/mode.ts
function resolveMode(stdin, probe) {
  const id = stdin.model?.id?.toLowerCase() ?? "";
  if (id.startsWith("claude-"))
    return "anthropic";
  if (id.length > 0)
    return "ollama";
  return probe.daemonOk ? "ollama" : "anthropic";
}

// src/transcript.ts
import { readFile as readFile2, stat } from "node:fs/promises";
var cache = new Map;
async function parseTranscript(path) {
  if (!path)
    return empty();
  let st;
  try {
    st = await stat(path);
  } catch {
    return empty();
  }
  const cached = cache.get(path);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return cached.data;
  }
  let raw;
  try {
    raw = await readFile2(path, "utf8");
  } catch {
    return empty();
  }
  const data = parseRaw(raw);
  cache.set(path, { size: st.size, mtimeMs: st.mtimeMs, data });
  return data;
}
function empty() {
  return { tools: [], agents: [], todos: [] };
}
function parseRaw(raw) {
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
  return {
    tools: [...tools.values()],
    agents: [...agents.values()],
    todos: latestTodos,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined
  };
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

// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileP = promisify(execFile);
async function getGitStatus(cwd) {
  if (!cwd)
    return null;
  const [statusResult, remoteUrl] = await Promise.all([
    runGitStatus(cwd),
    getRemoteUrl(cwd)
  ]);
  if (!statusResult)
    return null;
  const out = statusResult;
  if (remoteUrl)
    out.remoteUrl = remoteUrl;
  return out;
}
async function runGitStatus(cwd) {
  let stdout;
  try {
    const r = await execFileP("git", ["status", "--branch", "--porcelain=v2"], { cwd, timeout: 1000 });
    stdout = r.stdout;
  } catch {
    return null;
  }
  const lines = stdout.split(`
`);
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  for (const line of lines) {
    if (line.startsWith("# branch.head "))
      branch = line.slice("# branch.head ".length).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) {
        ahead = Number.parseInt(m[1], 10);
        behind = Number.parseInt(m[2], 10);
      }
    } else if (line.length > 0 && !line.startsWith("#")) {
      dirty = true;
    }
  }
  if (!branch)
    return null;
  return { branch, dirty, ahead, behind };
}
async function getRemoteUrl(cwd) {
  try {
    const r = await execFileP("git", ["config", "--get", "remote.origin.url"], { cwd, timeout: 1000 });
    const url = r.stdout.trim();
    return url || undefined;
  } catch {
    return;
  }
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
function isColorDisabled(env) {
  const e = env ?? process.env;
  if (e.NO_COLOR !== undefined && e.NO_COLOR !== "")
    return true;
  if (e.TERM === "dumb")
    return true;
  return false;
}
function color(spec, text) {
  if (isColorDisabled())
    return text;
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

// src/render/glyphs.ts
var UNICODE = {
  bolt: "⚡",
  clock: "⏱",
  running: "◐",
  done: "✓",
  todo: "▹",
  active: "▸",
  sep: "│",
  barFull: "█",
  barEmpty: "░",
  up: "↑",
  down: "↓"
};
var ASCII = {
  bolt: "*",
  clock: "t",
  running: "o",
  done: "x",
  todo: "-",
  active: ">",
  sep: "|",
  barFull: "#",
  barEmpty: ".",
  up: "^",
  down: "v"
};
function autoMode() {
  const lang = process.env.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8"))
    return "unicode";
  if (process.env.LC_ALL?.includes("UTF-8"))
    return "unicode";
  return "ascii";
}
function glyph(key, mode) {
  const resolved = mode === "auto" ? autoMode() : mode;
  return resolved === "ascii" ? ASCII[key] : UNICODE[key];
}

// src/render/path.ts
function basename(p) {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

// src/render/width.ts
var WIDTH_2_GLYPHS = new Set(["⚡", "⏱", "◐", "✓", "▸", "▹"]);
function wcwidth(s) {
  let w = 0;
  for (const ch of s) {
    if (WIDTH_2_GLYPHS.has(ch)) {
      w += 2;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 127744 && cp <= 129791) {
      w += 2;
      continue;
    }
    if (cp >= 65072 && cp <= 65103) {
      w += 2;
      continue;
    }
    if (cp >= 11904 && cp <= 12350) {
      w += 2;
      continue;
    }
    if (cp >= 12353 && cp <= 13311) {
      w += 2;
      continue;
    }
    if (cp >= 13312 && cp <= 19903) {
      w += 2;
      continue;
    }
    if (cp >= 19968 && cp <= 40959) {
      w += 2;
      continue;
    }
    if (cp >= 44032 && cp <= 55203) {
      w += 2;
      continue;
    }
    w += 1;
  }
  return w;
}
var ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
var ANSI_AT_START_RE = /^(?:\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07)/;
function visibleWidth(s) {
  return wcwidth(s.replace(ANSI_RE, ""));
}
function truncateLine(line, max) {
  if (visibleWidth(line) <= max)
    return line;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < max - 1) {
    const slice = line.slice(i);
    const match = ANSI_AT_START_RE.exec(slice);
    if (match) {
      out += match[0];
      i += match[0].length;
      continue;
    }
    const ch = line.slice(i, i + 1);
    const w = wcwidth(ch);
    if (visible + w > max - 1)
      break;
    out += ch;
    visible += w;
    i += 1;
  }
  return out + "…\x1B[0m";
}
function detectTerminalWidth(env, fallback) {
  const cols = env.COLUMNS ? Number.parseInt(env.COLUMNS, 10) : NaN;
  if (Number.isFinite(cols) && cols > 0)
    return cols;
  if (process.stdout.columns && process.stdout.columns > 0)
    return process.stdout.columns;
  return fallback ?? 120;
}

// src/render/widgets/_util.ts
function maxLineWidth(s) {
  return Math.max(0, ...s.split(`
`).map(visibleWidth));
}

// src/render/widgets/project.ts
var projectWidget = {
  id: "project",
  group: "header",
  priority: 100,
  minWidth: 20,
  render(ctx) {
    const body = renderProject(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    const cells = [];
    const projectDir = ctx.stdin.workspace?.project_dir?.trim() ?? "";
    let projectName;
    if (projectDir) {
      projectName = basename(projectDir) || projectDir;
    } else {
      const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd ?? "";
      const parts = dir.split("/").filter(Boolean);
      projectName = parts.slice(-ctx.config.pathLevels).join("/") || "ohud";
    }
    cells.push({
      group: "header",
      text: projectName,
      attention: "normal",
      baseColor: "cyan",
      link: projectDir ? `file://${projectDir}` : undefined
    });
    if (ctx.config.gitStatus.enabled && ctx.gitStatus) {
      const dirty = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty;
      const dirtyMark = dirty ? ctx.config.display.glyphs === "ascii" ? " *" : " ●" : "";
      const branchText = ctx.gitStatus.branch + dirtyMark;
      const attention = dirty ? "warning" : "normal";
      const branchLink = remoteUrlToHttp(ctx.gitStatus.remoteUrl);
      cells.push({
        group: "header",
        text: branchText,
        attention,
        baseColor: dirty ? undefined : "green",
        link: branchLink
      });
    }
    if (ctx.config.display.showModel) {
      const rawId = ctx.stdin.model?.id ?? "";
      const modelLabel = condenseModelId(rawId);
      if (modelLabel) {
        const anchor = rawId.replace(/\./g, "");
        const modelUrl = anchor ? `https://docs.anthropic.com/en/docs/about-claude/models#${anchor}` : undefined;
        cells.push({
          group: "header",
          text: modelLabel,
          attention: "normal",
          baseColor: "blue",
          link: modelUrl
        });
      }
    }
    return cells;
  }
};
function renderProject(ctx) {
  const c = ctx.config;
  const modelLabel = modelBadge(ctx);
  const projectLabel = projectPath(ctx);
  const gitLabel = gitBlock(ctx);
  const effortLabel = effortBlock(ctx);
  const parts = [];
  if (c.display.showModel && modelLabel)
    parts.push(color(c.colors.model, `[${modelLabel}]`));
  if (projectLabel)
    parts.push(color(c.colors.project, projectLabel));
  if (gitLabel)
    parts.push(gitLabel);
  if (effortLabel)
    parts.push(effortLabel);
  return parts.join(color(c.colors.label, ` ${glyph("sep", c.display.glyphs)} `));
}
function modelBadge(ctx) {
  const name = ctx.stdin.model?.display_name ?? ctx.stdin.model?.id ?? "model";
  if (ctx.mode !== "ollama")
    return name;
  const cloudInfo = ctx.cloudModels.find((m) => m.name === ctx.stdin.model?.id || m.model === ctx.stdin.model?.id);
  const param = cloudInfo?.details?.parameter_size;
  return param ? `${name} ${glyph("bolt", ctx.config.display.glyphs)} ${param}` : name;
}
function projectPath(ctx) {
  const projectDir = ctx.stdin.workspace?.project_dir?.trim() ?? "";
  if (projectDir) {
    const base = basename(projectDir);
    if (base)
      return base;
  }
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
  const dirtyMark = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty ? "*" : "";
  const branch = color(c.gitBranch, ctx.gitStatus.branch + dirtyMark);
  let aheadBehind = "";
  if (ctx.config.gitStatus.showAheadBehind) {
    const a = ctx.gitStatus.ahead;
    const b = ctx.gitStatus.behind;
    if (a > 0 || b > 0) {
      const aColor = ctx.config.gitStatus.pushCriticalThreshold > 0 && a >= ctx.config.gitStatus.pushCriticalThreshold ? c.critical : ctx.config.gitStatus.pushWarningThreshold > 0 && a >= ctx.config.gitStatus.pushWarningThreshold ? c.warning : c.gitBranch;
      aheadBehind = ` ${color(aColor, `${glyph("up", ctx.config.display.glyphs)}${a}`)} ${color(c.gitBranch, `${glyph("down", ctx.config.display.glyphs)}${b}`)}`;
    }
  }
  return `${wrapper("git:(")}${branch}${aheadBehind}${wrapper(")")}`;
}
function effortBlock(ctx) {
  if (!ctx.config.display.showEffortLevel || !ctx.effortLevel)
    return "";
  return color(ctx.config.colors.label, `effort:${ctx.effortLevel}`);
}
function condenseModelId(nameOrId) {
  let s = nameOrId.trim();
  s = s.replace(/(-?(\[)?(\d+m|\d+k)\]?)$/i, "");
  if (s.toLowerCase().startsWith("claude-"))
    s = s.slice(7);
  else if (s.toLowerCase().startsWith("claude "))
    s = s.slice(7);
  s = s.replace(/(\d)-(\d)/g, "$1.$2").toLowerCase();
  return s;
}
function remoteUrlToHttp(remoteUrl) {
  if (!remoteUrl)
    return;
  const url = remoteUrl.trim();
  if (!url)
    return;
  const sshMatch = /^git@(github\.com|gitlab\.com|bitbucket\.org):(.+?)(?:\.git)?$/.exec(url);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2];
    return `https://${host}/${path}`;
  }
  const httpsMatch = /^(https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^?#]+?)(?:\.git)?\/?$/.exec(url);
  if (httpsMatch) {
    return httpsMatch[1];
  }
  return;
}

// src/render/thresholds.ts
function barColorForPercent(pct, palette, thresholds = { warning: 60, critical: 75 }) {
  if (pct >= thresholds.critical)
    return palette.critical;
  if (pct >= thresholds.warning)
    return palette.warning;
  return palette.default;
}

// src/render/widgets/context.ts
var contextWidget = {
  id: "context",
  group: "metrics",
  priority: 90,
  minWidth: 22,
  render(ctx) {
    const body = renderContext(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (!ctx.config.display.showContextBar)
      return null;
    const pct = ctx.stdin.context_window?.used_percentage;
    if (typeof pct !== "number" || !Number.isFinite(pct))
      return null;
    const rounded = Math.round(pct);
    const warn = ctx.config.display.hush?.thresholds?.warning ?? ctx.config.display.warningThreshold;
    const crit = ctx.config.display.hush?.thresholds?.danger ?? ctx.config.display.criticalThreshold;
    const attention = rounded >= crit ? "danger" : rounded >= warn ? "warning" : "muted";
    const cwSize = ctx.stdin.context_window?.context_window_size;
    const capacitySuffix = cwSize && cwSize > 200000 ? ` of ${formatCapacity(cwSize)}` : "";
    return {
      group: "metrics",
      text: `${rounded}%${capacitySuffix}`,
      attention
    };
  }
};
function formatCapacity(size) {
  const millions = size / 1e6;
  if (millions >= 0.95)
    return `${Math.round(millions)}M`;
  const hundreds = Math.round(size / 1e5) * 100;
  return `${hundreds}k`;
}
var BAR_WIDTH = 10;
function renderContext(ctx) {
  if (!ctx.config.display.showContextBar)
    return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct))
    return null;
  const rounded = Math.round(pct);
  const c = ctx.config.colors;
  const barColor = barColorForPercent(rounded, {
    default: c.context,
    warning: c.warning,
    critical: c.critical
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold
  });
  const filled = Math.floor(rounded * BAR_WIDTH / 100);
  const empty2 = BAR_WIDTH - filled;
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(empty2);
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

// src/render/widgets/api-time.ts
var apiTimeWidget = {
  id: "apiTime",
  group: "metrics",
  priority: 82,
  minWidth: 14,
  render(ctx) {
    const body = renderApiTime(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (ctx.mode !== "ollama")
      return null;
    if (!ctx.config.display.showApiTime)
      return null;
    const ms = ctx.stdin.cost?.total_api_duration_ms;
    if (typeof ms !== "number" || ms <= 0)
      return null;
    const attention = ms >= 1500 ? "danger" : ms >= 500 ? "warning" : ms >= 100 ? "normal" : "muted";
    return {
      group: "metrics",
      text: formatApiTime(ms),
      attention
    };
  }
};
function formatApiTime(ms) {
  if (ms >= 1000) {
    const s = (ms / 1000).toFixed(1);
    return `${s}s`;
  }
  return `${Math.round(ms)}ms`;
}
function renderApiTime(ctx) {
  if (ctx.mode !== "ollama")
    return null;
  if (!ctx.config.display.showApiTime)
    return null;
  const c = ctx.config.colors;
  const apiMs = ctx.stdin.cost?.total_api_duration_ms;
  if (typeof apiMs === "number" && apiMs > 0) {
    return `${color(c.label, "API")} ${color(c.apiTime, `${glyph("clock", ctx.config.display.glyphs)} ${formatDuration(apiMs)}`)}`;
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

// src/render/widgets/usage.ts
var usageWidget = {
  id: "usage",
  group: "metrics",
  priority: 80,
  minWidth: 22,
  render(ctx) {
    const body = renderUsage(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (ctx.mode !== "anthropic")
      return null;
    if (!ctx.config.display.showUsage)
      return null;
    if (!ctx.usageData)
      return null;
    const { fiveHour, sevenDay } = ctx.usageData;
    const warn = ctx.config.display.hush?.thresholds?.warning ?? ctx.config.display.warningThreshold;
    const crit = ctx.config.display.hush?.thresholds?.danger ?? ctx.config.display.criticalThreshold;
    const fiveHourPct = fiveHour ?? 0;
    const sevenDayPct = sevenDay ?? 0;
    if (fiveHourPct < 50 && sevenDayPct < 50)
      return null;
    const parts = [];
    if (fiveHour !== null)
      parts.push(`rate ${fiveHour}%/5h`);
    if (sevenDay !== null && sevenDay >= ctx.config.display.sevenDayThreshold) {
      parts.push(`quota ${sevenDay}%/7d`);
    }
    if (parts.length === 0)
      return null;
    const maxPct = Math.max(fiveHourPct, sevenDayPct);
    const attention = maxPct >= crit ? "danger" : maxPct >= warn ? "warning" : maxPct >= 50 ? "normal" : "muted";
    return {
      group: "metrics",
      text: parts.join(" "),
      attention
    };
  }
};
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
function formatWindow(ctx, label, pct, resetAt) {
  const c = ctx.config.colors;
  const lineColor = barColorForPercent(pct, {
    default: c.usage,
    warning: c.usageWarning,
    critical: c.critical
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold
  });
  let core;
  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor(pct * BAR_WIDTH2 / 100);
    const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(BAR_WIDTH2 - filled);
    core = `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  } else {
    core = color(lineColor, `${label}: ${pct}%`);
  }
  if (ctx.config.display.showResetLabel && resetAt) {
    core += " " + color(c.label, formatReset(resetAt, ctx.config.display.timeFormat));
  }
  return core;
}
function formatReset(resetAt, fmt) {
  const deltaMs = resetAt.getTime() - Date.now();
  const rel = relativeTime(deltaMs);
  if (fmt === "relative")
    return `resets in ${rel}`;
  const abs = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (fmt === "absolute")
    return `resets at ${abs}`;
  return `resets in ${rel} (${abs})`;
}
function relativeTime(ms) {
  if (ms <= 0)
    return "now";
  const min = Math.floor(ms / 60000);
  if (min < 60)
    return `~${min}m`;
  const h = Math.floor(min / 60);
  const remM = min % 60;
  return remM > 0 ? `~${h}h${remM}m` : `~${h}h`;
}

// src/render/widgets/cost.ts
var costWidget = {
  id: "cost",
  group: "metrics",
  priority: 70,
  minWidth: 14,
  render(ctx) {
    const body = renderCost(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(_ctx) {
    return null;
  }
};
function renderCost(ctx) {
  if (ctx.mode !== "anthropic")
    return null;
  if (!ctx.costData)
    return null;
  if (!ctx.config.display.showCost) {
    if (ctx.costData.source !== "native" || ctx.costData.totalUsd <= 0)
      return null;
  }
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

// src/render/widgets/prompt-cache.ts
var MIN_REMAINING_MS = 60000;
var promptCacheWidget = {
  id: "promptCache",
  group: "metrics",
  priority: 60,
  minWidth: 14,
  render(ctx) {
    const body = renderPromptCache(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (ctx.mode !== "anthropic")
      return null;
    if (!ctx.config.display.showPromptCache)
      return null;
    const remaining = promptCacheRemainingMs(ctx.transcript.lastAssistantResponseAt, ctx.config.display.promptCacheTtlSeconds);
    if (remaining === null || remaining < MIN_REMAINING_MS)
      return null;
    return {
      group: "metrics",
      text: `cache ${formatPromptCache(remaining)}`,
      attention: "muted",
      baseColor: "cyan"
    };
  }
};
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

// src/render/widgets/memory.ts
var memoryWidget = {
  id: "memory",
  group: "metrics",
  priority: 50,
  minWidth: 18,
  render(ctx) {
    const body = renderMemory(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(_ctx) {
    return null;
  }
};
var BAR_WIDTH3 = 10;
function renderMemory(ctx) {
  if (!ctx.config.display.showMemoryUsage)
    return null;
  if (ctx.config.lineLayout !== "expanded")
    return null;
  if (!ctx.memoryInfo)
    return null;
  const c = ctx.config.colors;
  const barColor = barColorForPercent(ctx.memoryInfo.usedPercent, {
    default: c.usage,
    warning: c.warning,
    critical: c.critical
  }, {
    warning: ctx.config.display.warningThreshold,
    critical: ctx.config.display.criticalThreshold
  });
  const filled = Math.floor(ctx.memoryInfo.usedPercent * BAR_WIDTH3 / 100);
  const bar = glyph("barFull", ctx.config.display.glyphs).repeat(filled) + glyph("barEmpty", ctx.config.display.glyphs).repeat(BAR_WIDTH3 - filled);
  const usedGb = (ctx.memoryInfo.usedBytes / 1e9).toFixed(1);
  const totalGb = (ctx.memoryInfo.totalBytes / 1e9).toFixed(1);
  return `${color(c.label, "RAM")} ${color(barColor, bar)} ${color(c.label, `${ctx.memoryInfo.usedPercent}% (${usedGb} GB / ${totalGb} GB)`)}`;
}

// src/render/widgets/duration.ts
var DURATION_WARNING_MS = 8 * 60 * 60 * 1000;
var DURATION_DANGER_MS = 12 * 60 * 60 * 1000;
var DURATION_NORMAL_MS = 4 * 60 * 60 * 1000;
var durationWidget = {
  id: "duration",
  group: "metrics",
  priority: 40,
  minWidth: 12,
  render(ctx) {
    const body = renderDuration(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (!ctx.config.display.showDuration && !ctx.config.display.showSpeed)
      return null;
    const ms = ctx.stdin.cost?.total_duration_ms;
    if (typeof ms !== "number" || ms <= 0)
      return null;
    if (ms < DURATION_NORMAL_MS)
      return null;
    const text = formatDurationHush(ms);
    const attention = ms >= DURATION_DANGER_MS ? "danger" : ms >= DURATION_WARNING_MS ? "warning" : "normal";
    return {
      group: "activity",
      text,
      attention
    };
  }
};
function formatDurationHush(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  if (h > 0 && m > 0)
    return `${h}h${m}m`;
  if (h > 0)
    return `${h}h`;
  return `${m}m`;
}
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
function computeTokensPerSecond(_ctx) {
  return null;
}

// src/render/widgets/tools.ts
var RUNNING_TIMEOUT_MS = 300000;
var DONE_FADE_MS = 30000;
function freshRunning(t, now) {
  return t.status === "running" && now - t.startTime.getTime() < RUNNING_TIMEOUT_MS;
}
function freshDone(t, now) {
  if (t.status !== "completed")
    return false;
  if (!t.endTime)
    return true;
  return now - t.endTime.getTime() < DONE_FADE_MS;
}
var toolsWidget = {
  id: "tools",
  group: "activity",
  priority: 90,
  minWidth: 16,
  render(ctx) {
    const body = renderTools(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (!ctx.config.display.showTools)
      return null;
    const tools = ctx.transcript.tools;
    if (tools.length === 0)
      return null;
    const now = Date.now();
    const running = tools.filter((t) => freshRunning(t, now));
    const done = tools.filter((t) => freshDone(t, now));
    const cells = [];
    for (const g of groupByNameHush(running).values()) {
      const cappedCount = capCount(g.count);
      const countSuffix = g.count > 1 ? ` ×${cappedCount}` : "";
      const targetSuffix = g.count === 1 && g.target ? `: ${basename(g.target)}` : "";
      const elapsedMs = g.mostRecentStart ? Date.now() - g.mostRecentStart.getTime() : 0;
      const elapsedSuffix = elapsedMs > 30000 ? ` (${formatElapsedSec(elapsedMs)})` : "";
      const attention = elapsedMs > 120000 ? "warning" : "normal";
      cells.push({
        group: "activity",
        text: `${g.name}${countSuffix}${targetSuffix}${elapsedSuffix}`,
        attention,
        baseColor: "cyan",
        animate: "spinner"
      });
    }
    const tally = countByName(done);
    for (const [name, count] of tally) {
      const cappedCount = capCount(count);
      const countSuffix = count > 1 ? ` ×${cappedCount}` : "";
      cells.push({
        group: "activity",
        text: `✓ ${name}${countSuffix}`,
        attention: "muted",
        baseColor: "green"
      });
    }
    return cells.length > 0 ? cells : null;
  }
};
function groupByNameHush(entries) {
  const out = new Map;
  for (const t of entries) {
    const existing = out.get(t.name);
    if (existing) {
      existing.count += 1;
      if (existing.target !== t.target)
        existing.target = undefined;
      if (!existing.mostRecentStart || t.startTime > existing.mostRecentStart) {
        existing.mostRecentStart = t.startTime;
      }
    } else {
      out.set(t.name, { name: t.name, count: 1, target: t.target, mostRecentStart: t.startTime });
    }
  }
  return out;
}
function countByName(entries) {
  const m = new Map;
  for (const e of entries)
    m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}
function capCount(n) {
  return n >= 100 ? "100+" : String(n);
}
function formatElapsedSec(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}
function renderTools(ctx) {
  if (!ctx.config.display.showTools)
    return null;
  const tools = ctx.transcript.tools;
  if (tools.length === 0)
    return null;
  const now = Date.now();
  const running = tools.filter((t) => freshRunning(t, now));
  const completed = tools.filter((t) => freshDone(t, now));
  const c = ctx.config.colors;
  const parts = [];
  for (const g of groupRunning(running).values()) {
    const targetSuffix = g.target ? `: ${basename(g.target)}` : "";
    const countSuffix = g.count > 1 ? ` ×${g.count}` : "";
    parts.push(`${color(c.label, glyph("running", ctx.config.display.glyphs))} ${g.name}${countSuffix}${targetSuffix}`);
  }
  const tally = countByName(completed);
  for (const [name, count] of tally)
    parts.push(`${color(c.label, glyph("done", ctx.config.display.glyphs))} ${name}${count > 1 ? ` ×${count}` : ""}`);
  return parts.join(color(c.label, " | "));
}
function groupRunning(entries) {
  const out = new Map;
  for (const t of entries) {
    const sameNameAny = [...out.values()].find((g) => g.name === t.name);
    if (sameNameAny && sameNameAny.target !== t.target) {
      sameNameAny.target = undefined;
      sameNameAny.count += 1;
      continue;
    }
    const key = `${t.name}\x00${t.target ?? ""}`;
    const existing = out.get(key);
    if (existing)
      existing.count += 1;
    else
      out.set(key, { name: t.name, target: t.target, count: 1 });
  }
  return out;
}

// src/render/widgets/agents.ts
var RUNNING_TIMEOUT_MS2 = 300000;
var DONE_FADE_MS2 = 30000;
function freshRunning2(a, now) {
  return a.status === "running" && now - a.startTime.getTime() < RUNNING_TIMEOUT_MS2;
}
function freshDone2(a, now) {
  if (a.status !== "completed")
    return false;
  if (!a.endTime)
    return true;
  return now - a.endTime.getTime() < DONE_FADE_MS2;
}
var agentsWidget = {
  id: "agents",
  group: "activity",
  priority: 85,
  minWidth: 16,
  render(ctx) {
    const body = renderAgents(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (!ctx.config.display.showAgents)
      return null;
    const agents = ctx.transcript.agents;
    if (agents.length === 0)
      return null;
    const now = Date.now();
    const running = agents.filter((a) => freshRunning2(a, now));
    const completed = agents.filter((a) => freshDone2(a, now));
    const cells = [];
    for (const a of running) {
      const elapsedMs = Date.now() - a.startTime.getTime();
      const modelLabel = a.model ? condenseModelId(a.model) : null;
      const modelSuffix = modelLabel ? ` \x1B[2m· ${modelLabel}\x1B[22m` : "";
      const elapsedSuffix = elapsedMs > 30000 ? ` (${formatElapsedSec2(elapsedMs)})` : "";
      const attention = elapsedMs > 120000 ? "warning" : "normal";
      cells.push({
        group: "activity",
        text: `${a.type}${modelSuffix}${elapsedSuffix}`,
        attention,
        baseColor: "cyan",
        animate: "spinner"
      });
    }
    const tally = countByType(completed);
    for (const [type, count] of tally) {
      const cappedCount = capCount2(count);
      const countSuffix = count > 1 ? ` ×${cappedCount}` : "";
      cells.push({
        group: "activity",
        text: `✓ ${type}${countSuffix}`,
        attention: "muted",
        baseColor: "green"
      });
    }
    return cells.length > 0 ? cells : null;
  }
};
function renderAgents(ctx) {
  if (!ctx.config.display.showAgents)
    return null;
  const agents = ctx.transcript.agents;
  if (agents.length === 0)
    return null;
  const c = ctx.config.colors;
  const now = Date.now();
  const running = agents.filter((a) => freshRunning2(a, now));
  const completed = agents.filter((a) => freshDone2(a, now));
  const lines = [];
  if (running.length === 1) {
    lines.push(formatRunningAgent(running[0], ctx));
  } else if (running.length >= 2) {
    for (const a of running)
      lines.push(formatRunningAgent(a, ctx));
  }
  if (completed.length > 0) {
    const tally = countByType(completed);
    const completedParts = [];
    for (const [type, count] of tally) {
      completedParts.push(`${color(c.label, glyph("done", ctx.config.display.glyphs))} ${type}${count > 1 ? ` ×${count}` : ""}`);
    }
    lines.push(completedParts.join(color(c.label, " | ")));
  }
  return lines.length > 0 ? lines.join(`
`) : null;
}
function formatRunningAgent(a, ctx) {
  const c = ctx.config.colors;
  const sym = glyph("running", ctx.config.display.glyphs);
  const modelTag = a.model ? ` [${a.model}]` : "";
  const desc = a.description ? `: ${a.description}` : "";
  const elapsed = a.endTime ? "" : ` (${formatElapsed(a.startTime)})`;
  return `${color(c.label, sym)} ${a.type}${modelTag}${desc}${color(c.label, elapsed)}`;
}
function countByType(entries) {
  const m = new Map;
  for (const e of entries)
    m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return m;
}
function capCount2(n) {
  return n >= 100 ? "100+" : String(n);
}
function formatElapsedSec2(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}
function formatElapsed(start) {
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// src/render/widgets/todos.ts
var todosWidget = {
  id: "todos",
  group: "activity",
  priority: 70,
  minWidth: 20,
  render(ctx) {
    const body = renderTodos(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(ctx) {
    if (!ctx.config.display.showTodos)
      return null;
    const todos = ctx.transcript.todos;
    const inProgress = todos.find((t) => t.status === "in_progress");
    if (!inProgress)
      return null;
    return {
      group: "activity",
      text: `▸ ${inProgress.content}`,
      attention: "warning"
    };
  }
};
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
  const head = inProgress ? `${color(c.label, glyph("active", ctx.config.display.glyphs))} ${inProgress.content}` : `${color(c.label, glyph("todo", ctx.config.display.glyphs))} no active todo`;
  return `${head} ${color(c.label, `(${completed}/${total})`)}`;
}

// src/render/widgets/environment.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { dirname, join as join4 } from "node:path";
import { homedir as homedir3 } from "node:os";
var environmentWidget = {
  id: "environment",
  group: "activity",
  priority: 30,
  minWidth: 14,
  render(ctx) {
    const body = renderEnvironment(ctx);
    if (body == null)
      return null;
    return { body, visualWidth: maxLineWidth(body) };
  },
  renderHush(_ctx) {
    return null;
  }
};
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
  const home = homedir3();
  let claudeMd = 0;
  let dir = startDir;
  while (dir && dir.length > 1 && dir.startsWith(home)) {
    if (existsSync3(join4(dir, "CLAUDE.md")))
      claudeMd += 1;
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  const settings = readSettings(join4(home, ".claude/settings.json"));
  const mcps = Object.keys(settings?.mcpServers ?? {}).length;
  const hooks = countHooks(settings?.hooks);
  const rules = readRules(startDir);
  return { claudeMd, rules, mcps, hooks };
}
function readSettings(path) {
  try {
    return JSON.parse(readFileSync3(path, "utf8"));
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
  const path = join4(startDir, ".claude/rules.md");
  if (!existsSync3(path))
    return 0;
  try {
    const content = readFileSync3(path, "utf8");
    return content.split(`
`).filter((l) => /^[-*]\s+\S/.test(l)).length;
  } catch {
    return 0;
  }
}

// src/render/widgets/index.ts
var WIDGETS = [
  projectWidget,
  contextWidget,
  apiTimeWidget,
  usageWidget,
  costWidget,
  promptCacheWidget,
  memoryWidget,
  durationWidget,
  toolsWidget,
  agentsWidget,
  todosWidget,
  environmentWidget
];
function visibleWidgets(config) {
  return WIDGETS.filter((w) => isVisible(w, config));
}
function isVisible(w, config) {
  const d = config.display;
  switch (w.id) {
    case "project":
      return true;
    case "context":
      return d.showContextBar !== false;
    case "apiTime":
      return d.showApiTime !== false;
    case "usage":
      return d.showUsage !== false;
    case "cost":
      return true;
    case "promptCache":
      return d.showPromptCache === true;
    case "memory":
      return d.showMemoryUsage === true;
    case "duration":
      return d.showDuration === true || d.showSpeed === true;
    case "tools":
      return d.showTools === true;
    case "agents":
      return d.showAgents === true;
    case "todos":
      return d.showTodos === true;
    case "environment":
      return d.showConfigCounts === true;
    default:
      return true;
  }
}

// src/render/layout/row.ts
var rowLayout = {
  name: "row",
  pack(cells, termWidth, config) {
    const lines = [];
    function pushLines(out) {
      for (const ln of out.split(`
`)) {
        if (ln.length > 0)
          lines.push(ln);
      }
    }
    function bodyOf(cell) {
      if ("body" in cell)
        return cell.body;
      return cell.text;
    }
    const byId = new Map;
    for (const c of cells) {
      if (c.id)
        byId.set(c.id, c);
    }
    const projectCell = byId.get("project");
    if (projectCell) {
      pushLines(bodyOf(projectCell));
    }
    const ctxCell = byId.get("context");
    const rightCell = byId.get("apiTime") ?? byId.get("usage");
    let mergedLine = null;
    if (ctxCell && rightCell) {
      const sep = color(config.colors.label, glyph("sep", config.display.glyphs));
      mergedLine = `${bodyOf(ctxCell)} ${sep} ${bodyOf(rightCell)}`;
    } else if (ctxCell) {
      mergedLine = bodyOf(ctxCell);
    } else if (rightCell) {
      mergedLine = bodyOf(rightCell);
    }
    if (mergedLine)
      pushLines(mergedLine);
    const rendered = new Set(["project", "context", "apiTime", "usage"]);
    for (const key of config.elementOrder) {
      if (rendered.has(key))
        continue;
      const cell = byId.get(key);
      if (!cell)
        continue;
      pushLines(bodyOf(cell));
      rendered.add(key);
    }
    return lines.map((l) => truncateLine(l, termWidth));
  }
};

// src/render/dim.ts
function dim(text, env) {
  if (isColorDisabled(env))
    return text;
  return `\x1B[2m${text}\x1B[22m`;
}

// src/render/spinner.ts
var UNICODE_FRAMES = ["◐", "◓", "◑", "◒"];
var ASCII_FRAMES = ["|", "/", "-", "\\"];
function spinnerFrame(now, mode) {
  const idx = Math.floor(now / 1000) % 4;
  return mode === "ascii" ? ASCII_FRAMES[idx] : UNICODE_FRAMES[idx];
}

// src/render/hyperlink.ts
function link(text, url, enabled = true) {
  if (!enabled || !url)
    return text;
  if (url.includes("\x07"))
    return text;
  return `\x1B]8;;${url}\x07${text}\x1B]8;;\x07`;
}

// src/render/layout/hush.ts
var SGR_FG = {
  cyan: "36",
  green: "32",
  blue: "34",
  magenta: "35",
  yellow: "33",
  red: "31"
};
var RESET_FG = "\x1B[39m";
var MAX_RUNNING = 3;
var MAX_DONE = 4;
function applyColor(text, colorName, env) {
  if (isColorDisabled(env))
    return text;
  const code = SGR_FG[colorName];
  if (!code)
    return text;
  return `\x1B[${code}m${text}${RESET_FG}`;
}
function applyDimColor(text, colorName, env) {
  if (isColorDisabled(env))
    return text;
  if (!colorName)
    return dim(text, env);
  const code = SGR_FG[colorName];
  if (!code)
    return dim(text, env);
  return `\x1B[2;${code}m${text}\x1B[22;39m`;
}
function glyphMode(config, env) {
  const g = config.display.glyphs;
  if (g === "unicode")
    return "unicode";
  if (g === "ascii")
    return "ascii";
  const e = env ?? process.env;
  const lang = e.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8"))
    return "unicode";
  if (e.LC_ALL?.includes("UTF-8"))
    return "unicode";
  return "ascii";
}
function resolveSeparators(density, env) {
  const noColor = isColorDisabled(env);
  const dot = noColor ? "·" : "\x1B[2m·\x1B[22m";
  switch (density) {
    case "comfortable":
      return { within: ` ${dot} `, between: "    " };
    case "airy":
      return { within: "  ", between: "      " };
    default:
      return { within: " ", between: ` ${dot} ` };
  }
}
function effectiveBaseColor(cell, toggles) {
  if (!cell.baseColor)
    return;
  if (cell.group !== "header")
    return cell.baseColor;
  return toggles.identityColors ? cell.baseColor : undefined;
}
function renderCell(cell, now, mode, env, toggles) {
  const noColor = isColorDisabled(env);
  let text;
  if (cell.primaryText !== undefined && cell.secondaryText !== undefined) {
    const primary = cell.primaryText;
    const secondary = cell.secondaryText;
    let primaryStyled = primary;
    const color2 = effectiveBaseColor(cell, toggles);
    if (!noColor && color2) {
      primaryStyled = applyColor(primary, color2, env);
    }
    const secondaryStyled = dim(secondary, env);
    text = `${primaryStyled} ${secondaryStyled}`;
    if (cell.animate === "spinner" && toggles.animate) {
      const glyph2 = spinnerFrame(now, mode);
      text = `${glyph2} ${text}`;
    }
    if (cell.link) {
      text = link(text, cell.link, toggles.hyperlinks);
    }
    return text;
  }
  text = cell.text;
  if (cell.animate === "spinner" && toggles.animate) {
    const glyph2 = spinnerFrame(now, mode);
    text = `${glyph2} ${text}`;
  }
  switch (cell.attention) {
    case "muted":
      text = applyDimColor(text, effectiveBaseColor(cell, toggles), env);
      break;
    case "normal":
      {
        const color2 = effectiveBaseColor(cell, toggles);
        if (!noColor && color2)
          text = applyColor(text, color2, env);
      }
      break;
    case "warning":
      if (!noColor)
        text = `\x1B[33m${text}${RESET_FG}`;
      break;
    case "danger":
      if (!noColor)
        text = `\x1B[31m${text}${RESET_FG}`;
      break;
  }
  if (cell.link) {
    text = link(text, cell.link, toggles.hyperlinks);
  }
  return text;
}
function joinCells(renderedPairs, seps) {
  if (renderedPairs.length === 0)
    return "";
  let result = renderedPairs[0].rendered;
  for (let i = 1;i < renderedPairs.length; i++) {
    const prev = renderedPairs[i - 1];
    const curr = renderedPairs[i];
    const sep = prev.group === curr.group ? seps.within : seps.between;
    result += sep + curr.rendered;
  }
  return result;
}
function capActivityCells(cells) {
  const running = cells.filter((c) => c.animate === "spinner");
  const done = cells.filter((c) => c.animate !== "spinner");
  const cappedRunning = running.slice(0, MAX_RUNNING);
  const cappedDone = done.slice(0, MAX_DONE);
  const dropped = running.length - cappedRunning.length + (done.length - cappedDone.length);
  const result = [...cappedRunning, ...cappedDone];
  if (dropped > 0) {
    result.push({
      text: `+${dropped} more`,
      attention: "muted",
      group: "activity"
    });
  }
  return result;
}
function truncateByPriority(cells, now, mode, env, toggles, seps, termWidth) {
  const renderPairs = (cs) => cs.map((c) => ({ rendered: renderCell(c, now, mode, env, toggles), group: c.group }));
  let result = joinCells(renderPairs(cells), seps);
  if (stripAnsiWidth(result) <= termWidth)
    return result;
  const sorted = [...cells].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    return pa - pb;
  });
  const kept = [...sorted];
  while (kept.length > 1) {
    kept.shift();
    const original = cells.filter((c) => kept.includes(c));
    result = joinCells(renderPairs(original), seps);
    if (stripAnsiWidth(result) <= termWidth)
      return result;
  }
  return truncateLine(joinCells(renderPairs(cells.slice(0, 1)), seps), termWidth);
}
function packActivityLine(cells, now, mode, env, toggles, seps, termWidth) {
  const renderPairs = (cs) => cs.map((c) => ({ rendered: renderCell(c, now, mode, env, toggles), group: c.group }));
  const last = cells[cells.length - 1];
  const moreMatch = last ? /^\+(\d+) more$/.exec(last.text) : null;
  const initialMore = moreMatch ? Number.parseInt(moreMatch[1], 10) : 0;
  const main = moreMatch ? cells.slice(0, -1) : [...cells];
  let droppedExtra = 0;
  const build = () => {
    const total = initialMore + droppedExtra;
    const tail = total > 0 ? [{ text: `+${total} more`, attention: "muted", group: "activity" }] : [];
    return joinCells(renderPairs([...main, ...tail]), seps);
  };
  let result = build();
  while (stripAnsiWidth(result) > termWidth && main.length > 0) {
    main.pop();
    droppedExtra += 1;
    result = build();
  }
  if (stripAnsiWidth(result) > termWidth) {
    result = truncateLine(result, termWidth);
  }
  return result;
}
function stripAnsiWidth(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07[^\x1b]*\x1b\]8;;\x07/g, (m) => {
    const inner = m.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\]8;;\x07/g, "");
    return inner;
  }).length;
}
var hushLayout = {
  name: "hush",
  pack(cells, termWidth, config) {
    const hushCells = cells.filter((c) => ("text" in c) && ("attention" in c));
    const now = Date.now();
    const env = process.env;
    const mode = glyphMode(config, env);
    const density = config.display.hush?.density ?? "compact";
    const seps = resolveSeparators(density, env);
    const toggles = {
      hyperlinks: config.display.hush?.hyperlinks !== false,
      animate: config.display.hush?.animate !== false,
      identityColors: config.display.hush?.identityColors === true
    };
    const headerCells = hushCells.filter((c) => c.group === "header");
    const metricsCells = hushCells.filter((c) => c.group === "metrics");
    const activityCells = hushCells.filter((c) => c.group === "activity");
    const cappedActivity = capActivityCells(activityCells);
    const line1Cells = [...headerCells, ...metricsCells];
    const line1 = truncateByPriority(line1Cells, now, mode, env, toggles, seps, termWidth);
    const line2 = packActivityLine(cappedActivity, now, mode, env, toggles, seps, termWidth);
    const lines = [];
    if (line1)
      lines.push(line1);
    const compactWhenIdle = config.display.hush?.compactWhenIdle !== false;
    if (compactWhenIdle) {
      if (line2)
        lines.push(line2);
    } else {
      lines.push(line2);
    }
    return lines;
  }
};

// src/render/layout/index.ts
var LAYOUTS = {
  row: rowLayout,
  hush: hushLayout
};

// src/render/index.ts
function isValidLayout(name) {
  return name === "row" || name === "hush";
}
function render(ctx) {
  const widgets = visibleWidgets(ctx.config);
  const rawLayout = ctx.config.display.layout;
  const layoutName = typeof rawLayout === "string" && isValidLayout(rawLayout) ? rawLayout : "row";
  const layout = LAYOUTS[layoutName];
  const termWidth = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);
  const cells = widgets.flatMap((w) => {
    if (layoutName === "hush" && w.renderHush) {
      const c2 = w.renderHush(ctx);
      if (!c2)
        return [];
      const arr = Array.isArray(c2) ? c2 : [c2];
      return arr.map((cell) => ({ ...cell, id: w.id, group: w.group, priority: cell.priority ?? w.priority }));
    }
    const c = w.render(ctx);
    return c ? [{ ...c, id: w.id, group: w.group }] : [];
  });
  const outputLines = layout.pack(cells, termWidth, ctx.config);
  if (outputLines.length === 0 || outputLines.every((l) => l.trim() === "")) {
    return color(ctx.config.colors.label, "ohud");
  }
  return outputLines.join(`
`);
}

// src/index.ts
var CONFIG_PATH = join5(homedir4(), ".claude/plugins/ohud/config.json");
mkdirSync3(join5(homedir4(), ".claude/plugins/ohud"), { recursive: true });
async function main() {
  const T0 = process.hrtime.bigint();
  const profile = process.env.OHUD_PROFILE === "1";
  if (process.argv.includes("--doctor")) {
    const cfg = await loadConfig(CONFIG_PATH);
    const out = await runDoctor({ host: cfg.ollama.host, configPath: CONFIG_PATH });
    console.log(out);
    return;
  }
  try {
    const stdin = await readStdin();
    if (!stdin) {
      console.log("ohud: no stdin (setup verification)");
      return;
    }
    const config = await loadConfig(CONFIG_PATH);
    const sessionId = stdin.session_id ?? "default";
    const [probe, transcript, gitStatus] = await Promise.all([
      probeOllama({
        host: config.ollama.host,
        sessionId,
        daemonTtlSeconds: config.ollama.daemonTtlSeconds,
        cloudModelsTtlSeconds: config.ollama.cloudModelsTtlSeconds,
        timeoutMs: config.ollama.probeTimeoutMs
      }),
      parseTranscript(stdin.transcript_path ?? ""),
      config.gitStatus.enabled ? getGitStatus(stdin.workspace?.current_dir ?? stdin.cwd) : Promise.resolve(null)
    ]);
    const mode = resolveMode(stdin, probe);
    writeLastModeState(mode, stdin.model?.id);
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
    const msg = err instanceof Error ? err.message : String(err);
    console.log("\x1B[31mohud: error — see /ohud doctor or ~/.claude/plugins/ohud/last-errors.log\x1B[0m");
    try {
      const logPath = join5(homedir4(), ".claude/plugins/ohud/last-errors.log");
      const stamp = new Date().toISOString();
      const line = `[${stamp}] ${msg}
`;
      appendFileSync2(logPath, line);
    } catch {}
    console.error("ohud: error", msg);
  }
}
if (__require.main == __require.module) {
  main();
}
export {
  main
};
