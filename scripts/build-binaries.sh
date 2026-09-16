#!/usr/bin/env bash
# Build a standalone vch binary for the CURRENT platform. OpenTUI ships
# platform-specific native code, so binaries are built natively per platform
# (the release workflow runs this on a matrix of OS/arch runners) rather than
# cross-compiled.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
esac

out="dist/vch-${os}-${arch}"
echo "building ${out}"
bun build ./src/index.ts --compile --outfile "${out}"
echo "done: ${out}"
