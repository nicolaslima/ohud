# `ohud` — Design Specification

**Date**: 2026-05-08
**Author**: nicolaslima
**Status**: Approved (awaiting user re-review)
**Inspired by (visually only)**: [`claude-hud`](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts (MIT) — no code reuse.

---

## 1. Summary

`ohud` (**O**llama **HUD**) is a Claude Code statusline plugin for users who run Claude Code against Ollama Cloud models. It renders a multi-line, real-time HUD below the prompt showing model, project, git status, context window usage, GPU time consumed in the current session, plus opt-in lines for tools, agents, todos, environment, memory, and duration.

`ohud` is **dedicated to the Ollama Cloud setup**. It detects the user's environment and refuses to render if the session is not using a `:cloud` model — surfacing a clear `⚠` line instead of falling back to incorrect data.

## 2. Goals

- Replicate the visual UX of `claude-hud` (multi-line layout, color thresholds, opt-in toggles) for Ollama Cloud sessions.
- Provide accurate, non-estimated session metrics: model, context bar, GPU time, git, tools, agents, todos.
- Run with sub-50ms invocation cost on cache-hit (Claude Code re-runs the script every ~300ms).
- Refuse to render misleading data: provider gating is hard-fail, not graceful degradation.
- Distribute as an installable plugin via the Claude Code marketplace, public on GitHub from day 1.

## 3. Non-goals (v0.1)

- USD cost estimation (open-source models — there is no per-token price to apply).
- Cross-session quota tracking (no public Ollama API for plan consumption — see §10).
- Support for non-Ollama-Cloud setups (Anthropic direct, Bedrock, Vertex, OpenAI proxies, local-only Ollama). `ohud` refuses to render in those contexts.
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
   │                            ├── reads transcript JSONL (tools, agents, todos, total_duration)
   │                            ├── probes localhost:11434/api/version (cached 60s, gating)
   │                            └── probes localhost:11434/api/tags (cached 60s, cloud detection)
   ▼
~/.claude/transcripts/
```

`ohud` is a single bundled `.js` executable. On each Claude Code invocation it:

1. Reads stdin JSON (250ms first-byte timeout, 30ms idle timeout, 256KB max).
2. Reads probe cache from `/tmp/ohud-${session_id}.json`. If older than 60s or absent, refreshes via two HTTP calls to the local daemon.
3. Evaluates provider gating (§6). Hard-fail paths short-circuit the rest of the pipeline.
4. In parallel: parses transcript JSONL, runs git status, loads config.
5. Composes lines per `config.elementOrder` and writes to stdout.

**Performance budget**: <50ms cache-hit. Bun startup ~10ms + parse work ~30ms + render ~10ms. Cache-miss adds ~20-40ms for the local HTTP probes.

## 6. Provider gating

`ohud` requires three signals before rendering normal output. Any failure surfaces a single warning line and exits cleanly. Error messages reference the configured `ollama.host` (default `http://localhost:11434`) rather than a hardcoded URL — users with a remote daemon see the right value.

```
Probe <ollama.host>/api/version
   ├─ no response in <ollama.probeTimeoutMs>ms / connection refused
   │      → render: "⚠ ohud: Ollama daemon offline at <host>"
   │      → exit 0
   └─ 200 OK → continue

Probe <ollama.host>/api/tags  (cached <ollama.probeCacheTtlSeconds>s)
   ├─ HTTP error
   │      → render: "⚠ ohud: failed to query Ollama at <host> (status N)"
   └─ 200 OK
        ├─ no models with remote_host populated
        │      → render: "⚠ ohud: no Ollama Cloud models found (run `ollama pull <model>:cloud`)"
        │      → exit 0
        └─ at least one cloud model → continue

Cross-check stdin.model.id against the cloud-models list
   ├─ current model NOT in cloud list
   │      → render: "⚠ ohud: this session is not using Ollama Cloud (model: <id>)"
   │      → exit 0
   └─ match → render normal HUD
```

The `remote_host` field in `/api/tags` is the deterministic indicator: its presence means the model is offloaded to Ollama Cloud. `:cloud` suffix matching is **not** the source of truth — `remote_host` is.

## 7. Output format

### Default (2 lines)

```
[glm-5:cloud ⚡ 1T] │ ohud git:(main*)
Context █████░░░░░ 45% │ GPU ⏱ 12m 30s
```

- **Line 1** — model badge (with optional parameter size from `/api/tags` details), project path, git branch.
- **Line 2** — context bar (color-thresholded green/yellow/red per claude-hud) and aggregated GPU time for this session.

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
├── gating.ts           # Decide: render normal / show error line / silent exit
├── transcript.ts       # Parse JSONL incremental: tools, agents, todos, total_duration sum
├── git.ts              # Branch, dirty, ahead/behind, file stats
├── config.ts           # Load/validate ~/.claude/plugins/ohud/config.json com defaults
├── memory.ts           # System RAM (opt-in)
├── effort.ts           # Resolve effort.level do stdin
├── types.ts            # TypeScript interfaces compartilhadas
└── render/
    ├── index.ts        # Orquestra ordering das linhas conforme config.elementOrder
    ├── colors.ts       # ANSI helpers (named + 256 + hex)
    ├── width.ts        # Detecção de largura do terminal
    └── lines/
        ├── project.ts        # Linha 1
        ├── context.ts        # Linha 2 esquerda
        ├── gpu-time.ts       # Linha 2 direita
        ├── tools.ts          # opt-in
        ├── agents.ts         # opt-in
        ├── todos.ts          # opt-in
        ├── environment.ts    # opt-in
        ├── memory.ts         # opt-in
        └── duration.ts       # opt-in
```

**Module ownership rule**: each module has one responsibility, no module imports its peers' internals (only types via `types.ts`). Render layer is the only place that knows about ANSI; data layer is provider-agnostic where it can be.

## 9. Data flow (single invocation)

```
1. main() reads stdin (250ms first byte / 30ms idle / 256KB max)
   ├─ no stdin → setup verification message, exit 0
   └─ stdin parsed → continue

2. ollama-probe.read() (cache hit em 60s)
   ├─ daemon down → gating.eval returns "⚠ Ollama daemon offline" → render → exit 0
   ├─ no cloud models → gating returns "⚠ no cloud models" → render → exit 0
   └─ cloud models present → continue

3. gating.evaluate(stdin.model.id, cloudModelIds)
   ├─ current model not cloud → "⚠ ohud requires Ollama Cloud" → render → exit 0
   └─ current model is cloud → continue

4. parallel:
   ├─ transcript.parse(stdin.transcript_path) → tools, agents, todos, totalDurationNs
   ├─ git.status(stdin.cwd) → branch, dirty, ahead/behind
   └─ config.load() → user toggles

5. render.compose(ctx) → string[] → console.log(lines.join('\n'))
```

## 10. GPU time aggregation

The Ollama API documents `total_duration` (in nanoseconds) as a top-level field on every `/api/chat` and `/api/generate` response (see `docs.ollama.com/api/usage`). The hypothesis driving this feature is that, when Claude Code is configured with `ANTHROPIC_BASE_URL=<ollama.host>`, **the Ollama daemon's Anthropic-compatible translation preserves these fields somewhere consumable from claude-code's transcript JSONL**.

This hypothesis must be verified during implementation phase 1 (see §15 integration test). Two outcomes:

- **If verified** (transcript carries `total_duration` per response, or an equivalent `*_ns` timing field): `transcript.ts` walks the JSONL incrementally and sums it across assistant messages in the current session.
- **If not verified** (Anthropic translation strips Ollama-native timing fields): fall back to `stdin.cost.total_api_duration_ms`, which Claude Code populates from its own measurement of how long API calls took. This is wall-clock time spent waiting on the API rather than GPU time, but it's the closest proxy available without a sidecar.

In either case, the line label is `GPU ⏱` (or `API ⏱` in the fallback) — never "Quota". Format: `<H>h <M>m <S>s` with empty units suppressed; sub-minute renders as `<S>s`.

- **What this measures**: cumulative compute time billed against the user's plan in **this** Claude Code session.
- **What this does not measure**: cross-session usage. Other Claude Code sessions, `ollama run` outside Claude Code, or other tools using the same plan are invisible to this aggregation.
- **Honest framing**: users on Ollama Cloud know their plan has 5h/7d windows; `ohud` does not pretend to know plan consumption.

If a future Ollama public usage endpoint surfaces, the gpu-time line can be augmented (or replaced) with a quota percentage without touching the rest of the architecture.

### Throughput line (`showSpeed`)

The optional `out: 42.1 tok/s` line depends on the same hypothesis: Ollama's `eval_count` and `eval_duration` reaching the transcript. Same fallback strategy — if those fields are stripped by the Anthropic translation, `showSpeed` is implemented but renders nothing (silently hidden) until a future implementation can derive the value from another source.

## 11. Configuration

**File**: `~/.claude/plugins/ohud/config.json`. Created by `/ohud setup`, edited by `/ohud configure` (guided), or manually for advanced settings.

**Schema** (full claude-hud parity, minus Anthropic-specific knobs):

```jsonc
{
  "lineLayout": "expanded",          // "expanded" | "compact"
  "pathLevels": 1,                   // 1-3
  "maxWidth": null,                  // number | null
  "elementOrder": [
    "project", "context", "gpuTime", "tools", "agents", "todos",
    "environment", "memory", "duration"
  ],
  "display": {
    "mergeGroups": [["context", "gpuTime"]],
    "showModel": true,
    "showContextBar": true,
    "contextValue": "percent",       // "percent" | "tokens" | "remaining" | "both"
    "showGpuTime": true,
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
    "warning": "yellow",
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

**Removed vs claude-hud**: `language` (en-only), `display.showCost`, `display.showUsage`, `display.usageBarEnabled`, `display.usageCompact`, `display.showResetLabel`, `display.timeFormat`, `display.sevenDayThreshold`, `display.externalUsagePath`, `display.externalUsageFreshnessMs`, `display.showPromptCache`, `display.promptCacheTtlSeconds`. These all assume Anthropic semantics that don't apply.

**Presets** (from `/ohud configure` guided flow): Full / Essential / Minimal — same idea as claude-hud.

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
| Ollama daemon offline (timeout 500ms) | Render warning line, exit 0 |
| `/api/tags` HTTP error | Render warning line, exit 0 |
| No `:cloud` models installed | Render warning line, exit 0 |
| Current session model is not cloud | Render warning line, exit 0 |
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
│   ├── stdin-cloud.json
│   ├── stdin-local.json
│   ├── stdin-no-rate-limits.json
│   ├── transcript-typical.jsonl
│   ├── transcript-with-todos.jsonl
│   ├── api-tags-cloud.json
│   └── api-tags-local-only.json
├── stdin.test.ts
├── ollama-probe.test.ts
├── gating.test.ts
├── transcript.test.ts
├── render-lines.test.ts        # snapshot tests per line module
├── render-width.test.ts
├── git.test.ts
├── config.test.ts
└── integration.test.ts          # end-to-end: stdin → stdout snapshot
```

### Per-module coverage

- `stdin.ts`: timeouts (first-byte, idle), invalid JSON, partial payloads, no-stdin (TTY) case.
- `ollama-probe.ts`: cache hit/miss, daemon offline (mocked `fetch`), HTTP error responses, schema variations of `/api/tags`.
- `gating.ts`: every error path + happy path. Property: gating output is one of `"render"` or `(warningMessage, exitCleanly)`.
- `transcript.ts`: tools running/completed, agents nested, todos progression, `total_duration` summation, transcript truncated mid-line, transcript with `/compact` markers.
- `render/lines/*`: snapshot tests with `UPDATE_SNAPSHOTS=1` re-generation.
- `git.ts`: against a temp git repo created in `beforeEach` via `git init`.
- `integration.test.ts`: pipe a fixture stdin into the bundled `dist/index.js`, assert stdout snapshot.

### Coverage target

~80% line coverage. Snapshots cover visual regressions; unit tests cover branching logic. No coverage obsession.

## 16. Open questions / future work (post v0.1)

- **Direct quota endpoint**: if Ollama publishes a public account/usage API, replace `gpu-time` line with a quota bar matching claude-hud's 5h/7d UI.
- **Rate-limit headers**: investigate during v0.1 implementation whether `/api/chat` and `/api/generate` responses include `X-RateLimit-*` headers. If yes, document; future versions may surface them.
- **i18n**: revisit if there's user demand. Easy lift since label strings are already centralized.
- **Local Ollama support**: separate flag `ollama.localOnly: true` that allows non-cloud models. Would change the gating behavior to a warn-not-fail mode. Out of scope for v0.1.
- **Speed line (`out: 42.1 tok/s`)**: requires aggregating `eval_count`/`eval_duration` from transcript. Listed as opt-in (`showSpeed`) but implementation deferred if complexity warrants.

## 17. Summary of decisions

| ID | Decision | Resolution |
|----|----------|-----------|
| D1 | claude-code → Ollama Cloud connection | Daemon at `localhost:11434` (Anthropic-compatible mode, official integration) |
| D2 | Relationship to claude-hud | Visual inspiration only; no code reuse |
| D3 | Quota / session usage source | GPU-time aggregated from transcript `total_duration` |
| D4 | Sidecar producer | Rejected; `ohud` queries Ollama daemon itself |
| D5 | Distribution | Claude Code marketplace plugin |
| D6 | Tech stack | TypeScript source; Bun preferred runtime, Node 18+ fallback; bundled `.js` distribution |
| D7 | i18n | English only |
| D8 | Cloud detection | `remote_host` field on `/api/tags` entries (deterministic, not suffix matching) |
| D9 | Slash commands | Single `/ohud` namespace with `setup`/`configure` subcommands |
| D10 | Feature scope | Full parity with claude-hud, minus Anthropic-specific features |
| D11 | Repository visibility | Public on GitHub from day 1 |
| — | Provider gating | Hard-fail with `⚠` warning line if not Ollama Cloud |
