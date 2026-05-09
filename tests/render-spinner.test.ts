// tests/render-spinner.test.ts
import { test, expect, describe } from "bun:test";
import { spinnerFrame } from "../src/render/spinner.js";

describe("spinnerFrame", () => {
  // Unicode frames: ◐ ◓ ◑ ◒ at indices 0,1,2,3

  test("returns ◐ for now=0ms (frame 0)", () => {
    expect(spinnerFrame(0, "unicode")).toBe("◐");
  });

  test("returns ◓ for now=1000ms (frame 1)", () => {
    expect(spinnerFrame(1000, "unicode")).toBe("◓");
  });

  test("returns ◑ for now=2000ms (frame 2)", () => {
    expect(spinnerFrame(2000, "unicode")).toBe("◑");
  });

  test("returns ◒ for now=3000ms (frame 3)", () => {
    expect(spinnerFrame(3000, "unicode")).toBe("◒");
  });

  test("cycles back to ◐ at now=4000ms (frame 0 again)", () => {
    expect(spinnerFrame(4000, "unicode")).toBe("◐");
  });

  test("ASCII fallback returns | for frame 0", () => {
    expect(spinnerFrame(0, "ascii")).toBe("|");
  });

  test("ASCII fallback returns / for frame 1", () => {
    expect(spinnerFrame(1000, "ascii")).toBe("/");
  });

  test("ASCII fallback returns - for frame 2", () => {
    expect(spinnerFrame(2000, "ascii")).toBe("-");
  });

  test("ASCII fallback returns \\ for frame 3", () => {
    expect(spinnerFrame(3000, "ascii")).toBe("\\");
  });

  test("ASCII cycles back at frame 4000ms", () => {
    expect(spinnerFrame(4000, "ascii")).toBe("|");
  });

  test("pure function: same now+mode always returns same glyph", () => {
    const now = 1742100000;
    const a = spinnerFrame(now, "unicode");
    const b = spinnerFrame(now, "unicode");
    expect(a).toBe(b);
  });

  test("sub-second timestamps are coerced to same frame as their second boundary", () => {
    // 1500ms → Math.floor(1500/1000) = 1 → frame 1 = ◓
    expect(spinnerFrame(1500, "unicode")).toBe("◓");
    // 1999ms → still frame 1
    expect(spinnerFrame(1999, "unicode")).toBe("◓");
  });
});
