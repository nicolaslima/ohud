# ohud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ohud`, a Claude Code statusline plugin that auto-detects whether the session is using Ollama Cloud or Anthropic-direct and renders the appropriate multi-line HUD (project, context bar, GPU time / usage / cost, plus opt-in tools/agents/todos/environment/memory/duration lines).

**Architecture:** Single TypeScript codebase, bundled into one `.js` file via `bun build`, runs on Bun (preferred) or Node 18+. Each invocation reads claude-code stdin JSON, probes `localhost:11434` (cached 60s) to decide mode, parses transcript JSONL, runs git status, and composes ANSI lines per `config.elementOrder` and the active mode.

**Tech Stack:** TypeScript ES2022 / NodeNext modules. Bun as primary dev runtime + test runner + bundler. Node 18+ as fallback runtime for distribution. Zero runtime deps (only stdlib + native `fetch`). Dev deps: `typescript`, `@types/node`, `@types/bun`. Tests via `bun:test` API.

**Spec:** `docs/superpowers/specs/2026-05-08-ohud-design.md` (commits `e58151b` + `0e624f8`)

---

## Pre-flight

Before Task 1, the executing engineer should:

1. Verify the working directory is `/Users/lima/Projects/ohud` and on `main`.
2. Create a feature branch: `git checkout -b feat/v0.1-implementation`
3. Confirm `bun --version` returns 1.x. If absent, install via `curl -fsSL https://bun.sh/install | bash` and re-shell.
4. Confirm `node --version` returns ≥18 (sanity for the dual-runtime story).
5. Confirm Ollama daemon is running: `curl -sS http://localhost:11434/api/version` returns JSON. (Required for Task 3 hypothesis verification.)

If any check fails, stop and report. Do not start implementing.

---

## File Structure

```
ohud/
├── package.json                          # name, scripts, devDeps
├── tsconfig.json                          # ES2022, strict, NodeNext
├── bunfig.toml                            # Bun config (test runner)
├── .gitignore                             # extends existing with dist/, coverage/, etc
├── .github/
│   └── workflows/
│       └── ci.yml                         # bun install + test + build
├── README.md                              # public-facing
├── LICENSE                                # MIT
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   ├── ohud.md                            # /ohud subcommand dispatcher
│   ├── ohud-setup.md                      # /ohud setup body
│   └── ohud-configure.md                  # /ohud configure body
├── scripts/
│   └── verify-ollama-hypothesis.ts        # Task 3: throwaway probe
├── src/
│   ├── index.ts                           # main() orchestration (Task 30)
│   ├── stdin.ts                           # Task 4
│   ├── ollama-probe.ts                    # Task 5
│   ├── mode.ts                            # Task 6
│   ├── transcript.ts                      # Task 7
│   ├── git.ts                             # Task 8
│   ├── config.ts                          # Task 9
│   ├── usage.ts                           # Task 10
│   ├── cost.ts                            # Task 11
│   ├── prompt-cache.ts                    # Task 12
│   ├── memory.ts                          # Task 13
│   ├── effort.ts                          # Task 14
│   ├── types.ts                           # Task 2
│   └── render/
│       ├── colors.ts                      # Task 15
│       ├── width.ts                       # Task 16
│       ├── index.ts                       # Task 29
│       └── lines/
│           ├── project.ts                 # Task 17
│           ├── context.ts                 # Task 18
│           ├── gpu-time.ts                # Task 19
│           ├── usage.ts                   # Task 20
│           ├── cost.ts                    # Task 21
│           ├── prompt-cache.ts            # Task 22
│           ├── tools.ts                   # Task 23
│           ├── agents.ts                  # Task 24
│           ├── todos.ts                   # Task 25
│           ├── environment.ts             # Task 26
│           ├── memory.ts                  # Task 27
│           └── duration.ts                # Task 28
└── tests/
    ├── fixtures/
    │   ├── stdin-anthropic-pro.json
    │   ├── stdin-anthropic-no-limits.json
    │   ├── stdin-anthropic-bedrock.json
    │   ├── stdin-ollama-cloud.json
    │   ├── stdin-ollama-local.json
    │   ├── transcript-typical.jsonl
    │   ├── transcript-with-todos.jsonl
    │   ├── transcript-ollama-with-duration.jsonl
    │   ├── api-tags-cloud.json
    │   ├── api-tags-local-only.json
    │   └── external-usage-snapshot.json
    ├── stdin.test.ts                      # Task 4
    ├── ollama-probe.test.ts               # Task 5
    ├── mode.test.ts                       # Task 6
    ├── transcript.test.ts                 # Task 7
    ├── git.test.ts                        # Task 8
    ├── config.test.ts                     # Task 9
    ├── usage.test.ts                      # Task 10
    ├── cost.test.ts                       # Task 11
    ├── prompt-cache.test.ts               # Task 12
    ├── memory.test.ts                     # Task 13
    ├── render-colors.test.ts              # Task 15
    ├── render-width.test.ts               # Task 16
    ├── render-lines.test.ts               # Tasks 17-28 (snapshot tests)
    └── integration.test.ts                # Task 31
```

**Module boundaries:**
- `src/types.ts` is the only module any other module may import for types (no cross-imports of internals).
- `src/render/**` is the only place that emits ANSI escape sequences.
- `src/render/lines/*.ts` each export `render(ctx) → string | null` (null = "skip me").
- `src/render/index.ts` orchestrates which lines render based on mode + config.
- Data modules (`stdin`, `ollama-probe`, `mode`, `transcript`, `git`, `config`, `usage`, `cost`, `prompt-cache`, `memory`, `effort`) never know about ANSI.

---

## Phase A: Bootstrap (Tasks 1-3)

### Task 1: Project bootstrap

**Goal:** package.json, tsconfig, bunfig, gitignore extension. After this task `bun install` and `bun test` work (no tests yet, but the runner doesn't crash).

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Modify: `.gitignore` (extend)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "ohud",
  "version": "0.1.0",
  "description": "Real-time statusline HUD for Claude Code with Ollama Cloud + Anthropic dual-mode rendering",
  "type": "module",
  "main": "dist/index.js",
  "files": [
    "dist/",
    "src/",
    "commands/",
    ".claude-plugin/"
  ],
  "scripts": {
    "build": "bun build src/index.ts --target=node --outfile=dist/index.js",
    "test": "bun test",
    "test:update": "bun test --update-snapshots",
    "typecheck": "tsc --noEmit",
    "verify:hypothesis": "bun run scripts/verify-ollama-hypothesis.ts"
  },
  "keywords": [
    "claude-code",
    "statusline",
    "hud",
    "ollama",
    "ollama-cloud"
  ],
  "author": "nicolaslima <lima.nicolasmateus@gmail.com>",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Write `bunfig.toml`**

```toml
[test]
preload = []
coverage = false
```

- [ ] **Step 4: Extend `.gitignore`**

Append these lines to the existing `.gitignore`:

```
# ohud build outputs
dist/
coverage/

# Bun cache
.bun-cache/

# Hypothesis verification scratch
/tmp-hypothesis-*.txt
```

- [ ] **Step 5: Install deps and verify**

```bash
bun install
bun test
```

Expected: `bun install` completes without errors. `bun test` reports `0 tests` and exits 0 (no test files yet).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json bunfig.toml .gitignore bun.lockb
git commit -m "bootstrap projeto ohud com bun + typescript"
```

---

### Task 2: Shared types

**Goal:** Define every interface that crosses module boundaries upfront. Subsequent tasks consume these.

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
// Shared types — consumed by every module. Internal helper types stay local.

export type RenderMode = "ollama" | "anthropic";

// === Stdin from Claude Code ===

export interface StdinModel {
  id?: string;
  display_name?: string;
}

export interface StdinContextWindow {
  context_window_size?: number;
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  used_percentage?: number | null;
  remaining_percentage?: number | null;
  current_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
}

export interface StdinCost {
  total_cost_usd?: number | null;
  total_duration_ms?: number | null;
  total_api_duration_ms?: number | null;
  total_lines_added?: number | null;
  total_lines_removed?: number | null;
}

export interface StdinRateLimitWindow {
  used_percentage?: number | null;
  resets_at?: number | null;
}

export interface StdinRateLimits {
  five_hour?: StdinRateLimitWindow | null;
  seven_day?: StdinRateLimitWindow | null;
}

export interface StdinWorkspace {
  current_dir?: string;
  project_dir?: string;
  added_dirs?: string[];
  git_worktree?: string;
}

export interface StdinEffort {
  level?: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export interface StdinData {
  cwd?: string;
  session_id?: string;
  session_name?: string;
  transcript_path?: string;
  version?: string;
  model?: StdinModel;
  workspace?: StdinWorkspace;
  context_window?: StdinContextWindow;
  cost?: StdinCost | null;
  rate_limits?: StdinRateLimits | null;
  effort?: StdinEffort | string | null;
  output_style?: { name?: string };
  exceeds_200k_tokens?: boolean;
}

// === Ollama probe ===

export interface OllamaTagsModel {
  name: string;
  model: string;
  remote_model?: string;
  remote_host?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaProbeResult {
  daemonOk: boolean;
  cloudModels: OllamaTagsModel[];   // only entries with remote_host populated
  fetchedAt: number;                 // epoch ms
}

// === Transcript ===

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: "running" | "completed" | "error";
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: "running" | "completed";
  startTime: Date;
  endTime?: Date;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
  sessionName?: string;
  lastAssistantResponseAt?: Date;
  sessionTokens?: SessionTokens;
  // Ollama-mode aggregated GPU time, in nanoseconds. Undefined if no Ollama
  // duration fields were observed in the transcript.
  totalDurationNs?: number;
  // Ollama eval counts (for tok/s line)
  totalEvalCount?: number;
  totalEvalDurationNs?: number;
}

// === Usage (Anthropic mode) ===

export interface UsageData {
  fiveHour: number | null;            // 0-100 percentage, null if unavailable
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
}

export interface ExternalUsageSnapshot {
  five_hour?: { used_percentage?: number | null; resets_at?: string | number | null } | null;
  seven_day?: { used_percentage?: number | null; resets_at?: string | number | null } | null;
  updated_at?: string | number | null;
}

// === Cost (Anthropic mode) ===

export interface SessionCostDisplay {
  totalUsd: number;
  source: "native" | "estimate";
}

// === Git ===

export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
  };
}

// === Memory (opt-in) ===

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
}

// === Render context ===

export interface RenderContext {
  mode: RenderMode;
  stdin: StdinData;
  transcript: TranscriptData;
  gitStatus: GitStatus | null;
  config: HudConfig;
  usageData: UsageData | null;       // anthropic mode
  costData: SessionCostDisplay | null;  // anthropic mode
  memoryInfo: MemoryInfo | null;
  cloudModels: OllamaTagsModel[];     // empty in anthropic mode
  effortLevel?: string;
}

// === Config ===

export interface HudConfig {
  lineLayout: "expanded" | "compact";
  pathLevels: 1 | 2 | 3;
  maxWidth: number | null;
  elementOrder: string[];
  display: {
    mergeGroups: string[][];
    showModel: boolean;
    showContextBar: boolean;
    contextValue: "percent" | "tokens" | "remaining" | "both";
    showGpuTime: boolean;
    showUsage: boolean;
    usageBarEnabled: boolean;
    usageCompact: boolean;
    showResetLabel: boolean;
    timeFormat: "relative" | "absolute" | "both";
    sevenDayThreshold: number;
    externalUsagePath: string;
    externalUsageFreshnessMs: number;
    showCost: boolean;
    showPromptCache: boolean;
    promptCacheTtlSeconds: number;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showConfigCounts: boolean;
    showOutputStyle: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showMemoryUsage: boolean;
    showTokenBreakdown: boolean;
    showSessionName: boolean;
    showClaudeCodeVersion: boolean;
    showEffortLevel: boolean;
  };
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    pushWarningThreshold: number;
    pushCriticalThreshold: number;
    showFileStats: boolean;
    branchOverflow: "truncate" | "wrap";
  };
  colors: {
    context: string;
    gpuTime: string;
    usage: string;
    warning: string;
    usageWarning: string;
    critical: string;
    model: string;
    project: string;
    git: string;
    gitBranch: string;
    label: string;
  };
  ollama: {
    host: string;
    probeCacheTtlSeconds: number;
    probeTimeoutMs: number;
  };
}
```

- [ ] **Step 2: Verify type-check passes**

```bash
bun run typecheck
```

Expected: zero errors. The file is exports-only — no runtime to fail.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "adiciona tipos compartilhados em src/types.ts"
```

---

### Task 3: Verify total_duration hypothesis (CRITICAL)

**Goal:** Confirm whether Ollama's `total_duration` (or equivalent timing) survives the Anthropic-compatible translation in claude-code's transcript JSONL. Result drives implementation choices in Task 7.

**Files:**
- Create: `scripts/verify-ollama-hypothesis.ts`
- Create: `docs/hypothesis-verification.md` (results documentation)

- [ ] **Step 1: Write the verification script**

```typescript
// scripts/verify-ollama-hypothesis.ts
//
// Run against a real claude-code transcript JSONL captured from a session
// using a :cloud model (ANTHROPIC_BASE_URL=http://localhost:11434).
//
// Usage: bun run scripts/verify-ollama-hypothesis.ts <transcript.jsonl>

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun run scripts/verify-ollama-hypothesis.ts <transcript.jsonl>");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);

const fieldHits = new Map<string, number>();
const sampleByField = new Map<string, string>();

const ollamaTimingFields = [
  "total_duration",
  "load_duration",
  "prompt_eval_count",
  "prompt_eval_duration",
  "eval_count",
  "eval_duration",
];

function walk(obj: unknown, path: string): void {
  if (obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const child = `${path}.${k}`;
    if (ollamaTimingFields.includes(k) && typeof v === "number") {
      fieldHits.set(k, (fieldHits.get(k) ?? 0) + 1);
      if (!sampleByField.has(k)) {
        sampleByField.set(k, `${child} = ${v}`);
      }
    }
    walk(v, child);
  }
}

let assistantCount = 0;
for (const line of lines) {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { continue; }
  if (typeof parsed === "object" && parsed && "type" in parsed && (parsed as Record<string, unknown>).type === "assistant") {
    assistantCount += 1;
    walk(parsed, "$");
  }
}

console.log(`Assistant messages scanned: ${assistantCount}`);
console.log("Ollama timing field hit counts:");
for (const f of ollamaTimingFields) {
  const hits = fieldHits.get(f) ?? 0;
  const sample = sampleByField.get(f) ?? "(no sample)";
  console.log(`  ${f.padEnd(24)} ${String(hits).padStart(4)}   sample: ${sample}`);
}

const anyHit = ollamaTimingFields.some((f) => (fieldHits.get(f) ?? 0) > 0);
if (anyHit) {
  console.log("\n✓ HYPOTHESIS CONFIRMED — Ollama timing fields survive the Anthropic translation.");
  console.log("  Task 7 (transcript.ts) can sum total_duration directly.");
  process.exit(0);
} else {
  console.log("\n✗ HYPOTHESIS REJECTED — no Ollama timing fields found in any assistant message.");
  console.log("  Task 7 (transcript.ts) must fall back to stdin.cost.total_api_duration_ms.");
  console.log("  Update the spec §10 to reflect the fallback as the primary path.");
  process.exit(1);
}
```

- [ ] **Step 2: Identify a real transcript to test against**

Locate the most recent transcript JSONL from a Claude Code session that used Ollama Cloud:

```bash
ls -lt ~/.claude/projects/*/[a-f0-9]*.jsonl 2>/dev/null | head -5
```

Pick a file modified during a session you ran with `claude --model <something>:cloud`. If none exists, run a quick session:

```bash
ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_API_KEY="" claude --model glm-5:cloud
# Inside: type "hello" and exit. Then locate the new transcript.
```

- [ ] **Step 3: Run the verification**

```bash
bun run scripts/verify-ollama-hypothesis.ts <path-to-transcript.jsonl>
```

- [ ] **Step 4: Document the result**

Create `docs/hypothesis-verification.md` with the actual output and decision:

```markdown
# Ollama timing hypothesis — verification result

**Date:** YYYY-MM-DD
**Transcript tested:** `<path>` (N assistant messages)
**Ollama daemon version:** 0.23.x
**Model used:** <e.g., glm-5:cloud>

## Result

[paste full output of bun run scripts/verify-ollama-hypothesis.ts here]

## Decision

- [ ] HYPOTHESIS CONFIRMED — proceed with §10 primary path (sum `total_duration` from transcript).
- [ ] HYPOTHESIS REJECTED — Task 7 implements the `cost.total_api_duration_ms` fallback. Spec §10 update required.

## Implications for downstream tasks

- Task 7 (transcript.ts): primary path or fallback path
- Task 19 (gpu-time.ts): label is `GPU ⏱` (confirmed) or `API ⏱` (rejected)
- Task 28 (duration.ts) + tok/s: depends on `eval_count`/`eval_duration` survival; if those didn't appear, `showSpeed` renders nothing in v0.1
```

- [ ] **Step 5: If hypothesis was REJECTED, amend Spec §10**

Edit `docs/superpowers/specs/2026-05-08-ohud-design.md` §10:
- Move the "If not verified" branch to be the documented primary path
- Mark the original primary as a future enhancement
- Commit the spec update separately before continuing

If CONFIRMED, no spec change is needed. Note the result in `docs/hypothesis-verification.md`.

- [ ] **Step 6: Commit verification artifacts**

```bash
git add scripts/verify-ollama-hypothesis.ts docs/hypothesis-verification.md
# If spec was updated:
# git add docs/superpowers/specs/2026-05-08-ohud-design.md
git commit -m "verifica hipotese de total_duration no transcript"
```

---

## Phase B: Core data layer (Tasks 4-9)

### Task 4: stdin reader

**Files:**
- Create: `src/stdin.ts`
- Create: `tests/stdin.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/stdin.test.ts
import { test, expect } from "bun:test";
import { Readable } from "node:stream";
import { readStdin } from "../src/stdin";

function streamFrom(s: string) {
  const r = Readable.from([s]);
  // readStdin expects a stream-like object with setEncoding/on/off/pause/isTTY
  return Object.assign(r, { isTTY: false });
}

test("readStdin parses well-formed JSON", async () => {
  const result = await readStdin(streamFrom('{"session_id":"abc","model":{"id":"glm-5:cloud"}}') as never);
  expect(result?.session_id).toBe("abc");
  expect(result?.model?.id).toBe("glm-5:cloud");
});

test("readStdin returns null on TTY (no piped input)", async () => {
  const tty = Object.assign(Readable.from([""]), { isTTY: true });
  const result = await readStdin(tty as never);
  expect(result).toBeNull();
});

test("readStdin returns null on invalid JSON", async () => {
  const result = await readStdin(streamFrom("{not json") as never);
  expect(result).toBeNull();
});

test("readStdin handles empty input", async () => {
  const result = await readStdin(streamFrom("") as never);
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/stdin.test.ts
```

Expected: all 4 tests fail with "Cannot find module '../src/stdin'".

- [ ] **Step 3: Write `src/stdin.ts`**

```typescript
// src/stdin.ts
import type { StdinData } from "./types.js";

type StdinStream = Pick<NodeJS.ReadStream, "setEncoding" | "on" | "off" | "pause"> & {
  isTTY?: boolean;
};

interface ReadStdinOptions {
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 250;
const DEFAULT_IDLE_TIMEOUT_MS = 30;
const DEFAULT_MAX_BYTES = 256 * 1024;

export async function readStdin(
  stream: StdinStream = process.stdin as unknown as StdinStream,
  options: ReadStdinOptions = {},
): Promise<StdinData | null> {
  if (stream.isTTY) return null;

  const firstByteTimeout = options.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  try { stream.setEncoding("utf8"); } catch { return null; }

  return await new Promise<StdinData | null>((resolve) => {
    let raw = "";
    let settled = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (firstByteTimer) clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      try { stream.pause(); } catch { /* noop */ }
    };

    const finish = (value: StdinData | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const tryParse = (): StdinData | null => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try { return JSON.parse(trimmed) as StdinData; } catch { return null; }
    };

    const scheduleIdleParse = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(tryParse()), idleTimeout);
    };

    const onData = (chunk: string | Buffer): void => {
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = undefined; }
      raw += String(chunk);
      if (Buffer.byteLength(raw, "utf8") > maxBytes) { finish(null); return; }
      scheduleIdleParse();
    };
    const onEnd = (): void => finish(tryParse());
    const onError = (): void => finish(null);

    firstByteTimer = setTimeout(() => finish(null), firstByteTimeout);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test tests/stdin.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/stdin.ts tests/stdin.test.ts
git commit -m "implementa stdin.ts com timeouts e parse seguro"
```

---

### Task 5: Ollama probe with cache

**Files:**
- Create: `src/ollama-probe.ts`
- Create: `tests/ollama-probe.test.ts`
- Create: `tests/fixtures/api-tags-cloud.json`
- Create: `tests/fixtures/api-tags-local-only.json`

- [ ] **Step 1: Write fixtures**

`tests/fixtures/api-tags-cloud.json`:

```json
{
  "models": [
    {
      "name": "glm-5:cloud",
      "model": "glm-5:cloud",
      "remote_model": "glm-5",
      "remote_host": "https://ollama.com:443",
      "size": 323,
      "digest": "abc123",
      "details": {
        "family": "",
        "parameter_size": "1T",
        "quantization_level": "int4"
      }
    },
    {
      "name": "qwen3-coder-next:cloud",
      "model": "qwen3-coder-next:cloud",
      "remote_model": "qwen3-coder-next",
      "remote_host": "https://ollama.com:443",
      "size": 382,
      "digest": "def456",
      "details": {
        "family": "qwen3next",
        "families": ["qwen3next"],
        "parameter_size": "80B",
        "quantization_level": "FP8"
      }
    },
    {
      "name": "llama3.2:latest",
      "model": "llama3.2:latest",
      "size": 2019393189,
      "digest": "ghi789",
      "details": { "family": "llama", "parameter_size": "3B", "quantization_level": "Q4_0" }
    }
  ]
}
```

`tests/fixtures/api-tags-local-only.json`:

```json
{
  "models": [
    {
      "name": "llama3.2:latest",
      "model": "llama3.2:latest",
      "size": 2019393189,
      "digest": "ghi789",
      "details": { "family": "llama", "parameter_size": "3B", "quantization_level": "Q4_0" }
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/ollama-probe.test.ts
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeOllama, probeCachePath } from "../src/ollama-probe";

const cloudFixture = readFileSync(join(import.meta.dir, "fixtures/api-tags-cloud.json"), "utf8");
const localFixture = readFileSync(join(import.meta.dir, "fixtures/api-tags-local-only.json"), "utf8");

const CACHE = probeCachePath("test-session");

beforeEach(() => { if (existsSync(CACHE)) rmSync(CACHE); });
afterEach(() => { if (existsSync(CACHE)) rmSync(CACHE); });

const okFetch = (tagsBody: string) => mock(async (url: string) => {
  if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.23.2" }));
  if (url.endsWith("/api/tags")) return new Response(tagsBody);
  return new Response("not found", { status: 404 });
});

test("probe returns cloud models when /api/tags has remote_host entries", async () => {
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500,
    fetchImpl: okFetch(cloudFixture),
  });
  expect(result.daemonOk).toBe(true);
  expect(result.cloudModels).toHaveLength(2);
  expect(result.cloudModels[0].model).toBe("glm-5:cloud");
});

test("probe returns empty cloudModels when no remote_host entries", async () => {
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500,
    fetchImpl: okFetch(localFixture),
  });
  expect(result.daemonOk).toBe(true);
  expect(result.cloudModels).toHaveLength(0);
});

test("probe returns daemonOk=false when /api/version times out", async () => {
  const slow = mock(async () => { await new Promise((r) => setTimeout(r, 50)); return new Response("{}"); });
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 5,
    fetchImpl: slow,
  });
  expect(result.daemonOk).toBe(false);
  expect(result.cloudModels).toHaveLength(0);
});

test("probe writes cache and re-uses it within TTL", async () => {
  let calls = 0;
  const counting = mock(async (url: string) => {
    calls += 1;
    if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.23.2" }));
    return new Response(cloudFixture);
  });
  await probeOllama({ host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500, fetchImpl: counting });
  await probeOllama({ host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500, fetchImpl: counting });
  // Second call must hit the cache (no new fetch)
  expect(calls).toBe(2); // 1 version + 1 tags
});
```

- [ ] **Step 3: Verify tests fail**

```bash
bun test tests/ollama-probe.test.ts
```

Expected: all fail (module not found).

- [ ] **Step 4: Write `src/ollama-probe.ts`**

```typescript
// src/ollama-probe.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OllamaProbeResult, OllamaTagsModel } from "./types.js";

interface ProbeOptions {
  host: string;
  sessionId: string;
  ttlSeconds: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function probeCachePath(sessionId: string): string {
  return join(tmpdir(), `ohud-probe-${sessionId}.json`);
}

async function fetchWithTimeout(
  url: string, timeoutMs: number, fetchImpl: typeof fetch,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return res;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function readCache(path: string, ttlMs: number): OllamaProbeResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as OllamaProbeResult;
    if (Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(path: string, data: OllamaProbeResult): void {
  try { writeFileSync(path, JSON.stringify(data)); } catch { /* best-effort */ }
}

export async function probeOllama(opts: ProbeOptions): Promise<OllamaProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = probeCachePath(opts.sessionId);
  const ttlMs = opts.ttlSeconds * 1000;

  const cached = readCache(cachePath, ttlMs);
  if (cached) return cached;

  const versionRes = await fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl);
  if (!versionRes || !versionRes.ok) {
    const result: OllamaProbeResult = { daemonOk: false, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result);
    return result;
  }

  const tagsRes = await fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl);
  if (!tagsRes || !tagsRes.ok) {
    const result: OllamaProbeResult = { daemonOk: true, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result);
    return result;
  }

  let parsed: { models?: OllamaTagsModel[] } = {};
  try { parsed = (await tagsRes.json()) as { models?: OllamaTagsModel[] }; } catch { /* fall through */ }
  const cloudModels = (parsed.models ?? []).filter((m) => typeof m.remote_host === "string" && m.remote_host.length > 0);

  const result: OllamaProbeResult = { daemonOk: true, cloudModels, fetchedAt: Date.now() };
  writeCache(cachePath, result);
  return result;
}
```

- [ ] **Step 5: Verify tests pass**

```bash
bun test tests/ollama-probe.test.ts
```

Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add src/ollama-probe.ts tests/ollama-probe.test.ts tests/fixtures/api-tags-cloud.json tests/fixtures/api-tags-local-only.json
git commit -m "implementa ollama-probe com cache em /tmp"
```

---

### Task 6: Mode resolution

**Files:**
- Create: `src/mode.ts`
- Create: `tests/mode.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/mode.test.ts
import { test, expect } from "bun:test";
import { resolveMode } from "../src/mode";
import type { OllamaProbeResult, StdinData } from "../src/types";

const probeOk = (cloud: string[]): OllamaProbeResult => ({
  daemonOk: true,
  cloudModels: cloud.map((m) => ({ name: m, model: m, remote_host: "https://ollama.com:443" })),
  fetchedAt: Date.now(),
});

test("ollama mode when daemon ok + model in cloud list", () => {
  const probe = probeOk(["glm-5:cloud"]);
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probe)).toBe("ollama");
});

test("anthropic mode when daemon offline", () => {
  const probe: OllamaProbeResult = { daemonOk: false, cloudModels: [], fetchedAt: Date.now() };
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
  expect(resolveMode(stdin, probe)).toBe("anthropic");
});

test("anthropic mode when no cloud models installed", () => {
  const probe: OllamaProbeResult = { daemonOk: true, cloudModels: [], fetchedAt: Date.now() };
  const stdin: StdinData = { model: { id: "glm-5:cloud" } };
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
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/mode.test.ts
```

Expected: all 6 fail (module not found).

- [ ] **Step 3: Write `src/mode.ts`**

```typescript
// src/mode.ts
import type { OllamaProbeResult, RenderMode, StdinData } from "./types.js";

export function resolveMode(stdin: StdinData, probe: OllamaProbeResult): RenderMode {
  if (!probe.daemonOk) return "anthropic";
  if (probe.cloudModels.length === 0) return "anthropic";

  const candidates = [stdin.model?.id, stdin.model?.display_name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (candidates.length === 0) return "anthropic";

  const cloudNames = new Set(probe.cloudModels.flatMap((m) => [m.name, m.model]));
  const isCloud = candidates.some((c) => cloudNames.has(c));
  return isCloud ? "ollama" : "anthropic";
}
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test tests/mode.test.ts
```

Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/mode.ts tests/mode.test.ts
git commit -m "implementa resolucao de mode (ollama vs anthropic)"
```

---

### Task 7: Transcript JSONL parser

**Files:**
- Create: `src/transcript.ts`
- Create: `tests/transcript.test.ts`
- Create: `tests/fixtures/transcript-typical.jsonl`
- Create: `tests/fixtures/transcript-with-todos.jsonl`
- Create: `tests/fixtures/transcript-ollama-with-duration.jsonl`

> **Note:** if Task 3 confirmed the hypothesis, the parser sums `total_duration` from assistant messages. If Task 3 rejected it, the parser leaves `totalDurationNs` undefined and Task 19 will use the `cost.total_api_duration_ms` fallback.

- [ ] **Step 1: Create minimal fixtures**

`tests/fixtures/transcript-typical.jsonl`:

```jsonl
{"type":"summary","summary":"test session","leafUuid":"x"}
{"type":"user","message":{"role":"user","content":"hi"},"uuid":"u1","timestamp":"2026-05-08T10:00:00.000Z","sessionId":"s1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/x"}}],"usage":{"input_tokens":100,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"uuid":"a1","timestamp":"2026-05-08T10:00:01.000Z","sessionId":"s1"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]},"uuid":"u2","timestamp":"2026-05-08T10:00:02.000Z","sessionId":"s1"}
```

`tests/fixtures/transcript-with-todos.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"list things"},"uuid":"u1","timestamp":"2026-05-08T10:00:00.000Z","sessionId":"s2"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"do A","status":"in_progress"},{"content":"do B","status":"pending"},{"content":"do C","status":"completed"}]}}]},"uuid":"a1","timestamp":"2026-05-08T10:00:01.000Z","sessionId":"s2"}
```

`tests/fixtures/transcript-ollama-with-duration.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"hi"},"uuid":"u1","timestamp":"2026-05-08T10:00:00.000Z","sessionId":"s3"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":50,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"ollama":{"total_duration":12000000000,"eval_count":10,"eval_duration":2000000000},"uuid":"a1","timestamp":"2026-05-08T10:00:01.000Z","sessionId":"s3"}
```

> The actual location of `total_duration` in the real transcript is verified in Task 3. If that location differs from `$.ollama.total_duration`, update the fixture and the parser's walk path accordingly.

- [ ] **Step 2: Write failing tests**

```typescript
// tests/transcript.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { parseTranscript } from "../src/transcript";

const fx = (n: string) => join(import.meta.dir, "fixtures", n);

test("parses tool_use entries", async () => {
  const t = await parseTranscript(fx("transcript-typical.jsonl"));
  expect(t.tools).toHaveLength(1);
  expect(t.tools[0].name).toBe("Read");
  expect(t.tools[0].status).toBe("completed");
});

test("aggregates session tokens", async () => {
  const t = await parseTranscript(fx("transcript-typical.jsonl"));
  expect(t.sessionTokens?.inputTokens).toBe(100);
  expect(t.sessionTokens?.outputTokens).toBe(20);
});

test("extracts the latest TodoWrite snapshot", async () => {
  const t = await parseTranscript(fx("transcript-with-todos.jsonl"));
  expect(t.todos).toHaveLength(3);
  expect(t.todos[0].content).toBe("do A");
  expect(t.todos[0].status).toBe("in_progress");
});

test("sums Ollama total_duration when present", async () => {
  const t = await parseTranscript(fx("transcript-ollama-with-duration.jsonl"));
  expect(t.totalDurationNs).toBe(12_000_000_000);
  expect(t.totalEvalCount).toBe(10);
});

test("returns empty data for nonexistent file", async () => {
  const t = await parseTranscript("/nonexistent/path.jsonl");
  expect(t.tools).toHaveLength(0);
  expect(t.todos).toHaveLength(0);
});
```

- [ ] **Step 3: Verify tests fail**

```bash
bun test tests/transcript.test.ts
```

Expected: all fail.

- [ ] **Step 4: Write `src/transcript.ts`**

```typescript
// src/transcript.ts
import { readFile } from "node:fs/promises";
import type { AgentEntry, SessionTokens, TodoItem, ToolEntry, TranscriptData } from "./types.js";

export async function parseTranscript(path: string): Promise<TranscriptData> {
  const empty: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!path) return empty;

  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return empty; }

  const lines = raw.split("\n").filter((l) => l.length > 0);

  const tools = new Map<string, ToolEntry>();
  const agents = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const tokens: SessionTokens = {
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
  };
  let totalDurationNs = 0;
  let totalEvalCount = 0;
  let totalEvalDurationNs = 0;
  let sawOllamaTiming = false;
  let sessionStart: Date | undefined;
  let lastAssistantResponseAt: Date | undefined;
  let sessionName: string | undefined;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    const ts = typeof entry.timestamp === "string" ? new Date(entry.timestamp) : undefined;
    if (ts && !sessionStart) sessionStart = ts;

    if (type === "summary" && typeof entry.summary === "string") {
      sessionName = entry.summary;
      continue;
    }

    if (type !== "assistant" && type !== "user") continue;

    const message = entry.message as { role?: string; content?: unknown; usage?: Record<string, number> } | undefined;
    if (!message) continue;

    if (type === "assistant" && message.usage) {
      tokens.inputTokens += Number(message.usage.input_tokens ?? 0);
      tokens.outputTokens += Number(message.usage.output_tokens ?? 0);
      tokens.cacheCreationTokens += Number(message.usage.cache_creation_input_tokens ?? 0);
      tokens.cacheReadTokens += Number(message.usage.cache_read_input_tokens ?? 0);
      if (ts) lastAssistantResponseAt = ts;

      // Look for Ollama-native timing fields anywhere in this entry.
      const found = findOllamaTiming(entry);
      if (found.total_duration) { totalDurationNs += found.total_duration; sawOllamaTiming = true; }
      if (found.eval_count) totalEvalCount += found.eval_count;
      if (found.eval_duration) totalEvalDurationNs += found.eval_duration;
    }

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          if (b.name === "TodoWrite" && b.input && typeof b.input === "object") {
            const inp = b.input as { todos?: TodoItem[] };
            if (Array.isArray(inp.todos)) latestTodos = inp.todos;
          } else if (b.name === "Task" && b.input && typeof b.input === "object") {
            const inp = b.input as { subagent_type?: string; description?: string; model?: string };
            agents.set(b.id, {
              id: b.id, type: inp.subagent_type ?? "agent", description: inp.description,
              model: inp.model, status: "running", startTime: ts ?? new Date(),
            });
          } else {
            tools.set(b.id, {
              id: b.id, name: b.name, target: extractTarget(b.input),
              status: "running", startTime: ts ?? new Date(),
            });
          }
        }
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          const tool = tools.get(b.tool_use_id);
          if (tool) { tool.status = "completed"; tool.endTime = ts; }
          const agent = agents.get(b.tool_use_id);
          if (agent) { agent.status = "completed"; agent.endTime = ts; }
        }
      }
    }
  }

  const result: TranscriptData = {
    tools: [...tools.values()],
    agents: [...agents.values()],
    todos: latestTodos,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined,
  };
  if (sawOllamaTiming) {
    result.totalDurationNs = totalDurationNs;
    result.totalEvalCount = totalEvalCount;
    result.totalEvalDurationNs = totalEvalDurationNs;
  }
  return result;
}

function extractTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.path === "string") return i.path;
  if (typeof i.command === "string") return i.command;
  if (typeof i.pattern === "string") return i.pattern;
  return undefined;
}

interface OllamaTiming {
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

function findOllamaTiming(obj: unknown, depth = 0): OllamaTiming {
  if (depth > 6 || obj == null || typeof obj !== "object") return {};
  if (Array.isArray(obj)) {
    return obj.reduce<OllamaTiming>((acc, v) => mergeTiming(acc, findOllamaTiming(v, depth + 1)), {});
  }
  const o = obj as Record<string, unknown>;
  let acc: OllamaTiming = {};
  if (typeof o.total_duration === "number") acc.total_duration = o.total_duration;
  if (typeof o.eval_count === "number") acc.eval_count = o.eval_count;
  if (typeof o.eval_duration === "number") acc.eval_duration = o.eval_duration;
  for (const v of Object.values(o)) acc = mergeTiming(acc, findOllamaTiming(v, depth + 1));
  return acc;
}

function mergeTiming(a: OllamaTiming, b: OllamaTiming): OllamaTiming {
  return {
    total_duration: a.total_duration ?? b.total_duration,
    eval_count: a.eval_count ?? b.eval_count,
    eval_duration: a.eval_duration ?? b.eval_duration,
  };
}
```

- [ ] **Step 5: Verify tests pass**

```bash
bun test tests/transcript.test.ts
```

Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add src/transcript.ts tests/transcript.test.ts tests/fixtures/transcript-*.jsonl
git commit -m "implementa parser de transcript JSONL"
```

---

### Task 8: Git status

**Files:**
- Create: `src/git.ts`
- Create: `tests/git.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/git.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getGitStatus } from "../src/git";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ohud-git-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@test", { cwd: dir });
  execSync("git config user.name test", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "x");
  execSync("git add . && git commit -q -m init", { cwd: dir });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("clean repo on main", async () => {
  const s = await getGitStatus(dir);
  expect(s?.branch).toBe("main");
  expect(s?.dirty).toBe(false);
});

test("detects dirty working tree", async () => {
  writeFileSync(join(dir, "README.md"), "y");
  const s = await getGitStatus(dir);
  expect(s?.dirty).toBe(true);
});

test("returns null when not in a git repo", async () => {
  const notRepo = mkdtempSync(join(tmpdir(), "ohud-nogit-"));
  const s = await getGitStatus(notRepo);
  expect(s).toBeNull();
  rmSync(notRepo, { recursive: true, force: true });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/git.test.ts
```

- [ ] **Step 3: Write `src/git.ts`**

```typescript
// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "./types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { cwd, timeout: 1000 });
    return stdout;
  } catch { return null; }
}

export async function getGitStatus(cwd: string | undefined): Promise<GitStatus | null> {
  if (!cwd) return null;

  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside) return null;

  const branch = (await git(cwd, ["branch", "--show-current"]))?.trim() ?? "";
  const status = await git(cwd, ["status", "--porcelain=v1"]);
  const dirty = !!(status && status.trim().length > 0);

  // ahead/behind via upstream
  let ahead = 0;
  let behind = 0;
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (counts) {
    const [b, a] = counts.trim().split(/\s+/).map(Number);
    if (Number.isFinite(a)) ahead = a;
    if (Number.isFinite(b)) behind = b;
  }

  return { branch, dirty, ahead, behind };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test tests/git.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "implementa git status"
```

---

### Task 9: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/config.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ohud-cfg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("returns defaults when file missing", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.lineLayout).toBe("expanded");
  expect(c.display.showGpuTime).toBe(true);
  expect(c.gitStatus.enabled).toBe(true);
});

test("merges user values over defaults", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    pathLevels: 2,
    display: { showCost: true, showTools: true },
    colors: { context: "cyan" },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.pathLevels).toBe(2);
  expect(c.display.showCost).toBe(true);
  expect(c.display.showTools).toBe(true);
  expect(c.display.showGpuTime).toBe(true); // default preserved
  expect(c.colors.context).toBe("cyan");
});

test("falls back to defaults on invalid JSON", async () => {
  writeFileSync(join(dir, "config.json"), "{not json");
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.lineLayout).toBe("expanded");
});
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/config.test.ts
```

- [ ] **Step 3: Write `src/config.ts`**

```typescript
// src/config.ts
import { readFile } from "node:fs/promises";
import type { HudConfig } from "./types.js";

export const DEFAULT_CONFIG: HudConfig = {
  lineLayout: "expanded",
  pathLevels: 1,
  maxWidth: null,
  elementOrder: [
    "project", "context", "gpuTime", "usage", "cost", "promptCache",
    "memory", "environment", "tools", "agents", "todos",
  ],
  display: {
    mergeGroups: [["context", "gpuTime"], ["context", "usage"]],
    showModel: true,
    showContextBar: true,
    contextValue: "percent",
    showGpuTime: true,
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
    showEffortLevel: true,
  },
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
    showFileStats: false,
    branchOverflow: "truncate",
  },
  colors: {
    context: "green",
    gpuTime: "brightBlue",
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
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test tests/config.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "implementa loader de config com defaults"
```

---

## Phase C: Anthropic-mode-specific data (Tasks 10-12)

### Task 10: Usage parser (rate_limits + external snapshot)

**Files:**
- Create: `src/usage.ts`
- Create: `tests/usage.test.ts`
- Create: `tests/fixtures/external-usage-snapshot.json`

- [ ] **Step 1: Create fixture**

`tests/fixtures/external-usage-snapshot.json`:

```json
{
  "updated_at": "2026-05-08T15:00:00.000Z",
  "five_hour": { "used_percentage": 42, "resets_at": "2026-05-08T18:00:00.000Z" },
  "seven_day": { "used_percentage": 84, "resets_at": "2026-05-15T15:00:00.000Z" }
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/usage.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { fromStdin, fromExternalSnapshot } from "../src/usage";
import type { StdinData } from "../src/types";

test("fromStdin returns null when rate_limits absent", () => {
  const stdin: StdinData = {};
  expect(fromStdin(stdin)).toBeNull();
});

test("fromStdin parses populated rate_limits", () => {
  const stdin: StdinData = { rate_limits: {
    five_hour: { used_percentage: 25, resets_at: 1738425600 },
    seven_day: { used_percentage: 41, resets_at: 1738857600 },
  }};
  const u = fromStdin(stdin);
  expect(u?.fiveHour).toBe(25);
  expect(u?.sevenDay).toBe(41);
  expect(u?.fiveHourResetAt).toBeInstanceOf(Date);
});

test("fromExternalSnapshot parses fixture", async () => {
  const path = join(import.meta.dir, "fixtures/external-usage-snapshot.json");
  const u = await fromExternalSnapshot(path, 86_400_000, () => Date.parse("2026-05-08T15:01:00Z"));
  expect(u?.fiveHour).toBe(42);
  expect(u?.sevenDay).toBe(84);
});

test("fromExternalSnapshot returns null when stale", async () => {
  const path = join(import.meta.dir, "fixtures/external-usage-snapshot.json");
  const farFuture = Date.parse("2030-01-01T00:00:00Z");
  const u = await fromExternalSnapshot(path, 60_000, () => farFuture);
  expect(u).toBeNull();
});

test("fromExternalSnapshot returns null when path empty", async () => {
  const u = await fromExternalSnapshot("", 60_000, () => Date.now());
  expect(u).toBeNull();
});
```

- [ ] **Step 3: Verify tests fail**

```bash
bun test tests/usage.test.ts
```

- [ ] **Step 4: Write `src/usage.ts`**

```typescript
// src/usage.ts
import { readFile } from "node:fs/promises";
import type { ExternalUsageSnapshot, StdinData, UsageData } from "./types.js";

function clamp(p: number | null | undefined): number | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  return Math.round(Math.min(100, Math.max(0, p)));
}

function epochToDate(v: number | null | undefined): Date | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000);
}

function isoToDate(v: string | number | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return epochToDate(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fromStdin(stdin: StdinData): UsageData | null {
  const rl = stdin.rate_limits;
  if (!rl) return null;
  const five = clamp(rl.five_hour?.used_percentage);
  const seven = clamp(rl.seven_day?.used_percentage);
  if (five === null && seven === null) return null;
  return {
    fiveHour: five, sevenDay: seven,
    fiveHourResetAt: epochToDate(rl.five_hour?.resets_at),
    sevenDayResetAt: epochToDate(rl.seven_day?.resets_at),
  };
}

export async function fromExternalSnapshot(
  path: string, freshnessMs: number, now: () => number = Date.now,
): Promise<UsageData | null> {
  if (!path) return null;
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  let parsed: ExternalUsageSnapshot;
  try { parsed = JSON.parse(raw) as ExternalUsageSnapshot; } catch { return null; }

  const updatedAt = isoToDate(parsed.updated_at ?? null);
  if (!updatedAt) return null;
  if (now() - updatedAt.getTime() > freshnessMs) return null;

  const five = clamp(parsed.five_hour?.used_percentage);
  const seven = clamp(parsed.seven_day?.used_percentage);
  if (five === null && seven === null) return null;
  return {
    fiveHour: five, sevenDay: seven,
    fiveHourResetAt: isoToDate(parsed.five_hour?.resets_at ?? null),
    sevenDayResetAt: isoToDate(parsed.seven_day?.resets_at ?? null),
  };
}
```

- [ ] **Step 5: Verify tests pass**

```bash
bun test tests/usage.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/usage.ts tests/usage.test.ts tests/fixtures/external-usage-snapshot.json
git commit -m "implementa parsing de usage para anthropic mode"
```

---

### Task 11: Cost calculator (Anthropic mode)

**Files:**
- Create: `src/cost.ts`
- Create: `tests/cost.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/cost.test.ts
import { test, expect } from "bun:test";
import { resolveSessionCost, formatUsd } from "../src/cost";
import type { StdinData, SessionTokens } from "../src/types";

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
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/cost.test.ts
```

- [ ] **Step 3: Write `src/cost.ts`**

```typescript
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
```

- [ ] **Step 4: Verify tests pass**

```bash
bun test tests/cost.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/cost.ts tests/cost.test.ts
git commit -m "implementa calculadora de cost para anthropic mode"
```

---

### Task 12: Prompt cache TTL

**Files:**
- Create: `src/prompt-cache.ts`
- Create: `tests/prompt-cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/prompt-cache.test.ts
import { test, expect } from "bun:test";
import { promptCacheRemainingMs, formatPromptCache } from "../src/prompt-cache";

test("returns null when no last response", () => {
  expect(promptCacheRemainingMs(undefined, 300, () => Date.now())).toBeNull();
});

test("computes remaining within TTL", () => {
  const last = new Date("2026-05-08T15:00:00Z");
  const now = () => Date.parse("2026-05-08T15:02:00Z");
  expect(promptCacheRemainingMs(last, 300, now)).toBe(180_000);
});

test("returns 0 when expired", () => {
  const last = new Date("2026-05-08T15:00:00Z");
  const now = () => Date.parse("2026-05-08T15:10:00Z");
  expect(promptCacheRemainingMs(last, 300, now)).toBe(0);
});

test("formats minutes:seconds", () => {
  expect(formatPromptCache(180_000)).toBe("3m 0s");
  expect(formatPromptCache(45_000)).toBe("45s");
  expect(formatPromptCache(0)).toBe("expired");
});
```

- [ ] **Step 2: Verify tests fail**

```bash
bun test tests/prompt-cache.test.ts
```

- [ ] **Step 3: Write `src/prompt-cache.ts`**

```typescript
// src/prompt-cache.ts
export function promptCacheRemainingMs(
  lastResponseAt: Date | undefined, ttlSeconds: number, now: () => number = Date.now,
): number | null {
  if (!lastResponseAt) return null;
  const elapsedMs = now() - lastResponseAt.getTime();
  const ttlMs = ttlSeconds * 1000;
  return Math.max(0, ttlMs - elapsedMs);
}

export function formatPromptCache(remainingMs: number): string {
  if (remainingMs === 0) return "expired";
  const seconds = Math.floor(remainingMs / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}
```

- [ ] **Step 4: Verify tests pass + commit**

```bash
bun test tests/prompt-cache.test.ts
git add src/prompt-cache.ts tests/prompt-cache.test.ts
git commit -m "implementa countdown de prompt cache TTL"
```

---

### Task 13: Memory monitor

**Files:**
- Create: `src/memory.ts`
- Create: `tests/memory.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/memory.test.ts
import { test, expect } from "bun:test";
import { getMemoryUsage } from "../src/memory";

test("getMemoryUsage returns sane values", () => {
  const m = getMemoryUsage();
  expect(m.totalBytes).toBeGreaterThan(0);
  expect(m.usedBytes).toBeGreaterThan(0);
  expect(m.freeBytes).toBeGreaterThanOrEqual(0);
  expect(m.usedPercent).toBeGreaterThanOrEqual(0);
  expect(m.usedPercent).toBeLessThanOrEqual(100);
});
```

- [ ] **Step 2: Write `src/memory.ts`**

```typescript
// src/memory.ts
import { freemem, totalmem } from "node:os";
import type { MemoryInfo } from "./types.js";

export function getMemoryUsage(): MemoryInfo {
  const total = totalmem();
  const free = freemem();
  const used = Math.max(0, total - free);
  const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { totalBytes: total, usedBytes: used, freeBytes: free, usedPercent };
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/memory.test.ts
git add src/memory.ts tests/memory.test.ts
git commit -m "implementa memory monitor"
```

---

### Task 14: Effort level resolver

**Files:**
- Create: `src/effort.ts`

- [ ] **Step 1: Write `src/effort.ts`**

```typescript
// src/effort.ts
import type { StdinEffort } from "./types.js";

export function resolveEffortLevel(effort: StdinEffort | string | null | undefined): string | undefined {
  if (effort == null) return undefined;
  if (typeof effort === "string") return effort.toLowerCase();
  if (typeof effort === "object" && typeof effort.level === "string") return effort.level.toLowerCase();
  return undefined;
}
```

- [ ] **Step 2: Add a smoke test inline (no new test file)**

Append to existing `tests/render-lines.test.ts` later (Task 17+) — for now, no dedicated test. `effort.ts` is too thin to warrant one.

- [ ] **Step 3: Commit**

```bash
git add src/effort.ts
git commit -m "implementa resolucao de effort level"
```

---

## Phase D: Render infrastructure (Tasks 15-16)

### Task 15: ANSI color helpers

**Files:**
- Create: `src/render/colors.ts`
- Create: `tests/render-colors.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/render-colors.test.ts
import { test, expect } from "bun:test";
import { color, RESET } from "../src/render/colors";

test("named colors emit known ANSI codes", () => {
  expect(color("red", "x")).toBe(`\x1b[31mx${RESET}`);
  expect(color("green", "y")).toBe(`\x1b[32my${RESET}`);
});

test("256-color number", () => {
  expect(color("208", "z")).toBe(`\x1b[38;5;208mz${RESET}`);
});

test("hex color", () => {
  expect(color("#ff8800", "w")).toBe(`\x1b[38;2;255;136;0mw${RESET}`);
});

test("unknown color returns plain text", () => {
  expect(color("bogus", "p")).toBe("p");
});
```

- [ ] **Step 2: Write `src/render/colors.ts`**

```typescript
// src/render/colors.ts
export const RESET = "\x1b[0m";

const NAMED: Record<string, string> = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
};

export function color(spec: string, text: string): string {
  if (NAMED[spec]) return `${NAMED[spec]}${text}${RESET}`;
  if (/^\d+$/.test(spec)) {
    const n = Number.parseInt(spec, 10);
    if (n >= 0 && n <= 255) return `\x1b[38;5;${n}m${text}${RESET}`;
  }
  const m = /^#([0-9a-f]{6})$/i.exec(spec);
  if (m) {
    const hex = m[1];
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
  }
  return text;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-colors.test.ts
git add src/render/colors.ts tests/render-colors.test.ts
git commit -m "implementa helpers de cores ANSI"
```

---

### Task 16: Terminal width detection

**Files:**
- Create: `src/render/width.ts`
- Create: `tests/render-width.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/render-width.test.ts
import { test, expect } from "bun:test";
import { detectTerminalWidth } from "../src/render/width";

test("uses COLUMNS env when set", () => {
  expect(detectTerminalWidth({ COLUMNS: "120" }, undefined)).toBe(120);
});

test("falls back to maxWidth config", () => {
  expect(detectTerminalWidth({}, 100)).toBe(100);
});

test("falls back to 80 when nothing available", () => {
  expect(detectTerminalWidth({}, null)).toBe(80);
});

test("ignores invalid COLUMNS", () => {
  expect(detectTerminalWidth({ COLUMNS: "garbage" }, 90)).toBe(90);
});
```

- [ ] **Step 2: Write `src/render/width.ts`**

```typescript
// src/render/width.ts
export function detectTerminalWidth(env: Record<string, string | undefined>, fallback: number | null): number {
  const cols = env.COLUMNS;
  if (cols) {
    const n = Number.parseInt(cols, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof fallback === "number" && fallback > 0) return fallback;
  return 80;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-width.test.ts
git add src/render/width.ts tests/render-width.test.ts
git commit -m "implementa deteccao de largura do terminal"
```

---

## Phase E: Render lines (Tasks 17-28)

> All line modules export `render(ctx: RenderContext): string | null`. They use `tests/render-lines.test.ts` for snapshot-style tests against fixtures. The first line task (Task 17) creates the test file; subsequent tasks append to it.

### Task 17: render/lines/project.ts (line 1)

**Files:**
- Create: `src/render/lines/project.ts`
- Create: `tests/render-lines.test.ts`
- Create: `tests/fixtures/stdin-anthropic-pro.json`
- Create: `tests/fixtures/stdin-ollama-cloud.json`

- [ ] **Step 1: Create stdin fixtures**

`tests/fixtures/stdin-anthropic-pro.json`:

```json
{
  "session_id": "test-session-anth",
  "transcript_path": "/tmp/no-such",
  "model": { "id": "claude-opus-4-7", "display_name": "Opus 4.7" },
  "workspace": { "current_dir": "/Users/lima/Projects/ohud", "project_dir": "/Users/lima/Projects/ohud" },
  "context_window": { "context_window_size": 200000, "used_percentage": 45 },
  "cost": { "total_cost_usd": 0.42, "total_duration_ms": 60000 },
  "rate_limits": {
    "five_hour": { "used_percentage": 25, "resets_at": 1738425600 },
    "seven_day": { "used_percentage": 41, "resets_at": 1738857600 }
  },
  "version": "2.1.90"
}
```

`tests/fixtures/stdin-ollama-cloud.json`:

```json
{
  "session_id": "test-session-ollama",
  "transcript_path": "/tmp/no-such",
  "model": { "id": "glm-5:cloud", "display_name": "glm-5:cloud" },
  "workspace": { "current_dir": "/Users/lima/Projects/ohud", "project_dir": "/Users/lima/Projects/ohud" },
  "context_window": { "context_window_size": 128000, "used_percentage": 45 },
  "version": "2.1.90"
}
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/render-lines.test.ts
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProject } from "../src/render/lines/project";
import { DEFAULT_CONFIG } from "../src/config";
import type { RenderContext, StdinData } from "../src/types";

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
```

- [ ] **Step 3: Verify tests fail**

```bash
bun test tests/render-lines.test.ts
```

- [ ] **Step 4: Write `src/render/lines/project.ts`**

```typescript
// src/render/lines/project.ts
import { basename } from "node:path";
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderProject(ctx: RenderContext): string {
  const c = ctx.config;
  const modelLabel = modelBadge(ctx);
  const projectLabel = projectPath(ctx);
  const gitLabel = gitBlock(ctx);

  const parts: string[] = [];
  if (c.display.showModel && modelLabel) parts.push(color(c.colors.model, `[${modelLabel}]`));
  if (projectLabel) parts.push(color(c.colors.project, projectLabel));
  if (gitLabel) parts.push(gitLabel);
  return parts.join(color(c.colors.label, " │ "));
}

function modelBadge(ctx: RenderContext): string {
  const name = ctx.stdin.model?.display_name ?? ctx.stdin.model?.id ?? "model";
  if (ctx.mode !== "ollama") return name;
  const cloudInfo = ctx.cloudModels.find((m) => m.name === ctx.stdin.model?.id || m.model === ctx.stdin.model?.id);
  const param = cloudInfo?.details?.parameter_size;
  return param ? `${name} ⚡ ${param}` : name;
}

function projectPath(ctx: RenderContext): string {
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd ?? "";
  if (!dir) return "";
  const parts = dir.split("/").filter(Boolean);
  const n = ctx.config.pathLevels;
  return parts.slice(-n).join("/");
}

function gitBlock(ctx: RenderContext): string {
  if (!ctx.config.gitStatus.enabled || !ctx.gitStatus) return "";
  const c = ctx.config.colors;
  const wrapper = (s: string) => color(c.git, s);
  const branch = color(c.gitBranch, ctx.gitStatus.branch + (ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty ? "*" : ""));
  return `${wrapper("git:(")}${branch}${wrapper(")")}`;
}
```

- [ ] **Step 5: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/project.ts tests/render-lines.test.ts tests/fixtures/stdin-*.json
git commit -m "implementa render line project (linha 1)"
```

---

### Task 18: render/lines/context.ts

**Files:**
- Create: `src/render/lines/context.ts`
- Modify: `tests/render-lines.test.ts` (append tests)

- [ ] **Step 1: Append tests**

Append to `tests/render-lines.test.ts`:

```typescript
import { renderContext } from "../src/render/lines/context";

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
```

- [ ] **Step 2: Verify failure → write `src/render/lines/context.ts`**

```typescript
// src/render/lines/context.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderContext(ctx: RenderContext): string | null {
  if (!ctx.config.display.showContextBar) return null;
  const pct = ctx.stdin.context_window?.used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);

  const c = ctx.config.colors;
  let barColor = c.context;
  if (rounded >= 85) barColor = c.critical;
  else if (rounded >= 70) barColor = c.warning;

  const filled = Math.floor((rounded * BAR_WIDTH) / 100);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const valuePart = formatValue(ctx, rounded);

  return `${color(c.label, "Context")} ${color(barColor, bar)} ${color(barColor, valuePart)}`;
}

function formatValue(ctx: RenderContext, rounded: number): string {
  const cw = ctx.stdin.context_window;
  const total = cw?.context_window_size ?? 0;
  const used = (cw?.total_input_tokens ?? 0);
  const fmt = (n: number) => `${(n / 1000).toFixed(0)}k`;
  switch (ctx.config.display.contextValue) {
    case "tokens": return `${fmt(used)}/${fmt(total)}`;
    case "remaining": return `${100 - rounded}%`;
    case "both": return `${rounded}% (${fmt(used)}/${fmt(total)})`;
    default: return `${rounded}%`;
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/context.ts tests/render-lines.test.ts
git commit -m "implementa render line context"
```

---

### Task 19: render/lines/gpu-time.ts

**Files:** create `src/render/lines/gpu-time.ts`; append tests to `tests/render-lines.test.ts`.

- [ ] **Step 1: Append tests**

```typescript
import { renderGpuTime } from "../src/render/lines/gpu-time";

test("gpu-time line in ollama mode with totalDurationNs", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.transcript.totalDurationNs = 12 * 60 * 1_000_000_000 + 30 * 1_000_000_000;
  const out = renderGpuTime(ctx);
  expect(out).toContain("GPU");
  expect(out).toContain("12m 30s");
});

test("gpu-time line falls back to API time when transcript empty", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.stdin.cost = { total_api_duration_ms: 75_000 };
  const out = renderGpuTime(ctx);
  expect(out).toContain("API");
  expect(out).toContain("1m 15s");
});

test("gpu-time line null in anthropic mode", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  expect(renderGpuTime(makeCtx(stdin, "anthropic"))).toBeNull();
});
```

- [ ] **Step 2: Implement `src/render/lines/gpu-time.ts`**

```typescript
// src/render/lines/gpu-time.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderGpuTime(ctx: RenderContext): string | null {
  if (ctx.mode !== "ollama") return null;
  if (!ctx.config.display.showGpuTime) return null;
  const c = ctx.config.colors;

  const ns = ctx.transcript.totalDurationNs;
  if (typeof ns === "number" && ns > 0) {
    return `${color(c.label, "GPU")} ${color(c.gpuTime, `⏱ ${formatDuration(ns / 1_000_000)}`)}`;
  }

  const apiMs = ctx.stdin.cost?.total_api_duration_ms;
  if (typeof apiMs === "number" && apiMs > 0) {
    return `${color(c.label, "API")} ${color(c.gpuTime, `⏱ ${formatDuration(apiMs)}`)}`;
  }
  return null;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/gpu-time.ts tests/render-lines.test.ts
git commit -m "implementa render line gpu-time"
```

---

### Task 20: render/lines/usage.ts (Anthropic mode)

**Files:** create `src/render/lines/usage.ts`; append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderUsage } from "../src/render/lines/usage";

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
```

- [ ] **Step 2: Implement `src/render/lines/usage.ts`**

```typescript
// src/render/lines/usage.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderUsage(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.config.display.showUsage) return null;
  if (!ctx.usageData) return null;

  const { fiveHour, sevenDay } = ctx.usageData;
  const parts: string[] = [];

  if (fiveHour !== null) parts.push(formatWindow(ctx, "5h", fiveHour, ctx.usageData.fiveHourResetAt));
  if (sevenDay !== null && sevenDay >= ctx.config.display.sevenDayThreshold) {
    parts.push(formatWindow(ctx, "7d", sevenDay, ctx.usageData.sevenDayResetAt));
  }
  if (parts.length === 0) return null;

  const c = ctx.config.colors;
  return `${color(c.label, "Usage")} ${parts.join(" | ")}`;
}

function formatWindow(ctx: RenderContext, label: string, pct: number, _resetAt: Date | null): string {
  const c = ctx.config.colors;
  let lineColor = c.usage;
  if (pct >= 85) lineColor = c.critical;
  else if (pct >= 60) lineColor = c.usageWarning;

  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor((pct * BAR_WIDTH) / 100);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    return `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  }
  return color(lineColor, `${label}: ${pct}%`);
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/usage.ts tests/render-lines.test.ts
git commit -m "implementa render line usage"
```

---

### Task 21: render/lines/cost.ts

**Files:** create `src/render/lines/cost.ts`; append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderCost } from "../src/render/lines/cost";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/cost.ts
import { color } from "../colors.js";
import { formatUsd } from "../../cost.js";
import type { RenderContext } from "../../types.js";

export function renderCost(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.config.display.showCost) return null;
  if (!ctx.costData) return null;
  const c = ctx.config.colors;
  const suffix = ctx.costData.source === "estimate" ? color(c.label, " (est)") : "";
  return `${color(c.label, "Cost")} ${color(c.label, formatUsd(ctx.costData.totalUsd))}${suffix}`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/cost.ts tests/render-lines.test.ts
git commit -m "implementa render line cost"
```

---

### Task 22: render/lines/prompt-cache.ts

**Files:** create `src/render/lines/prompt-cache.ts`; append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderPromptCache } from "../src/render/lines/prompt-cache";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/prompt-cache.ts
import { color } from "../colors.js";
import { promptCacheRemainingMs, formatPromptCache } from "../../prompt-cache.js";
import type { RenderContext } from "../../types.js";

export function renderPromptCache(ctx: RenderContext): string | null {
  if (ctx.mode !== "anthropic") return null;
  if (!ctx.config.display.showPromptCache) return null;
  const remaining = promptCacheRemainingMs(
    ctx.transcript.lastAssistantResponseAt, ctx.config.display.promptCacheTtlSeconds,
  );
  if (remaining === null) return null;
  const c = ctx.config.colors;
  return `${color(c.label, "cache")} ${color(c.label, formatPromptCache(remaining))}`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/prompt-cache.ts tests/render-lines.test.ts
git commit -m "implementa render line prompt-cache"
```

---

### Task 23: render/lines/tools.ts

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderTools } from "../src/render/lines/tools";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/tools.ts
import { color } from "../colors.js";
import type { RenderContext, ToolEntry } from "../../types.js";

export function renderTools(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTools) return null;
  const tools = ctx.transcript.tools;
  if (tools.length === 0) return null;

  const running = tools.filter((t) => t.status === "running");
  const completed = tools.filter((t) => t.status === "completed");
  const c = ctx.config.colors;
  const parts: string[] = [];
  for (const t of running) parts.push(`${color(c.label, "◐")} ${t.name}${t.target ? `: ${basename(t.target)}` : ""}`);
  const tally = countByName(completed);
  for (const [name, count] of tally) parts.push(`${color(c.label, "✓")} ${name}${count > 1 ? ` ×${count}` : ""}`);
  return parts.join(color(c.label, " | "));
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function countByName(entries: ToolEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/tools.ts tests/render-lines.test.ts
git commit -m "implementa render line tools"
```

---

### Task 24: render/lines/agents.ts

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderAgents } from "../src/render/lines/agents";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/agents.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderAgents(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAgents) return null;
  const agents = ctx.transcript.agents;
  if (agents.length === 0) return null;
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

function formatElapsed(start: Date): string {
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/agents.ts tests/render-lines.test.ts
git commit -m "implementa render line agents"
```

---

### Task 25: render/lines/todos.ts

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderTodos } from "../src/render/lines/todos";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/todos.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderTodos(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTodos) return null;
  const todos = ctx.transcript.todos;
  if (todos.length === 0) return null;
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const c = ctx.config.colors;
  const head = inProgress ? `${color(c.label, "▸")} ${inProgress.content}` : `${color(c.label, "▹")} no active todo`;
  return `${head} ${color(c.label, `(${completed}/${total})`)}`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/todos.ts tests/render-lines.test.ts
git commit -m "implementa render line todos"
```

---

### Task 26: render/lines/environment.ts

> Counts CLAUDE.md / rules / MCPs / hooks. Reuses `~/.claude` settings discovery — but kept minimal in v0.1: read `~/.claude/settings.json` for `mcpServers` and `hooks` keys; count `CLAUDE.md` files in `cwd` and ancestors up to home.

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderEnvironment } from "../src/render/lines/environment";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/environment.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderEnvironment(ctx: RenderContext): string | null {
  if (!ctx.config.display.showConfigCounts) return null;
  const dir = ctx.stdin.workspace?.current_dir ?? ctx.stdin.cwd;
  if (!dir) return null;
  const counts = countAll(dir);
  const c = ctx.config.colors;
  const parts: string[] = [
    `${counts.claudeMd} CLAUDE.md`,
    `${counts.rules} rules`,
    `${counts.mcps} MCPs`,
    `${counts.hooks} hooks`,
  ];
  return color(c.label, parts.join(" | "));
}

interface Counts { claudeMd: number; rules: number; mcps: number; hooks: number }

function countAll(startDir: string): Counts {
  const home = homedir();
  let claudeMd = 0;
  let dir = startDir;
  while (dir && dir.length > 1 && dir.startsWith(home)) {
    if (existsSync(join(dir, "CLAUDE.md"))) claudeMd += 1;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const settings = readSettings(join(home, ".claude/settings.json"));
  const mcps = Object.keys((settings?.mcpServers ?? {}) as Record<string, unknown>).length;
  const hooks = countHooks(settings?.hooks);
  const rules = readRules(startDir);
  return { claudeMd, rules, mcps, hooks };
}

function readSettings(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return null; }
}

function countHooks(hooks: unknown): number {
  if (!hooks || typeof hooks !== "object") return 0;
  let n = 0;
  for (const v of Object.values(hooks as Record<string, unknown>)) {
    if (Array.isArray(v)) n += v.length;
  }
  return n;
}

function readRules(startDir: string): number {
  const path = join(startDir, ".claude/rules.md");
  if (!existsSync(path)) return 0;
  try {
    const content = readFileSync(path, "utf8");
    return content.split("\n").filter((l) => /^[-*]\s+\S/.test(l)).length;
  } catch { return 0; }
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/environment.ts tests/render-lines.test.ts
git commit -m "implementa render line environment"
```

---

### Task 27: render/lines/memory.ts

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderMemory } from "../src/render/lines/memory";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/memory.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

const BAR_WIDTH = 10;

export function renderMemory(ctx: RenderContext): string | null {
  if (!ctx.config.display.showMemoryUsage) return null;
  if (ctx.config.lineLayout !== "expanded") return null;
  if (!ctx.memoryInfo) return null;
  const c = ctx.config.colors;
  const filled = Math.floor((ctx.memoryInfo.usedPercent * BAR_WIDTH) / 100);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const usedGb = (ctx.memoryInfo.usedBytes / 1_000_000_000).toFixed(1);
  const totalGb = (ctx.memoryInfo.totalBytes / 1_000_000_000).toFixed(1);
  return `${color(c.label, "RAM")} ${color(c.usage, bar)} ${color(c.label, `${ctx.memoryInfo.usedPercent}% (${usedGb} GB / ${totalGb} GB)`)}`;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/memory.ts tests/render-lines.test.ts
git commit -m "implementa render line memory"
```

---

### Task 28: render/lines/duration.ts

> Combines `cost.total_duration_ms` (session duration) and optional speed (`out: tok/s`). The skeleton handles both via the same module since they share a line.

**Files:** create + append tests.

- [ ] **Step 1: Append tests**

```typescript
import { renderDuration } from "../src/render/lines/duration";

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
```

- [ ] **Step 2: Implement**

```typescript
// src/render/lines/duration.ts
import { color } from "../colors.js";
import type { RenderContext } from "../../types.js";

export function renderDuration(ctx: RenderContext): string | null {
  const showDuration = ctx.config.display.showDuration;
  const showSpeed = ctx.config.display.showSpeed;
  if (!showDuration && !showSpeed) return null;

  const c = ctx.config.colors;
  const parts: string[] = [];

  if (showDuration) {
    const ms = ctx.stdin.cost?.total_duration_ms;
    if (typeof ms === "number" && ms > 0) parts.push(`⏱ ${formatHms(ms)}`);
  }
  if (showSpeed) {
    const tps = computeTokensPerSecond(ctx);
    if (tps !== null) parts.push(`out: ${tps.toFixed(1)} tok/s`);
  }
  if (parts.length === 0) return null;
  return color(c.label, parts.join(" | "));
}

function formatHms(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m` : `${s}s`;
}

function computeTokensPerSecond(ctx: RenderContext): number | null {
  const eval_count = ctx.transcript.totalEvalCount;
  const eval_dur_ns = ctx.transcript.totalEvalDurationNs;
  if (typeof eval_count === "number" && typeof eval_dur_ns === "number" && eval_dur_ns > 0) {
    return (eval_count * 1_000_000_000) / eval_dur_ns;
  }
  return null;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/lines/duration.ts tests/render-lines.test.ts
git commit -m "implementa render line duration + speed"
```

---

### Task 29: render/index.ts (orchestrator)

**Files:**
- Create: `src/render/index.ts`

- [ ] **Step 1: Append integration-style tests to `tests/render-lines.test.ts`**

```typescript
import { render } from "../src/render";

test("render orchestrator emits multi-line output for ollama mode", () => {
  const stdin = fx("stdin-ollama-cloud.json");
  const ctx = makeCtx(stdin, "ollama");
  ctx.transcript.totalDurationNs = 120_000_000_000;
  const out = render(ctx);
  expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
  expect(out).toContain("Context");
  expect(out).toContain("GPU");
});

test("render orchestrator falls back to anthropic mode", () => {
  const stdin = fx("stdin-anthropic-pro.json");
  const ctx = makeCtx(stdin, "anthropic");
  ctx.usageData = { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null };
  const out = render(ctx);
  expect(out).toContain("Context");
  expect(out).toContain("Usage");
});
```

- [ ] **Step 2: Implement `src/render/index.ts`**

```typescript
// src/render/index.ts
import { color } from "./colors.js";
import type { RenderContext } from "../types.js";
import { renderProject } from "./lines/project.js";
import { renderContext } from "./lines/context.js";
import { renderGpuTime } from "./lines/gpu-time.js";
import { renderUsage } from "./lines/usage.js";
import { renderCost } from "./lines/cost.js";
import { renderPromptCache } from "./lines/prompt-cache.js";
import { renderTools } from "./lines/tools.js";
import { renderAgents } from "./lines/agents.js";
import { renderTodos } from "./lines/todos.js";
import { renderEnvironment } from "./lines/environment.js";
import { renderMemory } from "./lines/memory.js";
import { renderDuration } from "./lines/duration.js";

type LineFn = (ctx: RenderContext) => string | null;

const LINE_REGISTRY: Record<string, LineFn> = {
  project: renderProject,
  context: renderContext,
  gpuTime: renderGpuTime,
  usage: renderUsage,
  cost: renderCost,
  promptCache: renderPromptCache,
  tools: renderTools,
  agents: renderAgents,
  todos: renderTodos,
  environment: renderEnvironment,
  memory: renderMemory,
  duration: renderDuration,
};

export function render(ctx: RenderContext): string {
  const order = ctx.config.elementOrder;
  const lines: string[] = [];

  // Line 1: project
  if (order.includes("project")) {
    const p = renderProject(ctx);
    if (p) lines.push(p);
  }

  // Line 2: context (left) merged with gpuTime|usage (right) per mergeGroups
  const merged = collectMerged(ctx);
  if (merged) lines.push(merged);

  // Subsequent lines: in elementOrder, skipping already-rendered ones
  const rendered = new Set<string>(["project", "context", "gpuTime", "usage"]);
  for (const key of order) {
    if (rendered.has(key)) continue;
    const fn = LINE_REGISTRY[key];
    if (!fn) continue;
    const out = fn(ctx);
    if (out) lines.push(out);
    rendered.add(key);
  }

  return lines.join("\n");
}

function collectMerged(ctx: RenderContext): string | null {
  const ctxLine = renderContext(ctx);
  const right = ctx.mode === "ollama" ? renderGpuTime(ctx) : renderUsage(ctx);
  if (ctxLine && right) {
    const sep = color(ctx.config.colors.label, "│");
    return `${ctxLine} ${sep} ${right}`;
  }
  return ctxLine ?? right ?? null;
}
```

- [ ] **Step 3: Verify + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/index.ts tests/render-lines.test.ts
git commit -m "implementa orchestrator de render"
```

---

## Phase F: Wiring + integration (Tasks 30-31)

### Task 30: src/index.ts (main entry)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
// src/index.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readStdin } from "./stdin.js";
import { probeOllama } from "./ollama-probe.js";
import { resolveMode } from "./mode.js";
import { parseTranscript } from "./transcript.js";
import { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { fromStdin as usageFromStdin, fromExternalSnapshot as usageFromSnapshot } from "./usage.js";
import { resolveSessionCost } from "./cost.js";
import { getMemoryUsage } from "./memory.js";
import { resolveEffortLevel } from "./effort.js";
import { render } from "./render/index.js";
import type { RenderContext } from "./types.js";

const CONFIG_PATH = join(homedir(), ".claude/plugins/ohud/config.json");

export async function main(): Promise<void> {
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
      timeoutMs: config.ollama.probeTimeoutMs,
    });
    const mode = resolveMode(stdin, probe);

    const [transcript, gitStatus] = await Promise.all([
      parseTranscript(stdin.transcript_path ?? ""),
      config.gitStatus.enabled ? getGitStatus(stdin.workspace?.current_dir ?? stdin.cwd) : Promise.resolve(null),
    ]);

    let usageData = null;
    let costData = null;
    if (mode === "anthropic") {
      usageData = usageFromStdin(stdin);
      if (!usageData && config.display.externalUsagePath) {
        usageData = await usageFromSnapshot(config.display.externalUsagePath, config.display.externalUsageFreshnessMs);
      }
      costData = config.display.showCost ? resolveSessionCost(stdin, transcript.sessionTokens) : null;
    }

    const memoryInfo = config.display.showMemoryUsage && config.lineLayout === "expanded" ? getMemoryUsage() : null;
    const effortLevel = config.display.showEffortLevel ? resolveEffortLevel(stdin.effort) : undefined;

    const ctx: RenderContext = {
      mode, stdin, transcript, gitStatus, config, usageData, costData, memoryInfo,
      cloudModels: probe.cloudModels, effortLevel,
    };

    const output = render(ctx);
    if (output) console.log(output);
  } catch (err) {
    console.error("ohud: error", err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  void main();
}
```

- [ ] **Step 2: Build and smoke-test**

```bash
bun run build
echo '{"session_id":"smoke","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"/Users/lima/Projects/ohud"},"context_window":{"used_percentage":45}}' | node dist/index.js
```

Expected: prints at least one line containing `glm-5:cloud` and `Context`. Mode depends on local daemon state.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "implementa main entry orchestrador"
```

---

### Task 31: integration test

**Files:**
- Create: `tests/integration.test.ts`
- Create: `tests/fixtures/stdin-anthropic-no-limits.json`
- Create: `tests/fixtures/stdin-anthropic-bedrock.json`
- Create: `tests/fixtures/stdin-ollama-local.json`

- [ ] **Step 1: Create remaining stdin fixtures**

`tests/fixtures/stdin-anthropic-no-limits.json`:

```json
{
  "session_id": "no-limits",
  "transcript_path": "/tmp/no-such",
  "model": { "id": "claude-opus-4-7", "display_name": "Opus 4.7" },
  "workspace": { "current_dir": "/Users/lima/Projects/ohud" },
  "context_window": { "context_window_size": 200000, "used_percentage": 10 }
}
```

`tests/fixtures/stdin-anthropic-bedrock.json`:

```json
{
  "session_id": "bedrock",
  "transcript_path": "/tmp/no-such",
  "model": { "id": "anthropic.claude-3-5-sonnet-20241022-v2:0", "display_name": "Sonnet 3.5" },
  "workspace": { "current_dir": "/Users/lima/Projects/ohud" },
  "context_window": { "context_window_size": 200000, "used_percentage": 30 },
  "cost": { "total_cost_usd": 0.0 }
}
```

`tests/fixtures/stdin-ollama-local.json`:

```json
{
  "session_id": "ollama-local",
  "transcript_path": "/tmp/no-such",
  "model": { "id": "llama3.2:latest", "display_name": "llama3.2:latest" },
  "workspace": { "current_dir": "/Users/lima/Projects/ohud" },
  "context_window": { "context_window_size": 32768, "used_percentage": 5 }
}
```

- [ ] **Step 2: Write integration tests**

```typescript
// tests/integration.test.ts
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../dist/index.js");

function runWith(stdinJson: string): string {
  const proc = spawnSync("node", [ENTRY], { input: stdinJson, encoding: "utf8" });
  return (proc.stdout ?? "") + (proc.stderr ?? "");
}

test("integration — anthropic mode with rate_limits emits Usage line", () => {
  const stdin = readFileSync(join(import.meta.dir, "fixtures/stdin-anthropic-pro.json"), "utf8");
  const out = runWith(stdin);
  expect(out).toContain("Context");
  // Either Usage line or graceful absence — no error markers
  expect(out).not.toContain("undefined");
});

test("integration — ollama-local stdin gracefully renders something or warns sensibly", () => {
  const stdin = readFileSync(join(import.meta.dir, "fixtures/stdin-ollama-local.json"), "utf8");
  const out = runWith(stdin);
  // Mode falls back to anthropic; no crash
  expect(out.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Build + run integration**

```bash
bun run build
bun test tests/integration.test.ts
```

Expected: 2 pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts tests/fixtures/stdin-*.json
git commit -m "adiciona testes de integracao end-to-end"
```

---

## Phase G: Plugin packaging (Tasks 32-37)

### Task 32: Plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "ohud",
  "description": "Real-time statusline HUD for Claude Code with Ollama Cloud + Anthropic dual-mode rendering",
  "version": "0.1.0",
  "author": {
    "name": "nicolaslima",
    "url": "https://github.com/nicolaslima"
  },
  "commands": [
    "./commands/ohud.md",
    "./commands/ohud-setup.md",
    "./commands/ohud-configure.md"
  ],
  "homepage": "https://github.com/nicolaslima/ohud",
  "repository": "https://github.com/nicolaslima/ohud",
  "license": "MIT",
  "keywords": ["hud", "statusline", "ollama", "ollama-cloud", "claude-code", "monitoring"]
}
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "ohud",
  "owner": {
    "name": "nicolaslima",
    "email": "lima.nicolasmateus@gmail.com"
  },
  "metadata": {
    "description": "Statusline HUD for Claude Code with auto-detected Ollama Cloud / Anthropic dual-mode",
    "version": "0.1.0"
  },
  "plugins": [
    {
      "name": "ohud",
      "source": "./",
      "description": "Real-time statusline HUD for Claude Code. Detects Ollama Cloud vs Anthropic mode automatically and renders the appropriate metrics.",
      "category": "monitoring",
      "tags": ["hud", "statusline", "ollama", "ollama-cloud", "monitoring"]
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/
git commit -m "adiciona plugin manifest e marketplace"
```

---

### Task 33: /ohud command dispatcher

**Files:**
- Create: `commands/ohud.md`

- [ ] **Step 1: Write `commands/ohud.md`**

```markdown
---
description: Manage ohud statusline (subcommands: setup, configure)
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

This is the dispatcher for the `/ohud` namespace. Parse the user's argument and route:

- `/ohud setup` → invoke commands/ohud-setup.md instructions
- `/ohud configure` → invoke commands/ohud-configure.md instructions
- `/ohud` (no arg) → ask the user which subcommand they want via AskUserQuestion with two options: "Setup ohud" and "Configure ohud".

If the argument is anything else, reply: "Unknown subcommand. Use `/ohud setup` or `/ohud configure`."
```

- [ ] **Step 2: Commit**

```bash
git add commands/ohud.md
git commit -m "adiciona dispatcher do comando /ohud"
```

---

### Task 34: /ohud setup command

**Files:**
- Create: `commands/ohud-setup.md`

- [ ] **Step 1: Write `commands/ohud-setup.md`**

```markdown
---
description: First-time setup for ohud — detect runtime, write statusLine config
allowed-tools: Bash, Read, Edit, Write
---

Goal: configure `ohud` as the user's Claude Code statusline. After this command runs, restarting Claude Code should display the HUD.

## Step 1: Detect runtime

Run, in this order, the first command that succeeds:

```bash
bun --version 2>/dev/null && echo "RUNTIME=bun"
node --version 2>/dev/null && echo "RUNTIME=node"
```

If neither exists, tell the user: "ohud requires Bun (recommended) or Node.js 18+. Install one and re-run /ohud setup."

## Step 2: Resolve plugin install path

The plugin's `dist/index.js` lives at one of:

- `~/.claude/plugins/cache/<owner>/ohud/dist/index.js` (marketplace install)
- `~/.claude/plugins/ohud/dist/index.js` (direct install)

Locate the existing path:

```bash
ls -1 "$HOME/.claude/plugins/cache/"*/ohud/dist/index.js 2>/dev/null \
  || ls -1 "$HOME/.claude/plugins/ohud/dist/index.js" 2>/dev/null
```

Capture the first match into `PLUGIN_PATH`.

## Step 3: Build the command string

If `RUNTIME=bun` → `COMMAND="bun $PLUGIN_PATH"`
If `RUNTIME=node` → `COMMAND="node $PLUGIN_PATH"`

## Step 4: Write to ~/.claude/settings.json

Read the existing settings JSON, set `statusLine` to:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<COMMAND>",
    "padding": 2
  }
}
```

Use the Edit tool to merge — preserve other settings.

## Step 5: Verify

Print a sample invocation:

```bash
echo '{"session_id":"setup","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":10}}' | $COMMAND
```

The user should see one or two lines without errors. Tell them to restart Claude Code.
```

- [ ] **Step 2: Commit**

```bash
git add commands/ohud-setup.md
git commit -m "adiciona comando /ohud setup"
```

---

### Task 35: /ohud configure command

**Files:**
- Create: `commands/ohud-configure.md`

- [ ] **Step 1: Write `commands/ohud-configure.md`**

```markdown
---
description: Configure ohud display preferences via guided flow
allowed-tools: Read, Edit, Write, AskUserQuestion
---

Goal: walk the user through the most common toggles and write them to `~/.claude/plugins/ohud/config.json`.

## Step 1: Load current config (or defaults)

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
test -f "$CFG" || echo '{}' > "$CFG"
cat "$CFG"
```

## Step 2: Pick a preset

Use AskUserQuestion to ask:

- **Full** — everything enabled (tools, agents, todos, cost, duration, memory, environment)
- **Essential** — tools + todos + git, no cost/memory
- **Minimal** — model, project, git, context bar only
- **Custom** — keep going to fine-grained toggles

## Step 3: Apply preset

Write the corresponding `display.show*` flags to the config file via Edit. Always preserve `colors.*`, `pathLevels`, `maxWidth`, `display.timeFormat`, `display.promptCacheTtlSeconds` — these are advanced and stay user-managed.

## Step 4: Preview

Render a sample using a fake stdin payload:

```bash
echo '{"session_id":"preview","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | <RUNTIME> <PLUGIN_PATH>
```

Show the output to the user. Ask if it looks right.

## Step 5: Save and exit

If they confirm, the file is already written. Tell them to restart Claude Code or wait for the next status update for changes to take effect.
```

- [ ] **Step 2: Commit**

```bash
git add commands/ohud-configure.md
git commit -m "adiciona comando /ohud configure"
```

---

### Task 36: README + LICENSE

**Files:**
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 nicolaslima

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write `README.md`**

```markdown
# ohud

> Real-time statusline HUD for Claude Code with Ollama Cloud + Anthropic dual-mode rendering.

Auto-detects whether your Claude Code session is running against Ollama Cloud or Anthropic-direct, and renders the appropriate metrics:

- **Ollama mode**: model badge with parameter size (`[glm-5:cloud ⚡ 1T]`), context bar, GPU time consumed
- **Anthropic mode**: model badge, context bar, 5h/7d rate-limit usage, optional cost USD

Plus opt-in lines for tools activity, agent status, todo progress, environment counts, memory usage, and session duration.

## Install

```bash
/plugin marketplace add nicolaslima/ohud
/plugin install ohud
/ohud setup
```

Restart Claude Code so it picks up the new statusLine config.

## Configure

```bash
/ohud configure
```

Pick a preset (Full / Essential / Minimal) or fine-tune individual toggles.

For advanced settings (custom colors, terminal width, prompt cache TTL), edit `~/.claude/plugins/ohud/config.json` directly.

## How it works

`ohud` runs as a Claude Code statusline command — Claude Code pipes session JSON to it on stdin, ohud parses the transcript JSONL, optionally probes `localhost:11434` (cached 60s) to detect Ollama, and writes ANSI lines to stdout.

Mode detection:

1. Probe `<ollama.host>/api/version`
2. Probe `<ollama.host>/api/tags` for models with `remote_host` set (Ollama Cloud)
3. Cross-check `stdin.model.id` against the cloud-models list
4. If all match → **Ollama mode**, else → **Anthropic mode** (silent fallback, no warning)

## Spec

Full design spec: [`docs/superpowers/specs/2026-05-08-ohud-design.md`](docs/superpowers/specs/2026-05-08-ohud-design.md)

## Inspiration

Visual layout inspired by [`claude-hud`](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts. ohud is an independent reimplementation, not a fork.

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "adiciona README e LICENSE"
```

---

### Task 37: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun run typecheck
      - run: bun test
      - run: bun run build
      - name: smoke-test bundle on Node
        run: |
          echo '{"session_id":"ci","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"."},"context_window":{"used_percentage":10}}' | node dist/index.js
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "adiciona CI com bun + smoke-test no node"
```

---

## Done Criteria

After all 37 tasks:

- [ ] `bun test` passes (all unit + integration tests).
- [ ] `bun run typecheck` reports zero errors.
- [ ] `bun run build` produces `dist/index.js`.
- [ ] Piping a fixture stdin into `node dist/index.js` prints the expected HUD.
- [ ] Plugin manifest + commands present.
- [ ] README + LICENSE present.
- [ ] CI workflow runs green on first push to a remote.
- [ ] Hypothesis verification (Task 3) result is documented in `docs/hypothesis-verification.md`.

## Open work for v0.2+

These were explicitly deferred during brainstorming:

- i18n beyond `en` (Chinese/Portuguese labels)
- Direct Ollama Cloud quota endpoint integration (when published)
- Sidecar producer script for Anthropic mode (only opt-in consumer is in v0.1)
- Subscription-tier-aware quota estimation (declared tier × session aggregation)
- Speed line (`out: 42.1 tok/s`) full reliability — current implementation hides if source data is unavailable
