#!/usr/bin/env bash
# ============================================================
# HY-Webagent self-update — build-gated, health-gated, auto-rollback
# ============================================================
#
# Design constraints this script exists to satisfy:
#
#   1. A failed BUILD must never take the service down. We therefore build the
#      new commit to completion *before* touching the running service, and keep
#      the previous dist/ so a half-written tsc output can be restored.
#
#   2. A failed HEALTH CHECK must not leave the new (broken) commit deployed.
#      The old update script exited 1 here and walked away, leaving production
#      on a commit that had just been observed to be unhealthy.
#
#   3. Two updates must never interleave. flock, not a pid file.
#
#   4. The service restart kills our parent (the Node process invokes this
#      script). Callers must launch it detached — server/src/ops/updater.ts uses
#      setsid — or the update dies halfway through, mid-restart.
#
# Exit codes:  0 ok / already current   1 failed+rolled back   2 failed+DIRTY
#
# Status for the API lives in $STATUS_FILE and is written at each phase, so a
# crashed run is still diagnosable from outside.

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/hy-webagent}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3001}"
SERVICE_NAME="${SERVICE_NAME:-hy-webagent}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
DATA_DIR="${DATA_DIR:-${APP_ROOT}/data}"
STATUS_FILE="${STATUS_FILE:-${DATA_DIR}/update-status.json}"
LOCK_FILE="${LOCK_FILE:-${DATA_DIR}/update.lock}"
LOG_FILE="${LOG_FILE:-${DATA_DIR}/logs/self-update.log}"
BACKUP_DIR="${BACKUP_DIR:-${DATA_DIR}/update-backup}"
DRY_RUN="${DRY_RUN:-0}"

mkdir -p "$DATA_DIR" "$(dirname "$LOG_FILE")"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" >&2
}

# JSON-escape a string (status file is machine-read by the API).
json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$//g' | tr -d '\n')"
}

write_status() {
  local phase="$1" ok="$2" message="$3"
  local tmp="${STATUS_FILE}.tmp"
  cat > "$tmp" <<EOF
{
  "phase": $(json_escape "$phase"),
  "ok": ${ok},
  "message": $(json_escape "$message"),
  "fromCommit": $(json_escape "${PREV_COMMIT:-}"),
  "toCommit": $(json_escape "${TARGET_COMMIT:-}"),
  "branch": $(json_escape "$BRANCH"),
  "updatedAt": $(json_escape "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "pid": ${$}
}
EOF
  # Atomic replace so a reader never observes a half-written file.
  mv -f "$tmp" "$STATUS_FILE"
}

fail() {
  local message="$1" code="${2:-1}"
  log "FAILED: $message"
  write_status "failed" false "$message"
  exit "$code"
}

# ---- single-writer lock -------------------------------------------------
# flock(1) is util-linux and absent on macOS/BSD, so fall back to an atomic
# mkdir. Distinguishing "lock held" from "locking is broken" matters: treating a
# missing flock as a held lock would silently turn every update into a no-op.
LOCK_DIR="${LOCK_FILE}.d"
release_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "another update is already running — aborting"
    exit 0
  fi
else
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Reap a lock orphaned by a killed run rather than wedging updates forever.
    if [[ -f "$LOCK_DIR/pid" ]] && ! kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
      log "clearing stale lock from a dead process"
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null || { log "another update is already running — aborting"; exit 0; }
    else
      log "another update is already running — aborting"
      exit 0
    fi
  fi
  printf '%s' "$$" > "$LOCK_DIR/pid"
  trap release_lock EXIT
fi

cd "$APP_ROOT" || fail "APP_ROOT $APP_ROOT is not accessible"
git config --global --add safe.directory "$APP_ROOT" 2>/dev/null || true

PREV_COMMIT="$(git rev-parse HEAD)"
log "current commit: $PREV_COMMIT"

# Lockfile churn is machine-generated, not human work: `npm install` rewrites
# package-lock.json on the deploy host, which would otherwise leave the tree
# permanently dirty and make every future auto-update refuse to run. Discard
# just those, loudly, before judging the tree.
for lock in package-lock.json server/package-lock.json client/package-lock.json; do
  if [[ -f "$lock" ]] && ! git diff --quiet -- "$lock"; then
    log "discarding build-generated churn in $lock"
    git checkout -- "$lock" 2>/dev/null || true
  fi
done

# Refuse to clobber genuine uncommitted work — that is a human's in-progress change.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "dirty paths:"; git status --short | head -20 | tee -a "$LOG_FILE" >&2
  fail "working tree is dirty — refusing to auto-update" 2
fi

write_status "fetching" true "fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH" || fail "git fetch failed"
TARGET_COMMIT="$(git rev-parse "origin/${BRANCH}")"

if [[ "$PREV_COMMIT" == "$TARGET_COMMIT" ]]; then
  log "already up to date at $PREV_COMMIT"
  write_status "idle" true "already up to date"
  exit 0
fi

log "target commit: $TARGET_COMMIT"
if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN=1 — update available, stopping before checkout"
  write_status "available" true "update available: $PREV_COMMIT -> $TARGET_COMMIT"
  exit 0
fi

# ---- back up the artefacts we are about to overwrite --------------------
# tsc writes into dist/ in place, so a failed build leaves a mix of old and new
# output. Restoring source alone would not be enough.
write_status "backup" true "backing up current build artefacts"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
[[ -d server/dist ]] && cp -a server/dist "$BACKUP_DIR/server-dist"
[[ -d client/dist ]] && cp -a client/dist "$BACKUP_DIR/client-dist"
log "backup written to $BACKUP_DIR"

restore_previous() {
  log "rolling back to $PREV_COMMIT"
  git reset --hard --quiet "$PREV_COMMIT" || log "WARN: git reset failed during rollback"
  if [[ -d "$BACKUP_DIR/server-dist" ]]; then
    rm -rf server/dist && cp -a "$BACKUP_DIR/server-dist" server/dist
  fi
  if [[ -d "$BACKUP_DIR/client-dist" ]]; then
    rm -rf client/dist && cp -a "$BACKUP_DIR/client-dist" client/dist
  fi
}

# ---- check out and build (service still running on the old build) -------
write_status "building" true "building $TARGET_COMMIT"
git checkout --quiet -B "$BRANCH" "$TARGET_COMMIT" || {
  restore_previous
  fail "git checkout failed — rolled back"
}

build_failed=0
{
  # `npm ci`, not `npm install`: it installs exactly the committed lockfile and
  # does not rewrite it, so a deploy cannot leave the tree dirty (which would
  # block every subsequent auto-update). Falls back to install if the lockfile
  # and manifest have drifted, since `ci` refuses outright in that case.
  install_deps() {
    for dir in server client; do
      (cd "$dir" && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund)) || return 1
    done
  }
  install_deps \
    && (cd server && npm run build) \
    && (cd client && npm run build)
} >>"$LOG_FILE" 2>&1 || build_failed=1

if [[ "$build_failed" == "1" ]]; then
  restore_previous
  # The running process still holds the old code in memory and the restored
  # dist matches it, so no restart is needed — and not restarting is strictly
  # safer than restarting into a tree we just failed to build.
  fail "build failed — rolled back to $PREV_COMMIT, service untouched"
fi
log "build succeeded"

# ---- restart and health-gate -------------------------------------------
write_status "restarting" true "restarting $SERVICE_NAME"
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$SERVICE_NAME" || {
    restore_previous
    systemctl restart "$SERVICE_NAME" || true
    fail "restart failed — rolled back to $PREV_COMMIT"
  }
else
  log "WARN: systemctl unavailable — skipping restart (caller must restart)"
fi

write_status "verifying" true "waiting for health at $HEALTH_URL"
healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" != "1" ]]; then
  log "health check did not pass within ${HEALTH_TIMEOUT}s"
  restore_previous
  write_status "rolling-back" false "health check failed — rebuilding $PREV_COMMIT"
  # The restored dist matches PREV_COMMIT, so a rebuild is not strictly needed;
  # restart straight onto the known-good artefacts to minimise downtime.
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$SERVICE_NAME" || true
  fi

  rollback_ok=0
  for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
    if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      rollback_ok=1
      break
    fi
    sleep 1
  done

  if [[ "$rollback_ok" == "1" ]]; then
    fail "update unhealthy — rolled back to $PREV_COMMIT (service healthy)" 1
  fi
  # Rolled back but still unhealthy: the failure predates this update. Say so
  # loudly rather than implying the rollback fixed it.
  fail "update unhealthy AND rollback unhealthy — service is DOWN at $PREV_COMMIT" 2
fi

log "update complete: $PREV_COMMIT -> $TARGET_COMMIT"
write_status "idle" true "updated to $TARGET_COMMIT"
rm -rf "$BACKUP_DIR"
exit 0
