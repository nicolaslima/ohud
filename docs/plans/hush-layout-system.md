# Plan: Hush Layout System for ohud

> **Status:** Active. Branch: `feat/grid-layout-system` (will be renamed via PR title). Workflow: subagent-driven-development. Selected after research synthesis (R1 starship-claude / R2 Claude Code official docs / R3 broader CLI patterns).

## 1. Goal

Introduce a **layout strategy engine** in `src/render/` that decouples *what to render* (Widgets) from *how to arrange them* (Layouts). Ship two concrete layouts:

1. **`row`** — drop-in replacement for current behavior (byte-identical output). Default for backwards compatibility.
2. **`hush`** — new minimalist layout inspired by [sindresorhus/pure](https://github.com/sindresorhus/pure) (5k stars) and [Starship plain-text-symbols preset](https://starship.rs/presets/plain-text-symbols) (35k stars). Three operational principles:
   - **Conditional bracket suppression** — segment + its separators vanish together when data is absent or zero
   - **Contextual dimming** — `\x1b[2m` by default; full-brightness only when a value crosses an attention threshold
   - **Compact-when-idle** — collapses to a single line when nothing is busy; expands to 2 lines when activity exists

Bonus task derived from R2 research: deprecate daemon-probe-based mode detection in favor of the authoritative `model.id` from stdin (Ollama exposes Anthropic-compatible `/v1/messages` endpoint, breaking the old assumption).

## 2. Why this refactor matters (research-grounded)

R1 (starship-claude) and R3 (Pure / Starship) **independently** converge on the same insight: a fluid statusline should *contract* to peripheral whisper when nothing is wrong, and *expand only when attention is genuinely required*. R3 quotes Pure's design philosophy verbatim: "show only what changed, in subtle color on a transparent background, so the prompt recedes until needed."

R2 confirms this aligns with Claude Code's official statusline contract: stdin authoritative, ANSI SGR codes only, no enforced line cap (but more lines compete with chat content), 300ms debounce with cancellation if a new event fires mid-execution.

Today's `src/render/index.ts` is imperative prose that special-cases line 1 (project), line 2 (merged context+apiTime/usage), then loops `elementOrder` for the rest. There is no abstraction over "an item in the statusline" with metadata about when it should be visible vs. dim vs. emphasized. Layouts cannot be swapped without rewriting all 12 renderers.

A proper Strategy pattern (Widgets implement an interface with metadata; Layouts are pure functions over `WidgetCell[]`) gives us responsiveness, extensibility, and clean adoption of the Hush philosophy.

## 3. Architecture

### 3.1 Widget interface — `src/render/widget.ts`

```ts
import type { RenderContext } from "../types.js";

/** A widget produces zero or one cell per tick. */
export interface Widget {
  readonly id: string;
  readonly group: WidgetGroup;
  readonly priority: number;
  readonly minWidth: number;
  readonly preferredWidth?: number;

  /** Verbose render — used by RowLayout. Returns existing-style ANSI output. */
  render(ctx: RenderContext): WidgetCell | null;

  /** Optional minimal render — used by HushLayout. If absent, HushLayout falls back to render() with ANSI stripped. */
  renderHush?(ctx: RenderContext): HushCell | null;
}

export type WidgetGroup = "header" | "metrics" | "activity";

/** Verbose cell (RowLayout). */
export interface WidgetCell {
  id?: string;
  group?: WidgetGroup;
  body: string;       // ANSI-colored
  visualWidth: number;
}

/** Minimal cell (HushLayout). */
export interface HushCell {
  id?: string;
  group?: WidgetGroup;
  text: string;                              // PLAIN — no ANSI codes
  attention: "muted" | "normal" | "warning" | "danger";
}
```

`attention` semantics:
- `muted` — secondary information, render in dim regardless of context (e.g., session duration when short)
- `normal` — primary information, render in default color (e.g., model id, project name, branch when clean)
- `warning` — needs awareness, render in yellow (e.g., context 60-75%, dirty git)
- `danger` — needs action, render in red (e.g., context ≥75%, RAM ≥75%)

### 3.2 Layout interface — `src/render/layout/index.ts`

```ts
import type { WidgetCell, HushCell } from "../widget.js";
import type { HudConfig } from "../../types.js";

export type LayoutName = "row" | "hush";

export interface Layout {
  readonly name: LayoutName;
  pack(cells: (WidgetCell | HushCell)[], termWidth: number, config: HudConfig): string[];
}

import { rowLayout } from "./row.js";
// import { hushLayout } from "./hush.js"; // wired in Task B

export const LAYOUTS: Record<LayoutName, Layout> = {
  row: rowLayout,
  hush: rowLayout, // temporary stub until Task B; replaced with hushLayout
};
```

RowLayout consumes `WidgetCell` (via widget.render()). HushLayout consumes `HushCell` (via widget.renderHush() with fallback to render()).

### 3.3 Widget registry — `src/render/widgets/index.ts`

Each renderer moves to `src/render/widgets/<id>.ts`. Each exports a default Widget instance. Registry imports them and exposes:

```ts
export const WIDGETS: readonly Widget[] = [
  projectWidget, contextWidget, apiTimeWidget, usageWidget, costWidget,
  promptCacheWidget, toolsWidget, agentsWidget, todosWidget, environmentWidget,
  memoryWidget, durationWidget,
];

export function visibleWidgets(config: HudConfig): Widget[] {
  return WIDGETS.filter(w => isVisible(w, config));
}
```

Visibility rule mirrors today's `display.show*` flags exactly (no behavior change).

### 3.4 Orchestrator changes — `src/render/index.ts`

```ts
export function render(ctx: RenderContext): string {
  const widgets = visibleWidgets(ctx.config);
  const layoutName = ctx.config.display.layout ?? "row";
  const layout = LAYOUTS[layoutName] ?? LAYOUTS.row;

  // Width precedence (preserves existing documented behavior — see docs/reference/environment-variables.md):
  // ctx.config.maxWidth (config) → COLUMNS (env) → process.stdout.columns → 120
  const termWidth = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);

  // Layout decides which render path to call (verbose or hush)
  const cells = widgets
    .map(w => {
      if (layoutName === "hush" && w.renderHush) {
        const c = w.renderHush(ctx);
        return c ? { ...c, id: w.id, group: w.group } : null;
      }
      const c = w.render(ctx);
      return c ? { ...c, id: w.id, group: w.group } : null;
    })
    .filter((c): c is WidgetCell | HushCell => c !== null);

  // Sentinel fallback: if no widgets produced output (e.g., empty config), emit `ohud` label
  // so the statusline isn't blank. Preserved from original renderer.
  const lines = layout.pack(cells, termWidth, ctx.config);
  if (lines.length === 0) return color(ctx.config.colors.label, "ohud");

  return lines.join("\n");
}
```

The complex special-case logic moves into `RowLayout.pack()`. HushLayout owns the conditional suppression and dimming rules. The sentinel fallback ensures a non-blank statusline even when every widget returns null.

**Note:** Task A may hardcode `layoutName = "row"` because `display.layout` does not exist in `HudConfig` until Task C extends the type. The dynamic read above kicks in starting with Task C.

### 3.5 Priority / minWidth / group assignments

| Widget       | group     | priority | minWidth |
|--------------|-----------|----------|----------|
| project      | header    | 100      | 20       |
| context      | metrics   | 90       | 22       |
| apiTime      | metrics   | 80       | 14       |
| usage        | metrics   | 80       | 22       |
| cost         | metrics   | 70       | 14       |
| promptCache  | metrics   | 60       | 14       |
| memory       | metrics   | 50       | 18       |
| duration     | metrics   | 40       | 12       |
| tools        | activity  | 90       | 16       |
| agents       | activity  | 85       | 16       |
| todos        | activity  | 70       | 20       |
| environment  | activity  | 30       | 14       |

## 4. Visual design — `hush` layout

### 4.1 Three operational rules (NON-NEGOTIABLE)

1. **Conditional bracket suppression.** A widget that returns `null` from `renderHush()` causes its visual neighbors' separator chars to vanish too. Translation: HushLayout only emits a separator (e.g., a space) BETWEEN consecutive non-null cells. No orphan separators ever.

2. **Contextual dimming.** Every cell with `attention: "muted"` is wrapped in `\x1b[2m...\x1b[22m` (dim on / dim off). Every cell with `attention: "normal"` is rendered in default color (no ANSI). `warning` gets yellow (`\x1b[33m`). `danger` gets red (`\x1b[31m`). The `dim` modifier respects `NO_COLOR` and `TERM=dumb` (returns plain text).

3. **Compact-when-idle.** When all `activity`-group cells return null (no tools running, no agents working, no todos in flight), HushLayout emits a single line containing only the visible header + metrics cells. When any activity cell is non-null, HushLayout emits a second line with activity-group cells.

### 4.2 Three rendered states (revised after user feedback round 4)

**REMOVED in Hush mode:** cost widget, memory widget, all bar characters (`█`/`░`), pipes (`│`).
**ADDED in Hush mode:** baseline colors per widget, animated spinner for running activity, OSC 8 hyperlinks on identity widgets.

**Idle** (low context, no tools, clean git):

```
ohud  main  opus-4.7  15%
```

- Single line.
- `ohud` — **cyan**, OSC 8 link to `file://${project_dir}` (opens project folder in Finder/Explorer when terminal supports it)
- `main` — **green** (clean git), OSC 8 link to remote URL when detectable (GitHub/GitLab/etc)
- `opus-4.7` — **blue** (condensed from `claude-opus-4-7`), OSC 8 link to model doc page
- `15%` — **gray/dim** (below warning threshold)
- No `git:()`, no brackets, no bars, no pipes.

**Active** (mid context, running tools, dirty git):

```
ohud  main*  opus-4.7  68%
◑ Edit ×4   ◑ Read ×2
```

- Two lines.
- `main*` — **yellow** (warning, dirty marker)
- `68%` — **yellow** (warning, ≥60% threshold)
- `◑` — animated spinner cycling `◐ ◓ ◑ ◒` at 1 Hz (frame = `Math.floor(Date.now()/1000) % 4`)
- `Edit` / `Read` — **cyan** (active tool name); `×4` / `×2` — gray
- No cost shown. No memory shown. No bar chars.

**Critical** (high context, dirty git, multiple activity):

```
ohud  main*  opus-4.7  92%
◑ Edit ×4   ◑ Read ×2   ✓ TaskCreate ×51
```

- `92%` — **red** (danger, ≥75%)
- Running items: animated spinner + cyan tool name
- Done items: **dim green** `✓` + dim text + dim count
- No cost line. No memory line. Width-aware truncation to terminal width.

### 4.3 Per-widget `renderHush()` behavior (revised)

| Widget       | Idle output                       | Active output                | Critical output            | Notes                                                                 |
|--------------|-----------------------------------|------------------------------|----------------------------|-----------------------------------------------------------------------|
| project      | `ohud`  `main`  `opus-4.7`        | `ohud`  `main*`  `opus-4.7`  | `ohud`  `main*`  `opus-4.7`| Emits 3 sub-cells with baseline colors and OSC 8 links (see 4.5)      |
| context      | `15%`                             | `68%`                        | `92%`                      | Plain text % only — no bar chars. Threshold drives attention color.   |
| apiTime      | (muted) `42ms`                    | `420ms`                      | `1.5s`                     | Always emit when >0. Muted <100ms; warning ≥500ms; danger ≥1500ms.    |
| usage        | (null)                            | `5h 25%`                     | `5h 62%`                   | Plain text — no bar. Suppressed when both 5h and 7d <50%.             |
| cost         | (null)                            | (null)                       | (null)                     | **REMOVED in Hush.** Always returns null. Still rendered in Row mode. |
| promptCache  | (null)                            | `cache 4m`                   | `cache 4m`                 | Suppressed <60s freshness.                                            |
| memory       | (null)                            | (null)                       | (null)                     | **REMOVED in Hush.** Always returns null. Still rendered in Row mode. |
| duration     | (muted) `2h`                      | `2h 15m`                     | `2h 15m`                   | Always present; muted until ≥4h.                                      |
| tools        | (null)                            | `◑ Edit ×4  ◑ Read ×2`       | `◑ Edit ×4  ✓ Search ×10`  | Running gets animated spinner; done gets static `✓`. See 4.5.         |
| agents       | (null)                            | `◑ Explore ×2`               | `◑ Explore ×2  ✓ Bash ×3`  | Same pattern as tools. Animation at 1Hz.                              |
| todos        | (null)                            | (null)                       | `▸ todo content`           | Suppressed when no in-progress todo.                                  |
| environment  | (null)                            | (null)                       | (null)                     | Always null in Hush — low priority data.                              |

### 4.4 Threshold rules (memory removed)

| Field    | Muted        | Normal      | Warning           | Danger            |
|----------|--------------|-------------|-------------------|-------------------|
| Context% | <60          | (n/a)       | 60..74            | ≥75               |
| Usage%   | <50          | 50..59      | 60..74            | ≥75               |
| apiTime  | <100ms       | 100..499ms  | 500..1499ms       | ≥1500ms           |
| Duration | <4h          | 4h..7h59m   | 8h..11h59m        | ≥12h              |

Thresholds reuse `display.warningThreshold` (60) and `display.criticalThreshold` (75) for percent-based fields. Time thresholds are widget-local constants.

### 4.5 Output mechanics + baseline colors + spinner + OSC 8 (revised)

#### Baseline color palette (NEW — addresses "minimum color" feedback)

| Element              | Default color              | ANSI       | Threshold-shifted to                     |
|----------------------|----------------------------|------------|------------------------------------------|
| Project name         | cyan                       | `\x1b[36m` | unchanged                                |
| Branch (clean)       | green                      | `\x1b[32m` | yellow if dirty                          |
| Branch (dirty `*`)   | yellow                     | `\x1b[33m` | red if extreme (TBD - probably skip)     |
| Model id             | blue                       | `\x1b[34m` | unchanged                                |
| Effort level         | magenta                    | `\x1b[35m` | unchanged (already widget-colored today) |
| Context %            | gray (default fg)          | (none)     | yellow ≥60%, red ≥75%                    |
| Usage % / period     | gray                       | (none)     | yellow ≥60%, red ≥75%                    |
| apiTime              | dim                        | `\x1b[2m`  | yellow ≥500ms, red ≥1500ms               |
| promptCache          | dim cyan                   | `\x1b[2;36m` | unchanged                              |
| Duration             | dim                        | `\x1b[2m`  | unchanged                                |
| Tool/agent (running) | cyan + animated spinner    | `\x1b[36m` + spinner | unchanged                      |
| Tool/agent (done)    | dim green                  | `\x1b[2;32m` | unchanged                              |
| Todo (in progress)   | yellow                     | `\x1b[33m` | unchanged                                |

Every widget's `renderHush()` returns plain text (NO ANSI inside `text` field). HushLayout applies the appropriate ANSI based on `attention` level + the baseline color from this table. This keeps widgets simple and centralizes color theme.

#### Spinner animation (NEW — addresses "animated glyphs" feedback)

For activity-group widgets (tools, agents, todos) where item is currently running:

- Glyph set (Unicode default): `◐ ◓ ◑ ◒` (4 frames)
- Glyph set (ASCII fallback when `display.glyphs === "ascii"`): `| / - \` (4 frames)
- Frame index per tick: `Math.floor(Date.now() / 1000) % 4` — pure function, no state
- Cycle period: 4 seconds
- Refresh cadence: Claude Code default fires only on events; user must set `statusLine.refreshInterval: 1` (1 second minimum per docs) for the spinner to advance during idle. ohud's `/ohud setup` will set this when Hush layout is selected.

When `attention === "muted"` (done items), use static `✓` (Unicode) or `x` (ASCII) — no animation.

#### OSC 8 hyperlinks (NEW — addresses "interactive" feedback)

Three identity widgets emit OSC 8 hyperlinks that open in the user's default handler when clicked (supported in iTerm2, Kitty, WezTerm, Warp, VSCode integrated terminal — gracefully ignored elsewhere):

| Widget     | Link target                                                          |
|------------|----------------------------------------------------------------------|
| project    | `file://${stdin.workspace.project_dir}` — opens project in Finder    |
| git branch | `${gitRemoteUrl}` if remote URL is detectable HTTP(S) — opens repo   |
| model      | `https://docs.anthropic.com/en/docs/about-claude/models#${anchor}`   |

Tools and agents do NOT get links — there's no useful URL to open without Claude Code's cooperation. (Future: when Claude Code exposes `claude://` scheme, link tool/agent to docs page.)

OSC 8 emission format:
```
\x1b]8;;${url}\x07${text}\x1b]8;;\x07
```

When `url` is empty/null, only `${text}` is emitted (no escape overhead). When `NO_COLOR` is set, links remain (links are not color, they're metadata) — but if user wants to disable, future `display.hush.hyperlinks: boolean` config can opt out.

#### Layout mechanics

- HushLayout joins cells within a line using **two spaces** (`"  "`).
- Each line is truncated to `termWidth` with `…` if it overflows.
- ANSI color is applied per-cell; OSC 8 link wraps the colored text; the inter-cell whitespace is unstyled.
- When `NO_COLOR=1` or `TERM=dumb`, all attention levels render in plain text. Asterisk `*` on dirty git stays as the only structural cue. Spinners still animate (they're chars, not color).

## 5. Config schema additions (revised after user feedback)

```ts
// in HudConfigDisplay (src/types.ts)
export interface HudConfigDisplay {
  // ... existing fields ...

  /** Layout strategy. Default "row" preserves current behavior. */
  layout?: "row" | "hush";

  /** Hush layout configuration. Ignored when layout !== "hush". */
  hush?: {
    /** Collapse to single line when no activity. Default true. */
    compactWhenIdle?: boolean;
    /** Override percent thresholds. Defaults to warningThreshold/criticalThreshold. */
    thresholds?: { warning?: number; danger?: number };
    /** Emit OSC 8 hyperlinks on identity widgets. Default true. Disable for terminals that mishandle them. */
    hyperlinks?: boolean;
    /** Animate spinner glyph for running activity. Default true. Disable for `NO_ANIMATION` users. */
    animate?: boolean;
  };
}
```

Defaults in `src/config.ts`:

```ts
display: {
  // ... existing ...
  layout: "row",
  hush: { compactWhenIdle: true, hyperlinks: true, animate: true },
}
```

When user selects Hush layout via `/ohud configure`, the configure command also writes `statusLine.refreshInterval: 1` to `~/.claude/settings.json` so the spinner can animate at 1 Hz (default Claude Code statusline only fires on events; without `refreshInterval`, spinner is static between events).

## 6. Bonus: mode detection fix (R2 finding)

Today's `src/mode.ts` resolves Ollama vs Anthropic via daemon-probe (HTTP to `localhost:11434`). This misfires when a user routes Anthropic SDK calls through Ollama's `/v1/messages` Anthropic-compatible endpoint.

New rule (Task C):

```ts
function resolveMode(stdin: StdinData, probe: OllamaProbeResult): "ollama" | "anthropic" {
  const id = stdin.model?.id?.toLowerCase() ?? "";
  if (id.startsWith("claude-")) return "anthropic";
  if (id.length > 0 && !id.startsWith("claude-")) return "ollama";
  // fallback when model.id is missing
  return probe.daemonOk ? "ollama" : "anthropic";
}
```

The fallback path preserves existing behavior for stdin without `model.id` (legacy or test scenarios).

## 7. Performance budget

- HushLayout MUST not add more than 3 ms wall-clock per tick at p50 vs RowLayout (measured via `OHUD_PROFILE=1`).
- No new I/O, no new dependencies, no `string-width`.
- Conditional suppression is O(N) over visible widgets — trivial.

## 8. Backwards compatibility

- Default `display.layout: "row"`. Existing users see byte-identical output.
- `RowLayout` MUST produce the same output as today's renderer for every test case (acceptance criterion for Task A).
- `display.layout: "hush"` is opt-in via `/ohud configure`.
- Old config files lacking `display.layout` are upgraded transparently (default applied during `loadConfig`).

## 9. Testing strategy

- `tests/render-layout-row.test.ts` — confirms RowLayout output matches current renderer for ≥ 8 scenario configs.
- `tests/render-layout-hush.test.ts` — confirms Hush behavior:
  - Idle state: 1 line, all dim except project name
  - Active state: 2 lines, threshold colors applied
  - Critical state: 2 lines, danger colors, all activity visible
  - Conditional suppression: when widget X is null, no orphan separator before/after
  - `NO_COLOR=1`: plain text, asterisk-only dirty marker
  - `compactWhenIdle: false`: always emits 2 lines (header+metrics on line 1, activity on line 2 even if empty)
- `tests/render-widget-registry.test.ts` — verifies all 12 widgets registered, IDs unique, priorities valid.
- `tests/mode.test.ts` — verifies new `model.id`-driven mode detection (claude-* → anthropic, anything-else → ollama, missing → daemon-probe fallback).
- Existing tests in `tests/render-lines.test.ts`, `tests/cost.test.ts`, `tests/render-thresholds.test.ts`, `tests/render-path.test.ts` continue to pass.
- Final integration: `render(ctx)` with full-preset stdin at width 80/120/200 in both layouts produces expected output.

## 10. Tasks (mapped to TaskCreate IDs #25, #30, #31, #32)

### Task A (#25) — Foundations + RowLayout (drop-in)

**Goal:** Introduce `Widget` and `Layout` types, migrate all 12 renderers to Widget classes (delegating to existing `lines/<id>.ts` functions), implement RowLayout that produces byte-identical output to today's `render(ctx)`. Bundle keeps working throughout. No user-visible changes.

**Files owned (write/edit/create):**
- `src/render/widget.ts` (new) — Widget + WidgetCell + HushCell + WidgetGroup types per section 3.1
- `src/render/layout/index.ts` (new) — Layout interface + LAYOUTS registry
- `src/render/layout/row.ts` (new) — RowLayout implementation
- `src/render/widgets/index.ts` (new) — registry + visibleWidgets(config) helper
- `src/render/widgets/{project,context,api-time,usage,cost,prompt-cache,tools,agents,todos,environment,memory,duration}.ts` (12 new files) — each delegates to `lines/<id>.ts`
- `src/render/index.ts` (rewrite — calls layout.pack)
- `src/render/colors.ts` (verify dim palette key exists; add if missing — `\x1b[2m`)
- `tests/render-layout-row.test.ts` (new) — at least 8 golden cases
- `tests/render-widget-registry.test.ts` (new)

**Files NOT touched:** `src/render/lines/*.ts` left in place untouched. `src/types.ts` not modified (Hush types come in Task B). No config changes (Task C).

**Acceptance:**
- All 146 existing tests pass.
- 8+ new golden cases for RowLayout.
- `bun run typecheck` and `bun run build` succeed.
- One commit titled `refactor: introduce Widget+Layout abstractions with RowLayout drop-in`.

### Task B (#30) — HushLayout + minimal-mode primitives (revised after user feedback)

**Goal:** Implement Hush per section 4 (revised). Add `renderHush()` to **9 of 12** widgets (cost and memory return null in Hush; environment is suppressed). Wire `hushLayout` into LAYOUTS map. New primitives: dim helper, spinner, OSC 8 link, baseline color application.

**Files owned:**
- `src/render/widget.ts` (edit — extend `HushCell` interface with `link?: string` and `animate?: "spinner" | null` fields)
- `src/render/dim.ts` (new) — exposes `dim(text)` returning `\x1b[2m{text}\x1b[22m` or plain when NO_COLOR
- `src/render/spinner.ts` (new) — exposes `spinnerFrame(now: number, mode: "unicode" | "ascii"): string`. Returns one of `◐ ◓ ◑ ◒` (unicode) or `| / - \` (ascii) by `Math.floor(now/1000) % 4`. Pure function.
- `src/render/hyperlink.ts` (new) — exposes `link(text: string, url: string | null): string`. Wraps in OSC 8 escape when url is non-null, else returns text. Respects a future `display.hush.hyperlinks: false` toggle.
- `src/render/layout/hush.ts` (new) — HushLayout: applies baseline colors per palette table (4.5), conditional suppression (4.5), dim/warning/danger by attention, OSC 8 wrapping, spinner injection for `animate === "spinner"` cells.
- `src/render/layout/index.ts` (edit — replace stub registration with real hushLayout import)
- `src/render/widgets/{project,context,api-time,usage,prompt-cache,duration,tools,agents,todos}.ts` (edit 9 — add `renderHush()` per section 4.3 table)
- `src/render/widgets/{cost,memory,environment}.ts` (edit 3 — `renderHush()` returns null always; widgets stay registered but inactive in Hush)
- `tests/render-layout-hush.test.ts` (new) — covers idle/active/critical states, conditional suppression, NO_COLOR, compactWhenIdle on/off, spinner frame determinism, OSC 8 emission, no-cost no-memory in Hush
- `tests/render-spinner.test.ts` (new) — pure-function tests for spinner frame computation
- `tests/render-hyperlink.test.ts` (new) — OSC 8 escape sequence correctness tests

**Files NOT touched:** `src/render/lines/*.ts` (Task D removes them); `src/types.ts` (Task C touches that); `src/config.ts` (Task C); `commands/*` (Task C); `src/mode.ts` (Task C); existing widgets metadata (only renderHush is added).

**HushCell type extension:**
```ts
export interface HushCell {
  id?: string;
  group?: WidgetGroup;
  text: string;                                // PLAIN — no ANSI codes
  attention: "muted" | "normal" | "warning" | "danger";
  link?: string;                               // optional OSC 8 URL (project/branch/model)
  animate?: "spinner" | null;                  // optional animation hint (running tools/agents)
}
```

**Acceptance:**
- HushLayout produces section 4.2 outputs verbatim for the 3 stated scenarios (with baseline colors, OSC 8 links, animated spinners as specced).
- `cost` and `memory` widgets return null from `renderHush()` (verified by tests).
- No bar chars (`█`/`░`) in any Hush output (verified by `expect(output).not.toContain('█')`).
- Spinner cycles 4 frames at 1Hz; frame index is `Math.floor(Date.now()/1000) % 4`.
- OSC 8 links emit `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` for project/branch/model.
- Conditional suppression: never emit a separator adjacent to a null cell (e.g., `ohud  opus-4.7  15%` when git is absent — only TWO spaces between `ohud` and `opus-4.7`, not three).
- NO_COLOR=1: plain text, no ANSI; OSC 8 links still emitted (links are not color); spinners still animate (chars not color).
- compactWhenIdle: false → always emits 2 lines (header on line 1, activity on line 2 even if empty).
- All 184 existing tests + new Hush tests pass.
- One commit titled `feat: implement HushLayout — Pure-inspired minimal with spinners + OSC 8 hyperlinks`.

### Task C (#31) — Wire display.layout + fix mode detection

**Goal:** Make layout user-selectable. Update types, defaults, configure command, doctor. Fix mode detection per R2 finding.

**Files owned:**
- `src/types.ts` — extend `HudConfigDisplay` with `layout` and `hush` fields per section 5.
- `src/config.ts` — add defaults: `layout: "row"`, `hush: { compactWhenIdle: true }`.
- `src/mode.ts` — replace daemon-probe-driven resolution with `model.id`-driven rule per section 6 (preserve daemon-probe fallback when stdin lacks model.id).
- `src/doctor.ts` — append "Active layout: <name>" line and "Mode resolution: model.id <id> → <mode>" line.
- `commands/ohud-configure.md` — add a question "Pick a layout style" with two options (Row / Hush). Persist `display.layout` accordingly.
- `tests/config.test.ts` (edit if exists, else new) — verify defaults applied for layout and hush.compactWhenIdle.
- `tests/mode.test.ts` (edit) — verify new model.id rule + fallback.
- `tests/doctor.test.ts` (edit if exists, else new) — verify "Active layout" line.

**Acceptance:**
- Loading config without `display.layout` resolves to `"row"`.
- Loading config with `display.layout: "hush"` is honored.
- `/ohud configure` flow asks for layout, writes correct value.
- Mode detection: `claude-*` → anthropic, otherwise → ollama, missing → daemon-probe.
- All existing tests + new tests pass.
- One commit titled `feat: surface display.layout in config + fix mode detection via model.id`.

### Task D (#32) — Documentation, retire src/render/lines/

**Goal:** Document the new system. Remove legacy `src/render/lines/`. Generate updated screenshots.

**Files owned:**
- `docs/explanation/hush-philosophy.md` (new) — explains conditional suppression + contextual dimming + compact-when-idle. References starship-claude, Pure, Starship.
- `docs/reference/widgets.md` (new) — catalog of all 12 widgets with id, group, priority, minWidth, render rules, hush behavior. Replaces `docs/reference/line-modules.md` (delete old at end).
- `docs/how-to/customize-layout.md` (new) — recipes: switch to hush, tune thresholds, disable compact-when-idle.
- `docs/reference/config-schema.md` (edit) — document `display.layout` and `display.hush.*`.
- `docs/explanation/architecture.md` (edit) — module map shows `src/render/widgets/` + `src/render/layout/`. Add "Layout strategies" sub-section.
- `README.md` (edit) — update screenshot to show Hush 3 states (idle/active/critical).
- `docs/_assets/hush-3-states.png` (new) — generated screenshot.
- `src/render/lines/` (delete entire directory) — widgets are self-contained.
- `src/render/index.ts` (edit — remove any leftover imports from `lines/`).
- `tests/render-lines.test.ts` (rename to `tests/render-widgets.test.ts` and adapt imports — test logic unchanged).

**Acceptance:**
- `bun run build` succeeds.
- All tests pass after rename (~170 total).
- `grep -r 'render/lines' src/` returns no hits.
- `docs/reference/line-modules.md` is gone; `widgets.md` replaces it; internal links updated.
- One commit titled `docs: document Hush minimalist layout, retire src/render/lines/`.

## 11. Out of scope

- Powerline ribbon, Tracks grid, TUI panels — explicitly rejected by user during research synthesis.
- 3rd-party widget registration via plugin config — follow-up.
- Theme system (Nord, Gruvbox, etc.) per ccstatusline/CCometixLine — possible follow-up for Hush, but not in scope here.
- Interactive TUI configurator (ccstatusline/CCometixLine pattern) — follow-up. The Hush layout's "interactivity" is delivered via OSC 8 hyperlinks only.
- Custom URL scheme (`claude://agents/select/...`) — would require Anthropic to add a URL handler in Claude Code; out of scope.
- Cost widget in Hush mode — explicitly removed by user feedback; remains visible in Row mode.
- Memory widget in Hush mode — explicitly removed by user feedback; remains visible in Row mode.
- Bar characters (`█`/`░`) in Hush mode — explicitly removed by user feedback; remain in Row mode.
- New dependencies — none.
- Direct edits to `dist/index.js` — built from source.

## 12. Final review

After Task D completes, dispatch a final cross-cutting code reviewer covering all 4 commits. After approval, switch to `superpowers:finishing-a-development-branch` to merge into main and tag a new release.
