// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "./types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { cwd, timeout: 1000 });
    return stdout;
  } catch { return null; }
}

export async function getGitStatus(cwd: string | undefined): Promise<GitStatus | null> {
  if (!cwd) return null;

  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside) return null;

  const branch = (await git(cwd, ["branch", "--show-current"]))?.trim() ?? "";
  const status = await git(cwd, ["status", "--porcelain=v1"]);
  const dirty = !!(status && status.trim().length > 0);

  // ahead/behind via upstream
  let ahead = 0;
  let behind = 0;
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (counts) {
    const [b, a] = counts.trim().split(/\s+/).map(Number);
    if (Number.isFinite(a)) ahead = a;
    if (Number.isFinite(b)) behind = b;
  }

  return { branch, dirty, ahead, behind };
}
