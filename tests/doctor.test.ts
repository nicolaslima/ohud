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

// Task 3: layout-aware flag classification

test("doctor classifies showCost as 'consumed in row' when layout=row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ display: { layout: "row", showCost: true } }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toContain("(consumed in row)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor classifies showCost as 'silenced — wrong layout' when layout=hush and showCost=true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ display: { layout: "hush", showCost: true } }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toContain("(silenced — wrong layout)");
    expect(out).toContain("⚠ display.showCost");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor classifies layout flag as 'consumed in both'", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toContain("(consumed in both)");
});

test("doctor does NOT use static DEAD FLAG label anymore", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).not.toContain("DEAD FLAG");
});

test("doctor shows explicit warning for silenced flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({ display: { layout: "hush", showCost: true } }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toMatch(/⚠ display\.showCost: true but layout=hush silences this flag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor classifies showModel as 'consumed in both' (used by both layouts)", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  // showModel is used in both row and hush — should be annotated as such
  const match = out.match(/display\.showModel: [^\(]+\(([^)]+)\)/);
  expect(match?.[1]).toBe("consumed in both");
});

// ── T5: Prose preview, threshold swatch, icon swatch, legacy-knob lints ──────

// Doctor is called with layout=hush to trigger the prose preview section.
async function hushDoctorOut(extraCfg?: Record<string, unknown>): Promise<string> {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-t5-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({
      display: { layout: "hush", ...(extraCfg ?? {}) },
    }));
    return await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Prose preview ────────────────────────────────────────────────────────────

test("doctor shows prose preview header for 160 cols when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Prose preview (anthropic, 160 cols)");
});

test("doctor shows prose preview header for 80 cols when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Prose preview (anthropic, 80 cols)");
});

test("doctor shows prose preview header for 40 cols when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Prose preview (anthropic, 40 cols)");
});

test("doctor shows ollama prose preview at 160 cols when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Prose preview (ollama, 160 cols)");
});

test("prose preview lines contain 'ohud' as project name", async () => {
  const out = await hushDoctorOut();
  // Strip ANSI and check the 160-col anthropic preview line contains "ohud"
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toContain("ohud");
});

test("prose preview lines contain 'develop' as branch", async () => {
  const out = await hushDoctorOut();
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toContain("develop");
});

test("prose preview contains context percentage", async () => {
  const out = await hushDoctorOut();
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toMatch(/24%/);
});

// ── Threshold swatch ─────────────────────────────────────────────────────────

test("doctor shows Thresholds swatch section when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Thresholds:");
});

test("threshold swatch shows neutral context at 30%", async () => {
  const out = await hushDoctorOut();
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toMatch(/context 30% used/);
});

test("threshold swatch shows warning context at 65%", async () => {
  const out = await hushDoctorOut();
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toMatch(/context 65% used/);
});

test("threshold swatch shows danger context at 80%", async () => {
  const out = await hushDoctorOut();
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toMatch(/context 80% used/);
});

test("threshold swatch labels neutral/warning/danger", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("(neutral)");
  expect(out).toContain("(warning)");
  expect(out).toContain("(danger)");
});

// ── Icon swatch ──────────────────────────────────────────────────────────────

test("doctor shows Icon swatch section when layout=hush", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("Icon swatch:");
});

test("icon swatch shows all three glyph tiers", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("unicode");
  expect(out).toContain("ascii");
  expect(out).toContain("nerd");
});

test("icon swatch shows auto resolution", async () => {
  const out = await hushDoctorOut();
  expect(out).toContain("auto");
});

// ── Legacy-knob lints ────────────────────────────────────────────────────────

test("doctor lints lineLayout='expanded' with prose-layout recommendation", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-t5-lint-"));
  try {
    const cfgPath = join(dir, "config.json");
    // lineLayout is a top-level field; combine with hush layout
    writeFileSync(cfgPath, JSON.stringify({
      lineLayout: "expanded",
      display: { layout: "hush" },
    }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).toContain('LINT: lineLayout="expanded"');
    expect(out).toContain("legacy card layout");
    expect(out).toContain('lineLayout="compact"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor lints identityColors=true with prose-layout no-effect notice", async () => {
  const out = await hushDoctorOut({ hush: { identityColors: true } });
  expect(out).toContain("LINT: display.hush.identityColors=true");
  expect(out).toContain("no effect");
});

test("doctor does NOT emit lineLayout lint when lineLayout='compact'", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ohud-doc-t5-lint-ok-"));
  try {
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify({
      lineLayout: "compact",
      display: { layout: "hush" },
    }));
    const out = await runDoctor({ host: "http://localhost:11434", configPath: cfgPath });
    expect(out).not.toContain('LINT: lineLayout="expanded"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor does NOT emit identityColors lint when identityColors=false", async () => {
  const out = await hushDoctorOut({ hush: { identityColors: false } });
  expect(out).not.toContain("LINT: display.hush.identityColors=true");
});
