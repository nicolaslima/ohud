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

test("doctor shows Daemon probe line", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toMatch(/Daemon probe: (ok|fail)/);
});

test("doctor shows Mode resolution rule (not a per-stdin claim)", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  // Rule-based output explains the resolver instead of claiming a specific result.
  expect(out).toMatch(/Mode resolution rule:/);
  expect(out).toContain('model.id starts with "claude-" → anthropic');
  expect(out).toContain("missing → daemon-probe fallback");
});

test("doctor does NOT use the old dummy-stdin Mode resolution format", async () => {
  // Old broken format: 'Mode resolution: model.id=(none) → ...' (always reported
  // daemon-probe path regardless of actual session). Should be gone.
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).not.toMatch(/Mode resolution: model\.id=\(none\)/);
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
