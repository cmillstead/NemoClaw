# Provider-Agnostic Refactor — Implementation Plan

**Date:** 2026-03-17
**Branch:** `feat/provider-agnostic`
**Base:** `main`

---

## Overview

Replace scattered switch statements in `onboard.ts` with a declarative `ProviderDefinition` registry. Add OpenRouter as a new provider. Remove the `NEMOCLAW_EXPERIMENTAL` gate entirely. All providers are first-class.

## Files Changed (9)

| # | File | Action |
|---|------|--------|
| 1 | `nemoclaw/src/onboard/providers.ts` | NEW |
| 2 | `nemoclaw/src/onboard/config.ts` | MODIFY |
| 3 | `nemoclaw/src/onboard/validate.ts` | MODIFY |
| 4 | `nemoclaw/src/commands/onboard.ts` | REWRITE |
| 5 | `nemoclaw/src/index.ts` | MODIFY |
| 6 | `nemoclaw/src/cli.ts` | MODIFY |
| 7 | `nemoclaw-blueprint/blueprint.yaml` | MODIFY |
| 8 | `nemoclaw-blueprint/policies/openclaw-sandbox.yaml` | MODIFY |
| 9 | `nemoclaw-blueprint/orchestrator/runner.py` | MODIFY |

---

## Task 1: Add `"openrouter"` to `EndpointType` and optional `providerLabel` to config

**File:** `nemoclaw/src/onboard/config.ts`
**Lines:** 9, 11-19
**Depends on:** nothing
**Time:** 2 min
**Model:** haiku

### Changes

In `config.ts` line 9, update the `EndpointType` union:

```typescript
export type EndpointType = "build" | "ncp" | "openrouter" | "nim-local" | "vllm" | "ollama" | "custom";
```

In the `NemoClawOnboardConfig` interface (lines 11-19), add `providerLabel`:

```typescript
export interface NemoClawOnboardConfig {
  endpointType: EndpointType;
  endpointUrl: string;
  ncpPartner: string | null;
  model: string;
  profile: string;
  credentialEnv: string;
  providerLabel?: string;
  onboardedAt: string;
}
```

### Test

Build should still compile:
```bash
cd /Users/cevin/src/NemoClaw/nemoclaw && npx tsc --noEmit
```

---

## Task 2: Create the provider registry

**File:** `nemoclaw/src/onboard/providers.ts` (NEW)
**Depends on:** Task 1 (needs updated `EndpointType`)
**Time:** 5 min
**Model:** haiku

### Code

```typescript
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { EndpointType } from "./config.js";

export interface ProviderDefinition {
  id: EndpointType;
  label: string;
  hint: string | ((ctx: { ollamaInstalled: boolean }) => string);
  profile: string;
  providerName: string;
  credentialEnv: string;
  requiresApiKey: boolean;
  defaultCredential: string;
  endpointUrlMode: "fixed" | "prompt" | "prompt-with-default";
  defaultEndpointUrl: string | null;
  endpointUrlPrompt?: string;
  requiresNcpPartner: boolean;
  tier: "supported" | "local" | "custom";
  softValidation: boolean;
  keyPrefixes?: string[];
}

const HOST_GATEWAY_URL = "http://host.openshell.internal";

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "build",
    label: "NVIDIA Build (build.nvidia.com)",
    hint: "recommended — zero infra, free credits",
    profile: "default",
    providerName: "nvidia-nim",
    credentialEnv: "NVIDIA_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    endpointUrlMode: "fixed",
    defaultEndpointUrl: "https://integrate.api.nvidia.com/v1",
    requiresNcpPartner: false,
    tier: "supported",
    softValidation: false,
    keyPrefixes: ["nvapi-"],
  },
  {
    id: "ncp",
    label: "NVIDIA Cloud Partner (NCP)",
    hint: "dedicated capacity, SLA-backed",
    profile: "ncp",
    providerName: "nvidia-ncp",
    credentialEnv: "NVIDIA_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    endpointUrlMode: "prompt",
    defaultEndpointUrl: null,
    endpointUrlPrompt: "NCP endpoint URL (e.g., https://partner.api.nvidia.com/v1)",
    requiresNcpPartner: true,
    tier: "supported",
    softValidation: false,
    keyPrefixes: ["nvapi-"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "multi-provider routing, pay-per-token",
    profile: "openrouter",
    providerName: "openrouter",
    credentialEnv: "OPENROUTER_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    endpointUrlMode: "fixed",
    defaultEndpointUrl: "https://openrouter.ai/api/v1",
    requiresNcpPartner: false,
    tier: "supported",
    softValidation: false,
    keyPrefixes: ["sk-or-"],
  },
  {
    id: "nim-local",
    label: "Self-hosted NIM",
    hint: "your own NIM container deployment",
    profile: "nim-local",
    providerName: "nim-local",
    credentialEnv: "NIM_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    endpointUrlMode: "prompt-with-default",
    defaultEndpointUrl: "http://nim-service.local:8000/v1",
    endpointUrlPrompt: "NIM endpoint URL",
    requiresNcpPartner: false,
    tier: "local",
    softValidation: true,
  },
  {
    id: "vllm",
    label: "Local vLLM",
    hint: "local development",
    profile: "vllm",
    providerName: "vllm-local",
    credentialEnv: "OPENAI_API_KEY",
    requiresApiKey: false,
    defaultCredential: "dummy",
    endpointUrlMode: "fixed",
    defaultEndpointUrl: `${HOST_GATEWAY_URL}:8000/v1`,
    requiresNcpPartner: false,
    tier: "local",
    softValidation: true,
  },
  {
    id: "ollama",
    label: "Local Ollama",
    hint: ((ctx: { ollamaInstalled: boolean }) =>
      ctx.ollamaInstalled ? "installed locally" : "localhost:11434"),
    profile: "ollama",
    providerName: "ollama-local",
    credentialEnv: "OPENAI_API_KEY",
    requiresApiKey: false,
    defaultCredential: "ollama",
    endpointUrlMode: "fixed",
    defaultEndpointUrl: `${HOST_GATEWAY_URL}:11434/v1`,
    requiresNcpPartner: false,
    tier: "local",
    softValidation: true,
  },
  {
    id: "custom",
    label: "Custom endpoint",
    hint: "bring your own OpenAI-compatible endpoint",
    profile: "custom",
    providerName: "custom",
    credentialEnv: "OPENAI_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    endpointUrlMode: "prompt",
    defaultEndpointUrl: null,
    endpointUrlPrompt: "Custom endpoint URL",
    requiresNcpPartner: false,
    tier: "custom",
    softValidation: true,
  },
];

/** Lookup a provider definition by id. Throws if not found. */
export function getProvider(id: EndpointType): ProviderDefinition {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

/** All valid endpoint type strings. */
export const ENDPOINT_TYPES: EndpointType[] = PROVIDERS.map((p) => p.id);
```

### Test

```bash
cd /Users/cevin/src/NemoClaw/nemoclaw && npx tsc --noEmit
```

---

## Task 3: Write tests for the provider registry

**File:** `nemoclaw/src/onboard/providers.test.ts` (NEW)
**Depends on:** Task 2
**Time:** 3 min
**Model:** haiku

### Code

```typescript
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, ENDPOINT_TYPES } from "./providers.js";

describe("providers registry", () => {
  it("has 7 providers", () => {
    expect(PROVIDERS).toHaveLength(7);
  });

  it("every provider has a unique id", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every provider has a unique providerName", () => {
    const names = PROVIDERS.map((p) => p.providerName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ENDPOINT_TYPES matches provider ids", () => {
    expect(ENDPOINT_TYPES).toEqual(PROVIDERS.map((p) => p.id));
  });

  it("getProvider returns correct provider for each id", () => {
    for (const p of PROVIDERS) {
      expect(getProvider(p.id)).toBe(p);
    }
  });

  it("getProvider throws for unknown id", () => {
    expect(() => getProvider("bogus" as never)).toThrow("Unknown provider: bogus");
  });

  it("build provider has correct defaults", () => {
    const build = getProvider("build");
    expect(build.defaultEndpointUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(build.credentialEnv).toBe("NVIDIA_API_KEY");
    expect(build.requiresApiKey).toBe(true);
    expect(build.tier).toBe("supported");
    expect(build.softValidation).toBe(false);
    expect(build.endpointUrlMode).toBe("fixed");
  });

  it("openrouter provider has correct defaults", () => {
    const or = getProvider("openrouter");
    expect(or.defaultEndpointUrl).toBe("https://openrouter.ai/api/v1");
    expect(or.credentialEnv).toBe("OPENROUTER_API_KEY");
    expect(or.keyPrefixes).toEqual(["sk-or-"]);
    expect(or.tier).toBe("supported");
    expect(or.profile).toBe("openrouter");
  });

  it("ollama hint is a function", () => {
    const ollama = getProvider("ollama");
    expect(typeof ollama.hint).toBe("function");
    const hintFn = ollama.hint as (ctx: { ollamaInstalled: boolean }) => string;
    expect(hintFn({ ollamaInstalled: true })).toBe("installed locally");
    expect(hintFn({ ollamaInstalled: false })).toBe("localhost:11434");
  });

  it("custom provider uses prompt endpointUrlMode", () => {
    const custom = getProvider("custom");
    expect(custom.endpointUrlMode).toBe("prompt");
    expect(custom.tier).toBe("custom");
  });

  it("local-tier providers all have softValidation: true", () => {
    const locals = PROVIDERS.filter((p) => p.tier === "local");
    expect(locals.length).toBeGreaterThanOrEqual(3);
    for (const p of locals) {
      expect(p.softValidation).toBe(true);
    }
  });

  it("supported-tier providers all have softValidation: false", () => {
    const supported = PROVIDERS.filter((p) => p.tier === "supported");
    expect(supported.length).toBeGreaterThanOrEqual(2);
    for (const p of supported) {
      expect(p.softValidation).toBe(false);
    }
  });

  it("providers with requiresApiKey: false have non-empty defaultCredential", () => {
    for (const p of PROVIDERS) {
      if (!p.requiresApiKey) {
        expect(p.defaultCredential).not.toBe("");
      }
    }
  });

  it("providers with fixed endpointUrlMode have defaultEndpointUrl", () => {
    for (const p of PROVIDERS) {
      if (p.endpointUrlMode === "fixed") {
        expect(p.defaultEndpointUrl).toBeTruthy();
      }
    }
  });

  it("providers with prompt/prompt-with-default have endpointUrlPrompt", () => {
    for (const p of PROVIDERS) {
      if (p.endpointUrlMode === "prompt" || p.endpointUrlMode === "prompt-with-default") {
        expect(p.endpointUrlPrompt).toBeTruthy();
      }
    }
  });
});
```

### Run

```bash
cd /Users/cevin/src/NemoClaw/nemoclaw && npx vitest run src/onboard/providers.test.ts
```

---

## Task 4: Add key-prefix validation and `validateEndpointReachable` to validate.ts

**File:** `nemoclaw/src/onboard/validate.ts`
**Lines:** 51-58 (modify `maskApiKey`), append new functions after line 58
**Depends on:** nothing
**Time:** 4 min
**Model:** haiku

### Changes

Replace `maskApiKey` (lines 51-58) with expanded version that handles `sk-or-` and `sk-` prefixes:

```typescript
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  const last4 = apiKey.slice(-4);
  if (apiKey.startsWith("nvapi-")) {
    return `nvapi-****${last4}`;
  }
  if (apiKey.startsWith("sk-or-")) {
    return `sk-or-****${last4}`;
  }
  if (apiKey.startsWith("sk-")) {
    return `sk-****${last4}`;
  }
  return `****${last4}`;
}
```

Append after the updated `maskApiKey`:

```typescript

/**
 * Check if an API key matches any of the expected prefixes for a provider.
 * Returns null if valid (or no prefixes defined), or an error string.
 */
export function validateKeyPrefix(apiKey: string, prefixes: string[] | undefined): string | null {
  if (!prefixes || prefixes.length === 0) return null;
  const matches = prefixes.some((prefix) => apiKey.startsWith(prefix));
  if (matches) return null;
  return `Key does not match expected prefix(es): ${prefixes.join(", ")}. Got: ${apiKey.slice(0, 6)}...`;
}

/**
 * Lightweight reachability check -- HEAD request to the endpoint's /models.
 * Returns { reachable: true } or { reachable: false, error: string }.
 * Any HTTP response (even 401/403) counts as reachable.
 */
export async function validateEndpointReachable(
  endpointUrl: string,
): Promise<{ reachable: boolean; error?: string }> {
  const url = `${endpointUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5_000);

  try {
    await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    // Any HTTP response (even 401/403) means the endpoint is reachable
    return { reachable: true };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out (5s)"
          : err.message
        : String(err);
    return { reachable: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## Task 5: Write tests for validate.ts additions

**File:** `nemoclaw/src/onboard/validate.test.ts` (NEW)
**Depends on:** Task 4
**Time:** 4 min
**Model:** haiku

Uses a real `node:http` server for endpoint reachability tests (no mocks).

### Code

```typescript
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import {
  maskApiKey,
  validateKeyPrefix,
  validateEndpointReachable,
} from "./validate.js";

describe("maskApiKey", () => {
  it("masks nvapi- keys", () => {
    expect(maskApiKey("nvapi-abcdef1234567890")).toBe("nvapi-****7890");
  });

  it("masks sk-or- keys", () => {
    expect(maskApiKey("sk-or-abcdef1234567890")).toBe("sk-or-****7890");
  });

  it("masks sk- keys", () => {
    expect(maskApiKey("sk-abcdef1234567890")).toBe("sk-****7890");
  });

  it("masks generic keys", () => {
    expect(maskApiKey("someotherkey1234")).toBe("****1234");
  });

  it("returns **** for short keys", () => {
    expect(maskApiKey("short")).toBe("****");
  });
});

describe("validateKeyPrefix", () => {
  it("returns null when no prefixes defined", () => {
    expect(validateKeyPrefix("anything", undefined)).toBeNull();
    expect(validateKeyPrefix("anything", [])).toBeNull();
  });

  it("returns null when key matches a prefix", () => {
    expect(validateKeyPrefix("nvapi-abc123", ["nvapi-"])).toBeNull();
    expect(validateKeyPrefix("sk-or-abc", ["sk-or-", "sk-"])).toBeNull();
  });

  it("returns error string when key does not match any prefix", () => {
    const result = validateKeyPrefix("badkey-123456", ["nvapi-"]);
    expect(result).not.toBeNull();
    expect(result).toContain("does not match");
    expect(result).toContain("nvapi-");
  });
});

describe("validateEndpointReachable", () => {
  let server: Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  function startServer(statusCode: number): Promise<number> {
    return new Promise((resolve) => {
      server = createServer((_req, res) => {
        res.writeHead(statusCode);
        res.end();
      });
      server.listen(0, () => {
        const addr = server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
    });
  }

  it("returns reachable: true for a 200 response", async () => {
    const port = await startServer(200);
    const result = await validateEndpointReachable(`http://localhost:${String(port)}/v1`);
    expect(result.reachable).toBe(true);
  });

  it("returns reachable: true for a 401 response", async () => {
    const port = await startServer(401);
    const result = await validateEndpointReachable(`http://localhost:${String(port)}/v1`);
    expect(result.reachable).toBe(true);
  });

  it("returns reachable: false for unreachable endpoint", async () => {
    const result = await validateEndpointReachable("http://localhost:19999/v1");
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
```

### Run

```bash
cd /Users/cevin/src/NemoClaw/nemoclaw && npx vitest run src/onboard/validate.test.ts
```

---

## Task 6: Rewrite `commands/onboard.ts` to use the registry

**File:** `nemoclaw/src/commands/onboard.ts`
**Lines:** 1-453 (full rewrite)
**Depends on:** Tasks 1, 2, 4
**Time:** 5 min
**Model:** sonnet

This is the biggest change. The entire file is replaced. Key behavioral changes from old code:

1. **No `NEMOCLAW_EXPERIMENTAL` gate** -- all providers always visible in the menu
2. **Ollama auto-detection is now a prompt** -- "Detected Ollama on localhost:11434. Use it? [Y/n]" instead of silently selecting
3. **Custom credential env var** -- for `custom` provider, user is prompted for the env var name (default `OPENAI_API_KEY`)
4. **Key prefix validation** -- soft warning if key doesn't match expected prefix (e.g., `nvapi-`, `sk-or-`)
5. **Model selection for non-NVIDIA** -- shows `/v1/models` results if available, falls back to manual entry
6. **OpenRouter** -- fully wired as a supported-tier provider
7. **`providerLabel`** -- saved to config for display in `index.ts`

### Code

```typescript
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
```

---

## Task 7: Update `index.ts` for dynamic provider registration

**File:** `nemoclaw/src/index.ts`
**Lines:** 196-258 (from `// 3. Register nvidia-nim provider` to end of `register`)
**Depends on:** Tasks 1, 2
**Time:** 3 min
**Model:** sonnet

### Changes

Replace lines 196-258 (the entire provider registration block and banner) with:

```typescript
  // 3. Register provider -- use onboard config if available, fall back to NVIDIA defaults
  const onboardCfg = loadOnboardConfig();

  if (onboardCfg) {
    // Dynamic registration based on what the user onboarded with
    const providerCredentialEnv = onboardCfg.credentialEnv;
    const providerLabel =
      onboardCfg.providerLabel ??
      `${onboardCfg.endpointType}${onboardCfg.ncpPartner ? ` - ${onboardCfg.ncpPartner}` : ""}`;

    api.registerProvider({
      id: onboardCfg.endpointType === "build" ? "nvidia-nim" : onboardCfg.endpointType,
      label: providerLabel,
      docsPath:
        onboardCfg.endpointType === "openrouter"
          ? "https://openrouter.ai/docs"
          : "https://build.nvidia.com/docs",
      envVars: [providerCredentialEnv],
      models: {
        chat: [
          {
            id: onboardCfg.model,
            label: onboardCfg.model,
            contextWindow: 131072,
            maxOutput: 8192,
          },
        ],
      },
      auth: [
        {
          type: "bearer",
          envVar: providerCredentialEnv,
          headerName: "Authorization",
          label: `API Key (${providerCredentialEnv})`,
        },
      ],
    });
  } else {
    // Default: register NVIDIA NIM provider (no onboard config yet)
    api.registerProvider({
      id: "nvidia-nim",
      label: "NVIDIA NIM (build.nvidia.com)",
      docsPath: "https://build.nvidia.com/docs",
      aliases: ["nvidia", "nim"],
      envVars: ["NVIDIA_API_KEY"],
      models: {
        chat: [
          {
            id: "nvidia/nemotron-3-super-120b-a12b",
            label: "Nemotron 3 Super 120B (March 2026)",
            contextWindow: 131072,
            maxOutput: 8192,
          },
          {
            id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
            label: "Nemotron Ultra 253B",
            contextWindow: 131072,
            maxOutput: 4096,
          },
          {
            id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
            label: "Nemotron Super 49B v1.5",
            contextWindow: 131072,
            maxOutput: 4096,
          },
          {
            id: "nvidia/nemotron-3-nano-30b-a3b",
            label: "Nemotron 3 Nano 30B",
            contextWindow: 131072,
            maxOutput: 4096,
          },
        ],
      },
      auth: [
        {
          type: "bearer",
          envVar: "NVIDIA_API_KEY",
          headerName: "Authorization",
          label: "NVIDIA API Key (NVIDIA_API_KEY)",
        },
      ],
    });
  }

  const bannerEndpoint = onboardCfg?.endpointType ?? "build.nvidia.com";
  const bannerModel = onboardCfg?.model ?? "nvidia/nemotron-3-super-120b-a12b";

  api.logger.info("");
  api.logger.info("  ┌─────────────────────────────────────────────────────┐");
  api.logger.info("  │  NemoClaw registered                                │");
  api.logger.info("  │                                                     │");
  api.logger.info(`  │  Endpoint:  ${bannerEndpoint.padEnd(40)}│`);
  api.logger.info(`  │  Model:     ${bannerModel.padEnd(40)}│`);
  api.logger.info("  │  Commands:  openclaw nemoclaw <command>             │");
  api.logger.info("  └─────────────────────────────────────────────────────┘");
  api.logger.info("");
}
```

---

## Task 8: Update `cli.ts` help text

**File:** `nemoclaw/src/cli.ts`
**Line:** 113
**Depends on:** Task 6
**Time:** 1 min
**Model:** haiku

### Changes

Replace line 113:
```
    .option("--endpoint <type>", "Endpoint type: build, ncp, nim-local, vllm, ollama, custom (local options are experimental)")
```
with:
```
    .option("--endpoint <type>", "Endpoint type: build, ncp, openrouter, nim-local, vllm, ollama, custom")
```

---

## Task 9: Update `blueprint.yaml` -- add ollama, openrouter, custom profiles

**File:** `nemoclaw-blueprint/blueprint.yaml`
**Lines:** 9-13 (profiles list), 55+ (inference profiles)
**Depends on:** nothing
**Time:** 3 min
**Model:** haiku

### Changes

**Profiles list** (replace lines 9-13):

```yaml
profiles:
  - default
  - ncp
  - openrouter
  - nim-local
  - vllm
  - ollama
  - custom
```

**New inference profiles** (append after the `vllm` block, after line 55):

```yaml

      ollama:
        provider_type: "openai"
        provider_name: "ollama-local"
        endpoint: "http://localhost:11434/v1"
        model: ""
        credential_env: "OPENAI_API_KEY"
        credential_default: "ollama"

      openrouter:
        provider_type: "openai"
        provider_name: "openrouter"
        endpoint: "https://openrouter.ai/api/v1"
        model: ""
        credential_env: "OPENROUTER_API_KEY"

      custom:
        provider_type: "openai"
        provider_name: "custom"
        endpoint: ""
        model: ""
        credential_env: "OPENAI_API_KEY"
        dynamic_endpoint: true
```

---

## Task 10: Update `openclaw-sandbox.yaml` -- add OpenRouter + local inference policies

**File:** `nemoclaw-blueprint/policies/openclaw-sandbox.yaml`
**Lines:** append after line 168 (after telegram policy)
**Depends on:** nothing
**Time:** 3 min
**Model:** haiku

### Changes

Append after the telegram policy block:

```yaml

  # -- OpenRouter -- multi-provider inference routing
  openrouter:
    name: openrouter
    endpoints:
      - host: openrouter.ai
        port: 443
        protocol: rest
        enforcement: enforce
        tls: terminate
        rules:
          - allow: { method: "*", path: "/api/**" }
    binaries:
      - { path: /usr/local/bin/claude }
      - { path: /usr/local/bin/openclaw }

  # -- Local inference (NIM, vLLM, Ollama)
  # Covers common local endpoints. `openclaw nemoclaw onboard` may generate
  # a more specific policy for the user's actual host:port.
  local_inference:
    name: local_inference
    endpoints:
      - host: nim-service.local
        port: 8000
        protocol: rest
        enforcement: enforce
        rules:
          - allow: { method: "*", path: "/**" }
      - host: host.openshell.internal
        port: 8000
        protocol: rest
        enforcement: enforce
        rules:
          - allow: { method: "*", path: "/**" }
      - host: host.openshell.internal
        port: 11434
        protocol: rest
        enforcement: enforce
        rules:
          - allow: { method: "*", path: "/**" }
    binaries:
      - { path: /usr/local/bin/claude }
      - { path: /usr/local/bin/openclaw }
```

---

## Task 11: Update `runner.py` -- credential warning for non-NVIDIA providers

**File:** `nemoclaw-blueprint/orchestrator/runner.py`
**Lines:** 197-201 (credential resolution in `action_apply`)
**Depends on:** nothing
**Time:** 2 min
**Model:** haiku

### Changes

Replace lines 197-201:
```python
    credential_env = inference_cfg.get("credential_env")
    credential_default: str = inference_cfg.get("credential_default", "")
    credential = ""
    if credential_env:
        credential = os.environ.get(credential_env, credential_default)
```

With:
```python
    credential_env = inference_cfg.get("credential_env")
    credential_default: str = inference_cfg.get("credential_default", "")
    credential = ""
    if credential_env:
        credential = os.environ.get(credential_env, "")
        if not credential and credential_default:
            credential = credential_default
        if not credential:
            log(
                f"WARNING: {credential_env} not set in environment. "
                f"Inference provider '{provider_name}' may fail to authenticate. "
                f"Set it with: export {credential_env}=<your-key>"
            )
```

---

## Task 12: Backward compatibility verification

**Depends on:** Tasks 1-11
**Time:** 3 min
**Model:** sonnet

### Checks

1. **Old config deserialization**: `NemoClawOnboardConfig` has `providerLabel` as optional (`?`), so configs saved by the old code (which lack this field) will deserialize to `{ providerLabel: undefined }`. The `index.ts` code handles this with a fallback: `onboardCfg.providerLabel ?? fallbackLabel`.

2. **CLI flags**: Verify `--endpoint build`, `--endpoint ncp`, `--endpoint nim-local`, `--endpoint vllm`, `--endpoint ollama`, and `--endpoint custom` all still work. The new code derives behavior from the registry, so if the registry entry is correct, the flag works.

3. **Blueprint profiles**: Old profiles (`default`, `ncp`, `nim-local`, `vllm`) are unchanged in blueprint.yaml. New profiles (`ollama`, `openrouter`, `custom`) are added without modifying existing ones.

4. **Policy file**: Existing policies in `openclaw-sandbox.yaml` are untouched. New policies (`openrouter`, `local_inference`) are appended.

```bash
cd /Users/cevin/src/NemoClaw/nemoclaw && npx tsc --noEmit
```

---

## Task 13: Run all tests and lint

**Depends on:** all previous tasks
**Time:** 2 min
**Model:** sonnet

### Commands

```bash
# TypeScript tests (vitest) -- includes new providers.test.ts and validate.test.ts
cd /Users/cevin/src/NemoClaw/nemoclaw && npx vitest run

# Root-level tests (node:test) -- cli.test.js, policies.test.js, etc.
cd /Users/cevin/src/NemoClaw && npm test

# Lint
cd /Users/cevin/src/NemoClaw/nemoclaw && npm run lint

# Type check
cd /Users/cevin/src/NemoClaw/nemoclaw && npx tsc --noEmit
```

Expected: all pass. If `policies.test.js` breaks (it counts presets and checks schema), verify the new policy entries match the YAML schema patterns already enforced by the test.

---

## Task 14: Commit

**Depends on:** Task 13 passing
**Model:** haiku

```bash
cd /Users/cevin/src/NemoClaw
git add \
  nemoclaw/src/onboard/providers.ts \
  nemoclaw/src/onboard/providers.test.ts \
  nemoclaw/src/onboard/validate.test.ts \
  nemoclaw/src/onboard/config.ts \
  nemoclaw/src/onboard/validate.ts \
  nemoclaw/src/commands/onboard.ts \
  nemoclaw/src/index.ts \
  nemoclaw/src/cli.ts \
  nemoclaw-blueprint/blueprint.yaml \
  nemoclaw-blueprint/policies/openclaw-sandbox.yaml \
  nemoclaw-blueprint/orchestrator/runner.py

git commit -m "feat: provider-agnostic refactor with declarative registry and OpenRouter support

Replace switch-statement dispatch in onboard.ts with a declarative ProviderDefinition
registry. All 7 providers (build, ncp, openrouter, nim-local, vllm, ollama, custom) are
now first-class. NEMOCLAW_EXPERIMENTAL gate removed entirely.

- New providers.ts: ProviderDefinition interface + PROVIDERS array
- OpenRouter: supported-tier provider with sk-or- key prefix validation
- Ollama auto-detect: prompts user instead of silently selecting
- Custom endpoint: prompts for credential env var name
- Non-NVIDIA model selection: /v1/models results or manual entry fallback
- Dynamic provider registration in index.ts based on onboard config
- Blueprint profiles: added ollama, openrouter, custom
- Sandbox policy: added openrouter + local_inference network policies
- Runner: credential warning when env var not set"
```

---

## Execution Order (Parallelism Map)

```
Parallel batch 1:  Tasks 1, 9, 10, 11       (independent files)
Parallel batch 2:  Tasks 2, 4               (Task 2 depends on 1; Task 4 independent)
Parallel batch 3:  Tasks 3, 5               (tests for Tasks 2, 4)
Sequential:        Task 6                    (depends on 1, 2, 4)
Parallel batch 4:  Tasks 7, 8               (depend on 6 only for type coherence)
Sequential:        Task 12                   (backward compat verification)
Sequential:        Task 13                   (full test + lint)
Sequential:        Task 14                   (commit)
```

## Subagent Model Routing

| Task | Model | Reason |
|------|-------|--------|
| 1 (config.ts) | haiku | 2-line type change, complete spec |
| 2 (providers.ts) | haiku | New file, complete code above |
| 3 (providers.test.ts) | haiku | New file, complete code above |
| 4 (validate.ts) | haiku | Append functions, complete spec |
| 5 (validate.test.ts) | haiku | New file, complete code above |
| 6 (onboard.ts) | sonnet | Full rewrite, behavioral changes |
| 7 (index.ts) | sonnet | Conditional registration logic |
| 8 (cli.ts) | haiku | 1-line string change |
| 9 (blueprint.yaml) | haiku | Append YAML blocks |
| 10 (sandbox policy) | haiku | Append YAML blocks |
| 11 (runner.py) | haiku | Small logic change |
| 12-14 (verify/commit) | sonnet | Needs judgment on failures |
