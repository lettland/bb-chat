#!/usr/bin/env bash
# Build and install the bbchat standalone binary to a bin directory.
#
#   bun run install:local                 # → ~/.local/bin/bbchat
#   PREFIX=/usr/local/bin bun run install:local
#   BBCHAT_INSTALL_MODE=link bun run install:local   # symlink the source wrapper (dev)
#
# Default mode compiles a self-contained binary (embeds Bun + native deps), so it
# keeps working even if this repo moves. `link` mode symlinks bin/bbchat.js and runs
# the live source — handy while developing, but the repo + node_modules must stay.
set -euo pipefail
cd "$(dirname "$0")/.."

prefix="${PREFIX:-$HOME/.local/bin}"
mode="${BBCHAT_INSTALL_MODE:-compile}"
target="$prefix/bbchat"
mkdir -p "$prefix"

echo "installing dependencies…"
bun install

case "$mode" in
  compile)
    echo "building standalone binary → $target"
    bun build ./src/index.ts --compile --outfile "$target"
    ;;
  link)
    echo "linking source wrapper → $target"
    ln -sf "$PWD/bin/bbchat.js" "$target"
    ;;
  *)
    echo "unknown BBCHAT_INSTALL_MODE: $mode (expected 'compile' or 'link')" >&2
    exit 1
    ;;
esac

chmod +x "$target" 2>/dev/null || true
echo "installed bbchat $("$target" version) → $target"

case ":$PATH:" in
  *":$prefix:"*) ;;
  *)
    echo
    echo "note: $prefix is not on your PATH. Add it:"
    echo "  fish:      fish_add_path $prefix"
    echo "  bash/zsh:  export PATH=\"$prefix:\$PATH\"   # add to your shell rc"
    ;;
esac
