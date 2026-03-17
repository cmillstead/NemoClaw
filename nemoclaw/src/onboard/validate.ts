// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export interface ValidationResult {
  valid: boolean;
  models: string[];
  error: string | null;
}

export async function validateApiKey(
  apiKey: string,
  endpointUrl: string,
): Promise<ValidationResult> {
  const url = `${endpointUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        valid: false,
        models: [],
        error: `HTTP ${String(response.status)}: ${body.slice(0, 200)}`,
      };
    }

    const json = (await response.json()) as { data?: { id: string }[] };
    const models = (json.data ?? []).map((m) => m.id);
    return { valid: true, models, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out (10s)"
          : err.message
        : String(err);
    return { valid: false, models: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

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
