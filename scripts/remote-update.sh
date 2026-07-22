#!/usr/bin/env bash
# Pull latest main on production, rebuild, restart hy-webagent.
set -euo pipefail

DEPLOY_ENV="${HY_WEBAGENT_DEPLOY_ENV:-$HOME/.config/hy-webagent/deploy.env}"
if [[ -f "$DEPLOY_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV"
fi

: "${HY_WEBAGENT_SSH_PASSWORD:?Set HY_WEBAGENT_SSH_PASSWORD or create $DEPLOY_ENV}"

HOST="${HY_WEBAGENT_SSH_HOST:-ssh-ykhm.kumo.ltd}"
USER="${HY_WEBAGENT_SSH_USER:-root}"
APP_ROOT="${HY_WEBAGENT_APP_ROOT:-/opt/hy-webagent}"
SERVICE="${HY_WEBAGENT_SERVICE:-hy-webagent}"
PORT="${HY_WEBAGENT_PORT:-3002}"

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED="$(command -v cloudflared)"
elif [[ -x /opt/homebrew/bin/cloudflared ]]; then
  CLOUDFLARED=/opt/homebrew/bin/cloudflared
else
  echo "cloudflared not found" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "sshpass not found (brew install sshpass / apt install sshpass)" >&2
  exit 1
fi

REMOTE=$(cat <<EOF
set -e
cd ${APP_ROOT}
echo "==> git pull"
git pull origin main
echo "==> install deps"
npm run install:all
echo "==> ensure host npm:pi-subagents"
mkdir -p /root/.pi/agent/npm
if [[ ! -d /root/.pi/agent/npm/node_modules/pi-subagents ]]; then
  if command -v pi >/dev/null 2>&1; then
    (cd /root && PI_AGENT_DIR=/root/.pi/agent pi install npm:pi-subagents) || true
  fi
fi
if [[ ! -d /root/.pi/agent/npm/node_modules/pi-subagents ]]; then
  cd /root/.pi/agent/npm
  if [[ ! -f package.json ]]; then
    printf '%s\n' '{"name":"pi-extensions","private":true,"dependencies":{"pi-subagents":"^0.35.1"}}' > package.json
  fi
  npm install pi-subagents@^0.35.1
  cd ${APP_ROOT}
fi
ls /root/.pi/agent/npm/node_modules/pi-subagents/package.json
echo "==> build server"
cd ${APP_ROOT}/server && npm run build
echo "==> build client"
cd ${APP_ROOT}/client && npm run build
echo "==> migrate user agent packages (npm:pi-subagents)"
node <<'NODE'
const fs = require("fs");
const path = require("path");
const root = "/opt/hy-webagent/workspaces";
const marker = "pi-subagents-h";
const want = "npm:pi-subagents";
for (const name of fs.readdirSync(root)) {
  const settingsPath = path.join(root, name, ".pi", "agent", "settings.json");
  if (!fs.existsSync(settingsPath)) continue;
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { continue; }
  const packages = Array.isArray(settings.packages) ? settings.packages.filter((p) => !String(p).includes(marker)) : [];
  if (!packages.includes(want)) packages.push(want);
  settings.packages = packages;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  // seed npm tree from host
  const src = "/root/.pi/agent/npm";
  const dest = path.join(root, name, ".pi", "agent", "npm");
  if (fs.existsSync(path.join(src, "node_modules", "pi-subagents"))) {
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
  console.log("updated", name);
}
NODE
echo "==> ensure NODE_OPTIONS ipv4first for SoruxGPT/CF"
mkdir -p /etc/systemd/system/${SERVICE}.service.d
cat > /etc/systemd/system/${SERVICE}.service.d/override.conf <<'UNIT'
[Service]
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
UNIT
systemctl daemon-reload
echo "==> restart ${SERVICE}"
systemctl restart ${SERVICE}
sleep 2
echo "==> health"
curl -sf http://127.0.0.1:${PORT}/health
echo
echo "==> deployed commit"
git log -1 --oneline
echo "==> service"
systemctl status ${SERVICE} --no-pager -l | head -15
EOF
)

sshpass -p "$HY_WEBAGENT_SSH_PASSWORD" ssh \
  -o "ProxyCommand=${CLOUDFLARED} access ssh --hostname %h" \
  -o StrictHostKeyChecking=accept-new \
  -o PreferredAuthentications=keyboard-interactive,password \
  -o PubkeyAuthentication=no \
  "${USER}@${HOST}" \
  "$REMOTE"
