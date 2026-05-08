import { test, expect } from "bun:test";
import { detectTerminalWidth } from "../src/render/width.js";

test("uses COLUMNS env when set", () => {
  expect(detectTerminalWidth({ COLUMNS: "120" }, null)).toBe(120);
});

test("falls back to maxWidth config", () => {
  expect(detectTerminalWidth({}, 100)).toBe(100);
});

test("falls back to 80 when nothing available", () => {
  expect(detectTerminalWidth({}, null)).toBe(80);
});

test("ignores invalid COLUMNS", () => {
  expect(detectTerminalWidth({ COLUMNS: "garbage" }, 90)).toBe(90);
});
