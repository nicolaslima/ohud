# Configuration Schema Reference

> **Diátaxis: Reference.** Every field in `HudConfig`. Look up; don't read top-to-bottom.

Config file lives at `~/.claude/plugins/ohud/config.json`. ohud loads it via `loadConfig` (`src/config.ts`) which does a `structuredClone` of `DEFAULT_CONFIG` then deep-merges any user fields on top.

If the file doesn't exist or has invalid JSON, ohud silently uses `DEFAULT_CONFIG`. There is no schema validation — unknown keys are kept but ignored.

The full TypeScript shape lives at `src/types.ts:HudConfig`. This page documents every field with its type, default, and which renderer (if any) consumes it.

---

## Top-level

| Field | Type | Default | Notes |
|---|---|---|---|
| `lineLayout` | `"expanded" \| "compact"` | `"expanded"` | `"compact"` is partially implemented in v0.1 — only `memory.ts` honors it. Others ignore. v0.2 will implement generic merging. |
| `pathLevels` | `1 \| 2 \| 3` | `1` | Number of trailing path segments shown in the project label. |
| `maxWidth` | `number \| null` | `null` | Hard cap on terminal columns. `null` → auto-detect via `process.stdout.columns` or `COLUMNS` env. |
| `elementOrder` | `readonly string[]` | `["project", "context", "apiTime", "usage", "cost", "promptCache", "memory", "environment", "tools", "agents", "todos"]` | Order in which line modules are evaluated. The first 4 (`project`, `context`, `apiTime`, `usage`) are special-cased in `render/index.ts` for merge support. |

---

## `display.*`

Fields under `display` control which line modules emit and how they format. Default values are listed.

### Line toggles

| Flag | Type | Default | Renderer | Effect |
|---|---|---|---|---|
| `showModel` | `boolean` | `true` | `project.ts` | Show `[modelName]` prefix in project line. |
| `showContextBar` | `boolean` | `true` | `context.ts` | Render the context-window usage bar (`Context ████░░░ 43%`). |
| `showApiTime` | `boolean` | `true` | `api-time.ts` | (Ollama mode only) Render `API ⏱ Xm Ys` from `stdin.cost.total_api_duration_ms`. |
| `showUsage` | `boolean` | `true` | `usage.ts` | (Anthropic mode only) Render 5h/7d rate-limit windows. |
| `showCost` | `boolean` | `false` | `cost.ts` | (Anthropic mode only) Render estimated session cost `Cost $X.YZ`. |
| `showPromptCache` | `boolean` | `false` | `prompt-cache.ts` | Render `Cache ▣ N%` from prompt-cache hit ratio. |
| `showTools` | `boolean` | `false` | `tools.ts` | Render `Tools ◐ Read ×42 │ Edit ×17` from transcript. |
| `showAgents` | `boolean` | `false` | `agents.ts` | Render `Agents` line summarizing sub-agent runs. |
| `showTodos` | `boolean` | `false` | `todos.ts` | Render `▸ in-progress (3/9)` todo summary. |
| `showConfigCounts` | `boolean` | `false` | `environment.ts` | Append CLAUDE.md / settings counts in environment line. |
| `showDuration` | `boolean` | `false` | `duration.ts` | Render session-duration line. |
| `showSpeed` | `boolean` | `false` | `duration.ts` | (Currently inert — depended on Ollama timing fields that don't propagate. v0.2 work.) |
| `showMemoryUsage` | `boolean` | `false` | `memory.ts` | Render system RAM bar (only when `lineLayout === "expanded"`). |
| `showEffortLevel` | `boolean` | `true` | `project.ts` | Append `effort:max` (or current level) to project line if `stdin.effort.level` set. |

### Context bar formatting

| Field | Type | Default | Notes |
|---|---|---|---|
| `contextValue` | `"percent" \| "tokens" \| "remaining" \| "both"` | `"percent"` | What number to display next to the bar. |
| `usageBarEnabled` | `boolean` | `true` | (Anthropic mode) Show `█░` bar in usage line. `false` collapses to `5h: 50%`. |
| `usageCompact` | `boolean` | `false` | (Anthropic mode) Force compact format even when bars enabled. |
| `showResetLabel` | `boolean` | `true` | (Anthropic mode) Append `resets in ~1h` (or absolute) after each window. |
| `timeFormat` | `"relative" \| "absolute" \| "both"` | `"relative"` | How to format the reset time when `showResetLabel: true`. |
| `sevenDayThreshold` | `number` | `80` | (Anthropic mode) Hide 7d window unless usage % is at least this. Reduces noise during normal sessions. |
| `warningThreshold` | `number` | `60` | Min pct for `colors.warning` (or `colors.usageWarning` for usage) on all percentage bars (context, usage, memory). |
| `criticalThreshold` | `number` | `75` | Min pct for `colors.critical` on all percentage bars. Higher priority than warning. |

### External usage source

| Field | Type | Default | Notes |
|---|---|---|---|
| `externalUsagePath` | `string` | `""` | Optional path to a JSON snapshot of usage data (for Anthropic users without rate-limit info in stdin). Empty = disabled. |
| `externalUsageFreshnessMs` | `number` | `300000` (5 min) | Max age of the snapshot before it's considered stale. |

### Prompt cache

| Field | Type | Default | Notes |
|---|---|---|---|
| `promptCacheTtlSeconds` | `number` | `300` | TTL for the prompt-cache calculation logic. |

### Glyph rendering

| Field | Type | Default | Notes |
|---|---|---|---|
| `glyphs` | `"unicode" \| "ascii" \| "auto"` | `"auto"` | Auto detects via `LANG`/`LC_ALL` `UTF-8` substring. ASCII fallback table covers all ohud glyphs. See [reference/environment-variables.md](environment-variables.md). |

### Merge groups (partially implemented)

| Field | Type | Default | Notes |
|---|---|---|---|
| `mergeGroups` | `readonly (readonly string[])[]` | `[["context", "apiTime"], ["context", "usage"]]` | **v0.1: documentation only.** The render logic in `src/render/index.ts:collectMerged` hardcodes `(context, apiTime)` and `(context, usage)`. Setting other groups has no effect today. v0.2 will make this generic. |

---

## `gitStatus.*`

Controls the `git:(...)` block in the project line.

| Field | Type | Default | Effect |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Run `git status` and render the block. `false` skips entirely. |
| `showDirty` | `boolean` | `true` | Append `*` if any uncommitted change exists. |
| `showAheadBehind` | `boolean` | `false` | Render `↑3 ↓1` inside `git:(...)` when the branch diverges from upstream. |
| `pushWarningThreshold` | `number` | `0` | If `ahead >= this`, color the `↑N` indicator with `colors.warning`. `0` disables. |
| `pushCriticalThreshold` | `number` | `0` | If `ahead >= this`, color the `↑N` indicator with `colors.critical`. Higher priority than warning. |

---

## `colors.*`

Colors are passed to `color(spec, text)` in `src/render/colors.ts`. Each spec can be a named color, a 256-color index `"0"`-`"255"`, or RGB hex `"#rrggbb"`.

Named colors supported: `dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`. Anything else falls back to plain text.

| Field | Default | Used by |
|---|---|---|
| `context` | `"green"` | Context bar fill (low usage) |
| `apiTime` | `"brightBlue"` | API ⏱ value |
| `usage` | `"brightBlue"` | Usage bar fill (low) |
| `warning` | `"yellow"` | Warning bar color (context/memory ≥ `warningThreshold`, push warning) |
| `usageWarning` | `"brightMagenta"` | Usage bar at ≥ `warningThreshold` — distinct from `warning` so users can map "usage saturation" specifically. |
| `critical` | `"red"` | Critical bar color (≥ `criticalThreshold` on context/usage/memory, push critical, error sentinel) |
| `model` | `"cyan"` | `[modelName]` brackets |
| `project` | `"yellow"` | Project path |
| `git` | `"magenta"` | `git:(`, `)` parens |
| `gitBranch` | `"cyan"` | Branch name and ahead/behind |
| `label` | `"dim"` | Field labels (`Context`, `API`, `Cache`, etc) |

If `process.env.NO_COLOR` is set (non-empty) or `process.env.TERM === "dumb"`, **all** colors collapse to plain text regardless of these settings. See [reference/environment-variables.md](environment-variables.md).

---

## `ollama.*`

Probe behavior. Only relevant if you have or might have an Ollama daemon.

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | `string` | `"http://localhost:11434"` | Where to probe. Cache keys include this — if you change it mid-session, the cache invalidates correctly. |
| `daemonTtlSeconds` | `number` | `5` | How long to trust a `daemonOk: true` cache. Short by design — see [explanation/probe-cache-policy.md](../explanation/probe-cache-policy.md). |
| `cloudModelsTtlSeconds` | `number` | `120` | How long to trust the cached `cloudModels` list. Long by design — models change rarely. |
| `probeTimeoutMs` | `number` | `500` | Per-fetch timeout (`AbortController`). Both `/api/version` and `/api/tags` fire in parallel. |

---

## Example config files

### Minimal (just project + context)

```json
{
  "lineLayout": "expanded",
  "display": {
    "showCost": false,
    "showTools": false,
    "showAgents": false,
    "showTodos": false,
    "showMemoryUsage": false
  }
}
```

### Full (everything on)

```json
{
  "lineLayout": "expanded",
  "display": {
    "showCost": true,
    "showPromptCache": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true,
    "showMemoryUsage": true,
    "showEffortLevel": true
  },
  "gitStatus": {
    "showAheadBehind": true,
    "pushWarningThreshold": 5,
    "pushCriticalThreshold": 10
  }
}
```

### Anthropic-only (no Ollama daemon expected)

```json
{
  "ollama": {
    "host": "http://localhost:11434",
    "daemonTtlSeconds": 600,
    "cloudModelsTtlSeconds": 600,
    "probeTimeoutMs": 100
  }
}
```

The high TTLs and short timeout effectively disable probe overhead — the first failed probe is cached for 10 minutes.

---

## See also

- [reference/slash-commands.md](slash-commands.md) — `/ohud configure` writes to this file.
- [reference/environment-variables.md](environment-variables.md) — env vars that override config.
- [explanation/probe-cache-policy.md](../explanation/probe-cache-policy.md) — TTL design rationale.
- `src/types.ts` — authoritative TypeScript definition.
- `src/config.ts` — `DEFAULT_CONFIG` source of truth.
