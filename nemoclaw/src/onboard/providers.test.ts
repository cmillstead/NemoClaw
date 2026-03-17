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
