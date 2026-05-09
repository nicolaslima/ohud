---
description: (Optional) Override statusLine command — most users do not need this
allowed-tools: Bash, Read, Edit, Write
---

> **Note**: ohud now activates automatically via `plugin.json:statusLine` after `/plugin install ohud`. This command is only needed if you want to wrap the runtime (e.g., `bun --hot dist/index.js` for development).

Goal: configure `ohud` as the user's Claude Code statusline. After this command runs, restarting Claude Code should display the HUD.

## Step 1: Detect runtime

Run, in this order, the first command that succeeds:

```bash
bun --version 2>/dev/null && echo "RUNTIME=bun"
node --version 2>/dev/null && echo "RUNTIME=node"
```

If neither exists, tell the user: "ohud requires Bun (recommended) or Node.js 18+. Install one and re-run /ohud setup."

## Step 2: Resolve plugin install path

The plugin's `dist/index.js` lives at one of:

- `~/.claude/plugins/cache/<owner>/ohud/dist/index.js` (marketplace install)
- `~/.claude/plugins/ohud/dist/index.js` (direct install)

Locate the existing path:

```bash
ls -1 "$HOME/.claude/plugins/cache/"*/ohud/dist/index.js 2>/dev/null \
  || ls -1 "$HOME/.claude/plugins/ohud/dist/index.js" 2>/dev/null
```

Capture the first match into `PLUGIN_PATH`.

## Step 3: Build the command string

If `RUNTIME=bun` → `COMMAND="bun $PLUGIN_PATH"`
If `RUNTIME=node` → `COMMAND="node $PLUGIN_PATH"`

## Step 4: Write to ~/.claude/settings.json

Read the existing settings JSON, set `statusLine` to:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<COMMAND>",
    "padding": 2
  }
}
```

Use the Edit tool to merge — preserve other settings.

## Step 5: Verify

Print a sample invocation:

```bash
echo '{"session_id":"setup","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":10}}' | $COMMAND
```

The user should see one or two lines without errors. Tell them to restart Claude Code.
