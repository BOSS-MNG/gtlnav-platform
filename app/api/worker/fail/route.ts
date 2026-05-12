import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import {
  failJob,
  loadJobForWorker,
} from "@/src/lib/server-worker";
import {
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/worker/fail
 *
 * Auth: x-gtlnav-worker-secret OR Bearer <api key with worker scope>.
 *
 * Body:
 *   {
 *     "job_id":        "<uuid>",
 *     "error_message": "Build failed: missing dependency 'foo'",
 *     "result":        { "exit_code": 1, "duration_ms": 5210 }   (optional)
 *   }
 *
 * Effect:
 *   - deployment_jobs.status -> failed, finished_at, error_message, result
 *   - deployments.status     -> failed, finished_at
 *   - projects.status        -> error  (best-effort, schema-tolerant)
 *   - infrastructure_logs    -> deployment_failed (error)
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

  const errorMessage = stringField(body.error_message);
  if (!errorMessage) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_error_message",
        message: "error_message is required when failing a job.",
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

  const failed = await failJob(auth.client, {
    job: job.job,
    errorMessage,
    result,
    workerLabel: auth.workerLabel,
  });
  if (!failed.ok) {
    return NextResponse.json(
      { ok: false, error: failed.error, message: failed.message },
      { status: failed.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: job.job.user_id,
    projectId: job.job.project_id,
    eventType: "deployment_failed",
    severity: "error",
    message: `Worker "${auth.workerLabel}" reported deployment ${job.job.deployment_id} as failed: ${errorMessage}`,
    metadata: {
      job_id: job.job.id,
      deployment_id: job.job.deployment_id,
      worker_label: auth.workerLabel,
      auth_kind: auth.kind,
      error_message: errorMessage,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      job_id: failed.job.id,
      deployment_id: failed.job.deployment_id,
      job_status: failed.job.status,
      deployment_status: failed.deployment?.status ?? "failed",
      error_message: errorMessage,
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
