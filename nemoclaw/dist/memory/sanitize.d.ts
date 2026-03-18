import type { SanitizeResult } from "./types.js";
/**
 * Scan content for secrets. Returns invalid result if any secret pattern matches.
 */
export declare function scanForSecrets(content: string): SanitizeResult;
/**
 * Scan content for prompt injection patterns.
 */
export declare function scanForInjection(content: string): SanitizeResult;
/**
 * Full content validation: secrets + injection + size.
 */
export declare function validateContent(content: string, maxSize: number): SanitizeResult;
/**
 * Validate that a resolved file path is within the allowed base directory.
 * Prevents symlink traversal attacks.
 */
export declare function validatePath(filePath: string, baseDir: string): SanitizeResult;
/**
 * Sanitize a string for use as a filename.
 * Lowercase, spaces to hyphens, strip special chars, max 60 chars.
 */
export declare function slugify(text: string): string;
//# sourceMappingURL=sanitize.d.ts.map