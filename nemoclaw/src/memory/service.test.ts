// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryServiceRegistry,
  createMemoryService,
  getSessionManager,
  getOrchestrator,
} from "./service.js";
import type { OpenClawPluginApi, OpenClawConfig } from "../index.js";
import { makeLogger } from "../__test-utils__/logger.js";

function makeApi(): OpenClawPluginApi {
  return {
    id: "test",
    name: "test",
    config: {},
    logger: makeLogger(),
    registerCommand: () => {},
    registerCli: () => {},
    registerProvider: () => {},
    registerService: () => {},
    resolvePath: (p: string) => p,
    on: () => {},
  };
}

describe("MemoryServiceRegistry", () => {
  it("starts with null references", () => {
    const reg = new MemoryServiceRegistry();
    expect(reg.sessionManager).toBeNull();
    expect(reg.db).toBeNull();
    expect(reg.orchestrator).toBeNull();
  });
});

describe("getSessionManager / getOrchestrator", () => {
  it("returns null from a fresh registry", () => {
    const reg = new MemoryServiceRegistry();
    expect(getSessionManager(reg)).toBeNull();
    expect(getOrchestrator(reg)).toBeNull();
  });
});

describe("createMemoryService lifecycle", () => {
  let tmpDir: string;
  let registry: MemoryServiceRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "service-test-"));
    // createMemoryService uses resolveMemoryDir() internally which checks /sandbox paths.
    // For unit testing the registry wiring, we test the registry in isolation.
    registry = new MemoryServiceRegistry();
  });

  afterEach(() => {
    // Clean up any open DB handles
    try {
      registry.db?.close();
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a service with the correct id", () => {
    const service = createMemoryService(makeApi(), null, registry);
    expect(service.id).toBe("nemoclaw-memory");
  });

  it("stop cleans up registry references even when start was not called", () => {
    const service = createMemoryService(makeApi(), null, registry);
    const ctx = { config: {} as OpenClawConfig, logger: makeLogger() };
    // stop() should not throw when nothing was started
    void service.stop?.(ctx);
    expect(getSessionManager(registry)).toBeNull();
    expect(getOrchestrator(registry)).toBeNull();
  });

  it("isolated registries do not interfere with each other", () => {
    const reg1 = new MemoryServiceRegistry();
    const reg2 = new MemoryServiceRegistry();

    // Manually set a value on reg1
    reg1.orchestrator = {} as never;

    expect(getOrchestrator(reg1)).not.toBeNull();
    expect(getOrchestrator(reg2)).toBeNull();
  });
});
