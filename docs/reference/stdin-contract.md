# Stdin Contract Reference

> **Diátaxis: Reference.** The exact JSON shape ohud expects from Claude Code via stdin.

Claude Code spawns ohud's bundle and writes a single JSON object to its stdin. ohud reads it via `readStdin` (`src/stdin.ts`) — with a 250 ms first-byte timeout, 30 ms idle timeout, and 256 KB max-bytes guard.

The shape is documented in `src/types.ts:StdinData`. All fields are optional — ohud's renderers must handle missing fields gracefully.

## Top-level shape

```json
{
  "cwd": "/Users/me/projects/ohud",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_name": "ohud-v0.1-impl",
  "transcript_path": "/Users/me/.claude/projects/-Users-me-projects-ohud/550e8400-...jsonl",
  "version": "2.1.115",
  "model": { "id": "glm-5:cloud", "display_name": "glm-5:cloud" },
  "workspace": {
    "current_dir": "/Users/me/projects/ohud",
    "project_dir": "/Users/me/projects/ohud",
    "added_dirs": [],
    "git_worktree": "/Users/me/projects/ohud"
  },
  "context_window": {
    "context_window_size": 200000,
    "total_input_tokens": 84000,
    "total_output_tokens": 12000,
    "used_percentage": 48,
    "remaining_percentage": 52,
    "current_usage": {
      "input_tokens": 1200,
      "output_tokens": 80,
      "cache_creation_input_tokens": 1500,
      "cache_read_input_tokens": 22000
    }
  },
  "cost": {
    "total_cost_usd": 0.42,
    "total_duration_ms": 320000,
    "total_api_duration_ms": 252000,
    "total_lines_added": 312,
    "total_lines_removed": 88
  },
  "rate_limits": {
    "five_hour": { "used_percentage": 25, "resets_at": 1738425600 },
    "seven_day": { "used_percentage": 41, "resets_at": 1738857600 }
  },
  "effort": { "level": "max" },
  "output_style": { "name": "explanatory" },
  "exceeds_200k_tokens": false
}
```

## Field-by-field

### `cwd` / `workspace.current_dir`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `cwd` | `string?` | `src/git.ts`, `src/render/lines/project.ts` | Fallback if `workspace.current_dir` missing. |
| `workspace.current_dir` | `string?` | `project.ts`, `git.ts` | The actual session directory. Used for project label fallback (sliced by `pathLevels`) when `project_dir` is absent. |
| `workspace.project_dir` | `string?` | `project.ts` | **Preferred for project label** when non-empty. Renders as `basename(project_dir)` so the label shows the canonical repo root regardless of worktree (e.g., `claude-code` instead of `release+setup-plugin-structure`). Falls back to `current_dir`/`cwd` when absent, empty, or just `/`. |
| `workspace.added_dirs` | `string[]?` | (not currently consumed) | Reserved. |
| `workspace.git_worktree` | `string?` | (not currently consumed) | Reserved — would let project line distinguish worktrees of the same repo. |

### `session_id` / `session_name`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `session_id` | `string?` | `src/index.ts`, `src/ollama-probe.ts` | Used as cache key (`probeCachePath(sessionId)`). Falls back to `"default"` if missing. |
| `session_name` | `string?` | (not currently rendered) | The dead `showSessionName` flag was removed in v0.1. |

### `transcript_path`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `transcript_path` | `string?` | `src/transcript.ts` | Path to session JSONL. ohud reads it (with stat-cache) to extract tools/agents/todos/timestamps. Empty/missing path skips. |

### `version`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `version` | `string?` | (not currently rendered) | Claude Code version. Could be valuable to show; deferred to v0.2. |

### `model`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `model.id` | `string?` | `src/mode.ts`, `src/render/lines/project.ts` | The model identifier. Mode resolution checks `endsWith(":cloud")` and exact match against probe's `cloudModels[].name`. |
| `model.display_name` | `string?` | `mode.ts`, `project.ts` | Fallback identifier if `id` not set. Both fields tried as candidates. |

### `context_window`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `context_window.context_window_size` | `number?` | (informational) | Total max tokens for the model. |
| `context_window.total_input_tokens` | `number?` | (informational) | Cumulative input tokens this session. |
| `context_window.total_output_tokens` | `number?` | (informational) | Cumulative output tokens. |
| `context_window.used_percentage` | `number?` | `src/render/lines/context.ts` | Primary input for context bar. If null/missing, context line returns null. |
| `context_window.remaining_percentage` | `number?` | (informational) | Sometimes more useful than used%. |
| `context_window.current_usage.*` | `number?` | `src/cost.ts`, `src/prompt-cache.ts` | Per-message token counts including cache_creation and cache_read. Used for cost estimation and prompt-cache hit ratio. |

### `cost`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `cost.total_cost_usd` | `number?` | `src/cost.ts` | Native cost from Claude Code. If present, ohud uses it as `source: "native"`. Otherwise estimates from token counts. |
| `cost.total_duration_ms` | `number?` | `src/render/lines/duration.ts` | Total wall clock. |
| `cost.total_api_duration_ms` | `number?` | `src/render/lines/api-time.ts` | **The only source for the `API ⏱` line in Ollama mode.** Wall-clock time spent in API calls. |
| `cost.total_lines_added` | `number?` | (not currently rendered) | Could feed a future "lines changed" line. |
| `cost.total_lines_removed` | `number?` | (not currently rendered) | Same. |

### `rate_limits`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `rate_limits.five_hour.used_percentage` | `number?` | `src/usage.ts`, `src/render/lines/usage.ts` | 5h window percentage. Anthropic-mode only. |
| `rate_limits.five_hour.resets_at` | `number?` | `usage.ts`, `usage.ts` (renderer) | Epoch seconds (NOT ms). Used for `resets in ~Xh` label. |
| `rate_limits.seven_day.used_percentage` | `number?` | Same | Hidden unless ≥ `display.sevenDayThreshold`. |
| `rate_limits.seven_day.resets_at` | `number?` | Same | Epoch seconds. |

### `effort`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `effort.level` | `"low" \| "medium" \| "high" \| "xhigh" \| "max" \| null` | `src/effort.ts`, `src/render/lines/project.ts` | Reasoning effort for the model. Renders as `effort:max` etc. |

`effort` itself is a defensive union: `StdinEffort \| string \| null`. Earlier Claude Code versions sent it as a bare string; current versions send the object. `src/effort.ts:resolveEffortLevel` handles both shapes. See `src/types.ts:StdinEffort` for the rationale comment.

### `output_style`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `output_style.name` | `string?` | (not currently rendered) | The active style ("explanatory", "default", etc.). The `showOutputStyle` flag was removed in v0.1; reintroduce in v0.2 if useful. |

### `exceeds_200k_tokens`

| Field | Type | Used by | Notes |
|---|---|---|---|
| `exceeds_200k_tokens` | `boolean?` | (not currently rendered) | Whether the session has exceeded the 200K context flag. v0.2 candidate for visual warning. |

## Behavior with malformed input

| Scenario | ohud's response |
|---|---|
| stdin is empty (TTY not detected) | Prints `"ohud: no stdin (setup verification)"` and exits 0. |
| First-byte timeout (250 ms) | `readStdin` returns `null`. Same handling as TTY-detected: print verification message. |
| Idle timeout (30 ms after first byte) | Returns whatever was read. May be partial. JSON parse may fail. |
| Max-bytes exceeded (256 KB) | Returns `null`. ohud falls through to verification message. |
| Invalid JSON | `try { JSON.parse(raw); } catch { return null; }`. Same as null. |

## Behavior with missing fields

ohud uses optional chaining everywhere. Most line renderers return `null` (skip) when their primary input is absent. Examples:

- No `context_window.used_percentage` → context line skipped.
- No `cost.total_api_duration_ms` → api-time line skipped.
- No `rate_limits` → usage line skipped.
- No `model` → falls back to `"model"` literal in project line.

If **everything** is null, the [minimum line fallback](../explanation/architecture.md#failure-modes-and-observability) emits `"ohud"` so the statusline isn't blank.

## See also

- `src/types.ts:StdinData` — authoritative TypeScript source.
- `src/stdin.ts` — read implementation with timeouts.
- [reference/config-schema.md](config-schema.md) — config that filters which fields render.
- [explanation/dual-mode-detection.md](../explanation/dual-mode-detection.md) — how `model.id` drives mode resolution.
