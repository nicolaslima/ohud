// tests/render-widget-errors.test.ts
import { test, expect, describe } from "bun:test";
import { renderErrorCountCell } from "../src/render/widgets/errors.js";
import type { ParsedTranscript, ToolEntry } from "../src/types.js";

function makeTranscript(tools: Partial<ToolEntry>[]): ParsedTranscript {
  const fullTools: ToolEntry[] = tools.map((t, i) => ({
    id: t.id ?? `tool-${i}`,
    name: t.name ?? "Bash",
    status: t.status ?? "completed",
    startTime: t.startTime ?? new Date(),
    hasError: t.hasError,
  }));
  return {
    tools: fullTools,
    agents: [],
    todos: [],
    assistantMessages: [],
  };
}

describe("renderErrorCountCell", () => {
  test("null transcript → null", () => {
    expect(renderErrorCountCell(null)).toBeNull();
  });

  test("zero tools → null", () => {
    const t = makeTranscript([]);
    expect(renderErrorCountCell(t)).toBeNull();
  });

  test("tools with no errors (hasError undefined/false) → null", () => {
    const t = makeTranscript([
      { name: "Read", status: "completed" },
      { name: "Edit", status: "completed" },
    ]);
    expect(renderErrorCountCell(t)).toBeNull();
  });

  test("one error → cell with text 'errors 1'", () => {
    const t = makeTranscript([
      { name: "Bash", status: "completed", hasError: true },
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("errors 1");
  });

  test("one error → attention: 'warning'", () => {
    const t = makeTranscript([
      { name: "Bash", status: "completed", hasError: true },
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell!.attention).toBe("warning");
  });

  test("two errors → attention: 'warning'", () => {
    const t = makeTranscript([
      { name: "Bash", status: "completed", hasError: true },
      { name: "Bash", status: "completed", hasError: true },
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell!.attention).toBe("warning");
    expect(cell!.text).toBe("errors 2");
  });

  test("three errors → attention: 'danger'", () => {
    const t = makeTranscript([
      { name: "Bash", status: "completed", hasError: true },
      { name: "Bash", status: "completed", hasError: true },
      { name: "Bash", status: "completed", hasError: true },
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell!.attention).toBe("danger");
    expect(cell!.text).toBe("errors 3");
  });

  test("five errors → attention: 'danger'", () => {
    const t = makeTranscript(Array.from({ length: 5 }, () => ({
      name: "Bash",
      status: "completed" as const,
      hasError: true,
    })));
    const cell = renderErrorCountCell(t);
    expect(cell!.attention).toBe("danger");
    expect(cell!.text).toBe("errors 5");
  });

  test("cell shape: group metrics, priority 35", () => {
    const t = makeTranscript([
      { name: "Bash", status: "completed", hasError: true },
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell!.group).toBe("metrics");
    expect(cell!.priority).toBe(35);
  });

  test("mixed tools: only hasError===true counted", () => {
    const t = makeTranscript([
      { name: "Read", status: "completed" },               // no error
      { name: "Bash", status: "completed", hasError: true }, // error
      { name: "Edit", status: "completed" },               // no error
    ]);
    const cell = renderErrorCountCell(t);
    expect(cell!.text).toBe("errors 1");
  });
});
