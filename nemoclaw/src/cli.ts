// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * CLI registrar for `openclaw nemoclaw <subcommand>`.
 *
 * Wires commander.js subcommands to the existing blueprint infrastructure.
 */

import type { OpenClawPluginApi, PluginCliContext } from "./index.js";
import { getPluginConfig } from "./index.js";
import { cliStatus } from "./commands/status.js";
import { cliMigrate } from "./commands/migrate.js";
import { cliLaunch } from "./commands/launch.js";
import { cliConnect } from "./commands/connect.js";
import { cliEject } from "./commands/eject.js";
import { cliLogs } from "./commands/logs.js";
import { cliOnboard } from "./commands/onboard.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { ensureMemoryDirs, updateRootMoc, listFacts, regenerateManifest } from "./memory/para.js";
import { scanForSecrets, scanForInjection } from "./memory/sanitize.js";

export function registerCliCommands(ctx: PluginCliContext, api: OpenClawPluginApi): void {
  const { program, logger } = ctx;
  const pluginConfig = getPluginConfig(api);

  const nemoclaw = program.command("nemoclaw").description("NemoClaw sandbox management");

  // openclaw nemoclaw status
  nemoclaw
    .command("status")
    .description("Show sandbox, blueprint, and inference state")
    .option("--json", "Output as JSON", false)
    .action(async (opts: { json: boolean }) => {
      await cliStatus({ json: opts.json, logger, pluginConfig });
    });

  // openclaw nemoclaw migrate
  nemoclaw
    .command("migrate")
    .description("Migrate host OpenClaw installation into an OpenShell sandbox")
    .option("--dry-run", "Show what would be migrated without making changes", false)
    .option("--profile <profile>", "Blueprint profile to use", "default")
    .option("--skip-backup", "Skip creating a host backup snapshot", false)
    .action(async (opts: { dryRun: boolean; profile: string; skipBackup: boolean }) => {
      await cliMigrate({
        dryRun: opts.dryRun,
        profile: opts.profile,
        skipBackup: opts.skipBackup,
        logger,
        pluginConfig,
      });
    });

  // openclaw nemoclaw launch
  nemoclaw
    .command("launch")
    .description("Fresh setup: bootstrap OpenClaw inside OpenShell")
    .option("--force", "Skip ergonomics warning and force plugin-driven bootstrap", false)
    .option("--profile <profile>", "Blueprint profile to use", "default")
    .action(async (opts: { force: boolean; profile: string }) => {
      await cliLaunch({
        force: opts.force,
        profile: opts.profile,
        logger,
        pluginConfig,
      });
    });

  // openclaw nemoclaw connect
  nemoclaw
    .command("connect")
    .description("Open an interactive shell inside the OpenClaw sandbox")
    .option("--sandbox <name>", "Sandbox name to connect to", pluginConfig.sandboxName)
    .action(async (opts: { sandbox: string }) => {
      await cliConnect({ sandbox: opts.sandbox, logger });
    });

  // openclaw nemoclaw logs
  nemoclaw
    .command("logs")
    .description("Stream blueprint execution and sandbox logs")
    .option("-f, --follow", "Follow log output", false)
    .option("-n, --lines <count>", "Number of lines to show", "50")
    .option("--run-id <id>", "Show logs for a specific blueprint run")
    .action(async (opts: { follow: boolean; lines: string; runId?: string }) => {
      await cliLogs({
        follow: opts.follow,
        lines: parseInt(opts.lines, 10),
        runId: opts.runId,
        logger,
        pluginConfig,
      });
    });

  // openclaw nemoclaw eject
  nemoclaw
    .command("eject")
    .description("Rollback from OpenShell and restore host installation")
    .option("--run-id <id>", "Specific blueprint run ID to rollback from")
    .option("--confirm", "Skip confirmation prompt", false)
    .action(async (opts: { runId?: string; confirm: boolean }) => {
      await cliEject({
        runId: opts.runId,
        confirm: opts.confirm,
        logger,
        pluginConfig,
      });
    });

  // openclaw nemoclaw onboard
  nemoclaw
    .command("onboard")
    .description("Interactive setup: configure inference endpoint, credential, and model")
    .option("--api-key <key>", "API key for endpoints that require one (skips prompt)")
    .option(
      "--endpoint <type>",
      "Endpoint type: build, ncp, openrouter, nim-local, vllm, ollama, custom",
    )
    .option("--ncp-partner <name>", "NCP partner name (when endpoint is ncp)")
    .option("--endpoint-url <url>", "Endpoint URL (for ncp, nim-local, ollama, or custom)")
    .option("--model <model>", "Model ID to use")
    .action(
      async (opts: {
        apiKey?: string;
        endpoint?: string;
        ncpPartner?: string;
        endpointUrl?: string;
        model?: string;
      }) => {
        await cliOnboard({
          apiKey: opts.apiKey,
          endpoint: opts.endpoint,
          ncpPartner: opts.ncpPartner,
          endpointUrl: opts.endpointUrl,
          model: opts.model,
          logger,
          pluginConfig,
        });
      },
    );

  // openclaw nemoclaw memory
  const memory = nemoclaw.command("memory").description("Memory system management");

  memory
    .command("status")
    .description("Memory system health and statistics")
    .action(() => {
      logger.info("Memory system status -- run inside agent session for full details.");
    });

  memory
    .command("init")
    .description("Initialize memory directory structure")
    .action(() => {
      const memoryDir = join(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
      ensureMemoryDirs(memoryDir);
      updateRootMoc(memoryDir);
      logger.info(`Memory directory initialized at ${memoryDir}`);

      // Create Obsidian symlink if vault exists
      const obsidianProjectsDir = join(
        process.env.HOME ?? "/tmp",
        "Documents",
        "obsidian-vault",
        "projects",
      );
      const symlinkTarget = join(obsidianProjectsDir, "nemoclaw-memory");
      if (existsSync(obsidianProjectsDir) && !existsSync(symlinkTarget)) {
        try {
          symlinkSync(memoryDir, symlinkTarget);
          logger.info(`Obsidian symlink: ${symlinkTarget} -> ${memoryDir}`);
        } catch (err) {
          logger.warn(`Could not create Obsidian symlink: ${String(err)}`);
        }
      }

      // Create QMD-indexable symlink in ~/src/ so QMD can find memory files
      const qmdSymlink = join(process.env.HOME ?? "/tmp", "src", ".nemoclaw-memory");
      if (!existsSync(qmdSymlink)) {
        try {
          symlinkSync(memoryDir, qmdSymlink);
          logger.info(`QMD symlink: ${qmdSymlink} -> ${memoryDir}`);
        } catch (err) {
          logger.warn(`Could not create QMD symlink: ${String(err)}`);
        }
      }
    });

  memory
    .command("purge")
    .description("Delete all memory data")
    .option("--confirm", "Required to actually delete", false)
    .action((opts: { confirm: boolean }) => {
      if (!opts.confirm) {
        logger.info("Add --confirm to actually delete all memory data.");
        return;
      }
      const memoryDir = join(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
      // rmSync and existsSync imported at top level
      if (existsSync(memoryDir)) {
        rmSync(memoryDir, { recursive: true });
        logger.info("All memory data deleted.");
      } else {
        logger.info("No memory data found.");
      }
    });

  memory
    .command("audit")
    .description("Security scan all memory files")
    .action(() => {
      const memoryDir = join(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
      // readFileSync imported at top level
      const facts = listFacts(memoryDir);
      let issues = 0;
      for (const path of facts) {
        const content = readFileSync(path, "utf-8");
        const secretResult = scanForSecrets(content);
        if (!secretResult.valid) {
          logger.warn(`SECRET: ${path} -- ${secretResult.reason ?? "unknown"}`);
          issues++;
        }
        const injectionResult = scanForInjection(content);
        if (!injectionResult.valid) {
          logger.warn(`INJECTION: ${path} -- ${injectionResult.reason ?? "unknown"}`);
          issues++;
        }
      }
      regenerateManifest(memoryDir);
      logger.info(
        `Audit complete: ${String(facts.length)} files scanned, ${String(issues)} issues found.`,
      );
    });

  // openclaw nemoclaw setup-goose
  nemoclaw
    .command("setup-goose")
    .description("Install or update Goose CLI for code generation")
    .option("--version <version>", "Goose version to install", "stable")
    .action((opts: { version: string }) => {
      const scriptPath = join(
        __dirname,
        "..",
        "..",
        "nemoclaw-blueprint",
        "scripts",
        "install-goose.sh",
      );

      if (!existsSync(scriptPath)) {
        logger.error("Install script not found. Ensure NemoClaw blueprint is present.");
        return;
      }

      try {
        const installDir = join(process.env.HOME ?? "/tmp", ".local", "bin");
        execFileSync("bash", [scriptPath, installDir], {
          stdio: "inherit",
          env: { ...process.env, GOOSE_VERSION: opts.version },
        });
        logger.info("Goose CLI installed successfully.");
      } catch (err) {
        logger.error(`Goose installation failed: ${String(err)}`);
      }
    });
}
