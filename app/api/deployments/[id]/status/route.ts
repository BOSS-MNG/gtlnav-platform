import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  loadOwnedDeployment,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/deployments/[id]/status
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Returns the current state of a deployment plus its latest deployment_job
 * row. Workers update job rows; this endpoint is read-only.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loaded = await loadOwnedDeployment(auth.client, {
    deploymentId: id,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { deployment, job, jobsTableMissing } = loaded;

  const responseBody: Record<string, unknown> = {
    ok: true,
    deployment_id: deployment.id,
    project_id: deployment.project_id,
    status: deployment.status ?? "queued",
    branch: deployment.branch,
    commit_sha: deployment.commit_sha,
    deployment_url: deployment.deployment_url,
    parent_deployment_id: deployment.parent_deployment_id ?? null,
    started_at: deployment.started_at,
    finished_at: deployment.finished_at,
    created_at: deployment.created_at,
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempt: job.attempt,
          claimed_by: job.claimed_by,
          claimed_at: job.claimed_at,
          started_at: job.started_at,
          finished_at: job.finished_at,
          error_message: job.error_message,
          payload: job.payload,
          result: job.result,
          created_at: job.created_at,
          updated_at: job.updated_at,
        }
      : null,
  };

  if (jobsTableMissing) {
    responseBody.warning =
      "deployment_jobs table is not provisioned. Worker progress cannot be tracked.";
    responseBody.setup_sql = DEPLOYMENT_JOBS_SCHEMA_SQL;
  }

  return NextResponse.json(responseBody, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
