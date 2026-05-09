# Design Decisions

> **Diátaxis: Explanation.** Cross-cutting decisions and the reasoning. Read this if you're wondering "why didn't they just do X?".

## Zero runtime dependencies

ohud's `package.json` has **no** `dependencies` block — only `devDependencies` (TypeScript, types, Bun). The runtime uses only Node/Bun stdlib + `fetch` + `AbortController`.

**Why:** Cold-start cost runs **every tick** because Claude Code spawns a fresh process. Each runtime dep parsed from `node_modules` adds bundle size, which adds cold-start parse time, which eats the 300 ms budget. See [300ms-budget.md](300ms-budget.md).

Practically: adding `chalk` (~50 KB) or `string-width` (~30 KB) for niceties was rejected during v0.1 review. The inline alternatives in `src/render/colors.ts` and `src/render/width.ts` are ~30 lines each — small, debuggable, exactly what's needed.

**Trade-off:** Re-implementing primitives (color, wcwidth, glyph fallback) means more code to maintain. The maintainability cost is bounded — these primitives don't change. The perf benefit is permanent.

## Spawn-per-tick, not a daemon

ohud is a short-lived program. Every tick: spawn → run → exit. There is no in-memory state preserved across ticks.

**Why:** Claude Code's plugin model declares a `statusLine` of `type: "command"`. That contract is spawn-per-tick. To do otherwise, ohud would need to:

- Run a background daemon (with its own lifecycle: when does it start? stop? what if Claude Code crashes?)
- Communicate via socket (introduces a wire protocol, error handling, version mismatch)
- Survive Claude Code restarts

For v0.1, all of that complexity was deferred. The spawn-per-tick model has the virtue of being stateless and crash-safe — if ohud has a bug, it dies and the next tick is clean.

**Trade-off:** Cold-start is unavoidable. ohud measured it (76.9 ms median) and accepted it as a fixed cost.

## `${CLAUDE_PLUGIN_ROOT}` in `plugin.json` — aspirational, not active

> ⚠️ **Updated post-install testing**: The original v0.1 design assumed Claude Code reads `plugin.json:statusLine` and resolves `${CLAUDE_PLUGIN_ROOT}` at render time. **In practice, Claude Code does not yet honor `plugin.json:statusLine` declarations.** Empirical testing showed that:
>
> - Slash commands declared in `plugin.json:commands[]` activate normally after `/plugin install`.
> - But `plugin.json:statusLine` is silently ignored — Claude Code only reads `statusLine` from `~/.claude/settings.json`.
>
> No other plugin in the ecosystem (including `claude-hud`, the original inspiration) declares `statusLine` in `plugin.json`. They all use the `settings.json` path, written by their own setup wizard.

### What this means in practice

1. ohud's `plugin.json` still declares `statusLine` (forward-compatibility — if Claude Code adds support, ohud activates automatically).
2. **Today, `/ohud setup` is a required install step**, not optional polish. It detects runtime and writes a working `statusLine` block to `settings.json`.
3. Users who skip `/ohud setup` will see slash commands work (`/ohud doctor`, etc) but **the statusline never renders** — the most confusing failure mode possible.

### The original three failure modes (still apply to settings.json)

The design rationale for plugin.json was to avoid the failure modes of writing absolute paths to settings.json:

1. **Path rot on update**: `/plugin update ohud` could change the cache path; the settings.json absolute path then points at a deleted file.
2. **Path rot on uninstall**: `/plugin remove ohud` deletes the plugin files but leaves the settings.json block.
3. **State handoff with `/ohud configure`**: configure needs to know runtime/path that setup chose.

These are real concerns. The current mitigation:

- The `/ohud setup` wizard writes a `bash -c '...'` one-liner that **dynamically resolves** the cache path at every spawn (matches what `claude-hud` does). So `/plugin update` doesn't break it — the wrapper re-globs the cache directory each tick.
- `state.json` (written by `/ohud setup`, read by `/ohud configure`) closes the handoff gap.
- `/plugin remove ohud` still leaves a stale settings.json block. This is a known caveat documented in `/ohud doctor` output. v0.2 should add an `/ohud uninstall` command that cleans up.

### v0.1.x → v0.2 path forward

Two paths converge eventually:

- **Short-term**: lean on `/ohud setup`. It's the reliable path. Document it as required.
- **Medium-term**: file an issue with Claude Code requesting `plugin.json:statusLine` support. When supported, ohud's existing declaration "just works" and `/ohud setup` becomes truly optional (its original v0.1 promise).
- **Long-term**: `plugin.json:statusLine` becomes the canonical mechanism; `/ohud setup` survives as a way to wrap the runtime (`bun --hot`, etc).

The lesson: **empirical install matters**. Design decisions made on assumed platform behavior need to be smoke-tested in the real install path before being marketed as the default.

## Why `dist/` is committed to git

Conventionally, build artifacts go in `.gitignore`. ohud commits `dist/index.js` instead. The rationale:

- Marketplace install = `git clone`. There is no `npm install` step. There is no `postinstall` hook running on the user's machine.
- If `dist/` weren't committed, marketplace install would land a tree without the entry point. The plugin literally couldn't run.
- Asking users to `bun run build` themselves requires them to have Bun installed. That's a hard prerequisite for what should be a single-command install.

The CI guard (`.github/workflows/ci.yml`) runs `bun run build && git diff --exit-code dist/` on every PR — if the committed bundle drifts from `src/`, CI fails. So the cost of committing `dist/` is bounded: PRs always include a fresh rebuild.

**Trade-off:** Bigger `git log -p` output for code review (the bundled JS shows up in diffs). That's fine — the human review focuses on `src/` and `tests/`; reviewers can ignore `dist/` diffs.

## The `:cloud` heuristic

`resolveMode` could have stuck to a simple "is `stdin.model.id` in `probe.cloudModels[].name`?" check. It doesn't. See [dual-mode-detection.md](dual-mode-detection.md) for the failure path.

The reason for the extra layer: **fixtures lied**. Test data was generated with the same model string on both sides of the comparison, which made `resolveMode` look correct in tests. Real production data was never verified — until the v0.1 review caught it.

The pattern is general: **if a test fixture asserts equality between two namespaces that aren't documented to align, the test is testing the fixture, not the system**. The `:cloud` heuristic + `scripts/verify-stdin-model-id.ts` (which captures real `stdin.model.id` values from `~/.claude/projects/`) close that gap.

## All errors hit stdout AND stderr AND a log file

The catch block in `src/index.ts` does three things:

```ts
} catch (err) {
  // 1. Visible red sentinel — Claude Code displays stdout
  console.log("\x1b[31mohud: error — see /ohud doctor or ~/.claude/plugins/ohud/last-errors.log\x1b[0m");
  // 2. Persistent log
  appendFileSync(logPath, `[${stamp}] ${msg}\n`);
  // 3. stderr for terminal/CI capture (Claude Code drops this)
  console.error("ohud: error", msg);
}
```

**Why three?** Claude Code's statusline contract discards stderr. So `console.error` alone is invisible to the user. But CI logs and direct terminal invocations do capture stderr — useful for debugging in those contexts. The stdout sentinel is the user-facing signal. The log file is what `/ohud doctor` reads to surface recent errors.

This was the highest-ROI fix in the v0.1 review (see C5 / Theme B in `.review/final/report.md`). Without observability, every other failure mode produced indistinguishable blank statuslines.

## Hand-rolled wcwidth, not `string-width`

For terminal-width truncation (`src/render/width.ts`), ohud has a custom `wcwidth` covering only the glyphs it emits (`⚡ ⏱ ◐ ✓ ▸ ▹ █ ░ │`) plus broad emoji and CJK ranges.

The popular npm package `string-width` would handle more cases correctly but adds:
- ~30 KB to the bundle
- A transitive dep on `eastasianwidth` and `strip-ansi`
- ~50 ms additional cold-start parse cost

For ohud's actual glyph inventory, the inline implementation is correct. The trade-off is: if a user adds custom CJK content via `colors.*` or future config fields, edge cases may render slightly off-grid. That's a v0.2 concern.

## Dead config triage: delete vs implement

The v0.1 review identified ~10 `HudConfig` flags that no renderer consumed. Two options:
- **Delete** them from the schema (Pilha B, 6 flags)
- **Implement** their renderers (Pilha A, 5 flags)

The decision criterion was **per-flag value**:

- `showOutputStyle`, `showSessionName`, `showClaudeCodeVersion`, `showTokenBreakdown`, `showFileStats`, `branchOverflow` — low practical value. Either niche or already represented by other lines. **Deleted.**
- `showEffortLevel`, `showAheadBehind`, `showResetLabel`, `timeFormat`, `pushWarningThreshold`/`Critical` — high value, easy to implement. **Implemented.**
- `mergeGroups` — medium value, non-trivial implementation (generic merge engine). **Deferred to v0.2.**

The middle case (`mergeGroups`) is the only flag still flagged DEAD by `/ohud doctor`, with a note in the schema. Users who try to set custom merge groups today get no error but no effect — that's an honest "coming in v0.2" state, surfaced via `doctor`.

## TypeScript with `.js` imports

Every TypeScript import uses the `.js` extension:

```ts
import { color } from "../colors.js";  // imports colors.ts
```

This is required for `module: NodeNext` mode. It looks weird but matches Node's ESM resolution: at compile time, TS resolves `.js` to the `.ts` source; at runtime, the bundle has `.js` paths. No runtime divergence.

## Stat-based transcript cache, not size-only

`parseTranscript` caches keyed on `(path, size, mtimeMs)`. Why both?

- `size` alone would miss in-place edits that don't change file length (rare in append-only JSONL but possible).
- `mtimeMs` alone would re-read on `touch` even if content unchanged.
- Both together: cache invalidates iff *either* changes — covers normal append (`size` grows) and rare full-rewrite (`mtimeMs` jumps).

The cache lives in module-level `Map<string, CacheEntry>`. Not persisted across ticks because each tick is a fresh process. So the first tick after spawn always parses; subsequent reads in the same process (e.g., during `/ohud doctor`) hit cache.

## Read next

- **[Architecture overview](architecture.md)** — putting it all together.
- **[Dual-mode detection](dual-mode-detection.md)** — the `:cloud` heuristic in detail.
- **[Probe cache policy](probe-cache-policy.md)** — split-TTL rationale.
- **[The 300ms budget](300ms-budget.md)** — perf-driven decisions.
