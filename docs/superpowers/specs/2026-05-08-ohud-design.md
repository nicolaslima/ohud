# `ohud` — Design Specification

**Date**: 2026-05-08
**Author**: nicolaslima
**Status**: Approved (awaiting user re-review)
**Inspired by (visually only)**: [`claude-hud`](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts (MIT) — no code reuse.

---

## 1. Summary

`ohud` (**O**llama **HUD**) is a Claude Code statusline plugin that operates in two automatically-detected modes:

- **Ollama mode** (priority): when the local Ollama daemon is available and the current session is using an Ollama Cloud (`:cloud`) model, ohud renders Ollama-specific metrics — GPU time consumed, cloud model badge with parameter size and family, plus the standard layout (project, git, context bar, opt-in lines).
- **Anthropic mode** (graceful fallback): when Ollama Cloud isn't in use (daemon offline, no cloud models installed, or session uses a non-cloud model), ohud renders the claude-hud-equivalent HUD with native Anthropic metrics — `rate_limits.five_hour`/`seven_day` bars, `cost.total_cost_usd`, prompt cache TTL, and the same opt-in lines.

Mode is determined per-invocation via cheap cached probes; the user is never asked to configure which mode to use. The same plugin install serves both Ollama Cloud users and Anthropic-direct users.

## 2. Goals

- Replicate the visual UX of `claude-hud` (multi-line layout, color thresholds, opt-in toggles) for both Anthropic-direct and Ollama Cloud sessions.
- Detect the active provider transparently and switch rendering accordingly — without user intervention.
- Provide accurate, non-estimated session metrics in each mode (Ollama: GPU time; Anthropic: native rate_limits + cost).
- Run with sub-50ms invocation cost on cache-hit (Claude Code re-runs the script every ~300ms).
- Distribute as an installable plugin via the Claude Code marketplace, public on GitHub from day 1.

## 3. Non-goals (v0.1)

- USD cost estimation for Ollama Cloud (open-source models — there is no per-token price; only Anthropic mode shows cost).
- Cross-session Ollama Cloud quota tracking (no public Ollama API for plan consumption — see §10).
- Producing the data feed itself: `ohud` is the consumer of data Claude Code and Ollama already expose; it does not run a daemon, sidecar, or scheduled job.
- i18n beyond English (a future enhancement, not v0.1).

## 4. Context — what Claude Code and Ollama expose

`ohud` consumes three sources, all already available in the user's setup:

| Source | Mechanism | What ohud reads |
|--------|-----------|-----------------|
| Claude Code stdin JSON | Piped to script every ~300ms (debounced) | `model.id`, `model.display_name`, `cwd`, `workspace.*`, `context_window.*`, `transcript_path`, `session_id`, `effort.level`, `version`, `output_style.name` |
| Claude Code transcript JSONL | File at `stdin.transcript_path` | `tool_use`/`tool_result` blocks, `Task` blocks, `TodoWrite` blocks, assistant message bodies (which contain Ollama's `total_duration` ns when proxied) |
| Local Ollama daemon | `GET http://localhost:11434/api/version` and `GET /api/tags` | Daemon liveness, list of models with `remote_host` field populated for cloud models |

**Critical reference**: official integration documented at [`docs.ollama.com/integrations/claude-code`](https://docs.ollama.com/integrations/claude-code), which prescribes:

```sh
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_API_KEY=""
claude --model glm-5:cloud
```

The Ollama daemon at `localhost:11434` acts as an Anthropic-compatible proxy and routes `:cloud` model requests to `https://ollama.com:443`.

## 5. Architecture

```
claude-code  ──stdin JSON──>  ohud  ──stdout──>  claude-code displays
   │                            │
   │                            ├── reads transcript JSONL (tools, agents, todos, durations, tokens)
   │                            ├── probes localhost:11434/api/version (cached 60s, mode detection)
   │                            └── probes localhost:11434/api/tags (cached 60s, cloud detection)
   ▼
~/.claude/transcripts/
```

`ohud` is a single bundled `.js` executable. On each Claude Code invocation it:

1. Reads stdin JSON (250ms first-byte timeout, 30ms idle timeout, 256KB max).
2. Reads probe cache from `/tmp/ohud-${session_id}.json`. If older than 60s or absent, refreshes via two HTTP calls to the local daemon (timeout `ollama.probeTimeoutMs`, default 500ms — failures fall back to Anthropic mode silently).
3. Resolves render mode (§6).
4. In parallel: parses transcript JSONL, runs git status, loads config; in Anthropic mode also resolves `usage` and `cost`.
5. Composes lines per `config.elementOrder` and the active mode, writes to stdout.

**Performance budget**: <50ms cache-hit. Bun startup ~10ms + parse work ~30ms + render ~10ms. Cache-miss adds ~20-40ms for the local HTTP probes.

## 6. Mode detection

`ohud` chooses between two rendering modes per invocation. Detection is cheap (probes are cached for `ollama.probeCacheTtlSeconds`, default 60s) and never blocks; if probes fail or time out, mode falls back to Anthropic.

```
Probe <ollama.host>/api/version  (cached <ollama.probeCacheTtlSeconds>s)
   ├─ timeout (<ollama.probeTimeoutMs>ms) / connection refused / non-200
   │      → MODE: anthropic
   └─ 200 OK
        Probe <ollama.host>/api/tags  (same cache window)
        ├─ HTTP error
        │      → MODE: anthropic
        └─ 200 OK
             ├─ no models with remote_host populated
             │      → MODE: anthropic
             └─ at least one cloud model
                  Cross-check stdin.model.id against cloud-models list
                  ├─ current model is in cloud list
                  │      → MODE: ollama
                  └─ current model is not cloud
                         → MODE: anthropic
```

The `remote_host` field on `/api/tags` entries is the deterministic indicator that a model is offloaded to Ollama Cloud. `:cloud` suffix matching is **not** the source of truth — `remote_host` is.

**Why the bias toward Anthropic mode in failure cases**: Anthropic mode is the inherited claude-hud behavior. If Ollama isn't actively in use for this session, the user almost certainly wants the standard HUD they'd get from claude-hud, not a warning line. There is no `⚠` mode-mismatch surface — switching is silent.

The current mode is recorded in the cache file alongside the probe data so downstream modules can render mode-appropriate lines without re-probing.

## 7. Output format

### Default (2 lines), Ollama mode

```
[glm-5:cloud ⚡ 1T] │ ohud git:(main*)
Context █████░░░░░ 45% │ GPU ⏱ 12m 30s
```

- **Line 1** — model badge (with optional parameter size from `/api/tags` details), project path, git branch.
- **Line 2** — context bar (color-thresholded green/yellow/red) and aggregated GPU time for this session.

### Default (2 lines), Anthropic mode

```
[Opus] │ ohud git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```

- **Line 1** — model badge, project path, git branch (provider label such as `Bedrock`/`Vertex` appears when applicable, mirroring claude-hud).
- **Line 2** — context bar and Anthropic subscriber `rate_limits` usage from stdin (`five_hour`, optionally `seven_day` above threshold).

### Opt-in lines (configured via `/ohud configure`)

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← Tools activity (showTools)
◐ explore [haiku]: Finding auth code (2m 15s)    ← Agent status (showAgents)
▸ Fix authentication bug (2/5)                   ← Todo progress (showTodos)
2 CLAUDE.md | 4 rules | 3 MCPs | 2 hooks         ← Environment (showConfigCounts)
RAM ████░░░░░░ 38% (12.3 GB / 32 GB)             ← Memory (showMemoryUsage)
⏱ 5m | out: 42.1 tok/s                          ← Duration + speed (showDuration, showSpeed)
```

### Context thresholds (color)

| Threshold | Color | Action |
|-----------|-------|--------|
| <70% | Green | Normal |
| 70–85% | Yellow | Warning |
| >85% | Red | Show token breakdown |

## 8. Modules

```
src/
├── index.ts            # Entry point: orchestrates main()
├── stdin.ts            # Reads + parses Claude Code JSON from stdin (timeouts agressivos)
├── ollama-probe.ts     # GET /api/version + /api/tags, cache 60s em /tmp/ohud-${session_id}
├── mode.ts             # Decide ollama | anthropic mode + cache em /tmp
├── transcript.ts       # Parse JSONL incremental: tools, agents, todos, total_duration sum
├── git.ts              # Branch, dirty, ahead/behind, file stats
├── config.ts           # Load/validate ~/.claude/plugins/ohud/config.json com defaults
├── cost.ts             # Anthropic cost: native cost.total_cost_usd OR local pricing-table estimate
├── usage.ts            # Anthropic rate_limits: parse stdin + optional externalUsagePath fallback
├── prompt-cache.ts     # Anthropic prompt-cache TTL countdown (opt-in)
├── memory.ts           # System RAM (opt-in)
├── effort.ts           # Resolve effort.level do stdin
├── types.ts            # TypeScript interfaces compartilhadas
└── render/
    ├── index.ts        # Orquestra ordering das linhas conforme config.elementOrder + mode
    ├── colors.ts       # ANSI helpers (named + 256 + hex)
    ├── width.ts        # Detecção de largura do terminal
    └── lines/
        ├── project.ts        # Linha 1 (mode-aware: model badge varies)
        ├── context.ts        # Linha 2 esquerda (both modes)
        ├── gpu-time.ts       # Linha 2 direita, ollama mode
        ├── usage.ts          # Linha 2 direita, anthropic mode
        ├── cost.ts           # opt-in, anthropic mode only
        ├── prompt-cache.ts   # opt-in, anthropic mode only
        ├── tools.ts          # opt-in (both modes)
        ├── agents.ts         # opt-in (both modes)
        ├── todos.ts          # opt-in (both modes)
        ├── environment.ts    # opt-in (both modes)
        ├── memory.ts         # opt-in (both modes)
        └── duration.ts       # opt-in (both modes)
```

**Module ownership rule**: each module has one responsibility, no module imports its peers' internals (only types via `types.ts`). Render layer is the only place that knows about ANSI; data layer is provider-agnostic where it can be.

**Mode-aware modules**: `cost.ts`, `usage.ts`, `prompt-cache.ts`, and `render/lines/{gpu-time,usage,cost,prompt-cache}.ts` are gated on `mode` — they no-op silently outside their mode. `transcript.ts` exposes both Ollama-specific (`totalDurationNs`) and provider-agnostic (`tools`, `agents`, `todos`) fields so consumers pick what they need.

## 9. Data flow (single invocation)

```
1. main() reads stdin (250ms first byte / 30ms idle / 256KB max)
   ├─ no stdin → setup verification message, exit 0
   └─ stdin parsed → continue

2. mode.resolve()  (consults cached probe; refreshes if stale)
   ├─ ollama-probe.read() with <ollama.probeTimeoutMs>ms timeout
   │     ├─ probe ok + cloud models exist + stdin.model.id is cloud → mode = "ollama"
   │     └─ otherwise → mode = "anthropic"
   └─ mode persisted in cache

3. parallel:
   ├─ transcript.parse(stdin.transcript_path) → tools, agents, todos,
   │                                            totalDurationNs (ollama),
   │                                            sessionTokens (anthropic cost calc)
   ├─ git.status(stdin.cwd) → branch, dirty, ahead/behind, file stats
   ├─ config.load() → user toggles
   └─ if mode = "anthropic":
        ├─ usage.fromStdin(stdin) → 5h/7d data (or null)
        ├─ usage.fromExternalSnapshot(config) if stdin missing → optional sidecar
        └─ cost.resolve(stdin, sessionTokens) → native cost OR local estimate

4. render.compose(ctx, mode) → string[] → console.log(lines.join('\n'))
```

## 10. Session metrics (mode-dependent)

### Ollama mode — GPU time aggregation

The Ollama API documents `total_duration` (in nanoseconds) as a top-level field on every `/api/chat` and `/api/generate` response (see `docs.ollama.com/api/usage`). The hypothesis driving this feature is that, when Claude Code is configured with `ANTHROPIC_BASE_URL=<ollama.host>`, **the Ollama daemon's Anthropic-compatible translation preserves these fields somewhere consumable from claude-code's transcript JSONL**.

This hypothesis must be verified during implementation phase 1 (see §15 integration test). Two outcomes:

- **If verified** (transcript carries `total_duration` per response, or an equivalent `*_ns` timing field): `transcript.ts` walks the JSONL incrementally and sums it across assistant messages in the current session.
- **If not verified** (Anthropic translation strips Ollama-native timing fields): fall back to `stdin.cost.total_api_duration_ms`, which Claude Code populates from its own measurement of how long API calls took. This is wall-clock time spent waiting on the API rather than GPU time, but it's the closest proxy available without a sidecar.

In either case, the line label is `GPU ⏱` (or `API ⏱` in the fallback) — never "Quota". Format: `<H>h <M>m <S>s` with empty units suppressed; sub-minute renders as `<S>s`.

- **What this measures**: cumulative compute time billed against the user's plan in **this** Claude Code session.
- **What this does not measure**: cross-session usage. Other Claude Code sessions, `ollama run` outside Claude Code, or other tools using the same plan are invisible to this aggregation.
- **Honest framing**: users on Ollama Cloud know their plan has 5h/7d windows; `ohud` does not pretend to know plan consumption.

If a future Ollama public usage endpoint surfaces, the gpu-time line can be augmented (or replaced) with a quota percentage without touching the rest of the architecture.

### Anthropic mode — Usage bar (rate_limits)

`stdin.rate_limits.five_hour.used_percentage` and `stdin.rate_limits.seven_day.used_percentage` are first-class fields documented in the Claude Code statusline reference. They populate for Claude.ai subscribers (Pro/Max) after the first API response. `usage.ts` parses these directly — no aggregation needed.

When `rate_limits` is absent on stdin (API-key-only users, pre-first-response, AWS Bedrock sessions), `usage.ts` checks for an opt-in `display.externalUsagePath` JSON snapshot. If neither source is available, the Usage bar is hidden silently. AWS Bedrock sessions hide usage by design (managed in AWS).

The 7-day window appears when its percentage exceeds `display.sevenDayThreshold` (default 80). Reset times follow `display.timeFormat` (`relative` | `absolute` | `both`). Free/weekly-only accounts render only the 7d window.

### Anthropic mode — Cost (opt-in)

`cost.ts` resolves session cost in this order: native `stdin.cost.total_cost_usd` (provided by Claude Code v2.x for direct Anthropic sessions) → fallback to a local estimate from `transcript.sessionTokens` × an internal Anthropic pricing table (Opus/Sonnet/Haiku families). Cost is hidden for Bedrock and Vertex sessions because cloud-provider billing differs and `total_cost_usd` may report `$0.00` even on chargeable activity.

### Throughput line (`showSpeed`, both modes)

The optional `out: 42.1 tok/s` line aggregates `eval_count` / `eval_duration` (Ollama mode) or output tokens / response time (Anthropic mode) from transcript assistant messages. Renders nothing if source data is unavailable.

## 11. Configuration

**File**: `~/.claude/plugins/ohud/config.json`. Created by `/ohud setup`, edited by `/ohud configure` (guided), or manually for advanced settings.

**Schema** (full claude-hud parity, minus Anthropic-specific knobs):

```jsonc
{
  "lineLayout": "expanded",          // "expanded" | "compact"
  "pathLevels": 1,                   // 1-3
  "maxWidth": null,                  // number | null
  "elementOrder": [
    "project", "context", "gpuTime", "usage", "cost", "promptCache",
    "memory", "environment", "tools", "agents", "todos"
  ],
  "display": {
    "mergeGroups": [["context", "gpuTime"], ["context", "usage"]],
    "showModel": true,
    "showContextBar": true,
    "contextValue": "percent",       // "percent" | "tokens" | "remaining" | "both"
    "showGpuTime": true,              // ollama mode
    "showUsage": true,                // anthropic mode
    "usageBarEnabled": true,          // anthropic mode
    "usageCompact": false,            // anthropic mode
    "showResetLabel": true,           // anthropic mode
    "timeFormat": "relative",         // anthropic mode: "relative" | "absolute" | "both"
    "sevenDayThreshold": 80,          // anthropic mode (0-100)
    "externalUsagePath": "",          // anthropic mode opt-in fallback
    "externalUsageFreshnessMs": 300000,
    "showCost": false,                // anthropic mode opt-in
    "showPromptCache": false,         // anthropic mode opt-in
    "promptCacheTtlSeconds": 300,     // 300=Pro, 3600=Max
    "showTools": false,
    "showAgents": false,
    "showTodos": false,
    "showConfigCounts": false,
    "showOutputStyle": false,
    "showDuration": false,
    "showSpeed": false,
    "showMemoryUsage": false,
    "showTokenBreakdown": true,
    "showSessionName": false,
    "showClaudeCodeVersion": false,
    "showEffortLevel": true
  },
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "pushWarningThreshold": 0,
    "pushCriticalThreshold": 0,
    "showFileStats": false,
    "branchOverflow": "truncate"
  },
  "colors": {
    "context": "green",
    "gpuTime": "brightBlue",
    "usage": "brightBlue",
    "warning": "yellow",
    "usageWarning": "brightMagenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim"
  },
  "ollama": {
    "host": "http://localhost:11434",   // override if daemon is remote
    "probeCacheTtlSeconds": 60,
    "probeTimeoutMs": 500
  }
}
```

**Differences vs claude-hud**: only `language` is removed (en-only for v0.1). Ollama-mode keys (`showGpuTime`, `ollama.*`) are added. All Anthropic-mode keys are preserved as in claude-hud — they are read only in Anthropic mode.

**Mode-aware merge groups**: `display.mergeGroups` lists pairs that may share a line. The default `[["context", "gpuTime"], ["context", "usage"]]` merges Context with whichever metric is active for the current mode (only one pair applies per render).

**Presets** (from `/ohud configure` guided flow): Full / Essential / Minimal — same idea as claude-hud, presets behave identically across modes.

## 12. Plugin integration

### Distribution

- Public GitHub repo `nicolaslima/ohud` from day 1.
- Plugin manifest at `.claude-plugin/plugin.json`.
- Marketplace entry at `.claude-plugin/marketplace.json`.
- Install path: `/plugin marketplace add nicolaslima/ohud` → `/plugin install ohud` → `/ohud setup`.

### Slash commands

- **`/ohud`** — single namespace, dispatches subcommands.
- **`/ohud setup`** — first-time install. Detects runtime (Bun preferred, Node 18+ fallback), writes `statusLine` config to `~/.claude/settings.json` pointing at the bundled `dist/index.js` via the resolved runtime.
- **`/ohud configure`** — guided flow with presets, individual toggles, color picker, preview before saving.

Commands are markdown files in `commands/` (Claude Code convention), interpreted as prompts at runtime.

### `statusLine` config written by setup

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "bun ~/.claude/plugins/ohud/dist/index.js",  // or `node ...` if Bun absent
    "padding": 2
  }
}
```

## 13. Tech stack

- **Language**: TypeScript (ES2022, NodeNext modules).
- **Source files**: `src/**/*.ts`.
- **Runtime**: Bun preferred (fast startup, native TS, native fetch, native test). Node 18+ as fallback (also has `fetch` since 18, runs the bundled JS).
- **Build**: `bun build src/index.ts --target=node --outfile=dist/index.js` (single bundle).
- **Test**: `bun test` (CI may also run `node --test` against the bundled output for parity verification).
- **Type-check**: `tsc --noEmit` in CI.
- **Zero runtime dependencies**: only stdlib + `fetch`. No `ollama` SDK, no HTTP libs, no test framework.
- **Dev dependencies**: TypeScript, `@types/node`. That's it.

## 14. Error handling philosophy

`ohud` **never causes Claude Code to render a blank statusline by accident**. Every code path either returns a useful line of text or a clear `⚠` warning line. `console.log` to stdout always happens; exit code is always 0.

| Scenario | Behavior |
|---|---|
| stdin timeout / empty | Setup verification message, exit 0 |
| stdin JSON invalid | Log to stderr, exit 0 (statusline blank) |
| Ollama daemon offline (timeout 500ms) | Mode falls back to Anthropic — silent, no warning |
| `/api/tags` HTTP error | Mode falls back to Anthropic — silent, no warning |
| No `:cloud` models installed | Mode falls back to Anthropic — silent, no warning |
| Current session model is not cloud | Mode falls back to Anthropic — silent, no warning |
| Anthropic mode + `rate_limits` absent | Hide Usage bar; check `externalUsagePath` opt-in fallback |
| Anthropic mode + Bedrock session | Hide Usage bar (managed in AWS) and Cost (cloud-billed) |
| Transcript path invalid/missing | Skip activity lines, render lines 1+2 normally |
| Git command fails | Skip git info on line 1, render rest |
| Config JSON invalid | Log to stderr, use defaults silently |
| Uncaught exception | Top-level try/catch in `main()`, log to stderr, exit 0 |

`stderr` is reserved for `claude --debug` consumption; users never see it directly.

## 15. Testing strategy

### Layout

```
tests/
├── fixtures/
│   ├── stdin-anthropic-pro.json       # rate_limits populated, native cost
│   ├── stdin-anthropic-no-limits.json # subscriber pre-first-response
│   ├── stdin-anthropic-bedrock.json   # bedrock model id, hide cost+usage
│   ├── stdin-ollama-cloud.json        # :cloud model selected
│   ├── stdin-ollama-local.json        # daemon up but local-only model
│   ├── transcript-typical.jsonl
│   ├── transcript-with-todos.jsonl
│   ├── transcript-ollama-with-duration.jsonl
│   ├── api-tags-cloud.json
│   ├── api-tags-local-only.json
│   └── external-usage-snapshot.json
├── stdin.test.ts
├── ollama-probe.test.ts
├── mode.test.ts
├── transcript.test.ts
├── usage.test.ts
├── cost.test.ts
├── prompt-cache.test.ts
├── render-lines.test.ts        # snapshot tests per line module, both modes
├── render-width.test.ts
├── git.test.ts
├── config.test.ts
└── integration.test.ts          # end-to-end: stdin → stdout snapshot, both modes
```

### Per-module coverage

- `stdin.ts`: timeouts (first-byte, idle), invalid JSON, partial payloads, no-stdin (TTY) case.
- `ollama-probe.ts`: cache hit/miss, daemon offline (mocked `fetch`), HTTP error responses, schema variations of `/api/tags`.
- `mode.ts`: every fallback path + ollama-mode happy path. Property: mode is always one of `"ollama"` or `"anthropic"`, never an error state.
- `transcript.ts`: tools running/completed, agents nested, todos progression, `total_duration` summation (Ollama), `sessionTokens` summation (Anthropic cost), transcript truncated mid-line, transcript with `/compact` markers.
- `usage.ts`: stdin source, externalUsagePath fallback, freshness check, Bedrock hides usage, free/weekly-only accounts.
- `cost.ts`: native `total_cost_usd` source, local pricing-table estimate fallback, Bedrock/Vertex hides cost, missing model.
- `render/lines/*`: snapshot tests with `UPDATE_SNAPSHOTS=1` re-generation, both modes covered per opt-in line.
- `git.ts`: against a temp git repo created in `beforeEach` via `git init`.
- `integration.test.ts`: pipe a fixture stdin into the bundled `dist/index.js`, assert stdout snapshot. Cover: anthropic mode (default, all opt-ins, rate_limits absent, Bedrock), ollama mode (default, all opt-ins, daemon offline → falls back to anthropic).

### Coverage target

~80% line coverage. Snapshots cover visual regressions; unit tests cover branching logic. No coverage obsession.

## 16. Open questions / future work (post v0.1)

- **Hypothesis verification (phase 0 of implementation)**: confirm whether Ollama's `total_duration`/`eval_count`/`eval_duration` survive the Anthropic-compatible translation in claude-code's transcript JSONL. If not, GPU-time falls back to `cost.total_api_duration_ms` (already specified in §10).
- **Direct quota endpoint**: if Ollama publishes a public account/usage API, replace Ollama-mode `gpu-time` line with a quota bar matching the Anthropic-mode `5h/7d` UI.
- **Rate-limit headers**: investigate whether `/api/chat` and `/api/generate` responses include `X-RateLimit-*` headers. If yes, future versions may surface them.
- **i18n**: revisit if there's user demand. Easy lift since label strings are already centralized.
- **Speed line (`out: 42.1 tok/s`)**: implementation deferred if hypothesis fails; otherwise aggregates `eval_count`/`eval_duration` (Ollama) or output-token timing (Anthropic) from transcript.

## 17. Summary of decisions

| ID | Decision | Resolution |
|----|----------|-----------|
| D1 | claude-code → Ollama Cloud connection | Daemon at `localhost:11434` (Anthropic-compatible mode, official integration) |
| D2 | Relationship to claude-hud | Visual inspiration only; no code reuse |
| D3 | Quota / session usage source | Ollama mode: GPU-time aggregated from transcript `total_duration`. Anthropic mode: native `rate_limits` from stdin |
| D4 | Sidecar producer | Rejected for Ollama mode; `ohud` queries Ollama daemon itself. Anthropic mode keeps optional `display.externalUsagePath` for users who already produce snapshots |
| D5 | Distribution | Claude Code marketplace plugin |
| D6 | Tech stack | TypeScript source; Bun preferred runtime, Node 18+ fallback; bundled `.js` distribution |
| D7 | i18n | English only (v0.1) |
| D8 | Cloud detection | `remote_host` field on `/api/tags` entries (deterministic, not suffix matching) |
| D9 | Slash commands | Single `/ohud` namespace with `setup`/`configure` subcommands |
| D10 | Feature scope | Full parity with claude-hud, plus Ollama-mode-specific additions; both modes are first-class |
| D11 | Repository visibility | Public on GitHub from day 1 |
| — | Mode strategy | **Auto-detected**: Ollama-first when daemon + cloud model present; Anthropic fallback otherwise. No user-facing toggle, no warning lines for the fallback case |
