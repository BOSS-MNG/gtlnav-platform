/**
 * GTLNAV — server-side deployment + job-queue helpers.
 *
 * This module is the table-ready foundation for a real, worker-driven
 * deployment pipeline. It does NOT run any in-process timers or simulate
 * progress. Routes call into here to:
 *
 *   1. Insert a row into `public.deployments`        (status = 'queued').
 *   2. Insert a row into `public.deployment_jobs`    (status = 'pending'),
 *      which an external worker will claim.
 *   3. Append an audit entry to `public.infrastructure_logs`.
 *
 * The worker contract:
 *   - Workers atomically claim a pending job:
 *
 *       update deployment_jobs
 *          set status = 'claimed', claimed_by = $1, claimed_at = now()
 *        where id = (
 *          select id from deployment_jobs
 *           where status = 'pending'
 *           order by created_at
 *           for update skip locked
 *           limit 1
 *        )
 *        returning *;
 *
 *   - Workers then advance the deployment lifecycle by writing back
 *     deployment_jobs.status (running → succeeded | failed | canceled) and
 *     deployments.status (cloning → ... → active | failed | canceled).
 *
 * Schema-tolerant: if `deployment_jobs` is missing, deployment rows still
 * insert successfully and routes return `setup_sql` so operators can
 * provision the queue table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error(
    "server-deployments.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Status constants
// ---------------------------------------------------------------------------

export const DEPLOYMENT_INFLIGHT_STATUSES = [
  "queued",
  "cloning",
  "installing",
  "building",
  "optimizing",
  "deploying",
  "running",
] as const;

export type DeploymentStatus =
  | (typeof DEPLOYMENT_INFLIGHT_STATUSES)[number]
  | "active"
  | "failed"
  | "canceled"
  | string;

export const DEPLOYMENT_TERMINAL_STATUSES = ["active", "failed", "canceled"] as const;

export const DEPLOYMENT_JOB_PENDING = "pending" as const;
export const DEPLOYMENT_JOB_CLAIMED = "claimed" as const;
export const DEPLOYMENT_JOB_RUNNING = "running" as const;
export const DEPLOYMENT_JOB_SUCCEEDED = "succeeded" as const;
export const DEPLOYMENT_JOB_FAILED = "failed" as const;
export const DEPLOYMENT_JOB_CANCELED = "canceled" as const;

export type DeploymentJobStatus =
  | typeof DEPLOYMENT_JOB_PENDING
  | typeof DEPLOYMENT_JOB_CLAIMED
  | typeof DEPLOYMENT_JOB_RUNNING
  | typeof DEPLOYMENT_JOB_SUCCEEDED
  | typeof DEPLOYMENT_JOB_FAILED
  | typeof DEPLOYMENT_JOB_CANCELED;

export const DEPLOYMENT_JOB_TERMINAL_STATUSES: DeploymentJobStatus[] = [
  DEPLOYMENT_JOB_SUCCEEDED,
  DEPLOYMENT_JOB_FAILED,
  DEPLOYMENT_JOB_CANCELED,
];

export function isInflight(status: string | null | undefined): boolean {
  if (!status) return false;
  return (DEPLOYMENT_INFLIGHT_STATUSES as readonly string[]).includes(
    status.toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
//  Row types
// ---------------------------------------------------------------------------

export type DeploymentRow = {
  id: string;
  user_id: string;
  project_id: string;
  status: string | null;
  branch: string | null;
  commit_sha: string | null;
  deployment_url: string | null;
  build_logs: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  parent_deployment_id?: string | null;
};

export type DeploymentJobRow = {
  id: string;
  deployment_id: string;
  user_id: string;
  project_id: string;
  status: DeploymentJobStatus | string;
  attempt: number | null;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProjectMiniRow = {
  id: string;
  user_id: string;
  name: string | null;
  slug: string | null;
  /** Worker-relevant build hints. All optional; the worker is schema-tolerant. */
  repo_url?: string | null;
  default_branch?: string | null;
  framework?: string | null;
  install_command?: string | null;
  build_command?: string | null;
  build_output_dir?: string | null;
  node_version?: string | null;
  /** "static" (Phase 6A) | "docker" (Phase 6B) | "unsupported". */
  hosting_kind?: string | null;
  /** "auto" | "static" | "docker" — operator override for hosting_kind. */
  runtime_kind?: string | null;
};

// ---------------------------------------------------------------------------
//  SQL setup
// ---------------------------------------------------------------------------

export const DEPLOYMENT_JOBS_SCHEMA_SQL = `-- GTLNAV deployment_jobs queue
create table if not exists public.deployment_jobs (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','claimed','running','succeeded','failed','canceled')),
  attempt int not null default 1,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployment_jobs_status_created_idx
  on public.deployment_jobs (status, created_at);
create index if not exists deployment_jobs_deployment_id_idx
  on public.deployment_jobs (deployment_id);
create index if not exists deployment_jobs_user_id_idx
  on public.deployment_jobs (user_id);

alter table public.deployment_jobs enable row level security;

-- Tenants can read their own jobs.
create policy "deployment_jobs read own"
  on public.deployment_jobs for select
  using (auth.uid() = user_id);

-- Tenants can insert/update their own jobs (control plane writes).
-- Workers should run with the service role and bypass RLS entirely.
create policy "deployment_jobs insert own"
  on public.deployment_jobs for insert
  with check (auth.uid() = user_id);

create policy "deployment_jobs update own"
  on public.deployment_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: parent_deployment_id on deployments (used by retries).
alter table public.deployments
  add column if not exists parent_deployment_id uuid
    references public.deployments(id) on delete set null;
`;

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

export function isMissingTable(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("not found")
  );
}

export function isMissingColumn(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("column") && (m.includes("does not exist") || m.includes("not found"));
}

export function generateCommitSha(length = 7): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < length; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
//  Project ownership lookup
// ---------------------------------------------------------------------------

export type LoadProjectResult =
  | { ok: true; project: ProjectMiniRow }
  | { ok: false; status: number; error: string; message: string };

export async function loadOwnedProject(
  client: SupabaseClient,
  args: { projectId: string; userId: string },
): Promise<LoadProjectResult> {
  if (!args.projectId) {
    return {
      ok: false,
      status: 400,
      error: "missing_project_id",
      message: "project_id is required.",
    };
  }
  // Try the rich projection first (Phase 6B columns). If a column is missing,
  // fall back to the slim shape so older schemas keep working.
  const rich = await client
    .from("projects")
    .select(
      "id, user_id, name, slug, repo_url, default_branch, framework, install_command, build_command, build_output_dir, node_version, hosting_kind, runtime_kind",
    )
    .eq("id", args.projectId)
    .eq("user_id", args.userId)
    .maybeSingle();

  let data = rich.data as ProjectMiniRow | null;
  let error = rich.error;

  if (error && isMissingColumn(error.message)) {
    const slim = await client
      .from("projects")
      .select("id, user_id, name, slug")
      .eq("id", args.projectId)
      .eq("user_id", args.userId)
      .maybeSingle();
    data = slim.data as ProjectMiniRow | null;
    error = slim.error;
  }

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        ok: false,
        status: 503,
        error: "projects_table_missing",
        message: "projects table is not provisioned.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "projects_lookup_failed",
      message: `projects lookup failed: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "project_not_found",
      message: "Project not found or not owned by caller.",
    };
  }
  return { ok: true, project: data as ProjectMiniRow };
}

// ---------------------------------------------------------------------------
//  Deployment row creation
// ---------------------------------------------------------------------------

export type CreateDeploymentArgs = {
  userId: string;
  projectId: string;
  branch?: string;
  commitSha?: string;
  parentDeploymentId?: string | null;
  buildLogs?: string;
};

export type CreateDeploymentResult =
  | { ok: true; deployment: DeploymentRow; commitSha: string; branch: string }
  | { ok: false; status: number; error: string; message: string };

export async function createDeploymentRow(
  client: SupabaseClient,
  args: CreateDeploymentArgs,
): Promise<CreateDeploymentResult> {
  const branch = (args.branch ?? "main").toString().trim() || "main";
  const commitSha = (args.commitSha ?? generateCommitSha()).toString().trim();
  const startedAt = new Date().toISOString();

  const fullPayload: Record<string, unknown> = {
    user_id: args.userId,
    project_id: args.projectId,
    status: "queued",
    branch,
    commit_sha: commitSha,
    deployment_url: null,
    build_logs: args.buildLogs ?? "Build job queued by GTLNAV control plane.",
    started_at: startedAt,
  };
  if (args.parentDeploymentId) {
    fullPayload.parent_deployment_id = args.parentDeploymentId;
  }

  let res = await client
    .from("deployments")
    .insert(fullPayload)
    .select(
      "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at, parent_deployment_id",
    )
    .single();

  // Schema-tolerant retry without optional columns.
  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "deployments_table_missing",
        message: "deployments table is not provisioned.",
      };
    }
    const minimal = {
      user_id: args.userId,
      project_id: args.projectId,
      status: "queued",
      branch,
      build_logs: args.buildLogs ?? "Build job queued by GTLNAV control plane.",
    };
    res = await client
      .from("deployments")
      .insert(minimal)
      .select(
        "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at",
      )
      .single();
  }

  if (res.error || !res.data) {
    return {
      ok: false,
      status: 500,
      error: "deployment_insert_failed",
      message: res.error?.message ?? "Failed to insert deployment row.",
    };
  }

  return {
    ok: true,
    deployment: res.data as DeploymentRow,
    commitSha,
    branch,
  };
}

// ---------------------------------------------------------------------------
//  deployment_jobs insert (best-effort)
// ---------------------------------------------------------------------------

export type CreateDeploymentJobArgs = {
  deploymentId: string;
  userId: string;
  projectId: string;
  payload: Record<string, unknown>;
  attempt?: number;
};

export type CreateDeploymentJobResult =
  | { ok: true; job: DeploymentJobRow }
  | { ok: false; missingTable: true; message: string }
  | { ok: false; missingTable: false; status: number; message: string };

export async function createDeploymentJob(
  client: SupabaseClient,
  args: CreateDeploymentJobArgs,
): Promise<CreateDeploymentJobResult> {
  const insert = {
    deployment_id: args.deploymentId,
    user_id: args.userId,
    project_id: args.projectId,
    status: DEPLOYMENT_JOB_PENDING,
    attempt: args.attempt ?? 1,
    payload: args.payload,
  };
  const res = await client
    .from("deployment_jobs")
    .insert(insert)
    .select(
      "id, deployment_id, user_id, project_id, status, attempt, claimed_by, claimed_at, started_at, finished_at, error_message, payload, result, created_at, updated_at",
    )
    .single();

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        missingTable: true,
        message:
          "deployment_jobs table is not provisioned. The deployment was queued but no worker can pick it up.",
      };
    }
    return {
      ok: false,
      missingTable: false,
      status: 500,
      message: `deployment_jobs insert failed: ${res.error.message}`,
    };
  }
  return { ok: true, job: res.data as DeploymentJobRow };
}

// ---------------------------------------------------------------------------
//  Deployment lookup
// ---------------------------------------------------------------------------

export type LoadDeploymentResult =
  | { ok: true; deployment: DeploymentRow; job: DeploymentJobRow | null; jobsTableMissing: boolean }
  | { ok: false; status: number; error: string; message: string };

export async function loadOwnedDeployment(
  client: SupabaseClient,
  args: { deploymentId: string; userId: string },
): Promise<LoadDeploymentResult> {
  if (!args.deploymentId) {
    return {
      ok: false,
      status: 400,
      error: "missing_deployment_id",
      message: "deployment_id is required.",
    };
  }
  const dep = await client
    .from("deployments")
    .select(
      "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at, parent_deployment_id",
    )
    .eq("id", args.deploymentId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (dep.error) {
    if (isMissingTable(dep.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "deployments_table_missing",
        message: "deployments table is not provisioned.",
      };
    }
    // parent_deployment_id may be missing; retry without it.
    if (isMissingColumn(dep.error.message)) {
      const retry = await client
        .from("deployments")
        .select(
          "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at",
        )
        .eq("id", args.deploymentId)
        .eq("user_id", args.userId)
        .maybeSingle();
      if (retry.error || !retry.data) {
        return {
          ok: false,
          status: 500,
          error: "deployment_lookup_failed",
          message: retry.error?.message ?? "deployment lookup failed.",
        };
      }
      return finishLoadOwned(client, retry.data as DeploymentRow, args);
    }
    return {
      ok: false,
      status: 500,
      error: "deployment_lookup_failed",
      message: dep.error.message,
    };
  }

  if (!dep.data) {
    return {
      ok: false,
      status: 404,
      error: "deployment_not_found",
      message: "Deployment not found or not owned by caller.",
    };
  }

  return finishLoadOwned(client, dep.data as DeploymentRow, args);
}

async function finishLoadOwned(
  client: SupabaseClient,
  deployment: DeploymentRow,
  args: { deploymentId: string; userId: string },
): Promise<LoadDeploymentResult> {
  const jobRes = await client
    .from("deployment_jobs")
    .select(
      "id, deployment_id, user_id, project_id, status, attempt, claimed_by, claimed_at, started_at, finished_at, error_message, payload, result, created_at, updated_at",
    )
    .eq("deployment_id", args.deploymentId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobRes.error) {
    if (isMissingTable(jobRes.error.message)) {
      return { ok: true, deployment, job: null, jobsTableMissing: true };
    }
    return { ok: true, deployment, job: null, jobsTableMissing: false };
  }
  return {
    ok: true,
    deployment,
    job: (jobRes.data ?? null) as DeploymentJobRow | null,
    jobsTableMissing: false,
  };
}

// ---------------------------------------------------------------------------
//  Cancel
// ---------------------------------------------------------------------------

export type CancelResult =
  | { ok: true; deployment: DeploymentRow; jobUpdated: boolean }
  | { ok: false; status: number; error: string; message: string };

export async function cancelDeployment(
  client: SupabaseClient,
  args: { deploymentId: string; userId: string },
): Promise<CancelResult> {
  const loaded = await loadOwnedDeployment(client, args);
  if (!loaded.ok) return loaded;

  const status = (loaded.deployment.status ?? "").toLowerCase();
  if (
    (DEPLOYMENT_TERMINAL_STATUSES as readonly string[]).includes(status) &&
    status !== "canceled"
  ) {
    return {
      ok: false,
      status: 409,
      error: "not_cancelable",
      message: `Deployment is already in terminal status "${status}".`,
    };
  }

  const finishedAt = new Date().toISOString();
  const updated = await client
    .from("deployments")
    .update({ status: "canceled", finished_at: finishedAt })
    .eq("id", args.deploymentId)
    .eq("user_id", args.userId)
    .select(
      "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at",
    )
    .maybeSingle();

  if (updated.error || !updated.data) {
    return {
      ok: false,
      status: 500,
      error: "deployment_update_failed",
      message: updated.error?.message ?? "Failed to cancel deployment.",
    };
  }

  let jobUpdated = false;
  if (loaded.job && !DEPLOYMENT_JOB_TERMINAL_STATUSES.includes(
    loaded.job.status as DeploymentJobStatus,
  )) {
    const jobUpd = await client
      .from("deployment_jobs")
      .update({
        status: DEPLOYMENT_JOB_CANCELED,
        finished_at: finishedAt,
        updated_at: finishedAt,
      })
      .eq("id", loaded.job.id)
      .eq("user_id", args.userId);
    jobUpdated = !jobUpd.error;
  }

  return { ok: true, deployment: updated.data as DeploymentRow, jobUpdated };
}

// ---------------------------------------------------------------------------
//  Audit log helper
// ---------------------------------------------------------------------------

export async function logInfra(
  client: SupabaseClient,
  args: {
    /** May be null for control-plane-level events that have no owning user. */
    userId: string | null;
    projectId: string | null;
    eventType: string;
    severity: "info" | "warning" | "error" | "success";
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const fullPayload = {
    user_id: args.userId,
    project_id: args.projectId,
    event_type: args.eventType,
    level: args.severity,
    severity: args.severity,
    message: args.message,
    source: "deployment_api",
    metadata: args.metadata ?? {},
  };
  const res = await client.from("infrastructure_logs").insert(fullPayload);
  if (!res.error) return;
  const minimal = {
    user_id: args.userId,
    project_id: args.projectId,
    event_type: args.eventType,
    severity: args.severity,
    message: args.message,
  };
  const retry = await client.from("infrastructure_logs").insert(minimal);
  if (retry.error && process.env.NODE_ENV !== "production") {
    console.warn(
      "[gtlnav/server-deployments] infrastructure_logs insert failed:",
      retry.error.message,
    );
  }
}
