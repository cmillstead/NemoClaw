// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * ContextEngine hook implementations for memory-aware subagents.
 *
 * prepareSubagentSpawn — inject session context + recalled facts
 * onSubagentEnded     — capture facts from subagent transcript
 * afterTurn           — trigger async compaction when token threshold hit
 */

import type { PluginLogger } from "../index.js";
import type { TranscriptDb } from "./transcript-db.js";
import type { SessionManager } from "./session.js";
import type {
  MemoryConfig,
  SubagentSpawnContext,
  SubagentEndedContext,
  AfterTurnContext,
  NemoClawOp,
} from "./types.js";
import { recallMemories } from "./recall.js";
import { promoteFromMessages } from "./promotion.js";
import { estimateTokens } from "./compaction.js";

import type { Orchestrator } from "./orchestrator.js";

const MAX_SUMMARY_TOKENS = 200;

/**
 * Truncate compaction summaries to fit within a token budget.
 * Takes the most recent summaries first.
 */
export function truncateCompactionSummaries(
  summaries: string[],
  maxTokens: number = MAX_SUMMARY_TOKENS,
): string {
  if (summaries.length === 0) return "";

  const selected: string[] = [];
  let totalTokens = 0;

  // Most recent first
  for (let i = summaries.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(summaries[i]);
    if (totalTokens + tokens > maxTokens) break;
    selected.unshift(summaries[i]);
    totalTokens += tokens;
  }

  return selected.join("\n\n");
}

/**
 * Handle prepareSubagentSpawn — inject memory context before subagent starts.
 * Returns XML context block or null if no context to inject.
 */
export function handlePrepareSubagentSpawn(
  ctx: SubagentSpawnContext,
  sessionMgr: SessionManager,
  config: MemoryConfig,
  logger: PluginLogger,
): string | null {
  try {
    const memoryOpt = ctx.metadata?.memory as string | undefined;
    if (memoryOpt === "none") return null;
    if (!ctx.task || ctx.task.trim().length === 0) return null;

    const parts: string[] = [];

    // Session summary (skip if "minimal")
    if (memoryOpt !== "minimal") {
      const summaries = sessionMgr.getCompactionSummaries();
      const summary = truncateCompactionSummaries(summaries);
      if (summary) {
        parts.push(`<session-summary>\n${summary}\n</session-summary>`);
      }
    }

    // Targeted recall via QMD
    const recalled = recallMemories(ctx.task, config.memoryDir);
    if (recalled) {
      parts.push(recalled);
    }

    if (parts.length === 0) return null;

    const block = `<nemoclaw-context type="subagent-briefing">\n${parts.join("\n\n")}\n</nemoclaw-context>`;
    logger.info(
      `Injecting ${String(estimateTokens(block))} tokens of memory context into subagent`,
    );
    return block;
  } catch (err) {
    logger.warn(`prepareSubagentSpawn failed gracefully: ${String(err)}`);
    return null;
  }
}

/**
 * Handle onSubagentEnded — capture facts from subagent transcript.
 * Returns list of promoted fact paths, or empty array.
 */
export function handleSubagentEnded(
  ctx: SubagentEndedContext,
  db: TranscriptDb,
  config: MemoryConfig,
  logger: PluginLogger,
): string[] {
  try {
    // Guard: skip non-completed subagents
    if (ctx.exitReason !== "completed") {
      logger.info(`Skipping fact capture: subagent ${ctx.sessionId} exited with ${ctx.exitReason}`);
      return [];
    }

    // Guard: skip internal maintenance subagents
    const op = ctx.metadata?._nemoclawOp as NemoClawOp | undefined;
    if (op) {
      logger.info(`Skipping fact capture: internal ${op} subagent`);
      return [];
    }

    // Capture facts from transcript
    return promoteFromMessages(db, config, ctx.parentSessionId, ctx.messages, "auto", logger);
  } catch (err) {
    logger.warn(`onSubagentEnded failed gracefully: ${String(err)}`);
    return [];
  }
}

/**
 * Handle afterTurn — trigger async compaction if token threshold hit.
 */
export function handleAfterTurn(
  ctx: AfterTurnContext,
  sessionMgr: SessionManager,
  orchestrator: Orchestrator | null,
  logger: PluginLogger,
): void {
  try {
    if (!orchestrator) return;
    if (ctx.tokenCount >= sessionMgr.getConfig().compactionThreshold) {
      orchestrator.spawnCompaction(ctx.sessionId);
    }
  } catch (err) {
    logger.warn(`afterTurn failed gracefully: ${String(err)}`);
  }
}
