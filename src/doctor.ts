// src/doctor.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeOllama } from "./ollama-probe.js";
import { loadConfig } from "./config.js";
import type { HudConfig } from "./types.js";

// CONSUMED_FLAGS: flags actually read by render or orchestrator code.
// Maintenance: regenerate by running:
//   grep -rh "config\.display\." src --include="*.ts" | sed -E 's/.*config\.display\.([a-zA-Z]+).*/\1/' | sort -u
//   grep -rh "config\.gitStatus\." src --include="*.ts" | sed -E 's/.*config\.gitStatus\.([a-zA-Z]+).*/\1/' | sort -u
// (Use broader pattern "\.display\." to catch ctx.config.display.* as well.)
// This Set will need updating after Tasks 7 (delete dead config) and 8 (implement Pilha A).
const CONSUMED_FLAGS = new Set([
  // Display flags read by render/lines/*.ts or src/index.ts orchestrator
  "showModel", "showContextBar", "contextValue", "showApiTime", "showUsage",
  "usageBarEnabled", "usageCompact", "showResetLabel", "timeFormat", "sevenDayThreshold",
  "externalUsagePath", "externalUsageFreshnessMs", "showCost", "showPromptCache",
  "promptCacheTtlSeconds", "showTools", "showAgents", "showTodos", "showConfigCounts",
  "showDuration", "showSpeed", "showMemoryUsage", "showEffortLevel", "glyphs",
  "layout", "hush",
  // GitStatus flags read by render/lines/project.ts
  "showAheadBehind", "pushWarningThreshold", "pushCriticalThreshold",
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
    daemonTtlSeconds: 0,
    cloudModelsTtlSeconds: 0,
    timeoutMs: 1500,
  });
  lines.push(`probe: live (cache bypassed) — daemonOk: ${probe.daemonOk ? "yes" : "no"}`);
  lines.push(`cloud models: ${probe.cloudModels.map((m) => m.name).join(", ") || "(none)"}`);
  lines.push(`mode: ${(probe.daemonOk && probe.cloudModels.length > 0) ? "ollama-capable" : "anthropic"}`);

  // Task C additions: active layout and mode resolution transparency.
  const activeLayout = cfg.display.layout ?? "row";
  lines.push(`Active layout: ${activeLayout}`);

  // Mode resolution is per-tick and depends on the current stdin.model.id, which
  // /ohud doctor doesn't have access to (it runs without a piped session). Document
  // the rule instead of fabricating a result, so users understand the resolver.
  lines.push(`Daemon probe: ${probe.daemonOk ? "ok" : "fail"}`);
  lines.push(
    `Mode resolution rule: model.id starts with "claude-" → anthropic; ` +
    `otherwise → ollama; missing → daemon-probe fallback (currently ` +
    `${probe.daemonOk ? "ollama" : "anthropic"}).`,
  );

  // Hush config summary when active layout is hush
  if (activeLayout === "hush") {
    const h = cfg.display.hush ?? {};
    lines.push(
      `Hush config: compactWhenIdle=${h.compactWhenIdle ?? true}, hyperlinks=${h.hyperlinks ?? true}, animate=${h.animate ?? true}`,
    );
  }

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
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return join(homedir(), ".claude/plugins/cache/ohud/ohud/0.1.0/dist/index.js");
  }
}

function readPackageJson(): { version: string } {
  try {
    const here = new URL("../package.json", import.meta.url).pathname;
    const raw = readFileSync(here, "utf8");
    return JSON.parse(raw) as { version: string };
  } catch { return { version: "unknown" }; }
}
