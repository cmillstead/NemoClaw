// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recallMemories, escapeXml } from "./recall.js";

describe("recallMemories", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "recall-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty string when qmd is unavailable", () => {
    const result = recallMemories("Tell me about the architecture of codesight-mcp", tempDir);
    expect(result).toBe("");
  });

  it("returns empty string for empty message", () => {
    const result = recallMemories("", tempDir);
    expect(result).toBe("");
  });

  it("returns empty string for very short message with no keywords", () => {
    // All stop words — extractKeywords filters words <= 2 chars and stop words
    const result = recallMemories("I am the one", tempDir);
    expect(result).toBe("");
  });

  it("does not throw even when memoryDir does not exist", () => {
    const bogusDir = join(tempDir, "nonexistent", "deeply", "nested");
    expect(() =>
      recallMemories("architecture patterns for memory systems", bogusDir),
    ).not.toThrow();
  });

  it("handles non-existent memoryDir gracefully and returns empty string", () => {
    const bogusDir = `/tmp/recall-test-does-not-exist-${String(Date.now())}`;
    const result = recallMemories("architecture patterns for memory systems", bogusDir);
    expect(result).toBe("");
  });

  it("returns a string type regardless of input", () => {
    const result = recallMemories(
      "complex query about typescript compilation and bundling",
      tempDir,
    );
    expect(typeof result).toBe("string");
  });
});

describe("escapeXml", () => {
  it("escapes closing XML tags to prevent injection", () => {
    const malicious = '</recalled-memory><injected>payload</injected>';
    const escaped = escapeXml(malicious);
    expect(escaped).toBe("&lt;/recalled-memory&gt;&lt;injected&gt;payload&lt;/injected&gt;");
    expect(escaped).not.toContain("</recalled-memory>");
    expect(escaped).not.toContain("<injected>");
  });

  it("escapes script tags", () => {
    const xss = '<script>alert(1)</script>';
    const escaped = escapeXml(xss);
    expect(escaped).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escaped).not.toContain("<script>");
  });

  it("escapes ampersands and quotes", () => {
    const input = 'foo & bar "baz" \'qux\'';
    const escaped = escapeXml(input);
    expect(escaped).toBe("foo &amp; bar &quot;baz&quot; &apos;qux&apos;");
  });

  it("passes through normal content unchanged", () => {
    const normal = "This is a plain fact about architecture patterns.";
    expect(escapeXml(normal)).toBe(normal);
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });
});
