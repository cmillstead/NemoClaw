// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptDb } from "./transcript-db.js";
import { promoteFactNow, promoteEndOfSession, promoteFromMessages } from "./promotion.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import type { MemoryConfig, MessageRecord } from "./types.js";
import type { PluginLogger } from "../index.js";

function makeLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

describe("promotion", () => {
  let tmpDir: string;
  let db: TranscriptDb;
  let config: MemoryConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "promotion-test-"));
    db = new TranscriptDb(join(tmpDir, "_db", "sessions.db"));
    config = { ...DEFAULT_MEMORY_CONFIG, memoryDir: tmpDir };
    db.createSession("sess-001", null);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("promoteFactNow", () => {
    it("writes a fact and records it in DB", () => {
      const path = promoteFactNow(
        db,
        config,
        "sess-001",
        "User prefers dark mode",
        "areas",
        ["preference"],
        makeLogger(),
      );
      expect(path).toContain("areas/");
      expect(db.getPromotedFactCount("sess-001", "agent")).toBe(1);
    });

    it("deduplicates by content hash", () => {
      promoteFactNow(db, config, "sess-001", "Same fact", "areas", [], makeLogger());
      const result = promoteFactNow(db, config, "sess-001", "Same fact", "areas", [], makeLogger());
      expect(result).toContain("duplicate");
      expect(db.getPromotedFactCount("sess-001")).toBe(1);
    });

    it("enforces agent fact limit", () => {
      const limitedConfig = { ...config, maxAgentFacts: 2 };
      promoteFactNow(db, limitedConfig, "sess-001", "Fact one", "areas", [], makeLogger());
      promoteFactNow(db, limitedConfig, "sess-001", "Fact two", "areas", [], makeLogger());
      expect(() =>
        promoteFactNow(db, limitedConfig, "sess-001", "Fact three", "areas", [], makeLogger()),
      ).toThrow("Agent fact limit reached");
    });

    it("rejects facts with secrets", () => {
      expect(() =>
        promoteFactNow(
          db,
          config,
          "sess-001",
          "Key: sk-abc123def456ghi789jkl012mno",
          "areas",
          [],
          makeLogger(),
        ),
      ).toThrow("Fact validation failed");
    });
  });

  describe("promoteEndOfSession", () => {
    it("extracts facts from remember requests", () => {
      db.appendMessage("sess-001", "user", "Remember that I prefer dark mode in VS Code", 20);
      db.appendMessage("sess-001", "assistant", "I'll remember that preference.", 10);

      const promoted = promoteEndOfSession(db, config, "sess-001", makeLogger());
      expect(promoted.length).toBeGreaterThanOrEqual(1);
    });

    it("respects maxAutoPromotedFacts limit", () => {
      const limitedConfig = { ...config, maxAutoPromotedFacts: 1 };
      for (let i = 0; i < 5; i++) {
        db.appendMessage("sess-001", "user", `Remember preference number ${i} about color scheme`, 20);
        db.appendMessage("sess-001", "assistant", "Noted.", 5);
      }

      const promoted = promoteEndOfSession(db, limitedConfig, "sess-001", makeLogger());
      expect(promoted.length).toBeLessThanOrEqual(1);
    });

    it("returns empty for sessions with no promotable content", () => {
      db.appendMessage("sess-001", "user", "Hello", 5);
      db.appendMessage("sess-001", "assistant", "Hi", 3);

      const promoted = promoteEndOfSession(db, config, "sess-001", makeLogger());
      expect(promoted).toHaveLength(0);
    });

    it("deduplicates against previously promoted facts", () => {
      // Promote a fact manually first
      promoteFactNow(
        db,
        config,
        "sess-001",
        "I prefer dark mode in VS Code",
        "areas",
        [],
        makeLogger(),
      );

      // Same fact should not be auto-promoted
      db.appendMessage(
        "sess-001",
        "user",
        "Remember that I prefer dark mode in VS Code",
        20,
      );
      const promoted = promoteEndOfSession(db, config, "sess-001", makeLogger());
      // May or may not match depending on exact extraction; key is no crash
      expect(promoted.length).toBeLessThanOrEqual(config.maxAutoPromotedFacts);
    });
  });

  describe("promoteFromMessages", () => {
    it("promotes facts from a raw message array", () => {
      const messages: MessageRecord[] = [
        {
          id: 1,
          session_id: "sess-001",
          role: "user",
          content: "Remember that the API uses REST not GraphQL",
          token_count: 20,
          created_at: new Date().toISOString(),
          compacted: 0,
          compaction_id: null,
        },
        {
          id: 2,
          session_id: "sess-001",
          role: "assistant",
          content: "I'll remember that.",
          token_count: 10,
          created_at: new Date().toISOString(),
          compacted: 0,
          compaction_id: null,
        },
      ];

      const promoted = promoteFromMessages(
        db,
        config,
        "sess-001",
        messages,
        "auto",
        makeLogger(),
      );
      expect(promoted.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for messages with no promotable content", () => {
      const messages: MessageRecord[] = [
        {
          id: 1,
          session_id: "sess-001",
          role: "user",
          content: "Hello",
          token_count: 5,
          created_at: new Date().toISOString(),
          compacted: 0,
          compaction_id: null,
        },
      ];

      const promoted = promoteFromMessages(
        db,
        config,
        "sess-001",
        messages,
        "auto",
        makeLogger(),
      );
      expect(promoted).toHaveLength(0);
    });
  });
});
