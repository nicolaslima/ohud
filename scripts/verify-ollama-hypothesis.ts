// scripts/verify-ollama-hypothesis.ts
//
// Run against a real claude-code transcript JSONL captured from a session
// using a :cloud model (ANTHROPIC_BASE_URL=http://localhost:11434).
//
// Usage: bun run scripts/verify-ollama-hypothesis.ts <transcript.jsonl>

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun run scripts/verify-ollama-hypothesis.ts <transcript.jsonl>");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);

const fieldHits = new Map<string, number>();
const sampleByField = new Map<string, string>();

const ollamaTimingFields = [
  "total_duration",
  "load_duration",
  "prompt_eval_count",
  "prompt_eval_duration",
  "eval_count",
  "eval_duration",
];

function walk(obj: unknown, path: string): void {
  if (obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const child = `${path}.${k}`;
    if (ollamaTimingFields.includes(k) && typeof v === "number") {
      fieldHits.set(k, (fieldHits.get(k) ?? 0) + 1);
      if (!sampleByField.has(k)) {
        sampleByField.set(k, `${child} = ${v}`);
      }
    }
    walk(v, child);
  }
}

let assistantCount = 0;
for (const line of lines) {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { continue; }
  if (typeof parsed === "object" && parsed && "type" in parsed && (parsed as Record<string, unknown>).type === "assistant") {
    assistantCount += 1;
    walk(parsed, "$");
  }
}

console.log(`Assistant messages scanned: ${assistantCount}`);
console.log("Ollama timing field hit counts:");
for (const f of ollamaTimingFields) {
  const hits = fieldHits.get(f) ?? 0;
  const sample = sampleByField.get(f) ?? "(no sample)";
  console.log(`  ${f.padEnd(24)} ${String(hits).padStart(4)}   sample: ${sample}`);
}

const anyHit = ollamaTimingFields.some((f) => (fieldHits.get(f) ?? 0) > 0);
if (anyHit) {
  console.log("\n✓ HYPOTHESIS CONFIRMED — Ollama timing fields survive the Anthropic translation.");
  console.log("  Task 7 (transcript.ts) can sum total_duration directly.");
  process.exit(0);
} else {
  console.log("\n✗ HYPOTHESIS REJECTED — no Ollama timing fields found in any assistant message.");
  console.log("  Task 7 (transcript.ts) must fall back to stdin.cost.total_api_duration_ms.");
  console.log("  Update the spec §10 to reflect the fallback as the primary path.");
  process.exit(1);
}
