#!/usr/bin/env bash
# GTLNAV — prune old static deployment artifacts.
#
# Each project under $DEPLOYMENTS_ROOT keeps:
#   <project-slug>/current     symlink to the live artifact
#   <project-slug>/<deployment-id-1>/   most recent
#   <project-slug>/<deployment-id-2>/
#   …
#
# This script keeps the N most-recent artifact directories per project
# (default: 5) and deletes the rest. The directory the `current` symlink
# points at is ALWAYS kept regardless of N.
#
# Idempotent. Safe to run from cron / systemd timer.
#
#   sudo bash infra/cleanup/prune-deployments.sh
#   # or:
#   DEPLOYMENTS_ROOT=/var/gtlnav/deployments KEEP=10 bash prune-deployments.sh

set -euo pipefail

ROOT="${DEPLOYMENTS_ROOT:-/var/gtlnav/deployments}"
KEEP="${KEEP:-5}"

if [[ ! -d "$ROOT" ]]; then
  echo "[gtlnav] DEPLOYMENTS_ROOT does not exist: $ROOT" >&2
  exit 1
fi

TOTAL_DELETED=0
for project_dir in "$ROOT"/*/; do
  [[ -d "$project_dir" ]] || continue
  project="$(basename "$project_dir")"

  current_target=""
  if [[ -L "$project_dir/current" ]]; then
    current_target="$(readlink -f "$project_dir/current" || true)"
  fi

  # Newest first by mtime; skip the `current` symlink itself.
  mapfile -t artifacts < <(
    find "$project_dir" -mindepth 1 -maxdepth 1 -type d -not -name current \
      -printf '%T@ %p\n' \
      | sort -rn \
      | awk '{ $1=""; sub(/^ /, ""); print }'
  )

  kept=0
  for art in "${artifacts[@]}"; do
    abs="$(readlink -f "$art")"
    # Always keep whatever `current` points to.
    if [[ -n "$current_target" && "$abs" == "$current_target" ]]; then
      kept=$((kept + 1))
      continue
    fi
    if (( kept < KEEP )); then
      kept=$((kept + 1))
      continue
    fi
    echo "[gtlnav] $project: pruning $art"
    rm -rf -- "$art"
    TOTAL_DELETED=$((TOTAL_DELETED + 1))
  done
done

echo "[gtlnav] Pruned $TOTAL_DELETED artifact directory(s). Kept newest $KEEP per project (plus 'current')."
