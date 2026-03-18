// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recallMemories } from "./recall.js";

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
