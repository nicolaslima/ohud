// scripts/verify-stdin-model-id.ts
// Walks ~/.claude/projects/ JSONL transcripts and emits any model strings
// found — confirms what stdin.model.id actually is in production.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS = join(homedir(), ".claude/projects");
const samples = new Map<string, string>();

function walk(dir: string): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".jsonl")) scan(full);
  }
}

function scan(file: string): void {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      collect(obj, file);
    } catch { /* skip */ }
  }
}

function collect(o: unknown, file: string): void {
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === "model" && typeof v === "string") {
      if (!samples.has(v)) samples.set(v, file);
    }
    if (typeof v === "object") collect(v, file);
  }
}

walk(PROJECTS);
const all = [...samples.keys()].sort();
console.log("Distinct model strings found in ~/.claude/projects/:");
for (const m of all) console.log(`  ${m}`);

const cloudExamples = all.filter((k) => k.includes("cloud") || k.endsWith(":cloud"));
console.log("\nCloud-flavored model strings:");
if (cloudExamples.length === 0) {
  console.log("  (none found — try running a session with an Ollama Cloud model first)");
  process.exit(1);
}
for (const m of cloudExamples) console.log(`  ${m}`);
process.exit(0);
