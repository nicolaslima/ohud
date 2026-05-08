// tests/usage.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { fromStdin, fromExternalSnapshot } from "../src/usage.js";
import type { StdinData } from "../src/types.js";

test("fromStdin returns null when rate_limits absent", () => {
  const stdin: StdinData = {};
  expect(fromStdin(stdin)).toBeNull();
});

test("fromStdin parses populated rate_limits", () => {
  const stdin: StdinData = { rate_limits: {
    five_hour: { used_percentage: 25, resets_at: 1738425600 },
    seven_day: { used_percentage: 41, resets_at: 1738857600 },
  }};
  const u = fromStdin(stdin);
  expect(u?.fiveHour).toBe(25);
  expect(u?.sevenDay).toBe(41);
  expect(u?.fiveHourResetAt).toBeInstanceOf(Date);
});

test("fromExternalSnapshot parses fixture", async () => {
  const path = join(import.meta.dir, "fixtures/external-usage-snapshot.json");
  const u = await fromExternalSnapshot(path, 86_400_000, () => Date.parse("2026-05-08T15:01:00Z"));
  expect(u?.fiveHour).toBe(42);
  expect(u?.sevenDay).toBe(84);
});

test("fromExternalSnapshot returns null when stale", async () => {
  const path = join(import.meta.dir, "fixtures/external-usage-snapshot.json");
  const farFuture = Date.parse("2030-01-01T00:00:00Z");
  const u = await fromExternalSnapshot(path, 60_000, () => farFuture);
  expect(u).toBeNull();
});

test("fromExternalSnapshot returns null when path empty", async () => {
  const u = await fromExternalSnapshot("", 60_000, () => Date.now());
  expect(u).toBeNull();
});
