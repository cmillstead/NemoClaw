// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { exec } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import { promisify } from "node:util";
import type { PluginLogger, NemoClawConfig } from "../index.js";
import type { NemoClawState } from "../blueprint/state.js";
import { loadState as loadStateImpl } from "../blueprint/state.js";

const defaultExecAsync = promisify(exec);

/**
 * Detect whether the plugin is running inside an OpenShell sandbox.
 * Inside sandboxes the root filesystem is mounted at /sandbox and openshell
 * host commands are not available, so querying `openshell sandbox status`
 * would always fail — producing false-negative "not running" reports.
 */
function isInsideSandbox(checkExists: (path: string) => boolean = nodeExistsSync): boolean {
  return checkExists("/sandbox/.openclaw") || checkExists("/sandbox/.nemoclaw");
}

/** Injectable dependencies for testing without mocks. */
export interface StatusDeps {
  existsSync: (path: string) => boolean;
  execAsync: (
    cmd: string,
    opts: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  loadState: () => NemoClawState;
}

const defaultDeps: StatusDeps = {
  existsSync: nodeExistsSync,
  execAsync: defaultExecAsync,
  loadState: loadStateImpl,
};

export interface StatusOptions {
  json: boolean;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
  deps?: StatusDeps;
}

export async function cliStatus(opts: StatusOptions): Promise<void> {
  const { json: jsonOutput, logger } = opts;
  const deps = opts.deps ?? defaultDeps;
  const state = deps.loadState();
  const sandboxName = state.sandboxName ?? "openclaw";
  const insideSandbox = isInsideSandbox(deps.existsSync);

  const [sandbox, inference] = await Promise.all([
    getSandboxStatus(sandboxName, insideSandbox, deps.execAsync),
    getInferenceStatus(insideSandbox, deps.execAsync),
  ]);

  const statusData = {
    nemoclaw: {
      lastAction: state.lastAction,
      lastRunId: state.lastRunId,
      blueprintVersion: state.blueprintVersion,
      sandboxName: state.sandboxName,
      migrationSnapshot: state.migrationSnapshot,
      updatedAt: state.updatedAt,
    },
    sandbox,
    inference,
    insideSandbox,
  };

  if (jsonOutput) {
    logger.info(JSON.stringify(statusData, null, 2));
    return;
  }

  logger.info("NemoClaw Status");
  logger.info("===============");
  logger.info("");

  if (insideSandbox) {
    logger.info("Context: running inside an active OpenShell sandbox");
    logger.info("  Host sandbox state is not inspectable from inside the sandbox.");
    logger.info("  Run 'openshell sandbox status' on the host for full details.");
    logger.info("");
  }

  logger.info("Plugin State:");
  if (state.lastAction) {
    logger.info(`  Last action:      ${state.lastAction}`);
    logger.info(`  Blueprint:        ${state.blueprintVersion ?? "unknown"}`);
    logger.info(`  Run ID:           ${state.lastRunId ?? "none"}`);
    logger.info(`  Updated:          ${state.updatedAt}`);
  } else {
    logger.info("  No operations have been performed yet.");
  }
  logger.info("");

  logger.info("Sandbox:");
  if (sandbox.running) {
    logger.info(`  Name:    ${sandbox.name}`);
    logger.info("  Status:  running");
    logger.info(`  Uptime:  ${sandbox.uptime ?? "unknown"}`);
  } else if (sandbox.insideSandbox) {
    logger.info(`  Name:    ${sandbox.name}`);
    logger.info("  Status:  active (inside sandbox)");
    logger.info("  Note:    Cannot query host sandbox state from within the sandbox.");
  } else {
    logger.info("  Status:  not running");
  }
  logger.info("");

  logger.info("Inference:");
  if (inference.configured) {
    logger.info(`  Provider:  ${inference.provider ?? "unknown"}`);
    logger.info(`  Model:     ${inference.model ?? "unknown"}`);
    logger.info(`  Endpoint:  ${inference.endpoint ?? "unknown"}`);
  } else if (inference.insideSandbox) {
    logger.info("  Status:  unable to query from inside sandbox");
    logger.info("  Note:    Run 'openshell inference get' on the host to check.");
  } else {
    logger.info("  Not configured");
  }

  if (state.migrationSnapshot) {
    logger.info("");
    logger.info("Rollback:");
    logger.info(`  Snapshot:  ${state.migrationSnapshot}`);
    logger.info("  Run 'openclaw nemoclaw eject' to restore host installation.");
  }
}

interface SandboxStatus {
  name: string;
  running: boolean;
  uptime: string | null;
  insideSandbox: boolean;
}

interface SandboxStatusResponse {
  state?: string;
  uptime?: string;
}

async function getSandboxStatus(
  sandboxName: string,
  insideSandbox: boolean,
  execFn: StatusDeps["execAsync"] = defaultExecAsync,
): Promise<SandboxStatus> {
  if (insideSandbox) {
    return { name: sandboxName, running: false, uptime: null, insideSandbox: true };
  }
  try {
    const { stdout } = await execFn(`openshell sandbox status ${sandboxName} --json`, {
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout) as SandboxStatusResponse;
    return {
      name: sandboxName,
      running: parsed.state === "running",
      uptime: parsed.uptime ?? null,
      insideSandbox: false,
    };
  } catch {
    return { name: sandboxName, running: false, uptime: null, insideSandbox: false };
  }
}

interface InferenceStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  endpoint: string | null;
  insideSandbox: boolean;
}

interface InferenceStatusResponse {
  provider?: string;
  model?: string;
  endpoint?: string;
}

async function getInferenceStatus(
  insideSandbox: boolean,
  execFn: StatusDeps["execAsync"] = defaultExecAsync,
): Promise<InferenceStatus> {
  if (insideSandbox) {
    return { configured: false, provider: null, model: null, endpoint: null, insideSandbox: true };
  }
  try {
    const { stdout } = await execFn("openshell inference get --json", {
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout) as InferenceStatusResponse;
    return {
      configured: true,
      provider: parsed.provider ?? null,
      model: parsed.model ?? null,
      endpoint: parsed.endpoint ?? null,
      insideSandbox: false,
    };
  } catch {
    return { configured: false, provider: null, model: null, endpoint: null, insideSandbox: false };
  }
}
