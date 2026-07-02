#!/usr/bin/env bash
# Sync repo-bundled PI extensions into ~/.pi/agent for local PI CLI usage.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
EXT_SRC="$ROOT/pi-extensions/extensions"
PKG_SRC="$ROOT/pi-extensions/packages/pi-subagents-h"
SETTINGS="$AGENT_DIR/settings.json"

mkdir -p "$AGENT_DIR/extensions"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$EXT_SRC/" "$AGENT_DIR/extensions/"
else
  rm -rf "$AGENT_DIR/extensions"
  cp -R "$EXT_SRC" "$AGENT_DIR/extensions"
fi

PKG_ABS="$(cd "$PKG_SRC" && pwd)"

python3 - "$SETTINGS" "$PKG_ABS" <<'PY'
import json, sys
from pathlib import Path

settings_path, pkg_abs = sys.argv[1], sys.argv[2]
path = Path(settings_path)
settings = {}
if path.exists():
    settings = json.loads(path.read_text())
packages = list(settings.get("packages") or [])
if pkg_abs not in packages:
    packages.append(pkg_abs)
settings["packages"] = packages
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(settings, indent=2) + "\n")
PY

echo "Synced extensions → $AGENT_DIR/extensions"
echo "Registered package → $PKG_ABS in $SETTINGS"
