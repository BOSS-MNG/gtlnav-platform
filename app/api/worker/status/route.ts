import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import {
  applyJobStatus,
  loadJobForWorker,
} from "@/src/lib/server-worker";
import {
  DEPLOYMENT_INFLIGHT_STATUSES,
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  DEPLOYMENT_TERMINAL_STATUSES,
  logInfra,
  type DeploymentJobStatus,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_DEPLOYMENT_STATUS_VALUES = [
  ...DEPLOYMENT_INFLIGHT_STATUSES,
  ...DEPLOYMENT_TERMINAL_STATUSES,
] as readonly string[];

const VALID_JOB_STATUS_VALUES: DeploymentJobStatus[] = [
  "pending",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "canceled",
];

/**
 * POST /api/worker/status
 *
 * Auth: x-gtlnav-worker-secret OR Bearer <api key with worker scope>.
 *
 * Body:
 *   {
 *     "job_id":            "<uuid>",
 *     "deployment_status": "cloning" | "installing" | "building" |
 *                          "optimizing" | "deploying" | "running",
 *     "job_status":        "running"     (optional)
 *   }
 *
 * At least one of `deployment_status` / `job_status` is required.
 *
 * Effect:
 *   - Updates `deployment_jobs.status` (auto-promotes claimed → running on
 *     first push if `job_status` is omitted).
 *   - Updates `deployments.status` and stamps `finished_at` on terminal
 *     transitions.
 *   - Appends a `deployment_status` audit log.
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

  const deploymentStatusRaw = stringField(body.deployment_status);
  const jobStatusRaw = stringField(body.job_status);

  if (!deploymentStatusRaw && !jobStatusRaw) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_status",
        message: "Provide at least one of deployment_status or job_status.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    deploymentStatusRaw &&
    !VALID_DEPLOYMENT_STATUS_VALUES.includes(deploymentStatusRaw.toLowerCase())
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_deployment_status",
        message: `deployment_status must be one of: ${VALID_DEPLOYMENT_STATUS_VALUES.join(", ")}.`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let jobStatus: DeploymentJobStatus | null = null;
  if (jobStatusRaw) {
    const lower = jobStatusRaw.toLowerCase() as DeploymentJobStatus;
    if (!VALID_JOB_STATUS_VALUES.includes(lower)) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_job_status",
          message: `job_status must be one of: ${VALID_JOB_STATUS_VALUES.join(", ")}.`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    jobStatus = lower;
  }

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

  const result = await applyJobStatus(auth.client, {
    job: job.job,
    deploymentStatus: deploymentStatusRaw?.toLowerCase() ?? null,
    jobStatus,
    workerLabel: auth.workerLabel,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: job.job.user_id,
    projectId: job.job.project_id,
    eventType: "deployment_status",
    severity: "info",
    message: `Worker "${auth.workerLabel}" pushed deployment status${
      result.deploymentStatus ? ` "${result.deploymentStatus}"` : ""
    } / job status "${result.jobStatus}".`,
    metadata: {
      job_id: job.job.id,
      deployment_id: job.job.deployment_id,
      worker_label: auth.workerLabel,
      auth_kind: auth.kind,
      deployment_status: result.deploymentStatus,
      job_status: result.jobStatus,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      job_id: job.job.id,
      deployment_id: job.job.deployment_id,
      job_status: result.jobStatus,
      deployment_status: result.deploymentStatus,
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
