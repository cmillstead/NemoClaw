# ContextEngine Integration — Memory-Aware Subagents

**Date:** 2026-03-17
**Status:** Approved
**Depends on:** Memory System (Phases 1-3, merged)

## Overview

Integrate NemoClaw's memory system with OpenClaw's ContextEngine plugin API to enable:

1. **Memory-aware subagent spawning** — Subagents receive relevant memories + parent session context at spawn
2. **Fact capture from subagents** — Subagent transcripts are mined for durable facts on completion
3. **Async memory operations** — Compaction, promotion, and maintenance run as background subagents

## Prerequisites — OpenClaw SDK Verification

The ContextEngine plugin API and `sessions_spawn` are documented in OpenClaw v2026.3.7+ but are NOT present in NemoClaw's current typed interface. Before implementation:

1. **Verify ContextEngine registration** — Confirm whether `api.registerContextEngine()` exists as a discrete method, or whether hooks are registered via the existing `api.on()` mechanism (e.g., `api.on("prepareSubagentSpawn", handler)`). The implementation plan must start with an SDK discovery task that inspects the actual OpenClaw host API at runtime.

2. **Verify `sessions_spawn` access** — Confirm how plugins invoke `sessions_spawn`. Possible paths:
   - `api.spawn(opts)` — a method on the plugin API object
   - `api.tools.sessions_spawn(opts)` — exposed via the tools namespace
   - Direct import from `openclaw/plugin-sdk/core`

3. **Fallback strategy** — If the ContextEngine hooks are not available in the current SDK version, fall back to `api.on()` with generic event names. If `sessions_spawn` is not available, all async operations run synchronously (existing code paths). The design degrades gracefully.

**This spec assumes the happy path (all APIs available). The implementation plan will include a Batch 0 SDK discovery step that gates all subsequent work.**

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration approach | Direct (no adapter layer) | NemoClaw only runs on OpenClaw. YAGNI. |
| Context injection level | Session-aware (B) | Session summary + targeted recall. Full briefing wastes tokens; targeted alone misses recent decisions. |
| Background task scope | Full maintenance (C) | Compaction + promotion + janitor. All are natural async operations. |
| Subagent memory access | Write-through (B) | SQLite WAL handles concurrent writes. Janitor uses lock file for destructive ops. |
| Janitor trigger | Event-driven | After every 10th promotion or explicit `/memory audit`. No polling. |

## Architecture

### Hook Registration

NemoClaw registers ContextEngine hooks in the plugin entry point. The registration mechanism depends on SDK discovery (see Prerequisites). Three hooks:

| Hook | Trigger | Action |
|------|---------|--------|
| `prepareSubagentSpawn` | Before any subagent starts | Inject session summary + targeted QMD recall (~700 tokens max) |
| `onSubagentEnded` | After any subagent completes | Extract and promote facts from subagent transcript |
| `afterTurn` | After each agent turn | Check token count, trigger async compaction if threshold hit |

**Registration approaches (in priority order):**
1. `api.registerContextEngine({ id, hooks })` — if the ContextEngine plugin slot exists
2. `api.on("prepareSubagentSpawn", handler)` — if hooks are registered via the event system
3. No registration — graceful degradation; memory system works without subagent awareness

Hooks NOT implemented: `bootstrap`, `ingest`, `assemble`, `compact` — NemoClaw handles context at the memory layer, not the prompt layer.

### Context Injection Flow (`prepareSubagentSpawn`)

```
task description
  → extractKeywords() [compaction.ts]
  → recallMemories() [recall.ts] — targeted facts (500 token budget)
  → truncateCompactionSummaries() [context-hooks.ts, NEW] — select most recent summaries (200 token budget)
  → format as <nemoclaw-context> XML block
  → return string to OpenClaw
```

**Injection semantics:** The returned string is prepended to the subagent's system prompt by the OpenClaw host. This is the documented behavior for `prepareSubagentSpawn` return values — the host inserts the string before the subagent's first turn. If the hook returns `null`, no injection occurs.

**Token budget:** 700 tokens total, an increase from the 500-token recall-only budget. The 200-token session summary provides critical recent-decision context that targeted recall alone would miss. The two budgets are independent: recall fills up to 500, summary fills up to 200, and they're concatenated.

**Summary truncation:** `getCompactionSummaries()` returns all compaction summaries as `string[]`. The new `truncateCompactionSummaries()` helper in `context-hooks.ts` selects the most recent summaries that fit within the 200-token budget, discarding older ones.

Output format:

```xml
<nemoclaw-context type="subagent-briefing">
  <session-summary>
    ### Topics
    - Provider-agnostic refactor for NemoClaw
    ### Decisions
    - Let's use OpenRouter as the default provider
  </session-summary>

  <recalled-memory type="fact" source="areas/user-prefers-openrouter.md">
    User prefers OpenRouter for multi-provider routing
  </recalled-memory>
</nemoclaw-context>
```

**Opt-out via metadata:**
- `memory: "minimal"` — skip session summary, only targeted recall
- `memory: "none"` — skip all memory injection
- Default: full briefing (session summary + targeted recall)

### Fact Capture Flow (`onSubagentEnded`)

```
subagent transcript (from SubagentEndedContext.messages)
  → guard: skip if exitReason !== "completed" (timeouts/errors may have partial content)
  → guard: skip if metadata._nemoclawOp exists (internal maintenance subagents)
  → promoteFromMessages(messages) [promotion.ts, NEW variant]
    → extractFromMessages() [compaction.ts]
    → scanForSecrets() + scanForInjection() [sanitize.ts]
    → contentHash() dedup [para.ts]
    → writeFact() to PARA [para.ts]
    → insertPromotedFact() to DB [transcript-db.ts]
  → check janitor trigger (see Orchestrator section)
```

**Subagent messages are NOT written to the parent's DB.** The `SubagentEndedContext.messages` array is passed directly to a new `promoteFromMessages()` function — a variant of `promoteEndOfSession()` that accepts a `MessageRecord[]` instead of reading from the DB. This avoids polluting the parent session's transcript with subagent messages.

**This means `promotion.ts` needs a minor edit** — extract the message-processing logic into `promoteFromMessages()` and have `promoteEndOfSession()` call it internally. See File Changes.

### Orchestrator (`orchestrator.ts`)

Wraps the spawn API for three internal async operations. The orchestrator receives a `SpawnSession` function as a constructor parameter — it does not import OpenClaw directly.

**Spawn API access:** The orchestrator calls `SpawnSession` which is bound to the actual OpenClaw API during plugin registration in `index.ts`. Possible bindings:
- `api.spawn.bind(api)` — if spawn is a method on the plugin API
- `(opts) => api.tools.sessions_spawn(opts)` — if exposed via tools
- The binding is determined during the Batch 0 SDK discovery step

#### Async Compaction

```
token threshold hit
  → orchestrator.spawnCompaction(sessionId, messages)
  → SpawnSession({ task: "...", mode: "run", sandbox: "inherit", metadata: { _nemoclawOp: "compact" } })
  → subagent runs compact(), writes to DB
  → parent picks up compaction record
  → fallback: synchronous compaction if spawn fails or SpawnSession is null
```

#### Async Promotion

```
session close
  → orchestrator.spawnPromotion(sessionId)
  → SpawnSession({ task: "...", mode: "run", sandbox: "inherit", metadata: { _nemoclawOp: "promote" } })
  → subagent runs promoteEndOfSession()
  → parent doesn't wait — session close returns immediately
  → fallback: synchronous promotion if spawn fails or SpawnSession is null
```

#### Janitor

Triggered when `COUNT(*) FROM promoted_facts` modulo 10 equals 0, or by explicit `/memory audit`:

```
janitor trigger
  → acquire lock (~/.nemoclaw/memory/_janitor.lock, PID + timestamp)
  → if locked and not stale (<10 min), skip
  → SpawnSession({ task: "...", mode: "run", sandbox: "inherit", metadata: { _nemoclawOp: "janitor" } })
  → subagent: dedup scan, supersede duplicates, regenerateManifest(), updateCategoryMocs()
  → onSubagentEnded detects metadata._nemoclawOp === "janitor" and releases lock
  → fallback: synchronous janitor if spawn fails or SpawnSession is null
```

**Internal subagent identification:** All NemoClaw-spawned subagents set `metadata._nemoclawOp` to `"compact"`, `"promote"`, or `"janitor"`. The `onSubagentEnded` hook checks this field to:
- Skip fact capture for internal maintenance subagents
- Release the janitor lock when a janitor subagent finishes

#### Spawn Defaults

| Param | Value | Rationale |
|-------|-------|-----------|
| `mode` | `"run"` | Ephemeral — no persistent session needed |
| `sandbox` | `"inherit"` | Share parent's `/sandbox/memory` mount |
| `memory` | `"none"` | Internal tasks don't need memory injection |
| `runTimeoutSeconds` | `60` | Compaction/promotion should be fast |
| `cleanup` | `"delete"` | No reason to keep maintenance sessions |

### Concurrency Model

- SQLite WAL mode supports concurrent reads + single writer with 5s busy timeout
- Memory writes are rare and fast (single row insert + small file write)
- `contentHash()` dedup prevents duplicate facts from concurrent promoters
- Janitor acquires exclusive lock file before destructive operations
- Stale locks (>10 min) are force-released

## API Types

```typescript
interface ContextEnginePlugin {
  id: string;
  prepareSubagentSpawn?: (ctx: SubagentSpawnContext) => string | null;
  onSubagentEnded?: (ctx: SubagentEndedContext) => void;
  afterTurn?: (ctx: AfterTurnContext) => void;
}

interface SubagentSpawnContext {
  task: string;
  parentSessionId: string;
  metadata?: Record<string, unknown>;
}

interface SubagentEndedContext {
  sessionId: string;
  parentSessionId: string;
  messages: MessageRecord[];
  exitReason: "completed" | "timeout" | "error";
}

interface AfterTurnContext {
  sessionId: string;
  role: "user" | "assistant";
  tokenCount: number;
}

/**
 * Spawn function injected from the OpenClaw host API.
 * Bound during plugin registration; null if spawn API is unavailable.
 * When null, all async operations fall back to synchronous execution.
 */
type SpawnSession = ((opts: {
  task: string;
  mode?: "run" | "session";
  sandbox?: "inherit" | "require";
  runTimeoutSeconds?: number;
  cleanup?: "delete" | "keep";
  label?: string;
  metadata?: Record<string, unknown>;
}) => string) | null;
```

## File Changes

| File | Change | Est. Lines |
|------|--------|-----------|
| `memory/context-hooks.ts` | **New** — Hook implementations + `truncateCompactionSummaries()` | ~140 |
| `memory/orchestrator.ts` | **New** — Spawn wrapper, async ops, lock file | ~180 |
| `memory/types.ts` | **Edit** — New type definitions | ~40 |
| `memory/promotion.ts` | **Edit** — Extract `promoteFromMessages()` variant | ~20 |
| `index.ts` | **Edit** — Register ContextEngine, wire orchestrator, bind SpawnSession | ~25 |
| `service.ts` | **Edit** — Pass orchestrator to session manager | ~15 |
| `session.ts` | **Edit** — Accept optional orchestrator, delegate compaction | ~10 |
| `memory/context-hooks.test.ts` | **New** — Context injection + fact capture tests | ~150 |
| `memory/orchestrator.test.ts` | **New** — Spawn logic, lock file, fallback tests | ~120 |

**Unchanged:** `recall.ts`, `compaction.ts`, `para.ts`, `sanitize.ts`, `transcript-db.ts`, `commands/memory.ts`, `cli.ts`, sandbox config.

## Testing Strategy

- `context-hooks.test.ts` — Real SQLite, real PARA files, real compaction. Test double for `SpawnSession` (justified: OpenClaw host API unavailable locally). Contract verification via TypeScript type assertion on the test double to ensure it matches the `SpawnSession` signature.
- `orchestrator.test.ts` — Real lock file on real filesystem, test double for `SpawnSession`, verify fallback to synchronous compaction/promotion when `SpawnSession` is null or throws.

## OpenClaw Config Required

```yaml
agents:
  defaults:
    subagents:
      maxSpawnDepth: 2
      maxChildrenPerAgent: 5
      maxConcurrent: 8
```

## Future Work

- Adapter layer if NemoClaw ports to other agent hosts
- `streamTo: "parent"` for real-time progress from compaction subagents
- `sessions_send` for peer-to-peer memory sharing between agents
