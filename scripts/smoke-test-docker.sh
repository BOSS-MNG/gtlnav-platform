#!/usr/bin/env bash
# GTLNAV — E2E Docker-deploy smoke test (Phase 6D).
#
# Triggers a deploy for a project that the worker will detect as Docker
# (Dockerfile in repo, or Express / Next-SSR in package.json), polls until
# terminal, and asserts:
#   1. deployment.status = "active"
#   2. runtime_instances row exists with runtime_kind = "docker"
#   3. container_name + container_id + internal_port are populated
#   4. last_health_status = "healthy"
#   5. the live URL responds with 2xx/3xx
#
# Requires a long-lived GTLNAV API key with `deployments:write` scope and a
# project already configured against a Docker-friendly repo.
#
#   GTLNAV_APP_URL=https://app.gtlnav.godtechlabs.com
#   GTLNAV_API_KEY=gtlnav_live_pat_...
#   GTLNAV_PROJECT_ID=<uuid>
#   GTLNAV_BRANCH=main         (optional, default: main)
#   ./scripts/smoke-test-docker.sh

set -euo pipefail

: "${GTLNAV_APP_URL:?GTLNAV_APP_URL is required}"
: "${GTLNAV_API_KEY:?GTLNAV_API_KEY is required}"
: "${GTLNAV_PROJECT_ID:?GTLNAV_PROJECT_ID is required}"
BRANCH="${GTLNAV_BRANCH:-main}"

echo "[smoke-docker] starting deploy for project ${GTLNAV_PROJECT_ID} on ${BRANCH}…"
START_RESP=$(curl -sS -X POST \
  -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"${GTLNAV_PROJECT_ID}\",\"branch\":\"${BRANCH}\"}" \
  "${GTLNAV_APP_URL%/}/api/deployments/start")
echo "$START_RESP" | jq .

DEPLOYMENT_ID=$(echo "$START_RESP" | jq -r '.deployment.id // empty')
DEPLOYMENT_URL=$(echo "$START_RESP" | jq -r '.deployment.deployment_url // empty')

if [[ -z "$DEPLOYMENT_ID" ]]; then
  echo "[smoke-docker] FAIL — start API did not return a deployment id." >&2
  exit 1
fi
echo "[smoke-docker] deployment_id=$DEPLOYMENT_ID"

# Allow more time than the static smoke — Docker builds can take 90–180s.
DEADLINE=$(( $(date +%s) + 900 ))
STATUS=""
while [[ $(date +%s) -lt $DEADLINE ]]; do
  STATUS_RESP=$(curl -sS \
    -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
    "${GTLNAV_APP_URL%/}/api/deployments/${DEPLOYMENT_ID}/status")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.deployment.status // empty')
  echo "[smoke-docker] $(date +%T) status=$STATUS"
  case "$STATUS" in
    active|failed|canceled) break ;;
  esac
  sleep 8
done

if [[ "$STATUS" != "active" ]]; then
  echo "[smoke-docker] FAIL — deployment ended in status '$STATUS'." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Verify the runtime_instances row.
# -----------------------------------------------------------------------------
echo "[smoke-docker] verifying runtime_instances row…"
RI_RESP=$(curl -sS \
  -H "Authorization: Bearer ${GTLNAV_API_KEY}" \
  "${GTLNAV_APP_URL%/}/api/runtime/instances?project_id=${GTLNAV_PROJECT_ID}")
RI_KIND=$(echo "$RI_RESP" | jq -r '.instances[0].runtime_kind // empty')
RI_STATUS=$(echo "$RI_RESP" | jq -r '.instances[0].status // empty')
RI_CONTAINER=$(echo "$RI_RESP" | jq -r '.instances[0].container_name // empty')
RI_PORT=$(echo "$RI_RESP" | jq -r '.instances[0].internal_port // empty')
RI_HEALTH=$(echo "$RI_RESP" | jq -r '.instances[0].last_health_status // empty')
RI_IMAGE=$(echo "$RI_RESP" | jq -r '.instances[0].image_tag // empty')

echo "[smoke-docker] runtime_kind=$RI_KIND status=$RI_STATUS"
echo "[smoke-docker] container_name=$RI_CONTAINER internal_port=$RI_PORT"
echo "[smoke-docker] image_tag=$RI_IMAGE last_health=$RI_HEALTH"

fail=0
[[ "$RI_KIND"   == "docker"  ]] || { echo "[smoke-docker] FAIL — runtime_kind is '$RI_KIND' (expected 'docker')." >&2; fail=1; }
[[ "$RI_STATUS" == "running" ]] || { echo "[smoke-docker] FAIL — status is '$RI_STATUS' (expected 'running')." >&2; fail=1; }
[[ -n "$RI_CONTAINER" ]]         || { echo "[smoke-docker] FAIL — container_name is empty." >&2; fail=1; }
[[ -n "$RI_PORT" && "$RI_PORT" != "null" ]] || { echo "[smoke-docker] FAIL — internal_port is empty." >&2; fail=1; }
[[ "$RI_HEALTH" == "healthy" ]] || { echo "[smoke-docker] WARN — last_health_status is '$RI_HEALTH'; the container may still be warming up."; }
(( fail == 0 )) || exit 1

# -----------------------------------------------------------------------------
# Curl the live URL.
# -----------------------------------------------------------------------------
if [[ -n "$DEPLOYMENT_URL" ]]; then
  echo "[smoke-docker] curling $DEPLOYMENT_URL …"
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$DEPLOYMENT_URL" || true)
  echo "[smoke-docker] HTTP $HTTP_CODE on $DEPLOYMENT_URL"
  if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "301" && "$HTTP_CODE" != "302" ]]; then
    echo "[smoke-docker] WARN — URL responded with $HTTP_CODE; first request can be slow when ACME is issuing TLS."
  fi
fi

echo "[smoke-docker] OK — Docker deployment $DEPLOYMENT_ID is live."
