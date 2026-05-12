import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { rateLimit } from "@/src/lib/server-rate-limit";
import {
  createDeploymentJob,
  createDeploymentRow,
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  loadOwnedProject,
  logInfra,
} from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/deployments/start
 *
 * Body:
 *   {
 *     "project_id": "<uuid>",
 *     "branch":      "main",                    (optional, default "main")
 *     "commit_sha":  "<7+ char hex>",           (optional, generated if absent)
 *     "deploy_target": "edge|docker|vps|...",   (optional, recorded in payload)
 *     "env":          { "NODE_ENV": "production" }  (optional, recorded)
 *   }
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Effect:
 *   1. Insert into `deployments` (status = 'queued').
 *   2. Insert into `deployment_jobs` (status = 'pending') with the worker
 *      payload — branch / commit_sha / target / env / requested_by.
 *   3. Append `deployment_started` to `infrastructure_logs`.
 *
 * No timers, no in-process work — an external worker picks up the pending job.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Phase 6B.7 — rate limit. Per-user bucket: 20 deploys / minute, burst 20.
  const limit = rateLimit(request, {
    bucket: "deploy_start",
    key: auth.userId,
    capacity: 20,
    refillPerMinute: 20,
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

  const projectId = stringField(body.project_id);
  const branch = stringField(body.branch) ?? "main";
  const commitSha = stringField(body.commit_sha) ?? undefined;
  const deployTarget = stringField(body.deploy_target) ?? null;
  const env = isPlainObject(body.env) ? (body.env as Record<string, unknown>) : null;

  if (!projectId) {
    return NextResponse.json(
      { ok: false, error: "missing_project_id", message: "project_id is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const project = await loadOwnedProject(auth.client, {
    projectId,
    userId: auth.userId,
  });
  if (!project.ok) {
    return NextResponse.json(
      { ok: false, error: project.error, message: project.message },
      { status: project.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const created = await createDeploymentRow(auth.client, {
    userId: auth.userId,
    projectId,
    branch,
    commitSha,
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

  // Worker contract — everything the deployment worker needs to clone, build,
  // and (in Phase 6B) containerize the project. Plaintext secrets are NEVER
  // included here; env-variable VALUES are fetched by the worker through the
  // service-role client at build time from `project_envs`.
  const projectRow = project.project;
  const resolvedRuntimeKind =
    (projectRow.runtime_kind ?? "auto").toString().toLowerCase() || "auto";
  const resolvedHostingKind =
    (projectRow.hosting_kind ?? "static").toString().toLowerCase() || "static";

  const payload: Record<string, unknown> = {
    kind: "deploy",
    project_id: projectId,
    project_slug: projectRow.slug,
    project_name: projectRow.name,
    deployment_id: created.deployment.id,
    branch: created.branch,
    commit_sha: created.commitSha,
    deploy_target: deployTarget,
    /** Hint from the user; "auto" lets the worker decide based on framework. */
    runtime_kind: resolvedRuntimeKind,
    /** Persisted hosting strategy. The worker may override based on detection. */
    hosting_kind: resolvedHostingKind,
    /** Repo information for cloning. */
    repo_url: projectRow.repo_url ?? null,
    default_branch: projectRow.default_branch ?? null,
    framework: projectRow.framework ?? null,
    /** Build overrides. Null means "let the worker auto-detect". */
    install_command: projectRow.install_command ?? null,
    build_command: projectRow.build_command ?? null,
    build_output_dir: projectRow.build_output_dir ?? null,
    node_version: projectRow.node_version ?? null,
    /** Non-secret hints only. Real env values are read server-side at build time. */
    env_overrides: env,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
  };

  const jobResult = await createDeploymentJob(auth.client, {
    deploymentId: created.deployment.id,
    userId: auth.userId,
    projectId,
    payload,
    attempt: 1,
  });

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId,
    eventType: "deployment_started",
    severity: jobResult.ok ? "info" : "warning",
    message: jobResult.ok
      ? `Deployment queued for ${project.project.name ?? project.project.slug ?? projectId} (${created.branch}@${created.commitSha}).`
      : `Deployment row created but deployment_jobs queue is unavailable for ${project.project.name ?? projectId}.`,
    metadata: {
      deployment_id: created.deployment.id,
      job_id: jobResult.ok ? jobResult.job.id : null,
      branch: created.branch,
      commit_sha: created.commitSha,
      deploy_target: deployTarget,
      auth_kind: auth.kind,
      job_queue_available: jobResult.ok,
    },
  });

  if (!jobResult.ok && jobResult.missingTable) {
    return NextResponse.json(
      {
        ok: true,
        deployment_id: created.deployment.id,
        job_id: null,
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
      job_id: jobResult.job.id,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
