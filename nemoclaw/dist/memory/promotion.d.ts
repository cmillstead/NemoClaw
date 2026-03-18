import type { PluginLogger } from "../index.js";
import type { TranscriptDb } from "./transcript-db.js";
import type { MemoryConfig, ParaCategory } from "./types.js";
/**
 * Promote a single fact immediately (agent-driven via /memory remember).
 * Returns the file path or throws on validation failure.
 */
export declare function promoteFactNow(db: TranscriptDb, config: MemoryConfig, sessionId: string, fact: string, category: ParaCategory | undefined, tags: string[] | undefined, logger: PluginLogger): string;
/**
 * End-of-session fact extraction -- runs during session close.
 * Extracts up to maxAutoPromotedFacts candidates from the full transcript.
 */
export declare function promoteEndOfSession(db: TranscriptDb, config: MemoryConfig, sessionId: string, logger: PluginLogger): string[];
//# sourceMappingURL=promotion.d.ts.map