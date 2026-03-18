// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerCliCommands } from "./cli.js";
import type { PluginCliContext, OpenClawPluginApi, PluginLogger } from "./index.js";

function makeLogger(): PluginLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function makeCtx(program: Command): PluginCliContext {
  return {
    program,
    config: {},
    logger: makeLogger(),
  };
}

function makeApi(): OpenClawPluginApi {
  return {
    id: "nemoclaw",
    name: "NemoClaw",
    config: {},
    pluginConfig: {},
    logger: makeLogger(),
    registerCommand: () => {},
    registerCli: () => {},
    registerProvider: () => {},
    registerService: () => {},
    resolvePath: (input: string) => input,
    on: () => {},
  };
}

function findCommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find((c) => c.name() === name);
}

function optionNames(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("registerCliCommands", () => {
  it("registers a 'nemoclaw' parent command", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw");
    expect(nemoclaw).toBeDefined();
  });

  it("registers all expected subcommands", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw")!;
    const subcommandNames = nemoclaw.commands.map((c) => c.name());

    const expected = [
      "status",
      "migrate",
      "launch",
      "connect",
      "logs",
      "eject",
      "onboard",
      "memory",
      "setup-goose",
    ];

    for (const name of expected) {
      expect(subcommandNames).toContain(name);
    }
  });

  it("registers memory subcommands: status, init, purge, audit", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw")!;
    const memory = findCommand(nemoclaw, "memory")!;
    expect(memory).toBeDefined();

    const memorySubNames = memory.commands.map((c) => c.name());
    expect(memorySubNames).toContain("status");
    expect(memorySubNames).toContain("init");
    expect(memorySubNames).toContain("purge");
    expect(memorySubNames).toContain("audit");
  });

  it("status subcommand has --json option", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw")!;
    const status = findCommand(nemoclaw, "status")!;
    expect(optionNames(status)).toContain("--json");
  });

  it("migrate subcommand has --dry-run, --profile, --skip-backup options", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw")!;
    const migrate = findCommand(nemoclaw, "migrate")!;
    const names = optionNames(migrate);

    expect(names).toContain("--dry-run");
    expect(names).toContain("--profile");
    expect(names).toContain("--skip-backup");
  });

  it("eject subcommand has --confirm and --run-id options", () => {
    const program = new Command();
    registerCliCommands(makeCtx(program), makeApi());

    const nemoclaw = findCommand(program, "nemoclaw")!;
    const eject = findCommand(nemoclaw, "eject")!;
    const names = optionNames(eject);

    expect(names).toContain("--confirm");
    expect(names).toContain("--run-id");
  });
});
