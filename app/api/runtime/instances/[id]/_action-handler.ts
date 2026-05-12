import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { rateLimit } from "@/src/lib/server-rate-limit";
import { logInfra } from "@/src/lib/server-deployments";
import {
  ALLOWED_RUNTIME_ACTIONS,
  loadOwnedRuntimeInstance,
  queueRuntimeAction,
  type RuntimeAction,
} from "@/src/lib/server-runtime-control";

/**
 * Shared handler for the four runtime control endpoints. Centralises auth,
 * rate-limiting, ownership lookup, and queueing into one place so the route
 * files stay tiny and consistent.
 */
export async function handleRuntimeActionRequest(
  request: NextRequest,
  paramsPromise: Promise<{ id: string }>,
  action: RuntimeAction,
) {
  const { id } = await paramsPromise;
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!ALLOWED_RUNTIME_ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_action",
        message: `Unsupported runtime action: ${action}`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Tight limit — these queue real container ops.
  const limit = rateLimit(request, {
    bucket: "runtime_action",
    key: auth.userId,
    capacity: 30,
    refillPerMinute: 30,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: limit.message,
        retry_after_seconds: limit.retryAfterSeconds,
      },
      { status: 429, headers: limit.headers },
    );
  }

  const loaded = await loadOwnedRuntimeInstance(auth.client, {
    id,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const queued = await queueRuntimeAction(auth.client, {
    userId: auth.userId,
    instance: loaded.instance,
    action,
  });

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: loaded.instance.project_id,
    eventType:
      action === "destroy"
        ? "runtime_destroy_requested"
        : `runtime_${action}_requested`,
    severity: "info",
    message: queued.ok
      ? `User requested ${action} for runtime instance ${id}.`
      : `User requested ${action} for runtime instance ${id} but queueing failed: ${queued.message}.`,
    metadata: {
      runtime_instance_id: id,
      container_name: loaded.instance.container_name,
      action,
      job_id: queued.ok ? queued.jobId : null,
      queued: queued.ok,
    },
  });

  if (!queued.ok) {
    return NextResponse.json(
      { ok: false, error: queued.error, message: queued.message },
      { status: queued.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      action,
      runtime_instance_id: id,
      job_id: queued.jobId,
      message: `Queued ${action} for runtime instance ${id}. A worker will pick this up shortly.`,
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
