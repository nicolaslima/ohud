// tests/render-widget-tokens.test.ts
import { test, expect, describe } from "bun:test";
import { renderTokensPerSecCell } from "../src/render/widgets/tokens.js";
import type { ParsedTranscript } from "../src/types.js";

function makeTranscript(msgs: Array<{ timestamp: Date; outputTokens: number }>): ParsedTranscript {
  return {
    tools: [],
    agents: [],
    todos: [],
    assistantMessages: msgs,
  };
}

describe("renderTokensPerSecCell", () => {
  test("null transcript → null", () => {
    expect(renderTokensPerSecCell(null)).toBeNull();
  });

  test("empty assistantMessages (computeTokensPerSecond returns null) → null", () => {
    const t = makeTranscript([]);
    expect(renderTokensPerSecCell(t)).toBeNull();
  });

  test("single assistant message → null (computeTokensPerSecond needs ≥2)", () => {
    const t = makeTranscript([
      { timestamp: new Date("2026-05-08T10:00:00.000Z"), outputTokens: 50 },
    ]);
    expect(renderTokensPerSecCell(t)).toBeNull();
  });

  test("elapsed < 1s → null", () => {
    const t = makeTranscript([
      { timestamp: new Date("2026-05-08T10:00:00.000Z"), outputTokens: 100 },
      { timestamp: new Date("2026-05-08T10:00:00.500Z"), outputTokens: 200 },
    ]);
    expect(renderTokensPerSecCell(t)).toBeNull();
  });

  test("two messages with 10 tok/s → cell text '10 tks/s'", () => {
    const t = makeTranscript([
      { timestamp: new Date("2026-05-08T10:00:00.000Z"), outputTokens: 30 },
      { timestamp: new Date("2026-05-08T10:00:10.000Z"), outputTokens: 70 },
    ]);
    const cell = renderTokensPerSecCell(t);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("10 tks/s");
  });

  test("cell shape: attention muted, group metrics, priority 20", () => {
    const t = makeTranscript([
      { timestamp: new Date("2026-05-08T10:00:00.000Z"), outputTokens: 50 },
      { timestamp: new Date("2026-05-08T10:00:05.000Z"), outputTokens: 50 },
    ]);
    const cell = renderTokensPerSecCell(t);
    expect(cell!.attention).toBe("muted");
    expect(cell!.group).toBe("metrics");
    expect(cell!.priority).toBe(20);
  });

  test("integer value in output (no decimal point)", () => {
    const t = makeTranscript([
      { timestamp: new Date("2026-05-08T10:00:00.000Z"), outputTokens: 33 },
      { timestamp: new Date("2026-05-08T10:00:03.000Z"), outputTokens: 67 },
    ]);
    const cell = renderTokensPerSecCell(t);
    // 100 / 3 = 33.33... → rounded to 33
    expect(cell!.text).toBe("33 tks/s");
    expect(cell!.text).not.toContain(".");
  });
});
