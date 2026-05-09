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

## Step 5: Save and exit

If they confirm, the file is already written. Tell them to restart Claude Code or wait for the next status update for changes to take effect.
