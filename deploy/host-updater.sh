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
# A copy without the message and error texts goes to deploy/gateway/status.json for
# the gateway's placeholder page (deploy/gateway/updating.html), which visitors see
# instead of a 502 while the container is being replaced.

set -euo pipefail

PROJECT_ROOT="${ECOFLOW_PROJECT_ROOT:-/mnt/data/services/ecoflow_dashboard}"
DATA_DIR="$PROJECT_ROOT/server/data"
REQUEST_FILE="$DATA_DIR/update-request.json"
STATUS_FILE="$DATA_DIR/update-status.json"
VERSION_FILE="$DATA_DIR/version.json"
LOG_FILE="$DATA_DIR/update.log"
PUBLIC_STATUS_FILE="$PROJECT_ROOT/deploy/gateway/status.json"
HEALTH_URL="http://127.0.0.1:${ECOFLOW_PORT:-3001}/api/health"
HEALTH_WAIT_S=180
BRANCH_DEFAULT="main"

mkdir -p "$DATA_DIR"
exec >> "$LOG_FILE" 2>&1
echo "=== $(date -Is) host updater started ==="

STARTED_AT="$(date -Is)"
TARGET_COMMIT=""
CURRENT_STEP=""

status() {
  local step="$1" progress="$2" message="$3" error="${4:-}"
  local completed=""
  case "$step" in completed|failed) completed="$(date -Is)" ;; esac
  local failed_step=""
  if [[ "$step" == failed ]]; then failed_step="$CURRENT_STEP"; else CURRENT_STEP="$step"; fi

  # Write atomically: the dashboard polls this file once a second.
  python3 - "$STATUS_FILE" "$step" "$progress" "$message" "$error" "$STARTED_AT" "$completed" "$TARGET_COMMIT" "$PUBLIC_STATUS_FILE" "$failed_step" <<'PY'
import json, os, sys
from datetime import datetime, timezone
path, step, progress, message, error, started, completed, target, public_path, failed_step = sys.argv[1:11]
payload = {"step": step, "progress": int(progress), "message": message, "startedAt": started}
if error: payload["error"] = error
if completed: payload["completedAt"] = completed
if target: payload["targetCommit"] = target[:7]

def write(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(payload, fh)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)

write(path, payload)

# The placeholder page is served without a sign-in: no message or error text in it.
public = {k: payload[k] for k in ("step", "progress", "startedAt", "completedAt", "targetCommit") if k in payload}
public["updatedAt"] = datetime.now(timezone.utc).isoformat()
if failed_step: public["failedStep"] = failed_step
try:
    write(public_path, public)
except OSError as exc:
    print(f"placeholder status not written: {exc}")
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

status restarting 85 "Rebuilding image..."
docker compose build

# From here to the health check the panel does not answer; the gateway shows the
# placeholder page with these stages.
status restarting 90 "Replacing container..."
docker compose up -d --remove-orphans
# The gateway reads its config from a mounted directory: pick up a changed one
docker compose exec -T gateway nginx -s reload || echo "gateway not reloaded"

status starting 95 "Starting the panel..."
panel_answers() {
  python3 - "$HEALTH_URL" <<'PY'
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=3) as response:
        sys.exit(0 if response.status == 200 else 1)
except Exception:
    sys.exit(1)
PY
}
deadline=$(( $(date +%s) + HEALTH_WAIT_S ))
until panel_answers; do
  if (( $(date +%s) >= deadline )); then
    fail "The new container did not answer $HEALTH_URL within ${HEALTH_WAIT_S}s. Check: docker logs ecoflow-dashboard"
  fi
  sleep 2
done

status completed 100 "Updated to ${TARGET_COMMIT:0:7}"

echo "=== $(date -Is) host updater finished ==="
