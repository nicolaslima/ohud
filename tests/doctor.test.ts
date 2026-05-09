import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/doctor.js";

test("doctor produces version, runtime, mode, probe, config-flags sections", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toMatch(/ohud version:/);
  expect(out).toMatch(/runtime:/);
  expect(out).toMatch(/resolved bundle:/);
  expect(out).toMatch(/mode:/);
  expect(out).toMatch(/probe:/);
  expect(out).toMatch(/active config flags/);
});

// Task C: Active layout + Mode resolution lines

test("doctor shows 'Active layout: row' with default config", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toContain("Active layout: row");
});

test("doctor shows 'Active layout: hush' when configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ display: { layout: "hush" } }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toContain("Active layout: hush");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor shows Mode resolution line", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toMatch(/Mode resolution: model\.id=.+→/);
});

test("doctor shows Hush config summary when layout is hush", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ display: { layout: "hush" } }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toMatch(/Hush config: compactWhenIdle=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor does NOT show Hush config summary when layout is row", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).not.toMatch(/Hush config:/);
});
