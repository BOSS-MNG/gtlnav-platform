/**
 * GTLNAV — runtime control plane.
 *
 * Exposes a single helper, `queueRuntimeAction`, that the runtime instance
 * endpoints call when the user clicks Start / Stop / Restart / Destroy.
 *
 * Instead of touching Docker directly from the web tier (which would
 * require the daemon socket inside Next.js) we enqueue a row in
 * `deployment_jobs` with `payload.kind = 'runtime_action'`. The deployment
 * worker discriminates by kind and runs the docker subcommand under the
 * same secret-bound auth path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error(
    "server-runtime-control.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

export const ALLOWED_RUNTIME_ACTIONS = [
  "start",
  "stop",
  "restart",
  "destroy",
] as const;
export type RuntimeAction = (typeof ALLOWED_RUNTIME_ACTIONS)[number];

/**
 * Mirrors a `runtime_instances` row. Phase 6C uses `runtime_kind` (matches
 * the column added in migration 0006 + 0008). Earlier worker code used
 * `hosting_kind`; that field is gone everywhere now.
 */
export type RuntimeInstanceRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  deployment_id: string | null;
  runtime_kind: string | null;
  target_state: string | null;
  internal_port: number | null;
  container_id: string | null;
  container_name: string | null;
  image_tag: string | null;
  dockerfile_source: string | null;
  last_health_status: string | null;
  last_health_check: string | null;
  last_action: string | null;
  last_action_at: string | null;
  restart_count: number | null;
  exit_code: number | null;
  exit_reason: string | null;
  framework: string | null;
  serve_path: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function loadOwnedRuntimeInstance(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<
  | { ok: true; instance: RuntimeInstanceRow }
  | { ok: false; status: number; error: string; message: string }
> {
  const { data, error } = await client
    .from("runtime_instances")
    .select("*")
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      error: "lookup_failed",
      message: `runtime_instances lookup failed: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "not_found",
      message: "Runtime instance not found or not owned by caller.",
    };
  }
  return { ok: true, instance: data as RuntimeInstanceRow };
}

export type QueueResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Insert a runtime_action job. The worker handles it under `payload.kind =
 * 'runtime_action'`.
 */
export async function queueRuntimeAction(
  client: SupabaseClient,
  args: {
    userId: string;
    instance: RuntimeInstanceRow;
    action: RuntimeAction;
  },
): Promise<QueueResult> {
  if (!ALLOWED_RUNTIME_ACTIONS.includes(args.action)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_action",
      message: `action must be one of: ${ALLOWED_RUNTIME_ACTIONS.join(", ")}`,
    };
  }
  if (args.instance.runtime_kind !== "docker") {
    return {
      ok: false,
      status: 400,
      error: "unsupported_runtime_kind",
      message:
        "Runtime actions are only available for Docker-backed runtime instances.",
    };
  }
  if (!args.instance.container_name) {
    return {
      ok: false,
      status: 400,
      error: "no_container",
      message:
        "Runtime instance has no container_name yet; wait for the initial deploy to finish.",
    };
  }

  const payload = {
    kind: "runtime_action",
    action: args.action,
    runtime_instance_id: args.instance.id,
    container_name: args.instance.container_name,
    project_id: args.instance.project_id,
    deployment_id: args.instance.deployment_id,
    requested_by: { user_id: args.userId },
    requested_at: new Date().toISOString(),
  };

  // We borrow the deployment_jobs queue. Worker discriminates by payload.kind.
  const { data, error } = await client
    .from("deployment_jobs")
    .insert({
      user_id: args.userId,
      project_id: args.instance.project_id,
      // Runtime actions don't have a deployment row of their own — link to the
      // last deployment that produced this instance. The worker uses the
      // payload anyway, so this is mainly for the audit trail.
      deployment_id: args.instance.deployment_id,
      status: "pending",
      payload,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "queue_failed",
      message: `Could not queue runtime action: ${error.message}`,
    };
  }
  if (!data?.id) {
    return {
      ok: false,
      status: 500,
      error: "queue_failed",
      message: "deployment_jobs insert returned no row.",
    };
  }
  return { ok: true, jobId: data.id };
}
