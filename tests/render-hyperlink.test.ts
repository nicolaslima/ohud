// tests/render-hyperlink.test.ts
import { test, expect, describe } from "bun:test";
import { link } from "../src/render/hyperlink.js";

describe("link (OSC 8 hyperlink)", () => {
  test("emits OSC 8 escape sequence for valid url", () => {
    const out = link("text", "https://example.com");
    expect(out).toBe("\x1b]8;;https://example.com\x07text\x1b]8;;\x07");
  });

  test("returns plain text when url is null", () => {
    expect(link("hello", null)).toBe("hello");
  });

  test("returns plain text when url is undefined", () => {
    expect(link("hello", undefined)).toBe("hello");
  });

  test("returns plain text when url is empty string", () => {
    expect(link("hello", "")).toBe("hello");
  });

  test("returns plain text when enabled is false", () => {
    expect(link("hello", "https://example.com", false)).toBe("hello");
  });

  test("does not escape special chars in url (passes through verbatim)", () => {
    const url = "https://example.com/path?a=1&b=2#anchor";
    const out = link("test", url);
    expect(out).toContain(url);
  });

  test("works with file:// urls", () => {
    const url = "file:///Users/lima/Projects/ohud";
    const out = link("ohud", url);
    expect(out).toBe(`\x1b]8;;${url}\x07ohud\x1b]8;;\x07`);
  });

  test("OSC 8 byte sequence starts with ESC ] 8", () => {
    const out = link("x", "https://x.com");
    expect(out.startsWith("\x1b]8;;")).toBe(true);
  });

  test("OSC 8 byte sequence ends with ESC ] 8 ;; BEL", () => {
    const out = link("x", "https://x.com");
    expect(out.endsWith("\x1b]8;;\x07")).toBe(true);
  });
});
