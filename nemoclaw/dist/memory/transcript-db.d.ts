import type { SessionRecord, SessionStatus, MessageRecord, MessageRole, CompactionRecord, PromotedFactRecord, FactSourceType } from "./types.js";
export declare class TranscriptDb {
    private db;
    constructor(dbPath: string);
    createSession(id: string, model: string | null): void;
    getSession(id: string): SessionRecord | undefined;
    updateSessionStatus(id: string, status: SessionStatus): void;
    closeSession(id: string): void;
    getActiveSessions(): SessionRecord[];
    updateSessionTokens(id: string, totalTokens: number): void;
    incrementCompactionCount(id: string): void;
    appendMessage(sessionId: string, role: MessageRole, content: string, tokenCount: number | null): number;
    getActiveMessages(sessionId: string): MessageRecord[];
    getAllMessages(sessionId: string): MessageRecord[];
    getMessagesInRange(sessionId: string, startId: number, endId: number): MessageRecord[];
    markMessagesCompacted(sessionId: string, compactionId: string, upToId: number): void;
    getSessionTokenCount(sessionId: string): number;
    getSessionMessageCount(sessionId: string): number;
    insertCompaction(compaction: CompactionRecord): void;
    getCompactions(sessionId: string): CompactionRecord[];
    insertPromotedFact(fact: PromotedFactRecord): void;
    isFactAlreadyPromoted(contentHash: string): boolean;
    getPromotedFacts(sessionId: string): PromotedFactRecord[];
    getPromotedFactCount(sessionId: string, source?: FactSourceType): number;
    integrityCheck(): boolean;
    close(): void;
}
//# sourceMappingURL=transcript-db.d.ts.map