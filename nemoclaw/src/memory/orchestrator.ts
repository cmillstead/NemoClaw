// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orchestrator — wraps SpawnSession for async memory operations.
 *
 * Three operations:
 *   1. Async compaction (background, fallback to sync)
 *   2. Async promotion (fire-and-forget on session close)
 *   3. Janitor (dedup + manifest regen, lock-gated)
 *
 * All operations fall back gracefully when SpawnSession is null or throws.
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { PluginLogger } from "../index.js";
import type { SpawnSession, NemoClawOp } from "./types.js";

const LOCK_FILE = "_janitor.lock";
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
const SPAWN_TIMEOUT = 60;

interface LockData {
  pid: number;
  timestamp: string;
}

export class Orchestrator {
  private spawner: SpawnSession;
  private memoryDir: string;
  private logger: PluginLogger;

  constructor(spawner: SpawnSession, memoryDir: string, logger: PluginLogger) {
    this.spawner = spawner;
    this.memoryDir = memoryDir;
    this.logger = logger;
  }

  spawnCompaction(sessionId: string): string | null {
    return this.spawn(
      "compact",
      `Compact session ${sessionId}: run extractive compaction on active messages and write results to the transcript database.`,
    );
  }

  spawnPromotion(sessionId: string): string | null {
    return this.spawn(
      "promote",
      `Promote facts from session ${sessionId}: extract durable facts from the transcript, deduplicate, and write to PARA storage.`,
    );
  }

  spawnJanitor(): string | null {
    if (!this.acquireLock()) {
      this.logger.info("Janitor skipped: lock held by another process");
      return null;
    }
    const result = this.spawn(
      "janitor",
      "Memory maintenance: scan for duplicate facts, supersede duplicates, regenerate manifest and category MOCs.",
    );
    if (!result) {
      this.releaseJanitorLock();
    }
    return result;
  }

  releaseJanitorLock(): void {
    try {
      const lockPath = join(this.memoryDir, LOCK_FILE);
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Non-fatal
    }
  }

  shouldTriggerJanitor(promotedFactCount: number): boolean {
    return promotedFactCount > 0 && promotedFactCount % 10 === 0;
  }

  private spawn(op: NemoClawOp, task: string): string | null {
    if (!this.spawner) {
      this.logger.info(`Async ${op} unavailable: SpawnSession is null`);
      return null;
    }

    try {
      const sessionId = this.spawner({
        task,
        mode: "run",
        sandbox: "inherit",
        runTimeoutSeconds: SPAWN_TIMEOUT,
        cleanup: "delete",
        label: `nemoclaw-${op}`,
        metadata: { _nemoclawOp: op },
      });
      this.logger.info(`Spawned ${op} subagent: ${sessionId}`);
      return sessionId;
    } catch (err) {
      this.logger.warn(`Failed to spawn ${op} subagent: ${String(err)}`);
      return null;
    }
  }

  private acquireLock(): boolean {
    const lockPath = join(this.memoryDir, LOCK_FILE);
    const lockData: LockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };

    try {
      // Atomic create-and-write: fails with EEXIST if file already exists
      writeFileSync(lockPath, JSON.stringify(lockData), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
    }

    // Lock file exists — check if it's stale
    try {
      const data: LockData = JSON.parse(readFileSync(lockPath, "utf-8")) as LockData;
      const lockAge = Date.now() - new Date(data.timestamp).getTime();
      if (lockAge < STALE_LOCK_MS) {
        return false;
      }
      this.logger.warn(
        `Force-releasing stale janitor lock (age: ${String(Math.round(lockAge / 1000))}s)`,
      );
    } catch {
      // Corrupt lock file — safe to overwrite
    }

    // Overwrite stale/corrupt lock
    writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");
    return true;
  }
}
