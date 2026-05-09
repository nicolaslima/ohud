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

test('glyph "auto" never promotes to nerd even on UTF-8 (nerd is opt-in only)', () => {
  const orig = process.env.LANG;
  process.env.LANG = "en_US.UTF-8";
  try {
    // "auto" must resolve to unicode, not nerd — Nerd Fonts require font install
    // that LANG cannot detect. User opts in explicitly.
    expect(glyph("done", "auto")).toBe("✓");
    expect(glyph("done", "auto")).not.toBe("");
  } finally {
    if (orig === undefined) delete process.env.LANG;
    else process.env.LANG = orig;
  }
});

test('nerd mode returns Nerd Font codepoints for covered keys', () => {
  expect(glyph("done", "nerd")).toBe("");      // nf-fa-check
  expect(glyph("running", "nerd")).toBe("");   // nf-fa-spinner
  expect(glyph("bolt", "nerd")).toBe("");      // nf-fa-bolt
});

test('nerd mode falls through to unicode for uncovered keys', () => {
  // No NERD override for "sep" — should fall through to UNICODE.
  expect(glyph("sep", "nerd")).toBe("│");
  expect(glyph("barFull", "nerd")).toBe("█");
  expect(glyph("up", "nerd")).toBe("↑");
});
