import type { PluginService, OpenClawPluginApi } from "../index.js";
import { SessionManager } from "./session.js";
/**
 * Get the active session manager (for use by commands).
 */
export declare function getSessionManager(): SessionManager | null;
/**
 * Create the memory service for plugin registration.
 */
export declare function createMemoryService(_api: OpenClawPluginApi): PluginService;
//# sourceMappingURL=service.d.ts.map