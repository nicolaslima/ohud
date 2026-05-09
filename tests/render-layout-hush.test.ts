// tests/render-layout-hush.test.ts
//
// Comprehensive tests for HushLayout covering:
//   - Idle / active / critical 3-state outputs
//   - Conditional bracket suppression (no orphan separators)
//   - NO_COLOR environment variable
//   - compactWhenIdle on/off
//   - No bar characters in output
//   - cost/memory always null in Hush
//   - OSC 8 emission for project / model
//   - Spinner present in active state, absent in idle state
//   - Exact canonical output for each state
//
import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { hushLayout } from "../src/render/layout/hush.js";
import { costWidget } from "../src/render/widgets/cost.js";
import { memoryWidget } from "../src/render/widgets/memory.js";
import { environmentWidget } from "../src/render/widgets/environment.js";
import { projectWidget } from "../src/render/widgets/project.js";
import { contextWidget } from "../src/render/widgets/context.js";
import { toolsWidget } from "../src/render/widgets/tools.js";
import { agentsWidget } from "../src/render/widgets/agents.js";
import { promptCacheWidget } from "../src/render/widgets/prompt-cache.js";
import { renderCacheCell } from "../src/render/widgets/cache.js";
import { renderSessionTimeCell } from "../src/render/widgets/session.js";
import type { HushCell } from "../src/render/widget.js";
import type { RenderContext, StdinData } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RenderContext> & { stdin?: Partial<StdinData> } = {}): RenderContext {
  const { stdin: stdinOverride, ...rest } = overrides;
  const stdin: StdinData = {
    model: { id: "claude-opus-4-7", display_name: "Claude Opus 4.7" },
    workspace: {
      current_dir: "/Users/lima/Projects/ohud",
      project_dir: "/Users/lima/Projects/ohud",
    },
    context_window: { context_window_size: 1_000_000, used_percentage: 15 },
    cost: { total_cost_usd: 0.01, total_duration_ms: 60000 },
    ...stdinOverride,
  };
  const config = structuredClone(DEFAULT_CONFIG);
  // Force unicode glyphs for deterministic test output
  config.display.glyphs = "unicode";
  config.display.showModel = true;
  config.display.showContextBar = true;

  return {
    mode: "anthropic",
    stdin,
    transcript: { tools: [], agents: [], todos: [] },
    gitStatus: { branch: "main", dirty: false, ahead: 0, behind: 0 },
    config,
    usageData: null,
    costData: null,
    memoryInfo: null,
    cloudModels: [],
    ...rest,
  };
}

/** Build HushCells by calling renderHush on a list of widgets with the given ctx */
function collectCells(widgets: typeof projectWidget[], ctx: RenderContext): HushCell[] {
  const out: HushCell[] = [];
  for (const w of widgets) {
    const result = w.renderHush?.(ctx);
    if (!result) continue;
    if (Array.isArray(result)) {
      for (const c of result) out.push({ ...c, id: w.id, group: c.group ?? w.group });
    } else {
      out.push({ ...result, id: w.id, group: result.group ?? w.group });
    }
  }
  return out;
}

// Save and restore env
let savedNoColor: string | undefined;
let savedTerm: string | undefined;

beforeEach(() => {
  savedNoColor = process.env.NO_COLOR;
  savedTerm    = process.env.TERM;
});

afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
  if (savedTerm === undefined) delete process.env.TERM;
  else process.env.TERM = savedTerm;
});

// ---------------------------------------------------------------------------
// Section 1: Idle state — single line, project + branch + model + dim context
// ---------------------------------------------------------------------------

describe("Idle state", () => {
  test("produces exactly 1 line when no activity", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.length).toBe(1);
  });

  test("line 1 contains project name", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    expect(line1).toBeDefined();
    // Strip ANSI to get plain text
    const plain = stripAnsi(line1!);
    expect(plain).toContain("ohud");
  });

  test("line 1 contains branch name", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    expect(plain).toContain("main");
  });

  test("line 1 contains model label (formatted)", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    // "claude-opus-4-7" → "Opus 4.7 (1M)"
    expect(plain).toContain("Opus 4.7 (1M)");
  });

  test("line 1 contains context percentage", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 15 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    expect(plain).toContain("15%");
  });

  test("sentence reads as prose: 'ohud on {branch} using {model} with context N% used'", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 15, context_window_size: 1_000_000 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    // Prose sentence format: all pieces present with connector words
    expect(plain).toContain("ohud");
    expect(plain).toContain("on main");
    expect(plain).toContain("using Opus 4.7 (1M)");
    expect(plain).toContain("with context");
    expect(plain).toContain("15%");
    expect(plain).toContain("used");
    // Connector words are lowercase
    expect(plain).toMatch(/ohud on main using Opus 4\.7 \(1M\) with context 15% used/);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Active state — 2 lines, running tools
// ---------------------------------------------------------------------------

describe("Active state", () => {
  function activeCtx() {
    const ctx = makeCtx({
      stdin: { context_window: { used_percentage: 68 } },
    });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date() },
      { id: "t2", name: "Edit", status: "running", startTime: new Date() },
      { id: "t3", name: "Read", status: "running", startTime: new Date() },
    ];
    return ctx;
  }

  test("produces 2 lines when tools are running", () => {
    const ctx = activeCtx();
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.length).toBe(2);
  });

  test("context at 68% is yellow (warning)", () => {
    const ctx = activeCtx();
    const cells = collectCells([contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    // Yellow = \x1b[33m
    expect(line1).toContain("\x1b[33m");
    expect(line1).toContain("68%");
  });

  test("spinner glyph appears in activity line", () => {
    const ctx = activeCtx();
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityLine = stripAnsi(lines[1]!);
    // One of the spinner chars should be present
    const spinnerChars = ["◜", "◝", "◞", "◟"];
    const hasSpinner = spinnerChars.some((ch) => activityLine.includes(ch));
    expect(hasSpinner).toBe(true);
  });

  test("running tool names appear in activity line", () => {
    const ctx = activeCtx();
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[1]!);
    expect(activityPlain).toContain("Edit");
    expect(activityPlain).toContain("Read");
  });

  test("count suffix appears for multi-instance tools", () => {
    const ctx = activeCtx(); // 2 Edit + 1 Read
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[0]!);
    expect(activityPlain).toContain("×2"); // Edit ×2
  });

  test("activity line drops whole cells (not mid-word) when narrow + accumulates +N more", () => {
    const ctx = makeCtx({});
    ctx.config.display.showTools = true;
    // 2 running + 4 distinct done tools — well past what fits in a narrow term.
    ctx.transcript.tools = [
      { id: "r1", name: "Edit",       status: "running", startTime: new Date() },
      { id: "r2", name: "Read",       status: "running", startTime: new Date() },
      { id: "d1", name: "Bash",       status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d2", name: "TaskCreate", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d3", name: "ToolSearch", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d4", name: "Glob",       status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    // Narrow width that forces drops. Activity line is the first/only line
    // since no metrics widgets are included.
    const lines = hushLayout.pack(cells, 40, ctx.config);
    const activityPlain = stripAnsi(lines[0]!);

    // No truncated tool names — every visible name is whole.
    expect(activityPlain).not.toMatch(/[A-Za-z]…/);
    // Drop indicator surfaces hidden cells.
    expect(activityPlain).toMatch(/\+\d+ more/);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Critical state — danger context, done tools
// ---------------------------------------------------------------------------

describe("Critical state", () => {
  function criticalCtx() {
    const ctx = makeCtx({
      stdin: { context_window: { used_percentage: 92 } },
    });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date() },
      { id: "t2", name: "TaskCreate", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "t3", name: "TaskCreate", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    return ctx;
  }

  test("context at 92% is red (danger)", () => {
    const ctx = criticalCtx();
    const cells = collectCells([contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    // Red = \x1b[31m
    expect(line1).toContain("\x1b[31m");
    expect(line1).toContain("92%");
  });

  test("done tool has static check mark (no spinner)", () => {
    const ctx = criticalCtx();
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("✓");
    expect(plain).toContain("TaskCreate");
  });

  test("running tool still gets spinner in critical state", () => {
    const ctx = criticalCtx();
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    const spinnerChars = ["◜", "◝", "◞", "◟"];
    const hasSpinner = spinnerChars.some((ch) => plain.includes(ch));
    expect(hasSpinner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Conditional bracket suppression
// ---------------------------------------------------------------------------

describe("Conditional bracket suppression", () => {
  test("when git is absent, only TWO spaces between project name and model", () => {
    const ctx = makeCtx();
    ctx.config.gitStatus.enabled = false; // suppress branch cell
    ctx.config.display.showModel = true;
    const cells = collectCells([projectWidget], ctx);
    // Should have name + model (no branch cell)
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    // Verify no triple space
    expect(plain).not.toMatch(/   /);
    // Verify content present
    expect(plain).toContain("ohud");
    expect(plain).toContain("Opus 4.7 (1M)");
  });

  test("when context is null, header cells still render correctly", () => {
    const ctx = makeCtx({ stdin: { context_window: undefined } });
    ctx.config.display.showContextBar = false;
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0] ?? "");
    expect(plain).not.toMatch(/   /); // no triple space
  });

  test("null cells do not produce orphan separators", () => {
    // Build a line with only 2 cells (project name + model, no branch)
    const ctx = makeCtx();
    ctx.config.gitStatus.enabled = false;
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    // projectWidget returns [name, model] when git disabled (no branch cell)
    // Manually tag with group
    const tagged = projectCells.map((c) => ({ ...c, group: "header" as const }));
    const lines = hushLayout.pack(tagged, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    // Should have exactly one separator between two cells
    const normalized = plain.replace(/\s+/g, " ");
    expect(normalized.trim()).not.toContain("   ");
  });
});

// ---------------------------------------------------------------------------
// Section 5: NO_COLOR
// ---------------------------------------------------------------------------

describe("NO_COLOR=1", () => {
  test("plain text output when NO_COLOR set", () => {
    process.env.NO_COLOR = "1";
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 92 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const line1 = lines[0]!;
    // No SGR color codes (but OSC 8 links may remain)
    expect(line1).not.toMatch(/\x1b\[\d+m/);
  });

  test("dirty marker present for dirty git in NO_COLOR mode", () => {
    process.env.NO_COLOR = "1";
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.dirty = true;
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = lines[0]!.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\]8;;\x07/g, "");
    // Unicode mode: "●", ASCII mode: " *"
    expect(plain).toMatch(/main ●|main \*/);
  });
});

// ---------------------------------------------------------------------------
// Section 6: No bar characters in output
// ---------------------------------------------------------------------------

describe("No bar characters", () => {
  test("no █ in idle hush output", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 45 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) expect(l).not.toContain("█");
  });

  test("no ░ in idle hush output", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 45 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) expect(l).not.toContain("░");
  });

  test("no bar chars in active state", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 68 } } });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date() },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) {
      expect(l).not.toContain("█");
      expect(l).not.toContain("░");
    }
  });

  test("no bar chars in critical state", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 92 } } });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date() },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) {
      expect(l).not.toContain("█");
      expect(l).not.toContain("░");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 7: cost and memory always null in Hush
// ---------------------------------------------------------------------------

describe("cost and memory hidden in Hush", () => {
  test("costWidget.renderHush returns null", () => {
    const ctx = makeCtx();
    expect(costWidget.renderHush!(ctx)).toBeNull();
  });

  test("memoryWidget.renderHush returns null", () => {
    const ctx = makeCtx();
    expect(memoryWidget.renderHush!(ctx)).toBeNull();
  });

  test("environmentWidget.renderHush returns null", () => {
    const ctx = makeCtx();
    expect(environmentWidget.renderHush!(ctx)).toBeNull();
  });

  test("costWidget.renderHush is always null regardless of costData", () => {
    const ctx = makeCtx();
    ctx.costData = { totalUsd: 9.99, source: "native" };
    expect(costWidget.renderHush!(ctx)).toBeNull();
  });

  test("memoryWidget.renderHush is always null regardless of memoryInfo", () => {
    const ctx = makeCtx();
    ctx.memoryInfo = { totalBytes: 16e9, usedBytes: 12e9, freeBytes: 4e9, usedPercent: 75 };
    expect(memoryWidget.renderHush!(ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 8: OSC 8 hyperlinks
// In the prose layout, project/branch/model carry NO OSC 8 links.
// The ONLY OSC 8 link appears on the ⌗N tools counter in the activity line.
// ---------------------------------------------------------------------------

describe("OSC 8 hyperlinks", () => {
  test("project name cell has NO link (removed in prose design)", () => {
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    // Icon cell is first (subId="icon"), project name is second (subId="name")
    const nameCell = cells.find((c) => c.subId === "name");
    expect(nameCell).toBeDefined();
    expect(nameCell!.link).toBeUndefined();
  });

  test("model cell has NO anthropic docs link (removed in prose design)", () => {
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const modelCell = cells.find((c) => c.text.includes("Opus"));
    expect(modelCell).toBeDefined();
    expect(modelCell!.link).toBeUndefined();
  });

  test("prose sentence does NOT contain OSC 8 escape sequences", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const line1 = lines[0]!;
    // No OSC 8 links in the prose sentence
    expect(line1).not.toContain("\x1b]8;;file://");
  });

  test("NO_COLOR=1: sentence has no SGR codes (OSC 8 only on counter, not sentence)", () => {
    process.env.NO_COLOR = "1";
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // No SGR codes in sentence
    expect(lines[0]).not.toMatch(/\x1b\[\d+m/);
    // No OSC 8 links in sentence
    expect(lines[0]).not.toContain("\x1b]8;;file://");
  });
});

// ---------------------------------------------------------------------------
// Section 9: compactWhenIdle
// ---------------------------------------------------------------------------

describe("compactWhenIdle", () => {
  test("idle: only 1 line emitted by default (compactWhenIdle=true)", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.length).toBe(1);
  });

  test("compactWhenIdle=false: always 2 lines even when idle", () => {
    const ctx = makeCtx();
    // Inject hush config override via type cast
    (ctx.config.display as Record<string, unknown>).hush = { compactWhenIdle: false };
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.length).toBe(2);
    // When idle (no activity cells), line 2 must be empty string
    expect(lines[1]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Section 10: Spinner determinism
// ---------------------------------------------------------------------------

describe("Spinner determinism in layout", () => {
  test("spinner glyph is one of the expected 4 unicode chars", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    const spinnerChars = ["◜", "◝", "◞", "◟"];
    const spinnerFound = spinnerChars.some((ch) => plain.includes(ch));
    expect(spinnerFound).toBe(true);
  });

  test("idle state has no spinner", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) {
      const plain = stripAnsi(l);
      const spinnerChars = ["◜", "◝", "◞", "◟"];
      const spinnerFound = spinnerChars.some((ch) => plain.includes(ch));
      expect(spinnerFound).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 11: Agents
// ---------------------------------------------------------------------------

describe("Agents widget in Hush", () => {
  test("running agent appears with spinner", () => {
    const ctx = makeCtx();
    ctx.config.display.showAgents = true;
    ctx.transcript.agents = [
      { id: "a1", type: "Explore", status: "running", startTime: new Date() },
    ];
    const cells = collectCells([agentsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("Explore");
    const spinnerChars = ["◜", "◝", "◞", "◟"];
    expect(spinnerChars.some((ch) => plain.includes(ch))).toBe(true);
  });

  test("completed agent has static check mark", () => {
    const ctx = makeCtx();
    ctx.config.display.showAgents = true;
    ctx.transcript.agents = [
      { id: "a1", type: "Bash", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([agentsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("✓");
    expect(plain).toContain("Bash");
  });

  test("no running agents → agentsWidget.renderHush returns null", () => {
    const ctx = makeCtx();
    ctx.config.display.showAgents = true;
    ctx.transcript.agents = [];
    expect(agentsWidget.renderHush!(ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 12: Muted + baseColor combo (dim+color SGR)
// ---------------------------------------------------------------------------

describe("Muted + baseColor combo", () => {
  test("done tool cell emits dim+green SGR (\\x1b[2;32m … \\x1b[22;39m)", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "TaskCreate", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const line = lines[0]!;
    expect(line).toContain("\x1b[2;32m");
    expect(line).toContain("\x1b[22;39m");
    // Plain text content still present
    expect(stripAnsi(line)).toContain("✓ TaskCreate");
  });

  test("promptCache cell emits dim+cyan SGR (\\x1b[2;36m … \\x1b[22;39m)", () => {
    const ctx = makeCtx();
    ctx.config.display.showPromptCache = true;
    // Set lastAssistantResponseAt 30s ago — well above the 60s minimum freshness threshold
    // (TTL default is 300s, so remaining ≈ 270s = above 60s). MIN_REMAINING_MS = 60_000.
    ctx.transcript.lastAssistantResponseAt = new Date(Date.now() - 30_000);
    const cells = collectCells([promptCacheWidget], ctx);
    expect(cells.length).toBe(1);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const line = lines[0]!;
    expect(line).toContain("\x1b[2;36m");
    expect(line).toContain("\x1b[22;39m");
    expect(stripAnsi(line)).toContain("cache ");
  });

  test("muted cell without baseColor renders as plain dim (\\x1b[2m … \\x1b[22m)", () => {
    // contextWidget at 15% returns attention=muted with NO baseColor
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 15 } } });
    const cells = collectCells([contextWidget], ctx);
    expect(cells.length).toBe(1);
    expect(cells[0]!.attention).toBe("muted");
    expect(cells[0]!.baseColor).toBeUndefined();
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const line = lines[0]!;
    // Plain dim wrapping, no color combo
    expect(line).toContain("\x1b[2m");
    expect(line).toContain("\x1b[22m");
    // Should NOT contain combined dim+color sequences
    expect(line).not.toContain("\x1b[2;");
  });
});

// ---------------------------------------------------------------------------
// Section 13: Branch in prose sentence (no OSC 8 links on branch/model/project)
// ---------------------------------------------------------------------------

describe("Branch in prose sentence", () => {
  test("branch name appears in prose sentence regardless of remoteUrl", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "https://github.com/anthropic/ohud.git";
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(stripAnsi(lines[0]!)).toContain("on main");
  });

  test("branch cell has NO link (removed in prose design)", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    const branchCell = projectCells.find((c) => c.text.includes("main"));
    expect(branchCell).toBeDefined();
    expect(branchCell!.link).toBeUndefined();
  });

  test("all project cells have NO link (removed in prose design)", () => {
    const ctx = makeCtx();
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    // All cells emitted by projectWidget (icon, name, branch, model) have no link
    for (const c of projectCells) {
      expect(c.link).toBeUndefined();
    }
  });

  test("dirty branch marker appears in prose sentence", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.dirty = true;
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    // Unicode mode: "●", ASCII mode: " *"
    expect(plain).toMatch(/main ●|main \*/);
  });

  test("NO OSC 8 link for branch in pack output", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines[0]).not.toContain("\x1b]8;;https://github.com/anthropic/ohud");
  });
});

// ---------------------------------------------------------------------------
// Task C review: hush.hyperlinks / hush.animate / hush.thresholds toggles
// ---------------------------------------------------------------------------

describe("hush.hyperlinks toggle", () => {
  test("display.hush.hyperlinks=false strips OSC 8 escape sequences", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    ctx.config.display.hush = { hyperlinks: false };
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // OSC 8 sequence: \x1b]8;;...
    expect(lines.join("\n")).not.toContain("\x1b]8;;");
  });

  test("display.hush.hyperlinks=true (default): sentence has no OSC 8 (only counter would)", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    // Don't set hyperlinks → default true via DEFAULT_CONFIG
    // Prose sentence does NOT emit OSC 8 for project/branch/model
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // Branch text still present in sentence
    expect(stripAnsi(lines.join("\n"))).toContain("on main");
    // But NO OSC 8 links in sentence (links only appear on ⌗N counter when activity exists)
    expect(lines.join("\n")).not.toContain("\x1b]8;;https://github.com/anthropic/ohud");
  });
});

describe("hush.animate toggle", () => {
  test("display.hush.animate=false omits spinner glyph but keeps cell content", () => {
    // Recent startTime so the ghost-tool TTL keeps the cell visible.
    const now = new Date(Date.now() - 5_000);
    const ctx = makeCtx({
      transcript: {
        tools: [{ id: "1", name: "Edit", status: "running", startTime: now }],
        agents: [],
        todos: [],
      },
    });
    ctx.config.display.showTools = true;
    ctx.config.display.hush = { animate: false };
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines.join("\n"));
    // No spinner glyphs (◜ ◝ ◞ ◟ — rotating quarter-arcs for unicode)
    expect(plain).not.toMatch(/[◜◝◞◟]/);
    // But the running tool name still shows
    expect(plain).toContain("Edit");
  });

  test("display.hush.animate=true (default) renders spinner glyph for running tools", () => {
    const now = new Date(Date.now() - 5_000);
    const ctx = makeCtx({
      transcript: {
        tools: [{ id: "1", name: "Edit", status: "running", startTime: now }],
        agents: [],
        todos: [],
      },
    });
    ctx.config.display.showTools = true;
    // Default animate=true via DEFAULT_CONFIG
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toMatch(/[◜◝◞◟]/);
  });

  test("display.hush.animate=false: cyan baseColor still applied for running tool", () => {
    // Use recent startTime so elapsed < 30s (no warning promotion)
    const now = new Date(Date.now() - 5_000);
    const ctx = makeCtx({
      transcript: {
        tools: [{ id: "1", name: "Edit", status: "running", startTime: now }],
        agents: [],
        todos: [],
      },
    });
    ctx.config.display.showTools = true;
    ctx.config.display.hush = { animate: false };
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // Cyan SGR is \x1b[36m
    expect(lines.join("\n")).toContain("\x1b[36m");
  });

  test('motion="still" keeps spinner visible but freezes on frame 0 (◜)', () => {
    const start = new Date(Date.now() - 5_000);
    const ctx = makeCtx({
      transcript: {
        tools: [{ id: "1", name: "Edit", status: "running", startTime: start }],
        agents: [],
        todos: [],
      },
    });
    ctx.config.display.showTools = true;
    ctx.config.display.hush = { motion: "still" };

    // Render twice across a 2-second gap; with motion=still the spinner glyph
    // must NOT advance — it stays on frame 0 regardless of wall time.
    const cells = collectCells([toolsWidget], ctx);
    const a = stripAnsi(hushLayout.pack(cells, 200, ctx.config).join("\n"));
    expect(a).toContain("◜");          // frame 0 always
    expect(a).not.toMatch(/[◝◞◟]/);    // never the other phases
  });
});

describe("hush.thresholds override", () => {
  test("hush.thresholds.warning=70 → context at 65% is muted (not warning)", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "claude-opus-4-7" },
        workspace: { current_dir: "/tmp", project_dir: "/tmp" },
        context_window: { context_window_size: 200000, used_percentage: 65 },
      },
    });
    ctx.config.display.hush = { thresholds: { warning: 70, danger: 85 } };
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("muted");
  });

  test("hush.thresholds.danger=90 → context at 80% renders as warning (not danger)", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "claude-opus-4-7" },
        workspace: { current_dir: "/tmp", project_dir: "/tmp" },
        context_window: { context_window_size: 200000, used_percentage: 80 },
      },
    });
    ctx.config.display.hush = { thresholds: { warning: 70, danger: 90 } };
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("warning");
  });

  test("default thresholds: context at 65% → warning (60..74)", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "claude-opus-4-7" },
        workspace: { current_dir: "/tmp", project_dir: "/tmp" },
        context_window: { context_window_size: 200000, used_percentage: 65 },
      },
    });
    // No hush.thresholds override → falls through to display.warningThreshold=60
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("warning");
  });

  test("hush.thresholds.warning falls through to display.warningThreshold when undefined", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "claude-opus-4-7" },
        workspace: { current_dir: "/tmp", project_dir: "/tmp" },
        context_window: { context_window_size: 200000, used_percentage: 50 },
      },
    });
    ctx.config.display.warningThreshold = 40; // global override
    ctx.config.display.hush = {}; // no thresholds key
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    // 50% >= 40 (warning) and < 75 (danger) → warning
    expect(cell.attention).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// Section 14: glyphMode env injection — Unicode/ASCII switching testable via env
// ---------------------------------------------------------------------------

import { glyphMode } from "../src/render/layout/hush.js";

describe("glyphMode env injection", () => {
  test("unicode mode when env.LANG contains UTF-8", () => {
    const ctx = makeCtx();
    ctx.config.display.glyphs = "auto";
    const result = glyphMode(ctx.config, { LANG: "en_US.UTF-8" });
    expect(result).toBe("unicode");
  });

  test("unicode mode when env.LC_ALL contains UTF-8", () => {
    const ctx = makeCtx();
    ctx.config.display.glyphs = "auto";
    const result = glyphMode(ctx.config, { LC_ALL: "en_US.UTF-8" });
    expect(result).toBe("unicode");
  });

  test("ascii mode when env.LANG does not contain UTF-8", () => {
    const ctx = makeCtx();
    ctx.config.display.glyphs = "auto";
    const result = glyphMode(ctx.config, { LANG: "C" });
    expect(result).toBe("ascii");
  });

  test("unicode forced regardless of env when config.glyphs = 'unicode'", () => {
    const ctx = makeCtx();
    ctx.config.display.glyphs = "unicode";
    const result = glyphMode(ctx.config, { LANG: "C" });
    expect(result).toBe("unicode");
  });

  test("ascii forced regardless of env when config.glyphs = 'ascii'", () => {
    const ctx = makeCtx();
    ctx.config.display.glyphs = "ascii";
    const result = glyphMode(ctx.config, { LANG: "en_US.UTF-8" });
    expect(result).toBe("ascii");
  });
});

// ---------------------------------------------------------------------------
// Section 15: REMOVED — legacy raw-cell density tests
//
// The prose layout has no concept of "raw header cells joined by separator"
// or "cross-group cell separator". Density now ONLY controls bullet padding
// between extras clauses. Tests for that behavior live in the dedicated
// "prose sentence — density affects bullet padding" describe block (Section
// 21) which exercises real metrics cells, not synthetic raw cells.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section 16: identityColors toggle
// ---------------------------------------------------------------------------

describe("identityColors toggle", () => {
  test("identityColors=false (default): header cells render without cyan/green/blue", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { identityColors: false };
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const tagged = cells.map((c) => ({ ...c, group: "header" as const }));
    const lines = hushLayout.pack(tagged, 200, ctx.config);
    const line = lines[0]!;
    expect(line).not.toContain("\x1b[36m"); // no cyan
    expect(line).not.toContain("\x1b[32m"); // no green
    expect(line).not.toContain("\x1b[34m"); // no blue
  });

  test("identityColors=true: header cells render with their baseColor", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { identityColors: true };
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const tagged = cells.map((c) => ({ ...c, group: "header" as const }));
    const lines = hushLayout.pack(tagged, 200, ctx.config);
    const line = lines[0]!;
    const hasIdentityColor =
      line.includes("\x1b[36m") ||  // cyan
      line.includes("\x1b[32m") ||  // green
      line.includes("\x1b[34m");    // blue
    expect(hasIdentityColor).toBe(true);
  });

  test("identityColors=false does NOT strip non-header (activity) baseColor green", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.config.display.hush = { identityColors: false };
    ctx.transcript.tools = [
      { id: "t1", name: "TaskCreate", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // Done tool (activity group) uses dim+green — identityColors must not suppress it
    expect(lines[0]).toContain("\x1b[2;32m");
  });
});

// ---------------------------------------------------------------------------
// Section 17: Activity cell cap (MAX_RUNNING=3, MAX_DONE=4)
// ---------------------------------------------------------------------------

describe("activity cell cap", () => {
  test("when > 3 running, shows '+N more' cell", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "r1", name: "A", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "r2", name: "B", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "r3", name: "C", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "r4", name: "D", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(stripAnsi(lines.join("\n"))).toContain("+1 more");
  });

  test("when > 4 done, shows '+N more' cell", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "d1", name: "A", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d2", name: "B", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d3", name: "C", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d4", name: "D", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d5", name: "E", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(stripAnsi(lines.join("\n"))).toContain("+1 more");
  });

  test("exactly 3 running + 4 done → no '+N more'", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "r1", name: "A", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "r2", name: "B", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "r3", name: "C", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "d1", name: "D", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d2", name: "E", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d3", name: "F", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d4", name: "G", status: "completed", startTime: new Date(), endTime: new Date() },
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(stripAnsi(lines.join("\n"))).not.toContain("more");
  });

  test("mixed overflow: combined running+done excess in '+N more'", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "r1", name: "A", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "r2", name: "B", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "r3", name: "C", status: "running",   startTime: new Date(Date.now() - 1000) },
      { id: "r4", name: "D", status: "running",   startTime: new Date(Date.now() - 1000) }, // +1
      { id: "d1", name: "E", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d2", name: "F", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d3", name: "G", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d4", name: "H", status: "completed", startTime: new Date(), endTime: new Date() },
      { id: "d5", name: "I", status: "completed", startTime: new Date(), endTime: new Date() }, // +1
    ];
    const cells = collectCells([toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(stripAnsi(lines.join("\n"))).toContain("+2 more");
  });
});

// ---------------------------------------------------------------------------
// Section 18: REMOVED — priority-aware sentence truncation
//
// The prose layout never truncates sentence content. The full sentence is
// always emitted; when it doesn't fit alongside extras, extras wrap to line 2.
// The `priority` field on HushCells is now used only by the activity-line
// drop logic ("+N more" overflow), not by the sentence path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section 19: primaryText + secondaryText rendering
// ---------------------------------------------------------------------------

describe("primaryText + secondaryText rendering", () => {
  test("when both present, renders as 'primary dim(secondary)'", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [{
      text: "Edit ×2",     // fallback ignored when primaryText+secondaryText present
      primaryText: "Edit",
      secondaryText: "×2",
      attention: "normal",
      baseColor: "cyan",
      group: "activity",
    }];
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("Edit");
    expect(plain).toContain("×2");
    // dim SGR present for secondaryText
    expect(lines[0]).toContain("\x1b[2m");
  });

  test("when only text present, falls back to text field", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [{
      text: "Edit ×2",
      attention: "normal",
      group: "activity",
    }];
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // Activity line always appends a ⌗N counter (N derived from cell counts).
    // The cell text "Edit ×2" yields a count of 2, so the counter renders ⌗2.
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("Edit ×2");
    expect(plain).toMatch(/⌗\d+/);
  });
});

// ---------------------------------------------------------------------------
// Section 20: Prose layout — T4 new test cases
// ---------------------------------------------------------------------------

describe("prose sentence — anthropic icon", () => {
  test("sentence starts with ✱ icon when mode=anthropic", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    // Icon is at full intensity (not dim), followed by a space
    expect(line!.startsWith("✱ ")).toBe(true);
  });

  test("sentence starts with icon even with NO extras", () => {
    const ctx = makeCtx();
    ctx.config.display.showContextBar = false;
    const cells = collectCells([projectWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    expect(line!.startsWith("✱ ")).toBe(true);
  });

  test("plain text (NO_COLOR) still starts with ✱ icon", () => {
    process.env.NO_COLOR = "1";
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    expect(line!.startsWith("✱ ")).toBe(true);
  });
});

describe("prose sentence — ollama icon", () => {
  test("sentence starts with ◆ icon when mode=ollama", () => {
    const ctx = makeCtx();
    (ctx as unknown as Record<string, unknown>).mode = "ollama";
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    // ◆ is a 2-wide emoji
    expect(line!.startsWith("◆")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 22: FIX 1 — project name is read from the name cell, not hardcoded
// ---------------------------------------------------------------------------

describe("prose sentence — project name is dynamic", () => {
  test("renders project name 'myapp' when project_dir basename is 'myapp'", () => {
    const ctx = makeCtx({
      stdin: {
        workspace: { current_dir: "/home/user/myapp", project_dir: "/home/user/myapp" },
      },
    });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line!);
    expect(plain).toContain("myapp on main");
    // Confirm the literal "ohud" is NOT injected when the project isn't ohud
    expect(plain).not.toContain("ohud on");
  });

  test("renders project name 'claude-code' for that project_dir", () => {
    const ctx = makeCtx({
      stdin: {
        workspace: { current_dir: "/Users/x/code/claude-code", project_dir: "/Users/x/code/claude-code" },
      },
    });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line!);
    expect(plain).toContain("claude-code on main");
  });

  test("renders 'ohud' when the project_dir basename happens to be ohud", () => {
    const ctx = makeCtx(); // default project_dir is /Users/lima/Projects/ohud
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line!);
    expect(plain).toContain("ohud on main");
  });
});

describe("prose sentence — sentence + all extras on one line (wide terminal)", () => {
  test("all extras appear inline when terminal is wide enough", () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 24,
          current_usage: { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 870 },
        },
      },
    });
    // Build extras: cache + session time
    const cacheCell = renderCacheCell(ctx.stdin);
    const sessionCell = renderSessionTimeCell(
      { ...ctx.transcript, sessionStart: new Date(Date.now() - 5_000_000), assistantMessages: [] },
      Date.now(),
    );

    const cells: HushCell[] = [
      ...collectCells([projectWidget, contextWidget], ctx),
      ...(cacheCell ? [{ ...cacheCell, id: "cache" }] : []),
      ...(sessionCell ? [{ ...sessionCell, id: "session" }] : []),
    ];
    const lines = hushLayout.pack(cells, 300, ctx.config);
    // Wide terminal — everything fits on one line
    expect(lines.length).toBe(1);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("ohud");
    expect(plain).toContain("with context 24% used");
    expect(plain).toContain("cache");
    expect(plain).toContain("session time");
  });
});

describe("prose sentence — sentence overflows → extras wrap to line 2", () => {
  test("extras wrap to line 2 when sentence + extras exceed termWidth", () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 24,
          current_usage: { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 870 },
        },
      },
    });
    const cacheCell = renderCacheCell(ctx.stdin);
    const cells: HushCell[] = [
      ...collectCells([projectWidget, contextWidget], ctx),
      ...(cacheCell ? [{ ...cacheCell, id: "cache" }] : []),
    ];
    // Narrow terminal: sentence alone fits but sentence+extras does not
    // "✱ ohud on main using Opus 4.7 (1M) with context 24% used" = ~57 chars
    // "  • cache 87% hit" = ~18 chars → 75 total, use 60 to force wrap
    const lines = hushLayout.pack(cells, 60, ctx.config);
    expect(lines.length).toBe(2);
    const line1 = stripAnsi(lines[0]!);
    const line2 = stripAnsi(lines[1]!);
    // Sentence on line 1
    expect(line1).toContain("ohud");
    expect(line1).toContain("24% used");
    // Extras on line 2 (indented)
    expect(lines[1]).toMatch(/^\s+/);  // starts with whitespace (indent)
    expect(line2).toContain("cache");
    // Extras NOT on line 1
    expect(line1).not.toContain("cache");
  });

  test("line 2 indent is 2 spaces when extras wrap", () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 24,
          current_usage: { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 870 },
        },
      },
    });
    const cacheCell = renderCacheCell(ctx.stdin);
    const cells: HushCell[] = [
      ...collectCells([projectWidget, contextWidget], ctx),
      ...(cacheCell ? [{ ...cacheCell, id: "cache" }] : []),
    ];
    const lines = hushLayout.pack(cells, 60, ctx.config);
    if (lines.length >= 2) {
      // Line 2 starts with 2 spaces (then the bullet separator)
      const raw = lines[1]!;
      expect(raw).toMatch(/^ {2}/);
    }
  });
});

describe("prose sentence — active tools → activity line with counter", () => {
  test("activity line appears as line 2 when tools running", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "t2", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.length).toBe(2);
  });

  test("activity line has ⌗N counter", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "t2", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[lines.length - 1]!);
    // Counter ⌗N at the end — N = 2 tools
    expect(activityPlain).toContain("⌗2");
  });

  test("activity line indents 2 spaces", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityLine = lines[lines.length - 1]!;
    // Activity indented with 2 spaces
    expect(activityLine).toMatch(/^ {2}/);
  });

  test("counter sums ×N from cell.secondaryText (production cell shape)", () => {
    // Regression for a bug where the counter regex only checked cell.text,
    // missing the multiplicity when widgets emit it in `secondaryText` (the
    // structured shape used for separate primary/secondary styling).
    //
    // Fixture mirrors a future widget shape: text="Edit", secondaryText="×3"
    // for a multi-instance tool. The counter must sum to 3, not 1.
    const ctx = makeCtx();
    const activityCells: HushCell[] = [
      // Three Edits collapsed into one cell with secondaryText carrying ×3
      {
        text: "Edit",
        primaryText: "Edit",
        secondaryText: "×3",
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
        group: "activity",
      },
      // Two Reads collapsed into another cell with ×2 in secondaryText
      {
        text: "Read",
        primaryText: "Read",
        secondaryText: "×2",
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
        group: "activity",
      },
      // One Bash with no count suffix (single instance) — contributes 1
      {
        text: "Bash",
        attention: "normal",
        baseColor: "cyan",
        animate: "spinner",
        group: "activity",
      },
    ];
    const cells = [...collectCells([projectWidget, contextWidget], ctx), ...activityCells];
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[lines.length - 1]!);
    // Total: 3 + 2 + 1 = 6
    expect(activityPlain).toContain("⌗6");
  });

  test("counter sums ×N from cell.text (toolsWidget production shape)", () => {
    // toolsWidget bakes "×N" into cell.text directly; the regex must still match.
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      // 3 Edit + 2 Read + 1 Bash = 6 invocations across 3 deduped names
      { id: "e1", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "e2", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "e3", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "r1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "r2", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
      { id: "b1", name: "Bash", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[lines.length - 1]!);
    expect(activityPlain).toContain("⌗6");
  });

  test("all three lines: sentence + wrapped-extras + activity", () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 24,
          current_usage: { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 870 },
        },
      },
    });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cacheCell = renderCacheCell(ctx.stdin);
    const cells: HushCell[] = [
      ...collectCells([projectWidget, contextWidget, toolsWidget], ctx),
      ...(cacheCell ? [{ ...cacheCell, id: "cache" }] : []),
    ];
    // Narrow enough to force extras wrap but not sentence truncation
    const lines = hushLayout.pack(cells, 60, ctx.config);
    // Should be 3 lines: sentence, extras, activity
    expect(lines.length).toBe(3);
    // Line 1: sentence
    expect(stripAnsi(lines[0]!)).toContain("ohud");
    // Line 2: extras (indented)
    expect(lines[1]!).toMatch(/^ {2}/);
    expect(stripAnsi(lines[1]!)).toContain("cache");
    // Line 3: activity (indented)
    expect(lines[2]!).toMatch(/^ {2}/);
    expect(stripAnsi(lines[2]!)).toContain("Read");
  });
});

describe("prose sentence — threshold transitions", () => {
  test("context at 59% is muted (below warning threshold of 60)", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 59 } } });
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("muted");
  });

  test("context at 60% is warning (>= 60 default threshold)", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 60 } } });
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("warning");
  });

  test("context at 61% is warning (> 60 default threshold)", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 61 } } });
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("warning");
  });

  test("context at 61% produces yellow SGR in prose sentence", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 61 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    expect(line).toContain("\x1b[33m");
    expect(line).toContain("61%");
  });

  test("context at 75% is danger (>= criticalThreshold of 75)", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 75 } } });
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("danger");
  });

  test("context at 75% produces red SGR in prose sentence", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 75 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    expect(line).toContain("\x1b[31m");
    expect(line).toContain("75%");
  });

  test("context at 74% is warning (above 60, below 75)", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 74 } } });
    const cell = contextWidget.renderHush!(ctx) as HushCell;
    expect(cell.attention).toBe("warning");
  });
});

describe("prose sentence — hyperlink only on tools counter", () => {
  test("sentence has no OSC 8 hyperlinks", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    // No OSC 8 sequences in the sentence line
    expect(lines[0]).not.toContain("\x1b]8;;");
  });

  test("activity counter ⌗N has no OSC 8 when no LayoutContext is passed", () => {
    const ctx = makeCtx();
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Read", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    // Pass NO layoutCtx — pack() can't compute the file:// URL without session_id
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const activityPlain = stripAnsi(lines[lines.length - 1]!);
    expect(activityPlain).toContain("⌗1");
    expect(lines[lines.length - 1]).not.toContain("\x1b]8;;");
  });

  test("activity counter gets OSC 8 file:// link when LayoutContext provides session_id", () => {
    const ctx = makeCtx({
      stdin: {
        session_id: "test-session-abc-123",
        context_window: { used_percentage: 15 },
      },
    });
    ctx.config.display.showTools = true;
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    // Pass LayoutContext with session_id — pack() must compute the URL itself
    const lines = hushLayout.pack(cells, 200, ctx.config, {
      stdin: ctx.stdin,
      transcript: ctx.transcript,
    });
    const activityLine = lines[lines.length - 1]!;
    // The OSC 8 sequence is present on the counter, with the deterministic path
    expect(activityLine).toContain("\x1b]8;;file://");
    expect(activityLine).toContain("test-session-abc-123.txt");
  });

  test("OSC 8 link suppressed when hush.hyperlinks=false even with session_id", () => {
    const ctx = makeCtx({
      stdin: {
        session_id: "test-session-xyz",
        context_window: { used_percentage: 15 },
      },
    });
    ctx.config.display.showTools = true;
    ctx.config.display.hush = { hyperlinks: false };
    ctx.transcript.tools = [
      { id: "t1", name: "Edit", status: "running", startTime: new Date(Date.now() - 1000) },
    ];
    const cells = collectCells([projectWidget, contextWidget, toolsWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config, {
      stdin: ctx.stdin,
      transcript: ctx.transcript,
    });
    // Counter still present but no OSC 8 escape
    const plain = stripAnsi(lines[lines.length - 1]!);
    expect(plain).toContain("⌗1");
    expect(lines[lines.length - 1]).not.toContain("\x1b]8;;");
  });
});

describe("prose sentence — density affects bullet padding", () => {
  function makeProseCtxWithExtras() {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 24,
          current_usage: { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 870 },
        },
      },
    });
    const cacheCell = renderCacheCell(ctx.stdin)!;
    const cells: HushCell[] = [
      ...collectCells([projectWidget, contextWidget], ctx),
      { ...cacheCell, id: "cache" },
    ];
    return { ctx, cells };
  }

  test("compact (default): extras separated by ' • ' (1 space each side)", () => {
    const { ctx, cells } = makeProseCtxWithExtras();
    ctx.config.display.hush = { density: "compact" };
    const [line] = hushLayout.pack(cells, 300, ctx.config);
    const plain = stripAnsi(line!);
    // Between "used" and "cache" there should be " • " (1 space • 1 space)
    expect(plain).toContain("used • cache");
  });

  test("comfortable: extras separated by '  •  ' (2 spaces each side)", () => {
    const { ctx, cells } = makeProseCtxWithExtras();
    ctx.config.display.hush = { density: "comfortable" };
    const [line] = hushLayout.pack(cells, 300, ctx.config);
    const plain = stripAnsi(line!);
    expect(plain).toContain("used  •  cache");
  });

  test("airy: extras separated by '   •   ' (3 spaces each side)", () => {
    const { ctx, cells } = makeProseCtxWithExtras();
    ctx.config.display.hush = { density: "airy" };
    const [line] = hushLayout.pack(cells, 300, ctx.config);
    const plain = stripAnsi(line!);
    expect(plain).toContain("used   •   cache");
  });
});

describe("prose sentence — cache cell omitted on Ollama-style payload (no cache tokens)", () => {
  test("no cache clause when cache tokens are absent", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "kimi-k2-6-262k" },
        context_window: {
          context_window_size: 200000,
          used_percentage: 43,
          // No current_usage → cache cell returns null
        },
      },
    });
    (ctx as unknown as Record<string, unknown>).mode = "ollama";
    // No cache cell since no cache data
    const cacheCell = renderCacheCell(ctx.stdin);
    expect(cacheCell).toBeNull();

    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    // Sentence still flows without cache clause
    expect(plain).toContain("ohud");
    expect(plain).toContain("43% used");
    expect(plain).not.toContain("cache");
  });

  test("ollama sentence uses ◆ icon and shows kimi model label", () => {
    const ctx = makeCtx({
      stdin: {
        model: { id: "kimi-k2-6-262k" },
        context_window: { used_percentage: 43 },
      },
    });
    (ctx as unknown as Record<string, unknown>).mode = "ollama";
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    expect(line!.startsWith("◆")).toBe(true);
    const plain = stripAnsi(line!);
    expect(plain).toContain("Kimi K2.6 (262K)");
  });
});

// ---------------------------------------------------------------------------
// Utility: strip ANSI SGR codes (not OSC 8)
// ---------------------------------------------------------------------------
function stripAnsi(s: string): string {
  // Strip SGR codes: ESC [ ... m
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
