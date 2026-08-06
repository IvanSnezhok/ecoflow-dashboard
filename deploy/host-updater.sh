#!/usr/bin/env bash
# Host-side updater for containerised deployments.
#
# The dashboard runs inside Docker and cannot rebuild or restart itself. Instead it
# drops server/data/update-request.json into the shared volume; ecoflow-updater.path
# notices the file and runs this script, which owns the git worktree, the toolchain
# and docker. The container never needs docker.sock, sudo or push credentials.
#
# Progress is reported back through server/data/update-status.json, which the
# dashboard reads — including after this script replaces the container mid-run.

set -euo pipefail

PROJECT_ROOT="${ECOFLOW_PROJECT_ROOT:-/mnt/data/services/ecoflow_dashboard}"
DATA_DIR="$PROJECT_ROOT/server/data"
REQUEST_FILE="$DATA_DIR/update-request.json"
STATUS_FILE="$DATA_DIR/update-status.json"
VERSION_FILE="$DATA_DIR/version.json"
LOG_FILE="$DATA_DIR/update.log"
BRANCH_DEFAULT="main"

mkdir -p "$DATA_DIR"
exec >> "$LOG_FILE" 2>&1
echo "=== $(date -Is) host updater started ==="

STARTED_AT="$(date -Is)"
TARGET_COMMIT=""

status() {
  local step="$1" progress="$2" message="$3" error="${4:-}"
  local completed=""
  case "$step" in completed|failed) completed="$(date -Is)" ;; esac

  # Write atomically: the dashboard polls this file once a second.
  python3 - "$STATUS_FILE" "$step" "$progress" "$message" "$error" "$STARTED_AT" "$completed" "$TARGET_COMMIT" <<'PY'
import json, os, sys
path, step, progress, message, error, started, completed, target = sys.argv[1:9]
payload = {"step": step, "progress": int(progress), "message": message, "startedAt": started}
if error: payload["error"] = error
if completed: payload["completedAt"] = completed
if target: payload["targetCommit"] = target[:7]
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(payload, fh)
os.replace(tmp, path)
PY
  echo "$(date -Is) [$step] $message${error:+ — $error}"
}

fail() {
  status failed 0 "Update failed; inspect server/data/update.log" "$1"
  rm -f "$REQUEST_FILE"
  exit 1
}
trap 'fail "Updater aborted at line $LINENO"' ERR

BRANCH="$BRANCH_DEFAULT"
if [[ -f "$REQUEST_FILE" ]]; then
  BRANCH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("branch") or "main")' "$REQUEST_FILE" 2>/dev/null || echo "$BRANCH_DEFAULT")"
fi
# Consume the request immediately so a crash cannot leave a retry loop behind.
rm -f "$REQUEST_FILE"

cd "$PROJECT_ROOT"

# Refuse to touch a worktree that still tracks the telemetry database: `git reset
# --hard` would delete tens of gigabytes of history that is not in the repository.
if git ls-files --error-unmatch server/data/ecoflow.db >/dev/null 2>&1; then
  fail "server/data/ecoflow.db is tracked by git; reset --hard would destroy it. Run: git rm --cached server/data/ecoflow.db*"
fi

status fetching 5 "Fetching latest changes from GitHub..."
git fetch --prune origin "$BRANCH"

TARGET_COMMIT="$(git rev-parse "origin/$BRANCH")"
status fetching 10 "Target revision ${TARGET_COMMIT:0:7}"

status resetting 20 "Applying verified GitHub revision..."
git reset --hard "$TARGET_COMMIT"

status installing_root 35 "Installing locked frontend dependencies..."
npm ci

status installing_server 50 "Installing locked server dependencies..."
npm ci --prefix server

status building_frontend 65 "Building frontend..."
npm run build

status building_backend 80 "Building backend..."
npm run build:backend

# Stamp the revision so the container — which has no .git — can report its version.
python3 - "$VERSION_FILE" "$TARGET_COMMIT" "$(git config --get remote.origin.url)" <<'PY'
import json, os, sys
from datetime import datetime, timezone
path, commit, remote = sys.argv[1:4]
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump({"commit": commit, "remote": remote, "builtAt": datetime.now(timezone.utc).isoformat()}, fh)
os.replace(tmp, path)
PY

status restarting 90 "Rebuilding image and restarting container..."
docker compose build
# Written before the restart: the container that reads it next is the new one.
status completed 100 "Updated to ${TARGET_COMMIT:0:7}"
docker compose up -d --remove-orphans

echo "=== $(date -Is) host updater finished ==="
