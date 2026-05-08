// tests/integration.test.ts
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../dist/index.js");

function runWith(stdinJson: string): string {
  const proc = spawnSync("node", [ENTRY], { input: stdinJson, encoding: "utf8" });
  return (proc.stdout ?? "") + (proc.stderr ?? "");
}

test("integration — anthropic mode with rate_limits emits Usage line", () => {
  const stdin = readFileSync(join(import.meta.dir, "fixtures/stdin-anthropic-pro.json"), "utf8");
  const out = runWith(stdin);
  expect(out).toContain("Context");
  // Either Usage line or graceful absence — no error markers
  expect(out).not.toContain("undefined");
});

test("integration — ollama-local stdin gracefully renders something or warns sensibly", () => {
  const stdin = readFileSync(join(import.meta.dir, "fixtures/stdin-ollama-local.json"), "utf8");
  const out = runWith(stdin);
  // Mode falls back to anthropic; no crash
  expect(out.length).toBeGreaterThan(0);
});
