// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, execSync } from "node:child_process";
import type { PluginLogger, NemoClawConfig } from "../index.js";
import {
  loadOnboardConfig,
  saveOnboardConfig,
  type EndpointType,
  type NemoClawOnboardConfig,
} from "../onboard/config.js";
import { promptInput, promptConfirm, promptSelect } from "../onboard/prompt.js";
import { validateApiKey, maskApiKey, validateKeyPrefix } from "../onboard/validate.js";
import {
  PROVIDERS,
  getProvider,
  ENDPOINT_TYPES,
  type ProviderDefinition,
} from "../onboard/providers.js";

export interface OnboardOptions {
  apiKey?: string;
  endpoint?: string;
  ncpPartner?: string;
  endpointUrl?: string;
  model?: string;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
}

const DEFAULT_MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Nemotron Ultra 253B" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Nemotron Super 49B v1.5" },
  { id: "nvidia/nemotron-3-nano-30b-a3b", label: "Nemotron 3 Nano 30B" },
];

function detectOllama(): { installed: boolean; running: boolean } {
  const installed = testCommand("command -v ollama >/dev/null 2>&1");
  const running = testCommand("curl -sf http://localhost:11434/api/tags >/dev/null 2>&1");
  return { installed, running };
}

function testCommand(command: string): boolean {
  try {
    execSync(command, { encoding: "utf-8", stdio: "ignore", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

function showConfig(config: NemoClawOnboardConfig, logger: PluginLogger): void {
  logger.info(`  Endpoint:    ${config.endpointType} (${config.endpointUrl})`);
  if (config.ncpPartner) {
    logger.info(`  NCP Partner: ${config.ncpPartner}`);
  }
  logger.info(`  Model:       ${config.model}`);
  logger.info(`  Credential:  $${config.credentialEnv}`);
  logger.info(`  Profile:     ${config.profile}`);
  logger.info(`  Onboarded:   ${config.onboardedAt}`);
}

function isNonInteractive(opts: OnboardOptions): boolean {
  if (!opts.endpoint || !opts.model) return false;
  const provider = getProvider(opts.endpoint as EndpointType);
  if (provider.requiresApiKey && !opts.apiKey) return false;
  if (provider.endpointUrlMode !== "fixed" && !opts.endpointUrl) return false;
  if (provider.requiresNcpPartner && !opts.ncpPartner) return false;
  return true;
}

function resolveHint(provider: ProviderDefinition, ollamaInstalled: boolean): string {
  return typeof provider.hint === "function"
    ? provider.hint({ ollamaInstalled })
    : provider.hint;
}

async function promptEndpoint(
  ollama: { installed: boolean; running: boolean },
): Promise<EndpointType> {
  const options = PROVIDERS.map((p) => ({
    label: p.label,
    value: p.id,
    hint: resolveHint(p, ollama.installed),
  }));

  return (await promptSelect("Select your inference endpoint:", options)) as EndpointType;
}

async function resolveEndpointUrl(
  provider: ProviderDefinition,
  opts: OnboardOptions,
): Promise<string | null> {
  switch (provider.endpointUrlMode) {
    case "fixed":
      return provider.defaultEndpointUrl;
    case "prompt":
      return opts.endpointUrl ?? (await promptInput(provider.endpointUrlPrompt ?? "Endpoint URL"));
    case "prompt-with-default":
      return (
        opts.endpointUrl ??
        (await promptInput(
          provider.endpointUrlPrompt ?? "Endpoint URL",
          provider.defaultEndpointUrl ?? undefined,
        ))
      );
  }
}

async function resolveCredential(
  provider: ProviderDefinition,
  credentialEnv: string,
  opts: OnboardOptions,
  logger: PluginLogger,
  nonInteractive: boolean,
): Promise<string | null> {
  if (!provider.requiresApiKey) {
    logger.info(
      `No API key required for ${provider.id}. Using local credential value '${provider.defaultCredential}'.`,
    );
    return provider.defaultCredential;
  }

  // CLI flag takes priority
  if (opts.apiKey) return opts.apiKey;

  // Check environment
  const envKey = process.env[credentialEnv];
  if (envKey) {
    logger.info(`Detected ${credentialEnv} in environment (${maskApiKey(envKey)})`);
    const useEnv = nonInteractive ? true : await promptConfirm("Use this key?");
    if (useEnv) return envKey;
  }

  // Provider-specific help text
  if (provider.id === "build" || provider.id === "ncp") {
    logger.info("Get an API key from: https://build.nvidia.com/settings/api-keys");
  } else if (provider.id === "openrouter") {
    logger.info("Get an API key from: https://openrouter.ai/keys");
  }

  return await promptInput(`Enter your ${credentialEnv}`);
}

function execOpenShell(args: string[]): string {
  return execFileSync("openshell", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function cliOnboard(opts: OnboardOptions): Promise<void> {
  const { logger } = opts;
  const nonInteractive = opts.endpoint && opts.model ? isNonInteractive(opts) : false;

  logger.info("NemoClaw Onboarding");
  logger.info("-------------------");

  // Step 0: Check existing config
  const existing = loadOnboardConfig();
  if (existing) {
    logger.info("");
    logger.info("Existing configuration found:");
    showConfig(existing, logger);
    logger.info("");

    if (!nonInteractive) {
      const reconfigure = await promptConfirm("Reconfigure?", false);
      if (!reconfigure) {
        logger.info("Keeping existing configuration.");
        return;
      }
    }
  }

  // Step 1: Endpoint Selection
  let endpointType: EndpointType;
  if (opts.endpoint) {
    if (!ENDPOINT_TYPES.includes(opts.endpoint as EndpointType)) {
      logger.error(
        `Invalid endpoint type: ${opts.endpoint}. Must be one of: ${ENDPOINT_TYPES.join(", ")}`,
      );
      return;
    }
    endpointType = opts.endpoint as EndpointType;
  } else {
    const ollama = detectOllama();
    if (ollama.running) {
      const useOllama = await promptConfirm("Detected Ollama on localhost:11434. Use it?");
      if (useOllama) {
        endpointType = "ollama";
      } else {
        endpointType = await promptEndpoint(ollama);
      }
    } else {
      endpointType = await promptEndpoint(ollama);
    }
  }

  const provider = getProvider(endpointType);

  // Step 2: Endpoint URL + NCP partner
  let ncpPartner: string | null = null;
  if (provider.requiresNcpPartner) {
    ncpPartner = opts.ncpPartner ?? (await promptInput("NCP partner name"));
  }

  const endpointUrl = await resolveEndpointUrl(provider, opts);
  if (!endpointUrl) {
    logger.error("No endpoint URL provided. Aborting.");
    return;
  }

  // Step 3: Credential env var name (custom provider prompts for this)
  const credentialEnv =
    provider.id === "custom"
      ? await promptInput("Environment variable name for your API key", provider.credentialEnv)
      : provider.credentialEnv;

  // Step 3b: Resolve the actual credential value
  const apiKey = await resolveCredential(provider, credentialEnv, opts, logger, nonInteractive);

  if (!apiKey) {
    logger.error("No API key provided. Aborting.");
    return;
  }

  // Step 3c: Key prefix validation (soft warning, not blocking)
  if (provider.keyPrefixes) {
    const prefixError = validateKeyPrefix(apiKey, provider.keyPrefixes);
    if (prefixError) {
      logger.warn(`Key prefix warning: ${prefixError}`);
      if (!nonInteractive) {
        const proceed = await promptConfirm("Continue anyway?");
        if (!proceed) {
          logger.info("Onboarding cancelled.");
          return;
        }
      }
    }
  }

  // Step 4: Validate API Key / Endpoint
  logger.info("");
  logger.info(
    `Validating ${provider.requiresApiKey ? "credential" : "endpoint"} against ${endpointUrl}...`,
  );
  const validation = await validateApiKey(apiKey, endpointUrl);

  if (!validation.valid) {
    if (provider.softValidation) {
      logger.warn(
        `Could not reach ${endpointUrl} (${validation.error ?? "unknown error"}). Continuing anyway — the service may not be running yet.`,
      );
    } else {
      logger.error(`API key validation failed: ${validation.error ?? "unknown error"}`);
      if (provider.id === "build" || provider.id === "ncp") {
        logger.info("Check your key at https://build.nvidia.com/settings/api-keys");
      } else if (provider.id === "openrouter") {
        logger.info("Check your key at https://openrouter.ai/keys");
      }
      return;
    }
  } else {
    logger.info(
      `${provider.requiresApiKey ? "Credential" : "Endpoint"} valid. ${String(validation.models.length)} model(s) available.`,
    );
  }

  // Step 5: Model Selection
  let model: string;
  if (opts.model) {
    model = opts.model;
  } else if (validation.valid && validation.models.length > 0) {
    // For NVIDIA endpoints, prefer Nemotron models from the validated list
    const isNvidia = provider.id === "build" || provider.id === "ncp";
    const filteredModels = isNvidia
      ? validation.models.filter((m) => m.includes("nemotron"))
      : validation.models;

    const modelOptions =
      filteredModels.length > 0
        ? filteredModels.map((id) => ({ label: id, value: id }))
        : DEFAULT_MODELS.map((m) => ({ label: `${m.label} (${m.id})`, value: m.id }));

    model = await promptSelect("Select your primary model:", modelOptions);
  } else if (provider.id === "build" || provider.id === "ncp") {
    // Fall back to default NVIDIA model list
    const modelOptions = DEFAULT_MODELS.map((m) => ({
      label: `${m.label} (${m.id})`,
      value: m.id,
    }));
    model = await promptSelect("Select your primary model:", modelOptions);
  } else {
    // Non-NVIDIA with no /v1/models results -- manual entry
    model = await promptInput("Enter model ID (e.g., meta-llama/llama-3-8b)");
  }

  // Step 6: Resolve profile and provider name from registry
  const profile = provider.profile;
  const providerName = provider.providerName;

  // Step 7: Confirmation
  logger.info("");
  logger.info("Configuration summary:");
  logger.info(`  Endpoint:    ${endpointType} (${endpointUrl})`);
  if (ncpPartner) {
    logger.info(`  NCP Partner: ${ncpPartner}`);
  }
  logger.info(`  Model:       ${model}`);
  logger.info(
    `  API Key:     ${provider.requiresApiKey ? maskApiKey(apiKey) : "not required (local provider)"}`,
  );
  logger.info(`  Credential:  $${credentialEnv}`);
  logger.info(`  Profile:     ${profile}`);
  logger.info(`  Provider:    ${providerName}`);
  logger.info("");

  if (!nonInteractive) {
    const proceed = await promptConfirm("Apply this configuration?");
    if (!proceed) {
      logger.info("Onboarding cancelled.");
      return;
    }
  }

  // Step 8: Apply
  logger.info("");
  logger.info("Applying configuration...");

  // 8a: Create/update provider
  try {
    execOpenShell([
      "provider",
      "create",
      "--name",
      providerName,
      "--type",
      "openai",
      "--credential",
      `${credentialEnv}=${apiKey}`,
      "--config",
      `OPENAI_BASE_URL=${endpointUrl}`,
    ]);
    logger.info(`Created provider: ${providerName}`);
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    if (stderr.includes("AlreadyExists") || stderr.includes("already exists")) {
      try {
        execOpenShell([
          "provider",
          "update",
          providerName,
          "--credential",
          `${credentialEnv}=${apiKey}`,
          "--config",
          `OPENAI_BASE_URL=${endpointUrl}`,
        ]);
        logger.info(`Updated provider: ${providerName}`);
      } catch (updateErr) {
        const updateStderr =
          updateErr instanceof Error && "stderr" in updateErr
            ? String((updateErr as { stderr: unknown }).stderr)
            : "";
        logger.error(`Failed to update provider: ${updateStderr || String(updateErr)}`);
        return;
      }
    } else {
      logger.error(`Failed to create provider: ${stderr || String(err)}`);
      return;
    }
  }

  // 8b: Set inference route
  try {
    execOpenShell(["inference", "set", "--provider", providerName, "--model", model]);
    logger.info(`Inference route set: ${providerName} -> ${model}`);
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    logger.error(`Failed to set inference route: ${stderr || String(err)}`);
    return;
  }

  // 8c: Save config
  saveOnboardConfig({
    endpointType,
    endpointUrl,
    ncpPartner,
    model,
    profile,
    credentialEnv,
    providerLabel: provider.label,
    onboardedAt: new Date().toISOString(),
  });

  // Step 9: Success
  logger.info("");
  logger.info("Onboarding complete!");
  logger.info("");
  logger.info(`  Endpoint:   ${endpointUrl}`);
  logger.info(`  Model:      ${model}`);
  logger.info(`  Credential: $${credentialEnv}`);
  logger.info("");
  logger.info("Next steps:");
  logger.info("  openclaw nemoclaw launch     # Bootstrap sandbox");
  logger.info("  openclaw nemoclaw status     # Check configuration");
}
