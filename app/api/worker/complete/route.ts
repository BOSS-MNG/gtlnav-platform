import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import {
  completeJob,
  loadJobForWorker,
} from "@/src/lib/server-worker";
import {
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/worker/complete
 *
 * Auth: x-gtlnav-worker-secret OR Bearer <api key with worker scope>.
 *
 * Body:
 *   {
 *     "job_id":         "<uuid>",
 *     "deployment_url": "https://app-xxxx.gtlnav.app",   (optional)
 *     "result":         { "duration_ms": 12345, ... }    (optional)
 *   }
 *
 * Effect:
 *   - deployment_jobs.status -> succeeded, finished_at, result (jsonb)
 *   - deployments.status     -> active, finished_at, deployment_url
 *   - projects.live_url      -> deployment_url (best-effort, schema-tolerant)
 *   - projects.status        -> active        (best-effort)
 *   - infrastructure_logs    -> deployment_completed (success)
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
      { ok: false, error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const jobId = stringField(body.job_id);
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "missing_job_id", message: "job_id is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const deploymentUrlRaw = stringField(body.deployment_url);
  if (deploymentUrlRaw && !/^https?:\/\//i.test(deploymentUrlRaw)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_deployment_url",
        message: "deployment_url must start with http:// or https://.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = isPlainObject(body.result)
    ? (body.result as Record<string, unknown>)
    : null;

  const job = await loadJobForWorker(auth.client, {
    jobId,
    scopeUserId: auth.kind === "api_key" ? auth.scopeUserId : null,
  });
  if (!job.ok) {
    if (job.missingTable) {
      return NextResponse.json(
        {
          ok: false,
          error: "deployment_jobs_table_missing",
          message: job.message,
          setup_sql: DEPLOYMENT_JOBS_SCHEMA_SQL,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: job.error, message: job.message },
      { status: job.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const completion = await completeJob(auth.client, {
    job: job.job,
    deploymentUrl: deploymentUrlRaw,
    result,
    workerLabel: auth.workerLabel,
  });
  if (!completion.ok) {
    return NextResponse.json(
      { ok: false, error: completion.error, message: completion.message },
      { status: completion.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: job.job.user_id,
    projectId: job.job.project_id,
    eventType: "deployment_completed",
    severity: "success",
    message: `Worker "${auth.workerLabel}" completed deployment ${job.job.deployment_id}.`,
    metadata: {
      job_id: job.job.id,
      deployment_id: job.job.deployment_id,
      worker_label: auth.workerLabel,
      auth_kind: auth.kind,
      deployment_url: completion.deploymentUrl,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      job_id: completion.job.id,
      deployment_id: completion.job.deployment_id,
      deployment_url: completion.deploymentUrl,
      job_status: completion.job.status,
      deployment_status: completion.deployment?.status ?? "active",
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
