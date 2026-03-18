// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Extractive compaction engine — no LLM required.
 *
 * Algorithm:
 * 1. Group messages into user+assistant exchange pairs
 * 2. Extract: topics, decisions, code artifacts, remember requests
 * 3. Format as structured markdown summary
 *
 * Why extractive: deterministic, testable, fast, agent-agnostic.
 */

import { randomBytes } from "node:crypto";
import type { MessageRecord, CompactionExtraction, CompactionResult } from "./types.js";

// ---------------------------------------------------------------------------
// Stop words for topic extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "too",
  "up",
  "us",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yes",
  "you",
  "your",
  "can",
  "could",
  "do",
  "does",
  "did",
  "had",
  "may",
  "might",
  "shall",
  "should",
  "about",
  "after",
  "again",
  "all",
  "also",
  "am",
  "any",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "came",
  "come",
  "each",
  "even",
  "few",
  "get",
  "got",
  "here",
  "him",
  "however",
  "know",
  "let",
  "like",
  "look",
  "make",
  "many",
  "more",
  "most",
  "much",
  "must",
  "new",
  "now",
  "off",
  "ok",
  "okay",
  "old",
  "one",
  "only",
  "other",
  "out",
  "own",
  "part",
  "please",
  "put",
  "right",
  "said",
  "same",
  "see",
  "still",
  "take",
  "tell",
  "think",
  "those",
  "through",
  "two",
  "under",
  "upon",
  "want",
  "way",
  "well",
  "went",
]);

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Extract a topic summary from a user message: first meaningful phrase or truncated to 80 chars. */
function extractTopic(content: string): string | null {
  const cleaned = content.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return null;

  // Take the first sentence or 80 chars
  const firstSentence = cleaned.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 77) + "...";
}

/** Extract decision patterns from content. */
function extractDecisions(content: string): string[] {
  const decisions: string[] = [];
  const patterns = [
    /(?:I'll|I will|Let's|Let us|We should|We'll|We will|Going to|Decided to)\s+[^.!?\n]{5,80}/gi,
  ];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      decisions.push(...matches.map((m) => m.trim()));
    }
  }
  return decisions;
}

/** Extract code artifacts: file paths, function names, module references. */
function extractCodeArtifacts(content: string): string[] {
  const artifacts = new Set<string>();

  // File paths (Unix-style)
  const pathMatches = content.match(/(?:\/[\w.-]+){2,}/g);
  if (pathMatches) {
    for (const p of pathMatches) artifacts.add(p);
  }

  // File paths with extensions (relative)
  const relPathMatches = content.match(
    /[\w.-]+\/[\w.-]+\.(?:ts|js|py|md|json|yaml|yml|toml|sql)\b/g,
  );
  if (relPathMatches) {
    for (const p of relPathMatches) artifacts.add(p);
  }

  // Function/method names with parens
  const funcMatches = content.match(/\b[a-z][a-zA-Z0-9_]*\([^)]{0,50}\)/g);
  if (funcMatches) {
    for (const f of funcMatches) artifacts.add(f);
  }

  return [...artifacts].slice(0, 20);
}

/** Extract explicit "remember" requests. */
function extractRememberRequests(content: string): string[] {
  const requests: string[] = [];
  const patterns = [
    /(?:remember|note|keep\s+in\s+mind|don't\s+forget)\s*(?:that\s+)?:?\s*([^.!?\n]{5,200})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      requests.push(match[1].trim());
    }
  }
  return requests;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token count estimation: ~4 chars per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Run extractive compaction on a list of messages.
 *
 * @param sessionId - Session ID
 * @param messages - Active (non-compacted) messages, ordered by ID ascending
 * @param threshold - Token threshold that triggered compaction
 * @returns CompactionResult with structured summary, or null if no compaction needed
 */
export function compact(
  sessionId: string,
  messages: MessageRecord[],
  threshold: number,
): CompactionResult | null {
  if (messages.length === 0) return null;

  const totalTokens = messages.reduce(
    (sum, m) => sum + (m.token_count ?? estimateTokens(m.content)),
    0,
  );
  if (totalTokens < threshold) return null;

  // Keep the most recent 20% of messages active
  const keepCount = Math.max(2, Math.ceil(messages.length * 0.2));
  const toCompact = messages.slice(0, messages.length - keepCount);

  if (toCompact.length === 0) return null;

  // Extract information from messages being compacted
  const extraction = extractFromMessages(toCompact);

  // Format as structured summary
  const summary = formatSummary(extraction);

  const compactionId = `comp-${new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14)}-${randomBytes(4).toString("hex")}`;

  const originalTokenCount = toCompact.reduce(
    (sum, m) => sum + (m.token_count ?? estimateTokens(m.content)),
    0,
  );

  return {
    id: compactionId,
    summary,
    messageRangeStart: toCompact[0].id,
    messageRangeEnd: toCompact[toCompact.length - 1].id,
    originalTokenCount,
    summaryTokenCount: estimateTokens(summary),
    extraction,
  };
}

/** Extract structured information from a set of messages. */
export function extractFromMessages(messages: MessageRecord[]): CompactionExtraction {
  const topics: string[] = [];
  const decisions: string[] = [];
  const codeArtifacts: string[] = [];
  const rememberRequests: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const topic = extractTopic(msg.content);
      if (topic) topics.push(topic);
      rememberRequests.push(...extractRememberRequests(msg.content));
    }

    decisions.push(...extractDecisions(msg.content));
    codeArtifacts.push(...extractCodeArtifacts(msg.content));
  }

  // Deduplicate
  return {
    topics: [...new Set(topics)],
    decisions: [...new Set(decisions)],
    codeArtifacts: [...new Set(codeArtifacts)],
    rememberRequests: [...new Set(rememberRequests)],
  };
}

/** Format extraction results as a structured markdown summary. */
function formatSummary(extraction: CompactionExtraction): string {
  const sections: string[] = [];

  if (extraction.topics.length > 0) {
    sections.push("### Topics\n" + extraction.topics.map((t) => `- ${t}`).join("\n"));
  }

  if (extraction.decisions.length > 0) {
    sections.push("### Decisions\n" + extraction.decisions.map((d) => `- ${d}`).join("\n"));
  }

  if (extraction.codeArtifacts.length > 0) {
    sections.push(
      "### Code Artifacts\n" + extraction.codeArtifacts.map((a) => `- \`${a}\``).join("\n"),
    );
  }

  if (extraction.rememberRequests.length > 0) {
    sections.push("### Remember\n" + extraction.rememberRequests.map((r) => `- ${r}`).join("\n"));
  }

  if (sections.length === 0) {
    return "### Summary\n- (No structured content extracted from compacted messages)";
  }

  return sections.join("\n\n");
}

/**
 * Extract keywords from text for search queries.
 * Removes stop words, takes top N by frequency.
 */
export function extractKeywords(text: string, limit: number = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Sort by frequency descending
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}
