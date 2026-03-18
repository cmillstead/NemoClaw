// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptDb } from "./transcript-db.js";

describe("TranscriptDb", () => {
  let tmpDir: string;
  let db: TranscriptDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "transcript-db-test-"));
    db = new TranscriptDb(join(tmpDir, "_db", "sessions.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("sessions", () => {
    it("creates and retrieves a session", () => {
      db.createSession("sess-001", "nemotron-3");
      const session = db.getSession("sess-001");
      expect(session).toBeDefined();
      expect(session!.id).toBe("sess-001");
      expect(session!.model).toBe("nemotron-3");
      expect(session!.status).toBe("active");
      expect(session!.total_tokens).toBe(0);
    });

    it("updates session status", () => {
      db.createSession("sess-001", null);
      db.updateSessionStatus("sess-001", "compacting");
      const session = db.getSession("sess-001");
      expect(session!.status).toBe("compacting");
    });

    it("closes a session with timestamp", () => {
      db.createSession("sess-001", null);
      db.closeSession("sess-001");
      const session = db.getSession("sess-001");
      expect(session!.status).toBe("closed");
      expect(session!.ended_at).not.toBeNull();
    });

    it("returns undefined for non-existent session", () => {
      expect(db.getSession("nonexistent")).toBeUndefined();
    });

    it("lists active sessions", () => {
      db.createSession("sess-001", null);
      db.createSession("sess-002", null);
      db.closeSession("sess-002");
      const active = db.getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("sess-001");
    });

    it("increments compaction count", () => {
      db.createSession("sess-001", null);
      db.incrementCompactionCount("sess-001");
      db.incrementCompactionCount("sess-001");
      const session = db.getSession("sess-001");
      expect(session!.compaction_count).toBe(2);
    });
  });

  describe("messages", () => {
    beforeEach(() => {
      db.createSession("sess-001", null);
    });

    it("appends and retrieves messages", () => {
      db.appendMessage("sess-001", "user", "Hello", 5);
      db.appendMessage("sess-001", "assistant", "Hi there", 10);
      const msgs = db.getActiveMessages("sess-001");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });

    it("returns message id from append", () => {
      const id1 = db.appendMessage("sess-001", "user", "First", 3);
      const id2 = db.appendMessage("sess-001", "user", "Second", 4);
      expect(id2).toBeGreaterThan(id1);
    });

    it("calculates token count for active messages", () => {
      db.appendMessage("sess-001", "user", "Hello", 5);
      db.appendMessage("sess-001", "assistant", "Hi", 3);
      expect(db.getSessionTokenCount("sess-001")).toBe(8);
    });

    it("marks messages as compacted", () => {
      const id1 = db.appendMessage("sess-001", "user", "Old msg", 5);
      db.appendMessage("sess-001", "user", "New msg", 5);
      db.markMessagesCompacted("sess-001", "comp-001", id1);

      const active = db.getActiveMessages("sess-001");
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe("New msg");
    });

    it("compacted messages excluded from token count", () => {
      const id1 = db.appendMessage("sess-001", "user", "Old", 100);
      db.appendMessage("sess-001", "user", "New", 10);
      db.markMessagesCompacted("sess-001", "comp-001", id1);
      expect(db.getSessionTokenCount("sess-001")).toBe(10);
    });

    it("gets messages in range", () => {
      const id1 = db.appendMessage("sess-001", "user", "A", 1);
      db.appendMessage("sess-001", "user", "B", 1);
      const id3 = db.appendMessage("sess-001", "user", "C", 1);
      const range = db.getMessagesInRange("sess-001", id1, id3);
      expect(range).toHaveLength(3);
    });

    it("counts all messages", () => {
      db.appendMessage("sess-001", "user", "A", 1);
      db.appendMessage("sess-001", "assistant", "B", 1);
      expect(db.getSessionMessageCount("sess-001")).toBe(2);
    });
  });

  describe("compactions", () => {
    beforeEach(() => {
      db.createSession("sess-001", null);
    });

    it("inserts and retrieves compactions", () => {
      db.insertCompaction({
        id: "comp-001",
        session_id: "sess-001",
        summary: "Discussed TypeScript setup",
        message_range_start: 1,
        message_range_end: 10,
        original_token_count: 500,
        summary_token_count: 50,
        created_at: new Date().toISOString(),
      });
      const comps = db.getCompactions("sess-001");
      expect(comps).toHaveLength(1);
      expect(comps[0].summary).toBe("Discussed TypeScript setup");
    });
  });

  describe("promoted facts", () => {
    beforeEach(() => {
      db.createSession("sess-001", null);
    });

    it("inserts and checks for duplicates", () => {
      db.insertPromotedFact({
        id: "fact-001",
        session_id: "sess-001",
        fact_file_path: "areas/test-fact.md",
        content_hash: "sha256:abc123",
        promoted_at: new Date().toISOString(),
        source: "auto",
      });
      expect(db.isFactAlreadyPromoted("sha256:abc123")).toBe(true);
      expect(db.isFactAlreadyPromoted("sha256:different")).toBe(false);
    });

    it("counts promoted facts by source", () => {
      db.insertPromotedFact({
        id: "fact-001",
        session_id: "sess-001",
        fact_file_path: "areas/f1.md",
        content_hash: "sha256:a",
        promoted_at: new Date().toISOString(),
        source: "auto",
      });
      db.insertPromotedFact({
        id: "fact-002",
        session_id: "sess-001",
        fact_file_path: "areas/f2.md",
        content_hash: "sha256:b",
        promoted_at: new Date().toISOString(),
        source: "agent",
      });
      expect(db.getPromotedFactCount("sess-001")).toBe(2);
      expect(db.getPromotedFactCount("sess-001", "auto")).toBe(1);
      expect(db.getPromotedFactCount("sess-001", "agent")).toBe(1);
    });
  });

  describe("integrity", () => {
    it("passes integrity check on fresh database", () => {
      expect(db.integrityCheck()).toBe(true);
    });
  });

  describe("concurrent access", () => {
    it("handles rapid sequential writes", () => {
      db.createSession("sess-001", null);
      for (let i = 0; i < 100; i++) {
        db.appendMessage("sess-001", "user", `Message ${String(i)}`, 5);
      }
      expect(db.getSessionMessageCount("sess-001")).toBe(100);
      expect(db.getSessionTokenCount("sess-001")).toBe(500);
    });
  });
});
