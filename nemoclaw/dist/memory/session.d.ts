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
export declare class SessionManager {
    private sessionId;
    private db;
    private config;
    private logger;
    constructor(db: TranscriptDb, config: MemoryConfig, logger: PluginLogger);
    /**
     * Start a new session. Recovers orphaned sessions first.
     */
    start(model?: string | null): string;
    /**
     * Append a message to the active session.
     * Returns true if compaction was triggered.
     */
    append(role: MessageRole, content: string): boolean;
    /**
     * Run extractive compaction on the active session.
     */
    private runCompaction;
    /**
     * Close the active session.
     */
    close(): void;
    /**
     * Recover orphaned sessions from previous crashes.
     */
    private recoverOrphanedSessions;
    /**
     * Get the current session ID, or null if no active session.
     */
    getSessionId(): string | null;
    /**
     * Get the TranscriptDb instance (for use by promotion and commands).
     */
    getDb(): TranscriptDb;
    /**
     * Get the memory config (for use by promotion and commands).
     */
    getConfig(): MemoryConfig;
    /**
     * Get current service state for status reporting.
     */
    getState(): MemoryServiceState;
    /**
     * Get compaction summaries for the active session (for drill-back).
     */
    getCompactionSummaries(): string[];
    /**
     * Expand a compaction -- retrieve the original messages by compaction ID.
     */
    expandCompaction(compactionId: string): string | null;
}
//# sourceMappingURL=session.d.ts.map