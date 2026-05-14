#!/usr/bin/env bash
set -Eeuo pipefail

# GTLNAV safe production deploy.
#
# Security / safety properties:
# - hardcoded to origin/main only (no arbitrary refs, no user commands)
# - validates the repo remote before touching the working tree
# - uses a lock directory to prevent overlapping deployments
# - validates + builds in a staging clone first
# - only reloads PM2 after the live build succeeds
# - if the live working tree was updated and PM2 reload fails, rolls back to the
#   previous commit and rebuilds before exiting
#
# Deploy logs:
#   ~/deploy-logs/deploy-YYYY-MM-DD-HH-MM.log
#
# Successful footer:
#   ✅ GTLNAV deployment successful
#   commit: <sha>
#   time: <timestamp>

umask 077

readonly BRANCH="main"
readonly EXPECTED_REPO_REGEX='(^|[:/])godtechlabs/gtlnav-platform(\.git)?$'
readonly APP_DIR="${GTLNAV_DEPLOY_APP_DIR:-$HOME/gtlnav-platform}"
readonly LOG_DIR="${GTLNAV_DEPLOY_LOG_DIR:-$HOME/deploy-logs}"
readonly LOCK_DIR="${GTLNAV_DEPLOY_LOCK_DIR:-$HOME/.gtlnav-deploy.lock}"
readonly STAGE_BASE="${GTLNAV_DEPLOY_STAGE_BASE:-$HOME/.gtlnav-stage}"
readonly PM2_APP_NAME="${GTLNAV_PM2_APP_NAME:-gtlnav-app}"
readonly REDACTOR="${APP_DIR}/infra/production/redact-log-stream.mjs"
readonly TIMESTAMP="$(date -u '+%Y-%m-%d-%H-%M')"
readonly LOG_FILE="${LOG_DIR}/deploy-${TIMESTAMP}.log"

mkdir -p "$LOG_DIR" "$STAGE_BASE"

if command -v node >/dev/null 2>&1 && [[ -f "$REDACTOR" ]]; then
  exec > >(node "$REDACTOR" "${APP_DIR}/.env.local" | tee -a "$LOG_FILE") 2>&1
else
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

status() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

current_sha=""
target_sha=""
stage_dir=""
live_tree_modified=0

cleanup() {
  rm -rf "$LOCK_DIR" "$stage_dir"
}

rollback_live_tree() {
  if [[ -z "$current_sha" ]]; then
    status "rollback skipped: previous commit unknown"
    return 0
  fi

  status "rollback: resetting live tree to ${current_sha}"
  git -C "$APP_DIR" fetch --prune origin "$BRANCH"
  git -C "$APP_DIR" checkout --force "$BRANCH"
  git -C "$APP_DIR" reset --hard "$current_sha"

  status "rollback: reinstalling dependencies"
  (
    cd "$APP_DIR"
    npm ci
  )

  status "rollback: rebuilding previous release"
  (
    cd "$APP_DIR"
    npm run build
  )
}

on_error() {
  local exit_code=$?
  trap - ERR EXIT
  status "deployment failed (exit=${exit_code})"

  if [[ "$live_tree_modified" -eq 1 ]]; then
    status "attempting graceful rollback"
    rollback_live_tree || status "rollback failed; running app may still be serving the previous in-memory process"
    if command -v pm2 >/dev/null 2>&1; then
      pm2 restart "$PM2_APP_NAME" --update-env || true
    fi
  fi

  status "log file: ${LOG_FILE}"
  cleanup
  exit "$exit_code"
}

trap on_error ERR
trap cleanup EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  status "another deployment is already in progress"
  status "log file: ${LOG_FILE}"
  exit 75
fi

status "starting GTLNAV deployment"
status "webhook commit: ${GTLNAV_WEBHOOK_COMMIT_SHA:-unknown}"
status "webhook ref: ${GTLNAV_WEBHOOK_REF:-unknown}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  status "APP_DIR is not a git checkout: ${APP_DIR}"
  exit 1
fi

origin_url="$(git -C "$APP_DIR" remote get-url origin)"
shopt -s nocasematch
if [[ ! "$origin_url" =~ $EXPECTED_REPO_REGEX ]]; then
  status "origin remote is not the GTLNAV repository: ${origin_url}"
  exit 1
fi
shopt -u nocasematch

current_sha="$(git -C "$APP_DIR" rev-parse HEAD)"
status "current commit: ${current_sha}"
status "fetching origin/${BRANCH}"
git -C "$APP_DIR" fetch --prune origin "$BRANCH"
target_sha="$(git -C "$APP_DIR" rev-parse FETCH_HEAD)"
status "target commit: ${target_sha}"

stage_dir="${STAGE_BASE}/${TIMESTAMP}-$$"
status "validating release in staging clone: ${stage_dir}"
git clone --depth 1 --branch "$BRANCH" "$origin_url" "$stage_dir"

if [[ -f "${APP_DIR}/.env.local" ]]; then
  cp "${APP_DIR}/.env.local" "${stage_dir}/.env.local"
fi

(
  cd "$stage_dir"
  status "staging: npm ci"
  npm ci
  status "staging: npm run build"
  npm run build
)

status "staging validation succeeded"
status "updating live working tree"
git -C "$APP_DIR" checkout --force "$BRANCH"
git -C "$APP_DIR" reset --hard "$target_sha"
live_tree_modified=1

status "live: npm ci"
(
  cd "$APP_DIR"
  npm ci
)

status "live: npm run build"
(
  cd "$APP_DIR"
  npm run build
)

if ! command -v pm2 >/dev/null 2>&1; then
  status "pm2 is not installed or not on PATH"
  exit 1
fi

status "reloading PM2 process: ${PM2_APP_NAME}"
pm2 reload "$PM2_APP_NAME" --update-env
live_tree_modified=0
pm2 save >/dev/null || status "warning: pm2 save failed; the current process is still live"
status "deployment status: successful"
printf '✅ GTLNAV deployment successful\n'
printf 'commit: %s\n' "$target_sha"
printf 'time: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
