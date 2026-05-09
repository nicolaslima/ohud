---
description: Reset ohud config to defaults, with optional color preservation
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

Goal: back up the current `~/.claude/plugins/ohud/config.json` to a timestamped file, then restore `DEFAULT_CONFIG`. Optionally preserves any `colors.*` customizations the user has made.

## Step 1: Read current config

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
if [ ! -f "$CFG" ]; then
  echo "No config found at $CFG — nothing to reset."
  exit 0
fi
cat "$CFG"
```

## Step 2: Ask about color preservation

Use AskUserQuestion to ask:

> Your current config will be reset to defaults. Do you want to preserve your `colors.*` customizations? [Y/n]

- If **Y** (or enter, default): extract the `colors` block from the current config and merge it back after reset.
- If **n**: full reset — colors also revert to defaults.

## Step 3: Back up current config

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
BACKUP="${CFG}.backup-${TIMESTAMP}"
cp "$CFG" "$BACKUP"
echo "Backed up to: $BACKUP"
```

## Step 4: Extract colors if preserving

If the user chose to preserve colors, extract them now using jq:

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
COLORS=$(jq '.colors // {}' "$CFG")
echo "Preserving colors: $COLORS"
```

## Step 5: Write DEFAULT_CONFIG

Write the following DEFAULT_CONFIG to `~/.claude/plugins/ohud/config.json`:

```json
{
  "lineLayout": "expanded",
  "pathLevels": 1,
  "maxWidth": null,
  "elementOrder": ["project","context","apiTime","usage","cost","promptCache","memory","environment","tools","agents","todos"],
  "display": {
    "mergeGroups": [["context","apiTime"],["context","usage"]],
    "showModel": true,
    "showContextBar": true,
    "contextValue": "percent",
    "showApiTime": true,
    "showUsage": true,
    "usageBarEnabled": true,
    "usageCompact": false,
    "showResetLabel": true,
    "timeFormat": "relative",
    "sevenDayThreshold": 80,
    "warningThreshold": 60,
    "criticalThreshold": 75,
    "externalUsagePath": "",
    "externalUsageFreshnessMs": 300000,
    "showCost": false,
    "showPromptCache": false,
    "promptCacheTtlSeconds": 300,
    "showTools": false,
    "showAgents": false,
    "showTodos": false,
    "showConfigCounts": false,
    "showDuration": false,
    "showSpeed": false,
    "showMemoryUsage": false,
    "showEffortLevel": true,
    "glyphs": "auto",
    "layout": "row",
    "hush": { "compactWhenIdle": true, "hyperlinks": true, "animate": true }
  },
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "pushWarningThreshold": 0,
    "pushCriticalThreshold": 0
  },
  "colors": {
    "context": "green",
    "apiTime": "brightBlue",
    "usage": "brightBlue",
    "warning": "yellow",
    "usageWarning": "brightMagenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim"
  },
  "ollama": {
    "host": "http://localhost:11434",
    "daemonTtlSeconds": 5,
    "cloudModelsTtlSeconds": 120,
    "probeTimeoutMs": 500
  }
}
```

Use the Write tool to write this exactly to `~/.claude/plugins/ohud/config.json`.

## Step 6: Merge colors back (if preserving)

If the user chose to preserve colors, use jq to merge the saved colors block back in:

```bash
CFG="$HOME/.claude/plugins/ohud/config.json"
jq --argjson colors "$COLORS" '.colors = $colors' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
echo "Colors restored."
```

## Step 7: Confirm and summarize

Tell the user:
- Backup location: `~/.claude/plugins/ohud/config.json.backup-{timestamp}`
- Colors: preserved or reset (whichever they chose)
- Config is now at defaults — restart Claude Code or wait for the next status update for changes to take effect.
- They can use `/ohud configure` to re-enable specific features.
