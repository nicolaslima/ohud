// tests/render-colors.test.ts
import { test, expect } from "bun:test";
import { color, RESET } from "../src/render/colors.js";

test("named colors emit known ANSI codes", () => {
  expect(color("red", "x")).toBe(`\x1b[31mx${RESET}`);
  expect(color("green", "y")).toBe(`\x1b[32my${RESET}`);
});

test("256-color number", () => {
  expect(color("208", "z")).toBe(`\x1b[38;5;208mz${RESET}`);
});

test("hex color", () => {
  expect(color("#ff8800", "w")).toBe(`\x1b[38;2;255;136;0mw${RESET}`);
});

test("unknown color returns plain text", () => {
  expect(color("bogus", "p")).toBe("p");
});
