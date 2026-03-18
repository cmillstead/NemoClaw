// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  buildGooseArgs,
  buildGooseEnv,
  parseGooseOutput,
  isGooseInstalled,
} from "./goose.js";

describe("goose tool", () => {
  describe("buildGooseArgs", () => {
    it("builds basic headless args", () => {
      const args = buildGooseArgs("write a hello world function");
      expect(args).toContain("run");
      expect(args).toContain("--no-session");
      expect(args).toContain("--quiet");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args).toContain("-t");
      expect(args).toContain("write a hello world function");
    });

    it("includes max-turns flag", () => {
      const args = buildGooseArgs("task", { maxTurns: 10 });
      expect(args).toContain("--max-turns");
      expect(args).toContain("10");
    });

    it("includes named session when provided", () => {
      const args = buildGooseArgs("task", { session: "my-session" });
      expect(args).not.toContain("--no-session");
      expect(args).toContain("-n");
      expect(args).toContain("my-session");
    });

    it("includes resume flag for named sessions", () => {
      const args = buildGooseArgs("continue work", { session: "my-session", resume: true });
      expect(args).toContain("-r");
    });

    it("includes extensions when provided", () => {
      const args = buildGooseArgs("task", { extensions: ["developer"] });
      expect(args).toContain("--with-builtin");
      expect(args).toContain("developer");
    });
  });

  describe("buildGooseEnv", () => {
    it("sets GOOSE_MODE to auto", () => {
      const env = buildGooseEnv({});
      expect(env.GOOSE_MODE).toBe("auto");
    });

    it("sets GOOSE_MAX_TURNS", () => {
      const env = buildGooseEnv({ maxTurns: 25 });
      expect(env.GOOSE_MAX_TURNS).toBe("25");
    });

    it("maps OpenRouter provider config", () => {
      const env = buildGooseEnv({
        provider: "openrouter",
        apiKey: "sk-test-123",
        model: "anthropic/claude-sonnet-4",
      });
      expect(env.GOOSE_PROVIDER).toBe("openrouter");
      expect(env.OPENROUTER_API_KEY).toBe("sk-test-123");
      expect(env.GOOSE_MODEL).toBe("anthropic/claude-sonnet-4");
    });

    it("maps custom endpoint config", () => {
      const env = buildGooseEnv({
        provider: "openai",
        apiKey: "nvapi-test",
        endpoint: "https://integrate.api.nvidia.com/v1",
        model: "nvidia/nemotron-3-super-120b-a12b",
      });
      expect(env.GOOSE_PROVIDER).toBe("openai");
      expect(env.OPENAI_API_KEY).toBe("nvapi-test");
      expect(env.OPENAI_HOST).toBe("https://integrate.api.nvidia.com/v1");
    });

    it("maps Ollama config", () => {
      const env = buildGooseEnv({
        provider: "ollama",
        endpoint: "http://host.openshell.internal:11434",
        model: "llama3",
      });
      expect(env.GOOSE_PROVIDER).toBe("ollama");
      expect(env.OLLAMA_HOST).toBe("http://host.openshell.internal:11434");
    });
  });

  describe("parseGooseOutput", () => {
    it("parses JSON output", () => {
      const raw = JSON.stringify({
        response: "Here is the code:\n```typescript\nconst x = 1;\n```",
        tool_calls: [],
      });
      const result = parseGooseOutput(raw);
      expect(result.success).toBe(true);
      expect(result.response).toContain("const x = 1");
    });

    it("handles non-JSON output gracefully", () => {
      const result = parseGooseOutput("Some plain text output");
      expect(result.success).toBe(true);
      expect(result.response).toBe("Some plain text output");
    });

    it("handles empty output", () => {
      const result = parseGooseOutput("");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("isGooseInstalled", () => {
    it("returns a boolean", () => {
      const result = isGooseInstalled();
      expect(typeof result).toBe("boolean");
    });
  });
});
