// tests/render-layout-row.test.ts
//
// Verifies that RowLayout (via the new render()) produces byte-identical output
// to the old imperative renderer for all key scenarios.
//
// Strategy: we call render() (which now delegates to RowLayout) and assert the
// same structural properties the old renderer guaranteed. For exact-string
// comparisons we derive expected values from the widget.render(ctx) bodies —
// these are the same render functions that RowLayout calls.
//
import { test, expect, describe } from "bun:test";
import { visibleWidth } from "../src/render/width.js";
import { render } from "../src/render/index.js";
import { projectWidget } from "../src/render/widgets/project.js";
import { contextWidget } from "../src/render/widgets/context.js";
import { usageWidget } from "../src/render/widgets/usage.js";
import { apiTimeWidget } from "../src/render/widgets/api-time.js";
import { costWidget } from "../src/render/widgets/cost.js";
import { color } from "../src/render/colors.js";
import { glyph } from "../src/render/glyphs.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { RenderContext, StdinData } from "../src/types.js";

// Helpers to call widget.render() and return body (same as what RowLayout uses).
// renderProject always returns a string (project is the anchor widget, never null in practice).
// Others may return null — callers use the ! non-null assertion where the original guaranteed a value.
function renderProject(ctx: RenderContext): string { return projectWidget.render(ctx)?.body ?? ""; }
function renderContext(ctx: RenderContext): string | null { return contextWidget.render(ctx)?.body ?? null; }
function renderUsage(ctx: RenderContext): string | null { return usageWidget.render(ctx)?.body ?? null; }
function renderApiTime(ctx: RenderContext): string | null { return apiTimeWidget.render(ctx)?.body ?? null; }
function renderCost(ctx: RenderContext): string | null { return costWidget.render(ctx)?.body ?? null; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(
  overrides: Partial<RenderContext> & { stdin?: StdinData },
): RenderContext {
  const stdin: StdinData = overrides.stdin ?? {
    model: { id: "claude-opus-4-7", display_name: "Opus 4.7" },
    workspace: {
      current_dir: "/Users/lima/Projects/ohud",
      project_dir: "/Users/lima/Projects/ohud",
    },
    context_window: { context_window_size: 200000, used_percentage: 45 },
    cost: { total_cost_usd: 0, total_duration_ms: 60000 },
  };
  return {
    mode: "anthropic",
    stdin,
    transcript: { tools: [], agents: [], todos: [] },
    gitStatus: { branch: "main", dirty: false, ahead: 0, behind: 0 },
    config: structuredClone(DEFAULT_CONFIG),
    usageData: null,
    costData: null,
    memoryInfo: null,
    cloudModels: [],
    ...overrides,
  };
}

function sep(ctx: RenderContext): string {
  return color(ctx.config.colors.label, glyph("sep", ctx.config.display.glyphs));
}

// ---------------------------------------------------------------------------
// Scenario 1: Anthropic mode, wide terminal (200 cols), 45% context + usage
// Line 1 = project; Line 2 = context │ usage
// ---------------------------------------------------------------------------

describe("Scenario 1: anthropic, wide terminal, context + usage", () => {
  test("line 1 is the project line", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    const lines = out.split("\n");

    // Line 1 must match what renderProject produces
    const expectedProject = renderProject(ctx);
    expect(lines[0]).toBe(expectedProject);
  });

  test("line 2 contains context merged with usage via ` │ ` separator", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    const lines = out.split("\n");

    // Line 2 should contain both Context and Usage
    expect(lines[1]).toContain("Context");
    expect(lines[1]).toContain("45%");
    expect(lines[1]).toContain("Usage");

    // The separator should appear between them
    const ctxPart = renderContext(ctx)!;
    const usagePart = renderUsage(ctx)!;
    const mergedExpected = `${ctxPart} ${sep(ctx)} ${usagePart}`;
    expect(lines[1]).toBe(mergedExpected);
  });

  test("output has exactly 2 lines with default config (project + merged)", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    expect(out.split("\n").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Anthropic mode, 120 cols — same structure, truncation not needed
// ---------------------------------------------------------------------------

describe("Scenario 2: anthropic, 120 cols, project-only (no usage data)", () => {
  test("line 1 is project, line 2 is context only when no usage data", () => {
    const ctx = makeCtx({});
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");

    // Line 1: project
    expect(lines[0]).toContain("ohud");
    // Line 2: context only (no usage since usageData=null)
    expect(lines[1]).toContain("Context");
    expect(lines[1]).toContain("45%");
    // No merge separator since only one side
    expect(lines[1]).not.toContain("│");
  });

  test("line 2 matches renderContext output exactly when no usage", () => {
    const ctx = makeCtx({});
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");
    const ctxLine = renderContext(ctx)!;
    expect(lines[1]).toBe(ctxLine);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Anthropic mode, 80 cols narrow terminal — long lines truncated
// ---------------------------------------------------------------------------

describe("Scenario 3: narrow terminal (80 cols) — truncation applied", () => {
  test("all lines are at most 80 visual characters wide", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 80;
    // Turn on reset labels to make lines longer
    ctx.config.display.showResetLabel = true;
    ctx.usageData!.fiveHourResetAt = new Date(Date.now() + 90 * 60 * 1000);

    const out = render(ctx);
    for (const line of out.split("\n")) {
      // Strip the trailing reset from visibleWidth: after truncation line ends with "…"
      // Just verify each line's visible width does not exceed 80
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  test("truncated lines end with the … character if truncation occurred", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000), sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 80;
    ctx.config.display.showResetLabel = true;

    const out = render(ctx);
    for (const line of out.split("\n")) {
      if (visibleWidth(line) === 80) {
        // If the full line is truncated, it ends with "…"
        expect(line).toContain("…");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Ollama mode, 120 cols — context │ apiTime on line 2
// ---------------------------------------------------------------------------

describe("Scenario 4: ollama mode, context merged with apiTime", () => {
  test("line 2 contains context merged with apiTime via ` │ ` separator", () => {
    const ctx = makeCtx({
      mode: "ollama",
      stdin: {
        model: { id: "glm-5:cloud", display_name: "glm-5:cloud" },
        workspace: { current_dir: "/Users/lima/Projects/ohud", project_dir: "/Users/lima/Projects/ohud" },
        context_window: { context_window_size: 128000, used_percentage: 45 },
        cost: { total_api_duration_ms: 75_000 },
      },
    });
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");

    // Line 2 should contain Context and API time
    expect(lines[1]).toContain("Context");
    expect(lines[1]).toContain("API");
    // The separator should be present
    expect(lines[1]).toContain("│");

    // Verify exact merge formula
    const ctxPart = renderContext(ctx)!;
    const apiPart = renderApiTime(ctx)!;
    const mergedExpected = `${ctxPart} ${sep(ctx)} ${apiPart}`;
    expect(lines[1]).toBe(mergedExpected);
  });

  test("apiTime not shown in anthropic mode", () => {
    const ctx = makeCtx({
      mode: "anthropic",
      stdin: {
        model: { id: "claude-opus-4-7", display_name: "Opus 4.7" },
        workspace: { current_dir: "/Users/lima/Projects/ohud", project_dir: "/Users/lima/Projects/ohud" },
        context_window: { context_window_size: 200000, used_percentage: 45 },
        cost: { total_api_duration_ms: 75_000 },
      },
    });
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");
    // In anthropic mode, apiTime renderer returns null
    const apiOut = renderApiTime(ctx);
    expect(apiOut).toBeNull();
    // So no API on line 2
    expect(lines[1]).not.toContain("API");
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: No git repo (gitStatus=null), anthropic, 120 cols
// ---------------------------------------------------------------------------

describe("Scenario 5: no git repo (gitStatus=null)", () => {
  test("project line has no git:() block when gitStatus is null", () => {
    const ctx = makeCtx({ gitStatus: null });
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");

    // Project line should not contain git block
    expect(lines[0]).not.toContain("git:(");
    // But project name should still be there
    expect(lines[0]).toContain("ohud");
  });

  test("project line matches renderProject output exactly", () => {
    const ctx = makeCtx({ gitStatus: null });
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const expectedProject = renderProject(ctx);
    expect(out.split("\n")[0]).toBe(expectedProject);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Very narrow terminal (60 cols) — confirms truncation with "…"
// ---------------------------------------------------------------------------

describe("Scenario 6: very narrow terminal (60 cols)", () => {
  test("lines do not exceed 60 visual chars", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 60;

    const out = render(ctx);
    for (const line of out.split("\n")) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
  });

  test("truncated line ends with … at exactly 60 width", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000), sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 60;
    ctx.config.display.showResetLabel = true;

    const out = render(ctx);

    // At least one line should be truncated given 60 cols + usage with reset label
    const wasTruncated = out.split("\n").some((l) => l.includes("…"));
    expect(wasTruncated).toBe(true);

    // All lines at most 60 wide
    for (const line of out.split("\n")) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Cost auto-shows when native cost > 0 (showCost=false default)
// ---------------------------------------------------------------------------

describe("Scenario 7: cost auto-shown when native cost > 0", () => {
  test("cost line appears with native totalUsd > 0 even with showCost=false", () => {
    const ctx = makeCtx({
      costData: { totalUsd: 0.42, source: "native" },
    });
    // showCost defaults to false; renderCost should still auto-show native cost
    expect(ctx.config.display.showCost).toBe(false);
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    expect(out).toContain("$0.42");
    expect(out).toContain("Cost");
  });

  test("cost line appears on correct position (after project and context/usage)", () => {
    const ctx = makeCtx({
      costData: { totalUsd: 0.42, source: "native" },
    });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    const lines = out.split("\n");
    // Line 0 = project, Line 1 = context (no usage), Line 2 = cost
    const costIdx = lines.findIndex((l) => l.includes("Cost"));
    const ctxIdx = lines.findIndex((l) => l.includes("Context"));
    expect(costIdx).toBeGreaterThan(ctxIdx);
  });

  test("cost line matches renderCost output exactly", () => {
    const ctx = makeCtx({
      costData: { totalUsd: 0.42, source: "native" },
    });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    const expectedCost = renderCost(ctx)!;
    expect(out).toContain(expectedCost);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: showCost=false AND totalUsd=0 — cost line is hidden
// ---------------------------------------------------------------------------

describe("Scenario 8: cost hidden when showCost=false and totalUsd=0", () => {
  test("no cost line when showCost=false and totalUsd=0", () => {
    const ctx = makeCtx({
      costData: { totalUsd: 0, source: "native" },
    });
    expect(ctx.config.display.showCost).toBe(false);
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    expect(out).not.toContain("Cost");
    expect(out).not.toContain("$0.00");
  });

  test("no cost line when costData is null", () => {
    const ctx = makeCtx({ costData: null });
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    expect(out).not.toContain("Cost");
  });

  test("renderCost returns null for that scenario (confirms widget delegates correctly)", () => {
    const ctx = makeCtx({
      costData: { totalUsd: 0, source: "native" },
    });
    expect(renderCost(ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Ollama mode with showContextBar=false — apiTime appears alone
// (covers the third merge branch: ctxCell=null, rightCell=present)
// ---------------------------------------------------------------------------

describe("Scenario 9: ollama mode, context suppressed, apiTime alone on line 2", () => {
  test("line 2 contains apiTime body alone with no leading separator", () => {
    const ctx = makeCtx({
      mode: "ollama",
      stdin: {
        model: { id: "glm-5:cloud", display_name: "glm-5:cloud" },
        workspace: { current_dir: "/Users/lima/Projects/ohud", project_dir: "/Users/lima/Projects/ohud" },
        context_window: { context_window_size: 128000, used_percentage: 45 },
        cost: { total_api_duration_ms: 75_000 },
      },
    });
    ctx.config.display.showContextBar = false;
    ctx.config.maxWidth = 120;

    const out = render(ctx);
    const lines = out.split("\n");

    // Confirm the visibility gate behavior: context widget is not in visibleWidgets
    // anymore, so renderContext is never invoked and line 2 = apiTime alone.
    expect(lines.length).toBe(2);

    // Line 2 should equal apiTime body exactly — no merge, no leading sep.
    const apiPart = renderApiTime(ctx)!;
    expect(lines[1]).toBe(apiPart);

    // Confirm no orphan separator (` │ `) at start or end of line 2.
    expect(lines[1]).not.toMatch(/^\s*│/);
    expect(lines[1]).not.toMatch(/│\s*$/);
    // No "Context" anywhere.
    expect(lines[1]).not.toContain("Context");
  });

  test("anthropic mode equivalent: showContextBar=false + usage present → usage alone", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.display.showContextBar = false;
    ctx.config.maxWidth = 200;

    const out = render(ctx);
    const lines = out.split("\n");
    expect(lines.length).toBe(2);

    const usagePart = renderUsage(ctx)!;
    expect(lines[1]).toBe(usagePart);
    expect(lines[1]).not.toContain("Context");
  });
});

// ---------------------------------------------------------------------------
// Fallback sentinel: render returns the exact sentinel when ALL widgets gate off
// ---------------------------------------------------------------------------

describe("Fallback sentinel", () => {
  test("returns exact 'ohud' sentinel string when every widget produces nothing", () => {
    // Build a context where every visible widget either gates off or produces
    // an empty body. Recipe:
    //   - No model, no workspace → renderProject returns "" (empty parts list)
    //   - showContextBar=false → context widget filtered out
    //   - showApiTime=false / mode=anthropic → apiTime renders null
    //   - showUsage=false / no usageData → usage renders null
    //   - costData=null → cost renders null
    //   - All other show* flags default false → those widgets filtered out
    const ctx: RenderContext = {
      mode: "anthropic",
      stdin: {}, // no model, no workspace, no context_window
      transcript: { tools: [], agents: [], todos: [] },
      gitStatus: null,
      config: structuredClone(DEFAULT_CONFIG),
      usageData: null,
      costData: null,
      memoryInfo: null,
      cloudModels: [],
    };
    ctx.config.display.showModel = false;       // suppress model badge
    ctx.config.display.showContextBar = false;  // gate context widget out
    ctx.config.display.showApiTime = false;     // gate apiTime widget out
    ctx.config.display.showUsage = false;       // gate usage widget out
    ctx.config.display.showEffortLevel = false; // suppress effort label
    ctx.config.gitStatus.enabled = false;       // suppress git block
    ctx.config.maxWidth = 120;

    // Sanity: project widget produces empty body (all parts list is empty)
    expect(renderProject(ctx)).toBe("");

    const out = render(ctx);
    // Exact sentinel string with ANSI wrapper from color()
    const expectedSentinel = color(ctx.config.colors.label, "ohud");
    expect(out).toBe(expectedSentinel);
  });

  test("sentinel fires even when project body would otherwise be empty string", () => {
    // Same as above but verify by exact string match the sentinel includes
    // the dim ANSI wrapper (since colors.label = "dim" by default).
    const ctx: RenderContext = {
      mode: "anthropic",
      stdin: {},
      transcript: { tools: [], agents: [], todos: [] },
      gitStatus: null,
      config: structuredClone(DEFAULT_CONFIG),
      usageData: null,
      costData: null,
      memoryInfo: null,
      cloudModels: [],
    };
    ctx.config.display.showModel = false;
    ctx.config.display.showContextBar = false;
    ctx.config.display.showApiTime = false;
    ctx.config.display.showUsage = false;
    ctx.config.display.showEffortLevel = false;
    ctx.config.gitStatus.enabled = false;

    const out = render(ctx);
    // colors.label="dim" → \x1b[2m + ohud + \x1b[0m
    expect(out).toBe("\x1b[2mohud\x1b[0m");
  });
});

// ---------------------------------------------------------------------------
// Structural: multi-line agents output is split correctly
// ---------------------------------------------------------------------------

describe("Multi-line agent output is split into separate physical lines", () => {
  test("two running agents produce two separate lines in output", () => {
    const ctx = makeCtx({});
    ctx.config.display.showAgents = true;
    ctx.config.maxWidth = 200;
    ctx.transcript.agents = [
      { id: "a1", type: "general-purpose", status: "running", startTime: new Date() },
      { id: "a2", type: "code-review", status: "running", startTime: new Date() },
    ];

    const out = render(ctx);
    const lines = out.split("\n");
    // Each running agent gets its own line (renderAgents uses \n for multiple running)
    const agentLines = lines.filter((l) => l.includes("general-purpose") || l.includes("code-review"));
    expect(agentLines.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task C review C1: runtime narrowing — unknown layout names fall back to row
// ---------------------------------------------------------------------------

describe("Layout fallback for unknown values", () => {
  test('config.display.layout="tracks" (unknown) falls back to RowLayout', () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;
    // Force-cast to bypass the TS-level "row" | "hush" union — simulates a
    // user editing config.json by hand with an out-of-date layout name.
    (ctx.config.display as unknown as { layout: string }).layout = "tracks";

    const out = render(ctx);
    const lines = out.split("\n");

    // Same shape as Scenario 1: line 1 = project, line 2 = context+usage merged.
    const expectedProject = renderProject(ctx);
    expect(lines[0]).toBe(expectedProject);
    // Line 2 looks like RowLayout output (Context label present)
    expect(lines[1]).toContain("Context");
    expect(lines[1]).toContain("45%");
  });

  test("config.display.layout=undefined falls back to RowLayout", () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;
    delete (ctx.config.display as unknown as { layout?: string }).layout;

    const out = render(ctx);
    const expectedProject = renderProject(ctx);
    expect(out.split("\n")[0]).toBe(expectedProject);
  });

  test('config.display.layout=null (corrupt JSON) falls back to RowLayout', () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;
    (ctx.config.display as unknown as { layout: unknown }).layout = null;

    // Should NOT throw; should render normal Row output.
    const out = render(ctx);
    expect(out.split("\n")[0]).toBe(renderProject(ctx));
  });

  test('config.display.layout=42 (number, corrupt) falls back to RowLayout', () => {
    const ctx = makeCtx({
      usageData: { fiveHour: 25, sevenDay: 41, fiveHourResetAt: null, sevenDayResetAt: null },
    });
    ctx.config.maxWidth = 200;
    (ctx.config.display as unknown as { layout: unknown }).layout = 42;

    const out = render(ctx);
    expect(out.split("\n")[0]).toBe(renderProject(ctx));
  });
});
