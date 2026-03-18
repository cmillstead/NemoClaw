// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Handler for the /memory slash command.
 *
 * Subcommands:
 *   /memory           -- status
 *   /memory search    -- full-text search
 *   /memory expand    -- drill back into compacted messages
 *   /memory remember  -- manually promote a fact
 *   /memory forget    -- supersede a fact
 *   /memory facts     -- list PARA facts
 *   /memory session   -- current session info
 */

import type { PluginCommandContext, PluginCommandResult, OpenClawPluginApi } from "../index.js";
import { getSessionManager } from "../memory/service.js";
import { promoteFactNow } from "../memory/promotion.js";
import { listFacts, parseFact } from "../memory/para.js";
import type { ParaCategory } from "../memory/types.js";
import { PARA_CATEGORIES } from "../memory/types.js";

export function handleMemorySlashCommand(
  ctx: PluginCommandContext,
  api: OpenClawPluginApi,
): PluginCommandResult {
  const parts = ctx.args?.trim().split(/\s+/) ?? [];
  const subcommand = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");

  switch (subcommand) {
    case "":
    case "status":
      return memoryStatus();
    case "search":
      return memorySearch(rest);
    case "expand":
      return memoryExpand(rest);
    case "remember":
      return memoryRemember(rest, api);
    case "forget":
      return memoryForget(rest);
    case "facts":
      return memoryFacts(rest as ParaCategory | "");
    case "session":
      return memorySession();
    default:
      return memoryHelp();
  }
}

function memoryHelp(): PluginCommandResult {
  return {
    text: [
      "**Memory System**",
      "",
      "Usage: `/memory <subcommand>`",
      "",
      "Subcommands:",
      "  `status`           - Memory system status",
      "  `search <query>`   - Search transcripts and facts",
      "  `expand <id>`      - Retrieve compacted messages",
      "  `remember <fact>`  - Store a fact permanently",
      "  `forget <fact-id>` - Supersede a fact",
      "  `facts [category]` - List stored facts",
      "  `session`          - Current session info",
    ].join("\n"),
  };
}

function memoryStatus(): PluginCommandResult {
  const mgr = getSessionManager();
  if (!mgr) {
    return { text: "**Memory**: Service not running." };
  }

  const state = mgr.getState();
  return {
    text: [
      "**Memory Status**",
      "",
      `Session: ${state.sessionId ?? "none"}`,
      `Status: ${state.status}`,
      `Messages: ${String(state.messageCount)}`,
      `Tokens: ${String(state.tokenCount)}`,
      `Compactions: ${String(state.compactionCount)}`,
    ].join("\n"),
  };
}

function memorySearch(query: string): PluginCommandResult {
  if (!query) {
    return { text: "Usage: `/memory search <query>`" };
  }
  // TODO: Implement full-text search across transcripts + PARA facts
  return { text: `Search for "${query}" -- not yet implemented.` };
}

function memoryExpand(compactionId: string): PluginCommandResult {
  if (!compactionId) {
    return { text: "Usage: `/memory expand <compaction-id>`" };
  }

  const mgr = getSessionManager();
  if (!mgr) {
    return { text: "**Memory**: Service not running." };
  }

  const expanded = mgr.expandCompaction(compactionId);
  if (!expanded) {
    return { text: `Compaction \`${compactionId}\` not found in current session.` };
  }

  return { text: expanded };
}

function memoryRemember(fact: string, api: OpenClawPluginApi): PluginCommandResult {
  if (!fact) {
    return { text: "Usage: `/memory remember <fact text>`" };
  }

  const mgr = getSessionManager();
  if (!mgr) {
    return { text: "**Memory**: Service not running." };
  }

  const sessionId = mgr.getSessionId();
  if (!sessionId) {
    return { text: "**Memory**: No active session." };
  }

  try {
    const filePath = promoteFactNow(
      mgr.getDb(),
      mgr.getConfig(),
      sessionId,
      fact,
      "areas",
      [],
      api.logger,
    );
    return { text: `Fact stored: \`${filePath}\`` };
  } catch (err) {
    return { text: `Failed to store fact: ${String(err)}` };
  }
}

function memoryForget(factId: string): PluginCommandResult {
  if (!factId) {
    return { text: "Usage: `/memory forget <fact-id>`" };
  }
  // TODO: Find fact file by ID and supersede it
  return { text: `Supersede fact \`${factId}\` -- not yet implemented.` };
}

function memoryFacts(category: ParaCategory | ""): PluginCommandResult {
  const mgr = getSessionManager();
  if (!mgr) {
    return { text: "**Memory**: Service not running." };
  }

  const config = mgr.getConfig();

  try {
    const cat = category && PARA_CATEGORIES.includes(category) ? category : undefined;
    const facts = listFacts(config.memoryDir, cat);

    if (facts.length === 0) {
      return { text: "No facts stored." };
    }

    const lines = [`**Facts** (${String(facts.length)} total)`, ""];
    for (const path of facts.slice(0, 20)) {
      const parsed = parseFact(path);
      if (parsed) {
        lines.push(`- **${parsed.category}**: ${parsed.fact} (\`${parsed.id}\`)`);
      }
    }

    if (facts.length > 20) {
      lines.push(`\n...and ${String(facts.length - 20)} more.`);
    }

    return { text: lines.join("\n") };
  } catch {
    return { text: "Unable to list facts -- memory directory may not be accessible." };
  }
}

function memorySession(): PluginCommandResult {
  const mgr = getSessionManager();
  if (!mgr) {
    return { text: "**Memory**: Service not running." };
  }

  const state = mgr.getState();
  const summaries = mgr.getCompactionSummaries();

  const lines = [
    "**Current Session**",
    "",
    `ID: ${state.sessionId ?? "none"}`,
    `Status: ${state.status}`,
    `Messages: ${String(state.messageCount)}`,
    `Active tokens: ${String(state.tokenCount)}`,
    `Compactions: ${String(state.compactionCount)}`,
  ];

  if (summaries.length > 0) {
    lines.push("", "**Compaction Summaries:**");
    for (const s of summaries) {
      lines.push("", s);
    }
  }

  return { text: lines.join("\n") };
}
