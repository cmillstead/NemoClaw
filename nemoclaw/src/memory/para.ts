// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * PARA file I/O — read, write, and manage atomic fact files.
 *
 * Each fact is an individual markdown file with YAML frontmatter,
 * stored in {memoryDir}/{category}/{slug}.md.
 *
 * Obsidian-compatible: valid YAML, wikilinks, parent MOC links.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { ParaCategory, ParaFactFrontmatter, FactSourceType } from "./types.js";
import { PARA_CATEGORIES } from "./types.js";
import { slugify, validateContent, validatePath } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

/**
 * Ensure the full PARA directory structure exists.
 */
export function ensureMemoryDirs(memoryDir: string): void {
  const dirs = [
    memoryDir,
    join(memoryDir, "_db"),
    join(memoryDir, "sessions"),
    join(memoryDir, "daily"),
    ...PARA_CATEGORIES.map((c) => join(memoryDir, c)),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 content hash of a normalized fact string.
 * Normalization: trim, lowercase, collapse whitespace.
 */
export function contentHash(fact: string): string {
  const normalized = fact.trim().toLowerCase().replace(/\s+/g, " ");
  return "sha256:" + createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// PARA fact I/O
// ---------------------------------------------------------------------------

/**
 * Generate a unique fact ID.
 */
export function generateFactId(): string {
  return `fact-${randomBytes(8).toString("hex")}`;
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `sess-${ts}-${randomBytes(4).toString("hex")}`;
}

/**
 * Resolve a collision-free filename for a fact.
 */
function resolveFilename(categoryDir: string, slug: string): string {
  let filename = `${slug}.md`;
  let counter = 2;
  while (existsSync(join(categoryDir, filename))) {
    filename = `${slug}-${String(counter)}.md`;
    counter++;
  }
  return filename;
}

/**
 * Write a PARA fact file. Returns the relative path within memoryDir.
 */
export function writeFact(
  memoryDir: string,
  fact: string,
  category: ParaCategory,
  sourceSession: string,
  sourceType: FactSourceType,
  tags: string[] = [],
  context?: string,
): { filePath: string; factId: string; hash: string } {
  const maxFactSize = 10 * 1024;
  const validation = validateContent(fact, maxFactSize);
  if (!validation.valid) {
    throw new Error(`Fact validation failed: ${validation.reason ?? ""}`);
  }

  const categoryDir = join(memoryDir, category);
  ensureMemoryDirs(memoryDir);

  const factId = generateFactId();
  const hash = contentHash(fact);
  const slug = slugify(fact);
  const filename = resolveFilename(categoryDir, slug || "unnamed-fact");
  const now = new Date().toISOString();

  const frontmatter: ParaFactFrontmatter = {
    id: factId,
    fact,
    category,
    status: "active",
    tags,
    created_at: now,
    updated_at: now,
    source_session: sourceSession,
    source_type: sourceType,
    superseded_by: null,
    supersedes: null,
    access_count: 0,
    content_hash: hash,
  };

  const content = formatFactFile(frontmatter, context);
  const filePath = join(categoryDir, filename);

  const pathValidation = validatePath(filePath, memoryDir);
  if (!pathValidation.valid) {
    throw new Error(`Path validation failed: ${pathValidation.reason ?? ""}`);
  }

  writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });

  return {
    filePath: join(category, filename),
    factId,
    hash,
  };
}

/**
 * Format a fact file with YAML frontmatter and body.
 */
function formatFactFile(fm: ParaFactFrontmatter, context?: string): string {
  const yamlLines = [
    "---",
    `id: ${JSON.stringify(fm.id)}`,
    `fact: ${JSON.stringify(fm.fact)}`,
    `category: ${JSON.stringify(fm.category)}`,
    `status: ${JSON.stringify(fm.status)}`,
    `tags:`,
    ...fm.tags.map((t) => `  - ${JSON.stringify(t)}`),
    `created_at: ${JSON.stringify(fm.created_at)}`,
    `updated_at: ${JSON.stringify(fm.updated_at)}`,
    `source_session: ${JSON.stringify(fm.source_session)}`,
    `source_type: ${JSON.stringify(fm.source_type)}`,
    `superseded_by: ${fm.superseded_by != null ? JSON.stringify(fm.superseded_by) : "null"}`,
    `supersedes: ${fm.supersedes != null ? JSON.stringify(fm.supersedes) : "null"}`,
    `access_count: ${String(fm.access_count)}`,
    `content_hash: ${JSON.stringify(fm.content_hash)}`,
    "---",
    "",
    fm.fact,
  ];

  if (context) {
    yamlLines.push("", "## Context", "", context);
  }

  yamlLines.push("", `> Part of [[_index]]`);

  return yamlLines.join("\n") + "\n";
}

/**
 * Parse a PARA fact file and return its frontmatter.
 * Returns null if parsing fails.
 */
export function parseFact(filePath: string): ParaFactFrontmatter | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yamlBlock = match[1];
    const fm: Record<string, unknown> = {};

    // Simple YAML parser for our known flat schema
    let currentKey = "";
    let inArray = false;
    const arrayItems: string[] = [];

    for (const line of yamlBlock.split("\n")) {
      const arrayItemMatch = line.match(/^\s{2}-\s+(.+)$/);
      if (inArray && arrayItemMatch) {
        let item = arrayItemMatch[1];
        // Parse JSON-quoted array items (written by JSON.stringify)
        if (item.startsWith('"') && item.endsWith('"')) {
          try {
            item = JSON.parse(item) as string;
          } catch {
            item = item.slice(1, -1);
          }
        }
        arrayItems.push(item);
        continue;
      }

      if (inArray) {
        fm[currentKey] = [...arrayItems];
        inArray = false;
        arrayItems.length = 0;
      }

      const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        const [, key, rawVal] = kvMatch;
        currentKey = key;

        if (rawVal.trim() === "") {
          // Could be start of array
          inArray = true;
          continue;
        }

        let val: unknown = rawVal;
        // Parse JSON-quoted strings
        if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
          try {
            val = JSON.parse(rawVal);
          } catch {
            val = rawVal.slice(1, -1);
          }
        } else if (rawVal === "null") {
          val = null;
        } else if (rawVal === "true") {
          val = true;
        } else if (rawVal === "false") {
          val = false;
        } else if (/^\d+$/.test(rawVal)) {
          val = parseInt(rawVal, 10);
        }

        fm[key] = val;
      }
    }

    if (inArray) {
      fm[currentKey] = [...arrayItems];
    }

    return fm as unknown as ParaFactFrontmatter;
  } catch {
    return null;
  }
}

/**
 * List all fact files in a category. Returns absolute paths.
 */
export function listFacts(memoryDir: string, category?: ParaCategory): string[] {
  const categories = category ? [category] : [...PARA_CATEGORIES];
  const paths: string[] = [];

  for (const cat of categories) {
    const dir = join(memoryDir, cat);
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "_index.md");
    paths.push(...files.map((f) => join(dir, f)));
  }

  return paths;
}

/**
 * Supersede a fact: mark the old one as superseded, optionally link to new fact.
 */
export function supersedeFact(filePath: string, supersededById?: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8");
    let updated = content.replace(/^status: "active"$/m, 'status: "superseded"');
    if (supersededById) {
      updated = updated.replace(
        /^superseded_by: null$/m,
        `superseded_by: ${JSON.stringify(supersededById)}`,
      );
    }
    updated = updated.replace(
      /^updated_at: .*$/m,
      `updated_at: ${JSON.stringify(new Date().toISOString())}`,
    );
    writeFileSync(filePath, updated, { encoding: "utf-8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the root MOC (_index.md) with links to category MOCs and recent items.
 */
export function updateRootMoc(memoryDir: string): void {
  const lines = [
    "# NemoClaw Memory",
    "",
    "## Categories",
    ...PARA_CATEGORIES.map((c) => `- [[${c}/_index|${c}]]`),
    "",
    "## Recent Sessions",
    "",
    `> Updated ${new Date().toISOString().split("T")[0]}`,
    "",
  ];
  writeFileSync(join(memoryDir, "_index.md"), lines.join("\n") + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Update a category MOC (_index.md) listing all facts in that category.
 */
export function updateCategoryMoc(memoryDir: string, category: ParaCategory): void {
  const dir = join(memoryDir, category);
  if (!existsSync(dir)) return;

  const facts = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "_index.md")
    .map((f) => basename(f, ".md"));

  const lines = [
    `# ${category.charAt(0).toUpperCase() + category.slice(1)}`,
    "",
    ...facts.map((f) => `- [[${f}]]`),
    "",
    `> Part of [[_index]]`,
    "",
  ];
  writeFileSync(join(dir, "_index.md"), lines.join("\n"), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Regenerate the integrity manifest (_manifest.json).
 * Maps each fact file path to its SHA-256 hash.
 */
export function regenerateManifest(memoryDir: string): void {
  const manifest: Record<string, string> = {};
  const allFacts = listFacts(memoryDir);

  for (const factPath of allFacts) {
    const content = readFileSync(factPath, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = factPath.replace(memoryDir + "/", "");
    manifest[relativePath] = hash;
  }

  writeFileSync(join(memoryDir, "_manifest.json"), JSON.stringify(manifest, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}
