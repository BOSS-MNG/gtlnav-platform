/**
 * GTLNAV deployment-worker — HTTP client to the control plane.
 *
 * Every call goes out with `x-gtlnav-worker-secret` (the shared worker
 * secret) and a JSON body. The control plane endpoints all return:
 *
 *     { ok: true,  ... }    for success
 *     { ok: false, error, message } for failure
 *
 * 503 + { error: "deployment_jobs_table_missing" } is treated as "queue
 * not provisioned yet"; the worker logs once and idles instead of
 * crash-looping.
 */
import { config, ENDPOINTS } from "./config.js";

const COMMON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
  Accept: "application/json",
  "x-gtlnav-worker-secret": config.workerSecret,
  "User-Agent": `gtlnav-deployment-worker/${config.workerLabel}`,
});

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(body ?? {}),
  });

  let payload = {};
  try {
    payload = await resp.json();
  } catch {
    payload = {};
  }

  return { status: resp.status, ok: resp.ok, payload };
}

/**
 * Phase 6C — honest capability advertisement.
 *
 * Static-only workers report `['static']`; Docker-capable workers also report
 * `'docker'` and `'runtime_action'` so the control plane can route work
 * appropriately (a static-only worker should never be handed a runtime_action
 * job — see `app/api/worker/claim-job/route.ts`).
 */
function buildCapabilities() {
  const caps = ["static"];
  if (config.dockerEnabled) {
    caps.push("docker", "runtime_action");
  }
  return caps;
}

/**
 * Ask the control plane for the next pending job.
 * Returns `null` when the queue is empty or temporarily unavailable.
 */
export async function claimNextJob() {
  const { status, payload } = await postJson(ENDPOINTS.claim, {
    worker_id: config.workerLabel,
    capabilities: buildCapabilities(),
  });

  if (status === 503 && payload?.error === "deployment_jobs_table_missing") {
    return { kind: "queue_unprovisioned", message: payload.message };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth_error", message: payload.message ?? "Unauthorized" };
  }
  if (!payload?.ok) {
    return {
      kind: "error",
      message: payload?.message ?? `claim-job HTTP ${status}`,
    };
  }
  if (!payload.job) return { kind: "empty" };
  return { kind: "job", job: payload.job };
}

/** Push a single log line to the control plane. */
export async function postLog(jobId, entry) {
  return postJson(ENDPOINTS.logs, {
    job_id: jobId,
    level: entry.level ?? "info",
    source: entry.source ?? "worker",
    message: entry.message,
    metadata: entry.metadata ?? null,
  });
}

/** Push a batch of log entries to the control plane. */
export async function postLogs(jobId, entries) {
  if (!entries || entries.length === 0) return { status: 200, ok: true, payload: { ok: true } };
  return postJson(ENDPOINTS.logs, {
    job_id: jobId,
    logs: entries.map((e) => ({
      level: e.level ?? "info",
      source: e.source ?? "worker",
      message: e.message,
      metadata: e.metadata ?? null,
    })),
  });
}

/** Drive deployment / job status through the control plane. */
export async function postStatus(jobId, deploymentStatus, jobStatus = null) {
  const body = { job_id: jobId };
  if (deploymentStatus) body.deployment_status = deploymentStatus;
  if (jobStatus) body.job_status = jobStatus;
  return postJson(ENDPOINTS.status, body);
}

/** Mark a job successful. */
export async function postComplete(jobId, deploymentUrl, result) {
  return postJson(ENDPOINTS.complete, {
    job_id: jobId,
    deployment_url: deploymentUrl ?? null,
    result: result ?? {},
  });
}

/** Mark a job failed. */
export async function postFail(jobId, errorMessage, result) {
  return postJson(ENDPOINTS.fail, {
    job_id: jobId,
    error_message: errorMessage,
    result: result ?? {},
  });
}

/**
 * Phase 6B — register or update a runtime_instances row. Used both for
 * static deployments (image_tag = null, container_id = null) and Docker
 * deployments (full metadata).
 *
 * The control plane endpoint upserts on (user_id, project_id, deployment_id).
 */
export async function upsertRuntimeInstance(payload) {
  return postJson(ENDPOINTS.runtimeUpsert, payload ?? {});
}

/**
 * Phase 6B — register a proxy route. The control plane writes to
 * `proxy_routes` and (on duplicate hostname) updates the upstream so the
 * proxy hot-swaps on next poll.
 */
export async function registerProxyRoute(payload) {
  return postJson(ENDPOINTS.routeRegister, payload ?? {});
}
