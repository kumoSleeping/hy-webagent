#!/usr/bin/env bash
# Copy ~/.pi/agent extensions back into repo pi-extensions/ before push/deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
EXT_SRC="$AGENT_DIR/extensions"
EXT_DEST="$ROOT/pi-extensions/extensions"
PKG_SRC="$AGENT_DIR/packages"
PKG_DEST="$ROOT/pi-extensions/packages"

if [[ ! -d "$EXT_SRC" ]]; then
  echo "No local extensions at $EXT_SRC — nothing to sync." >&2
  exit 1
fi

mkdir -p "$EXT_DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$EXT_SRC/" "$EXT_DEST/"
else
  rm -rf "$EXT_DEST"
  cp -R "$EXT_SRC" "$EXT_DEST"
fi
echo "Synced extensions: $EXT_SRC → $EXT_DEST"

# If the bundled package was copied into ~/.pi/agent/packages, pull it back too.
if [[ -d "$PKG_SRC/pi-subagents-h" ]]; then
  mkdir -p "$PKG_DEST"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$PKG_SRC/pi-subagents-h/" "$PKG_DEST/pi-subagents-h/"
  else
    rm -rf "$PKG_DEST/pi-subagents-h"
    cp -R "$PKG_SRC/pi-subagents-h" "$PKG_DEST/pi-subagents-h"
  fi
  echo "Synced package: $PKG_SRC/pi-subagents-h → $PKG_DEST/pi-subagents-h"
fi
