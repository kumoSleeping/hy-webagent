#!/usr/bin/env bash
# Sync repo-bundled PI extensions into ~/.pi/agent for local PI CLI usage.
# Syncs package settings; npm package installation remains managed by `pi install`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
EXT_SRC="$ROOT/pi-extensions/extensions"
SETTINGS="$AGENT_DIR/settings.json"

mkdir -p "$AGENT_DIR/extensions"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$EXT_SRC/" "$AGENT_DIR/extensions/"
else
  rm -rf "$AGENT_DIR/extensions"
  cp -R "$EXT_SRC" "$AGENT_DIR/extensions"
fi

python3 - "$SETTINGS" <<'PY'
import json, sys
from pathlib import Path

settings_path = Path(sys.argv[1])
settings = {}
if settings_path.exists():
    settings = json.loads(settings_path.read_text())
packages = [p for p in (settings.get("packages") or []) if "pi-subagents-h" not in str(p)]
for spec in ["npm:pi-subagents", "npm:@howaboua/pi-codex-conversion@2.2.19"]:
    if spec not in packages:
        packages.append(spec)
settings["packages"] = packages
settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
PY

echo "Synced extensions → $AGENT_DIR/extensions"
echo "Ensured managed npm package specs in $SETTINGS"
