#!/usr/bin/env bash
# Pull latest from GitHub, rebuild, and restart HY-Webagent (production server).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/hy-webagent}"
REPO_URL="${REPO_URL:-https://github.com/kumoSleeping/hy-webagent.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3002}"
SERVICE_NAME="${SERVICE_NAME:-hy-webagent}"

cd "$APP_ROOT"

if [ ! -d .git ]; then
  echo "==> Initializing git in $APP_ROOT"
  git init
  git remote add origin "$REPO_URL"
fi

echo "==> Fetching $BRANCH from origin"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

echo "==> Installing dependencies"
npm run install:all

echo "==> Building server + client"
cd server && npm run build
cd ../client && npx vite build
cd ..

echo "==> Restarting $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2

if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "==> Health OK on port $PORT"
  curl -s "http://127.0.0.1:${PORT}/health"
  echo
else
  echo "==> Health check failed — see: journalctl -u $SERVICE_NAME -n 50"
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager || true
  exit 1
fi

echo "==> Update complete ($(git rev-parse --short HEAD))"
