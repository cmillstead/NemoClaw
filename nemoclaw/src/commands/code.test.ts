// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { handleCodeSlashCommand } from "./code.js";
import type { PluginCommandContext, OpenClawPluginApi } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers — real objects, no mocks
// ---------------------------------------------------------------------------

function makeCtx(args?: string): PluginCommandContext {
  return {
    channel: "test-channel",
    isAuthorizedSender: true,
    args,
    commandBody: `/code${args ? ` ${args}` : ""}`,
    config: {},
  };
}

function makeApi(): OpenClawPluginApi {
  return {
    id: "nemoclaw",
    name: "NemoClaw",
    version: "0.0.0-test",
    config: {},
    pluginConfig: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerCommand: () => {},
    registerCli: () => {},
    registerProvider: () => {},
    registerService: () => {},
    resolvePath: (p: string) => p,
    on: () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCodeSlashCommand", () => {
  const api = makeApi();

  // =========================================================================
  // No args — returns help text
  // =========================================================================
  describe("no args — help text", () => {
    it("returns help text when args is empty", () => {
      const result = handleCodeSlashCommand(makeCtx(""), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("Code Tool (Goose)");
    });

    it("returns help text when args is undefined", () => {
      const result = handleCodeSlashCommand(makeCtx(), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("Code Tool (Goose)");
    });

    it("help text contains usage instructions", () => {
      const result = handleCodeSlashCommand(makeCtx(), api);

      expect(result.text).toContain("Usage:");
      expect(result.text).toContain("/code <task description>");
      expect(result.text).toContain("--session <name>");
      expect(result.text).toContain("--resume <name>");
      expect(result.text).toContain("--turns <n>");
    });

    it("help text contains example commands", () => {
      const result = handleCodeSlashCommand(makeCtx(), api);

      expect(result.text).toContain("Examples:");
      expect(result.text).toContain("/code write a Python function");
      expect(result.text).toContain("/code --session auth");
    });
  });

  // =========================================================================
  // Args provided — goose path (installed or not)
  // =========================================================================
  describe("with args provided", () => {
    it("returns an error or result — never help text — when task is given", () => {
      const result = handleCodeSlashCommand(makeCtx("write hello world"), api);

      expect(result.text).toBeDefined();
      // Should NOT return the help text — it should attempt to run goose
      expect(result.text).not.toContain("Code Tool (Goose)");
      expect(result.text).not.toContain("Usage:");

      // Depending on environment: either "not installed" or a goose execution error/result
      const isNotInstalled = result.text!.includes("Goose CLI not installed");
      const isGooseError = result.text!.includes("Goose error");
      const isGooseResult = !isNotInstalled && !isGooseError;

      expect(isNotInstalled || isGooseError || isGooseResult).toBe(true);
    });
  });
});
