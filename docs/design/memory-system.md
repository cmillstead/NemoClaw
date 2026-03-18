# NemoClaw Memory System — Design Document

## Status

- **Status**: Approved design, pending implementation
- **Date**: 2026-03-17
- **Authors**: Architecture team (architect, senior coder, tester, security engineer)

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Component Design](#component-design)
4. [Data Flow](#data-flow)
5. [File and Folder Structure](#file-and-folder-structure)
6. [PARA Fact Schema](#para-fact-schema)
7. [Session Transcript Schema](#session-transcript-schema)
8. [Auto-Recall Hook Design](#auto-recall-hook-design)
9. [Obsidian Integration](#obsidian-integration)
10. [Error Handling](#error-handling)
11. [Testing Strategy](#testing-strategy)
12. [Security Considerations](#security-considerations)
13. [What Exists vs What Needs Building](#what-exists-vs-what-needs-building)

---

## Problem Statement

NemoClaw's sandbox is ephemeral. No persistence between sessions. Agents forget everything. Context windows fill up and old messages vanish. The agent has to manually decide to search for memories, which it often doesn't do.

**Goal**: Give NemoClaw agents persistent memory across sessions with zero new infrastructure, using only mounted volumes, SQLite, markdown files, and the existing QMD search server.

---

## Architecture Overview

### Three Layers + Promotion Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOST                                                               │
│                                                                     │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐   │
│  │  Layer 3: Auto-Recall│    │  QMD Server (existing)           │   │
│  │  (pre-prompt hook)   │───▶│  indexes ~/.nemoclaw/memory/*.md  │   │
│  └──────────┬──────────┘    └──────────────────────────────────┘   │
│             │ injects context into prompt                            │
│  ┌──────────▼──────────────────────────────────────────────────┐   │
│  │  SANDBOX (OpenShell container)                               │   │
│  │                                                              │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │  Layer 1: Session Memory Service                       │  │   │
│  │  │  - Transcript capture (SQLite)                         │  │   │
│  │  │  - Compaction engine (extractive, no LLM required)     │  │   │
│  │  │  - Drill-back tools (/memory search, /memory expand)   │  │   │
│  │  └───────────────────┬───────────────────────────────────┘  │   │
│  │                      │ fact promotion                         │   │
│  │  ┌───────────────────▼───────────────────────────────────┐  │   │
│  │  │  Layer 2: Durable Knowledge (PARA markdown files)      │  │   │
│  │  │  - projects/, areas/, resources/, archives/            │  │   │
│  │  │  - daily/ notes                                        │  │   │
│  │  │  - Atomic fact files with YAML frontmatter             │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          ▲                                          │
│  ┌───────────────────────┴─────────────────────────┐               │
│  │  Mounted Volume: ~/.nemoclaw/memory/             │               │
│  │  (persists across sandbox restarts)              │               │
│  │  Symlinked into Obsidian vault for browsing      │               │
│  └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Location | Responsibility | Fails Independently |
|---|---|---|---|
| **L1: Session Memory** | Sandbox (plugin service) | Capture transcripts, compact context, drill-back | Yes — agent works without it, just loses history |
| **L2: Durable Knowledge** | Mounted volume (PARA files) | Persistent facts, versioned, Obsidian-browsable | Yes — sessions work without promoted facts |
| **L3: Auto-Recall** | Host (pre-prompt hook) | Inject relevant memories into prompts automatically | Yes — agent works, just without recalled context |

### Key Principle: Graceful Degradation
Every layer fails independently. If auto-recall fails, the agent still works (just without context). If SQLite fails, facts can still be written to PARA files. If PARA files are corrupted, sessions still function.

---

## Component Design

### Plugin Registration

The memory system registers as a background service plus new commands in the existing plugin entry point (`nemoclaw/src/index.ts`):

```typescript
// Added to register(api: OpenClawPluginApi):
import { createMemoryService } from "./memory/service.js";
import { handleMemorySlashCommand } from "./commands/memory.js";

// Background service for session lifecycle
api.registerService(createMemoryService(api));

// /memory slash command
api.registerCommand({
  name: "memory",
  description: "Memory management (search, remember, facts, status).",
  acceptsArgs: true,
  handler: (ctx) => handleMemorySlashCommand(ctx, api),
});
```

### New Source Files

```
nemoclaw/src/
├── memory/
│   ├── service.ts          # Background service (start/stop lifecycle)
│   ├── session.ts          # Session manager (create, append, compact, close)
│   ├── transcript-db.ts    # SQLite operations for transcript storage
│   ├── compaction.ts       # Extractive compaction algorithm (no LLM)
│   ├── promotion.ts        # Fact extraction + PARA file writer
│   ├── para.ts             # PARA file I/O (read, write, deduplicate, MOC update)
│   ├── sanitize.ts         # Content validation, secret scanning, injection detection
│   └── types.ts            # Shared types for memory system
├── commands/
│   └── memory.ts           # /memory slash command handler (NEW)

nemoclaw-blueprint/
├── hooks/
│   └── pre-prompt.py       # Host-side auto-recall hook (NEW)
```

### Background Service Lifecycle

The session memory service uses `api.registerService()`:

1. **start()**: Create `~/.nemoclaw/memory/` directory structure, open SQLite database (WAL mode), recover orphaned sessions from previous crashes, create new session, register message hook via `api.on("message", handler)`
2. **Running**: Every message → append to SQLite, check compaction threshold, handle `/memory` commands
3. **stop()**: Close session, export transcript to markdown, run fact promotion, close SQLite

### Session Lifecycle State Machine

```
IDLE ──plugin start──▶ ACTIVE ──context pressure──▶ COMPACTING
                          ▲                              │
                          │       summary stored         │
                          └──────────────────────────────┘
                          │
                   session end signal
                          │
                          ▼
                      PROMOTING ──facts extracted──▶ CLOSED
```

- **ACTIVE**: Messages appended, token counter tracked
- **COMPACTING**: Triggered at 80% of model context window. Extractive summary created, old messages marked as compacted. Returns to ACTIVE.
- **PROMOTING**: Session closing. Full transcript exported as markdown. Durable facts extracted and written to PARA files.
- **CLOSED**: SQLite connection closed, session complete.

### Compaction Algorithm (Extractive, No LLM)

Compaction does NOT require an LLM — it is purely extractive:

1. Get all non-compacted messages for the session
2. If total tokens < threshold, no action
3. Keep the most recent 20% of messages active
4. Compact everything older:
   - Group into exchanges (user + assistant pairs)
   - Extract: topics (first noun phrase or 80 chars from user message), decisions ("I'll", "Let's", "We should"), code artifacts (file paths, function names), explicit "remember" requests
5. Format as structured markdown summary
6. Store in `compactions` table, mark originals as compacted
7. Agent's effective context = [compaction summaries] + [recent messages]

**Why extractive**: Agent-agnostic (any model or none), deterministic (testable), fast (no API call).

### New Commands

#### Slash Commands (/memory)

| Command | Description |
|---|---|
| `/memory` | Show status: active session, fact count, disk usage |
| `/memory search <query>` | Full-text search across transcripts and PARA facts |
| `/memory expand <compaction-id>` | Retrieve original messages from a compaction |
| `/memory remember <fact>` | Manually promote a fact to PARA |
| `/memory forget <fact-id>` | Supersede a fact (marks superseded, never deletes) |
| `/memory facts [category]` | List PARA facts, optionally filtered by category |
| `/memory session` | Current session info (messages, compactions, tokens) |

#### CLI Commands

| Command | Description |
|---|---|
| `openclaw nemoclaw memory status` | Memory system health |
| `openclaw nemoclaw memory facts` | List all PARA facts |
| `openclaw nemoclaw memory audit` | Security scan of all memory files |
| `openclaw nemoclaw memory init` | Initialize directory structure |
| `openclaw nemoclaw memory purge [--confirm]` | Delete all memory data |

---

## Data Flow

### Full Cycle: Prompt → Recall → Agent → Compaction → Promotion

```
User types message
      │
      ▼
[L3: Auto-Recall Hook — host-side, pre-prompt]
      │
      ├── Extract keywords from user message (stop-word removal)
      ├── QMD keyword search (~30ms) on ~/.nemoclaw/memory/
      ├── If < 2 results: QMD vector search (~2s)
      ├── Sanitize results (strip injection patterns, wrap in XML tags)
      ├── Format as <recalled-memory> block (max ~500 tokens)
      │
      ▼
[Augmented prompt delivered to agent]
      │   <recalled-memory type="fact" source="areas/user-prefers-typescript.md">
      │     User prefers TypeScript over JavaScript for new projects.
      │   </recalled-memory>
      │
      │   [Original user message]
      │
      ▼
[Agent processes augmented prompt, generates response]
      │
      ▼
[L1: Session Memory Service captures message + response]
      │
      ├── Append to SQLite (messages table)
      ├── Update token counter
      │
      ├── If token_count > compaction_threshold (80% of context window):
      │     ├── Run extractive compaction on older messages
      │     ├── Store summary in compactions table
      │     └── Mark originals as compacted
      │
      ├── If agent says "/memory remember <fact>":
      │     ├── Validate content (sanitize.ts: no secrets, no injection)
      │     ├── Write fact to PARA file (L2)
      │     └── Record in promoted_facts table
      │
      ▼
[Session ends — disconnect / timeout / explicit close]
      │
      ├── Export transcript as markdown → sessions/{session-id}.md
      ├── Run fact extraction on transcript:
      │     ├── Find explicit "remember" requests (highest priority)
      │     ├── Find decisions, config changes, error resolutions
      │     ├── Score and rank candidates (max 5 per session)
      │     ├── Deduplicate against existing PARA facts (SHA-256 hash)
      │     └── Validate content (no secrets, no injection patterns)
      ├── Write new facts to PARA files (L2)
      ├── Update daily note and category MOCs
      └── QMD re-indexes on next query (lazy indexing)
```

---

## File and Folder Structure

### On-Disk Layout (`~/.nemoclaw/memory/`)

```
~/.nemoclaw/memory/
├── _index.md                          # Root MOC (Obsidian entry point)
├── _manifest.json                     # Integrity manifest: SHA-256 hashes of all fact files
│
├── _db/                               # SQLite storage (NOT indexed by QMD)
│   ├── sessions.db                    # Transcript database
│   └── sessions.db.bak               # Daily backup
│
├── sessions/                          # Exported session transcripts (indexed by QMD)
│   ├── sess-20260317-143022-a1b2c3d4.md
│   └── ...
│
├── projects/                          # PARA: active project knowledge
│   ├── _index.md                      # Projects MOC
│   └── *.md                           # Individual fact files
│
├── areas/                             # PARA: ongoing areas of responsibility
│   ├── _index.md                      # Areas MOC
│   └── *.md
│
├── resources/                         # PARA: reference material
│   ├── _index.md                      # Resources MOC
│   └── *.md
│
├── archives/                          # PARA: completed/inactive items
│   ├── _index.md                      # Archives MOC
│   └── *.md
│
└── daily/                             # Daily notes
    ├── 2026-03-17.md
    └── ...
```

### Volume Mount Configuration

**Host path**: `~/.nemoclaw/memory/`
**Container path**: `/sandbox/memory/` (within the sandbox's allowed read-write zone)

Added to `openclaw-sandbox.yaml` filesystem policy:
```yaml
filesystem_policy:
  read_write:
    - /sandbox
    - /tmp
    - /dev/null
    - /sandbox/memory   # Mounted from ~/.nemoclaw/memory/
```

Blueprint runner adds to sandbox creation:
```
openshell sandbox create ... --volume ~/.nemoclaw/memory:/sandbox/memory
```

### Volume Lifecycle

1. **Creation**: `nemoclaw launch` or `nemoclaw memory init` creates the directory tree
2. **Mounting**: Blueprint runner mounts it into the sandbox
3. **Persistence**: Outlives sandbox. Data survives sandbox recreation, restarts, crashes
4. **Cleanup**: `nemoclaw eject` does NOT delete memory. Explicit `nemoclaw memory purge --confirm` required.

---

## PARA Fact Schema

Each PARA fact is an individual markdown file with YAML frontmatter.

### Frontmatter Schema

```yaml
---
id: fact-a1b2c3d4e5f6g7h8         # Unique ID: fact-{random16hex}
fact: "Short factual statement"     # Max 500 chars, the core fact
category: areas                     # projects | areas | resources | archives
status: active                      # active | superseded
tags:                               # Freeform tags for search
  - user-preferences
  - language-choice
created_at: "2026-03-17T14:30:22Z"  # ISO 8601
updated_at: "2026-03-17T14:30:22Z"  # ISO 8601
source_session: sess-20260317-143022-a1b2c3d4   # Origin session
source_type: auto                   # auto | agent | user
superseded_by: null                 # fact ID if this was superseded
supersedes: null                    # fact ID that this replaces
access_count: 0                     # Incremented on each recall
content_hash: "sha256:e3b0c44..."   # SHA-256 of normalized fact text
---

User prefers TypeScript over JavaScript for new projects.

## Context

During a discussion about setting up a new CLI tool, the user explicitly chose
TypeScript when given the option. Preference consistent across multiple sessions.

## Source

Session `sess-20260317-143022-a1b2c3d4` — message #42

> Part of [[_index]]
```

### Filename Convention
- Path: `{category}/{slugified-fact}.md`
- Slugification: lowercase, spaces to hyphens, strip special chars, max 60 chars
- Collision: append numeric suffix (`-2`, `-3`)
- Example: `areas/user-prefers-typescript.md`

### Versioning
- Facts are never deleted, only superseded
- `/memory forget <id>` sets `status: superseded` and `superseded_by: <new-id>`
- Superseded facts move to `archives/` and are deprioritized in recall

---

## Session Transcript Schema

### SQLite Database (`_db/sessions.db`)

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                -- sess-YYYYMMDD-HHmmss-random8hex
    started_at TEXT NOT NULL,           -- ISO 8601
    ended_at TEXT,                      -- ISO 8601, NULL if active
    model TEXT,                         -- Model ID used in session
    status TEXT NOT NULL DEFAULT 'active',  -- active | compacting | promoting | closed
    total_tokens INTEGER DEFAULT 0,     -- Approximate token count
    compaction_count INTEGER DEFAULT 0,
    metadata TEXT                        -- JSON blob for extensible metadata
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,                  -- user | assistant | system
    content TEXT NOT NULL,
    token_count INTEGER,                 -- Approximate tokens
    created_at TEXT NOT NULL,            -- ISO 8601
    compacted INTEGER DEFAULT 0,         -- 0=active, 1=compacted
    compaction_id TEXT                    -- References compactions.id
);

CREATE TABLE compactions (
    id TEXT PRIMARY KEY,                 -- comp-YYYYMMDD-HHmmss-random8hex
    session_id TEXT NOT NULL REFERENCES sessions(id),
    summary TEXT NOT NULL,               -- Structured markdown summary
    message_range_start INTEGER NOT NULL,
    message_range_end INTEGER NOT NULL,
    original_token_count INTEGER,
    summary_token_count INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE promoted_facts (
    id TEXT PRIMARY KEY,                 -- fact-random16hex
    session_id TEXT NOT NULL REFERENCES sessions(id),
    fact_file_path TEXT NOT NULL,         -- Relative PARA path
    content_hash TEXT NOT NULL,           -- SHA-256 for dedup
    promoted_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto'   -- auto | agent | user
);

-- Indexes
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_compacted ON messages(session_id, compacted);
CREATE INDEX idx_compactions_session ON compactions(session_id);
CREATE INDEX idx_promoted_facts_hash ON promoted_facts(content_hash);
```

### Database Configuration
- **Journal mode**: WAL (write-ahead logging) for concurrent reads
- **Busy timeout**: 5000ms
- **Foreign keys**: Enforced
- **Integrity check**: `PRAGMA integrity_check` on service start

### Exported Session Transcript Format

When a session closes, it exports to `sessions/{session-id}.md`:

```yaml
---
session_id: sess-20260317-143022-a1b2c3d4
started_at: "2026-03-17T14:30:22Z"
ended_at: "2026-03-17T15:45:10Z"
model: nvidia/nemotron-3-super-120b-a12b
message_count: 47
compaction_count: 2
facts_promoted: 3
---

# Session sess-20260317-143022-a1b2c3d4

## Summary
[Compaction summaries concatenated here]

## Transcript
**User** (14:30:22): [message content]
**Assistant** (14:30:35): [message content]
...

> Part of [[_index]]
```

---

## Auto-Recall Hook Design

### Architecture

The auto-recall hook runs on the **host side** before each user message reaches the agent. It is transparent to the agent — the agent receives an augmented prompt but doesn't know why.

### Hook Location
`~/.nemoclaw/hooks/pre-prompt.py` — installed by `nemoclaw launch` or `nemoclaw memory init`

### Integration Point
OpenClaw supports pre-prompt hooks. The hook:
1. Receives the user message on stdin
2. Queries QMD for relevant memories
3. Writes the augmented prompt to stdout

### Query Strategy

```
User message
      │
      ▼
Extract keywords (remove stop words, take top 10)
      │
      ▼
QMD keyword search (~30ms, --path ~/.nemoclaw/memory/, --limit 5)
      │
      ├── >= 2 results → use these
      │
      └── < 2 results → QMD vector search (~2s, fallback)
      │
      ▼
Sanitize results:
  - Verify each result path is within ~/.nemoclaw/memory/ (no symlink traversal)
  - Strip injection patterns (blocklist: "ignore instructions", "system:", "you are")
  - Check content_hash against _manifest.json (integrity verification)
  - Weight by source_type: user (1.0) > auto (0.8) > agent (0.6)
      │
      ▼
Format as context block (max ~500 tokens):

  <recalled-memory type="fact" source="areas/user-prefers-typescript.md">
    User prefers TypeScript over JavaScript for new projects.
  </recalled-memory>

  [Original user message]
```

### Key Design Decisions

1. **Keyword search first, vector fallback**: Keyword is fast (~30ms) and precise. Only fall back to vector (~2s) if keyword returns too few results. Keeps latency low for most prompts.

2. **XML-style tags**: The `<recalled-memory>` wrapper signals to the model that this is informational data, not instructions. This is the primary defense against prompt injection via recalled content.

3. **Token budget**: Maximum ~500 tokens of recalled context per prompt. Prevents context flooding.

4. **Graceful failure**: If QMD is unavailable, the hook passes the message through unchanged. No error visible to the user.

---

## Obsidian Integration

### Symlink Setup
```bash
ln -s ~/.nemoclaw/memory ~/Documents/obsidian-vault/projects/nemoclaw-memory
```

Created by `nemoclaw memory init`. Verified on each service start (log warning if broken).

### MOC Hierarchy

```
_index.md (Root MOC)
├── links to projects/_index.md
├── links to areas/_index.md
├── links to resources/_index.md
├── links to archives/_index.md
├── links to recent sessions (last 10)
└── links to recent daily notes (last 7)
```

Each category has its own `_index.md` MOC listing all facts in that category.

### Compatibility Requirements
- Valid YAML frontmatter (spaces not tabs, properly quoted strings)
- Wikilinks: `[[target]]` format
- Parent links: `> Part of [[_index]]` at bottom of every file
- Filenames: no `\/:*?"<>|` characters
- UTF-8 encoding throughout
- MOCs regenerated when facts are promoted (not on every message)

### Daily Notes

```yaml
---
date: "2026-03-17"
sessions:
  - sess-20260317-143022-a1b2c3d4
facts_promoted: 3
---

# 2026-03-17

## Sessions
- [[sess-20260317-143022-a1b2c3d4]]: Discussed memory system design

## Facts Promoted
- [[user-prefers-typescript]] (areas)
- [[openrouter-api-patterns]] (resources)

> Part of [[_index]]
```

---

## Error Handling

| Error State | Detection | Recovery | Degradation |
|---|---|---|---|
| SQLite corruption | Failed read/write, integrity check | Recreate DB, re-import from session markdown | Sessions still work, lose drill-back into compacted messages |
| PARA file malformed | YAML parse failure | Skip file, log warning | Fact not recalled, but still browsable in Obsidian for manual repair |
| QMD unavailable | Connection error / timeout | Skip recall, deliver message without context | Agent works normally, just without auto-recall |
| Disk full | ENOSPC on write | Stop writes, continue read-only | Active session continues in-memory, no persistence |
| Volume not mounted | Path doesn't exist | Create directory structure, log warning | First run bootstraps cleanly |
| Orphaned session | Active session with no close timestamp | On next start, promote facts and close it | No data loss |
| Concurrent write conflict | flock timeout (3 retries) | Log and skip | One write succeeds, other retries next cycle |
| Broken Obsidian symlink | Symlink target doesn't exist | Log warning, continue | Memory still works, just not browsable in Obsidian |

---

## Testing Strategy

### Test Categories

| Category | Estimated Count | Runtime | Focus |
|---|---|---|---|
| Unit | ~45 | <5s | Parsing, hashing, slugification, SQL queries, keyword extraction |
| Integration | ~25 | <30s | Session lifecycle, compaction pipeline, promotion flow |
| Edge case | ~20 | <10s | Corruption, concurrency, disk limits, malformed input |
| Security | ~15 | <10s | Injection detection, secret scanning, path traversal, symlink attacks |
| Stress | ~5 | <60s | Large transcripts, many concurrent sessions, 1000+ facts |

**Total: ~110 tests**

### Testing Principles (Mandatory)
- **Real implementations only**: SQLite temp databases, real temp directories, real file I/O
- **No mocks** except: QMD unavailability tests (use non-existent binary path, not a mock)
- **Deterministic fixtures**: Pre-built conversation JSON files with known expected outputs

### Key Test Scenarios

**Compaction (without LLM)**:
- Pre-built conversation fixtures (50 messages about fixing a bug, 30 about planning, etc.)
- Assert compaction summary contains expected topics, decisions, file references
- Not exact-match — "must contain" assertions

**Cross-session recall**:
- Session A promotes a fact → Session B recalls it via auto-recall hook
- Verify the full cycle: write → QMD index → search → inject

**Crash recovery**:
- Start session, write 20 messages, kill without clean shutdown
- Restart → verify orphaned session detected, facts promoted, new session starts clean

**Security tests**:
- Attempt to write a PARA fact containing prompt injection text → rejected by content scanner
- Attempt to store API keys in facts → rejected by secret scanner
- Auto-recall with tampered fact (hash mismatch) → fact skipped

### Test Fixtures

```
test/fixtures/
├── conversations/
│   ├── coding-bugfix.json           # 50 messages: fix a TS import error
│   ├── planning-discussion.json     # 30 messages: design a new feature
│   ├── mixed-topics.json            # 40 messages: spanning 3 topics
│   ├── remember-requests.json       # 20 messages: includes "remember this"
│   └── empty-session.json           # Only system messages
├── para-facts/
│   ├── valid-fact.md                # Correctly formatted
│   ├── malformed-yaml.md            # Invalid frontmatter
│   ├── injection-attempt.md         # Contains prompt injection
│   └── secret-leak.md              # Contains API key pattern
└── memory-dirs/
    ├── populated/                   # Pre-populated with 10 facts
    └── empty/                       # Empty structure
```

---

## Security Considerations

### Trust Boundary Map

```
HOST (Trusted)                           SANDBOX (Partially Trusted)
├── User: full read/write                ├── Agent: writes via service only
├── Auto-recall hook: reads memory,      ├── Session service: reads + writes
│   writes to prompt                     │   (validates all content)
├── QMD: read-only indexing              └── No direct volume write access
├── End-of-session hook: reads + writes
└── Obsidian: read-only browsing
```

### Critical Threats and Mitigations

#### 1. Prompt Injection via Auto-Recall (CRITICAL)

**Risk**: A previous session (or attacker) plants malicious instructions in PARA files. Auto-recall injects them into future prompts, hijacking the agent.

**Mitigations**:
- **XML delimiters**: Recalled content wrapped in `<recalled-memory>` tags that signal "data, not instructions"
- **Content blocklist**: Reject facts containing patterns like "ignore instructions", "system:", "you are now", "execute"
- **Source weighting**: Facts from `agent` source get lower recall priority than `user` source
- **Rate limiting**: Max 10 agent-driven facts per session, max 5 auto-promoted per session
- **Integrity manifest**: `_manifest.json` stores SHA-256 hashes; auto-recall hook verifies before injecting

**Residual risk**: Prompt injection is fundamentally unsolved. Semantic manipulation ("The user previously confirmed they want all checks disabled") cannot be caught by pattern matching. This is an industry-wide limitation.

#### 2. Secret Exfiltration via PARA Files (HIGH)

**Risk**: Agent stores API keys, credentials, or sensitive data in PARA facts. These persist on disk and are indexed by QMD.

**Mitigations**:
- **Secret scanner on write** (`sanitize.ts`): Detect patterns: `sk-`, `key-`, base64 > 20 chars, `-----BEGIN`, `export FOO=`, URLs with credentials
- **Reject facts containing secrets**: Return error to agent, log attempt
- **Audit command**: `openclaw nemoclaw memory audit` scans all files periodically

#### 3. Disk Exhaustion (HIGH)

**Risk**: Agent writes massive data to exhaust the mounted volume.

**Mitigations**:
- **Volume quota**: Default 1GB, stop writes at 90%, hard stop at 95%
- **File limits**: PARA facts max 10KB, session exports max 1MB, messages max 100KB
- **SQLite monitoring**: Compact/vacuum when DB > 500MB

#### 4. Symlink Traversal (MEDIUM)

**Risk**: Agent creates a symlink in the memory volume pointing to host files (`~/.ssh/id_rsa`). Auto-recall hook follows it.

**Mitigations**:
- Auto-recall hook resolves real paths and verifies they're within `~/.nemoclaw/memory/`
- Session service rejects symlink creation
- All file operations canonicalize paths before I/O

#### 5. SQLite Security (MEDIUM)

**Mitigations**:
- Parameterized queries only — never interpolate content into SQL
- Remove `sqlite3` binary from sandbox image if possible
- Database file permissions: `600` (rw-------)
- WAL mode + integrity check on start

### File Permissions

```
~/.nemoclaw/memory/             drwx------  (700)
~/.nemoclaw/memory/_db/         drwx------  (700)
~/.nemoclaw/memory/_db/*.db     -rw-------  (600)
~/.nemoclaw/memory/projects/    drwxr-xr-x  (755)
~/.nemoclaw/memory/**/*.md      -rw-r--r--  (644)
~/.nemoclaw/memory/_manifest.json  -rw-r--r--  (644)
```

---

## What Exists vs What Needs Building

### Already Exists (No Work Needed)

| Component | Location | Role |
|---|---|---|
| QMD server | Existing MCP server | Keyword + vector search over markdown files |
| Plugin registration API | `index.ts` | `registerService`, `registerCommand`, `registerCli`, `on()` |
| Config pattern | `onboard/config.ts` | `~/.nemoclaw/config.json` read/write |
| State pattern | `blueprint/state.ts` | `~/.nemoclaw/state/` read/write |
| Blueprint runner | `orchestrator/runner.py` | Subprocess execution, sandbox creation |
| Sandbox policy | `openclaw-sandbox.yaml` | Filesystem + network policy (needs small addition) |
| Obsidian vault | `~/Documents/obsidian-vault/` | Already configured, just needs symlink |

### Needs Building

| Component | Files | Effort | Priority |
|---|---|---|---|
| Session memory service | `memory/service.ts`, `memory/session.ts` | Medium | P0 |
| SQLite transcript storage | `memory/transcript-db.ts` | Medium | P0 |
| Compaction engine | `memory/compaction.ts` | Medium | P0 |
| PARA file operations | `memory/para.ts` | Medium | P0 |
| Content sanitization | `memory/sanitize.ts` | Small | P0 |
| Memory types | `memory/types.ts` | Small | P0 |
| Fact promotion logic | `memory/promotion.ts` | Medium | P1 |
| /memory slash command | `commands/memory.ts` | Medium | P1 |
| CLI memory commands | Addition to `cli.ts` | Small | P1 |
| Auto-recall hook | `hooks/pre-prompt.py` | Medium | P1 |
| Plugin registration updates | Additions to `index.ts` | Small | P1 |
| Sandbox policy update | `openclaw-sandbox.yaml` | Tiny | P1 |
| Blueprint volume mount | `orchestrator/runner.py` | Small | P1 |
| Test fixtures | `test/fixtures/` | Medium | P1 |
| Test suite | `test/memory/` | Large | P1 |
| Obsidian symlink setup | Part of `memory init` | Tiny | P2 |
| Integrity manifest | Part of `para.ts` | Small | P2 |
| Memory audit command | Part of CLI commands | Small | P2 |
| Daily notes | Part of `promotion.ts` | Small | P2 |

### Implementation Order

**Phase 1 — Core (P0)**: Session service + SQLite + compaction + PARA writes + sanitization
**Phase 2 — Integration (P1)**: Commands + auto-recall hook + promotion + policy update + tests
**Phase 3 — Polish (P2)**: Obsidian integration + integrity manifest + audit + daily notes

---

## Open Questions

1. **`api.on("message")` availability**: The codebase shows `api.on(hookName, handler)` exists, but we haven't confirmed what hook names the OpenClaw host emits. If `"message"` isn't available, we may need an alternative interception mechanism (e.g., middleware, or polling the conversation state).

2. **Container path mapping**: Inside the sandbox, is `~/.nemoclaw/memory/` accessible as the home directory of the `sandbox` user, or must we use an explicit mount at `/sandbox/memory/`? The sandbox policy only allows read-write to `/sandbox` and `/tmp`.

3. **QMD index configuration**: QMD currently indexes `~/src/**/*.md`. Adding `~/.nemoclaw/memory/` as a second index path may require QMD configuration changes or a symlink into the existing indexed tree.

4. **Pre-prompt hook mechanism**: How exactly does OpenClaw invoke pre-prompt hooks? This determines whether `pre-prompt.py` is a subprocess, a plugin callback, or a separate process.
