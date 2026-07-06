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
echo "==> build server"
cd server && npm run build
echo "==> build client"
cd ../client && npm run build
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
