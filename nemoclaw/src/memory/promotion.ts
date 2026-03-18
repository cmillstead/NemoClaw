// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Fact promotion -- extracts durable facts from session transcripts.
 *
 * Two modes:
 * 1. Agent-driven: /memory remember <fact> during conversation
 * 2. Hook-driven: End-of-session extraction (max 5 facts)
 *
 * All facts are deduplicated via SHA-256 content hash.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { PluginLogger } from "../index.js";
import type { TranscriptDb } from "./transcript-db.js";
import type { MemoryConfig, ParaCategory, FactSourceType, MessageRecord } from "./types.js";
import { contentHash, writeFact } from "./para.js";
import { extractFromMessages } from "./compaction.js";
import { scanForSecrets, scanForInjection } from "./sanitize.js";

interface PromotionCandidate {
  fact: string;
  category: ParaCategory;
  sourceType: FactSourceType;
  tags: string[];
  context?: string;
  priority: number;
}

/**
 * Promote a single fact immediately (agent-driven via /memory remember).
 * Returns the file path or throws on validation failure.
 */
export function promoteFactNow(
  db: TranscriptDb,
  config: MemoryConfig,
  sessionId: string,
  fact: string,
  category: ParaCategory = "areas",
  tags: string[] = [],
  logger: PluginLogger,
): string {
  // Check agent fact limit
  const agentCount = db.getPromotedFactCount(sessionId, "agent");
  if (agentCount >= config.maxAgentFacts) {
    throw new Error(`Agent fact limit reached (${String(config.maxAgentFacts)} per session)`);
  }

  // Deduplicate
  const hash = contentHash(fact);
  if (db.isFactAlreadyPromoted(hash)) {
    logger.info(`Fact already exists (hash: ${hash.slice(0, 20)}...)`);
    return "(duplicate -- already stored)";
  }

  // Write to PARA
  const result = writeFact(config.memoryDir, fact, category, sessionId, "agent", tags);

  // Record promotion
  db.insertPromotedFact({
    id: result.factId,
    session_id: sessionId,
    fact_file_path: result.filePath,
    content_hash: result.hash,
    promoted_at: new Date().toISOString(),
    source: "agent",
  });

  logger.info(`Fact promoted: ${result.filePath}`);
  return result.filePath;
}

/**
 * End-of-session fact extraction -- runs during session close.
 * Extracts up to maxAutoPromotedFacts candidates from the full transcript.
 */
export function promoteEndOfSession(
  db: TranscriptDb,
  config: MemoryConfig,
  sessionId: string,
  logger: PluginLogger,
): string[] {
  const messages = db.getAllMessages(sessionId);
  if (messages.length === 0) return [];

  const candidates = extractCandidates(messages);

  // Sort by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  const promoted: string[] = [];
  for (const candidate of candidates) {
    if (promoted.length >= config.maxAutoPromotedFacts) break;

    // Validate
    const secretCheck = scanForSecrets(candidate.fact);
    if (!secretCheck.valid) {
      logger.warn(`Skipping candidate (secret detected): ${secretCheck.reason ?? "unknown"}`);
      continue;
    }
    const injectionCheck = scanForInjection(candidate.fact);
    if (!injectionCheck.valid) {
      logger.warn(`Skipping candidate (injection detected): ${injectionCheck.reason ?? "unknown"}`);
      continue;
    }

    // Deduplicate
    const hash = contentHash(candidate.fact);
    if (db.isFactAlreadyPromoted(hash)) continue;

    try {
      const result = writeFact(
        config.memoryDir,
        candidate.fact,
        candidate.category,
        sessionId,
        "auto",
        candidate.tags,
        candidate.context,
      );

      db.insertPromotedFact({
        id: result.factId,
        session_id: sessionId,
        fact_file_path: result.filePath,
        content_hash: result.hash,
        promoted_at: new Date().toISOString(),
        source: "auto",
      });

      promoted.push(result.filePath);
      logger.info(`Auto-promoted fact: ${result.filePath}`);
    } catch (err) {
      logger.warn(`Failed to promote fact: ${String(err)}`);
    }
  }

  // Write daily note
  if (promoted.length > 0) {
    writeDailyNote(config.memoryDir, sessionId, promoted);
  }

  return promoted;
}

/**
 * Extract promotion candidates from messages.
 */
function extractCandidates(messages: MessageRecord[]): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];
  const extraction = extractFromMessages(messages);

  // Highest priority: explicit "remember" requests
  for (const req of extraction.rememberRequests) {
    candidates.push({
      fact: req,
      category: "areas",
      sourceType: "auto",
      tags: ["remember-request"],
      priority: 100,
    });
  }

  // Medium priority: decisions
  for (const decision of extraction.decisions) {
    candidates.push({
      fact: decision,
      category: "projects",
      sourceType: "auto",
      tags: ["decision"],
      priority: 50,
    });
  }

  return candidates;
}

/**
 * Write or update the daily note for today.
 */
function writeDailyNote(
  memoryDir: string,
  sessionId: string,
  promotedPaths: string[],
): void {
  try {
    const today = new Date().toISOString().split("T")[0];
    const dailyDir = join(memoryDir, "daily");
    mkdirSync(dailyDir, { recursive: true });
    const dailyPath = join(dailyDir, `${today}.md`);

    let content: string;
    if (existsSync(dailyPath)) {
      content = readFileSync(dailyPath, "utf-8");
      content += `\n- [[${sessionId}]]\n`;
      for (const p of promotedPaths) {
        const name = basename(p, ".md");
        content += `  - [[${name}]]\n`;
      }
    } else {
      const lines = [
        "---",
        `date: "${today}"`,
        "---",
        "",
        `# ${today}`,
        "",
        "## Sessions",
        `- [[${sessionId}]]`,
        "",
        "## Facts Promoted",
        ...promotedPaths.map((p) => `- [[${basename(p, ".md")}]]`),
        "",
        "> Part of [[_index]]",
        "",
      ];
      content = lines.join("\n");
    }

    writeFileSync(dailyPath, content, "utf-8");
  } catch {
    // Non-fatal -- daily notes are a convenience feature
  }
}
