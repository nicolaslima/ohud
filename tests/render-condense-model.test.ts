// tests/render-condense-model.test.ts
// Focused tests for condenseModelId — context-window suffix stripping + prefix normalization.
import { test, expect, describe } from "bun:test";
import { condenseModelId } from "../src/render/widgets/project.js";

describe("condenseModelId — context-window suffix stripping", () => {
  test("claude-opus-4-7-1m → opus-4.7", () => {
    expect(condenseModelId("claude-opus-4-7-1m")).toBe("opus-4.7");
  });

  test("opus-4.7[1m] → opus-4.7", () => {
    expect(condenseModelId("opus-4.7[1m]")).toBe("opus-4.7");
  });

  test("claude-haiku-4-5-200k → haiku-4.5", () => {
    expect(condenseModelId("claude-haiku-4-5-200k")).toBe("haiku-4.5");
  });

  test("claude-opus-4-7 (no suffix) → opus-4.7", () => {
    expect(condenseModelId("claude-opus-4-7")).toBe("opus-4.7");
  });

  test("claude-sonnet-4-6-20k → sonnet-4.6", () => {
    expect(condenseModelId("claude-sonnet-4-6-20k")).toBe("sonnet-4.6");
  });

  test("claude-haiku-4-5[200k] → haiku-4.5", () => {
    expect(condenseModelId("claude-haiku-4-5[200k]")).toBe("haiku-4.5");
  });

  test("empty string → empty string", () => {
    expect(condenseModelId("")).toBe("");
  });
});

describe("condenseModelId — prefix normalization", () => {
  test("strips claude- prefix", () => {
    expect(condenseModelId("claude-opus-4-7")).toBe("opus-4.7");
  });

  test("strips claude space prefix (display_name style)", () => {
    expect(condenseModelId("Claude Opus 4.7")).toBe("opus 4.7");
  });

  test("no prefix — returns condensed", () => {
    expect(condenseModelId("opus-4-7")).toBe("opus-4.7");
  });

  test("lowercase output for all forms", () => {
    const result = condenseModelId("Claude-Opus-4-7");
    expect(result).toBe(result.toLowerCase());
  });
});

describe("condenseModelId — digit-hyphen to dot replacement", () => {
  test("4-7 becomes 4.7", () => {
    expect(condenseModelId("claude-opus-4-7")).toContain("4.7");
  });

  test("4-5 becomes 4.5", () => {
    expect(condenseModelId("claude-haiku-4-5")).toContain("4.5");
  });

  test("non-version hyphens preserved", () => {
    // "opus" contains no digit-hyphen patterns
    expect(condenseModelId("claude-opus-4-7")).toContain("opus");
  });
});
