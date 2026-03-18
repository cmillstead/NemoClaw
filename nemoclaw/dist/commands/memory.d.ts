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
export declare function handleMemorySlashCommand(ctx: PluginCommandContext, api: OpenClawPluginApi): PluginCommandResult;
//# sourceMappingURL=memory.d.ts.map