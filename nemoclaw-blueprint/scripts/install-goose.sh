#!/bin/bash
# Install Goose CLI binary into the sandbox
set -euo pipefail

GOOSE_VERSION="${GOOSE_VERSION:-stable}"
INSTALL_DIR="${1:-/usr/local/bin}"

echo "Installing Goose CLI (version: ${GOOSE_VERSION})..."

ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

case "${ARCH}" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) echo "Unsupported architecture: ${ARCH}"; exit 1 ;;
esac

case "${OS}" in
  linux) PLATFORM="unknown-linux-gnu" ;;
  darwin) PLATFORM="apple-darwin" ;;
  *) echo "Unsupported OS: ${OS}"; exit 1 ;;
esac

TARBALL="goose-${ARCH}-${PLATFORM}.tar.bz2"
URL="https://github.com/block/goose/releases/download/${GOOSE_VERSION}/${TARBALL}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

curl -fsSL "${URL}" -o "${TMPDIR}/${TARBALL}"
tar -xjf "${TMPDIR}/${TARBALL}" -C "${TMPDIR}"
install -m 755 "${TMPDIR}/goose" "${INSTALL_DIR}/goose"

echo "Goose installed to ${INSTALL_DIR}/goose"
goose --version
