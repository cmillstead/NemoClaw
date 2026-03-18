// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest"; // mock-ok: readline is interactive stdin — cannot be tested without simulating user input

const mockQuestion = vi.fn(); // mock-ok: readline is interactive stdin — no real alternative
const mockClose = vi.fn(); // mock-ok: readline is interactive stdin

vi.mock("node:readline/promises", () => ({ // mock-ok: readline is interactive stdin — no real alternative exists
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

const { promptInput, promptConfirm, promptSelect } = await import("./prompt.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promptInput", () => {
  it("returns user input trimmed", async () => {
    mockQuestion.mockResolvedValueOnce("  hello world  ");
    const result = await promptInput("Enter name");
    expect(result).toBe("hello world");
  });

  it("returns default value when input is empty", async () => {
    mockQuestion.mockResolvedValueOnce("");
    const result = await promptInput("Enter name", "default-val");
    expect(result).toBe("default-val");
  });

  it("returns empty string when no input and no default", async () => {
    mockQuestion.mockResolvedValueOnce("");
    const result = await promptInput("Enter name");
    expect(result).toBe("");
  });

  it("closes the readline interface after use", async () => {
    mockQuestion.mockResolvedValueOnce("test");
    await promptInput("Q");
    expect(mockClose).toHaveBeenCalled();
  });
});

describe("promptConfirm", () => {
  it("returns true for 'y'", async () => {
    mockQuestion.mockResolvedValueOnce("y");
    expect(await promptConfirm("Continue?")).toBe(true);
  });

  it("returns true for 'yes'", async () => {
    mockQuestion.mockResolvedValueOnce("yes");
    expect(await promptConfirm("Continue?")).toBe(true);
  });

  it("returns false for 'n'", async () => {
    mockQuestion.mockResolvedValueOnce("n");
    expect(await promptConfirm("Continue?")).toBe(false);
  });

  it("returns defaultYes=true when input is empty", async () => {
    mockQuestion.mockResolvedValueOnce("");
    expect(await promptConfirm("Continue?", true)).toBe(true);
  });

  it("returns defaultYes=false when input is empty", async () => {
    mockQuestion.mockResolvedValueOnce("");
    expect(await promptConfirm("Continue?", false)).toBe(false);
  });
});

describe("promptSelect", () => {
  const options = [
    { label: "Option A", value: "a" },
    { label: "Option B", value: "b", hint: "recommended" },
    { label: "Option C", value: "c" },
  ];

  it("returns selected option by number", async () => {
    mockQuestion.mockResolvedValueOnce("2");
    const result = await promptSelect("Choose:", options);
    expect(result).toBe("b");
  });

  it("returns default option when input is empty", async () => {
    mockQuestion.mockResolvedValueOnce("");
    const result = await promptSelect("Choose:", options, 1);
    expect(result).toBe("b");
  });

  it("returns first option as default when defaultIndex is 0", async () => {
    mockQuestion.mockResolvedValueOnce("");
    const result = await promptSelect("Choose:", options);
    expect(result).toBe("a");
  });
});
