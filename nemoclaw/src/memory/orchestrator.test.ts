// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SpawnSession } from "./types.js";
import { Orchestrator } from "./orchestrator.js";
import type { PluginLogger } from "../index.js";

function makeLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

// Contract verification: test double satisfies SpawnSession type
const _spawnContract: SpawnSession = (opts) => {
  return `test-session-${Date.now()}`;
};

describe("orchestrator", () => {
  let tmpDir: string;
  let spawnCalls: Array<Record<string, unknown>>;
  let spawner: SpawnSession;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orchestrator-test-"));
    spawnCalls = [];
    spawner = (opts) => {
      spawnCalls.push(opts);
      return `spawn-${String(spawnCalls.length)}`;
    };
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("spawnCompaction", () => {
    it("calls SpawnSession with compact metadata", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      orch.spawnCompaction("sess-001");
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].metadata).toEqual({ _nemoclawOp: "compact" });
    });

    it("falls back gracefully when SpawnSession is null", () => {
      const orch = new Orchestrator(null, tmpDir, makeLogger());
      const result = orch.spawnCompaction("sess-001");
      expect(result).toBeNull();
    });

    it("falls back gracefully when SpawnSession throws", () => {
      const failSpawner: SpawnSession = () => {
        throw new Error("spawn failed");
      };
      const orch = new Orchestrator(failSpawner, tmpDir, makeLogger());
      const result = orch.spawnCompaction("sess-001");
      expect(result).toBeNull();
    });
  });

  describe("spawnPromotion", () => {
    it("calls SpawnSession with promote metadata", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      orch.spawnPromotion("sess-001");
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].metadata).toEqual({ _nemoclawOp: "promote" });
    });
  });

  describe("spawnJanitor", () => {
    it("creates lock file and calls SpawnSession", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      orch.spawnJanitor();
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].metadata).toEqual({ _nemoclawOp: "janitor" });
      expect(existsSync(join(tmpDir, "_janitor.lock"))).toBe(true);
    });

    it("skips when lock is held", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      orch.spawnJanitor();
      orch.spawnJanitor();
      expect(spawnCalls).toHaveLength(1);
    });

    it("force-releases stale locks older than 10 minutes", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      const staleLock = JSON.stringify({
        pid: 99999,
        timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      });
      writeFileSync(join(tmpDir, "_janitor.lock"), staleLock);

      orch.spawnJanitor();
      expect(spawnCalls).toHaveLength(1);
    });
  });

  describe("releaseJanitorLock", () => {
    it("removes the lock file", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      orch.spawnJanitor();
      expect(existsSync(join(tmpDir, "_janitor.lock"))).toBe(true);
      orch.releaseJanitorLock();
      expect(existsSync(join(tmpDir, "_janitor.lock"))).toBe(false);
    });
  });

  describe("shouldTriggerJanitor", () => {
    it("returns true when count is divisible by 10", () => {
      const orch = new Orchestrator(spawner, tmpDir, makeLogger());
      expect(orch.shouldTriggerJanitor(10)).toBe(true);
      expect(orch.shouldTriggerJanitor(20)).toBe(true);
      expect(orch.shouldTriggerJanitor(0)).toBe(false);
      expect(orch.shouldTriggerJanitor(7)).toBe(false);
    });
  });
});
