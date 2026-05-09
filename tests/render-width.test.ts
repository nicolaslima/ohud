import { test, expect } from "bun:test";
import { detectTerminalWidth, truncateLine, wcwidth } from "../src/render/width.js";

test("uses COLUMNS env when set", () => {
  expect(detectTerminalWidth({ COLUMNS: "120" }, null)).toBe(120);
});

test("falls back to maxWidth config", () => {
  expect(detectTerminalWidth({}, 100)).toBe(100);
});

test("falls back to 120 when nothing available", () => {
  expect(detectTerminalWidth({}, null)).toBe(120);
});

test("ignores invalid COLUMNS", () => {
  expect(detectTerminalWidth({ COLUMNS: "garbage" }, 90)).toBe(90);
});

test("wcwidth handles ohud's emoji glyphs as width-2", () => {
  expect(wcwidth("⚡")).toBe(2);
  expect(wcwidth("⏱")).toBe(2);
  expect(wcwidth("◐")).toBe(2);
  expect(wcwidth("█")).toBe(1);
  expect(wcwidth("│")).toBe(1);
});

test("truncateLine respects ANSI escape sequences", () => {
  const line = "\x1b[31mhello world\x1b[0m";
  expect(truncateLine(line, 6)).toMatch(/hello/);
  expect(truncateLine(line, 6).length).toBeLessThan(line.length);
});

test("truncateLine adds ellipsis when truncated", () => {
  const result = truncateLine("abcdefghij", 5);
  expect(result).toContain("…");
  expect(result.length).toBeLessThan(10);
});
