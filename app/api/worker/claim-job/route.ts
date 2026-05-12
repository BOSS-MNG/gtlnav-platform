import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import { claimNextJob } from "@/src/lib/server-worker";
import {
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/worker/claim-job
 *
 * Auth (one of):
 *   - x-gtlnav-worker-secret: <GTLNAV_WORKER_SECRET>     (cross-tenant)
 *   - Authorization: Bearer <gtlnav_*_dep_*>             (scoped to key owner)
 *
 * Optional body:
 *   {
 *     "worker_id":     "build-runner-eu-1",     (also accepted as x-gtlnav-worker-id)
 *     "capabilities":  ["docker", "edge"]
 *   }
 *
 * Effect:
 *   - Compare-and-swap claim of the oldest pending row in deployment_jobs.
 *   - Returns the full job row + payload + deployment_id, or { job: null }
 *     when the queue is empty.
 *
 * Response shapes:
 *   200 OK  + { ok: true, job: <row> | null }
 *   503     + { ok: false, error: "deployment_jobs_table_missing", setup_sql }
 *   401/403 + auth error
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
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      body = ((await request.json()) as Record<string, unknown> | null) ?? {};
    }
  } catch {
    // Ignore — claim-job is allowed to be a bodiless POST.
  }

  const overrideLabel = stringField(body.worker_id);
  const workerLabel = overrideLabel ?? auth.workerLabel;
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : null;

  // Phase 6C — derive job kinds this worker should NOT claim based on the
  // capabilities it advertises. A worker that does not declare
  // `"runtime_action"` capability is excluded from runtime-action jobs so
  // those queue up for a Docker-capable peer rather than being burnt.
  const capList: string[] = Array.isArray(capabilities)
    ? capabilities.filter((c): c is string => typeof c === "string")
    : [];
  const excludeKinds: string[] = [];
  if (capList.length > 0 && !capList.includes("runtime_action")) {
    excludeKinds.push("runtime_action");
  }

  const result = await claimNextJob(auth.client, {
    workerLabel,
    scopeUserId: auth.kind === "api_key" ? auth.scopeUserId : null,
    capabilities,
    excludeKinds: excludeKinds.length > 0 ? excludeKinds : null,
  });

  if (!result.ok && result.missingTable) {
    return NextResponse.json(
      {
        ok: false,
        error: "deployment_jobs_table_missing",
        message: result.message,
        setup_sql: DEPLOYMENT_JOBS_SCHEMA_SQL,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!result.job) {
    return NextResponse.json(
      { ok: true, job: null },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Audit log: a worker successfully picked up a job for this tenant.
  await logInfra(auth.client, {
    userId: result.job.user_id,
    projectId: result.job.project_id,
    eventType: "deployment_claimed",
    severity: "info",
    message: `Worker "${workerLabel}" claimed deployment job ${result.job.id}.`,
    metadata: {
      job_id: result.job.id,
      deployment_id: result.job.deployment_id,
      worker_label: workerLabel,
      auth_kind: auth.kind,
      capabilities,
      attempt: result.job.attempt,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      job: {
        id: result.job.id,
        deployment_id: result.job.deployment_id,
        user_id: result.job.user_id,
        project_id: result.job.project_id,
        status: result.job.status,
        attempt: result.job.attempt,
        claimed_by: result.job.claimed_by,
        claimed_at: result.job.claimed_at,
        started_at: result.job.started_at,
        payload: result.job.payload,
        created_at: result.job.created_at,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use POST." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } },
  );
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
