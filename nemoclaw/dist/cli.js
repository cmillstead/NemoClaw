"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCliCommands = registerCliCommands;
const index_js_1 = require("./index.js");
const status_js_1 = require("./commands/status.js");
const migrate_js_1 = require("./commands/migrate.js");
const launch_js_1 = require("./commands/launch.js");
const connect_js_1 = require("./commands/connect.js");
const eject_js_1 = require("./commands/eject.js");
const logs_js_1 = require("./commands/logs.js");
const onboard_js_1 = require("./commands/onboard.js");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const para_js_1 = require("./memory/para.js");
const sanitize_js_1 = require("./memory/sanitize.js");
function registerCliCommands(ctx, api) {
    const { program, logger } = ctx;
    const pluginConfig = (0, index_js_1.getPluginConfig)(api);
    const nemoclaw = program.command("nemoclaw").description("NemoClaw sandbox management");
    // openclaw nemoclaw status
    nemoclaw
        .command("status")
        .description("Show sandbox, blueprint, and inference state")
        .option("--json", "Output as JSON", false)
        .action(async (opts) => {
        await (0, status_js_1.cliStatus)({ json: opts.json, logger, pluginConfig });
    });
    // openclaw nemoclaw migrate
    nemoclaw
        .command("migrate")
        .description("Migrate host OpenClaw installation into an OpenShell sandbox")
        .option("--dry-run", "Show what would be migrated without making changes", false)
        .option("--profile <profile>", "Blueprint profile to use", "default")
        .option("--skip-backup", "Skip creating a host backup snapshot", false)
        .action(async (opts) => {
        await (0, migrate_js_1.cliMigrate)({
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
        .action(async (opts) => {
        await (0, launch_js_1.cliLaunch)({
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
        .action(async (opts) => {
        await (0, connect_js_1.cliConnect)({ sandbox: opts.sandbox, logger });
    });
    // openclaw nemoclaw logs
    nemoclaw
        .command("logs")
        .description("Stream blueprint execution and sandbox logs")
        .option("-f, --follow", "Follow log output", false)
        .option("-n, --lines <count>", "Number of lines to show", "50")
        .option("--run-id <id>", "Show logs for a specific blueprint run")
        .action(async (opts) => {
        await (0, logs_js_1.cliLogs)({
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
        .action(async (opts) => {
        await (0, eject_js_1.cliEject)({
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
        .option("--endpoint <type>", "Endpoint type: build, ncp, openrouter, nim-local, vllm, ollama, custom")
        .option("--ncp-partner <name>", "NCP partner name (when endpoint is ncp)")
        .option("--endpoint-url <url>", "Endpoint URL (for ncp, nim-local, ollama, or custom)")
        .option("--model <model>", "Model ID to use")
        .action(async (opts) => {
        await (0, onboard_js_1.cliOnboard)({
            apiKey: opts.apiKey,
            endpoint: opts.endpoint,
            ncpPartner: opts.ncpPartner,
            endpointUrl: opts.endpointUrl,
            model: opts.model,
            logger,
            pluginConfig,
        });
    });
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
        const memoryDir = (0, node_path_1.join)(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
        (0, para_js_1.ensureMemoryDirs)(memoryDir);
        (0, para_js_1.updateRootMoc)(memoryDir);
        logger.info(`Memory directory initialized at ${memoryDir}`);
    });
    memory
        .command("purge")
        .description("Delete all memory data")
        .option("--confirm", "Required to actually delete", false)
        .action((opts) => {
        if (!opts.confirm) {
            logger.info("Add --confirm to actually delete all memory data.");
            return;
        }
        const memoryDir = (0, node_path_1.join)(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
        // rmSync and existsSync imported at top level
        if ((0, node_fs_1.existsSync)(memoryDir)) {
            (0, node_fs_1.rmSync)(memoryDir, { recursive: true });
            logger.info("All memory data deleted.");
        }
        else {
            logger.info("No memory data found.");
        }
    });
    memory
        .command("audit")
        .description("Security scan all memory files")
        .action(() => {
        const memoryDir = (0, node_path_1.join)(process.env.HOME ?? "/tmp", ".nemoclaw", "memory");
        // readFileSync imported at top level
        const facts = (0, para_js_1.listFacts)(memoryDir);
        let issues = 0;
        for (const path of facts) {
            const content = (0, node_fs_1.readFileSync)(path, "utf-8");
            const secretResult = (0, sanitize_js_1.scanForSecrets)(content);
            if (!secretResult.valid) {
                logger.warn(`SECRET: ${path} -- ${secretResult.reason ?? "unknown"}`);
                issues++;
            }
            const injectionResult = (0, sanitize_js_1.scanForInjection)(content);
            if (!injectionResult.valid) {
                logger.warn(`INJECTION: ${path} -- ${injectionResult.reason ?? "unknown"}`);
                issues++;
            }
        }
        (0, para_js_1.regenerateManifest)(memoryDir);
        logger.info(`Audit complete: ${facts.length} files scanned, ${issues} issues found.`);
    });
}
//# sourceMappingURL=cli.js.map