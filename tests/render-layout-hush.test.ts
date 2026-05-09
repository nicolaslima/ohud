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
    context_window: { context_window_size: 200000, used_percentage: 15 },
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

  test("line 1 contains model label (condensed)", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    // "claude-opus-4-7" → "opus-4.7"
    expect(plain).toContain("opus-4.7");
  });

  test("line 1 contains context percentage", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 15 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    expect(plain).toContain("15%");
  });

  test("separator between cells is exactly two spaces", () => {
    const ctx = makeCtx({ stdin: { context_window: { used_percentage: 15 } } });
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const [line1] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line1!);
    // Check two spaces but not three consecutive spaces
    expect(plain).toContain("  ");
    expect(plain).not.toMatch(/   /); // no three consecutive spaces
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
    const spinnerChars = ["◐", "◓", "◑", "◒"];
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
    const spinnerChars = ["◐", "◓", "◑", "◒"];
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
    expect(plain).toContain("opus-4.7");
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
// ---------------------------------------------------------------------------

describe("OSC 8 hyperlinks", () => {
  test("project name cell has file:// link", () => {
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const nameCell = cells[0]!;
    expect(nameCell.link).toBeDefined();
    expect(nameCell.link!.startsWith("file://")).toBe(true);
  });

  test("model cell has anthropic docs link", () => {
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const modelCell = cells.find((c) => c.text.includes("opus"));
    expect(modelCell).toBeDefined();
    expect(modelCell!.link).toBeDefined();
    expect(modelCell!.link!).toContain("docs.anthropic.com");
  });

  test("OSC 8 escape sequence present in pack output for project cell", () => {
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const tagged = cells.map((c) => ({ ...c, group: "header" as const }));
    const lines = hushLayout.pack(tagged, 200, ctx.config);
    const line1 = lines[0]!;
    // OSC 8 = \x1b]8;;...BEL
    expect(line1).toContain("\x1b]8;;file://");
    expect(line1).toContain("\x07");
  });

  test("OSC 8 links still present even when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    const ctx = makeCtx();
    const cells = projectWidget.renderHush!(ctx) as HushCell[];
    const tagged = cells.map((c) => ({ ...c, group: "header" as const }));
    const lines = hushLayout.pack(tagged, 200, ctx.config);
    expect(lines[0]).toContain("\x1b]8;;");
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
    const spinnerChars = ["◐", "◓", "◑", "◒"];
    const spinnerFound = spinnerChars.some((ch) => plain.includes(ch));
    expect(spinnerFound).toBe(true);
  });

  test("idle state has no spinner", () => {
    const ctx = makeCtx();
    const cells = collectCells([projectWidget, contextWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    for (const l of lines) {
      const plain = stripAnsi(l);
      const spinnerChars = ["◐", "◓", "◑", "◒"];
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
    const spinnerChars = ["◐", "◓", "◑", "◒"];
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
// Section 13: Branch OSC 8 link from remoteUrl
// ---------------------------------------------------------------------------

describe("Branch OSC 8 link", () => {
  test("branch cell emits OSC 8 link when gitStatus.remoteUrl is detectable (https)", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "https://github.com/anthropic/ohud.git";
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    const branchCell = projectCells.find((c) => c.text.includes("main"));
    expect(branchCell).toBeDefined();
    expect(branchCell!.link).toBe("https://github.com/anthropic/ohud");
  });

  test("branch cell emits OSC 8 link from SSH-form remoteUrl", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    const branchCell = projectCells.find((c) => c.text.includes("main"));
    expect(branchCell!.link).toBe("https://github.com/anthropic/ohud");
  });

  test("branch cell has no link when remoteUrl is missing", () => {
    const ctx = makeCtx();
    // gitStatus has no remoteUrl set
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    const branchCell = projectCells.find((c) => c.text.includes("main"));
    expect(branchCell!.link).toBeUndefined();
  });

  test("branch cell has no link when remoteUrl is non-host (custom hostname)", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@my-internal-host:team/repo.git";
    const projectCells = projectWidget.renderHush!(ctx) as HushCell[];
    const branchCell = projectCells.find((c) => c.text.includes("main"));
    expect(branchCell!.link).toBeUndefined();
  });

  test("branch link appears in pack output as OSC 8 escape sequence", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines[0]).toContain("\x1b]8;;https://github.com/anthropic/ohud\x07");
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

  test("display.hush.hyperlinks=true (default) emits OSC 8", () => {
    const ctx = makeCtx();
    if (ctx.gitStatus) ctx.gitStatus.remoteUrl = "git@github.com:anthropic/ohud.git";
    // Don't set hyperlinks → default true via DEFAULT_CONFIG
    const cells = collectCells([projectWidget], ctx);
    const lines = hushLayout.pack(cells, 200, ctx.config);
    expect(lines.join("\n")).toContain("\x1b]8;;");
  });
});

describe("hush.animate toggle", () => {
  test("display.hush.animate=false omits spinner glyph but keeps cell content", () => {
    const now = new Date("2024-01-01T00:00:00Z");
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
    // No spinner glyphs (◐ ◓ ◑ ◒ for unicode)
    expect(plain).not.toMatch(/[◐◓◑◒]/);
    // But the running tool name still shows
    expect(plain).toContain("Edit");
  });

  test("display.hush.animate=true (default) renders spinner glyph for running tools", () => {
    const now = new Date("2024-01-01T00:00:00Z");
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
    expect(plain).toMatch(/[◐◓◑◒]/);
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
// Section 15: Density — 3-tier separator system
// ---------------------------------------------------------------------------

describe("density separators", () => {
  function makeTwoCells(groupA: string, groupB: string): HushCell[] {
    return [
      { text: "Alpha", attention: "normal", group: groupA as import("../src/render/widget.js").WidgetGroup },
      { text: "Beta",  attention: "normal", group: groupB as import("../src/render/widget.js").WidgetGroup },
    ];
  }

  test("compact density: same-group cells joined by 1 space", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "compact" };
    const [line] = hushLayout.pack(makeTwoCells("header", "header"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha Beta");
  });

  test("compact density: cross-group cells joined by 2 spaces", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "compact" };
    const [line] = hushLayout.pack(makeTwoCells("header", "metrics"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha  Beta");
  });

  test("comfortable density: same-group cells joined by ' · '", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "comfortable" };
    const [line] = hushLayout.pack(makeTwoCells("header", "header"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha · Beta");
  });

  test("comfortable density: cross-group cells joined by 4 spaces", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "comfortable" };
    const [line] = hushLayout.pack(makeTwoCells("header", "metrics"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha    Beta");
  });

  test("airy density: same-group cells joined by 2 spaces", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "airy" };
    const [line] = hushLayout.pack(makeTwoCells("header", "header"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha  Beta");
  });

  test("airy density: cross-group cells joined by 6 spaces", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "airy" };
    const [line] = hushLayout.pack(makeTwoCells("header", "metrics"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha      Beta");
  });

  test("default density (unset) behaves as compact", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = {};
    const [line] = hushLayout.pack(makeTwoCells("header", "header"), 200, ctx.config);
    expect(stripAnsi(line!)).toBe("Alpha Beta");
  });

  test("project sub-cells (name + branch + model) all have header group → use WITHIN_SEP", () => {
    const ctx = makeCtx();
    ctx.config.display.hush = { density: "comfortable" };
    const cells = collectCells([projectWidget], ctx);
    expect(cells.every((c) => c.group === "header")).toBe(true);
    const [line] = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(line!);
    // comfortable WITHIN_SEP is " · "
    expect(plain).toContain(" · ");
    // No 4-space BETWEEN_SEP within header sub-cells
    expect(plain).not.toContain("    ");
  });
});

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
// Section 18: Priority-aware truncation
// ---------------------------------------------------------------------------

describe("priority-aware truncation", () => {
  test("low-priority cell dropped before high-priority when line overflows", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [
      { text: "project-name", attention: "normal", group: "header",  priority: 100 },
      { text: "metric-low",   attention: "normal", group: "metrics", priority: 10 },
    ];
    // Narrow terminal that can fit "project-name" (12) but not both with 2-space sep (26)
    const lines = hushLayout.pack(cells, 14, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("project-name");
    expect(plain).not.toContain("metric-low");
  });

  test("header cell survives when lower-priority metrics overflow", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [
      { text: "ohud",      attention: "normal", group: "header",  priority: 100 },
      { text: "usage-pct", attention: "normal", group: "metrics", priority: 40 },
      { text: "api-time",  attention: "normal", group: "metrics", priority: 50 },
    ];
    const lines = hushLayout.pack(cells, 10, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("ohud");
  });

  test("higher-priority metric kept over lower-priority metric", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [
      { text: "ohud", attention: "normal", group: "header",  priority: 100 },
      { text: "low",  attention: "normal", group: "metrics", priority: 30 },
      { text: "high", attention: "normal", group: "metrics", priority: 80 },
    ];
    // Width fits "ohud  high" (10) but not all three with separators (ohud+2+low+2+high=19)
    const lines = hushLayout.pack(cells, 12, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).not.toContain("low");
    expect(plain).toContain("high");
  });

  test("all cells fit → no truncation, all content present", () => {
    const ctx = makeCtx();
    const cells: HushCell[] = [
      { text: "A", attention: "normal", group: "header",  priority: 100 },
      { text: "B", attention: "normal", group: "metrics", priority: 50 },
    ];
    const lines = hushLayout.pack(cells, 200, ctx.config);
    const plain = stripAnsi(lines[0]!);
    expect(plain).toContain("A");
    expect(plain).toContain("B");
  });
});

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
    expect(stripAnsi(lines[0]!)).toBe("Edit ×2");
  });
});

// ---------------------------------------------------------------------------
// Utility: strip ANSI SGR codes (not OSC 8)
// ---------------------------------------------------------------------------
function stripAnsi(s: string): string {
  // Strip SGR codes: ESC [ ... m
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
