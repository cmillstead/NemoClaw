// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Handler for the /code slash command.
 * Dispatches coding tasks to Goose CLI using NemoClaw's inference provider.
 *
 * Usage:
 *   /code <task description>
 *   /code --session <name> <task>
 *   /code --resume <name>
 *   /code --turns <n> <task>
 */

import type { PluginCommandContext, PluginCommandResult, OpenClawPluginApi } from "../index.js";
import { runGoose, isGooseInstalled } from "../tools/goose.js";
import { loadOnboardConfig } from "../onboard/config.js";
import type { GooseProviderConfig, GooseRunOptions } from "../tools/goose.js";

function resolveProviderConfig(): GooseProviderConfig {
  const onboard = loadOnboardConfig();
  if (!onboard) {
    return { provider: "openai", maxTurns: 25 };
  }

  const apiKey = process.env[onboard.credentialEnv] ?? "";

  switch (onboard.endpointType) {
    case "openrouter":
      return { provider: "openrouter", apiKey, model: onboard.model, maxTurns: 25 };
    case "ollama":
      return {
        provider: "ollama",
        endpoint: onboard.endpointUrl,
        model: onboard.model,
        maxTurns: 25,
      };
    default:
      return {
        provider: "openai",
        apiKey,
        endpoint: onboard.endpointUrl || "https://integrate.api.nvidia.com/v1",
        model: onboard.model,
        maxTurns: 25,
      };
  }
}

export function handleCodeSlashCommand(
  ctx: PluginCommandContext,
  _api: OpenClawPluginApi,
): PluginCommandResult {
  const rawArgs = ctx.args?.trim() ?? "";

  if (!rawArgs) {
    return {
      text: [
        "**Code Tool (Goose)**",
        "",
        "Usage: `/code <task description>`",
        "",
        "Options:",
        "  `--session <name>` — Use a named session",
        "  `--resume <name>`  — Resume a named session",
        "  `--turns <n>`      — Max agent turns (default: 25)",
        "",
        "Examples:",
        "  `/code write a Python function that validates email addresses`",
        "  `/code --session auth refactor the JWT middleware`",
      ].join("\n"),
    };
  }

  if (!isGooseInstalled()) {
    return { text: "**Goose CLI not installed.** Run `openclaw nemoclaw setup-goose` to install." };
  }

  const opts: GooseRunOptions = {};
  let task = rawArgs;

  const sessionMatch = rawArgs.match(/--session\s+(\S+)\s*/);
  if (sessionMatch) {
    opts.session = sessionMatch[1];
    task = task.replace(sessionMatch[0], "").trim();
  }

  const resumeMatch = rawArgs.match(/--resume\s+(\S+)\s*/);
  if (resumeMatch) {
    opts.session = resumeMatch[1];
    opts.resume = true;
    task = task.replace(resumeMatch[0], "").trim();
  }

  const turnsMatch = rawArgs.match(/--turns\s+(\d+)\s*/);
  if (turnsMatch) {
    opts.maxTurns = parseInt(turnsMatch[1], 10);
    task = task.replace(turnsMatch[0], "").trim();
  }

  opts.extensions = ["developer"];

  const providerConfig = resolveProviderConfig();
  const result = runGoose(task, providerConfig, opts);

  if (!result.success) {
    return { text: `**Goose error:** ${result.error ?? "Unknown error"}` };
  }

  return { text: result.response };
}
