// tests/prompt-cache.test.ts
import { test, expect } from "bun:test";
import { promptCacheRemainingMs, formatPromptCache } from "../src/prompt-cache.js";

test("returns null when no last response", () => {
  expect(promptCacheRemainingMs(undefined, 300, () => Date.now())).toBeNull();
});

test("computes remaining within TTL", () => {
  const last = new Date("2026-05-08T15:00:00Z");
  const now = () => Date.parse("2026-05-08T15:02:00Z");
  expect(promptCacheRemainingMs(last, 300, now)).toBe(180_000);
});

test("returns 0 when expired", () => {
  const last = new Date("2026-05-08T15:00:00Z");
  const now = () => Date.parse("2026-05-08T15:10:00Z");
  expect(promptCacheRemainingMs(last, 300, now)).toBe(0);
});

test("formats minutes:seconds", () => {
  expect(formatPromptCache(180_000)).toBe("3m 0s");
  expect(formatPromptCache(45_000)).toBe("45s");
  expect(formatPromptCache(0)).toBe("expired");
});
