import { test, expect } from "bun:test";
import { basename } from "../src/render/path.js";

test("basename returns last segment for normal absolute path", () => {
  expect(basename("/foo/bar/baz")).toBe("baz");
});

test("basename ignores trailing slash", () => {
  expect(basename("/foo/bar/")).toBe("bar");
});

test("basename returns empty string for root only", () => {
  expect(basename("/")).toBe("");
});

test("basename returns empty string for empty input", () => {
  expect(basename("")).toBe("");
});

test("basename returns input when no slash present", () => {
  expect(basename("foo.ts")).toBe("foo.ts");
});

test("basename collapses consecutive slashes", () => {
  expect(basename("//foo//bar//")).toBe("bar");
});

test("basename handles relative path with trailing slash", () => {
  expect(basename("foo/bar/")).toBe("bar");
});
