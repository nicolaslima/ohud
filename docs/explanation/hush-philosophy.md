# The Hush Philosophy

> **Diátaxis: Explanation.** Read this to understand *why* ohud's Hush layout behaves the way it does — its design principles, their origins, and the tradeoffs they reflect. For configuration options, see [reference/config-schema.md](../reference/config-schema.md#displayhush). For switching to Hush, see [how-to/customize-layout.md](../how-to/customize-layout.md).

## Origin

Hush draws from two independent design lineages that converge on the same conclusion:

**R1 — starship-claude** (starship.rs + Claude integration, ~35k GitHub stars on Starship): The [Starship plain-text-symbols preset](https://starship.rs/presets/plain-text-symbols) demonstrates that a statusline can be maximally informative without a single Unicode glyph or block element. The insight: prompt clutter is always a product of *displaying metadata that isn't actionable yet*, not of displaying too many things.

**R3 — sindresorhus/pure** (~14k stars): Pure's design philosophy states explicitly: "show only what changed, in subtle color on a transparent background, so the prompt recedes until needed." A clean git working copy shows a green branch. A dirty tree turns it yellow. Nothing else changes. The prompt whispers; it only speaks when you need it to.

ohud's Row layout (default) renders all visible widgets every tick with full-brightness colors, bar charts, and separators — maximally informative, maximally present. Hush inverts the priority order: *recession by default, attention on escalation only*.

## The three operational principles

### 1. Conditional bracket suppression

In Row mode, a missing widget leaves a gap — the separator before it is still there, creating a visual orphan. Hush has a stricter rule: **a widget that returns null takes its surrounding separators with it**.

Practically: HushLayout joins cells with two spaces (`"  "`) only between adjacent non-null cells. There are never two consecutive separators; no orphaned whitespace. When git status is disabled, `ohud  opus-4.7  15%` has exactly one two-space gap between each pair — not three.

This matters because Hush is designed to be readable at a glance, without ANSI decorations like pipes or brackets framing each segment. The implicit spacing must be exact or the line feels broken.

### 2. Contextual dimming

Every cell in Hush carries an `attention` value: `muted`, `normal`, `warning`, or `danger`. HushLayout applies color accordingly:

| Attention | ANSI rendering | When used |
|-----------|---------------|-----------|
| `muted`   | `\x1b[2m` dim | Secondary info: context <60%, short duration, cache TTL |
| `normal`  | Baseline color (cyan/green/blue/etc.) | Primary info: project name, clean branch, model |
| `warning` | Yellow `\x1b[33m` | Threshold crossed: dirty git, context 60–74%, slow API |
| `danger`  | Red `\x1b[31m` | Action needed: context ≥75%, very slow API |

The key property: **muted cells dim without disappearing**. Context at 14% is still visible — it just recedes into the background. At 68% it turns yellow. At 92% it turns red. The information is always present; the color signals whether it needs your attention right now.

`NO_COLOR=1` collapses all colors to plain text. Structural cues (the `*` on a dirty branch, the `×N` count on tools) carry meaning without color.

### 3. Compact-when-idle

Hush partitions widgets into three groups:

- **header** — project name, branch, model (always visible)
- **metrics** — context %, api time, usage, prompt cache, duration (always visible)
- **activity** — tools, agents, todos (only when active)

When no activity-group widget produces output, HushLayout emits a single line. When any activity widget fires, a second line appears below. This means the statusline is one line when nothing is happening and two lines when it is.

The config option `display.hush.compactWhenIdle: false` disables this — always emitting two lines regardless. Use this if you want a fixed-height statusline that doesn't shift the chat viewport when activity starts.

## Three rendered states

```
# Idle — low context, clean git, no tools
ohud  main  opus-4.7  15%

# Active — warning context, running tools, dirty git  
ohud  main*  opus-4.7  68%
◑ Edit ×4   ◑ Read ×2

# Critical — danger context, mixed running + done tools
ohud  main*  opus-4.7  92%
◑ Edit ×4   ✓ Search ×10
```

**Idle:** Single line. Project in cyan. Branch in green (clean). Model in blue. Context % dimmed because it's below the warning threshold.

**Active:** Two lines. Branch turns yellow (dirty `*`). Context turns yellow (68% ≥ 60% warning threshold). Activity line shows running tools with animated spinner (`◑` cycling through `◐ ◓ ◑ ◒` at 1 Hz).

**Critical:** Two lines. Context turns red (92% ≥ 75% danger threshold). Running tools keep the spinner. Completed tools show a static `✓` in dim green — still visible but clearly finished.

## What Hush omits

Two widgets from Row mode are permanently silent in Hush: **cost** and **memory**. Both were removed in response to user feedback during design. The reasoning:

- **Cost** appears in Hush only when you genuinely care about billing — but Hush's philosophy is "show only when attention is needed." Cost is background context, not actionable within a single session. It remains available in Row mode where the user explicitly opted into a more verbose display.
- **Memory** similarly: system RAM is ambient information. Hush is for session-state signals (what is Claude doing *right now*), not system telemetry.

Bar characters (`█░`) are also absent. They work well in Row mode where space permits decorative bars, but Hush's single-line constraint and dimmed-by-default aesthetic don't benefit from them. The raw percentage is sufficient.

## Interaction design — OSC 8 hyperlinks

Three cells in Hush emit [OSC 8 hyperlinks](https://iterm2.com/documentation-escape-codes.html) — clickable links embedded in the terminal text:

| Cell | Link target |
|------|------------|
| Project name | `file://${project_dir}` — opens the project folder in your file manager |
| Branch name | GitHub/GitLab/Bitbucket remote URL (SSH and HTTPS forms both detected) |
| Model label | `https://docs.anthropic.com/en/docs/about-claude/models#${anchor}` |

Links are not color. They persist even when `NO_COLOR=1`. They can be disabled with `display.hush.hyperlinks: false` for terminals that mishandle them. Supported terminals include iTerm2, Kitty, WezTerm, Warp, and the VS Code integrated terminal.

## See also

- [how-to/customize-layout.md](../how-to/customize-layout.md) — switch to Hush, tune thresholds.
- [reference/widgets.md](../reference/widgets.md) — per-widget Hush behavior table.
- [reference/config-schema.md](../reference/config-schema.md#displayhush) — `display.hush.*` fields.
- [explanation/architecture.md](architecture.md#layout-strategies) — how Widget + Layout decouple rendering from arrangement.
