// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  loadOnboardConfig,
  saveOnboardConfig,
  clearOnboardConfig,
  type NemoClawOnboardConfig,
} from "./config.js";

const CONFIG_PATH = join(process.env.HOME ?? "/tmp", ".nemoclaw", "config.json");

let backedUpConfig: string | null = null;

beforeAll(() => {
  if (existsSync(CONFIG_PATH)) {
    backedUpConfig = readFileSync(CONFIG_PATH, "utf-8");
  }
});

afterAll(() => {
  if (backedUpConfig !== null) {
    writeFileSync(CONFIG_PATH, backedUpConfig);
  } else {
    clearOnboardConfig();
  }
});

function makeConfig(overrides: Partial<NemoClawOnboardConfig> = {}): NemoClawOnboardConfig {
  return {
    endpointType: "openrouter",
    endpointUrl: "https://openrouter.ai/api/v1",
    ncpPartner: null,
    model: "anthropic/claude-3.5-sonnet",
    profile: "default",
    credentialEnv: "OPENROUTER_API_KEY",
    onboardedAt: "2026-03-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("onboard config", () => {
  it("save then load returns matching config", () => {
    const config = makeConfig();
    saveOnboardConfig(config);

    const loaded = loadOnboardConfig();
    expect(loaded).toEqual(config);
  });

  it("save overwrites existing config", () => {
    const first = makeConfig({ model: "first-model" });
    saveOnboardConfig(first);

    const second = makeConfig({ model: "second-model" });
    saveOnboardConfig(second);

    const loaded = loadOnboardConfig();
    expect(loaded).toEqual(second);
    expect(loaded?.model).toBe("second-model");
  });

  it("clear removes config so load returns null", () => {
    saveOnboardConfig(makeConfig());
    clearOnboardConfig();

    const loaded = loadOnboardConfig();
    expect(loaded).toBeNull();
  });

  it("load returns null when no config file exists", () => {
    clearOnboardConfig();

    const loaded = loadOnboardConfig();
    expect(loaded).toBeNull();
  });

  it("load returns null on corrupt JSON", () => {
    saveOnboardConfig(makeConfig());
    writeFileSync(CONFIG_PATH, "not valid json {{{");

    const loaded = loadOnboardConfig();
    expect(loaded).toBeNull();
  });
});
