// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NemoClawState } from "../blueprint/state.js";
import type { PluginLogger, NemoClawConfig } from "../index.js";
import { cliStatus } from "./status.js";
import type { StatusDeps } from "./status.js";

// ---------------------------------------------------------------------------
// Helpers — all test doubles are injected via StatusDeps, no module patching
// ---------------------------------------------------------------------------

function blankState(): NemoClawState {
  return {
    lastRunId: null,
    lastAction: null,
    blueprintVersion: null,
    sandboxName: null,
    migrationSnapshot: null,
    hostBackupPath: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function populatedState(): NemoClawState {
  return {
    lastRunId: "run-a1b2c3d4",
    lastAction: "migrate",
    blueprintVersion: "0.1.0",
    sandboxName: "openclaw",
    migrationSnapshot: "/root/.nemoclaw/snapshots/pre-migrate.tar.gz",
    hostBackupPath: "/root/.nemoclaw/backups/host-backup",
    createdAt: "2026-03-15T10:30:00.000Z",
    updatedAt: "2026-03-15T10:32:45.000Z",
  };
}

const defaultConfig: NemoClawConfig = {
  blueprintVersion: "latest",
  blueprintRegistry: "ghcr.io/nvidia/nemoclaw-blueprint",
  sandboxName: "openclaw",
  inferenceProvider: "nvidia",
};

function captureLogger(): { lines: string[]; logger: PluginLogger } {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      info: (msg: string) => lines.push(msg),
      warn: (msg: string) => lines.push(`WARN: ${msg}`),
      error: (msg: string) => lines.push(`ERROR: ${msg}`),
      debug: () => {},
    },
  };
}

/**
 * Create a fake execAsync that routes by command substring.
 * Injected via StatusDeps — no module-level patching needed.
 */
function fakeExec(responses: Record<string, string | Error>): StatusDeps["execAsync"] {
  return (cmd: string) => {
    for (const [substring, response] of Object.entries(responses)) {
      if (cmd.includes(substring)) {
        if (response instanceof Error) {
          return Promise.reject(response);
        }
        return Promise.resolve({ stdout: response, stderr: "" });
      }
    }
    return Promise.reject(new Error(`command not found: ${cmd}`));
  };
}

/**
 * Create a fake existsSync for sandbox detection.
 * Uses constructor-injected boolean instead of real filesystem sentinel files
 * because the paths being checked (/sandbox/.openclaw) are absolute system paths.
 */
function makeSandboxDetector(isSandbox: boolean): (path: string) => boolean {
  return (path: string) => {
    if (path === "/sandbox/.openclaw") return isSandbox;
    if (path === "/sandbox/.nemoclaw") return false;
    return false;
  };
}

function makeDeps(overrides: Partial<StatusDeps> = {}): StatusDeps {
  return {
    existsSync: overrides.existsSync ?? (() => false),
    execAsync: overrides.execAsync ?? fakeExec({}),
    loadState: overrides.loadState ?? blankState,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cliStatus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "status-test-"));
  });

  const cleanup = () => {
    rmSync(tmpDir, { recursive: true, force: true });
  };

  // =========================================================================
  // Scenario 1: Host — no openshell, blank state
  // =========================================================================
  describe("host — no openshell, blank state", () => {
    it("shows 'not running' and 'Not configured' in text output", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps();

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Status:  not running");
      expect(output).toContain("Not configured");
      expect(output).not.toContain("inside sandbox");
      expect(output).not.toContain("active (inside sandbox)");
      cleanup();
    });

    it("includes insideSandbox: false in JSON output", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps();

      await cliStatus({ json: true, logger, pluginConfig: defaultConfig, deps });

      const data = JSON.parse(lines.join(""));
      expect(data.insideSandbox).toBe(false);
      expect(data.sandbox.insideSandbox).toBe(false);
      expect(data.sandbox.running).toBe(false);
      expect(data.inference.insideSandbox).toBe(false);
      expect(data.inference.configured).toBe(false);
      cleanup();
    });

    it("shows 'No operations have been performed yet'", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps();

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      expect(lines.join("\n")).toContain("No operations have been performed yet.");
      cleanup();
    });
  });

  // =========================================================================
  // Scenario 2: Host — sandbox running, inference configured
  // =========================================================================
  describe("host — sandbox running, inference configured", () => {
    it("shows running sandbox with uptime in text output", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: fakeExec({
          "sandbox status": JSON.stringify({ state: "running", uptime: "2h 14m" }),
          "inference get": JSON.stringify({
            provider: "nvidia",
            model: "nemotron-3-super-120b",
            endpoint: "https://integrate.api.nvidia.com",
          }),
        }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Status:  running");
      expect(output).toContain("Uptime:  2h 14m");
      expect(output).toContain("Name:    openclaw");
      expect(output).not.toContain("inside sandbox");
      cleanup();
    });

    it("shows configured inference in text output", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: fakeExec({
          "sandbox status": JSON.stringify({ state: "running", uptime: "2h 14m" }),
          "inference get": JSON.stringify({
            provider: "nvidia",
            model: "nemotron-3-super-120b",
            endpoint: "https://integrate.api.nvidia.com",
          }),
        }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Provider:  nvidia");
      expect(output).toContain("Model:     nemotron-3-super-120b");
      expect(output).toContain("Endpoint:  https://integrate.api.nvidia.com");
      cleanup();
    });

    it("returns correct JSON structure", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: fakeExec({
          "sandbox status": JSON.stringify({ state: "running", uptime: "2h 14m" }),
          "inference get": JSON.stringify({
            provider: "nvidia",
            model: "nemotron-3-super-120b",
            endpoint: "https://integrate.api.nvidia.com",
          }),
        }),
      });

      await cliStatus({ json: true, logger, pluginConfig: defaultConfig, deps });

      const data = JSON.parse(lines.join(""));
      expect(data.insideSandbox).toBe(false);
      expect(data.sandbox.running).toBe(true);
      expect(data.sandbox.uptime).toBe("2h 14m");
      expect(data.inference.configured).toBe(true);
      expect(data.inference.provider).toBe("nvidia");
      cleanup();
    });
  });

  // =========================================================================
  // Scenario 3: Host — sandbox running, no inference
  // =========================================================================
  describe("host — sandbox running, no inference", () => {
    it("shows running sandbox but 'Not configured' inference", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: fakeExec({
          "sandbox status": JSON.stringify({ state: "running", uptime: "45m 12s" }),
          "inference get": new Error("no inference configured"),
        }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Status:  running");
      expect(output).toContain("Not configured");
      expect(output).not.toContain("unable to query");
      cleanup();
    });
  });

  // =========================================================================
  // Scenario 4: Inside sandbox
  // =========================================================================
  describe("inside sandbox — core detection", () => {
    it("shows 'active (inside sandbox)' instead of 'not running'", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("active (inside sandbox)");
      expect(output).not.toContain("Status:  not running");
      cleanup();
    });

    it("shows sandbox context banner", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Context: running inside an active OpenShell sandbox");
      expect(output).toContain("Host sandbox state is not inspectable from inside the sandbox.");
      cleanup();
    });

    it("shows 'unable to query' instead of 'Not configured'", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("unable to query from inside sandbox");
      expect(output).not.toContain("Not configured");
      cleanup();
    });

    it("JSON output has insideSandbox: true everywhere", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
      });

      await cliStatus({ json: true, logger, pluginConfig: defaultConfig, deps });

      const data = JSON.parse(lines.join(""));
      expect(data.insideSandbox).toBe(true);
      expect(data.sandbox.insideSandbox).toBe(true);
      expect(data.sandbox.running).toBe(false);
      expect(data.inference.insideSandbox).toBe(true);
      expect(data.inference.configured).toBe(false);
      cleanup();
    });
  });

  // =========================================================================
  // Scenario 5: Inside sandbox with prior plugin state
  // =========================================================================
  describe("inside sandbox — with prior plugin state", () => {
    it("shows plugin state from state file", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
        loadState: populatedState,
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Last action:      migrate");
      expect(output).toContain("Blueprint:        0.1.0");
      expect(output).toContain("Run ID:           run-a1b2c3d4");
      cleanup();
    });

    it("shows rollback section when migrationSnapshot exists", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
        loadState: populatedState,
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Rollback:");
      expect(output).toContain("Snapshot:  /root/.nemoclaw/snapshots/pre-migrate.tar.gz");
      expect(output).toContain("openclaw nemoclaw eject");
      cleanup();
    });

    it("JSON includes full nemoclaw state alongside insideSandbox: true", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        existsSync: makeSandboxDetector(true),
        loadState: populatedState,
      });

      await cliStatus({ json: true, logger, pluginConfig: defaultConfig, deps });

      const data = JSON.parse(lines.join(""));
      expect(data.insideSandbox).toBe(true);
      expect(data.nemoclaw.lastAction).toBe("migrate");
      expect(data.nemoclaw.blueprintVersion).toBe("0.1.0");
      expect(data.nemoclaw.lastRunId).toBe("run-a1b2c3d4");
      expect(data.nemoclaw.migrationSnapshot).toBe("/root/.nemoclaw/snapshots/pre-migrate.tar.gz");
      cleanup();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe("edge cases", () => {
    it("uses state.sandboxName when available", async () => {
      const execCalls: string[] = [];
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: (cmd: string) => {
          execCalls.push(cmd);
          if (cmd.includes("sandbox status")) {
            return Promise.resolve({
              stdout: JSON.stringify({ state: "running", uptime: "1m" }),
              stderr: "",
            });
          }
          return Promise.reject(new Error("not configured"));
        },
        loadState: () => ({ ...blankState(), sandboxName: "custom-sandbox" }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Name:    custom-sandbox");
      expect(execCalls.some((c) => c.includes("custom-sandbox"))).toBe(true);
      cleanup();
    });

    it("handles sandbox running but with missing uptime field", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        execAsync: fakeExec({
          "sandbox status": JSON.stringify({ state: "running" }),
          "inference get": new Error("not configured"),
        }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      const output = lines.join("\n");
      expect(output).toContain("Status:  running");
      expect(output).toContain("Uptime:  unknown");
      cleanup();
    });

    it("no rollback section when migrationSnapshot is null", async () => {
      const { lines, logger } = captureLogger();
      const deps = makeDeps({
        loadState: () => ({ ...populatedState(), migrationSnapshot: null }),
      });

      await cliStatus({ json: false, logger, pluginConfig: defaultConfig, deps });

      expect(lines.join("\n")).not.toContain("Rollback:");
      cleanup();
    });
  });
});
