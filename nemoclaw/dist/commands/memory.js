"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMemorySlashCommand = handleMemorySlashCommand;
const service_js_1 = require("../memory/service.js");
const promotion_js_1 = require("../memory/promotion.js");
const para_js_1 = require("../memory/para.js");
const types_js_1 = require("../memory/types.js");
function handleMemorySlashCommand(ctx, api) {
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
            return memoryFacts(rest);
        case "session":
            return memorySession();
        default:
            return memoryHelp();
    }
}
function memoryHelp() {
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
function memoryStatus() {
    const mgr = (0, service_js_1.getSessionManager)();
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
function memorySearch(query) {
    if (!query) {
        return { text: "Usage: `/memory search <query>`" };
    }
    // TODO: Implement full-text search across transcripts + PARA facts
    return { text: `Search for "${query}" -- not yet implemented.` };
}
function memoryExpand(compactionId) {
    if (!compactionId) {
        return { text: "Usage: `/memory expand <compaction-id>`" };
    }
    const mgr = (0, service_js_1.getSessionManager)();
    if (!mgr) {
        return { text: "**Memory**: Service not running." };
    }
    const expanded = mgr.expandCompaction(compactionId);
    if (!expanded) {
        return { text: `Compaction \`${compactionId}\` not found in current session.` };
    }
    return { text: expanded };
}
function memoryRemember(fact, api) {
    if (!fact) {
        return { text: "Usage: `/memory remember <fact text>`" };
    }
    const mgr = (0, service_js_1.getSessionManager)();
    if (!mgr) {
        return { text: "**Memory**: Service not running." };
    }
    const sessionId = mgr.getSessionId();
    if (!sessionId) {
        return { text: "**Memory**: No active session." };
    }
    try {
        const filePath = (0, promotion_js_1.promoteFactNow)(mgr.getDb(), mgr.getConfig(), sessionId, fact, "areas", [], api.logger);
        return { text: `Fact stored: \`${filePath}\`` };
    }
    catch (err) {
        return { text: `Failed to store fact: ${String(err)}` };
    }
}
function memoryForget(factId) {
    if (!factId) {
        return { text: "Usage: `/memory forget <fact-id>`" };
    }
    // TODO: Find fact file by ID and supersede it
    return { text: `Supersede fact \`${factId}\` -- not yet implemented.` };
}
function memoryFacts(category) {
    const mgr = (0, service_js_1.getSessionManager)();
    if (!mgr) {
        return { text: "**Memory**: Service not running." };
    }
    const config = mgr.getConfig();
    try {
        const cat = category && types_js_1.PARA_CATEGORIES.includes(category)
            ? category
            : undefined;
        const facts = (0, para_js_1.listFacts)(config.memoryDir, cat);
        if (facts.length === 0) {
            return { text: "No facts stored." };
        }
        const lines = [`**Facts** (${String(facts.length)} total)`, ""];
        for (const path of facts.slice(0, 20)) {
            const parsed = (0, para_js_1.parseFact)(path);
            if (parsed) {
                lines.push(`- **${parsed.category}**: ${parsed.fact} (\`${parsed.id}\`)`);
            }
        }
        if (facts.length > 20) {
            lines.push(`\n...and ${String(facts.length - 20)} more.`);
        }
        return { text: lines.join("\n") };
    }
    catch {
        return { text: "Unable to list facts -- memory directory may not be accessible." };
    }
}
function memorySession() {
    const mgr = (0, service_js_1.getSessionManager)();
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
//# sourceMappingURL=memory.js.map