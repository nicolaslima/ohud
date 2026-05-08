// src/transcript.ts
import { readFile } from "node:fs/promises";
import type { AgentEntry, SessionTokens, TodoItem, ToolEntry, TranscriptData } from "./types.js";

export async function parseTranscript(path: string): Promise<TranscriptData> {
  const empty: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!path) return empty;

  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return empty; }

  const lines = raw.split("\n").filter((l) => l.length > 0);

  const tools = new Map<string, ToolEntry>();
  const agents = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const tokens: SessionTokens = {
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
  };
  let totalDurationNs = 0;
  let totalEvalCount = 0;
  let totalEvalDurationNs = 0;
  let sawOllamaTiming = false;
  let sessionStart: Date | undefined;
  let lastAssistantResponseAt: Date | undefined;
  let sessionName: string | undefined;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const type = entry.type;
    const ts = typeof entry.timestamp === "string" ? new Date(entry.timestamp) : undefined;
    if (ts && !sessionStart) sessionStart = ts;

    if (type === "summary" && typeof entry.summary === "string") {
      sessionName = entry.summary;
      continue;
    }

    if (type !== "assistant" && type !== "user") continue;

    const message = entry.message as { role?: string; content?: unknown; usage?: Record<string, number> } | undefined;
    if (!message) continue;

    if (type === "assistant" && message.usage) {
      tokens.inputTokens += Number(message.usage.input_tokens ?? 0);
      tokens.outputTokens += Number(message.usage.output_tokens ?? 0);
      tokens.cacheCreationTokens += Number(message.usage.cache_creation_input_tokens ?? 0);
      tokens.cacheReadTokens += Number(message.usage.cache_read_input_tokens ?? 0);
      if (ts) lastAssistantResponseAt = ts;

      // Look for Ollama-native timing fields anywhere in this entry.
      // In real Claude Code → Ollama Cloud sessions, these never appear (verified 2026-05-08),
      // but keeping the walker preserves forward-compat if Ollama propagates timing in the future.
      const found = findOllamaTiming(entry);
      if (found.total_duration) { totalDurationNs += found.total_duration; sawOllamaTiming = true; }
      if (found.eval_count) totalEvalCount += found.eval_count;
      if (found.eval_duration) totalEvalDurationNs += found.eval_duration;
    }

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          if (b.name === "TodoWrite" && b.input && typeof b.input === "object") {
            const inp = b.input as { todos?: TodoItem[] };
            if (Array.isArray(inp.todos)) latestTodos = inp.todos;
          } else if (b.name === "Task" && b.input && typeof b.input === "object") {
            const inp = b.input as { subagent_type?: string; description?: string; model?: string };
            agents.set(b.id, {
              id: b.id, type: inp.subagent_type ?? "agent", description: inp.description,
              model: inp.model, status: "running", startTime: ts ?? new Date(),
            });
          } else {
            tools.set(b.id, {
              id: b.id, name: b.name, target: extractTarget(b.input),
              status: "running", startTime: ts ?? new Date(),
            });
          }
        }
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          const tool = tools.get(b.tool_use_id);
          if (tool) { tool.status = "completed"; tool.endTime = ts; }
          const agent = agents.get(b.tool_use_id);
          if (agent) { agent.status = "completed"; agent.endTime = ts; }
        }
      }
    }
  }

  const result: TranscriptData = {
    tools: [...tools.values()],
    agents: [...agents.values()],
    todos: latestTodos,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined,
  };
  if (sawOllamaTiming) {
    result.totalDurationNs = totalDurationNs;
    result.totalEvalCount = totalEvalCount;
    result.totalEvalDurationNs = totalEvalDurationNs;
  }
  return result;
}

function extractTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.path === "string") return i.path;
  if (typeof i.command === "string") return i.command;
  if (typeof i.pattern === "string") return i.pattern;
  return undefined;
}

interface OllamaTiming {
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

function findOllamaTiming(obj: unknown, depth = 0): OllamaTiming {
  if (depth > 6 || obj == null || typeof obj !== "object") return {};
  if (Array.isArray(obj)) {
    return obj.reduce<OllamaTiming>((acc, v) => mergeTiming(acc, findOllamaTiming(v, depth + 1)), {});
  }
  const o = obj as Record<string, unknown>;
  let acc: OllamaTiming = {};
  if (typeof o.total_duration === "number") acc.total_duration = o.total_duration;
  if (typeof o.eval_count === "number") acc.eval_count = o.eval_count;
  if (typeof o.eval_duration === "number") acc.eval_duration = o.eval_duration;
  for (const v of Object.values(o)) acc = mergeTiming(acc, findOllamaTiming(v, depth + 1));
  return acc;
}

function mergeTiming(a: OllamaTiming, b: OllamaTiming): OllamaTiming {
  return {
    total_duration: a.total_duration ?? b.total_duration,
    eval_count: a.eval_count ?? b.eval_count,
    eval_duration: a.eval_duration ?? b.eval_duration,
  };
}
