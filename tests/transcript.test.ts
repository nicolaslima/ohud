// tests/transcript.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { parseTranscript, computeTokensPerSecond } from "../src/transcript.js";

const fx = (n: string) => join(import.meta.dir, "fixtures", n);

test("parses tool_use entries", async () => {
  const t = await parseTranscript(fx("transcript-typical.jsonl"));
  expect(t.tools).toHaveLength(1);
  expect(t.tools[0].name).toBe("Read");
  expect(t.tools[0].status).toBe("completed");
});

test("aggregates session tokens", async () => {
  const t = await parseTranscript(fx("transcript-typical.jsonl"));
  expect(t.sessionTokens?.inputTokens).toBe(100);
  expect(t.sessionTokens?.outputTokens).toBe(20);
});

test("extracts the latest TodoWrite snapshot", async () => {
  const t = await parseTranscript(fx("transcript-with-todos.jsonl"));
  expect(t.todos).toHaveLength(3);
  expect(t.todos[0].content).toBe("do A");
  expect(t.todos[0].status).toBe("in_progress");
});

test("returns empty data for nonexistent file", async () => {
  const t = await parseTranscript("/nonexistent/path.jsonl");
  expect(t.tools).toHaveLength(0);
  expect(t.todos).toHaveLength(0);
});

test("parseTranscript skips re-parse when stat is unchanged", async () => {
  const fixture = join(import.meta.dir, "fixtures/transcript-anthropic.jsonl");
  const t1 = await parseTranscript(fixture);
  const start = performance.now();
  const t2 = await parseTranscript(fixture);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(2); // cache hit should be ≤2ms
  expect(t2.tools).toEqual(t1.tools);
});

// --- Goal 1: Tool error detection ---

test("hasError=true when tool_result has is_error:true at top level", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const bashTool = t.tools.find((x) => x.name === "Bash");
  expect(bashTool).toBeDefined();
  expect(bashTool!.hasError).toBe(true);
});

test("hasError=true when tool_result content matches stderr-style error pattern", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  // Bash tool result is "Error: ENOENT no such file..." — matches both is_error AND pattern
  const bash = t.tools.find((x) => x.name === "Bash");
  expect(bash!.hasError).toBe(true);
});

test("hasError=true via content pattern alone (no is_error flag)", async () => {
  // Fixture has a single tool_result with content "exit code 127: command not found"
  // and no is_error field — exercises the content-regex path in isolation.
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-content-only-error.jsonl"));
  const bash = t.tools.find((x) => x.name === "Bash");
  expect(bash).toBeDefined();
  expect(bash!.hasError).toBe(true);
});

test("hasError stays undefined for successful tool_result", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-errors.jsonl"));
  const readTool = t.tools.find((x) => x.name === "Read");
  expect(readTool).toBeDefined();
  expect(readTool!.hasError).toBeUndefined();
  const writeTool = t.tools.find((x) => x.name === "Write");
  expect(writeTool).toBeDefined();
  expect(writeTool!.hasError).toBeUndefined();
});

// --- Goal 2: tokens/sec helper ---

test("computeTokensPerSecond returns null with 0 assistant messages", () => {
  const t = { tools: [], agents: [], todos: [], assistantMessages: [] };
  expect(computeTokensPerSecond(t)).toBeNull();
});

test("computeTokensPerSecond returns null with 1 assistant message", () => {
  const t = {
    tools: [], agents: [], todos: [],
    assistantMessages: [{ timestamp: new Date("2026-05-08T10:00:01.000Z"), outputTokens: 50 }],
  };
  expect(computeTokensPerSecond(t)).toBeNull();
});

test("computeTokensPerSecond returns null when elapsed < 1s", () => {
  const t = {
    tools: [], agents: [], todos: [],
    assistantMessages: [
      { timestamp: new Date("2026-05-08T10:00:01.000Z"), outputTokens: 100 },
      { timestamp: new Date("2026-05-08T10:00:01.500Z"), outputTokens: 200 },
    ],
  };
  expect(computeTokensPerSecond(t)).toBeNull();
});

test("computeTokensPerSecond returns expected integer for 2 messages with known tokens", () => {
  // 30 + 70 = 100 output tokens over 10 seconds = 10 tok/sec
  const t = {
    tools: [], agents: [], todos: [],
    assistantMessages: [
      { timestamp: new Date("2026-05-08T10:00:01.000Z"), outputTokens: 30 },
      { timestamp: new Date("2026-05-08T10:00:11.000Z"), outputTokens: 70 },
    ],
  };
  expect(computeTokensPerSecond(t)).toBe(10);
});

test("computeTokensPerSecond parses multi-assistant fixture correctly", async () => {
  const t = await parseTranscript(join(import.meta.dir, "fixtures/transcript-multi-assistant.jsonl"));
  // 30 + 70 = 100 tokens, elapsed = 10s → 10 tok/sec
  const tps = computeTokensPerSecond(t);
  expect(tps).toBe(10);
});
