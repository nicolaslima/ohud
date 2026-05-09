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

// Task C review I3: configure command preservation invariant
// The configure command writes ONLY .display.layout via jq's path-assignment.
// loadConfig's deepMerge MUST then preserve any existing display.hush.* keys.

test("hush.compactWhenIdle override survives a layout switch (read-back)", async () => {
  // User has previously customized hush.compactWhenIdle=false; configure
  // toggles layout from "hush" to "row" by writing only .display.layout.
  // The on-disk config still contains hush.compactWhenIdle=false.
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { layout: "row", hush: { compactWhenIdle: false } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.layout).toBe("row");
  expect(c.display.hush?.compactWhenIdle).toBe(false);
  // Other hush defaults still present (deepMerge fills them in).
  expect(c.display.hush?.hyperlinks).toBe(true);
  expect(c.display.hush?.animate).toBe(true);
});

test("hush.hyperlinks=false survives layout=hush + custom toggles together", async () => {
  // Simulates the on-disk config after a configure run where the user kept
  // their hush sub-fields and only changed layout.
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { layout: "hush", hush: { hyperlinks: false, animate: true, compactWhenIdle: true } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.hyperlinks).toBe(false);
  expect(c.display.hush?.animate).toBe(true);
  expect(c.display.hush?.compactWhenIdle).toBe(true);
});

test("hush.thresholds override survives in loaded config", async () => {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    display: { layout: "hush", hush: { thresholds: { warning: 70, danger: 90 } } },
  }));
  const c = await loadConfig(join(dir, "config.json"));
  expect(c.display.hush?.thresholds?.warning).toBe(70);
  expect(c.display.hush?.thresholds?.danger).toBe(90);
});

// Task 6: parse-error logging

test("parse error is written to last-errors.log when JSON is invalid", async () => {
  const { existsSync, readFileSync, rmSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const errLogPath = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  // Remove log so we can confirm a fresh entry is written
  try { rmSync(errLogPath); } catch { /* ok if not found */ }

  writeFileSync(join(dir, "config.json"), "{not valid json");
  await loadConfig(join(dir, "config.json"));

  expect(existsSync(errLogPath)).toBe(true);
  const logContent = readFileSync(errLogPath, "utf8");
  expect(logContent).toMatch(/parse error:/);
});

test("parse error log contains config file path", async () => {
  const { readFileSync, rmSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const errLogPath = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  try { rmSync(errLogPath); } catch { /* ok */ }

  const cfgPath = join(dir, "config.json");
  writeFileSync(cfgPath, "{broken");
  await loadConfig(cfgPath);

  const logContent = readFileSync(errLogPath, "utf8");
  expect(logContent).toContain(cfgPath);
});

test("no parse error log entry when config is valid JSON", async () => {
  const { existsSync, rmSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const errLogPath = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  try { rmSync(errLogPath); } catch { /* ok */ }

  writeFileSync(join(dir, "config.json"), JSON.stringify({ display: { layout: "hush" } }));
  await loadConfig(join(dir, "config.json"));

  // If log was created by other tests, it shouldn't contain a parse error from this call.
  // We verify by checking whether the log was touched at all (it shouldn't exist since we removed it).
  expect(existsSync(errLogPath)).toBe(false);
});
