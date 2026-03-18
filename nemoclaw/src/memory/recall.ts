// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Auto-recall hook -- registered via api.on() in the plugin.
 *
 * Queries QMD for relevant memories and formats them as <recalled-memory> XML tags.
 * Falls back gracefully if QMD is unavailable.
 *
 * Query strategy:
 *   1. Extract keywords from user message
 *   2. QMD keyword search (~30ms)
 *   3. If < 2 results: QMD vector search (~2s fallback)
 *   4. Format as XML context block (max ~500 tokens)
 */

import { execFileSync } from "node:child_process";
import { extractKeywords } from "./compaction.js";

const MAX_RECALL_TOKENS = 500;
const MIN_KEYWORD_RESULTS = 2;

interface RecallResult {
  path: string;
  content: string;
  score: number;
}

/**
 * Query QMD for relevant memories.
 * Returns formatted <recalled-memory> XML block, or empty string on failure.
 */
export function recallMemories(userMessage: string, memoryDir: string): string {
  try {
    const keywords = extractKeywords(userMessage, 10);
    if (keywords.length === 0) return "";

    // Try keyword search first
    let results = queryQmd(keywords.join(" "), memoryDir, "search");

    // Fallback to vector search if too few results
    if (results.length < MIN_KEYWORD_RESULTS) {
      const vectorResults = queryQmd(userMessage, memoryDir, "vector_search");
      // Merge, deduplicate by path
      const seen = new Set(results.map((r) => r.path));
      for (const r of vectorResults) {
        if (!seen.has(r.path)) {
          results.push(r);
          seen.add(r.path);
        }
      }
    }

    if (results.length === 0) return "";

    return formatRecallBlock(results);
  } catch {
    // Graceful degradation -- no memories recalled
    return "";
  }
}

/**
 * Query QMD via subprocess (execFileSync with argument array -- no shell injection).
 * Returns parsed results.
 */
function queryQmd(
  query: string,
  memoryDir: string,
  method: "search" | "vector_search",
): RecallResult[] {
  try {
    const args = [method, "--path", memoryDir, "--limit", "5", "--json", query];
    const output = execFileSync("qmd", args, {
      timeout: method === "search" ? 5000 : 10000,
      encoding: "utf-8",
    });
    const parsed: unknown = JSON.parse(output);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((r: Record<string, unknown>) => r.path && r.content)
      .map((r: Record<string, unknown>) => ({
        path: String(r.path),
        content: String(r.content).trim(),
        score: Number(r.score ?? 0),
      }));
  } catch {
    return [];
  }
}

/**
 * Format recall results as XML context block.
 * Respects the ~500 token budget.
 */
function formatRecallBlock(results: RecallResult[]): string {
  const lines: string[] = [];
  let estimatedTokens = 0;

  for (const result of results) {
    // Extract just the fact from the file content (first line after frontmatter)
    const fact = extractFactFromContent(result.content);
    if (!fact) continue;

    const entry = `<recalled-memory type="fact" source="${result.path}">\n  ${fact}\n</recalled-memory>`;
    const entryTokens = Math.ceil(entry.length / 4);

    if (estimatedTokens + entryTokens > MAX_RECALL_TOKENS) break;

    lines.push(entry);
    estimatedTokens += entryTokens;
  }

  return lines.join("\n\n");
}

/**
 * Extract the core fact text from a PARA file's content.
 * The fact is the first non-empty line after the YAML frontmatter closing ---.
 */
function extractFactFromContent(content: string): string | null {
  const afterFrontmatter = content.replace(/^---[\s\S]*?---\s*\n?/, "");
  const firstLine = afterFrontmatter.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? null;
}
