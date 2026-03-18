// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SQLite transcript database for session memory.
 *
 * Uses node:sqlite (DatabaseSync) — synchronous API, WAL mode, parameterized queries only.
 * Database location: {memoryDir}/_db/sessions.db
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  SessionRecord,
  SessionStatus,
  MessageRecord,
  MessageRole,
  CompactionRecord,
  PromotedFactRecord,
  FactSourceType,
} from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    total_tokens INTEGER DEFAULT 0,
    compaction_count INTEGER DEFAULT 0,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    created_at TEXT NOT NULL,
    compacted INTEGER DEFAULT 0,
    compaction_id TEXT
);

CREATE TABLE IF NOT EXISTS compactions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    summary TEXT NOT NULL,
    message_range_start INTEGER NOT NULL,
    message_range_end INTEGER NOT NULL,
    original_token_count INTEGER,
    summary_token_count INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promoted_facts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    fact_file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    promoted_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto'
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_compacted ON messages(session_id, compacted);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id);
CREATE INDEX IF NOT EXISTS idx_promoted_facts_hash ON promoted_facts(content_hash);
`;

export class TranscriptDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  createSession(id: string, model: string | null): void {
    this.db
      .prepare("INSERT INTO sessions (id, started_at, model, status) VALUES (?, ?, ?, 'active')")
      .run(id, new Date().toISOString(), model);
  }

  getSession(id: string): SessionRecord | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRecord
      | undefined;
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    this.db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, id);
  }

  closeSession(id: string): void {
    this.db
      .prepare("UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  getActiveSessions(): SessionRecord[] {
    return this.db
      .prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC")
      .all() as SessionRecord[];
  }

  updateSessionTokens(id: string, totalTokens: number): void {
    this.db.prepare("UPDATE sessions SET total_tokens = ? WHERE id = ?").run(totalTokens, id);
  }

  incrementCompactionCount(id: string): void {
    this.db
      .prepare("UPDATE sessions SET compaction_count = compaction_count + 1 WHERE id = ?")
      .run(id);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  appendMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    tokenCount: number | null,
  ): number {
    const result = this.db
      .prepare(
        "INSERT INTO messages (session_id, role, content, token_count, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(sessionId, role, content, tokenCount, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  getActiveMessages(sessionId: string): MessageRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? AND compacted = 0 ORDER BY id ASC",
      )
      .all(sessionId) as MessageRecord[];
  }

  getAllMessages(sessionId: string): MessageRecord[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as MessageRecord[];
  }

  getMessagesInRange(sessionId: string, startId: number, endId: number): MessageRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? AND id >= ? AND id <= ? ORDER BY id ASC",
      )
      .all(sessionId, startId, endId) as MessageRecord[];
  }

  markMessagesCompacted(sessionId: string, compactionId: string, upToId: number): void {
    this.db
      .prepare(
        "UPDATE messages SET compacted = 1, compaction_id = ? WHERE session_id = ? AND id <= ? AND compacted = 0",
      )
      .run(compactionId, sessionId, upToId);
  }

  getSessionTokenCount(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE session_id = ? AND compacted = 0",
      )
      .get(sessionId) as { total: number };
    return row.total;
  }

  getSessionMessageCount(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
      .get(sessionId) as { count: number };
    return row.count;
  }

  // -------------------------------------------------------------------------
  // Compactions
  // -------------------------------------------------------------------------

  insertCompaction(compaction: CompactionRecord): void {
    this.db
      .prepare(
        `INSERT INTO compactions
         (id, session_id, summary, message_range_start, message_range_end,
          original_token_count, summary_token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        compaction.id,
        compaction.session_id,
        compaction.summary,
        compaction.message_range_start,
        compaction.message_range_end,
        compaction.original_token_count,
        compaction.summary_token_count,
        compaction.created_at,
      );
  }

  getCompactions(sessionId: string): CompactionRecord[] {
    return this.db
      .prepare("SELECT * FROM compactions WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as CompactionRecord[];
  }

  // -------------------------------------------------------------------------
  // Promoted facts
  // -------------------------------------------------------------------------

  insertPromotedFact(fact: PromotedFactRecord): void {
    this.db
      .prepare(
        `INSERT INTO promoted_facts (id, session_id, fact_file_path, content_hash, promoted_at, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(fact.id, fact.session_id, fact.fact_file_path, fact.content_hash, fact.promoted_at, fact.source);
  }

  isFactAlreadyPromoted(contentHash: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM promoted_facts WHERE content_hash = ?")
      .get(contentHash) as { count: number };
    return row.count > 0;
  }

  getPromotedFacts(sessionId: string): PromotedFactRecord[] {
    return this.db
      .prepare("SELECT * FROM promoted_facts WHERE session_id = ? ORDER BY promoted_at ASC")
      .all(sessionId) as PromotedFactRecord[];
  }

  getPromotedFactCount(sessionId: string, source?: FactSourceType): number {
    if (source) {
      const row = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM promoted_facts WHERE session_id = ? AND source = ?",
        )
        .get(sessionId, source) as { count: number };
      return row.count;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM promoted_facts WHERE session_id = ?")
      .get(sessionId) as { count: number };
    return row.count;
  }

  // -------------------------------------------------------------------------
  // Integrity
  // -------------------------------------------------------------------------

  integrityCheck(): boolean {
    try {
      const result = this.db.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      return result.integrity_check === "ok";
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
