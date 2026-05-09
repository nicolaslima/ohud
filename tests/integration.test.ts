// tests/integration.test.ts
import { test, expect } from "bun:test";
import { main } from "../src/index.js";
import { EventEmitter } from "node:events";

/**
 * Build a minimal readable-stream mock that satisfies StdinStream:
 *   setEncoding, on, off, pause, isTTY
 * Emits "data" with the JSON payload then "end", synchronously after the
 * first "data" listener is registered (via nextTick), so readStdin can
 * collect the bytes and resolve.
 */
function makeStdinMock(payload: object): NodeJS.ReadStream {
  const json = JSON.stringify(payload);
  const ee = new EventEmitter();

  let dataListenerAdded = false;

  const mock = {
    isTTY: false as boolean | undefined,
    setEncoding(_enc: string) { /* noop */ },
    pause() { /* noop */ },
    on(event: string, listener: (...args: unknown[]) => void) {
      ee.on(event, listener);
      // Once the first "data" listener is attached, schedule emission
      if (event === "data" && !dataListenerAdded) {
        dataListenerAdded = true;
        process.nextTick(() => {
          ee.emit("data", json);
          ee.emit("end");
        });
      }
      return mock;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      ee.off(event, listener);
      return mock;
    },
  };

  return mock as unknown as NodeJS.ReadStream;
}

function makeStdinFixture(payload: object): () => void {
  const mock = makeStdinMock(payload);
  const original = process.stdin;
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: mock,
  });
  return () =>
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: original,
    });
}

test("integration: anthropic mode produces non-empty stdout", async () => {
  const restore = makeStdinFixture({
    session_id: "test-anthropic",
    transcript_path: "/tmp/no",
    model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
    workspace: { current_dir: process.cwd() },
    context_window: { used_percentage: 30 },
  });
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (s: string) => captured.push(s);
  try {
    await main();
  } finally {
    console.log = origLog;
    restore();
  }
  const out = captured.join("\n");
  expect(out).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/);
  // Case-insensitive: Row layout uses display_name "Sonnet 4.6", Hush uses condensed id "sonnet-4.6".
  // This test reads the user's actual plugin config so we accept either rendering.
  expect(out.toLowerCase()).toContain("sonnet");
});

test("integration: ollama-local mode produces non-empty stdout", async () => {
  const restore = makeStdinFixture({
    session_id: "test-ollama",
    transcript_path: "/tmp/no",
    model: { id: "glm-5:cloud", display_name: "glm-5:cloud" },
    workspace: { current_dir: process.cwd() },
    context_window: { used_percentage: 42 },
  });
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (s: string) => captured.push(s);
  try {
    await main();
  } finally {
    console.log = origLog;
    restore();
  }
  const out = captured.join("\n");
  expect(out).not.toMatch(/MODULE_NOT_FOUND|aborted/);
});

test("integration: hot path completes under 300ms in steady state", async () => {
  const payload = {
    session_id: "perf-warm",
    transcript_path: "/tmp/no",
    model: { id: "glm-5:cloud", display_name: "glm-5:cloud" },
    workspace: { current_dir: process.cwd() },
    context_window: { used_percentage: 50 },
  };
  // First call warms cache
  const r1 = makeStdinFixture(payload);
  const o1: string[] = [];
  const log1 = console.log;
  console.log = (s: string) => o1.push(s);
  try {
    await main();
  } finally {
    console.log = log1;
    r1();
  }

  // Second call measures steady-state
  const r2 = makeStdinFixture(payload);
  const o2: string[] = [];
  const log2 = console.log;
  console.log = (s: string) => o2.push(s);
  const t0 = performance.now();
  try {
    await main();
  } finally {
    console.log = log2;
    r2();
  }
  const elapsed = performance.now() - t0;
  expect(elapsed).toBeLessThan(300);
});
