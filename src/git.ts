import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "./types.js";

const execFileP = promisify(execFile);

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;

  // Run status + remote URL fetch in parallel — both have 1s timeouts so worst
  // case is unchanged from the pre-existing single-call latency.
  const [statusResult, remoteUrl] = await Promise.all([
    runGitStatus(cwd),
    getRemoteUrl(cwd),
  ]);
  if (!statusResult) return null;

  const out: GitStatus = statusResult;
  if (remoteUrl) out.remoteUrl = remoteUrl;
  return out;
}

async function runGitStatus(cwd: string): Promise<GitStatus | null> {
  let stdout: string;
  try {
    const r = await execFileP("git", ["status", "--branch", "--porcelain=v2"], { cwd, timeout: 1000 });
    stdout = r.stdout;
  } catch { return null; }

  const lines = stdout.split("\n");
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let dirty = false;

  for (const line of lines) {
    if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) { ahead = Number.parseInt(m[1], 10); behind = Number.parseInt(m[2], 10); }
    } else if (line.length > 0 && !line.startsWith("#")) {
      dirty = true; // any non-header line means uncommitted change
    }
  }

  if (!branch) return null;
  return { branch, dirty, ahead, behind };
}

/** Fetch the origin remote URL. Returns undefined when not set or git fails. */
async function getRemoteUrl(cwd: string): Promise<string | undefined> {
  try {
    const r = await execFileP("git", ["config", "--get", "remote.origin.url"], { cwd, timeout: 1000 });
    const url = r.stdout.trim();
    return url || undefined;
  } catch { return undefined; }
}
