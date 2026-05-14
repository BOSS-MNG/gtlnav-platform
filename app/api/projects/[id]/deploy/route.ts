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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limit = rateLimit(request, {
    bucket: "project_deploy_start",
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

  const branch = stringField(body.branch) ?? "main";
  const commitSha = stringField(body.commit_sha) ?? undefined;
  const deployTarget = stringField(body.deploy_target) ?? null;
  const env = isPlainObject(body.env) ? (body.env as Record<string, unknown>) : null;

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
    runtime_kind: resolvedRuntimeKind,
    hosting_kind: resolvedHostingKind,
    repo_url: projectRow.repo_url ?? null,
    default_branch: projectRow.default_branch ?? null,
    framework: projectRow.framework ?? null,
    install_command: projectRow.install_command ?? null,
    build_command: projectRow.build_command ?? null,
    build_output_dir: projectRow.build_output_dir ?? null,
    node_version: projectRow.node_version ?? null,
    env_overrides: env,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
    trigger: "project_deploy_route",
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
      ? `Deployment queued via project deploy route for ${projectRow.name ?? projectRow.slug ?? projectId} (${created.branch}@${created.commitSha}).`
      : `Deployment row created but deployment_jobs queue is unavailable for ${projectRow.name ?? projectId}.`,
    metadata: {
      deployment_id: created.deployment.id,
      job_id: jobResult.ok ? jobResult.job.id : null,
      branch: created.branch,
      commit_sha: created.commitSha,
      deploy_target: deployTarget,
      auth_kind: auth.kind,
      trigger: "project_deploy_route",
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
