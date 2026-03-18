"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENDPOINT_TYPES = exports.PROVIDERS = void 0;
exports.getProvider = getProvider;
const HOST_GATEWAY_URL = "http://host.openshell.internal";
exports.PROVIDERS = [
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
        hint: ((ctx) => ctx.ollamaInstalled ? "installed locally" : "localhost:11434"),
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
function getProvider(id) {
    const provider = exports.PROVIDERS.find((p) => p.id === id);
    if (!provider) {
        throw new Error(`Unknown provider: ${id}`);
    }
    return provider;
}
/** All valid endpoint type strings. */
exports.ENDPOINT_TYPES = exports.PROVIDERS.map((p) => p.id);
//# sourceMappingURL=providers.js.map