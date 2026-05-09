import { test, expect } from "bun:test";
import { glyph } from "../src/render/glyphs.js";

test("glyph returns unicode in unicode mode", () => {
  expect(glyph("bolt", "unicode")).toBe("⚡");
  expect(glyph("clock", "unicode")).toBe("⏱");
  expect(glyph("sep", "unicode")).toBe("│");
});

test("glyph returns ASCII fallback in ascii mode", () => {
  expect(glyph("bolt", "ascii")).toBe("*");
  expect(glyph("clock", "ascii")).toBe("t");
  expect(glyph("sep", "ascii")).toBe("|");
});

test("glyph autodetects ascii when LANG lacks UTF-8", () => {
  const orig = process.env.LANG;
  process.env.LANG = "C";
  try { expect(glyph("bolt", "auto")).toBe("*"); }
  finally { if (orig === undefined) delete process.env.LANG; else process.env.LANG = orig; }
});

test("glyph autodetects unicode when LANG has UTF-8", () => {
  const orig = process.env.LANG;
  process.env.LANG = "en_US.UTF-8";
  try { expect(glyph("bolt", "auto")).toBe("⚡"); }
  finally { if (orig === undefined) delete process.env.LANG; else process.env.LANG = orig; }
});
