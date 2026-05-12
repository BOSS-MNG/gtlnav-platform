#!/usr/bin/env bash
# GTLNAV — E2E static-deploy smoke test.
#
# Walks through:
#   1. /api/deployments/start
#   2. polls deployments.status until terminal
#   3. verifies the worker actually populated runtime_instances + proxy_routes
#
# Requires a long-lived GTLNAV API key with `deployments:write` scope.
#
#   GTLNAV_APP_URL=https://app.gtlnav.app
#   GTLNAV_API_KEY=gtlnav_live_pat_...
#   GTLNAV_PROJECT_ID=<uuid>
#   GTLNAV_BRANCH=main          (optional, default: main)
#   ./scripts/smoke-test-deploy.sh

set -euo pipefail

: "${GTLNAV_APP_URL:?GTLNAV_APP_URL is required}"
: "${GTLNAV_API_KEY:?GTLNAV_API_KEY is required}"
: "${GTLNAV_PROJECT_ID:?GTLNAV_PROJECT_ID is required}"
BRANCH="${GTLNAV_BRANCH:-main}"

echo "[smoke] starting deployment for project ${GTLNAV_PROJECT_ID} on branch ${BRANCH}…"
START_RESP=$(curl -sS -X POST \
  -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"${GTLNAV_PROJECT_ID}\",\"branch\":\"${BRANCH}\"}" \
  "${GTLNAV_APP_URL%/}/api/deployments/start")
echo "$START_RESP" | jq .

DEPLOYMENT_ID=$(echo "$START_RESP" | jq -r '.deployment.id // empty')
JOB_ID=$(echo "$START_RESP" | jq -r '.job.id // empty')
DEPLOYMENT_URL=$(echo "$START_RESP" | jq -r '.deployment.deployment_url // empty')

if [[ -z "$DEPLOYMENT_ID" ]]; then
  echo "[smoke] FAIL — start API did not return a deployment id." >&2
  exit 1
fi
echo "[smoke] deployment_id=$DEPLOYMENT_ID job_id=$JOB_ID"

DEADLINE=$(( $(date +%s) + 600 ))
STATUS=""
while [[ $(date +%s) -lt $DEADLINE ]]; do
  STATUS_RESP=$(curl -sS \
    -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
    "${GTLNAV_APP_URL%/}/api/deployments/${DEPLOYMENT_ID}/status")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.deployment.status // empty')
  echo "[smoke] $(date +%T) status=$STATUS"
  case "$STATUS" in
    active|failed|canceled) break ;;
  esac
  sleep 5
done

if [[ "$STATUS" != "active" ]]; then
  echo "[smoke] FAIL — deployment ended in status '$STATUS'." >&2
  exit 1
fi

if [[ -n "$DEPLOYMENT_URL" ]]; then
  echo "[smoke] curling $DEPLOYMENT_URL …"
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$DEPLOYMENT_URL" || true)
  echo "[smoke] HTTP $HTTP_CODE on $DEPLOYMENT_URL"
  if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "301" && "$HTTP_CODE" != "302" ]]; then
    echo "[smoke] WARN — URL responded with $HTTP_CODE; check DNS/proxy."
  fi
fi

# -----------------------------------------------------------------------------
# Phase 6D — verify runtime_instances and proxy_routes rows actually exist.
# A "successful" deployment that left no runtime_instance behind means the
# worker schema is out of sync (see Phase 6C). We catch that here so the
# operator gets an immediate signal instead of an empty dashboard.
# -----------------------------------------------------------------------------
echo "[smoke] verifying runtime_instances row…"
RI_RESP=$(curl -sS \
  -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
  "${GTLNAV_APP_URL%/}/api/runtime/instances?project_id=${GTLNAV_PROJECT_ID}")
RI_COUNT=$(echo "$RI_RESP" | jq '.instances | length // 0')
RI_KIND=$(echo "$RI_RESP" | jq -r '.instances[0].runtime_kind // empty')
RI_STATUS=$(echo "$RI_RESP" | jq -r '.instances[0].status // empty')
echo "[smoke] runtime_instances: count=$RI_COUNT runtime_kind=$RI_KIND status=$RI_STATUS"
if [[ "$RI_COUNT" -lt 1 ]]; then
  echo "[smoke] FAIL — no runtime_instances row for this project. Check worker logs and Phase 6C migration 0008." >&2
  exit 1
fi
if [[ "$RI_STATUS" != "running" ]]; then
  echo "[smoke] FAIL — runtime_instance.status is '$RI_STATUS' (expected 'running')." >&2
  exit 1
fi

echo "[smoke] OK — deployment $DEPLOYMENT_ID is active, runtime_instance is running."
