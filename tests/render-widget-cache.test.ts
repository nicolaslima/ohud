// tests/render-widget-cache.test.ts
import { test, expect, describe } from "bun:test";
import { renderCacheCell } from "../src/render/widgets/cache.js";
import type { StdinData } from "../src/types.js";

function makeStdin(opts: {
  inputTokens?: number;
  cacheCreation?: number;
  cacheRead?: number;
}): StdinData {
  return {
    context_window: {
      current_usage: {
        input_tokens: opts.inputTokens ?? 0,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  };
}

describe("renderCacheCell", () => {
  test("zero cache_creation + zero cache_read → null", () => {
    const stdin = makeStdin({ inputTokens: 1000, cacheCreation: 0, cacheRead: 0 });
    expect(renderCacheCell(stdin)).toBeNull();
  });

  test("absent current_usage → null", () => {
    const stdin: StdinData = { context_window: {} };
    expect(renderCacheCell(stdin)).toBeNull();
  });

  test("absent context_window → null", () => {
    const stdin: StdinData = {};
    expect(renderCacheCell(stdin)).toBeNull();
  });

  test("reasonable hit ratio: 800 read / 1000 total → 80% hit", () => {
    // total = 100 (input) + 100 (creation) + 800 (read) = 1000
    const stdin = makeStdin({ inputTokens: 100, cacheCreation: 100, cacheRead: 800 });
    const cell = renderCacheCell(stdin);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("cache 80% hit");
  });

  test("only cache_creation > 0 (no read) → not null but 0% hit", () => {
    // creation > 0 so not filtered; read=0 → 0%
    const stdin = makeStdin({ inputTokens: 500, cacheCreation: 300, cacheRead: 0 });
    const cell = renderCacheCell(stdin);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("cache 0% hit");
  });

  test("only cache_read > 0 → not null", () => {
    const stdin = makeStdin({ inputTokens: 500, cacheCreation: 0, cacheRead: 400 });
    const cell = renderCacheCell(stdin);
    expect(cell).not.toBeNull();
  });

  test("cell shape: attention muted, group metrics, priority 25", () => {
    const stdin = makeStdin({ inputTokens: 100, cacheCreation: 50, cacheRead: 750 });
    const cell = renderCacheCell(stdin);
    expect(cell!.attention).toBe("muted");
    expect(cell!.group).toBe("metrics");
    expect(cell!.priority).toBe(25);
  });

  test("integer percent (no decimal): 333/1000 → 33%", () => {
    // total = 0 + 667 + 333 = 1000; hit = 333/1000 = 33.3% → 33%
    const stdin = makeStdin({ inputTokens: 0, cacheCreation: 667, cacheRead: 333 });
    const cell = renderCacheCell(stdin);
    expect(cell!.text).toBe("cache 33% hit");
  });

  test("100% hit ratio when input_tokens=0 and creation=0", () => {
    const stdin = makeStdin({ inputTokens: 0, cacheCreation: 0, cacheRead: 500 });
    const cell = renderCacheCell(stdin);
    // total = 500, read = 500 → 100%
    expect(cell!.text).toBe("cache 100% hit");
  });

  test("clamps ratio to [0, 1] for malformed payloads (negative input_tokens)", () => {
    // total = -50 + 0 + 200 = 150; read/total = 200/150 = 1.33 → must clamp to 100%
    const stdin = makeStdin({ inputTokens: -50, cacheCreation: 0, cacheRead: 200 });
    const cell = renderCacheCell(stdin);
    expect(cell).not.toBeNull();
    expect(cell!.text).toBe("cache 100% hit");
  });
});
