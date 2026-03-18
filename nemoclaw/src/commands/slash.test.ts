// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { handleSlashCommand } from "./slash.js";
import type { PluginCommandContext, OpenClawPluginApi } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers — real objects, no mocks
// ---------------------------------------------------------------------------

function makeCtx(args?: string): PluginCommandContext {
  return {
    channel: "test-channel",
    isAuthorizedSender: true,
    args,
    commandBody: `/nemoclaw${args ? ` ${args}` : ""}`,
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

describe("handleSlashCommand", () => {
  const api = makeApi();

  // =========================================================================
  // Default (no args) returns help text
  // =========================================================================
  describe("default — no args", () => {
    it("returns help text with subcommand list", () => {
      const result = handleSlashCommand(makeCtx(), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("**NemoClaw**");
      expect(result.text).toContain("Usage:");
      expect(result.text).toContain("`status`");
      expect(result.text).toContain("`eject`");
      expect(result.text).toContain("`onboard`");
    });
  });

  // =========================================================================
  // "status" subcommand
  // =========================================================================
  describe("status subcommand", () => {
    it("returns status text showing no operations performed", () => {
      const result = handleSlashCommand(makeCtx("status"), api);

      expect(result.text).toBeDefined();
      // With no state file in the test env, loadState() returns defaults
      // where lastAction is null, so it shows the "no operations" message
      expect(result.text).toContain("No operations performed");
    });
  });

  // =========================================================================
  // "eject" subcommand
  // =========================================================================
  describe("eject subcommand", () => {
    it("returns eject text showing no deployment found", () => {
      const result = handleSlashCommand(makeCtx("eject"), api);

      expect(result.text).toBeDefined();
      // With no state file, lastAction is null → "No NemoClaw deployment found"
      expect(result.text).toContain("No NemoClaw deployment found");
    });
  });

  // =========================================================================
  // "onboard" subcommand
  // =========================================================================
  describe("onboard subcommand", () => {
    it("returns onboard instructions when no config exists", () => {
      const result = handleSlashCommand(makeCtx("onboard"), api);

      expect(result.text).toBeDefined();
      // With no config file, loadOnboardConfig() returns null → setup instructions
      expect(result.text).toContain("NemoClaw Onboarding");
      expect(result.text).toContain("No configuration found");
      expect(result.text).toContain("openclaw nemoclaw onboard");
    });
  });

  // =========================================================================
  // Unknown subcommand falls back to help
  // =========================================================================
  describe("unknown subcommand", () => {
    it("returns help text for unrecognized subcommand", () => {
      const result = handleSlashCommand(makeCtx("foobar"), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("**NemoClaw**");
      expect(result.text).toContain("Usage:");
      expect(result.text).toContain("`status`");
    });
  });

  // =========================================================================
  // Whitespace handling
  // =========================================================================
  describe("whitespace handling", () => {
    it("trims leading whitespace from args", () => {
      const result = handleSlashCommand(makeCtx("   status"), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("No operations performed");
    });

    it("trims trailing whitespace from args", () => {
      const result = handleSlashCommand(makeCtx("eject   "), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("No NemoClaw deployment found");
    });

    it("handles args with extra internal whitespace", () => {
      // "status  extra" — split on whitespace takes "status" as subcommand
      const result = handleSlashCommand(makeCtx("  status  extra  "), api);

      expect(result.text).toBeDefined();
      expect(result.text).toContain("No operations performed");
    });
  });
});
