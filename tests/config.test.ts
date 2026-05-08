// tests/config.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ohud-cfg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("returns defaults when file missing", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.lineLayout).toBe("expanded");
  expect(c.display.showApiTime).toBe(true);
  expect(c.gitStatus.enabled).toBe(true);
});

test("merges user values over defaults", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    pathLevels: 2,
    display: { showCost: true, showTools: true },
    colors: { context: "cyan" },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.pathLevels).toBe(2);
  expect(c.display.showCost).toBe(true);
  expect(c.display.showTools).toBe(true);
  expect(c.display.showApiTime).toBe(true); // default preserved
  expect(c.colors.context).toBe("cyan");
});

test("falls back to defaults on invalid JSON", async () => {
  writeFileSync(join(dir, "config.json"), "{not json");
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.lineLayout).toBe("expanded");
});
