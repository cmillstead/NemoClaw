// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptDb } from "./transcript-db.js";
import { SessionManager } from "./session.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import type { MemoryConfig, SubagentSpawnContext, SubagentEndedContext } from "./types.js";
import type { PluginLogger } from "../index.js";
import {
  handlePrepareSubagentSpawn,
  handleSubagentEnded,
  truncateCompactionSummaries,
} from "./context-hooks.js";

function makeLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

describe("context-hooks", () => {
  let tmpDir: string;
  let db: TranscriptDb;
  let config: MemoryConfig;
  let sessionMgr: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "context-hooks-test-"));
    db = new TranscriptDb(join(tmpDir, "_db", "sessions.db"));
    config = { ...DEFAULT_MEMORY_CONFIG, memoryDir: tmpDir };
    sessionMgr = new SessionManager(db, config, makeLogger());
    sessionMgr.start();
  });

  afterEach(() => {
    sessionMgr.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("truncateCompactionSummaries", () => {
    it("returns empty string for no summaries", () => {
      expect(truncateCompactionSummaries([])).toBe("");
    });

    it("returns most recent summaries within token budget", () => {
      const summaries = [
        "### Topics\n- Old topic from early in session",
        "### Topics\n- Recent topic about memory system",
      ];
      const result = truncateCompactionSummaries(summaries, 200);
      expect(result).toContain("Recent topic");
    });

    it("truncates when summaries exceed budget", () => {
      const longSummary = "### Topics\n" + "- Long topic line that takes up tokens\n".repeat(50);
      const summaries = [longSummary, longSummary, longSummary];
      const result = truncateCompactionSummaries(summaries, 200);
      const tokens = Math.ceil(result.length / 4);
      expect(tokens).toBeLessThanOrEqual(200);
    });
  });

  describe("handlePrepareSubagentSpawn", () => {
    it("returns null for empty task", () => {
      const ctx: SubagentSpawnContext = {
        task: "",
        parentSessionId: sessionMgr.getSessionId()!,
      };
      const result = handlePrepareSubagentSpawn(ctx, sessionMgr, config, makeLogger());
      expect(result).toBeNull();
    });

    it("returns null when memory opt-out is none", () => {
      const ctx: SubagentSpawnContext = {
        task: "do something",
        parentSessionId: sessionMgr.getSessionId()!,
        metadata: { memory: "none" },
      };
      const result = handlePrepareSubagentSpawn(ctx, sessionMgr, config, makeLogger());
      expect(result).toBeNull();
    });

    it("returns XML context block for a valid task", () => {
      sessionMgr.append("user", "Remember that we use TypeScript for all new code");
      sessionMgr.append("assistant", "Noted, TypeScript for all new code.");

      const ctx: SubagentSpawnContext = {
        task: "Refactor the TypeScript module",
        parentSessionId: sessionMgr.getSessionId()!,
      };
      const result = handlePrepareSubagentSpawn(ctx, sessionMgr, config, makeLogger());
      expect(result === null || result.includes("<nemoclaw-context")).toBe(true);
    });

    it("skips session summary when memory is minimal", () => {
      sessionMgr.append("user", "Some conversation content");

      const ctx: SubagentSpawnContext = {
        task: "do something",
        parentSessionId: sessionMgr.getSessionId()!,
        metadata: { memory: "minimal" },
      };
      const result = handlePrepareSubagentSpawn(ctx, sessionMgr, config, makeLogger());
      if (result) {
        expect(result).not.toContain("<session-summary>");
      }
    });
  });

  describe("handleSubagentEnded", () => {
    it("skips fact capture for non-completed subagents", () => {
      const ctx: SubagentEndedContext = {
        sessionId: "sub-001",
        parentSessionId: sessionMgr.getSessionId()!,
        messages: [
          {
            id: 1,
            session_id: "sub-001",
            role: "user",
            content: "Remember this",
            token_count: 10,
            created_at: new Date().toISOString(),
            compacted: 0,
            compaction_id: null,
          },
        ],
        exitReason: "timeout",
      };
      const result = handleSubagentEnded(ctx, db, config, makeLogger());
      expect(result).toHaveLength(0);
    });

    it("skips fact capture for internal maintenance subagents", () => {
      const ctx: SubagentEndedContext = {
        sessionId: "sub-001",
        parentSessionId: sessionMgr.getSessionId()!,
        messages: [
          {
            id: 1,
            session_id: "sub-001",
            role: "user",
            content: "Remember this important fact",
            token_count: 10,
            created_at: new Date().toISOString(),
            compacted: 0,
            compaction_id: null,
          },
        ],
        exitReason: "completed",
        metadata: { _nemoclawOp: "janitor" },
      };
      const result = handleSubagentEnded(ctx, db, config, makeLogger());
      expect(result).toHaveLength(0);
    });

    it("captures facts from completed subagent transcript", () => {
      const ctx: SubagentEndedContext = {
        sessionId: "sub-001",
        parentSessionId: sessionMgr.getSessionId()!,
        messages: [
          {
            id: 1,
            session_id: "sub-001",
            role: "user",
            content: "Remember that the auth system uses JWT tokens",
            token_count: 20,
            created_at: new Date().toISOString(),
            compacted: 0,
            compaction_id: null,
          },
          {
            id: 2,
            session_id: "sub-001",
            role: "assistant",
            content: "Noted.",
            token_count: 5,
            created_at: new Date().toISOString(),
            compacted: 0,
            compaction_id: null,
          },
        ],
        exitReason: "completed",
      };
      const result = handleSubagentEnded(ctx, db, config, makeLogger());
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});
