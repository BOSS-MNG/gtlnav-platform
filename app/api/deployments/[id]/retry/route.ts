import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  createDeploymentJob,
  createDeploymentRow,
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  generateCommitSha,
  loadOwnedDeployment,
  loadOwnedProject,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/deployments/[id]/retry
 *
 * Body (optional):
 *   {
 *     "branch":     "feature/x",       (defaults to original branch)
 *     "commit_sha": "<7+ char hex>",   (defaults to a fresh sha)
 *     "force":      false              (allow retry even if original is still inflight)
 *   }
 *
 * Effect:
 *   - Validates the original deployment is owned by the caller.
 *   - Inserts a new deployment row referencing `parent_deployment_id`
 *     (best-effort — column is added by the deployment_jobs setup SQL).
 *   - Inserts a new pending deployment_jobs row with attempt = parent.attempt+1.
 *   - Logs `deployment_retried`.
 *
 * Original deployment is left untouched; this is a "new attempt" pattern,
 * not in-place mutation.
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

  let body: Record<string, unknown> = {};
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      body = ((await request.json()) as Record<string, unknown> | null) ?? {};
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const overrideBranch = stringField(body.branch);
  const overrideCommit = stringField(body.commit_sha);
  const force = body.force === true;

  const original = await loadOwnedDeployment(auth.client, {
    deploymentId: id,
    userId: auth.userId,
  });
  if (!original.ok) {
    return NextResponse.json(
      { ok: false, error: original.error, message: original.message },
      { status: original.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const originalStatus = (original.deployment.status ?? "").toLowerCase();
  const isInflight = ![
    "active",
    "failed",
    "canceled",
    "succeeded",
    "complete",
    "completed",
  ].some((t) => originalStatus.includes(t));
  if (isInflight && !force) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_retryable",
        message: `Deployment is still inflight (status="${originalStatus || "unknown"}"). Cancel it first or pass { "force": true } to retry anyway.`,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const project = await loadOwnedProject(auth.client, {
    projectId: original.deployment.project_id,
    userId: auth.userId,
  });
  if (!project.ok) {
    return NextResponse.json(
      { ok: false, error: project.error, message: project.message },
      { status: project.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const branch = overrideBranch ?? original.deployment.branch ?? "main";
  const commitSha = overrideCommit ?? generateCommitSha();
  const attempt = ((original.job?.attempt ?? 0) || 1) + 1;

  const created = await createDeploymentRow(auth.client, {
    userId: auth.userId,
    projectId: original.deployment.project_id,
    branch,
    commitSha,
    parentDeploymentId: original.deployment.id,
  });
  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.error, message: created.message },
      { status: created.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestedBy =
    auth.kind === "session"
      ? { kind: "session", email: auth.email }
      : { kind: "api_key", key_id: auth.keyId, token_type: auth.tokenType };

  const payload = {
    branch: created.branch,
    commit_sha: created.commitSha,
    project_slug: project.project.slug,
    project_name: project.project.name,
    parent_deployment_id: original.deployment.id,
    parent_status: originalStatus || null,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
    retry: true,
  };

  const jobResult = await createDeploymentJob(auth.client, {
    deploymentId: created.deployment.id,
    userId: auth.userId,
    projectId: original.deployment.project_id,
    payload,
    attempt,
  });

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: original.deployment.project_id,
    eventType: "deployment_retried",
    severity: jobResult.ok ? "info" : "warning",
    message: `Retry queued for deployment ${original.deployment.id} as ${created.deployment.id} (attempt ${attempt}).`,
    metadata: {
      deployment_id: created.deployment.id,
      parent_deployment_id: original.deployment.id,
      job_id: jobResult.ok ? jobResult.job.id : null,
      attempt,
      branch: created.branch,
      commit_sha: created.commitSha,
      auth_kind: auth.kind,
      job_queue_available: jobResult.ok,
      forced: force,
    },
  });

  if (!jobResult.ok && jobResult.missingTable) {
    return NextResponse.json(
      {
        ok: true,
        deployment_id: created.deployment.id,
        parent_deployment_id: original.deployment.id,
        job_id: null,
        attempt,
        status: "queued",
        branch: created.branch,
        commit_sha: created.commitSha,
        warning: jobResult.message,
        setup_sql: DEPLOYMENT_JOBS_SCHEMA_SQL,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!jobResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "job_queue_failed",
        message: jobResult.message,
        deployment_id: created.deployment.id,
      },
      { status: jobResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      deployment_id: created.deployment.id,
      parent_deployment_id: original.deployment.id,
      job_id: jobResult.job.id,
      attempt,
      status: "queued",
      branch: created.branch,
      commit_sha: created.commitSha,
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
