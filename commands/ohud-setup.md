---
description: (Required after install) Activate the ohud statusline by writing settings.json
allowed-tools: Bash, Read, Edit, Write
---

> **Required step.** `/plugin install ohud` registers slash commands but does NOT activate the statusline — Claude Code does not currently read `plugin.json:statusLine` declarations. This command writes the actual `statusLine` binding to `~/.claude/settings.json`. Without it, slash commands work but the statusline never renders. See [docs/explanation/design-decisions.md](../docs/explanation/design-decisions.md#claude_plugin_root-in-pluginjson--aspirational-not-active) for the empirical investigation.

Goal: write a robust `statusLine` block to `~/.claude/settings.json` that:
- Survives `/plugin update` (the cache path may change — wrapper resolves dynamically each tick).
- Works under the limited PATH inherited by GUI-spawned processes (uses `zsh -lc` to source the user's profile).
- Detects the user's preferred runtime (Bun if available, Node otherwise).

## Step 1: Detect runtime

Run, in this order, and capture the first that succeeds:

```bash
if command -v bun >/dev/null 2>&1; then RUNTIME=bun
elif command -v node >/dev/null 2>&1; then RUNTIME=node
else
  echo "ohud requires Bun (recommended) or Node.js 18+. Install one and re-run /ohud setup."
  exit 1
fi
echo "Detected runtime: $RUNTIME"
```

## Step 2: Resolve plugin install path

The plugin's bundle lives in the marketplace cache. Layout: `~/.claude/plugins/cache/<marketplace>/ohud/<version>/dist/index.js`.

Glob to find any installed version (handles future updates without re-running setup):

```bash
PLUGIN_PATH=$(ls -1d "$HOME/.claude/plugins/cache/"*/ohud/*/dist/index.js 2>/dev/null \
  | head -1)
test -n "$PLUGIN_PATH" || { echo "ohud cache not found. Re-run /plugin install ohud."; exit 1; }
echo "Plugin path: $PLUGIN_PATH"
```

## Step 3: Build the command string

Use a `zsh -lc` wrapper to source the user's shell profile (gets full PATH including nvm/homebrew/`.local/bin`/`.bun/bin`). The wrapper also re-globs the cache path each tick, so `/plugin update` does not break the binding.

For Node runtime:

```bash
COMMAND='/bin/zsh -lc '\''bundle=$(ls -1d "$HOME/.claude/plugins/cache/"*/ohud/*/dist/index.js 2>/dev/null | head -1); exec node "$bundle"'\'''
```

For Bun runtime:

```bash
COMMAND='/bin/zsh -lc '\''bundle=$(ls -1d "$HOME/.claude/plugins/cache/"*/ohud/*/dist/index.js 2>/dev/null | head -1); exec bun "$bundle"'\'''
```

> **Why `zsh -lc` and not direct path?** GUI apps inherit `/usr/bin:/bin` PATH only — `node`/`bun` typically live in `/opt/homebrew/bin`, `~/.nvm/.../bin`, or `~/.bun/bin`, none of which are on that PATH. Login zsh sources `~/.zshrc` and gets the full PATH. Plus it inherits `LANG=...UTF-8` for proper glyph rendering.

> **Why glob the cache path inside the wrapper?** `/plugin update ohud` may install a new `<version>/` directory beside the old one. A hardcoded version path rots; a dynamic glob picks up the latest version every tick.

## Step 4: Write to `~/.claude/settings.json`

Use `jq` to merge:

```bash
jq --arg cmd "$COMMAND" '.statusLine = {
  "type": "command",
  "command": $cmd,
  "padding": 2
}' ~/.claude/settings.json > /tmp/settings.new && mv /tmp/settings.new ~/.claude/settings.json
```

Other settings are preserved.

## Step 5: Verify

Send a sample stdin through the wrapper to prove it spawns:

```bash
echo '{"session_id":"setup","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":10}}' \
  | eval "$COMMAND"
```

Expected: 1-2 lines of ANSI-colored output, no errors. If it errors:
- `node: command not found` → your zsh profile does not export node's path. Run `which node` interactively, then add `export PATH="$(dirname $(which node)):$PATH"` to `~/.zshrc`.
- Empty output → bundle exists but stdin parsing failed. Check `tail ~/.claude/plugins/ohud/last-errors.log`.

## Step 6: Persist state for `/ohud configure`

```bash
mkdir -p "$HOME/.claude/plugins/ohud"
cat > "$HOME/.claude/plugins/ohud/state.json" <<EOF
{
  "runtime": "$RUNTIME",
  "pluginPath": "$PLUGIN_PATH",
  "command": $(jq -R . <<< "$COMMAND"),
  "setupAt": "$(date -Iseconds)"
}
EOF
```

`/ohud configure` reads this for its preview rendering.

## Step 7: Tell the user to restart

After this step, **restart Claude Code** (`/exit` then reopen, or Cmd+Q on macOS). `settings.json:statusLine` is read at session startup; mid-session changes don't take effect until restart.

After restart, send any prompt to see the HUD render.
