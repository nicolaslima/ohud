// src/transcript.ts
import { readFile, stat } from "node:fs/promises";
import type { AgentEntry, AssistantMessage, ParsedTranscript, SessionTokens, TodoItem, ToolEntry } from "./types.js";

// Matches common error patterns in tool_result content strings.
const ERROR_CONTENT_RE = /^Error[: ]|exit code [1-9]|ENOENT|EACCES|EPERM|EISDIR|ENOTDIR/i;

/** Returns true if a tool_result content value indicates an error. */
function isErrorContent(content: unknown): boolean {
  if (typeof content === "string") return ERROR_CONTENT_RE.test(content);
  if (Array.isArray(content)) {
    return content.some((block) => {
      if (typeof block !== "object" || block === null) return false;
      const b = block as Record<string, unknown>;
      return typeof b.text === "string" && ERROR_CONTENT_RE.test(b.text);
    });
  }
  return false;
}

interface CacheEntry { size: number; mtimeMs: number; data: ParsedTranscript; }
const cache = new Map<string, CacheEntry>();

export async function parseTranscript(path: string): Promise<ParsedTranscript> {
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

function empty(): ParsedTranscript {
  return { tools: [], agents: [], todos: [], assistantMessages: [] };
}

function parseRaw(raw: string): ParsedTranscript {
  const lines = raw.split("\n").filter((l) => l.length > 0);

  const tools = new Map<string, ToolEntry>();
  const agents = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const tokens: SessionTokens = {
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
  };
  const assistantMessages: AssistantMessage[] = [];
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
      const outTokens = Number(message.usage.output_tokens ?? 0);
      tokens.inputTokens += Number(message.usage.input_tokens ?? 0);
      tokens.outputTokens += outTokens;
      tokens.cacheCreationTokens += Number(message.usage.cache_creation_input_tokens ?? 0);
      tokens.cacheReadTokens += Number(message.usage.cache_read_input_tokens ?? 0);
      if (ts) {
        lastAssistantResponseAt = ts;
        assistantMessages.push({ timestamp: ts, outputTokens: outTokens });
      }
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
          if (tool) {
            // T1 is additive: status stays "completed" so existing fade/freshDone
            // logic in render/widgets/tools.ts behaves identically. hasError is
            // a sidecar flag for downstream widgets that want to surface errors.
            tool.status = "completed";
            tool.endTime = ts;
            if (b.is_error === true || isErrorContent(b.content)) {
              tool.hasError = true;
            }
          }
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
    assistantMessages,
    sessionStart,
    sessionName,
    lastAssistantResponseAt,
    sessionTokens: tokens.inputTokens + tokens.outputTokens > 0 ? tokens : undefined,
  };
}

/**
 * Computes approximate tokens per second for the session.
 * Sums output_tokens across all assistant messages, divides by elapsed seconds
 * between first and last assistant message timestamps.
 * Returns null when fewer than 2 messages exist or elapsed time is < 1s.
 */
export function computeTokensPerSecond(transcript: Pick<ParsedTranscript, "assistantMessages">): number | null {
  const msgs = transcript.assistantMessages;
  if (msgs.length < 2) return null;
  const elapsedMs = msgs[msgs.length - 1].timestamp.getTime() - msgs[0].timestamp.getTime();
  if (elapsedMs < 1000) return null; // guard: < 1 second of elapsed time
  const totalTokens = msgs.reduce((sum, m) => sum + m.outputTokens, 0);
  return Math.round(totalTokens / (elapsedMs / 1000));
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
