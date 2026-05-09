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

test("loadConfig returns isolated arrays — push does not leak to DEFAULT_CONFIG", async () => {
  const { DEFAULT_CONFIG, loadConfig } = await import("../src/config.js");
  const c1 = await loadConfig("/tmp/nonexistent-ohud-config.json") as any;
  c1.elementOrder.push("INJECTED");
  c1.display.mergeGroups.push(["INJECTED"]);
  expect(DEFAULT_CONFIG.elementOrder).not.toContain("INJECTED");
  expect(DEFAULT_CONFIG.display.mergeGroups.flat()).not.toContain("INJECTED");
});

// Task C: display.layout + display.hush defaults

test("default display.layout is 'row'", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.layout).toBe("row");
});

test("default display.hush.compactWhenIdle is true", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.compactWhenIdle).toBe(true);
});

test("default display.hush.hyperlinks is true", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.hyperlinks).toBe(true);
});

test("default display.hush.animate is true", async () => {
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.animate).toBe(true);
});

test("user override display.layout='hush' is honored", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({ display: { layout: "hush" } }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.layout).toBe("hush");
});

test("user override display.hush.compactWhenIdle=false is honored", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { layout: "hush", hush: { compactWhenIdle: false } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.compactWhenIdle).toBe(false);
});

test("user override display.hush.hyperlinks=false is honored", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { hush: { hyperlinks: false } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.hyperlinks).toBe(false);
});

test("user override display.hush.animate=false is honored", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { hush: { animate: false } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.animate).toBe(false);
});

test("config without display.layout resolves to 'row' (backwards compat)", async () => {
  // Simulates a pre-Task-C config file that has no display.layout field
  writeFileSync(join(dir, "config.json"), JSON.stringify({ display: { showCost: true } }));
  const c = await loadConfig(join(dir, "config.json"));
  // display.layout defaults to "row" even when not in the file
  expect(c.display.layout).toBe("row");
});
