// src/doctor.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { probeOllama } from "./ollama-probe.js";
import { loadConfig } from "./config.js";
import type { HudConfig } from "./types.js";

const CONSUMED_FLAGS = new Set([
  "showModel", "showContextBar", "showApiTime", "showUsage", "showCost",
  "showPromptCache", "showTools", "showAgents", "showTodos", "showDuration",
  "showSpeed", "showMemoryUsage", "showEffortLevel", "showResetLabel",
  "timeFormat", "showAheadBehind", "pushWarningThreshold", "pushCriticalThreshold",
]);

interface DoctorOpts {
  host: string;
  configPath: string;
  bundlePath?: string;
}

export async function runDoctor(opts: DoctorOpts): Promise<string> {
  const lines: string[] = [];
  const pkg = readPackageJson();
  lines.push(`ohud version: ${pkg.version}`);
  lines.push(`runtime: ${process.version} (process.argv0=${process.argv0})`);
  const bundle = opts.bundlePath ?? resolveBundlePath();
  lines.push(`resolved bundle: ${bundle} (exists: ${existsSync(bundle) ? "yes" : "no"})`);

  const cfg = await loadConfig(opts.configPath);
  // Probe with TTL=0 to bypass cache (live re-fetch)
  const probe = await probeOllama({
    host: opts.host,
    sessionId: "doctor",
    ttlSeconds: 0,
    timeoutMs: 1500,
  });
  lines.push(`probe: live (cache bypassed) — daemonOk: ${probe.daemonOk ? "yes" : "no"}`);
  lines.push(`cloud models: ${probe.cloudModels.map((m) => m.name).join(", ") || "(none)"}`);
  lines.push(`mode: ${(probe.daemonOk && probe.cloudModels.length > 0) ? "ollama-capable" : "anthropic"}`);

  lines.push(`\nactive config flags (consumed?):`);
  lines.push(renderFlagAnnotations(cfg));

  const errLog = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  if (existsSync(errLog)) {
    lines.push(`\nlast errors (${errLog}):`);
    try { lines.push(readFileSync(errLog, "utf8").split("\n").slice(-5).join("\n")); }
    catch { /* ignore */ }
  }

  return lines.join("\n");
}

function renderFlagAnnotations(cfg: HudConfig): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(cfg.display)) {
    const tag = CONSUMED_FLAGS.has(k) ? "consumed" : "DEAD FLAG";
    out.push(`  display.${k}: ${JSON.stringify(v)} (${tag})`);
  }
  for (const [k, v] of Object.entries(cfg.gitStatus)) {
    const tag = CONSUMED_FLAGS.has(k) || k === "enabled" || k === "showDirty" ? "consumed" : "DEAD FLAG";
    out.push(`  gitStatus.${k}: ${JSON.stringify(v)} (${tag})`);
  }
  return out.join("\n");
}

function resolveBundlePath(): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return join(root, "dist", "index.js");
  return join(homedir(), ".claude/plugins/cache/owner/ohud/dist/index.js");
}

function readPackageJson(): { version: string } {
  try {
    const here = new URL("../package.json", import.meta.url).pathname;
    const raw = readFileSync(here, "utf8");
    return JSON.parse(raw) as { version: string };
  } catch { return { version: "unknown" }; }
}
