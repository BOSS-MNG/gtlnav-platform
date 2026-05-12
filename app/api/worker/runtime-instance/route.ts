import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import { logInfra } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_RUNTIME_KINDS = new Set(["static", "docker"]);
const ALLOWED_TARGET_STATES = new Set(["running", "stopped", "destroyed"]);
const ALLOWED_STATUSES = new Set([
  "pending",
  "starting",
  "running",
  "stopped",
  "failed",
]);
const ALLOWED_HEALTH = new Set([
  "unknown",
  "starting",
  "healthy",
  "unhealthy",
  "crashed",
]);

/**
 * POST /api/worker/runtime-instance
 *
 * Auth: x-gtlnav-worker-secret OR api key with worker scope.
 *
 * Upserts a row in `runtime_instances`. Used by the deployment worker:
 *   - after a successful static publish (runtime_kind = static)
 *   - after `docker run` succeeds            (runtime_kind = docker)
 *   - after runtime actions to update target_state / last_action / status
 *
 * Lookup precedence:
 *   1. `runtime_instance_id` (explicit pointer; preferred for action updates)
 *   2. `container_name` (Docker)
 *   3. `(project_id, deployment_id, runtime_kind)` (deploy-time inserts)
 *
 * Phase 6C — schema alignment:
 *   - Body field is `runtime_kind` (which matches the column added in
 *     migration 0006). For backwards compatibility with the original Phase 6B
 *     worker we still accept `hosting_kind`, but it is always translated to
 *     `runtime_kind` before touching the database.
 *   - On INSERT, any previously-active runtime_instance for the same
 *     `project_id` is demoted (`status = 'stopped'`, `target_state = 'stopped'`)
 *     so the partial unique index `runtime_instances_project_active` is not
 *     violated when a new deployment supersedes a prior one.
 *   - When `target_state = 'destroyed'`, related `proxy_routes` rows are
 *     marked `status = 'disabled'` so Caddy stops serving the destroyed
 *     container on its next refresh.
 *
 * The endpoint is idempotent — worker retries do not duplicate rows.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWorker(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Body must be JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const runtimeInstanceId = stringField(body.runtime_instance_id);
  const containerName = stringField(body.container_name);
  const deploymentId = stringField(body.deployment_id);
  const projectId = stringField(body.project_id);
  const userId = stringField(body.user_id);
  // Phase 6C: prefer `runtime_kind`; fall back to legacy `hosting_kind`.
  const runtimeKind =
    stringField(body.runtime_kind)?.toLowerCase() ??
    stringField(body.hosting_kind)?.toLowerCase() ??
    null;
  const targetState = stringField(body.target_state)?.toLowerCase() ?? null;
  const statusField = stringField(body.status)?.toLowerCase() ?? null;
  const lastHealthStatus =
    stringField(body.last_health_status)?.toLowerCase() ?? null;
  const lastAction = stringField(body.last_action) ?? null;

  if (runtimeKind && !ALLOWED_RUNTIME_KINDS.has(runtimeKind)) {
    return jsonError(
      400,
      "invalid_runtime_kind",
      `runtime_kind must be one of: ${[...ALLOWED_RUNTIME_KINDS].join(", ")}.`,
    );
  }
  if (targetState && !ALLOWED_TARGET_STATES.has(targetState)) {
    return jsonError(
      400,
      "invalid_target_state",
      `target_state must be one of: ${[...ALLOWED_TARGET_STATES].join(", ")}.`,
    );
  }
  if (statusField && !ALLOWED_STATUSES.has(statusField)) {
    return jsonError(
      400,
      "invalid_status",
      `status must be one of: ${[...ALLOWED_STATUSES].join(", ")}.`,
    );
  }
  if (lastHealthStatus && !ALLOWED_HEALTH.has(lastHealthStatus)) {
    return jsonError(
      400,
      "invalid_health_status",
      `last_health_status must be one of: ${[...ALLOWED_HEALTH].join(", ")}.`,
    );
  }

  // Pin scope when API-key worker.
  let scopedUserId = userId;
  if (auth.kind === "api_key") {
    scopedUserId = auth.scopeUserId;
  }
  if (!scopedUserId && runtimeKind) {
    return jsonError(
      400,
      "missing_user_id",
      "user_id is required when creating a runtime instance via worker secret.",
    );
  }

  // ---- 1. Find existing row ------------------------------------------------
  let existing: { id: string; user_id: string; project_id: string | null } | null =
    null;
  if (runtimeInstanceId) {
    const r = await auth.client
      .from("runtime_instances")
      .select("id, user_id, project_id")
      .eq("id", runtimeInstanceId)
      .maybeSingle();
    if (r.error && !isMissingTable(r.error.message)) {
      return jsonError(500, "lookup_failed", r.error.message);
    }
    existing = r.data ?? null;
  } else if (containerName) {
    const r = await auth.client
      .from("runtime_instances")
      .select("id, user_id, project_id")
      .eq("container_name", containerName)
      .maybeSingle();
    if (r.error && !isMissingTable(r.error.message)) {
      return jsonError(500, "lookup_failed", r.error.message);
    }
    existing = r.data ?? null;
  } else if (deploymentId && projectId && runtimeKind) {
    const r = await auth.client
      .from("runtime_instances")
      .select("id, user_id, project_id")
      .eq("deployment_id", deploymentId)
      .eq("project_id", projectId)
      .eq("runtime_kind", runtimeKind)
      .maybeSingle();
    if (r.error && !isMissingTable(r.error.message)) {
      return jsonError(500, "lookup_failed", r.error.message);
    }
    existing = r.data ?? null;
  }

  // Enforce API-key scope.
  if (existing && auth.kind === "api_key" && existing.user_id !== auth.scopeUserId) {
    return jsonError(
      403,
      "scope_denied",
      "This API key cannot update runtime instances owned by other users.",
    );
  }

  const now = new Date().toISOString();
  const writable: Record<string, unknown> = {
    updated_at: now,
  };
  setIfPresent(writable, "runtime_kind", runtimeKind);
  setIfPresent(writable, "target_state", targetState);
  setIfPresent(writable, "status", statusField);
  setIfPresent(writable, "internal_port", body.internal_port);
  setIfPresent(writable, "container_id", body.container_id);
  setIfPresent(writable, "container_name", containerName);
  setIfPresent(writable, "image_tag", body.image_tag);
  setIfPresent(writable, "dockerfile_source", body.dockerfile_source);
  setIfPresent(writable, "last_health_status", lastHealthStatus);
  if (lastHealthStatus) writable.last_health_check = now;
  setIfPresent(writable, "last_action", lastAction);
  if (lastAction) writable.last_action_at = now;
  setIfPresent(writable, "framework", body.framework);
  setIfPresent(writable, "serve_path", body.serve_path);
  setIfPresent(writable, "deployment_id", deploymentId);

  // When the worker reports a stop / destroy we also record a timestamp.
  if (targetState === "stopped" || statusField === "stopped") {
    writable.last_stopped_at = now;
  }
  if (
    targetState === "running" ||
    statusField === "running" ||
    statusField === "starting"
  ) {
    writable.last_started_at = now;
  }

  let row: Record<string, unknown> | null = null;
  let writeErr: string | null = null;
  let demotedCount = 0;

  if (existing) {
    const upd = await auth.client
      .from("runtime_instances")
      .update(writable)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (upd.error) writeErr = upd.error.message;
    row = (upd.data as Record<string, unknown> | null) ?? null;
  } else {
    // Insert path.
    if (!scopedUserId || !runtimeKind) {
      return jsonError(
        400,
        "insert_missing_fields",
        "Inserting a runtime instance requires user_id (or API-key auth) and runtime_kind.",
      );
    }

    // Phase 6C.2 — demote prior active rows for the same project so the
    // partial unique index `runtime_instances_project_active` does not fail
    // when a new deployment supersedes an old one. We only do this on
    // INSERT (a fresh row for a new deployment); UPDATE flows leave history
    // alone.
    if (projectId && targetState !== "destroyed") {
      const dem = await auth.client
        .from("runtime_instances")
        .update({
          status: "stopped",
          target_state: "stopped",
          last_stopped_at: now,
          updated_at: now,
        })
        .eq("project_id", projectId)
        .eq("user_id", scopedUserId)
        .in("status", ["running", "starting"])
        .select("id");
      if (dem.error && !isMissingTable(dem.error.message)) {
        // Demotion failure should not block the new deploy from registering,
        // but we surface it in audit so operators see the conflict.
        await logInfra(auth.client, {
          userId: scopedUserId,
          projectId,
          eventType: "runtime_instance_demote_failed",
          severity: "warning",
          message: `Failed to demote previous active runtime instances for project ${projectId}: ${dem.error.message}`,
          metadata: { worker: auth.workerLabel },
        });
      } else if (Array.isArray(dem.data)) {
        demotedCount = dem.data.length;
      }
    }

    const insertPayload: Record<string, unknown> = {
      user_id: scopedUserId,
      project_id: projectId,
      deployment_id: deploymentId,
      runtime_kind: runtimeKind,
      target_state: targetState ?? "running",
      status: statusField ?? "running",
      created_at: now,
      ...writable,
    };
    const ins = await auth.client
      .from("runtime_instances")
      .insert(insertPayload)
      .select("*")
      .maybeSingle();
    if (ins.error) writeErr = ins.error.message;
    row = (ins.data as Record<string, unknown> | null) ?? null;
  }

  if (writeErr) {
    return jsonError(500, "write_failed", writeErr);
  }

  // Phase 6C — when a runtime is destroyed, disable its proxy_routes so the
  // reverse proxy stops sending traffic to a dead container on its next
  // refresh. We match by runtime_instance_id when we have it, and fall back
  // to container_name for static rows that never had an id at write time.
  if (targetState === "destroyed") {
    const rowId = (row?.id as string | undefined) ?? existing?.id ?? null;
    if (rowId) {
      const routeUpd = await auth.client
        .from("proxy_routes")
        .update({ status: "disabled", updated_at: now })
        .eq("runtime_instance_id", rowId)
        .select("id");
      if (routeUpd.error && !isMissingTable(routeUpd.error.message)) {
        await logInfra(auth.client, {
          userId: scopedUserId ?? null,
          projectId: projectId ?? null,
          eventType: "proxy_route_disable_failed",
          severity: "warning",
          message: `Failed to disable proxy_routes for destroyed runtime ${rowId}: ${routeUpd.error.message}`,
          metadata: { worker: auth.workerLabel, runtime_instance_id: rowId },
        });
      }
    }
  }

  await logInfra(auth.client, {
    userId: scopedUserId ?? null,
    projectId: projectId ?? null,
    eventType: existing ? "runtime_instance_updated" : "runtime_instance_created",
    severity: "info",
    message: existing
      ? `Worker ${auth.workerLabel} updated runtime instance.`
      : `Worker ${auth.workerLabel} created runtime instance${demotedCount > 0 ? ` and demoted ${demotedCount} previous active row(s)` : ""}.`,
    metadata: {
      runtime_instance_id: row?.id ?? existing?.id ?? null,
      runtime_kind: runtimeKind,
      target_state: targetState,
      status: statusField,
      container_name: containerName,
      worker: auth.workerLabel,
      last_action: lastAction,
      demoted_previous_active: demotedCount,
    },
  });

  return NextResponse.json(
    { ok: true, runtime_instance: row, demoted_previous: demotedCount },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function setIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" && value.length === 0) return;
  target[key] = value;
}

function isMissingTable(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("not found") ||
    m.includes("schema cache")
  );
}
