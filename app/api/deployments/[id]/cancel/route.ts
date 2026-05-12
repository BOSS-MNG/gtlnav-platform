import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  cancelDeployment,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/deployments/[id]/cancel
 *
 * Marks the deployment as `canceled` and flips its latest deployment_job
 * row (if any) to `canceled`. Workers MUST honor `canceled` jobs and stop
 * any work in progress.
 */
export async function POST(
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

  const result = await cancelDeployment(auth.client, {
    deploymentId: id,
    userId: auth.userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: result.deployment.project_id,
    eventType: "deployment_canceled",
    severity: "warning",
    message: `Deployment ${result.deployment.id} canceled by ${
      auth.kind === "session" ? auth.email ?? "session" : `api_key:${auth.keyId}`
    }.`,
    metadata: {
      deployment_id: result.deployment.id,
      job_updated: result.jobUpdated,
      auth_kind: auth.kind,
      branch: result.deployment.branch,
      commit_sha: result.deployment.commit_sha,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      deployment_id: result.deployment.id,
      status: result.deployment.status,
      job_updated: result.jobUpdated,
      finished_at: result.deployment.finished_at,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
