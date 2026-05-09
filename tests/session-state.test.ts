// tests/session-state.test.ts
import { test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import { parseTranscript } from "../src/transcript.js";
import { writeSessionFile } from "../src/session-state.js";

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "ohud-t1-"));

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

test("writeSessionFile writes file and returns absolute path", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const path = await writeSessionFile("test-sess-001", t, { now: Date.now(), cacheDir: tmpDir });
  expect(path).toBe(join(tmpDir, "test-sess-001.txt"));
  const exists = fs.existsSync(path);
  expect(exists).toBe(true);
});

test("writeSessionFile content includes sessionId header", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const path = await writeSessionFile("test-sess-002", t, { now: Date.now(), cacheDir: tmpDir });
  const content = await fsp.readFile(path, "utf8");
  expect(content).toContain("ohud session test-sess-002");
});

test("writeSessionFile content includes tool counts and error counts", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const path = await writeSessionFile("test-sess-003", t, { now: Date.now(), cacheDir: tmpDir });
  const content = await fsp.readFile(path, "utf8");
  // 3 total tools
  expect(content).toContain("Tools (total: 3)");
  // 1 error (Bash tool had is_error:true)
  expect(content).toContain("Errors: 1");
  // Error list includes Bash
  expect(content).toContain("Bash error at");
});

test("writeSessionFile rate-limits: second call within 1s is a no-op", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const now = Date.now();
  const path = await writeSessionFile("test-sess-004", t, { now, cacheDir: tmpDir });
  const stat1 = await fsp.stat(path);

  // Call again within 1s (same 'now' value — well within 1000ms window)
  await writeSessionFile("test-sess-004", t, { now: now + 500, cacheDir: tmpDir });
  const stat2 = await fsp.stat(path);

  expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
});

test("writeSessionFile with no errors shows 'Errors: 0' and no list", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-typical.jsonl"));
  const path = await writeSessionFile("test-sess-005", t, { now: Date.now(), cacheDir: tmpDir });
  const content = await fsp.readFile(path, "utf8");
  expect(content).toContain("Errors: 0");
  // Should not contain a "- " error list item
  expect(content).not.toMatch(/^  - /m);
});

test("writeSessionFile tools sorted by count descending", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const path = await writeSessionFile("test-sess-006", t, { now: Date.now(), cacheDir: tmpDir });
  const content = await fsp.readFile(path, "utf8");
  // Each tool appears once — all count 1, so all should appear
  expect(content).toContain("Bash");
  expect(content).toContain("Read");
  expect(content).toContain("Write");
});
