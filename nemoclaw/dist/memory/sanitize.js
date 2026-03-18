"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanForSecrets = scanForSecrets;
exports.scanForInjection = scanForInjection;
exports.validateContent = validateContent;
exports.validatePath = validatePath;
exports.slugify = slugify;
/**
 * Content validation for memory system.
 *
 * Defenses:
 * 1. Secret scanning — reject API keys, credentials, private keys
 * 2. Injection detection — reject prompt injection patterns
 * 3. Path validation — canonicalize paths, reject symlink traversal
 * 4. Size limits — enforce per-file and per-volume quotas
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
    { pattern: /\bsk-[a-zA-Z0-9]{20,}\b/, label: "OpenAI API key" },
    { pattern: /\bsk-or-[a-zA-Z0-9]{20,}\b/, label: "OpenRouter API key" },
    { pattern: /\bnvapi-[a-zA-Z0-9]{20,}\b/, label: "NVIDIA API key" },
    { pattern: /\bghp_[a-zA-Z0-9]{36,}\b/, label: "GitHub PAT" },
    { pattern: /\bghs_[a-zA-Z0-9]{36,}\b/, label: "GitHub App token" },
    { pattern: /\bglpat-[a-zA-Z0-9]{20,}\b/, label: "GitLab PAT" },
    { pattern: /\bxoxb-[a-zA-Z0-9-]{20,}\b/, label: "Slack bot token" },
    { pattern: /\bxoxp-[a-zA-Z0-9-]{20,}\b/, label: "Slack user token" },
    { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, label: "Private key" },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key" },
    { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
    { pattern: /\bexport\s+[A-Z_]+=\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/, label: "Exported credential" },
];
// ---------------------------------------------------------------------------
// Injection patterns
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS = [
    { pattern: /ignore\s+(all\s+)?(previous\s+)?instructions/i, label: "Instruction override" },
    { pattern: /you\s+are\s+(now|a)\b/i, label: "Identity override" },
    { pattern: /^system\s*:/im, label: "System role injection" },
    { pattern: /\bexecute\s+(the\s+following|this)\b/i, label: "Command execution" },
    { pattern: /\bdo\s+not\s+follow\b/i, label: "Instruction negation" },
    { pattern: /\bdisregard\b.*\binstructions?\b/i, label: "Instruction disregard" },
    { pattern: /\bforget\s+(everything|all)\b/i, label: "Memory wipe attempt" },
    { pattern: /\bpretend\s+(you\s+are|to\s+be)\b/i, label: "Role impersonation" },
];
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Scan content for secrets. Returns invalid result if any secret pattern matches.
 */
function scanForSecrets(content) {
    for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(content)) {
            return { valid: false, reason: `Content contains potential ${label}` };
        }
    }
    return { valid: true };
}
/**
 * Scan content for prompt injection patterns.
 */
function scanForInjection(content) {
    for (const { pattern, label } of INJECTION_PATTERNS) {
        if (pattern.test(content)) {
            return { valid: false, reason: `Content contains injection pattern: ${label}` };
        }
    }
    return { valid: true };
}
/**
 * Full content validation: secrets + injection + size.
 */
function validateContent(content, maxSize) {
    if (content.length === 0) {
        return { valid: false, reason: "Content is empty" };
    }
    if (Buffer.byteLength(content, "utf-8") > maxSize) {
        return { valid: false, reason: `Content exceeds maximum size of ${maxSize} bytes` };
    }
    const secretResult = scanForSecrets(content);
    if (!secretResult.valid)
        return secretResult;
    const injectionResult = scanForInjection(content);
    if (!injectionResult.valid)
        return injectionResult;
    return { valid: true };
}
/**
 * Validate that a resolved file path is within the allowed base directory.
 * Prevents symlink traversal attacks.
 */
function validatePath(filePath, baseDir) {
    try {
        const resolvedBase = (0, node_path_1.resolve)(baseDir);
        // Use realpathSync to resolve symlinks — if the file exists
        let resolvedPath;
        try {
            resolvedPath = (0, node_fs_1.realpathSync)(filePath);
        }
        catch {
            // File doesn't exist yet — resolve without symlink resolution
            resolvedPath = (0, node_path_1.resolve)(filePath);
        }
        if (!resolvedPath.startsWith(resolvedBase + "/") && resolvedPath !== resolvedBase) {
            return { valid: false, reason: `Path escapes base directory: ${resolvedPath}` };
        }
        return { valid: true };
    }
    catch (err) {
        return { valid: false, reason: `Path validation error: ${String(err)}` };
    }
}
/**
 * Sanitize a string for use as a filename.
 * Lowercase, spaces to hyphens, strip special chars, max 60 chars.
 */
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
}
//# sourceMappingURL=sanitize.js.map