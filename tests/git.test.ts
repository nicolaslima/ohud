// tests/git.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getGitStatus } from "../src/git.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ohud-git-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@test", { cwd: dir });
  execSync("git config user.name test", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "x");
  execSync("git add . && git commit -q -m init", { cwd: dir });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("clean repo on main", async () => {
  const s = await getGitStatus(dir);
  expect(s?.branch).toBe("main");
  expect(s?.dirty).toBe(false);
});

test("detects dirty working tree", async () => {
  writeFileSync(join(dir, "README.md"), "y");
  const s = await getGitStatus(dir);
  expect(s?.dirty).toBe(true);
});

test("returns null when not in a git repo", async () => {
  const notRepo = mkdtempSync(join(tmpdir(), "ohud-nogit-"));
  const s = await getGitStatus(notRepo);
  expect(s).toBeNull();
  rmSync(notRepo, { recursive: true, force: true });
});
