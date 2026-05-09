// src/doctor.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeOllama } from "./ollama-probe.js";
import { loadConfig } from "./config.js";
import { glyph, iconForMode } from "./render/glyphs.js";
import { spinnerFrame } from "./render/spinner.js";
import { formatModelLabel } from "./render/widgets/project.js";
import { hushLayout } from "./render/layout/hush.js";
import type { HushCell } from "./render/widget.js";
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

  // Resolve last rendered mode early — used by both the Hush block and Icons section.
  const lastModeRaw = (() => {
    const p = join(homedir(), ".claude/plugins/ohud/last-mode.json");
    if (!existsSync(p)) return probe.daemonOk ? "ollama" : "anthropic";
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as { mode?: string };
      return parsed.mode ?? (probe.daemonOk ? "ollama" : "anthropic");
    } catch { return probe.daemonOk ? "ollama" : "anthropic"; }
  })() as import("./types.js").RenderMode;

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

    // Prose preview at three widths (anthropic + ollama)
    lines.push("");
    for (const [renderMode, modelId] of [
      ["anthropic", "claude-opus-4-7-1m"],
      ["ollama",    "kimi-k2-6-262k"],
    ] as const) {
      const widths = renderMode === "anthropic" ? [160, 80, 40] : [160];
      for (const w of widths) {
        lines.push(`Prose preview (${renderMode}, ${w} cols):`);
        const previewLines = buildProsePreview(cfg, renderMode, modelId, w);
        for (const l of previewLines) lines.push(`  ${l}`);
      }
    }

    // Threshold swatch
    lines.push("");
    lines.push("Thresholds:");
    const warning = cfg.display.hush?.thresholds?.warning ?? 60;
    const danger  = cfg.display.hush?.thresholds?.danger  ?? 75;
    for (const [pct, label] of [
      [30, "neutral"],
      [warning + 5 > 100 ? warning : warning + 5, "warning"],
      [danger  + 5 > 100 ? danger  : danger  + 5, "danger" ],
    ] as [number, string][]) {
      const contextCell: HushCell = {
        id: "context",
        group: "metrics",
        text: `${pct}% used`,
        attention: label as "muted" | "normal" | "warning" | "danger",
      };
      const rendered = renderContextSwatch(contextCell, process.env);
      lines.push(`  context ${rendered}    (${label})`);
    }

    // Icon swatch
    lines.push("");
    lines.push("Icon swatch:");
    lines.push(`  unicode → ${iconForMode("anthropic", "unicode")} (anthropic)   ${iconForMode("ollama", "unicode")} (ollama)`);
    lines.push(`  ascii   → ${iconForMode("anthropic", "ascii")} (anthropic)   ${iconForMode("ollama", "ascii")} (ollama)`);
    lines.push(`  nerd    → ${iconForMode("anthropic", "nerd")} (anthropic)   ${iconForMode("ollama", "nerd")} (ollama)`);
    lines.push(`  auto    → ${iconForMode(lastModeRaw, "auto")} (resolved from last mode: ${lastModeRaw})`);
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

  // Brand icon preview — three tiers plus auto resolved from the last-rendered mode.
  lines.push("");
  lines.push("Icons:");
  lines.push(`  unicode → ${iconForMode("anthropic", "unicode")} (anthropic)   ${iconForMode("ollama", "unicode")} (ollama)`);
  lines.push(`  ascii   → ${iconForMode("anthropic", "ascii")} (anthropic)   ${iconForMode("ollama", "ascii")} (ollama)`);
  lines.push(`  nerd    → ${iconForMode("anthropic", "nerd")} (anthropic)   ${iconForMode("ollama", "nerd")} (ollama)`);
  lines.push(`  auto    → ${iconForMode(lastModeRaw, "auto")} (resolved from last mode: ${lastModeRaw})`);

  // Model label samples — demonstrates formatModelLabel across representative ids.
  lines.push("");
  lines.push("Model labels:");
  const modelSamples = [
    "claude-opus-4-7-1m",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "kimi-k2-6-262k",
    "gpt-oss-20b-128k",
    "something-weird",
  ];
  for (const id of modelSamples) {
    lines.push(`  ${id.padEnd(32)} → ${formatModelLabel(id)}`);
  }

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

  // T5: legacy-knob lints
  if (cfg.lineLayout === "expanded") {
    warnings.push(
      `LINT: lineLayout="expanded" is the legacy card layout. ` +
      `Recommend lineLayout="compact" for the new prose statusline.`,
    );
  }

  if (cfg.display.hush?.identityColors === true) {
    warnings.push(
      `LINT: display.hush.identityColors=true was a card-layout knob; ` +
      `under the prose layout it has no effect. Remove or set to false.`,
    );
  }

  return { annotations: out.join("\n"), warnings };
}

// ---------------------------------------------------------------------------
// buildProsePreview — renders a synthetic hush statusline at a given width.
//
// Calls hushLayout.pack() directly with hand-crafted HushCell fixtures.
// Fixture values: project "ohud", branch "develop", model from modelId arg,
// context 24%, cache 87% hit, 102 tks/s, session time 1h23m45s, rate 45%/5h.
// ---------------------------------------------------------------------------

function buildProsePreview(
  cfg: HudConfig,
  renderMode: "anthropic" | "ollama",
  modelId: string,
  termWidth: number,
): string[] {
  // Derive glyph mode from config, forced to unicode for preview determinism.
  const previewCfg = structuredClone(cfg);
  previewCfg.display.glyphs = "unicode";
  // Disable hyperlinks in preview (no real session_id available).
  if (!previewCfg.display.hush) previewCfg.display.hush = {};
  previewCfg.display.hush.hyperlinks = false;

  const icon = iconForMode(renderMode, "unicode");
  const modelLabel = formatModelLabel(modelId);

  const cells: HushCell[] = [
    { subId: "icon",    group: "header",  text: icon,        attention: "normal" },
    { subId: "name",    group: "header",  text: "ohud",      attention: "muted"  },
    { subId: "branch",  group: "header",  text: "develop",   attention: "muted"  },
    { subId: "model",   group: "header",  text: modelLabel,  attention: "muted"  },
    { id: "context",    group: "metrics", text: "24% used",  attention: "muted"  },
    {                   group: "metrics", text: "cache 87% hit", attention: "muted", baseColor: "cyan" },
    {                   group: "metrics", text: "102 tks/s",    attention: "muted" },
    {                   group: "metrics", text: "session time 1:23:45", attention: "muted" },
    {                   group: "metrics", text: "rate 45%/5h",  attention: "muted", baseColor: "cyan" },
  ];

  return hushLayout.pack(cells, termWidth, previewCfg);
}

// ---------------------------------------------------------------------------
// renderContextSwatch — render a context cell using the same SGR codes that
// hushLayout produces, so the swatch is visually accurate.
// ---------------------------------------------------------------------------

function renderContextSwatch(cell: HushCell, env: NodeJS.ProcessEnv): string {
  const noColor = !!(env.NO_COLOR || env.TERM === "dumb");
  const text = cell.text;
  const dimWrap = (s: string) => noColor ? s : `\x1b[2m${s}\x1b[22m`;

  switch (cell.attention) {
    case "warning":
      return noColor ? text : `\x1b[33m${dimWrap(text)}\x1b[39m`;
    case "danger":
      return noColor ? text : `\x1b[31m${dimWrap(text)}\x1b[39m`;
    default:
      return dimWrap(text);
  }
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
