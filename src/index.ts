// src/index.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { readStdin } from "./stdin.js";
import { probeOllama } from "./ollama-probe.js";
import { runDoctor, writeLastModeState } from "./doctor.js";
import { resolveMode } from "./mode.js";
import { parseTranscript } from "./transcript.js";
import { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { fromStdin as usageFromStdin, fromExternalSnapshot as usageFromSnapshot } from "./usage.js";
import { resolveSessionCost } from "./cost.js";
import { getMemoryUsage } from "./memory.js";
import { resolveEffortLevel } from "./effort.js";
import { render } from "./render/index.js";
import type { RenderContext } from "./types.js";

const CONFIG_PATH = join(homedir(), ".claude/plugins/ohud/config.json");

// Ensure log directory exists (idempotent, safe if already exists)
mkdirSync(join(homedir(), ".claude/plugins/ohud"), { recursive: true });

export async function main(): Promise<void> {
  const T0 = process.hrtime.bigint();
  const profile = process.env.OHUD_PROFILE === "1";
  if (process.argv.includes("--doctor")) {
    const cfg = await loadConfig(CONFIG_PATH);
    const out = await runDoctor({ host: cfg.ollama.host, configPath: CONFIG_PATH });
    console.log(out);
    return;
  }
  try {
    const stdin = await readStdin();
    if (!stdin) {
      console.log("ohud: no stdin (setup verification)");
      return;
    }

    const config = await loadConfig(CONFIG_PATH);
    const sessionId = stdin.session_id ?? "default";

    const [probe, transcript, gitStatus] = await Promise.all([
      probeOllama({
        host: config.ollama.host,
        sessionId,
        daemonTtlSeconds: config.ollama.daemonTtlSeconds,
        cloudModelsTtlSeconds: config.ollama.cloudModelsTtlSeconds,
        timeoutMs: config.ollama.probeTimeoutMs,
      }),
      parseTranscript(stdin.transcript_path ?? ""),
      config.gitStatus.enabled ? getGitStatus(stdin.workspace?.current_dir ?? stdin.cwd) : Promise.resolve(null),
    ]);
    const mode = resolveMode(stdin, probe);
    writeLastModeState(mode, stdin.model?.id);

    let usageData = null;
    let costData = null;
    if (mode === "anthropic") {
      usageData = usageFromStdin(stdin);
      if (!usageData && config.display.externalUsagePath) {
        usageData = await usageFromSnapshot(config.display.externalUsagePath, config.display.externalUsageFreshnessMs);
      }
      costData = config.display.showCost ? resolveSessionCost(stdin, transcript.sessionTokens) : null;
    }

    const memoryInfo = config.display.showMemoryUsage && config.lineLayout === "expanded" ? getMemoryUsage() : null;
    const effortLevel = config.display.showEffortLevel ? resolveEffortLevel(stdin.effort) : undefined;

    const ctx: RenderContext = {
      mode, stdin, transcript, gitStatus, config, usageData, costData, memoryInfo,
      cloudModels: probe.cloudModels, effortLevel,
    };

    const output = render(ctx);
    if (profile) {
      const elapsedMs = Number(process.hrtime.bigint() - T0) / 1_000_000;
      process.stderr.write(`ohud-profile: total=${elapsedMs.toFixed(1)}ms\n`);
    }
    if (output) console.log(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Stdout sentinel — Claude Code displays this; stderr is discarded
    console.log("\x1b[31mohud: error — see /ohud doctor or ~/.claude/plugins/ohud/last-errors.log\x1b[0m");
    // Persist to log for /ohud doctor to surface
    try {
      const logPath = join(homedir(), ".claude/plugins/ohud/last-errors.log");
      const stamp = new Date().toISOString();
      const line = `[${stamp}] ${msg}\n`;
      appendFileSync(logPath, line);
    } catch { /* best-effort */ }
    // Also stderr for terminal/CI capture
    console.error("ohud: error", msg);
  }
}

if (import.meta.main) {
  void main();
}
