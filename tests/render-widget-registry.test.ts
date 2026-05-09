// tests/render-widget-registry.test.ts
import { test, expect, describe } from "bun:test";
import { WIDGETS, visibleWidgets } from "../src/render/widgets/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("widget registry invariants", () => {
  test("exactly 15 widgets are registered", () => {
    expect(WIDGETS.length).toBe(15);
  });

  test("all widget IDs are unique", () => {
    const ids = WIDGETS.map((w) => w.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(WIDGETS.length);
  });

  test("all widget IDs are non-empty strings", () => {
    for (const w of WIDGETS) {
      expect(typeof w.id).toBe("string");
      expect(w.id.length).toBeGreaterThan(0);
    }
  });

  test("all priorities are integers in range 1–100", () => {
    for (const w of WIDGETS) {
      expect(Number.isInteger(w.priority)).toBe(true);
      expect(w.priority).toBeGreaterThan(0);
      expect(w.priority).toBeLessThanOrEqual(100);
    }
  });

  test("all minWidths are positive integers", () => {
    for (const w of WIDGETS) {
      expect(Number.isInteger(w.minWidth)).toBe(true);
      expect(w.minWidth).toBeGreaterThan(0);
    }
  });

  test("all groups are valid WidgetGroup values", () => {
    const validGroups = new Set(["header", "metrics", "activity"]);
    for (const w of WIDGETS) {
      expect(validGroups.has(w.group)).toBe(true);
    }
  });

  test("all widgets have a render() function", () => {
    for (const w of WIDGETS) {
      expect(typeof w.render).toBe("function");
    }
  });

  test("expected widget IDs are all present", () => {
    const ids = new Set(WIDGETS.map((w) => w.id));
    const expectedIds = [
      "project", "context", "apiTime", "usage", "cost", "promptCache",
      "memory", "duration", "tools", "agents", "todos", "environment",
      "errors", "sessionTime", "tokensPerSec",
    ];
    for (const id of expectedIds) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("specific widget metadata matches spec", () => {
    const byId = new Map(WIDGETS.map((w) => [w.id, w]));

    // Check a sample of widgets from the spec table
    const project = byId.get("project")!;
    expect(project.group).toBe("header");
    expect(project.priority).toBe(100);
    expect(project.minWidth).toBe(20);

    const context = byId.get("context")!;
    expect(context.group).toBe("metrics");
    expect(context.priority).toBe(90);
    expect(context.minWidth).toBe(22);

    const tools = byId.get("tools")!;
    expect(tools.group).toBe("activity");
    expect(tools.priority).toBe(90);
    expect(tools.minWidth).toBe(16);

    const environment = byId.get("environment")!;
    expect(environment.group).toBe("activity");
    expect(environment.priority).toBe(30);
    expect(environment.minWidth).toBe(14);
  });

  test("visibleWidgets(DEFAULT_CONFIG) returns expected default-visible widgets", () => {
    const visible = visibleWidgets(DEFAULT_CONFIG);
    const visibleIds = visible.map((w) => w.id);

    // Default config: showContextBar=true, showApiTime=true, showUsage=true,
    // cost always included (render-time gating), project always included.
    expect(visibleIds).toContain("project");
    expect(visibleIds).toContain("context");
    expect(visibleIds).toContain("apiTime");
    expect(visibleIds).toContain("usage");
    expect(visibleIds).toContain("cost");

    // Default OFF: promptCache, memory, duration, tools, agents, todos, environment
    expect(visibleIds).not.toContain("promptCache");
    expect(visibleIds).not.toContain("memory");
    expect(visibleIds).not.toContain("duration");
    expect(visibleIds).not.toContain("tools");
    expect(visibleIds).not.toContain("agents");
    expect(visibleIds).not.toContain("todos");
    expect(visibleIds).not.toContain("environment");
  });

  test("visibleWidgets respects showTools flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showTools = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("tools");
  });

  test("visibleWidgets respects showPromptCache flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showPromptCache = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("promptCache");
  });

  test("visibleWidgets respects showMemoryUsage flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showMemoryUsage = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("memory");
  });

  test("visibleWidgets respects showDuration flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showDuration = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("duration");
  });

  test("visibleWidgets respects showAgents flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showAgents = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("agents");
  });

  test("visibleWidgets respects showTodos flag", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showTodos = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("todos");
  });

  test("visibleWidgets respects showConfigCounts flag for environment", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.display.showConfigCounts = true;
    const visible = visibleWidgets(config);
    expect(visible.map((w) => w.id)).toContain("environment");
  });
});
