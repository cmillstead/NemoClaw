// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared types for the NemoClaw memory system.
 */

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "compacting" | "promoting" | "closed";
export type MessageRole = "user" | "assistant" | "system";
export type FactSourceType = "auto" | "agent" | "user";
export type FactStatus = "active" | "superseded";
export type ParaCategory = "projects" | "areas" | "resources" | "archives";

export const PARA_CATEGORIES: readonly ParaCategory[] = [
  "projects",
  "areas",
  "resources",
  "archives",
] as const;

export interface SessionRecord {
  id: string;
  started_at: string;
  ended_at: string | null;
  model: string | null;
  status: SessionStatus;
  total_tokens: number;
  compaction_count: number;
  metadata: string | null;
}

export interface MessageRecord {
  id: number;
  session_id: string;
  role: MessageRole;
  content: string;
  token_count: number | null;
  created_at: string;
  compacted: number;
  compaction_id: string | null;
}

export interface CompactionRecord {
  id: string;
  session_id: string;
  summary: string;
  message_range_start: number;
  message_range_end: number;
  original_token_count: number | null;
  summary_token_count: number | null;
  created_at: string;
}

export interface PromotedFactRecord {
  id: string;
  session_id: string;
  fact_file_path: string;
  content_hash: string;
  promoted_at: string;
  source: FactSourceType;
}

// ---------------------------------------------------------------------------
// PARA fact types
// ---------------------------------------------------------------------------

export interface ParaFactFrontmatter {
  id: string;
  fact: string;
  category: ParaCategory;
  status: FactStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
  source_session: string;
  source_type: FactSourceType;
  superseded_by: string | null;
  supersedes: string | null;
  access_count: number;
  content_hash: string;
}

// ---------------------------------------------------------------------------
// Compaction types
// ---------------------------------------------------------------------------

export interface CompactionExtraction {
  topics: string[];
  decisions: string[];
  codeArtifacts: string[];
  rememberRequests: string[];
}

export interface CompactionResult {
  id: string;
  summary: string;
  messageRangeStart: number;
  messageRangeEnd: number;
  originalTokenCount: number;
  summaryTokenCount: number;
  extraction: CompactionExtraction;
}

// ---------------------------------------------------------------------------
// Memory config
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  /** Root directory for memory files. Host: ~/.nemoclaw/memory/, Sandbox: /sandbox/memory/ */
  memoryDir: string;
  /** Maximum token count before compaction triggers (80% of context window) */
  compactionThreshold: number;
  /** Maximum number of facts auto-promoted per session */
  maxAutoPromotedFacts: number;
  /** Maximum number of agent-driven facts per session */
  maxAgentFacts: number;
  /** Maximum size of a single PARA fact file in bytes */
  maxFactFileSize: number;
  /** Maximum total memory volume size in bytes */
  maxVolumeSize: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  memoryDir: "/sandbox/memory",
  compactionThreshold: 104858, // ~80% of 131072 tokens
  maxAutoPromotedFacts: 5,
  maxAgentFacts: 10,
  maxFactFileSize: 10 * 1024, // 10KB
  maxVolumeSize: 1024 * 1024 * 1024, // 1GB
};

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  valid: boolean;
  reason?: string;
}

export interface MemoryServiceState {
  sessionId: string | null;
  status: SessionStatus | "idle";
  messageCount: number;
  tokenCount: number;
  compactionCount: number;
}

// ---------------------------------------------------------------------------
// ContextEngine types
// ---------------------------------------------------------------------------

export interface ContextEnginePlugin {
  id: string;
  prepareSubagentSpawn?: (ctx: SubagentSpawnContext) => string | null;
  onSubagentEnded?: (ctx: SubagentEndedContext) => void;
  afterTurn?: (ctx: AfterTurnContext) => void;
}

export interface SubagentSpawnContext {
  task: string;
  parentSessionId: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentEndedContext {
  sessionId: string;
  parentSessionId: string;
  messages: MessageRecord[];
  exitReason: "completed" | "timeout" | "error";
  metadata?: Record<string, unknown>;
}

export interface AfterTurnContext {
  sessionId: string;
  role: MessageRole;
  tokenCount: number;
}

/**
 * Spawn function injected from the OpenClaw host API.
 * Bound during plugin registration; null if spawn API is unavailable.
 * When null, all async operations fall back to synchronous execution.
 */
export type SpawnSession =
  | ((opts: {
      task: string;
      mode?: "run" | "session";
      sandbox?: "inherit" | "require";
      runTimeoutSeconds?: number;
      cleanup?: "delete" | "keep";
      label?: string;
      metadata?: Record<string, unknown>;
    }) => string)
  | null;

/** Metadata marker for NemoClaw-spawned internal subagents. */
export type NemoClawOp = "compact" | "promote" | "janitor";
