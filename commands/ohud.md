---
description: Manage ohud statusline (subcommands: setup, configure, doctor)
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

This is the dispatcher for the `/ohud` namespace. Parse the user's argument and route:

- `/ohud setup` → invoke commands/ohud-setup.md instructions
- `/ohud configure` → invoke commands/ohud-configure.md instructions
- `/ohud doctor` → invoke commands/ohud-doctor.md instructions
- `/ohud` (no arg) → ask the user which subcommand they want via AskUserQuestion with three options: "Setup ohud", "Configure ohud", and "Run ohud doctor (diagnostics)".

If the argument is anything else, reply: "Unknown subcommand. Use `/ohud setup`, `/ohud configure`, or `/ohud doctor`."
