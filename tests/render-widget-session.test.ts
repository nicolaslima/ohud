// tests/render-widget-session.test.ts
import { test, expect, describe } from "bun:test";
import { renderSessionTimeCell } from "../src/render/widgets/session.js";
import type { ParsedTranscript } from "../src/types.js";

function makeTranscript(sessionStart: Date | undefined): ParsedTranscript {
  return {
    tools: [],
    agents: [],
    todos: [],
    assistantMessages: [],
    sessionStart,
  };
}

describe("renderSessionTimeCell", () => {
  test("null transcript → null", () => {
    expect(renderSessionTimeCell(null, Date.now())).toBeNull();
  });

  test("null sessionStart → null", () => {
    const t = makeTranscript(undefined);
    expect(renderSessionTimeCell(t, Date.now())).toBeNull();
  });

  test("elapsed=0 → '0:00'", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now));
    const cell = renderSessionTimeCell(t, now);
    expect(cell).not.toBeNull();
    expect(cell!.secondaryText).toBe("0:00");
  });

  test("elapsed=65s → '1:05'", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now - 65_000));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("1:05");
  });

  test("elapsed=3725s → '1:02:05'", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now - 3_725_000));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("1:02:05");
  });

  test("elapsed=-100 (clock skew) → '0:00'", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now + 100_000)); // sessionStart in the future
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("0:00");
  });

  test("cell has correct shape: primaryText, attention, group, priority", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now - 65_000));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.primaryText).toBe("session time");
    expect(cell!.attention).toBe("muted");
    expect(cell!.group).toBe("metrics");
    expect(cell!.priority).toBe(30);
  });

  test("M:SS format for sessions < 1h (e.g. 59m59s → '59:59')", () => {
    const now = Date.now();
    const elapsed = (59 * 60 + 59) * 1000; // 3599s
    const t = makeTranscript(new Date(now - elapsed));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("59:59");
  });

  test("H:MM:SS format for sessions >= 1h (no leading zero on hours)", () => {
    const now = Date.now();
    const elapsed = (2 * 3600 + 5 * 60 + 7) * 1000; // 2h5m7s
    const t = makeTranscript(new Date(now - elapsed));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("2:05:07");
  });

  test("exactly 1h → '1:00:00'", () => {
    const now = Date.now();
    const t = makeTranscript(new Date(now - 3_600_000));
    const cell = renderSessionTimeCell(t, now);
    expect(cell!.secondaryText).toBe("1:00:00");
  });
});
