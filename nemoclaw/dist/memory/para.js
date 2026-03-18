"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMemoryDirs = ensureMemoryDirs;
exports.contentHash = contentHash;
exports.generateFactId = generateFactId;
exports.generateSessionId = generateSessionId;
exports.writeFact = writeFact;
exports.parseFact = parseFact;
exports.listFacts = listFacts;
exports.supersedeFact = supersedeFact;
exports.updateRootMoc = updateRootMoc;
exports.updateCategoryMoc = updateCategoryMoc;
exports.regenerateManifest = regenerateManifest;
/**
 * PARA file I/O — read, write, and manage atomic fact files.
 *
 * Each fact is an individual markdown file with YAML frontmatter,
 * stored in {memoryDir}/{category}/{slug}.md.
 *
 * Obsidian-compatible: valid YAML, wikilinks, parent MOC links.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const types_js_1 = require("./types.js");
const sanitize_js_1 = require("./sanitize.js");
// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------
/**
 * Ensure the full PARA directory structure exists.
 */
function ensureMemoryDirs(memoryDir) {
    const dirs = [
        memoryDir,
        (0, node_path_1.join)(memoryDir, "_db"),
        (0, node_path_1.join)(memoryDir, "sessions"),
        (0, node_path_1.join)(memoryDir, "daily"),
        ...types_js_1.PARA_CATEGORIES.map((c) => (0, node_path_1.join)(memoryDir, c)),
    ];
    for (const dir of dirs) {
        if (!(0, node_fs_1.existsSync)(dir)) {
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
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
function contentHash(fact) {
    const normalized = fact.trim().toLowerCase().replace(/\s+/g, " ");
    return "sha256:" + (0, node_crypto_1.createHash)("sha256").update(normalized).digest("hex");
}
// ---------------------------------------------------------------------------
// PARA fact I/O
// ---------------------------------------------------------------------------
/**
 * Generate a unique fact ID.
 */
function generateFactId() {
    return `fact-${(0, node_crypto_1.randomBytes)(8).toString("hex")}`;
}
/**
 * Generate a unique session ID.
 */
function generateSessionId() {
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    return `sess-${ts}-${(0, node_crypto_1.randomBytes)(4).toString("hex")}`;
}
/**
 * Resolve a collision-free filename for a fact.
 */
function resolveFilename(categoryDir, slug) {
    let filename = `${slug}.md`;
    let counter = 2;
    while ((0, node_fs_1.existsSync)((0, node_path_1.join)(categoryDir, filename))) {
        filename = `${slug}-${counter}.md`;
        counter++;
    }
    return filename;
}
/**
 * Write a PARA fact file. Returns the relative path within memoryDir.
 */
function writeFact(memoryDir, fact, category, sourceSession, sourceType, tags = [], context) {
    const maxFactSize = 10 * 1024;
    const validation = (0, sanitize_js_1.validateContent)(fact, maxFactSize);
    if (!validation.valid) {
        throw new Error(`Fact validation failed: ${validation.reason}`);
    }
    const categoryDir = (0, node_path_1.join)(memoryDir, category);
    ensureMemoryDirs(memoryDir);
    const factId = generateFactId();
    const hash = contentHash(fact);
    const slug = (0, sanitize_js_1.slugify)(fact);
    const filename = resolveFilename(categoryDir, slug || "unnamed-fact");
    const now = new Date().toISOString();
    const frontmatter = {
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
    const filePath = (0, node_path_1.join)(categoryDir, filename);
    const pathValidation = (0, sanitize_js_1.validatePath)(filePath, memoryDir);
    if (!pathValidation.valid) {
        throw new Error(`Path validation failed: ${pathValidation.reason}`);
    }
    (0, node_fs_1.writeFileSync)(filePath, content, "utf-8");
    return {
        filePath: (0, node_path_1.join)(category, filename),
        factId,
        hash,
    };
}
/**
 * Format a fact file with YAML frontmatter and body.
 */
function formatFactFile(fm, context) {
    const yamlLines = [
        "---",
        `id: ${fm.id}`,
        `fact: ${JSON.stringify(fm.fact)}`,
        `category: ${fm.category}`,
        `status: ${fm.status}`,
        `tags:`,
        ...fm.tags.map((t) => `  - ${t}`),
        `created_at: ${JSON.stringify(fm.created_at)}`,
        `updated_at: ${JSON.stringify(fm.updated_at)}`,
        `source_session: ${fm.source_session}`,
        `source_type: ${fm.source_type}`,
        `superseded_by: ${fm.superseded_by ?? "null"}`,
        `supersedes: ${fm.supersedes ?? "null"}`,
        `access_count: ${fm.access_count}`,
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
function parseFact(filePath) {
    try {
        const content = (0, node_fs_1.readFileSync)(filePath, "utf-8");
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match)
            return null;
        const yamlBlock = match[1];
        const fm = {};
        // Simple YAML parser for our known flat schema
        let currentKey = "";
        let inArray = false;
        const arrayItems = [];
        for (const line of yamlBlock.split("\n")) {
            const arrayItemMatch = line.match(/^\s{2}-\s+(.+)$/);
            if (inArray && arrayItemMatch) {
                arrayItems.push(arrayItemMatch[1]);
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
                let val = rawVal;
                // Parse JSON-quoted strings
                if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
                    try {
                        val = JSON.parse(rawVal);
                    }
                    catch {
                        val = rawVal.slice(1, -1);
                    }
                }
                else if (rawVal === "null") {
                    val = null;
                }
                else if (rawVal === "true") {
                    val = true;
                }
                else if (rawVal === "false") {
                    val = false;
                }
                else if (/^\d+$/.test(rawVal)) {
                    val = parseInt(rawVal, 10);
                }
                fm[key] = val;
            }
        }
        if (inArray) {
            fm[currentKey] = [...arrayItems];
        }
        return fm;
    }
    catch {
        return null;
    }
}
/**
 * List all fact files in a category. Returns absolute paths.
 */
function listFacts(memoryDir, category) {
    const categories = category ? [category] : [...types_js_1.PARA_CATEGORIES];
    const paths = [];
    for (const cat of categories) {
        const dir = (0, node_path_1.join)(memoryDir, cat);
        if (!(0, node_fs_1.existsSync)(dir))
            continue;
        const files = (0, node_fs_1.readdirSync)(dir).filter((f) => f.endsWith(".md") && f !== "_index.md");
        paths.push(...files.map((f) => (0, node_path_1.join)(dir, f)));
    }
    return paths;
}
/**
 * Supersede a fact: mark the old one as superseded, optionally link to new fact.
 */
function supersedeFact(filePath, supersededById) {
    try {
        const content = (0, node_fs_1.readFileSync)(filePath, "utf-8");
        let updated = content.replace(/^status: active$/m, "status: superseded");
        if (supersededById) {
            updated = updated.replace(/^superseded_by: null$/m, `superseded_by: ${supersededById}`);
        }
        updated = updated.replace(/^updated_at: .*$/m, `updated_at: ${JSON.stringify(new Date().toISOString())}`);
        (0, node_fs_1.writeFileSync)(filePath, updated, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Update the root MOC (_index.md) with links to category MOCs and recent items.
 */
function updateRootMoc(memoryDir) {
    const lines = [
        "# NemoClaw Memory",
        "",
        "## Categories",
        ...types_js_1.PARA_CATEGORIES.map((c) => `- [[${c}/_index|${c}]]`),
        "",
        "## Recent Sessions",
        "",
        `> Updated ${new Date().toISOString().split("T")[0]}`,
        "",
    ];
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(memoryDir, "_index.md"), lines.join("\n") + "\n", "utf-8");
}
/**
 * Update a category MOC (_index.md) listing all facts in that category.
 */
function updateCategoryMoc(memoryDir, category) {
    const dir = (0, node_path_1.join)(memoryDir, category);
    if (!(0, node_fs_1.existsSync)(dir))
        return;
    const facts = (0, node_fs_1.readdirSync)(dir)
        .filter((f) => f.endsWith(".md") && f !== "_index.md")
        .map((f) => (0, node_path_1.basename)(f, ".md"));
    const lines = [
        `# ${category.charAt(0).toUpperCase() + category.slice(1)}`,
        "",
        ...facts.map((f) => `- [[${f}]]`),
        "",
        `> Part of [[_index]]`,
        "",
    ];
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, "_index.md"), lines.join("\n"), "utf-8");
}
/**
 * Regenerate the integrity manifest (_manifest.json).
 * Maps each fact file path to its SHA-256 hash.
 */
function regenerateManifest(memoryDir) {
    const manifest = {};
    const allFacts = listFacts(memoryDir);
    for (const factPath of allFacts) {
        const content = (0, node_fs_1.readFileSync)(factPath, "utf-8");
        const hash = (0, node_crypto_1.createHash)("sha256").update(content).digest("hex");
        const relativePath = factPath.replace(memoryDir + "/", "");
        manifest[relativePath] = hash;
    }
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(memoryDir, "_manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
}
//# sourceMappingURL=para.js.map