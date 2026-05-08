// tests/memory.test.ts
import { test, expect } from "bun:test";
import { getMemoryUsage } from "../src/memory.js";

test("getMemoryUsage returns sane values", () => {
  const m = getMemoryUsage();
  expect(m.totalBytes).toBeGreaterThan(0);
  expect(m.usedBytes).toBeGreaterThan(0);
  expect(m.freeBytes).toBeGreaterThanOrEqual(0);
  expect(m.usedPercent).toBeGreaterThanOrEqual(0);
  expect(m.usedPercent).toBeLessThanOrEqual(100);
});
