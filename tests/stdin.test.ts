// tests/stdin.test.ts
import { test, expect } from "bun:test";
import { Readable } from "node:stream";
import { readStdin } from "../src/stdin.js";

function streamFrom(s: string) {
  const r = Readable.from([s]);
  // readStdin expects a stream-like object with setEncoding/on/off/pause/isTTY
  return Object.assign(r, { isTTY: false });
}

test("readStdin parses well-formed JSON", async () => {
  const result = await readStdin(streamFrom('{"session_id":"abc","model":{"id":"glm-5:cloud"}}') as never);
  expect(result?.session_id).toBe("abc");
  expect(result?.model?.id).toBe("glm-5:cloud");
});

test("readStdin returns null on TTY (no piped input)", async () => {
  const tty = Object.assign(Readable.from([""]), { isTTY: true });
  const result = await readStdin(tty as never);
  expect(result).toBeNull();
});

test("readStdin returns null on invalid JSON", async () => {
  const result = await readStdin(streamFrom("{not json") as never);
  expect(result).toBeNull();
});

test("readStdin handles empty input", async () => {
  const result = await readStdin(streamFrom("") as never);
  expect(result).toBeNull();
});
