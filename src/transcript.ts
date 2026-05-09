// src/transcript.ts
import { readFile, stat } from "node:fs/promises";
import type { AgentEntry, SessionTokens, TodoItem, ToolEntry, TranscriptData } from "./types.js";

interface CacheEntry { size: number; mtimeMs: number; data: TranscriptData; }
const cache = new Map<string, CacheEntry>();

export async function parseTranscript(path: string): Promise<TranscriptData> {
  if (!path) return empty();
  let st;
  try { st = await stat(path); } catch { return empty(); }
  const cached = cache.get(path);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return cached.data;
  }
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return empty(); }
  const data = parseRaw(raw);
  cache.set(path, { size: st.size, mtimeMs: st.mtimeMs, data });
  return data;
}

function empty(): TranscriptData {
  return { tools: [], agents: [], todos: [] };
}

function parseRaw(raw: string): TranscriptData {
  const lines = raw.split("\n").filter((l) => l.length > 0);

  const tools = new Map<string, ToolEntry>();
  const agents = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const tokens: SessionTokens = {
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
  };
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

  return {
    tools: [...tools.values()],
    agents: [...agents.values()],
    todos: latestTodos,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined,
  };
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
