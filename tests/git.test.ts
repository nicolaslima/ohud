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

test("getGitStatus parses ahead/behind from porcelain=v2", async () => {
  const upstream = mkdtempSync(join(tmpdir(), "ohud-git-upstream-"));
  const dir = mkdtempSync(join(tmpdir(), "ohud-git-ab-"));
  try {
    execSync(`git init -b main "${upstream}"`);
    execSync(`cd "${upstream}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m base`);
    execSync(`git clone "${upstream}" "${dir}"`);
    execSync(`cd "${dir}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m local1`);
    execSync(`cd "${dir}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m local2`);
    execSync(`cd "${upstream}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m remote`);
    execSync(`cd "${dir}" && git fetch`);
    const s = await getGitStatus(dir);
    expect(s?.branch).toBe("main");
    expect(s?.ahead).toBe(2);
    expect(s?.behind).toBe(1);
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
