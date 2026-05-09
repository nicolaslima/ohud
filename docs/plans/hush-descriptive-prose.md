# Hush Descriptive Prose Format

## Goal

Replace the card-cell Hush layout with a single descriptive prose statusline.
Reads like a sentence; one icon up front; all text dimmed by default; threshold
colors for consumption-style metrics; one hyperlink only (tools counter); smart
line-wrap on narrow terminals.

## Target output

**Idle, wide terminal (Anthropic)**
```
✱ ohud on develop using Opus 4.7 (1M) with context 24% used • cache 87% hit • 102 tks/s • session time 1:23:45 • rate 45%/5h
```

**Idle, wide terminal (Ollama — cache widget omitted, no data)**
```
🦙 ohud on develop using Kimi K2.6 (262k) with context 43% used • 82 tks/s • session time 0:43:12 • rate 45%/5h
```

**Narrow terminal (wrap)**
```
✱ ohud on develop using Opus 4.7 (1M) with context 24% used
  cache 87% hit • 102 tks/s • session time 1:23:45 • rate 45%/5h
```

**With active tools (line 2)**
```
✱ ohud on develop using Opus 4.7 (1M) with context 24% used • cache 87% hit • 102 tks/s • session time 1:23:45 • rate 45%/5h
  ▸ Read tool.ts • ▹ Bash 1.2s • ▹ Grep…3 more  ⌗247
```

`⌗247` is the only OSC 8 hyperlink in the whole render. It points to
`file://~/.cache/ohud/sessions/{session_id}.txt`, a plain text file written by
ohud each tick listing total tool counts and history for the live session.

## Visual rules

1. **Default text style:** `\x1b[2m…\x1b[22m` (dim). No saturated colors anywhere
   except threshold overrides.
2. **Icon** is the only character allowed at full intensity (subtle, but not
   dimmed) — it's the sole brand mark.
3. **Separator** between clauses on the same line: ` • ` (regular space + bullet
   + regular space, the bullet itself dimmed).
4. **Connector words** (`on`, `using`, `with`, `used`) stay dimmed and lowercase
   to read as a sentence.

## Threshold colors

Applied to: `context X% used`, `rate X%/5h`. Reused for any future consumption
metric.

| Range | Color |
|---|---|
| ≤ 60% | normal dim (no override) |
| 60–75% | warning (`\x1b[33m`, yellow) |
| ≥ 75% | danger (`\x1b[31m`, red) |

The rest stays dimmed regardless of value.

## Icons

| Mode | Unicode | Nerd Font | ASCII |
|---|---|---|---|
| Anthropic | `✱` U+2731 | `nf-fa-asterisk` | `*` |
| Ollama | `🦙` U+1F999 | (fallback to unicode) | `L` |
| Auto | resolved from `src/mode.ts` | same | same |
| None | empty string | empty | empty |

Default config is `auto`. User may force via `display.hush.icon`.

## Model + context display

Restore the `(1M)` / `(262k)` suffix that commit `e6c7c09` removed.

| `model.id` | Render |
|---|---|
| `claude-opus-4-7-1m` | `Opus 4.7 (1M)` |
| `claude-sonnet-4-6` | `Sonnet 4.6 (200k)` |
| `kimi-k2-6-262k` (Ollama) | `Kimi K2.6 (262k)` |
| unknown shape | passthrough |

Mapping is deterministic from the suffix in `model.id` plus a small lookup
table for known Anthropic models without an explicit suffix. No network calls.

## Persistence

`~/.cache/ohud/sessions/{session_id}.txt` is written each tick if and only if
the file's mtime is older than 1s (rate-limit). Format:

```
ohud session 71d87cce-f707-4f54-ae23-474ee334d0c0
started 2026-05-09 14:32:11

Tools (total: 247):
  Read    89
  Edit    42
  Bash    34
  Grep    29
  ...

Errors: 3
  - Bash exit 127 (line 14:32:55)
  - Read ENOENT  (line 14:35:02)
  ...
```

The session_id is already in stdin. The cache dir is created if absent. Files
are not cleaned up by ohud — Claude Code's session lifecycle drives that.

## Tasks

Each task is dispatched to a fresh subagent. Sequential — no parallel writes.

### T1. Transcript foundation

**Files**: `src/transcript.ts`, `src/types.ts`, new `src/session-state.ts`,
`tests/transcript.test.ts`.

- Extend `ToolEntry` with `hasError?: boolean`. Detect by inspecting
  `tool_result.content` for sentinel patterns (string content matching
  `/^Error:|exit code [1-9]|ENOENT/i`, or `is_error: true` if Anthropic
  exposes it in the JSONL — verify during impl).
- Add helper `computeTokensPerSecond(transcript): number | null` — uses
  per-message `usage.output_tokens` divided by inter-message elapsed time;
  returns null when fewer than 2 assistant messages.
- New module `src/session-state.ts` exposes
  `writeSessionFile(sessionId, transcript, errors): string` — returns
  absolute path. Uses `fs/promises` and a 1s mtime guard.
- Tests: error detection covers stderr-style content; tokens/sec returns null
  for fresh sessions; session file is rate-limited.

### T2. Icon picker + model formatter

**Files**: `src/render/widgets/project.ts`, `src/render/glyphs.ts`,
`src/types.ts`, `src/doctor.ts`, `tests/render-widgets.test.ts`.

- Add `iconForMode(mode, glyphMode, override): string` to glyphs.ts.
- Restore the `(1M)` / `(262k)` suffix in `condenseModelId` — output now
  `${friendlyName} (${contextLabel})`. Lookup table for known Anthropic
  models (Opus, Sonnet, Haiku → context windows). For Ollama models, parse
  the suffix from `model.id` (e.g. `-262k`).
- Doctor: render a row with the icon at all 3 tiers (unicode/ascii/nerd).
- Tests: matrix of `model.id` → expected display.

### T3. New widget cells

**Files**: new `src/render/widgets/session.ts`,
`src/render/widgets/cache.ts`, `src/render/widgets/rate.ts` (already exists,
extend), `src/render/colors.ts` (threshold logic),
`tests/render-widgets.test.ts`.

- `sessionTimeCell(transcript, now): HushCell` — formats
  `Date.now() - sessionStart` as `H:MM:SS`.
- `cacheCell(stdin): HushCell | null` — uses `cache_read_input_tokens`
  divided by total input tokens for that turn to produce a hit ratio:
  `cache 87% hit`. Returns null (widget omitted) when both
  `cache_creation_input_tokens` and `cache_read_input_tokens` are zero
  (typical for Ollama backends that don't surface cache stats). No fake
  duration — Claude Code's stdin doesn't expose cache TTL.
- `tokensPerSecCell(transcript): HushCell | null` — null when not enough data.
- `errorCountCell(transcript): HushCell | null` — null when zero.
- Thresholds: extract `applyThresholdColor(value, dimText, thresholds): string`
  from inline hush logic into `src/render/colors.ts` so all metrics share it.

### T4. Prose layout rewrite

**Files**: `src/render/layout/hush.ts` (rewrite), `src/render/widgets/*.ts`
(small edits to remove `.link` from project/branch/model),
`tests/render-layout-hush.test.ts` (rewritten).

- New `pack()` function returns 1, 2, or 3 strings:
  1. **Sentence line** (always): `{icon} {project} on {branch} using
     {model} with context {pct}% used [• {extras...}]`
  2. **Wrapped extras** (when sentence overflows): the extras tail moves to
     line 2 with a 2-space indent.
  3. **Activity line** (when there are running/done tools): same as today,
     with the OSC 8 hyperlinked tools counter `⌗N` at the end.
- Width measurement uses existing `width.ts` helpers.
- Hyperlinks: remove `.link` assignments in `project.ts:39, 50, 70`. Add
  `.link` to the activity-line tools counter only.
- Old card-cell rendering deleted — no separate "row of metric cells".
- Density / motion / identityColors config knobs are kept but their effects
  collapse: density just controls padding around `•`, identityColors becomes
  a no-op (everything is dim now).

### T5. Config, doctor, tests

**Files**: `src/types.ts`, `src/config.ts`, `src/doctor.ts`,
`tests/render-layout-hush.test.ts`, `tests/doctor.test.ts`.

- Add `display.hush.icon: "auto" | "anthropic" | "ollama" | "none"`. Default
  `"auto"`.
- Add `display.hush.thresholds.warning` (60), `.danger` (75) — already in
  schema, just confirm defaults.
- Doctor: print prose preview at three widths (40/80/160 cols), threshold
  swatch row, icon swatch row. Lint warns when `lineLayout: "expanded"` is
  used (now legacy — recommend `compact`).
- Snapshot tests: prose at idle/active/narrow/threshold-warning/threshold-
  danger.

## Out of scope

- New layout module (`prose.ts`). The prose format **replaces** Hush's
  current rendering inside `hush.ts`; row layout is untouched.
- Cleanup of `~/.cache/ohud/sessions/`. Claude Code drives session lifecycle.
- Click-to-expand inline (would need terminal cooperation we don't have).
  The OSC 8 hyperlink to the cache file is the agreed-upon affordance.

## Acceptance criteria

1. `bun test` passes.
2. `bun run dist/index.js < fixtures/sample.json` shows the sentence-style
   output with icon and dimmed text.
3. Resizing the terminal narrower causes the extras to wrap to line 2 (no
   mid-string truncation).
4. `OHUD_FORCE_THRESHOLD=80 bun run …` (or equivalent test fixture) shows
   red on `context 80% used`.
5. Clicking the `⌗N` opens the session text file in the user's $EDITOR /
   default file viewer.
6. `project`, `branch`, and `model` text are no longer hyperlinked.
