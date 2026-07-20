---
name: hy-webagent-deploy
description: >-
  Push hy-webagent (pi-web-platform) to GitHub and update production on
  ssh-ykhm.kumo.ltd via Cloudflare Access SSH. Use when the user asks to
  deploy, push to GitHub and pull on server, remote update, or check
  hy-webagent processes on Kumo production.
---

# HY-Webagent — GitHub push + production update

Production chat: `https://chat.kumo.ltd`  
Repo: `git@github.com:kumoSleeping/hy-webagent.git`  
Server app dir: `/opt/hy-webagent`  
Service: `hy-webagent.service` (port **3002**)

## Credentials (never commit)

SSH uses Cloudflare Access + root password. Read from env or a local file **outside git**:

```bash
# ~/.config/hy-webagent/deploy.env (chmod 600)
export HY_WEBAGENT_SSH_HOST=ssh-ykhm.kumo.ltd
export HY_WEBAGENT_SSH_USER=root
export HY_WEBAGENT_SSH_PASSWORD='…'
```

If the user pastes the password in chat for a one-off deploy, use it via `sshpass` but do **not** write it into tracked files.

Required local tools: `git`, `gh` (optional), `sshpass`, `cloudflared`.

## Workflow checklist

```
Deploy progress:
- [ ] 1. Review git status / diff
- [ ] 2. Sync local PI extensions into repo (`npm run sync:pi-from-local`) if you edited `~/.pi/agent`
- [ ] 3. Commit (only when user asked to push/deploy)
- [ ] 4. git push origin main
- [ ] 5. Remote pull + build + restart
- [ ] 6. Verify health + processes
```

### 1–3. Local — sync extensions, commit, push

Only commit when the user explicitly requests push/deploy.

If you edited extensions via local PI CLI (`~/.pi/agent/extensions/`), pull them into the repo **before** commit so production gets them on `git pull`:

```bash
npm run sync:pi-from-local   # ~/.pi/agent/extensions → pi-extensions/extensions
git status pi-extensions/
```

Reverse direction for dev: `npm run sync:pi-local` (repo → `~/.pi/agent`).

```bash
cd /path/to/pi-web-platform   # or hy-webagent clone
git status
git diff --stat

git add …   # exclude scratch files like _subagent_test.txt
git commit -m "$(cat <<'EOF'
Short summary of why.

EOF
)"
git push origin main
```

Follow repo commit-message style from `git log -5`.

### 4. Remote — pull, build, restart

Prefer the bundled script (sources `deploy.env` if present):

```bash
./scripts/remote-update.sh
```

Or run SSH manually:

```bash
source "${HY_WEBAGENT_DEPLOY_ENV:-$HOME/.config/hy-webagent/deploy.env}"

sshpass -p "$HY_WEBAGENT_SSH_PASSWORD" ssh \
  -o ProxyCommand="/opt/homebrew/bin/cloudflared access ssh --hostname %h" \
  -o StrictHostKeyChecking=accept-new \
  -o PreferredAuthentications=keyboard-interactive,password \
  -o PubkeyAuthentication=no \
  "${HY_WEBAGENT_SSH_USER:-root}@${HY_WEBAGENT_SSH_HOST:-ssh-ykhm.kumo.ltd}" \
  'set -e
cd /opt/hy-webagent
git pull origin main
npm run install:all
cd server && npm run build
cd ../client && npm run build
systemctl restart hy-webagent
sleep 2
curl -sf http://127.0.0.1:3002/health
echo
git log -1 --oneline'
```

**SSH auth note:** `PreferredAuthentications=keyboard-interactive,password` is required; plain `password` alone often fails on this host.

On Linux dev machines, adjust cloudflared path (`which cloudflared`).

### 5. Verify

```bash
# Service + health
sshpass … ssh … 'systemctl status hy-webagent --no-pager -l | head -20'
sshpass … ssh … 'curl -s http://127.0.0.1:3002/health'

# Node / tunnel processes
sshpass … ssh … 'ps aux --sort=-%mem | awk "NR==1 || /node|cloudflared|llbot/ {print}" | head -15'

# Recent logs (ws invalid session after restart = users need refresh)
sshpass … ssh … 'journalctl -u hy-webagent -n 20 --no-pager'
```

Expected healthy output includes `Active: active (running)` and `{"ok":true,...}`.

## Server layout (reference)

| Item | Value |
|------|--------|
| WorkingDirectory | `/opt/hy-webagent/server` |
| ExecStart | `/usr/bin/node dist/index.js` |
| PORT | 3002 |
| WORKSPACE_ROOT | `/opt/hy-webagent/workspaces` |
| DATABASE_PATH | `/opt/hy-webagent/data/platform.db` |
| PI_EXTENSIONS_ROOT | `/opt/hy-webagent/pi-extensions` |
| CORS_ORIGIN | `https://chat.kumo.ltd` |
| Web UI static | `/opt/hy-webagent/client/dist` |

First-time bootstrap (empty VM): `scripts/deploy-server.sh` on the server.

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `Permission denied (publickey,keyboard-interactive)` | Add `PreferredAuthentications=keyboard-interactive,password`; disable pubkey auth for this hop |
| Health check fails after restart | `journalctl -u hy-webagent -n 50 --no-pager` |
| `ws upgrade rejected: invalid session` after deploy | Normal until clients refresh / re-login |
| Stale `pi-admin.ts` from Jul 2+ | `kill` orphaned PIDs if they linger (`ps aux \| grep pi-admin`) |

## Agent rules

- Do not commit unless the user asked to push/deploy.
- Do not store passwords in the repository.
- After deploy, report: commit hash, health check, service status, notable processes.
- After deploy (and other long tasks), also send a Bark push — see [bark-notify](../bark-notify/SKILL.md).
