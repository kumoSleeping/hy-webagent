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
# 锁文件安装期漂移会卡住 pull(同 a0b485d 对 self-update 的修复)—— 先丢弃。
git checkout -- package-lock.json server/package-lock.json client/package-lock.json 2>/dev/null || true
git pull origin main
echo "==> route Sorux through PI built-in xAI provider"
node scripts/migrate-sorux-provider-to-xai.mjs /root/.pi/agent
for agent_dir in /opt/hy-webagent/workspaces/*/.pi/agent; do
  [[ -d "\$agent_dir" ]] || continue
  node scripts/migrate-sorux-provider-to-xai.mjs "\$agent_dir"
done
echo "==> install deps"
npm run install:all
echo "==> update host PI runtime"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!(major > 22 || (major === 22 && minor >= 19))) throw new Error("Codex extension requires Node.js 22.19+")'
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.82.1
echo "==> ensure host managed PI packages"
mkdir -p /root/.pi/agent/npm
cd /root/.pi/agent/npm
if [[ ! -f package.json ]]; then
  printf '%s\n' '{"name":"pi-extensions","private":true}' > package.json
fi
npm install pi-subagents@^0.35.1 @howaboua/pi-codex-conversion@2.2.19
cd ${APP_ROOT}
ls /root/.pi/agent/npm/node_modules/pi-subagents/package.json
ls /root/.pi/agent/npm/node_modules/@howaboua/pi-codex-conversion/package.json
echo "==> build server"
cd ${APP_ROOT}/server && npm run build
echo "==> build client"
cd ${APP_ROOT}/client && npm run build
echo "==> migrate user agent packages"
node <<'NODE'
const fs = require("fs");
const path = require("path");
const root = "/opt/hy-webagent/workspaces";
const marker = "pi-subagents-h";
const wanted = ["npm:pi-subagents", "npm:@howaboua/pi-codex-conversion@2.2.19"];
const settingsPaths = [
  "/root/.pi/agent/settings.json",
  ...fs.readdirSync(root).map((name) => path.join(root, name, ".pi", "agent", "settings.json")),
];
for (const settingsPath of settingsPaths) {
  if (!fs.existsSync(settingsPath)) continue;
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { continue; }
  const packages = Array.isArray(settings.packages) ? settings.packages.filter((p) => !String(p).includes(marker)) : [];
  for (const want of wanted) if (!packages.includes(want)) packages.push(want);
  settings.packages = packages;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  // seed npm tree from host
  const src = "/root/.pi/agent/npm";
  const dest = path.join(path.dirname(settingsPath), "npm");
  if (dest !== src && fs.existsSync(path.join(src, "node_modules", "pi-subagents"))) {
    let linked = false;
    try {
      linked = fs.lstatSync(dest).isSymbolicLink() && path.resolve(path.dirname(dest), fs.readlinkSync(dest)) === src;
    } catch {}
    if (!linked) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.symlinkSync(src, dest, "dir");
    }
  }
  console.log("updated", settingsPath);
}
NODE
echo "==> restart ${SERVICE}"
mkdir -p /etc/systemd/system/${SERVICE}.service.d
cat > /etc/systemd/system/${SERVICE}.service.d/environment.conf <<'UNIT'
[Service]
EnvironmentFile=-/etc/hy-webagent.env
UNIT
systemctl daemon-reload
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
