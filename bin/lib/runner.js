// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");

// Auto-detect Colima Docker socket (legacy ~/.colima or XDG ~/.config/colima)
if (!process.env.DOCKER_HOST) {
  const home = process.env.HOME || "/tmp";
  const candidates = [
    path.join(home, ".colima/default/docker.sock"),
    path.join(home, ".config/colima/default/docker.sock"),
  ];
  for (const sock of candidates) {
    if (fs.existsSync(sock)) {
      process.env.DOCKER_HOST = `unix://${sock}`;
      break;
    }
  }
}

/**
 * @deprecated Do NOT call with user-controlled input — spawns a shell via bash -c.
 * Use {@link runArgv} instead for any command where arguments may contain untrusted data.
 */
function run(cmd, opts = {}) {
  const result = spawnSync("bash", ["-c", cmd], {
    stdio: "inherit",
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    ...opts,
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${cmd.slice(0, 80)}`);
    process.exit(result.status || 1);
  }
  return result;
}

/**
 * @deprecated Do NOT call with user-controlled input — uses execSync which spawns a shell.
 * Use {@link runCaptureArgv} instead for any command where arguments may contain untrusted data.
 */
function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return "";
    throw err;
  }
}

function runArgv(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    ...opts,
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${cmd} ${args.join(" ").slice(0, 60)}`);
    process.exit(result.status || 1);
  }
  return result;
}

function runCaptureArgv(cmd, args = [], opts = {}) {
  const { execFileSync: efs } = require("child_process");
  try {
    return efs(cmd, args, {
      encoding: "utf-8",
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return "";
    throw err;
  }
}

const RFC1123_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateInstanceName(name) {
  if (!RFC1123_RE.test(name)) {
    console.error(`  Invalid instance name: '${name}'`);
    console.error("  Names must be lowercase, contain only letters, numbers, and hyphens,");
    console.error("  and must start and end with a letter or number.");
    process.exit(1);
  }
}

module.exports = { ROOT, SCRIPTS, run, runCapture, runArgv, runCaptureArgv, validateInstanceName };
