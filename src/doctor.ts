// src/doctor.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeOllama } from "./ollama-probe.js";
import { loadConfig } from "./config.js";
import { glyph } from "./render/glyphs.js";
import { spinnerFrame } from "./render/spinner.js";
import type { HudConfig } from "./types.js";

// Layout affinity for each display.* flag:
// "row"  = only consumed by RowLayout (flag is silenced in hush)
// "hush" = only consumed by HushLayout  (flag is silenced in row — rare)
// "both" = consumed by both layouts
// absent = dead flag (truly unused anywhere)
const FLAG_LAYOUT: Record<string, "row" | "hush" | "both"> = {
  // Identity/core — rendered in both layouts
  showModel: "both",
  showContextBar: "both",
  contextValue: "both",
  showApiTime: "both",
  showUsage: "both",
  showEffortLevel: "both",
  glyphs: "both",
  layout: "both",
  hush: "both",

  // Row-only flags (silenced when layout=hush)
  usageBarEnabled: "row",
  usageCompact: "row",
  showResetLabel: "row",
  showCost: "row",
  showMemoryUsage: "row",
  showSpeed: "row",

  // Row-preferred but hush also has a path (renderHush implemented and non-null)
  showPromptCache: "both",
  showTools: "both",
  showAgents: "both",
  showTodos: "both",
  showDuration: "both",
  showConfigCounts: "both",

  // Advanced config flags consumed in both modes
  timeFormat: "both",
  sevenDayThreshold: "both",
  warningThreshold: "both",
  criticalThreshold: "both",
  externalUsagePath: "both",
  externalUsageFreshnessMs: "both",
  promptCacheTtlSeconds: "both",
};

// gitStatus flags consumed by the project widget (used in both layouts)
const GIT_CONSUMED = new Set([
  "enabled", "showDirty", "showAheadBehind",
  "pushWarningThreshold", "pushCriticalThreshold",
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

  // Active layout and mode resolution transparency.
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

  // Last rendered mode from per-tick state file
  const lastModePath = join(homedir(), ".claude/plugins/ohud/last-mode.json");
  if (existsSync(lastModePath)) {
    try {
      const raw = readFileSync(lastModePath, "utf8");
      const parsed = JSON.parse(raw) as { mode?: string; modelId?: string };
      const modeStr = parsed.mode ?? "unknown";
      const modelPart = parsed.modelId ? ` (model.id=${parsed.modelId})` : "";
      lines.push(`Last rendered mode: ${modeStr}${modelPart}`);
    } catch { /* ignore corrupt state */ }
  }

  // Hush config summary when active layout is hush
  if (activeLayout === "hush") {
    const h = cfg.display.hush ?? {};
    lines.push(
      `Hush config: compactWhenIdle=${h.compactWhenIdle ?? true}, ` +
      `hyperlinks=${h.hyperlinks ?? true}, animate=${h.animate ?? true}, ` +
      `motion=${h.motion ?? "subtle"}, density=${h.density ?? "compact"}`,
    );
    // Inform users why old "running" tools may be invisible: stale entries are
    // dropped after 5 min, completed entries fade 30 s after their endTime.
    lines.push(
      `Activity TTL: running tools dropped after 300s without tool_result; ` +
      `completed tools fade 30s after endTime.`,
    );
  }

  // Glyph test row — three tiers side-by-side, plus a sample spinner cycle.
  // Lets the user verify which glyph mode their terminal+font actually supports
  // before opting into "nerd" via /ohud configure.
  lines.push("");
  lines.push("Glyph test (each row should render as 5 distinct cells):");
  const sampleKeys = ["running", "done", "active", "bolt", "clock"] as const;
  const row = (mode: "nerd" | "unicode" | "ascii"): string =>
    sampleKeys.map((k) => glyph(k, mode)).join("  ");
  lines.push(`  nerd   :  ${row("nerd")}    (requires Nerd Font installed)`);
  lines.push(`  unicode:  ${row("unicode")}    (default for UTF-8 locales)`);
  lines.push(`  ascii  :  ${row("ascii")}    (fallback)`);
  const spinnerCycle = [0, 1000, 2000, 3000].map((t) => spinnerFrame(t, "unicode")).join("  ");
  lines.push(`  spinner cycle: ${spinnerCycle}`);

  const { annotations, warnings } = buildFlagAnnotations(cfg, activeLayout);

  lines.push(`\nactive config flags (consumed?):`);
  lines.push(annotations);

  if (warnings.length > 0) {
    lines.push(`\nlint warnings:`);
    for (const w of warnings) lines.push(`  ${w}`);
  }

  const errLog = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  if (existsSync(errLog)) {
    lines.push(`\nlast errors (${errLog}):`);
    try { lines.push(readFileSync(errLog, "utf8").split("\n").slice(-5).join("\n")); }
    catch { /* ignore */ }
  }

  return lines.join("\n");
}

function buildFlagAnnotations(
  cfg: HudConfig,
  activeLayout: string,
): { annotations: string; warnings: string[] } {
  const out: string[] = [];
  const warnings: string[] = [];

  for (const [k, v] of Object.entries(cfg.display)) {
    const affinity = FLAG_LAYOUT[k];
    let tag: string;

    if (!affinity) {
      tag = "unknown flag";
    } else if (affinity === "both") {
      tag = "consumed in both";
    } else if (affinity === "row") {
      if (activeLayout === "hush") {
        tag = "silenced — wrong layout";
        if (v === true) {
          warnings.push(
            `⚠ display.${k}: true but layout=hush silences this flag — remove or switch to layout=row`,
          );
        }
      } else {
        tag = "consumed in row";
      }
    } else {
      // affinity === "hush"
      if (activeLayout === "row") {
        tag = "silenced — wrong layout";
        if (v === true) {
          warnings.push(
            `⚠ display.${k}: true but layout=row silences this flag — remove or switch to layout=hush`,
          );
        }
      } else {
        tag = "consumed in hush";
      }
    }

    out.push(`  display.${k}: ${JSON.stringify(v)} (${tag})`);
  }

  for (const [k, v] of Object.entries(cfg.gitStatus)) {
    const tag = GIT_CONSUMED.has(k) ? "consumed in both" : "unknown flag";
    out.push(`  gitStatus.${k}: ${JSON.stringify(v)} (${tag})`);
  }

  return { annotations: out.join("\n"), warnings };
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

export function writeLastModeState(mode: string, modelId?: string): void {
  try {
    const dir = join(homedir(), ".claude/plugins/ohud");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "last-mode.json");
    writeFileSync(path, JSON.stringify({ mode, modelId, updatedAt: new Date().toISOString() }));
  } catch { /* best-effort */ }
}
