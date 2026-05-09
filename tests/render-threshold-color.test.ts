// tests/render-threshold-color.test.ts
// Tests for the applyThresholdColor helper in src/render/threshold-color.ts
import { test, expect, describe } from "bun:test";
import { applyThresholdColor } from "../src/render/threshold-color.js";

const THRESHOLDS = { warning: 60, danger: 75 };

// Helper: strip ANSI SGR codes to get raw text
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("applyThresholdColor", () => {
  test("below warning → input returned unchanged", () => {
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(59, input, THRESHOLDS, true);
    expect(result).toBe(input);
  });

  test("at warning boundary (==60) → still neutral (unchanged)", () => {
    const input = "\x1b[2mtext\x1b[22m";
    // value === warning → neutral, >= starts at warning+1 per our spec
    // Wait, spec says "above warning" for yellow. "value === thresholds.warning → still neutral"
    const result = applyThresholdColor(60, input, THRESHOLDS, true);
    expect(result).toBe(input);
  });

  test("just above warning (61) → yellow wrap", () => {
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(61, input, THRESHOLDS, true);
    expect(result).toBe(`\x1b[33m${input}\x1b[39m`);
  });

  test("at danger boundary (75) → red wrap", () => {
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(75, input, THRESHOLDS, true);
    expect(result).toBe(`\x1b[31m${input}\x1b[39m`);
  });

  test("above danger (100) → red wrap", () => {
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(100, input, THRESHOLDS, true);
    expect(result).toBe(`\x1b[31m${input}\x1b[39m`);
  });

  test("colorEnabled=false → input returned unchanged regardless of value", () => {
    const input = "\x1b[2mtext\x1b[22m";
    expect(applyThresholdColor(90, input, THRESHOLDS, false)).toBe(input);
    expect(applyThresholdColor(65, input, THRESHOLDS, false)).toBe(input);
    expect(applyThresholdColor(20, input, THRESHOLDS, false)).toBe(input);
  });

  test("NaN → neutral (input unchanged)", () => {
    const input = "\x1b[2mtext\x1b[22m";
    expect(applyThresholdColor(NaN, input, THRESHOLDS, true)).toBe(input);
  });

  test("Infinity → neutral (input unchanged)", () => {
    const input = "\x1b[2mtext\x1b[22m";
    expect(applyThresholdColor(Infinity, input, THRESHOLDS, true)).toBe(input);
  });

  test("negative value → neutral (input unchanged)", () => {
    const input = "\x1b[2mtext\x1b[22m";
    expect(applyThresholdColor(-5, input, THRESHOLDS, true)).toBe(input);
  });

  test("yellow wrap structure: color code OUTSIDE dim wrap", () => {
    // Expected: \x1b[33m\x1b[2mtext\x1b[22m\x1b[39m
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(65, input, THRESHOLDS, true);
    expect(result.startsWith("\x1b[33m")).toBe(true);
    expect(result.endsWith("\x1b[39m")).toBe(true);
    expect(result).toContain("\x1b[2m");
    expect(result).toContain("\x1b[22m");
    expect(stripAnsi(result)).toBe("text");
  });

  test("red wrap structure: color code OUTSIDE dim wrap", () => {
    const input = "\x1b[2mtext\x1b[22m";
    const result = applyThresholdColor(80, input, THRESHOLDS, true);
    expect(result.startsWith("\x1b[31m")).toBe(true);
    expect(result.endsWith("\x1b[39m")).toBe(true);
  });

  test("custom thresholds: warning=40, danger=50", () => {
    const thresholds = { warning: 40, danger: 50 };
    const input = "\x1b[2mx\x1b[22m";
    // below warning
    expect(applyThresholdColor(39, input, thresholds, true)).toBe(input);
    // at warning → neutral
    expect(applyThresholdColor(40, input, thresholds, true)).toBe(input);
    // above warning
    expect(applyThresholdColor(41, input, thresholds, true)).toBe(`\x1b[33m${input}\x1b[39m`);
    // at danger
    expect(applyThresholdColor(50, input, thresholds, true)).toBe(`\x1b[31m${input}\x1b[39m`);
  });
});
