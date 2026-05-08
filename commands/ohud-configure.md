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

Use AskUserQuestion to ask:

- **Full** — everything enabled (tools, agents, todos, cost, duration, memory, environment)
- **Essential** — tools + todos + git, no cost/memory
- **Minimal** — model, project, git, context bar only
- **Custom** — keep going to fine-grained toggles

## Step 3: Apply preset

Write the corresponding `display.show*` flags to the config file via Edit. Always preserve `colors.*`, `pathLevels`, `maxWidth`, `display.timeFormat`, `display.promptCacheTtlSeconds` — these are advanced and stay user-managed.

## Step 4: Preview

Render a sample using a fake stdin payload:

```bash
echo '{"session_id":"preview","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | <RUNTIME> <PLUGIN_PATH>
```

Show the output to the user. Ask if it looks right.

## Step 5: Save and exit

If they confirm, the file is already written. Tell them to restart Claude Code or wait for the next status update for changes to take effect.
