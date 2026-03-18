// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Goose CLI integration — dispatches coding tasks to Goose in headless mode.
 *
 * Invoked as: goose run --no-session --quiet --output-format json -t "task"
 * All process execution uses execFileSync (argument array, no shell injection).
 */

import { execFileSync } from "node:child_process";
import { scanForSecrets } from "../memory/sanitize.js";

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface GooseRunOptions {
  maxTurns?: number;
  session?: string;
  resume?: boolean;
  extensions?: string[];
  timeout?: number;
}

export interface GooseProviderConfig {
  provider?: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  maxTurns?: number;
}

export interface GooseResult {
  success: boolean;
  response: string;
  error?: string;
}

/**
 * Build the argv array for `goose run`.
 */
export function buildGooseArgs(task: string, opts: GooseRunOptions = {}): string[] {
  const args = ["run"];

  if (opts.session) {
    args.push("-n", opts.session);
    if (opts.resume) {
      args.push("-r");
    }
  } else {
    args.push("--no-session");
  }

  args.push("--quiet");
  args.push("--output-format", "json");

  if (opts.maxTurns) {
    args.push("--max-turns", String(opts.maxTurns));
  }

  for (const ext of opts.extensions ?? []) {
    args.push("--with-builtin", ext);
  }

  args.push("-t", task);

  return args;
}

/**
 * Build environment variables for Goose, mapping from NemoClaw's provider config.
 */
export function buildGooseEnv(config: GooseProviderConfig): Record<string, string> {
  const env: Record<string, string> = {
    GOOSE_MODE: "auto",
    GOOSE_DISABLE_SESSION_NAMING: "true",
    GOOSE_MAX_TURNS: String(config.maxTurns ?? DEFAULT_MAX_TURNS),
  };

  if (config.provider) {
    env.GOOSE_PROVIDER = config.provider;
  }
  if (config.model) {
    env.GOOSE_MODEL = config.model;
  }

  switch (config.provider) {
    case "openrouter":
      if (config.apiKey) env.OPENROUTER_API_KEY = config.apiKey;
      break;
    case "ollama":
      if (config.endpoint) env.OLLAMA_HOST = config.endpoint;
      break;
    case "openai":
    default:
      if (config.apiKey) env.OPENAI_API_KEY = config.apiKey;
      if (config.endpoint) env.OPENAI_HOST = config.endpoint;
      break;
  }

  return env;
}

/**
 * Parse Goose's JSON or plain text output.
 */
export function parseGooseOutput(raw: string): GooseResult {
  if (!raw || raw.trim().length === 0) {
    return { success: false, response: "", error: "Empty output from Goose" };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      success: true,
      response:
        typeof parsed.response === "string"
          ? parsed.response
          : typeof parsed.content === "string"
            ? parsed.content
            : raw,
    };
  } catch {
    // Plain text output — still valid
    return { success: true, response: raw.trim() };
  }
}

/**
 * Check if Goose CLI is installed and accessible.
 */
export function isGooseInstalled(): boolean {
  try {
    execFileSync("goose", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a task via Goose CLI. Returns structured result.
 */
export function runGoose(
  task: string,
  providerConfig: GooseProviderConfig,
  opts: GooseRunOptions = {},
): GooseResult {
  if (!isGooseInstalled()) {
    return {
      success: false,
      response: "",
      error: "Goose CLI is not installed. Run `openclaw nemoclaw setup-goose` to install.",
    };
  }

  const args = buildGooseArgs(task, {
    maxTurns: opts.maxTurns ?? providerConfig.maxTurns ?? DEFAULT_MAX_TURNS,
    ...opts,
  });
  const env = buildGooseEnv(providerConfig);

  try {
    const output = execFileSync("goose", args, {
      encoding: "utf-8",
      timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return parseGooseOutput(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = scanForSecrets(message).valid
      ? message
      : "Goose execution failed (error details redacted for security)";
    return { success: false, response: "", error: `Goose execution failed: ${sanitized}` };
  }
}
