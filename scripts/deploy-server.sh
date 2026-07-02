#!/usr/bin/env bash
# Bootstrap HY-Webagent on Ubuntu (Node 22, PI CLI, systemd).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/hy-webagent}"
SERVICE_NAME="${SERVICE_NAME:-hy-webagent}"
PORT="${PORT:-3001}"

echo "==> Installing system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git python3 make g++ build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node: $(node -v) npm: $(npm -v)"

if ! command -v pi >/dev/null 2>&1; then
  echo "==> Installing PI CLI"
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
fi
echo "PI: $(pi --version 2>/dev/null || echo installed)"

mkdir -p "$APP_ROOT/data" "$APP_ROOT/workspaces" /root/.pi/agent

echo "==> Building application in $APP_ROOT"
cd "$APP_ROOT"
npm run install:all
cd server && npm run build
cd ../client && npx vite build

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=HY-Webagent (pi-web-platform)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_ROOT}/server
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=WORKSPACE_ROOT=${APP_ROOT}/workspaces
Environment=DATABASE_PATH=${APP_ROOT}/data/platform.db
Environment=PI_EXTENSIONS_ROOT=${APP_ROOT}/pi-extensions
Environment=CORS_ORIGIN=http://127.0.0.1:${PORT}
ExecStart=$(command -v node) dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

sleep 2
if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "==> Health check OK on port ${PORT}"
  curl -s "http://127.0.0.1:${PORT}/health"
  echo
else
  echo "==> Service started but health check failed — see: journalctl -u ${SERVICE_NAME} -n 50"
  journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
  exit 1
fi

echo "==> Deploy complete. Service: systemctl status ${SERVICE_NAME}"
