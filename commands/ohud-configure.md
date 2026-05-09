---
description: Configure ohud display preferences via guided flow
allowed-tools: Read, Edit, Write, Bash, AskUserQuestion
---

Goal: walk the user through the most common toggles and write them to `~/.claude/plugins/ohud/config.json`.

## Step 1: Load current config (or defaults)

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
test -f "$CFG" || echo '{}' > "$CFG"
cat "$CFG"
```

## Step 2: Pick a layout style

Use AskUserQuestion to ask the user to choose a layout strategy:

- **Row** (default) — the classic statusline format. Multiple labeled segments, bars, cost, memory. Best for information-dense workflows where you want to see everything at once.
- **Hush** — Pure-inspired minimal layout. Single line most of the time; expands to 2 lines only when tools/agents are active. No bars, no cost, no memory. Animated spinner, baseline colors, OSC 8 hyperlinks. Recommended for uncluttered terminals.

**IMPORTANT — preserve sub-fields.** The commands below only mutate `display.layout`. They MUST NOT touch `display.hush.{compactWhenIdle, hyperlinks, animate}` because those are independent toggles a user may have customized in a previous run. Using `jq '.display.layout = "..."'` (assignment to a single path) is non-destructive — it leaves `display.hush.*` and every other sibling untouched.

When the user selects **Row**, write `"layout": "row"` to `~/.claude/plugins/ohud/config.json`:

```bash
# Sets display.layout="row" without touching any other key, including display.hush.*
jq '.display.layout = "row"' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
```

When the user selects **Hush**, write `"layout": "hush"` to `~/.claude/plugins/ohud/config.json` AND set `statusLine.refreshInterval: 1` in `~/.claude/settings.json` so the spinner can animate at 1 Hz (the default Claude Code statusline only fires on events; without `refreshInterval`, the spinner is static between events):

```bash
# Sets display.layout="hush" without touching any other key, including display.hush.*
jq '.display.layout = "hush"' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"

# Non-destructively merge refreshInterval into Claude Code settings
SETTINGS="$HOME/.claude/settings.json"
test -f "$SETTINGS" || echo '{}' > "$SETTINGS"
jq '.statusLine.refreshInterval = 1' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
```

Verify preservation: re-run `cat "$CFG" | jq '.display'` after the write — any pre-existing `display.hush.*` keys should still be present, and only `display.layout` should have changed.

## Step 3: Pick a preset (layout-aware)

Use AskUserQuestion to ask the user to choose a content preset. Show only options that are meaningful for the chosen layout.

**If layout=row**, offer all presets:
- **Full** — everything enabled: showCost: true, showPromptCache: true, showTools: true, showAgents: true, showTodos: true, showDuration: true, showSpeed: true, showMemoryUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Essential** — showTools: true, showTodos: true, showCost: false, showAgents: false, showMemoryUsage: false, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Minimal** — all show* flags false EXCEPT: showModel: true, showContextBar: true, showApiTime: true, showUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: false, lineLayout: "expanded"
- **Custom** — keep current config; ask per-flag follow-up

**If layout=hush**, offer only Hush-compatible presets (omit flags that are silenced by Hush — showCost, showMemoryUsage, showSpeed — to avoid misleading the user):
- **Hush Full** — showTools: true, showAgents: true, showTodos: true, showPromptCache: true, showDuration: true, showEffortLevel: true, gitStatus.showAheadBehind: true
- **Hush Essential** — showTools: true, showTodos: true, showEffortLevel: true, gitStatus.showAheadBehind: true
- **Hush Minimal** — showModel: true, showContextBar: true, showUsage: true, showEffortLevel: true (no activity widgets)
- **Custom** — keep current config; ask per-flag follow-up

Note: If user picks **Custom**, ask them about each flag individually, skipping flags that are silenced by the chosen layout (e.g. do not ask about showCost when layout=hush).

## Step 4: Apply preset

Use the Edit or Write tool to merge the preset's flag mapping into `~/.claude/plugins/ohud/config.json`. Always preserve `colors.*`, `pathLevels`, `maxWidth`, `display.timeFormat`, `display.promptCacheTtlSeconds`, `display.sevenDayThreshold`, `display.externalUsagePath`, `ollama.host` — these are advanced and stay user-managed.

## Step 5: Preview with side-by-side layouts

Resolve runtime and plugin path from state.json (set by `/ohud setup`):

```bash
STATE="$HOME/.claude/plugins/ohud/state.json"
if [ -f "$STATE" ]; then
  RUNTIME=$(jq -r .runtime "$STATE")
  PLUGIN_PATH=$(jq -r .pluginPath "$STATE")
elif [ -n "$CLAUDE_PLUGIN_ROOT" ]; then
  RUNTIME="node"
  PLUGIN_PATH="$CLAUDE_PLUGIN_ROOT/dist/index.js"
else
  echo "Run /ohud setup first to detect runtime."
  exit 1
fi
```

Find the latest transcript:

```bash
LATEST=$(ls -t ~/.claude/projects/*/$(ls -t ~/.claude/projects | head -1)/*.jsonl 2>/dev/null | head -1)
test -n "$LATEST" && tail -1 "$LATEST" | jq -r 'select(.type == "summary" or .type == "user")' | head -1
```

Render a preview using the chosen layout with a real-shape stdin from the latest session:

```bash
echo '{"session_id":"preview","transcript_path":"'"$LATEST"'","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | $RUNTIME $PLUGIN_PATH
```

Show the rendered output. Then, for comparison, show what the **other** layout looks like by temporarily overriding the layout field in the stdin (not the config):

```bash
# Preview in Row layout regardless of config
echo '{"session_id":"preview","transcript_path":"'"$LATEST"'","model":{"id":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | OHUD_LAYOUT_OVERRIDE=row $RUNTIME $PLUGIN_PATH 2>/dev/null || echo "(Row preview not available)"

# Preview in Hush layout regardless of config
echo '{"session_id":"preview","transcript_path":"'"$LATEST"'","model":{"id":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | OHUD_LAYOUT_OVERRIDE=hush $RUNTIME $PLUGIN_PATH 2>/dev/null || echo "(Hush preview not available)"
```

Show both outputs labeled:
```
Row layout:
  <row preview output>

Hush layout:
  <hush preview output>
```

This lets the user see the contrast before committing. If OHUD_LAYOUT_OVERRIDE is not implemented, just show the currently configured layout and describe the other in text.

## Step 6: Post-write lint

After writing the config, validate for useless flag combinations. Read back the written config and check for layout-flag collisions:

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
LAYOUT=$(jq -r '.display.layout // "row"' "$CFG")

if [ "$LAYOUT" = "hush" ]; then
  SHOW_COST=$(jq -r '.display.showCost // false' "$CFG")
  SHOW_MEM=$(jq -r '.display.showMemoryUsage // false' "$CFG")
  SHOW_SPEED=$(jq -r '.display.showSpeed // false' "$CFG")

  ISSUES=""
  [ "$SHOW_COST" = "true" ]  && ISSUES="$ISSUES showCost"
  [ "$SHOW_MEM" = "true" ]   && ISSUES="$ISSUES showMemoryUsage"
  [ "$SHOW_SPEED" = "true" ] && ISSUES="$ISSUES showSpeed"

  if [ -n "$ISSUES" ]; then
    echo "⚠ Hush silences the following flags (they are set but will never render):$ISSUES"
    echo "Remove them to avoid confusion? [s/N]"
  fi
fi
```

If the user confirms removal (types "s"), use jq to set those flags to false:

```bash
# Example: remove showCost, showMemoryUsage, showSpeed
jq '.display.showCost = false | .display.showMemoryUsage = false | .display.showSpeed = false' \
  "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
echo "Removed silenced flags."
```

## Step 7: Save and exit

If they confirm, the file is already written. Tell them to restart Claude Code or wait for the next status update for changes to take effect.
