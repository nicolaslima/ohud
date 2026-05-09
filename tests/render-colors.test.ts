// tests/render-colors.test.ts
import { test, expect } from "bun:test";
import { color, isColorDisabled, RESET } from "../src/render/colors.js";

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

test("color() returns plain text when NO_COLOR env is set", () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try { expect(color("red", "x")).toBe("x"); }
  finally { if (orig === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = orig; }
});

test("color() returns plain text when TERM is dumb", () => {
  const orig = process.env.TERM;
  process.env.TERM = "dumb";
  try { expect(color("red", "x")).toBe("x"); }
  finally { if (orig === undefined) delete process.env.TERM; else process.env.TERM = orig; }
});

// isColorDisabled — shared source of truth tests
test("isColorDisabled returns true when NO_COLOR set in injected env", () => {
  expect(isColorDisabled({ NO_COLOR: "1" })).toBe(true);
});

test("isColorDisabled returns true when TERM=dumb in injected env", () => {
  expect(isColorDisabled({ TERM: "dumb" })).toBe(true);
});

test("isColorDisabled returns false when env is empty", () => {
  expect(isColorDisabled({})).toBe(false);
});
