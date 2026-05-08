// Shared types — consumed by every module. Internal helper types stay local.

export type RenderMode = "ollama" | "anthropic";

// === Stdin from Claude Code ===

export interface StdinModel {
  id?: string;
  display_name?: string;
}

export interface StdinContextWindow {
  context_window_size?: number;
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  used_percentage?: number | null;
  remaining_percentage?: number | null;
  current_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
}

export interface StdinCost {
  total_cost_usd?: number | null;
  total_duration_ms?: number | null;
  total_api_duration_ms?: number | null;
  total_lines_added?: number | null;
  total_lines_removed?: number | null;
}

export interface StdinRateLimitWindow {
  used_percentage?: number | null;
  resets_at?: number | null;
}

export interface StdinRateLimits {
  five_hour?: StdinRateLimitWindow | null;
  seven_day?: StdinRateLimitWindow | null;
}

export interface StdinWorkspace {
  current_dir?: string;
  project_dir?: string;
  added_dirs?: string[];
  git_worktree?: string;
}

// Claude Code 2.1.115+ exposes effort as an object: `{ level: "max" }`.
// Earlier versions (≤2.1.114) did not send this field at all. The bare-string
// shape is preserved for backward compatibility with intermediate builds that
// shipped `effort: "max"` directly. The union `StdinEffort | string | null`
// in `StdinData.effort` is therefore intentional and defensive across all
// observed Claude Code versions.
export interface StdinEffort {
  level?: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export interface StdinData {
  cwd?: string;
  session_id?: string;
  session_name?: string;
  transcript_path?: string;
  version?: string;
  model?: StdinModel;
  workspace?: StdinWorkspace;
  context_window?: StdinContextWindow;
  cost?: StdinCost | null;
  rate_limits?: StdinRateLimits | null;
  effort?: StdinEffort | string | null;
  output_style?: { name?: string };
  exceeds_200k_tokens?: boolean;
}

// === Ollama probe ===

export interface OllamaTagsModel {
  name: string;
  model: string;
  remote_model?: string;
  remote_host?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaProbeResult {
  daemonOk: boolean;
  cloudModels: OllamaTagsModel[];   // only entries with remote_host populated
  fetchedAt: number;                 // epoch ms
}

// === Transcript ===

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: "running" | "completed" | "error";
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: "running" | "completed";
  startTime: Date;
  endTime?: Date;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
  sessionName?: string;
  lastAssistantResponseAt?: Date;
  sessionTokens?: SessionTokens;
  // Ollama-mode aggregated GPU time, in nanoseconds. Undefined if no Ollama
  // duration fields were observed in the transcript.
  totalDurationNs?: number;
  // Ollama eval counts (for tok/s line)
  totalEvalCount?: number;
  totalEvalDurationNs?: number;
}

// === Usage (Anthropic mode) ===

export interface UsageData {
  fiveHour: number | null;            // 0-100 percentage, null if unavailable
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
}

export interface ExternalUsageSnapshot {
  five_hour?: { used_percentage?: number | null; resets_at?: string | number | null } | null;
  seven_day?: { used_percentage?: number | null; resets_at?: string | number | null } | null;
  updated_at?: string | number | null;
}

// === Cost (Anthropic mode) ===

export interface SessionCostDisplay {
  totalUsd: number;
  source: "native" | "estimate";
}

// === Git ===

export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
  };
}

// === Memory (opt-in) ===

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
}

// === Render context ===

export interface RenderContext {
  mode: RenderMode;
  stdin: StdinData;
  transcript: TranscriptData;
  gitStatus: GitStatus | null;
  config: HudConfig;
  usageData: UsageData | null;       // anthropic mode
  costData: SessionCostDisplay | null;  // anthropic mode
  memoryInfo: MemoryInfo | null;
  cloudModels: OllamaTagsModel[];     // empty in anthropic mode
  effortLevel?: string;
}

// === Config ===

export interface HudConfig {
  lineLayout: "expanded" | "compact";
  pathLevels: 1 | 2 | 3;
  maxWidth: number | null;
  elementOrder: string[];
  display: {
    mergeGroups: string[][];
    showModel: boolean;
    showContextBar: boolean;
    contextValue: "percent" | "tokens" | "remaining" | "both";
    showApiTime: boolean;
    showUsage: boolean;
    usageBarEnabled: boolean;
    usageCompact: boolean;
    showResetLabel: boolean;
    timeFormat: "relative" | "absolute" | "both";
    sevenDayThreshold: number;
    externalUsagePath: string;
    externalUsageFreshnessMs: number;
    showCost: boolean;
    showPromptCache: boolean;
    promptCacheTtlSeconds: number;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showConfigCounts: boolean;
    showOutputStyle: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showMemoryUsage: boolean;
    showTokenBreakdown: boolean;
    showSessionName: boolean;
    showClaudeCodeVersion: boolean;
    showEffortLevel: boolean;
  };
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    pushWarningThreshold: number;
    pushCriticalThreshold: number;
    showFileStats: boolean;
    branchOverflow: "truncate" | "wrap";
  };
  colors: {
    context: string;
    apiTime: string;
    usage: string;
    warning: string;
    usageWarning: string;
    critical: string;
    model: string;
    project: string;
    git: string;
    gitBranch: string;
    label: string;
  };
  ollama: {
    host: string;
    probeCacheTtlSeconds: number;
    probeTimeoutMs: number;
  };
}
