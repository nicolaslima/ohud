---
description: Configure ohud display preferences via guided flow
allowed-tools: Read, Edit, Write, AskUserQuestion
---

Goal: walk the user through the most common toggles and write them to `~/.claude/plugins/ohud/config.json`.

## Step 1: Load current config (or defaults)

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
test -f "$CFG" || echo '{}' > "$CFG"
cat "$CFG"
```

## Step 2: Pick a preset

Use AskUserQuestion to ask the user to choose:

- **Full** — everything Pilha A enables: showCost: true, showPromptCache: true, showTools: true, showAgents: true, showTodos: true, showDuration: true, showSpeed: true, showMemoryUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Essential** — showTools: true, showTodos: true, showCost: false, showAgents: false, showMemoryUsage: false, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Minimal** — all show* flags false EXCEPT: showModel: true, showContextBar: true, showApiTime: true, showUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: false, lineLayout: "expanded"
- **Custom** — keep current config; ask per-flag follow-up

## Step 3: Apply preset

Use the Edit tool to merge the preset's flag mapping into `~/.claude/plugins/ohud/config.json`. Always preserve `colors.*`, `pathLevels`, `maxWidth`, `display.timeFormat`, `display.promptCacheTtlSeconds`, `display.sevenDayThreshold`, `display.externalUsagePath`, `ollama.host` — these are advanced and stay user-managed.

## Step 4: Preview against the most recent session

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

Construct a real-shape stdin from the latest session and pipe to the bundle:

```bash
echo '{"session_id":"preview","transcript_path":"'"$LATEST"'","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | $RUNTIME $PLUGIN_PATH
```

Show the rendered output to the user. The preview now reflects toggles that depend on transcript data (tools, todos, agents, prompt-cache) — not fake numbers.

## Step 5: Pick a layout style

Use AskUserQuestion to ask the user to choose a layout strategy:

- **Row** (default) — the current statusline format. Multiple labeled segments, bars, cost, memory. Zero config changes needed.
- **Hush** — Pure-inspired minimal layout. Single line most of the time; expands to 2 lines only when tools/agents are active. No bars, no cost, no memory. Animated spinner, baseline colors, OSC 8 hyperlinks. Recommended for uncluttered terminals.

When the user selects **Row**, write `"layout": "row"` (or omit it) to `~/.claude/plugins/ohud/config.json`:

```bash
jq '.display.layout = "row"' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
```

When the user selects **Hush**, write `"layout": "hush"` to `~/.claude/plugins/ohud/config.json` AND set `statusLine.refreshInterval: 1` in `~/.claude/settings.json` so the spinner can animate at 1 Hz (the default Claude Code statusline only fires on events; without `refreshInterval`, the spinner is static between events):

```bash
# Write layout choice to ohud config
jq '.display.layout = "hush"' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"

# Non-destructively merge refreshInterval into Claude Code settings
SETTINGS="$HOME/.claude/settings.json"
test -f "$SETTINGS" || echo '{}' > "$SETTINGS"
jq '.statusLine.refreshInterval = 1' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
```

Show a layout preview using the selected layout by passing `"display":{"layout":"hush"}` or `"display":{"layout":"row"}` in the sample stdin if the bundle supports it, or simply by informing the user which output mode is now active.

## Step 6: Save and exit

If they confirm, the file is already written. Tell them to restart Claude Code or wait for the next status update for changes to take effect.
