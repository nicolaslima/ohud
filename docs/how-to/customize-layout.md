# How-To: Customize the Layout

> **Diátaxis: How-To.** Task: switch between Row and Hush layouts, tune thresholds, disable spinners and hyperlinks, and control compact mode. For a conceptual explanation of why these layouts exist, see [explanation/hush-philosophy.md](../explanation/hush-philosophy.md). For the full field reference, see [reference/config-schema.md](../reference/config-schema.md#display).

## Where to edit

```bash
~/.claude/plugins/ohud/config.json
```

After saving, restart Claude Code (or trigger a new assistant message) to re-render with the new values.

---

## Recipe 1 — Switch to Hush layout via `/ohud configure`

The guided configure command is the easiest path:

```
/ohud configure
```

When prompted "Pick a layout style", select **Hush**. The command writes `display.layout: "hush"` to your config and also sets `statusLine.refreshInterval: 1` in `~/.claude/settings.json` so the spinner animates at 1 Hz between events.

To switch back to Row (the default):

```
/ohud configure
```

Select **Row**. Or edit config.json directly:

```json
{
  "display": {
    "layout": "row"
  }
}
```

---

## Recipe 2 — Switch to Hush layout manually

If you prefer editing the config file directly:

```json
{
  "display": {
    "layout": "hush"
  }
}
```

Also add `statusLine.refreshInterval: 1` to `~/.claude/settings.json` for animated spinners:

```json
{
  "statusLine": {
    "type": "command",
    "command": "...",
    "padding": 2,
    "refreshInterval": 1
  }
}
```

---

## Recipe 3 — Tune warning and danger thresholds for Hush

By default, Hush uses the global `warningThreshold` (60%) and `criticalThreshold` (75%). To override just for Hush:

```json
{
  "display": {
    "layout": "hush",
    "hush": {
      "thresholds": {
        "warning": 70,
        "danger": 85
      }
    }
  }
}
```

With these values: context at 68% stays muted (below the 70% warning), context at 80% shows yellow (between 70–85%), and context at 92% shows red (at or above 85%).

The global `warningThreshold` and `criticalThreshold` still apply to Row mode (and to any Hush widget that doesn't read `hush.thresholds`).

---

## Recipe 4 — Disable spinners (`hush.animate: false`)

Spinners animate running tools and agents. Some users find animated characters distracting. To disable:

```json
{
  "display": {
    "layout": "hush",
    "hush": {
      "animate": false
    }
  }
}
```

Running tool names still appear in the activity line — only the spinning glyph (`◑`) is removed. Done tools still show `✓`.

---

## Recipe 5 — Disable OSC 8 hyperlinks (`hush.hyperlinks: false`)

Hush wraps the project name, git branch, and model label in OSC 8 hyperlinks. Most modern terminals display them as clickable text. Some older or restricted terminals may show them as garbage characters.

To disable:

```json
{
  "display": {
    "layout": "hush",
    "hush": {
      "hyperlinks": false
    }
  }
}
```

Links are metadata, not color — they persist through `NO_COLOR=1`. This flag is the only way to suppress them.

---

## Recipe 6 — Keep two lines always (disable compact mode)

By default, Hush collapses to one line when no tools or agents are active (`compactWhenIdle: true`). To always emit two lines (useful when you want a fixed-height statusline that doesn't shift the chat viewport):

```json
{
  "display": {
    "layout": "hush",
    "hush": {
      "compactWhenIdle": false
    }
  }
}
```

With `compactWhenIdle: false`, line 2 is always emitted — it is just empty when there is no activity.

---

## Recipe 7 — Combine multiple Hush options

All `hush.*` options compose freely:

```json
{
  "display": {
    "layout": "hush",
    "hush": {
      "compactWhenIdle": false,
      "animate": false,
      "hyperlinks": false,
      "thresholds": {
        "warning": 70,
        "danger": 90
      }
    }
  }
}
```

---

## Recipe 8 — Force Row layout with all widgets visible

If you want maximum information density:

```json
{
  "display": {
    "layout": "row",
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

This is the "Full" preset available via `/ohud configure`.

---

## Verify your changes

Test locally without restarting Claude Code:

```bash
echo '{
  "cwd": "/tmp/test",
  "model": {"id": "claude-opus-4-7", "display_name": "Claude Opus 4.7"},
  "context_window": {"used_percentage": 73, "context_window_size": 200000}
}' | node "$CLAUDE_PLUGIN_ROOT/dist/index.js"
```

If the layout did not change, verify:
1. JSON is valid: `cat ~/.claude/plugins/ohud/config.json | jq .`
2. `display.layout` is exactly `"hush"` or `"row"` (not `"Hush"` — case-sensitive).
3. Run `/ohud doctor` — it prints "Active layout: hush" or "Active layout: row".

---

## See also

- [explanation/hush-philosophy.md](../explanation/hush-philosophy.md) — why Hush behaves the way it does.
- [reference/widgets.md](../reference/widgets.md) — per-widget Hush behavior.
- [reference/config-schema.md](../reference/config-schema.md) — full field reference.
- [how-to/customize-colors-and-glyphs.md](customize-colors-and-glyphs.md) — tune Row mode colors.
