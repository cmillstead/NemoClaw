// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Content validation for memory system.
 *
 * Defenses:
 * 1. Secret scanning — reject API keys, credentials, private keys
 * 2. Injection detection — reject prompt injection patterns
 * 3. Path validation — canonicalize paths, reject symlink traversal
 * 4. Size limits — enforce per-file and per-volume quotas
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { SanitizeResult } from "./types.js";

// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: readonly { pattern: RegExp; redact: RegExp; label: string }[] = [
  {
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/,
    redact: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    label: "OpenAI API key",
  },
  {
    pattern: /\bsk-or-[a-zA-Z0-9]{20,}\b/,
    redact: /\bsk-or-[a-zA-Z0-9]{20,}\b/g,
    label: "OpenRouter API key",
  },
  {
    pattern: /\bnvapi-[a-zA-Z0-9]{20,}\b/,
    redact: /\bnvapi-[a-zA-Z0-9]{20,}\b/g,
    label: "NVIDIA API key",
  },
  { pattern: /\bghp_[a-zA-Z0-9]{36,}\b/, redact: /\bghp_[a-zA-Z0-9]{36,}\b/g, label: "GitHub PAT" },
  {
    pattern: /\bghs_[a-zA-Z0-9]{36,}\b/,
    redact: /\bghs_[a-zA-Z0-9]{36,}\b/g,
    label: "GitHub App token",
  },
  {
    pattern: /\bglpat-[a-zA-Z0-9]{20,}\b/,
    redact: /\bglpat-[a-zA-Z0-9]{20,}\b/g,
    label: "GitLab PAT",
  },
  {
    pattern: /\bxoxb-[a-zA-Z0-9-]{20,}\b/,
    redact: /\bxoxb-[a-zA-Z0-9-]{20,}\b/g,
    label: "Slack bot token",
  },
  {
    pattern: /\bxoxp-[a-zA-Z0-9-]{20,}\b/,
    redact: /\bxoxp-[a-zA-Z0-9-]{20,}\b/g,
    label: "Slack user token",
  },
  {
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    redact:
      /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    label: "Private key",
  },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, redact: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS access key" },
  {
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    redact: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    label: "Google API key",
  },
  {
    pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/,
    redact: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    label: "Anthropic API key",
  },
  {
    pattern: /\bhf_[a-zA-Z0-9]{20,}\b/,
    redact: /\bhf_[a-zA-Z0-9]{20,}\b/g,
    label: "Hugging Face token",
  },
  {
    pattern: /\b\d{8,}:[A-Za-z0-9_-]{35,}\b/,
    redact: /\b\d{8,}:[A-Za-z0-9_-]{35,}\b/g,
    label: "Telegram bot token",
  },
  {
    pattern: /\bexport\s+[A-Z_]+=\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/,
    redact: /\bexport\s+[A-Z_]+=\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/g,
    label: "Exported credential",
  },
];

// ---------------------------------------------------------------------------
// Injection patterns
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
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
export function scanForSecrets(content: string): SanitizeResult {
  if (content.length > 1_048_576) {
    content = content.slice(0, 1_048_576);
  }
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
export function scanForInjection(content: string): SanitizeResult {
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
export function validateContent(content: string, maxSize: number): SanitizeResult {
  if (content.length === 0) {
    return { valid: false, reason: "Content is empty" };
  }
  if (Buffer.byteLength(content, "utf-8") > maxSize) {
    return { valid: false, reason: `Content exceeds maximum size of ${String(maxSize)} bytes` };
  }

  const secretResult = scanForSecrets(content);
  if (!secretResult.valid) return secretResult;

  const injectionResult = scanForInjection(content);
  if (!injectionResult.valid) return injectionResult;

  return { valid: true };
}

/**
 * Validate that a resolved file path is within the allowed base directory.
 * Prevents symlink traversal attacks.
 */
export function validatePath(filePath: string, baseDir: string): SanitizeResult {
  try {
    const resolvedBase = resolve(baseDir);
    // Use realpathSync to resolve symlinks — if the file exists
    let resolvedPath: string;
    try {
      resolvedPath = realpathSync(filePath);
    } catch {
      // File doesn't exist yet — resolve without symlink resolution
      resolvedPath = resolve(filePath);
    }

    if (!resolvedPath.startsWith(resolvedBase + "/") && resolvedPath !== resolvedBase) {
      return { valid: false, reason: `Path escapes base directory: ${resolvedPath}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Path validation error: ${String(err)}` };
  }
}

/**
 * Replace all detected secrets with [REDACTED].
 * Single source of truth for secret redaction — used by session.ts and compaction.ts.
 */
export function redactAllSecrets(text: string): string {
  const result = scanForSecrets(text);
  if (result.valid) return text; // No secrets found
  let redacted = text;
  for (const { redact } of SECRET_PATTERNS) {
    redacted = redacted.replace(redact, "[REDACTED]");
  }
  return redacted;
}

/**
 * Sanitize a string for use as a filename.
 * Lowercase, spaces to hyphens, strip special chars, max 60 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
