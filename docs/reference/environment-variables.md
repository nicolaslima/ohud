# Environment Variables Reference

> **Diátaxis: Reference.** All env vars ohud reads, what they do, and which file consumes them.

ohud is a small program — its env-var surface is intentionally tiny. Most behavior is controlled via `~/.claude/plugins/ohud/config.json` ([reference/config-schema.md](config-schema.md)).

## Variables

| Variable | Read by | Purpose |
|---|---|---|
| `NO_COLOR` | `src/render/colors.ts` | Disables ANSI color output when defined and non-empty. Per [no-color.org](https://no-color.org). |
| `TERM` | `src/render/colors.ts` | If `=== "dumb"`, disables ANSI color (terminals without ANSI capability). |
| `LANG` | `src/render/glyphs.ts` | If contains `UTF-8`, glyph mode `"auto"` resolves to `"unicode"`. Otherwise `"ascii"`. |
| `LC_ALL` | `src/render/glyphs.ts` | Same purpose as `LANG`; checked as fallback. |
| `COLUMNS` | `src/render/width.ts` | Terminal width hint. Read first, falls back to `process.stdout.columns`, then 120. |
| `OHUD_PROFILE` | `src/index.ts` | If `=== "1"`, prints `ohud-profile: total=Xms` to stderr at end of each tick. Zero-cost when unset. |
| `CLAUDE_PLUGIN_ROOT` | (set by Claude Code) | Plugin root directory. Used by `plugin.json:statusLine.command` and slash commands. ohud's code reads it indirectly. |

## NO_COLOR

```ts
// src/render/colors.ts
function colorDisabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return true;
  if (process.env.TERM === "dumb") return true;
  return false;
}
```

**Trigger:** `NO_COLOR` is **defined** and **non-empty**. Empty string `NO_COLOR=""` does NOT trigger color disable (matches no-color.org spec).

**Effect:** All `color(spec, text)` calls return `text` unchanged. ANSI escape sequences are not emitted. The statusline is plain text.

**When to set:**
- CI logs where ANSI looks like `\x1b[36m...`.
- Corporate terminals that strip or mishandle ANSI.
- Screen readers / accessibility tools that read raw text.
- Color-blindness users who prefer plain output.

```bash
NO_COLOR=1 bun run dist/index.js
```

To set globally for your shell, add to `~/.zshrc` or `~/.bashrc`:

```bash
export NO_COLOR=1
```

## TERM=dumb

`TERM=dumb` is the canonical signal for a terminal without ANSI capability. ohud treats it the same as `NO_COLOR=1`. You shouldn't have to set this manually — it's set automatically by some emacs shells, dumb pipe contexts, etc.

## LANG / LC_ALL

```ts
// src/render/glyphs.ts
function autoMode(): "unicode" | "ascii" {
  const lang = process.env.LANG ?? "";
  if (lang.includes("UTF-8") || lang.toLowerCase().includes("utf8")) return "unicode";
  if (process.env.LC_ALL?.includes("UTF-8")) return "unicode";
  return "ascii";
}
```

**Effect:** When `display.glyphs` config is `"auto"`, ohud picks unicode if either env var indicates UTF-8 capability. Otherwise falls back to ASCII glyphs.

| LANG / LC_ALL contains | Resolved glyph mode |
|---|---|
| `UTF-8` (any case) | `unicode` |
| `utf8` (any case) | `unicode` |
| `C`, `POSIX`, anything else | `ascii` |

You can override the auto-detection by setting `display.glyphs: "unicode"` or `"ascii"` directly in config.

| Mode | Bolt | Clock | Running | Done | Active todo | Sep | Bar full | Bar empty | Up | Down |
|---|---|---|---|---|---|---|---|---|---|---|
| Unicode | `⚡` | `⏱` | `◐` | `✓` | `▸` | `│` | `█` | `░` | `↑` | `↓` |
| ASCII | `*` | `t` | `o` | `x` | `>` | `\|` | `#` | `.` | `^` | `v` |

## COLUMNS

ohud calls `detectTerminalWidth(env, fallback)` (`src/render/width.ts`) which:

1. Reads `process.env.COLUMNS` (parsed as int) — if set and > 0, uses that.
2. Falls back to `process.stdout.columns` (terminal-detected).
3. Falls back to `120` (hard-coded default).

The result is the cap for `truncateLine`. Lines longer than the cap get truncated with `…`.

If you want to force a specific width (e.g., for screen captures or testing):

```bash
COLUMNS=80 bun run dist/index.js < /tmp/sample-stdin.json
```

You can also override with `maxWidth` in the config file (which takes priority).

## OHUD_PROFILE

```ts
// src/index.ts (top of main())
const T0 = process.hrtime.bigint();
const profile = process.env.OHUD_PROFILE === "1";
// ... main body ...
if (profile) {
  const elapsedMs = Number(process.hrtime.bigint() - T0) / 1_000_000;
  process.stderr.write(`ohud-profile: total=${elapsedMs.toFixed(1)}ms\n`);
}
```

**Trigger:** Exactly `"1"`. Other values (`"true"`, empty, etc.) are treated as off.

**Effect:** Adds one stderr line per invocation with total wall-clock time.

**Use cases:**
- Reproducing the cold-start measurement (`docs/cold-start-measurement.md`).
- Catching perf regressions locally.
- Comparing before/after a change.

```bash
for i in 1 2 3 4 5; do
  echo '{...}' | OHUD_PROFILE=1 node dist/index.js 2>&1 >/dev/null
done
```

## CLAUDE_PLUGIN_ROOT

Set by Claude Code when invoking the plugin's `statusLine.command`. Points at the plugin's installed cache directory.

**Used in:** `plugin.json:statusLine.command` (the manifest itself), `commands/ohud-doctor.md` (slash command body), `commands/ohud-configure.md` (preview command), `src/doctor.ts:resolveBundlePath`.

You normally never set this yourself. ohud's code uses it like:

```bash
node "$CLAUDE_PLUGIN_ROOT/dist/index.js" --doctor
```

If you need to debug outside Claude Code, manually set it:

```bash
CLAUDE_PLUGIN_ROOT=/path/to/ohud-checkout node dist/index.js --doctor
```

## Variables ohud does NOT read

For completeness — some env vars you might expect ohud to support, but it doesn't:

| Variable | Why not |
|---|---|
| `OHUD_DEBUG` | Not implemented. Errors flow through the catch path → `last-errors.log` → `/ohud doctor`. No verbose mode flag in v0.1. |
| `OHUD_HOST` (Ollama override) | Use `ollama.host` in config.json instead. Env vars don't override config in v0.1 — config is the single source. |
| `FORCE_COLOR` | Not honored. ohud only respects the disable signals (`NO_COLOR`, `TERM=dumb`). If those aren't set, color is on. |
| `OHUD_LOG_LEVEL` | No log levels — errors are recorded uniformly to `last-errors.log`. |

## See also

- [reference/config-schema.md](config-schema.md) — primary configuration surface.
- [reference/slash-commands.md](slash-commands.md) — `/ohud doctor` reads `last-errors.log`.
- [explanation/300ms-budget.md](../explanation/300ms-budget.md) — `OHUD_PROFILE` use case.
- [how-to/work-in-restricted-terminals.md](../how-to/work-in-restricted-terminals.md) — `NO_COLOR`/`LANG` setup recipes.
