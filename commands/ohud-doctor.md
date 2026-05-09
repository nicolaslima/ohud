---
description: Diagnose ohud — show version, mode, probe, dead-flags, last errors
allowed-tools: Bash
---

Run the doctor:

```bash
node "$CLAUDE_PLUGIN_ROOT/dist/index.js" --doctor 2>&1 | head -60
```

Or, if `bun` is available:

```bash
bun "$CLAUDE_PLUGIN_ROOT/dist/index.js" --doctor 2>&1 | head -60
```

Show the output to the user verbatim. If `daemonOk: no`, suggest checking `ollama serve`. If any flags are flagged `DEAD FLAG`, point at `.review/final/report.md` Pilha A/B triage.
