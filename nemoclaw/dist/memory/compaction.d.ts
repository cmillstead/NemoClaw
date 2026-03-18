import type { MessageRecord, CompactionExtraction, CompactionResult } from "./types.js";
/** Rough token count estimation: ~4 chars per token for English text. */
export declare function estimateTokens(text: string): number;
/**
 * Run extractive compaction on a list of messages.
 *
 * @param sessionId - Session ID
 * @param messages - Active (non-compacted) messages, ordered by ID ascending
 * @param threshold - Token threshold that triggered compaction
 * @returns CompactionResult with structured summary, or null if no compaction needed
 */
export declare function compact(sessionId: string, messages: MessageRecord[], threshold: number): CompactionResult | null;
/** Extract structured information from a set of messages. */
export declare function extractFromMessages(messages: MessageRecord[]): CompactionExtraction;
/**
 * Extract keywords from text for search queries.
 * Removes stop words, takes top N by frequency.
 */
export declare function extractKeywords(text: string, limit?: number): string[];
//# sourceMappingURL=compaction.d.ts.map