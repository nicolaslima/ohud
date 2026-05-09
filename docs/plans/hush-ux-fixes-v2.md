# Plan: Hush UX/DX Fixes (v2 — post-team-review)

> **Status:** Active. Branch: `develop`. Workflow: subagent-driven-development (parallel via team-implementer with strict file ownership). Triggered by user feedback "muito feio, sem UX e sem DX" + 26 findings from 3-dimension team review.

## 1. Goal

Address the 26 findings from the team review (visual / information-design / DX dimensions) in **4 parallel streams** with strict file ownership boundaries. Each stream produces its own commit + tests; final cross-cutting review consolidates.

The diagnose phase confirmed Hush IS active in user's config; the source code is correct (no `|` separator bug); the user's screenshot was taken before refresh — so SOME findings were artifacts of stale state, but the FUNDAMENTALS are real (model suffix `[1m]` leak, preset×layout collision silent, configure flow ordering broken, density too high, separator flat).

## 2. Streams (parallel-safe via file ownership)

### Stream A: DX flow (configure + doctor + reset)
**Owner files:** `commands/ohud-configure.md`, `commands/ohud-doctor.md`, new `commands/ohud-reset.md`, `src/doctor.ts`, `src/config.ts` (validation only, no schema changes — those are Stream B's territory).

### Stream B: Visual hierarchy (separator system + density)
**Owner files:** `src/render/layout/hush.ts`, `src/render/widget.ts`, `src/types.ts` (only fields B owns: `display.hush.density`).

### Stream C: Information design (cuts/relabels/regroups in widgets)
**Owner files:** `src/render/widgets/{project,context,usage,duration,tools,agents,prompt-cache}.ts`. Does NOT touch `hush.ts` or types — only widget render output.

### Stream D: Doc-reality sync
**Owner files:** `docs/explanation/hush-philosophy.md`, `docs/how-to/customize-layout.md`, `docs/tutorials/getting-started.md`, `docs/reference/widgets.md`, `docs/reference/config-schema.md`, `README.md`.

**Coordination:** B may add `display.hush.density` field to types — C and D should reference it. Stream D writes docs LAST (after A/B/C land) so it documents real implemented behavior.

## 3. Stream A — DX flow

### Tasks
1. **Reorder `commands/ohud-configure.md`**: Layout question becomes Step 2 (BEFORE preset). Preset becomes Step 3, layout-aware (only shows presets compatible with chosen layout). Preview becomes Step 4 with side-by-side Row vs Hush rendered from the user's actual most-recent transcript.
2. **Add post-write linter to configure**: After write, run validation that flags useless config combos (e.g., `showCost: true` + `layout: hush` → warn "Hush silences showCost; remove? [s/N]"). Updates config in-place if user confirms.
3. **`src/doctor.ts:--lint` mode**: Replace static "DEAD FLAG" with layout-aware classification:
   - `(consumed in row)` — flag is honored only when layout=row
   - `(consumed in hush)` — flag is honored only when layout=hush
   - `(consumed in both)`
   - `(silenced — wrong layout)` — flag set but current layout ignores it
   Cross-reference each `display.show*` flag against active layout's behavior.
   Add explicit warnings: `⚠ display.showCost: true but layout=hush silences this flag — remove or switch to layout=row`.
4. **Last-render mode tracking**: Append `Last rendered mode: ollama (model.id=glm-5:cloud)` line in doctor output. Read from a tiny state file at `~/.claude/plugins/ohud/last-mode.json` updated by `src/index.ts:main()` per tick (one-time write, no cost).
5. **`commands/ohud-reset.md` (NEW)**: Slash command that backs up current config to `config.json.backup-{timestamp}` and copies `DEFAULT_CONFIG` to `config.json`. Asks user "Preserve colors.* customizations? [Y/n]" — if yes, merge back colors block.
6. **Config validation in `src/config.ts:loadConfig`**: When file exists but parse fails, write `parse error: <message>` to `~/.claude/plugins/ohud/last-errors.log` AND surface in doctor's report. Currently silent (returns DEFAULT_CONFIG without trace).

### Files NOT touched (other streams own)
- Anything in `src/render/`
- Anything in `docs/` (Stream D)
- `src/types.ts` (Stream B)

### Tests
- `tests/doctor.test.ts` — extend with --lint mode tests, layout-aware classification
- `tests/config.test.ts` — extend with parse-error logging test
- New `tests/render-reset.test.ts` (or similar) — verify reset flow

### Commit title
`feat(dx): layout-aware doctor lint + reordered configure flow + /ohud reset`

## 4. Stream B — Visual hierarchy

### Tasks
1. **3-tier separator system in `src/render/layout/hush.ts`**:
   - `WITHIN_SEP = "·"` (or single space + chevron `›` for header sub-cells)
   - `BETWEEN_SEP = "    "` (4 spaces) for cross-group on same line
   - `BETWEEN_LINE = "\n"` (existing) for line breaks
   - Cells in same `group` join with WITHIN_SEP; group boundaries get BETWEEN_SEP.
2. **Add `display.hush.density: "compact" | "comfortable" | "airy"` config**:
   - `compact`: WITHIN=1 space, BETWEEN=2 spaces (current behavior, default)
   - `comfortable`: WITHIN=1 space, BETWEEN=4 spaces
   - `airy`: WITHIN=2 spaces, BETWEEN=6 spaces
3. **Demote identity colors** (visual review V2 + H3): make project name, branch (clean), and model use `attention: "muted"` `baseColor: undefined` so they render in default fg (or dim default). Reserve cyan/green/blue for active state cues. NOTE: this is a coordinator-decided default; user can re-enable colors via `display.hush.identityColors: true` config.
4. **Priority-aware truncation in `pack()`**: When line overflows, drop cells in increasing-priority order (lowest priority first) instead of right-cutting. Header (project) keeps; metrics drop usage > duration > apiTime > promptCache; activity drop done-tools first.
5. **Cap activity cells**: Hard cap at top 3 running + top 4 done by name. Append `+N more` cell when over.
6. **HushCell sub-styling**: Allow widgets to express `name + count` differently. Add optional fields:
   ```ts
   interface HushCell {
     // ... existing ...
     primaryText?: string;   // e.g., "Edit"  — gets baseColor
     secondaryText?: string; // e.g., "×6"    — gets dim
   }
   ```
   When both `primaryText` and `secondaryText` are present, layout renders as `${primaryText} ${dim(secondaryText)}`. Otherwise falls back to `text` field.

### Files NOT touched
- `src/render/widgets/*.ts` (Stream C uses the new fields C doesn't define them; B exposes the API, C consumes)
- `src/doctor.ts`, `src/config.ts` (Stream A)
- Any docs (Stream D)

### Tests
- `tests/render-layout-hush.test.ts` — extend with density tests, priority truncation, cap activity
- `tests/render-widget.test.ts` (or new) — verify HushCell new fields are typed

### Commit title
`feat(visual): 3-tier separator system + density knob + priority truncation in HushLayout`

## 5. Stream C — Information design

### Tasks
1. **`src/render/widgets/project.ts:condenseModelId`**: Strip context-window suffixes BEFORE other transformations:
   ```ts
   s = s.replace(/(-?(\[)?(\d+m|\d+k)\]?)$/i, "");
   ```
   Test cases: `claude-opus-4-7-1m` → `opus-4.7`, `opus-4.7[1m]` → `opus-4.7`, `claude-haiku-4-5-200k` → `haiku-4.5`.
   Capacity moves to context widget (Stream C task 2).
2. **`src/render/widgets/context.ts:renderHush`**: Append context-window capacity to percent text when capacity > 200k:
   - `39%` → `39% of 1M` (or `39% • 1M ctx`)
   - Read capacity from `ctx.stdin.context_window?.context_window_size`.
3. **`src/render/widgets/usage.ts:renderHush`**: Relabel format:
   - Old: `5h 79%` → New: `rate 79%/5h` or `rate 79% (5h)` (pick one consistent form). Same for `7d N%` → `quota N%/7d`.
   - Disambiguates from duration (which uses `15h 45m`).
4. **`src/render/widgets/duration.ts:renderHush`**:
   - Suppress when duration < 4h (return null) — addresses M-3 / L-3.
   - When ≥ 4h: change format to compact `15h45m` (no internal space) — disambiguates from usage's `5h 79%`.
   - Move group from `metrics` → `activity` (per Info F-I-C-2 regroup rec) so it doesn't sit next to usage on line 1.
5. **`src/render/widgets/tools.ts:renderHush`**:
   - Cap counts: `≥100 → 100+`, `≥10 → keep`, `<10 → keep`. Apply to both running and done.
   - Append target on running tool when `count === 1`: `Edit: foo.ts` (use basename only).
   - Append elapsed time on running tool when elapsed > 30s: `Edit (45s)`. Promote `attention: "warning"` if elapsed > 2 minutes.
   - Use new HushCell `primaryText` + `secondaryText` (Stream B field) for name vs count separation.
6. **`src/render/widgets/agents.ts:renderHush`**:
   - Same pattern as tools (cap counts, elapsed time on running, primary/secondary).
   - Drop `[opus-4.7]` model tag suffix on running agents (use `· opus-4.7` instead, dim).
7. **`src/render/widgets/project.ts:renderHush`** (continued):
   - Replace dirty marker `develop*` with `develop ●` (space + filled circle U+25CF) — addresses M-4. ASCII fallback `develop *`.
8. **`src/render/widgets/prompt-cache.ts:renderHush`**: Verify it's still appropriate; consider moving to `metrics` group (currently activity-side).

### Files NOT touched
- `src/render/layout/hush.ts` (Stream B)
- `src/render/widget.ts` (Stream B — but C reads new fields)
- `src/types.ts` (Stream B)
- Docs (Stream D)

### Tests
- `tests/render-widgets.test.ts` — extend with model suffix strip, dirty marker, count cap, target append, elapsed time
- New `tests/render-condense-model.test.ts` — focused tests for condenseModelId edge cases

### Commit title
`feat(info): strip model suffix + relabel rate-limit + cap counts + elapsed-on-running`

## 6. Stream D — Doc-reality sync

### Tasks (run AFTER A/B/C land)
1. **`docs/explanation/hush-philosophy.md`**:
   - Existing "3-state mockup" section: update mockups to match new behavior (no `[1m]`, `develop ●` instead of `develop*`, `rate 79%/5h` instead of `5h 79%`, no duration <4h, etc).
   - Add new section: **"Real-world Hush"** with 3 mockups by intensity:
     - Default Hush (only essential widgets): `ohud  develop  opus-4.7  39%`
     - Hush + active session (running tools): adds activity line
     - Hush + Full preset (everything user enabled): explains why density grows; suggests Recipes 9-12
2. **`docs/how-to/customize-layout.md`**:
   - Update existing recipes to reflect new field names + behaviors.
   - Add **Recipe 9: Reduce Hush density** (`hush.density: "compact"` + show flag toggles).
   - Add **Recipe 10: Force Hush ASCII glyphs** (`display.glyphs: "ascii"` + `hush.animate: false`).
   - Add **Recipe 11: OSC 8 hyperlinks only, no colors** (`NO_COLOR=1` env + keep links — verify combo works).
   - Add **Recipe 12: Suppress all but identity** (`showUsage: false, showDuration: false, showApiTime: false`).
3. **`docs/tutorials/getting-started.md`**:
   - Add new section "Quickstart: Hush vs Row" near top, before Step 1.
   - Show side-by-side mockup, brief one-line tradeoff.
   - Mention `/ohud configure` as the way to switch.
4. **`docs/reference/widgets.md`**:
   - Update Hush behavior columns for project (suffix strip), usage (label), duration (suppression + group change), tools (count cap + elapsed), agents (model tag change).
5. **`docs/reference/config-schema.md`**:
   - Add `display.hush.density` field
   - Add `display.hush.identityColors` field
   - Update existing field docs where Stream B/C changed semantics.
6. **`README.md`**:
   - Refresh the "Layouts" section to mention Hush's behavior. Update screenshot reference if helpful.

### Files NOT touched
- All `src/` files (other streams)
- `commands/` (Stream A)
- Tests (other streams)

### Commit title
`docs: sync Hush UX docs with v2 behavior + add real-world mockups + 4 new recipes`

## 7. Out of scope (defer to v3)

- Two-zone right-justified layout (Polarity-style) — would conflict with Claude Code's outer wrapping; needs more research.
- Theme system (Nord/Gruvbox/etc) per ccstatusline — large surface, separate epic.
- TUI configurator (interactive ccline -c style) — separate skill territory.
- Custom URL scheme `claude://` — needs Anthropic feature.
- Hush-specific `display.hush.zones` (compose own widget order per zone) — power-user feature.

## 8. Final review

After all 4 streams land, dispatch a final cross-cutting reviewer covering all 4 commits. Compare rendered output (real smoke test, not just code review) against new doc mockups. Verify the user's specific complaints from screenshot are addressed:
- `[1m]` removed: ✓ via Stream C task 1
- `5h 79%` and `15h 45m` no longer collide: ✓ via Stream C tasks 3+4
- Counts capped: ✓ via Stream C task 5
- Configure flow makes sense: ✓ via Stream A task 1
- Doctor lint useful: ✓ via Stream A task 3
- Density tunable: ✓ via Stream B task 2
- Priority truncation keeps important info: ✓ via Stream B task 4

After approval, mention to user that develop branch is ready for another round of practical testing before main merge.
