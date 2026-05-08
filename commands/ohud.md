---
description: Manage ohud statusline (subcommands: setup, configure)
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

This is the dispatcher for the `/ohud` namespace. Parse the user's argument and route:

- `/ohud setup` → invoke commands/ohud-setup.md instructions
- `/ohud configure` → invoke commands/ohud-configure.md instructions
- `/ohud` (no arg) → ask the user which subcommand they want via AskUserQuestion with two options: "Setup ohud" and "Configure ohud".

If the argument is anything else, reply: "Unknown subcommand. Use `/ohud setup` or `/ohud configure`."
