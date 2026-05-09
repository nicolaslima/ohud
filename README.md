# ohud

> Real-time statusline HUD for Claude Code with Ollama Cloud + Anthropic dual-mode rendering.

Auto-detects whether your Claude Code session is running against Ollama Cloud or Anthropic-direct, and renders the appropriate metrics:

- **Ollama mode**: model badge with parameter size (`[glm-5:cloud ⚡ 1T]`), context bar, API time consumed
- **Anthropic mode**: model badge, context bar, 5h/7d rate-limit usage, optional cost USD

Plus opt-in lines for tools activity, agent status, todo progress, environment counts, memory usage, and session duration.

## Install

```
/plugin marketplace add nicolaslima/ohud
/plugin install ohud
```

Restart Claude Code (Cmd+Q on macOS, then reopen). The HUD appears automatically.

**Optional**: run `/ohud configure` to pick a preset (Full / Essential / Minimal). Run `/ohud doctor` if anything looks wrong.

## Configure

```
/ohud configure
```

Pick a preset (Full / Essential / Minimal) or fine-tune individual toggles.

For advanced settings (custom colors, terminal width, prompt cache TTL), edit `~/.claude/plugins/ohud/config.json` directly.

## How it works

`ohud` runs as a Claude Code statusline command — Claude Code pipes session JSON to it on stdin, ohud parses the transcript JSONL, optionally probes `localhost:11434` (cached 60s) to detect Ollama, and writes ANSI lines to stdout.

Mode detection:

1. Probe `<ollama.host>/api/version`
2. Probe `<ollama.host>/api/tags` for models with `remote_host` set (Ollama Cloud)
3. Cross-check `stdin.model.id` against the cloud-models list
4. If all match → **Ollama mode**, else → **Anthropic mode** (silent fallback, no warning)

## Spec

Full design spec: [`docs/superpowers/specs/2026-05-08-ohud-design.md`](docs/superpowers/specs/2026-05-08-ohud-design.md)

## Inspiration

Visual layout inspired by [`claude-hud`](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts. ohud is an independent reimplementation, not a fork.

## License

MIT
