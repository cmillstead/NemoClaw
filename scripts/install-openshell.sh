#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Install the openshell CLI binary. Supports Linux and macOS (x86_64 and aarch64).

set -euo pipefail

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Darwin/x86_64|Darwin/amd64)   ASSET="openshell-x86_64-apple-darwin.tar.gz" ;;
  Darwin/aarch64|Darwin/arm64)  ASSET="openshell-aarch64-apple-darwin.tar.gz" ;;
  Linux/x86_64|Linux/amd64)     ASSET="openshell-x86_64-unknown-linux-musl.tar.gz" ;;
  Linux/aarch64|Linux/arm64)    ASSET="openshell-aarch64-unknown-linux-musl.tar.gz" ;;
  *) echo "Unsupported platform: $OS/$ARCH"; exit 1 ;;
esac

tmpdir="$(mktemp -d)"
curl -fsSL "https://github.com/NVIDIA/OpenShell/releases/latest/download/$ASSET" \
  -o "$tmpdir/openshell.tar.gz"

# SEC-DEP-017: Verify download integrity via checksums file if available
CHECKSUMS_URL="https://github.com/NVIDIA/OpenShell/releases/latest/download/checksums.txt"
if curl -fsSL "$CHECKSUMS_URL" -o "$tmpdir/checksums.txt" 2>/dev/null; then
  expected_hash="$(grep "$ASSET" "$tmpdir/checksums.txt" | awk '{print $1}')"
  if [ -n "$expected_hash" ]; then
    if command -v sha256sum > /dev/null 2>&1; then
      actual_hash="$(sha256sum "$tmpdir/openshell.tar.gz" | awk '{print $1}')"
    elif command -v shasum > /dev/null 2>&1; then
      actual_hash="$(shasum -a 256 "$tmpdir/openshell.tar.gz" | awk '{print $1}')"
    else
      echo "WARNING: No SHA-256 tool found — skipping openshell integrity check"
      actual_hash="$expected_hash"
    fi
    if [ "$actual_hash" != "$expected_hash" ]; then
      rm -rf "$tmpdir"
      echo "ERROR: openshell integrity check failed"
      echo "  Expected: $expected_hash"
      echo "  Actual:   $actual_hash"
      exit 1
    fi
    echo "openshell integrity verified"
  fi
else
  echo "WARNING: Checksums file not available — skipping integrity verification"
  echo "  TODO: Pin a known-good SHA-256 hash for the release asset"
fi

tar xzf "$tmpdir/openshell.tar.gz" -C "$tmpdir"

if [ -w /usr/local/bin ]; then
  install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
else
  sudo install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
fi

rm -rf "$tmpdir"
echo "openshell $(openshell --version 2>&1 || echo 'installed')"
