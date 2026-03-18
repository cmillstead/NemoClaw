"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionManager = getSessionManager;
exports.createMemoryService = createMemoryService;
/**
 * Memory background service -- registered via api.registerService().
 *
 * Lifecycle:
 *   start() -> create dirs, open DB, recover orphans, create session, register hooks
 *   stop()  -> close session, run fact promotion, close DB
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const transcript_db_js_1 = require("./transcript-db.js");
const session_js_1 = require("./session.js");
const para_js_1 = require("./para.js");
const types_js_1 = require("./types.js");
let activeSessionManager = null;
let activeDb = null;
/**
 * Get the active session manager (for use by commands).
 */
function getSessionManager() {
    return activeSessionManager;
}
/**
 * Resolve the memory directory.
 * Inside sandbox: /sandbox/memory
 * Host: ~/.nemoclaw/memory
 */
function resolveMemoryDir() {
    // Inside sandbox
    if ((0, node_fs_1.existsSync)("/sandbox/.openclaw") || (0, node_fs_1.existsSync)("/sandbox/.nemoclaw")) {
        return "/sandbox/memory";
    }
    // Host
    return (0, node_path_1.join)(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
}
/**
 * Create the memory service for plugin registration.
 */
function createMemoryService(_api) {
    return {
        id: "nemoclaw-memory",
        start: (ctx) => {
            const { logger } = ctx;
            try {
                const memoryDir = resolveMemoryDir();
                (0, para_js_1.ensureMemoryDirs)(memoryDir);
                const dbPath = (0, node_path_1.join)(memoryDir, "_db", "sessions.db");
                const db = new transcript_db_js_1.TranscriptDb(dbPath);
                if (!db.integrityCheck()) {
                    logger.warn("SQLite integrity check failed -- database may be corrupted");
                }
                const config = {
                    ...types_js_1.DEFAULT_MEMORY_CONFIG,
                    memoryDir,
                };
                const sessionManager = new session_js_1.SessionManager(db, config, logger);
                sessionManager.start();
                activeSessionManager = sessionManager;
                activeDb = db;
                logger.info(`Memory service started (dir: ${memoryDir})`);
            }
            catch (err) {
                logger.error(`Memory service failed to start: ${String(err)}`);
                // Graceful degradation -- agent works without memory
            }
        },
        stop: (ctx) => {
            const { logger } = ctx;
            try {
                if (activeSessionManager) {
                    activeSessionManager.close();
                    activeSessionManager = null;
                }
                if (activeDb) {
                    activeDb.close();
                    activeDb = null;
                }
                logger.info("Memory service stopped");
            }
            catch (err) {
                logger.error(`Memory service stop error: ${String(err)}`);
            }
        },
    };
}
//# sourceMappingURL=service.js.map