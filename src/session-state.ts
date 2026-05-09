// src/session-state.ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ParsedTranscript } from "./types.js";

const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".cache/ohud/sessions");

// Rate-limit: skip write if file exists and was written within this window.
const WRITE_DEBOUNCE_MS = 1000;

/**
 * Writes a plain-text session summary file for the given session.
 * Returns the absolute path to the file.
 *
 * Rate-limited: if the file already exists and its mtime is within 1000ms of
 * `options.now` (default: Date.now()), the write is skipped and the path is
 * returned unchanged.
 */
export async function writeSessionFile(
  sessionId: string,
  transcript: ParsedTranscript,
  options?: { now?: number; cacheDir?: string },
): Promise<string> {
  const cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
  const now = options?.now ?? Date.now();
  const filePath = path.join(cacheDir, `${sessionId}.txt`);

  // Rate-limit: check mtime before writing
  try {
    const st = await fs.stat(filePath);
    if (Math.abs(now - st.mtimeMs) < WRITE_DEBOUNCE_MS) {
      return filePath; // within debounce window — skip
    }
  } catch {
    // File doesn't exist yet — fall through to write
  }

  await fs.mkdir(cacheDir, { recursive: true });

  const content = formatSessionFile(sessionId, transcript);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Formats the session summary file content. */
function formatSessionFile(sessionId: string, transcript: ParsedTranscript): string {
  const lines: string[] = [];

  lines.push(`ohud session ${sessionId}`);

  // Session start timestamp in local time "YYYY-MM-DD HH:MM:SS"
  if (transcript.sessionStart) {
    const d = transcript.sessionStart;
    const pad = (n: number) => String(n).padStart(2, "0");
    const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    lines.push(`started ${datePart} ${timePart}`);
  } else {
    lines.push("started unknown");
  }

  lines.push("");

  // Count tools by name
  const toolCounts = new Map<string, number>();
  for (const tool of transcript.tools) {
    toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
  }

  const sortedTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  lines.push(`Tools (total: ${transcript.tools.length}):`);
  for (const [name, count] of sortedTools) {
    // Name left-padded to 8 chars
    const paddedName = name.padStart(8, " ");
    lines.push(`  ${paddedName}    ${count}`);
  }

  lines.push("");

  // Error entries
  const errorTools = transcript.tools.filter((t) => t.hasError === true);
  lines.push(`Errors: ${errorTools.length}`);
  if (errorTools.length > 0) {
    for (const tool of errorTools) {
      const ts = tool.endTime ?? tool.startTime;
      const pad = (n: number) => String(n).padStart(2, "0");
      const timeStr = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
      lines.push(`  - ${tool.name} error at ${timeStr}`);
    }
  }

  // Newline-terminated
  return lines.join("\n") + "\n";
}
