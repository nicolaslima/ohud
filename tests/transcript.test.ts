// tests/transcript.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { parseTranscript } from "../src/transcript.js";

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
