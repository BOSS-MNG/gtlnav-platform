/**
 * GTLNAV worker — runtime action handler.
 *
 * The control plane enqueues a job with `payload.kind = 'runtime_action'`
 * when the user clicks Start / Stop / Restart / Destroy on a Docker
 * runtime. We treat those jobs as small docker commands.
 *
 * The job claims the same `deployment_jobs` queue so we share the existing
 * worker secret and audit trail. Acceptable actions:
 *
 *   - start    : docker start <container>
 *   - stop     : docker stop  <container>
 *   - restart  : docker restart <container>
 *   - destroy  : docker rm --force <container>
 *
 * After the action we POST /api/worker/runtime-instance with the resulting
 * target_state + last_action so the dashboard updates without polling
 * docker directly.
 */
import {
  dockerAvailable,
  dockerRemove,
  dockerRestart,
  dockerStartExisting,
  dockerStop,
} from "./docker.js";
import { upsertRuntimeInstance } from "./api.js";

const ALLOWED_ACTIONS = new Set(["start", "stop", "restart", "destroy"]);

export async function runRuntimeAction({ job, logger }) {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const action = (payload.action ?? "").toString().toLowerCase();
  const containerName = payload.container_name ?? null;
  const runtimeInstanceId = payload.runtime_instance_id ?? null;

  if (!ALLOWED_ACTIONS.has(action)) {
    return {
      ok: false,
      stage: "validate",
      errorMessage: `Unknown runtime action: ${action || "(empty)"}`,
    };
  }
  if (!containerName) {
    return {
      ok: false,
      stage: "validate",
      errorMessage: "Runtime action requires payload.container_name.",
    };
  }
  if (!(await dockerAvailable())) {
    return {
      ok: false,
      stage: "preflight",
      errorMessage:
        "Docker is not available on this worker. Cannot execute runtime action.",
    };
  }

  let res;
  if (action === "start") {
    logger.info(`docker start ${containerName}`, "runtime");
    res = await dockerStartExisting(containerName, logger);
  } else if (action === "stop") {
    logger.info(`docker stop ${containerName}`, "runtime");
    res = await dockerStop(containerName, logger);
  } else if (action === "restart") {
    logger.info(`docker restart ${containerName}`, "runtime");
    res = await dockerRestart(containerName, logger);
  } else {
    logger.info(`docker rm --force ${containerName}`, "runtime");
    res = await dockerRemove(containerName, logger);
  }

  if (!res.ok) {
    return {
      ok: false,
      stage: "docker",
      errorMessage: `docker ${action} failed (exit ${res.code}). ${res.stderr?.slice?.(0, 200) ?? ""}`.trim(),
    };
  }

  // Compute the new desired state for the control plane. We mirror it onto
  // the legacy `status` column too so the partial unique index continues to
  // reflect "what's actually active".
  const newTargetState =
    action === "destroy"
      ? "destroyed"
      : action === "stop"
        ? "stopped"
        : "running";
  const newStatus =
    action === "destroy"
      ? "failed"
      : action === "stop"
        ? "stopped"
        : "running";
  await upsertRuntimeInstance({
    runtime_instance_id: runtimeInstanceId,
    container_name: containerName,
    target_state: newTargetState,
    status: newStatus,
    last_action: action,
    last_action_at: new Date().toISOString(),
    last_health_status:
      action === "destroy"
        ? "crashed"
        : action === "stop"
          ? "unhealthy"
          : "starting",
  });

  return {
    ok: true,
    action,
    containerName,
    durationMs: Date.now() - startedAt,
  };
}
