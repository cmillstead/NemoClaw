// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Memory background service -- registered via api.registerService().
 *
 * Lifecycle:
 *   start() -> create dirs, open DB, recover orphans, create session, register hooks
 *   stop()  -> close session, run fact promotion, close DB
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginService, OpenClawPluginApi, PluginLogger, OpenClawConfig } from "../index.js";
import { TranscriptDb } from "./transcript-db.js";
import { SessionManager } from "./session.js";
import { ensureMemoryDirs } from "./para.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import type { MemoryConfig } from "./types.js";
import { Orchestrator } from "./orchestrator.js";
import type { SpawnSession } from "./types.js";

let activeSessionManager: SessionManager | null = null;
let activeDb: TranscriptDb | null = null;
let activeOrchestrator: Orchestrator | null = null;

/**
 * Get the active session manager (for use by commands).
 */
export function getSessionManager(): SessionManager | null {
  return activeSessionManager;
}

export function getOrchestrator(): Orchestrator | null {
  return activeOrchestrator;
}

/**
 * Resolve the memory directory.
 * Inside sandbox: /sandbox/memory
 * Host: ~/.nemoclaw/memory
 */
function resolveMemoryDir(): string {
  // Inside sandbox
  if (existsSync("/sandbox/.openclaw") || existsSync("/sandbox/.nemoclaw")) {
    return "/sandbox/memory";
  }
  // Host
  return join(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
}

/**
 * Create the memory service for plugin registration.
 */
export function createMemoryService(_api: OpenClawPluginApi, spawner: SpawnSession = null): PluginService {
  return {
    id: "nemoclaw-memory",
    start: (ctx: { config: OpenClawConfig; logger: PluginLogger }) => {
      const { logger } = ctx;

      try {
        const memoryDir = resolveMemoryDir();
        ensureMemoryDirs(memoryDir);

        const dbPath = join(memoryDir, "_db", "sessions.db");
        const db = new TranscriptDb(dbPath);

        if (!db.integrityCheck()) {
          logger.warn("SQLite integrity check failed -- database may be corrupted");
        }

        const config: MemoryConfig = {
          ...DEFAULT_MEMORY_CONFIG,
          memoryDir,
        };

        const sessionManager = new SessionManager(db, config, logger);
        sessionManager.start();

        activeSessionManager = sessionManager;
        activeDb = db;

        const orchestrator = new Orchestrator(spawner, memoryDir, logger);
        sessionManager.setOrchestrator(orchestrator);
        activeOrchestrator = orchestrator;

        logger.info(`Memory service started (dir: ${memoryDir})`);
      } catch (err) {
        logger.error(`Memory service failed to start: ${String(err)}`);
        // Graceful degradation -- agent works without memory
      }
    },
    stop: (ctx: { config: OpenClawConfig; logger: PluginLogger }) => {
      const { logger } = ctx;

      try {
        if (activeSessionManager) {
          activeSessionManager.close();
          activeSessionManager = null;
        }

        if (activeDb) {
          activeDb.close();
          activeDb = null;
          activeOrchestrator = null;
        }

        logger.info("Memory service stopped");
      } catch (err) {
        logger.error(`Memory service stop error: ${String(err)}`);
      }
    },
  };
}
