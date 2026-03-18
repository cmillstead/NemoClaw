// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { maskApiKey, validateKeyPrefix, validateEndpointReachable } from "./validate.js";

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

  it("returns reachable: false when server redirects (SSRF protection)", async () => {
    // Start a server that returns a 302 redirect
    server = createServer((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, () => {
        const addr = server!.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        resolve(p);
      });
    });
    const result = await validateEndpointReachable(`http://localhost:${String(port)}/v1`);
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("redirect");
  });

  it("returns reachable: false for unreachable endpoint", async () => {
    const result = await validateEndpointReachable("http://localhost:19999/v1");
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
