// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Session lifecycle manager.
 *
 * Manages the state machine: IDLE -> ACTIVE -> COMPACTING -> PROMOTING -> CLOSED
 *
 * Depends on:
 *  - TranscriptDb for persistence
 *  - compact() for extractive compaction
 *  - PARA operations for fact promotion
 */

import type { PluginLogger } from "../index.js";
import type { TranscriptDb } from "./transcript-db.js";
import type { MessageRole, MemoryConfig, MemoryServiceState } from "./types.js";
import { compact, estimateTokens } from "./compaction.js";
import { generateSessionId } from "./para.js";

export class SessionManager {
  private sessionId: string | null = null;
  private db: TranscriptDb;
  private config: MemoryConfig;
  private logger: PluginLogger;

  constructor(db: TranscriptDb, config: MemoryConfig, logger: PluginLogger) {
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Start a new session. Recovers orphaned sessions first.
   */
  start(model: string | null = null): string {
    this.recoverOrphanedSessions();

    const id = generateSessionId();
    this.db.createSession(id, model);
    this.sessionId = id;
    this.logger.info(`Memory session started: ${id}`);
    return id;
  }

  /**
   * Append a message to the active session.
   * Returns true if compaction was triggered.
   */
  append(role: MessageRole, content: string): boolean {
    if (!this.sessionId) {
      this.logger.warn("No active session -- message not recorded");
      return false;
    }

    const tokenCount = estimateTokens(content);
    this.db.appendMessage(this.sessionId, role, content, tokenCount);

    // Update total tokens
    const totalTokens = this.db.getSessionTokenCount(this.sessionId);
    this.db.updateSessionTokens(this.sessionId, totalTokens);

    // Check if compaction is needed
    if (totalTokens >= this.config.compactionThreshold) {
      return this.runCompaction();
    }

    return false;
  }

  /**
   * Run extractive compaction on the active session.
   */
  private runCompaction(): boolean {
    if (!this.sessionId) return false;

    this.db.updateSessionStatus(this.sessionId, "compacting");
    this.logger.info(`Compacting session ${this.sessionId}...`);

    try {
      const messages = this.db.getActiveMessages(this.sessionId);
      const result = compact(this.sessionId, messages, this.config.compactionThreshold);

      if (!result) {
        this.db.updateSessionStatus(this.sessionId, "active");
        return false;
      }

      // Store compaction
      this.db.insertCompaction({
        id: result.id,
        session_id: this.sessionId,
        summary: result.summary,
        message_range_start: result.messageRangeStart,
        message_range_end: result.messageRangeEnd,
        original_token_count: result.originalTokenCount,
        summary_token_count: result.summaryTokenCount,
        created_at: new Date().toISOString(),
      });

      // Mark messages as compacted
      this.db.markMessagesCompacted(this.sessionId, result.id, result.messageRangeEnd);
      this.db.incrementCompactionCount(this.sessionId);

      this.db.updateSessionStatus(this.sessionId, "active");
      this.logger.info(
        `Compaction complete: ${result.originalTokenCount} -> ${result.summaryTokenCount} tokens`,
      );
      return true;
    } catch (err) {
      this.logger.error(`Compaction failed: ${String(err)}`);
      this.db.updateSessionStatus(this.sessionId, "active");
      return false;
    }
  }

  /**
   * Close the active session.
   */
  close(): void {
    if (!this.sessionId) return;

    this.db.updateSessionStatus(this.sessionId, "promoting");
    this.logger.info(`Closing session ${this.sessionId}`);

    // Promotion happens externally (promotion.ts handles end-of-session extraction)
    this.db.closeSession(this.sessionId);
    this.logger.info(`Session closed: ${this.sessionId}`);
    this.sessionId = null;
  }

  /**
   * Recover orphaned sessions from previous crashes.
   */
  private recoverOrphanedSessions(): void {
    const active = this.db.getActiveSessions();
    for (const session of active) {
      this.logger.warn(`Recovering orphaned session: ${session.id}`);
      this.db.closeSession(session.id);
    }
  }

  /**
   * Get the current session ID, or null if no active session.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the TranscriptDb instance (for use by promotion and commands).
   */
  getDb(): TranscriptDb {
    return this.db;
  }

  /**
   * Get the memory config (for use by promotion and commands).
   */
  getConfig(): MemoryConfig {
    return this.config;
  }

  /**
   * Get current service state for status reporting.
   */
  getState(): MemoryServiceState {
    if (!this.sessionId) {
      return {
        sessionId: null,
        status: "idle",
        messageCount: 0,
        tokenCount: 0,
        compactionCount: 0,
      };
    }

    const session = this.db.getSession(this.sessionId);
    return {
      sessionId: this.sessionId,
      status: session?.status ?? "active",
      messageCount: this.db.getSessionMessageCount(this.sessionId),
      tokenCount: this.db.getSessionTokenCount(this.sessionId),
      compactionCount: session?.compaction_count ?? 0,
    };
  }

  /**
   * Get compaction summaries for the active session (for drill-back).
   */
  getCompactionSummaries(): string[] {
    if (!this.sessionId) return [];
    return this.db.getCompactions(this.sessionId).map((c) => c.summary);
  }

  /**
   * Expand a compaction -- retrieve the original messages by compaction ID.
   */
  expandCompaction(compactionId: string): string | null {
    if (!this.sessionId) return null;
    const comps = this.db.getCompactions(this.sessionId);
    const comp = comps.find((c) => c.id === compactionId);
    if (!comp) return null;

    const messages = this.db.getMessagesInRange(
      this.sessionId,
      comp.message_range_start,
      comp.message_range_end,
    );

    return messages
      .map((m) => `**${m.role}** (${m.created_at}): ${m.content}`)
      .join("\n\n");
  }
}
