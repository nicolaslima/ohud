// tests/render-thresholds.test.ts
import { test, expect } from "bun:test";
import { barColorForPercent } from "../src/render/thresholds.js";

const palette = { default: "d", warning: "w", critical: "c" };

test("barColorForPercent — 0% returns default", () => {
  expect(barColorForPercent(0, palette)).toBe("d");
});

test("barColorForPercent — 59% returns default (just below warning)", () => {
  expect(barColorForPercent(59, palette)).toBe("d");
});

test("barColorForPercent — 60% returns warning (boundary inclusive)", () => {
  expect(barColorForPercent(60, palette)).toBe("w");
});

test("barColorForPercent — 74% returns warning (just below critical)", () => {
  expect(barColorForPercent(74, palette)).toBe("w");
});

test("barColorForPercent — 75% returns critical (boundary inclusive)", () => {
  expect(barColorForPercent(75, palette)).toBe("c");
});

test("barColorForPercent — 100% returns critical", () => {
  expect(barColorForPercent(100, palette)).toBe("c");
});

test("barColorForPercent — custom thresholds, 50% with warning=40 returns warning", () => {
  expect(barColorForPercent(50, palette, { warning: 40, critical: 60 })).toBe("w");
});

test("barColorForPercent — custom thresholds, 60% with critical=60 returns critical (inclusive)", () => {
  expect(barColorForPercent(60, palette, { warning: 40, critical: 60 })).toBe("c");
});
