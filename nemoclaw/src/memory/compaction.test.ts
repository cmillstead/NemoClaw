// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { compact, extractFromMessages, extractKeywords, estimateTokens } from "./compaction.js";
import type { MessageRecord } from "./types.js";

function makeMessage(
  id: number,
  role: "user" | "assistant",
  content: string,
  tokenCount?: number,
): MessageRecord {
  return {
    id,
    session_id: "sess-001",
    role,
    content,
    token_count: tokenCount ?? estimateTokens(content),
    created_at: new Date().toISOString(),
    compacted: 0,
    compaction_id: null,
  };
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("extractFromMessages", () => {
  it("extracts topics from user messages", () => {
    const messages = [
      makeMessage(1, "user", "How do I set up a TypeScript project with ESLint?"),
      makeMessage(2, "assistant", "Here's how you can set up TypeScript with ESLint..."),
    ];
    const result = extractFromMessages(messages);
    expect(result.topics.length).toBeGreaterThanOrEqual(1);
    expect(result.topics[0]).toContain("TypeScript");
  });

  it("extracts decisions", () => {
    const messages = [
      makeMessage(1, "user", "What approach should we use?"),
      makeMessage(2, "assistant", "I'll use the singleton pattern for the database connection."),
    ];
    const result = extractFromMessages(messages);
    expect(result.decisions.length).toBeGreaterThanOrEqual(1);
    expect(result.decisions[0]).toContain("singleton pattern");
  });

  it("extracts code artifacts (file paths)", () => {
    const messages = [
      makeMessage(1, "assistant", "Edit the file at src/memory/types.ts and also check /usr/local/bin/node"),
    ];
    const result = extractFromMessages(messages);
    expect(result.codeArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(result.codeArtifacts.some((a) => a.includes("memory/types.ts"))).toBe(true);
  });

  it("extracts remember requests", () => {
    const messages = [
      makeMessage(1, "user", "Remember that I prefer dark mode in VS Code"),
    ];
    const result = extractFromMessages(messages);
    expect(result.rememberRequests.length).toBeGreaterThanOrEqual(1);
    expect(result.rememberRequests[0]).toContain("dark mode");
  });

  it("returns empty arrays for messages with no extractable content", () => {
    const messages = [
      makeMessage(1, "user", "ok"),
      makeMessage(2, "assistant", "ok"),
    ];
    const result = extractFromMessages(messages);
    expect(result.topics).toHaveLength(1); // "ok" is a topic (short)
    expect(result.decisions).toHaveLength(0);
    expect(result.codeArtifacts).toHaveLength(0);
    expect(result.rememberRequests).toHaveLength(0);
  });
});

describe("compact", () => {
  it("returns null when below threshold", () => {
    const messages = [makeMessage(1, "user", "Hello", 5)];
    expect(compact("sess-001", messages, 1000)).toBeNull();
  });

  it("returns null for empty messages", () => {
    expect(compact("sess-001", [], 100)).toBeNull();
  });

  it("compacts when above threshold, keeping recent 20%", () => {
    const messages: MessageRecord[] = [];
    for (let i = 1; i <= 20; i++) {
      messages.push(makeMessage(i, i % 2 === 1 ? "user" : "assistant", `Message content number ${i} with some extra words`, 50));
    }
    // Total: 20 * 50 = 1000 tokens, threshold = 500
    const result = compact("sess-001", messages, 500);
    expect(result).not.toBeNull();
    expect(result!.messageRangeStart).toBe(1);
    // Keep 20% = 4 messages, so compact up to message 16
    expect(result!.messageRangeEnd).toBe(16);
    expect(result!.summary.length).toBeGreaterThan(0);
  });

  it("compaction id follows expected format", () => {
    const messages: MessageRecord[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(makeMessage(i, "user", `Message ${i}`, 100));
    }
    const result = compact("sess-001", messages, 500);
    expect(result).not.toBeNull();
    expect(result!.id).toMatch(/^comp-\d{14}-[a-f0-9]{8}$/);
  });

  it("summary contains extracted topics", () => {
    const messages = [
      makeMessage(1, "user", "How do I configure ESLint for TypeScript?", 50),
      makeMessage(2, "assistant", "I'll set up ESLint with the TypeScript parser.", 100),
      makeMessage(3, "user", "What about Prettier integration?", 50),
      makeMessage(4, "assistant", "Let's add eslint-config-prettier.", 100),
      makeMessage(5, "user", "Great, show me the final config.", 50),
      makeMessage(6, "assistant", "Here's the complete .eslintrc.json.", 100),
    ];
    const result = compact("sess-001", messages, 200);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Topics");
  });

  it("preserves original token count", () => {
    const messages = [
      makeMessage(1, "user", "A", 100),
      makeMessage(2, "assistant", "B", 200),
      makeMessage(3, "user", "C", 100),
      makeMessage(4, "assistant", "D", 200),
      makeMessage(5, "user", "E", 100),
    ];
    const result = compact("sess-001", messages, 300);
    expect(result).not.toBeNull();
    // Should compact first 3 (keep 2 = max(2, ceil(5*0.2))), so keep last 2
    expect(result!.originalTokenCount).toBe(400); // 100+200+100 from first 3
  });
});

describe("extractKeywords", () => {
  it("extracts meaningful words, excluding stop words", () => {
    const keywords = extractKeywords("How do I set up a TypeScript project with ESLint and Prettier?");
    expect(keywords).toContain("typescript");
    expect(keywords).toContain("eslint");
    expect(keywords).toContain("prettier");
    expect(keywords).not.toContain("how");
    expect(keywords).not.toContain("the");
  });

  it("respects limit", () => {
    const keywords = extractKeywords("one two three four five six seven eight nine ten eleven", 3);
    expect(keywords.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for stop-word-only input", () => {
    const keywords = extractKeywords("the and is or a");
    expect(keywords).toHaveLength(0);
  });

  it("sorts by frequency", () => {
    const keywords = extractKeywords("typescript typescript typescript python python java");
    expect(keywords[0]).toBe("typescript");
    expect(keywords[1]).toBe("python");
  });
});
