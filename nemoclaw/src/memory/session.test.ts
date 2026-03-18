// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptDb } from "./transcript-db.js";
import { SessionManager } from "./session.js";
import type { MemoryConfig } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import { makeLogger } from "../__test-utils__/logger.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let db: TranscriptDb;
  let config: MemoryConfig;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
    db = new TranscriptDb(join(tmpDir, "_db", "sessions.db"));
    config = { ...DEFAULT_MEMORY_CONFIG, memoryDir: tmpDir, compactionThreshold: 200 };
    manager = new SessionManager(db, config, makeLogger());
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("start", () => {
    it("creates a new session", () => {
      const id = manager.start("test-model");
      expect(id).toMatch(/^sess-/);
      expect(manager.getSessionId()).toBe(id);
    });

    it("recovers orphaned sessions on start", () => {
      // Create an orphaned session directly in DB
      db.createSession("sess-orphan-001", null);

      manager.start();

      // Orphaned session should be closed
      const orphan = db.getSession("sess-orphan-001");
      expect(orphan!.status).toBe("closed");
    });
  });

  describe("append", () => {
    it("appends messages to active session", () => {
      manager.start();
      manager.append("user", "Hello");
      manager.append("assistant", "Hi there");

      const state = manager.getState();
      expect(state.messageCount).toBe(2);
    });

    it("returns false when no active session", () => {
      expect(manager.append("user", "Hello")).toBe(false);
    });

    it("triggers compaction when threshold exceeded", () => {
      manager.start();
      // Each message ~50 tokens (200 chars / 4), threshold is 200
      for (let i = 0; i < 6; i++) {
        manager.append("user", "x".repeat(200));
      }
      // Should have triggered compaction
      const state = manager.getState();
      expect(state.compactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("close", () => {
    it("closes the active session", () => {
      manager.start();
      manager.append("user", "Test message");
      manager.close();

      expect(manager.getSessionId()).toBeNull();
      expect(manager.getState().status).toBe("idle");
    });

    it("is safe to call with no active session", () => {
      manager.close(); // Should not throw
    });
  });

  describe("getState", () => {
    it("returns idle state when no session", () => {
      const state = manager.getState();
      expect(state.status).toBe("idle");
      expect(state.sessionId).toBeNull();
    });

    it("returns active state with counts", () => {
      manager.start();
      manager.append("user", "Hello");
      manager.append("assistant", "Hi");

      const state = manager.getState();
      expect(state.status).toBe("active");
      expect(state.sessionId).not.toBeNull();
      expect(state.messageCount).toBe(2);
      expect(state.tokenCount).toBeGreaterThan(0);
    });
  });

  describe("compaction drill-back", () => {
    it("returns compaction summaries", () => {
      // Use low threshold to trigger compaction easily
      config.compactionThreshold = 50;
      manager = new SessionManager(db, config, makeLogger());
      manager.start();

      for (let i = 0; i < 10; i++) {
        manager.append("user", "x".repeat(100));
      }

      const summaries = manager.getCompactionSummaries();
      expect(summaries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
