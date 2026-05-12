#!/usr/bin/env bash
# GTLNAV — prune dangling Docker artifacts.
#
# Targets only containers + images labelled `gtlnav=1` so this script can
# coexist with other workloads on the same host. We DO NOT call
# `docker system prune --all` (too aggressive).
#
# Removes:
#   - stopped containers tagged gtlnav=1 (the worker uses --rm but a crash
#     during boot can leave a corpse behind)
#   - dangling images (untagged layers) tagged gtlnav=1
#   - build cache older than $BUILD_CACHE_AGE (default: 168h, i.e. 7 days)
#
# Idempotent. Safe to run from cron / systemd timer.
#
#   sudo bash infra/cleanup/prune-docker.sh

set -euo pipefail

BUILD_CACHE_AGE="${BUILD_CACHE_AGE:-168h}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[gtlnav] docker not installed; skipping prune." >&2
  exit 0
fi

echo "[gtlnav] Removing stopped gtlnav containers…"
docker ps -aq --filter "label=gtlnav=1" --filter "status=exited" --filter "status=dead" \
  | xargs -r docker rm -f || true

echo "[gtlnav] Removing dangling gtlnav images…"
docker images -q --filter "label=gtlnav=1" --filter "dangling=true" \
  | xargs -r docker rmi -f || true

echo "[gtlnav] Pruning build cache older than $BUILD_CACHE_AGE…"
docker builder prune --force --filter "until=$BUILD_CACHE_AGE" --filter "type=regular" || true

echo "[gtlnav] Done."
