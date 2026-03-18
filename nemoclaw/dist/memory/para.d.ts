import type { ParaCategory, ParaFactFrontmatter, FactSourceType } from "./types.js";
/**
 * Ensure the full PARA directory structure exists.
 */
export declare function ensureMemoryDirs(memoryDir: string): void;
/**
 * Compute a SHA-256 content hash of a normalized fact string.
 * Normalization: trim, lowercase, collapse whitespace.
 */
export declare function contentHash(fact: string): string;
/**
 * Generate a unique fact ID.
 */
export declare function generateFactId(): string;
/**
 * Generate a unique session ID.
 */
export declare function generateSessionId(): string;
/**
 * Write a PARA fact file. Returns the relative path within memoryDir.
 */
export declare function writeFact(memoryDir: string, fact: string, category: ParaCategory, sourceSession: string, sourceType: FactSourceType, tags?: string[], context?: string): {
    filePath: string;
    factId: string;
    hash: string;
};
/**
 * Parse a PARA fact file and return its frontmatter.
 * Returns null if parsing fails.
 */
export declare function parseFact(filePath: string): ParaFactFrontmatter | null;
/**
 * List all fact files in a category. Returns absolute paths.
 */
export declare function listFacts(memoryDir: string, category?: ParaCategory): string[];
/**
 * Supersede a fact: mark the old one as superseded, optionally link to new fact.
 */
export declare function supersedeFact(filePath: string, supersededById?: string): boolean;
/**
 * Update the root MOC (_index.md) with links to category MOCs and recent items.
 */
export declare function updateRootMoc(memoryDir: string): void;
/**
 * Update a category MOC (_index.md) listing all facts in that category.
 */
export declare function updateCategoryMoc(memoryDir: string, category: ParaCategory): void;
/**
 * Regenerate the integrity manifest (_manifest.json).
 * Maps each fact file path to its SHA-256 hash.
 */
export declare function regenerateManifest(memoryDir: string): void;
//# sourceMappingURL=para.d.ts.map