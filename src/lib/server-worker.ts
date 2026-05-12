/**
 * GTLNAV — server-side worker queue helpers.
 *
 * Workers (external VPS / runner / coolify / dokploy hooks) call into the
 * `/api/worker/*` endpoints. Those endpoints delegate to this module which:
 *
 *   - Atomically claims the oldest pending row in `public.deployment_jobs`
 *     using a compare-and-swap UPDATE (SKIP-LOCKED equivalent that works
 *     over PostgREST without a custom RPC).
 *   - Appends worker logs to `public.infrastructure_logs`.
 *   - Mirrors job progress into `public.deployments.status` and (when
 *     finished) `public.projects.live_url` / `public.projects.status`.
 *   - Marks jobs as succeeded or failed and stamps the final state.
 *
 * Schema-tolerant:
 *   - If `deployment_jobs` is missing, `claimNextJob` returns
 *     { missingTable: true } and routes return 503 + setup_sql.
 *   - Optional columns on `projects` (live_url, status) are retried with a
 *     minimal payload when the column doesn't exist.
 *
 * Server-only: throws if imported from a 'use client' component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEPLOYMENT_JOB_CANCELED,
  DEPLOYMENT_JOB_CLAIMED,
  DEPLOYMENT_JOB_FAILED,
  DEPLOYMENT_JOB_PENDING,
  DEPLOYMENT_JOB_RUNNING,
  DEPLOYMENT_JOB_SUCCEEDED,
  DEPLOYMENT_JOB_TERMINAL_STATUSES,
  DEPLOYMENT_INFLIGHT_STATUSES,
  DEPLOYMENT_TERMINAL_STATUSES,
  isMissingColumn,
  isMissingTable,
  type DeploymentJobRow,
  type DeploymentJobStatus,
  type DeploymentRow,
} from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-worker.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const DEPLOYMENT_JOB_SELECT =
  "id, deployment_id, user_id, project_id, status, attempt, claimed_by, claimed_at, started_at, finished_at, error_message, payload, result, created_at, updated_at";

const DEPLOYMENT_SELECT =
  "id, user_id, project_id, status, branch, commit_sha, deployment_url, build_logs, started_at, finished_at, created_at";

const KNOWN_DEPLOYMENT_STATUSES = new Set<string>([
  ...DEPLOYMENT_INFLIGHT_STATUSES,
  ...DEPLOYMENT_TERMINAL_STATUSES,
]);

const KNOWN_JOB_STATUSES = new Set<DeploymentJobStatus>([
  DEPLOYMENT_JOB_PENDING,
  DEPLOYMENT_JOB_CLAIMED,
  DEPLOYMENT_JOB_RUNNING,
  DEPLOYMENT_JOB_SUCCEEDED,
  DEPLOYMENT_JOB_FAILED,
  DEPLOYMENT_JOB_CANCELED,
]);

const ALLOWED_LOG_LEVELS = new Set([
  "debug",
  "info",
  "notice",
  "warning",
  "warn",
  "error",
  "success",
  "critical",
]);

const MAX_LOG_MESSAGE_LENGTH = 8000;
const MAX_LOG_BATCH = 200;
const CLAIM_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type WorkerLogInput = {
  level?: string | null;
  message: string;
  source?: string | null;
  timestamp?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ClaimNextJobArgs = {
  workerLabel: string;
  /** When non-null, only claim jobs owned by this user. */
  scopeUserId: string | null;
  capabilities?: unknown;
  /**
   * Phase 6C — capability-aware job routing.
   *
   * When non-empty, skip jobs whose `payload->>kind` matches any of these
   * values. NULL kinds and the string `"deploy"` are always included so
   * older deployment jobs that pre-date the kind field still get claimed.
   *
   * Used by `app/api/worker/claim-job/route.ts` so a static-only worker
   * never claims a `runtime_action` job and burns it.
   */
  excludeKinds?: readonly string[] | null;
};

export type ClaimNextJobResult =
  | { ok: true; job: DeploymentJobRow | null }
  | { ok: false; missingTable: true; message: string }
  | { ok: false; missingTable: false; status: number; error: string; message: string };

export type LoadJobArgs = {
  jobId: string;
  /** When non-null, the job's user_id must match this. */
  scopeUserId: string | null;
};

export type LoadJobResult =
  | { ok: true; job: DeploymentJobRow }
  | { ok: false; missingTable: true; message: string }
  | { ok: false; missingTable: false; status: number; error: string; message: string };

export type AppendLogsArgs = {
  job: DeploymentJobRow;
  logs: WorkerLogInput[];
  workerLabel: string;
};

export type AppendLogsResult =
  | { ok: true; inserted: number }
  | { ok: false; status: number; error: string; message: string };

export type ApplyStatusArgs = {
  job: DeploymentJobRow;
  /** Update `deployments.status` to this value (and timestamps). */
  deploymentStatus?: string | null;
  /**
   * Update `deployment_jobs.status` to this value. If omitted but
   * deploymentStatus is provided, we promote the job to "running" the first
   * time it transitions out of "claimed".
   */
  jobStatus?: DeploymentJobStatus | null;
  workerLabel: string;
};

export type ApplyStatusResult =
  | {
      ok: true;
      deployment: DeploymentRow | null;
      job: DeploymentJobRow;
      deploymentStatus: string | null;
      jobStatus: DeploymentJobStatus;
    }
  | { ok: false; status: number; error: string; message: string };

export type CompleteJobArgs = {
  job: DeploymentJobRow;
  deploymentUrl?: string | null;
  result?: Record<string, unknown> | null;
  workerLabel: string;
};

export type CompleteJobResult =
  | {
      ok: true;
      deployment: DeploymentRow | null;
      job: DeploymentJobRow;
      deploymentUrl: string | null;
    }
  | { ok: false; status: number; error: string; message: string };

export type FailJobArgs = {
  job: DeploymentJobRow;
  errorMessage: string;
  result?: Record<string, unknown> | null;
  workerLabel: string;
};

export type FailJobResult =
  | { ok: true; deployment: DeploymentRow | null; job: DeploymentJobRow }
  | { ok: false; status: number; error: string; message: string };

// ---------------------------------------------------------------------------
//  Public: claim next job (atomic CAS)
// ---------------------------------------------------------------------------

export async function claimNextJob(
  client: SupabaseClient,
  args: ClaimNextJobArgs,
): Promise<ClaimNextJobResult> {
  const claimedAt = () => new Date().toISOString();

  // Phase 6C — derive a PostgREST .or() clause that allows NULL kinds (legacy
  // deploy jobs) plus any kind NOT in excludeKinds. When excludeKinds is
  // empty we don't filter at all.
  const excludeKinds = (args.excludeKinds ?? []).filter(
    (k) => typeof k === "string" && k.length > 0,
  );
  const kindOrClause =
    excludeKinds.length > 0
      ? // Allow rows where `payload->>kind` is null OR explicitly equal to
        // "deploy". Anything else (e.g. "runtime_action") is skipped.
        `payload->>kind.is.null,payload->>kind.eq.deploy`
      : null;

  for (let attempt = 0; attempt < CLAIM_MAX_ATTEMPTS; attempt++) {
    let candidateQuery = client
      .from("deployment_jobs")
      .select(DEPLOYMENT_JOB_SELECT)
      .eq("status", DEPLOYMENT_JOB_PENDING)
      .order("created_at", { ascending: true })
      .limit(1);
    if (args.scopeUserId) {
      candidateQuery = candidateQuery.eq("user_id", args.scopeUserId);
    }
    if (kindOrClause) {
      candidateQuery = candidateQuery.or(kindOrClause);
    }

    const candidate = await candidateQuery.maybeSingle();
    if (candidate.error) {
      if (isMissingTable(candidate.error.message)) {
        return {
          ok: false,
          missingTable: true,
          message:
            "deployment_jobs table is not provisioned. Workers cannot claim jobs until the queue is created.",
        };
      }
      return {
        ok: false,
        missingTable: false,
        status: 500,
        error: "claim_lookup_failed",
        message: candidate.error.message,
      };
    }
    if (!candidate.data) {
      return { ok: true, job: null };
    }

    const cand = candidate.data as DeploymentJobRow;
    const now = claimedAt();

    // Compare-and-swap: only succeed if the row is still pending.
    let casQuery = client
      .from("deployment_jobs")
      .update({
        status: DEPLOYMENT_JOB_CLAIMED,
        claimed_by: args.workerLabel,
        claimed_at: now,
        started_at: cand.started_at ?? now,
        updated_at: now,
      })
      .eq("id", cand.id)
      .eq("status", DEPLOYMENT_JOB_PENDING);
    if (args.scopeUserId) {
      casQuery = casQuery.eq("user_id", args.scopeUserId);
    }

    const claim = await casQuery.select(DEPLOYMENT_JOB_SELECT).maybeSingle();
    if (claim.error) {
      if (isMissingTable(claim.error.message)) {
        return {
          ok: false,
          missingTable: true,
          message: "deployment_jobs table is not provisioned.",
        };
      }
      return {
        ok: false,
        missingTable: false,
        status: 500,
        error: "claim_update_failed",
        message: claim.error.message,
      };
    }
    if (claim.data) {
      return { ok: true, job: claim.data as DeploymentJobRow };
    }
    // Race lost: another worker grabbed it. Try the next candidate.
  }

  // After repeated contention, return null queue rather than 500.
  return { ok: true, job: null };
}

// ---------------------------------------------------------------------------
//  Public: load a job by id (with optional user scope)
// ---------------------------------------------------------------------------

export async function loadJobForWorker(
  client: SupabaseClient,
  args: LoadJobArgs,
): Promise<LoadJobResult> {
  if (!args.jobId) {
    return {
      ok: false,
      missingTable: false,
      status: 400,
      error: "missing_job_id",
      message: "job_id is required.",
    };
  }

  let query = client
    .from("deployment_jobs")
    .select(DEPLOYMENT_JOB_SELECT)
    .eq("id", args.jobId)
    .limit(1);
  if (args.scopeUserId) {
    query = query.eq("user_id", args.scopeUserId);
  }

  const res = await query.maybeSingle();
  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        missingTable: true,
        message:
          "deployment_jobs table is not provisioned. Worker progress cannot be persisted.",
      };
    }
    return {
      ok: false,
      missingTable: false,
      status: 500,
      error: "job_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return {
      ok: false,
      missingTable: false,
      status: 404,
      error: "job_not_found",
      message: "deployment_jobs row not found or not in worker scope.",
    };
  }
  return { ok: true, job: res.data as DeploymentJobRow };
}

// ---------------------------------------------------------------------------
//  Public: append logs
// ---------------------------------------------------------------------------

export async function appendDeploymentLogs(
  client: SupabaseClient,
  args: AppendLogsArgs,
): Promise<AppendLogsResult> {
  if (!Array.isArray(args.logs) || args.logs.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const truncated = args.logs.slice(0, MAX_LOG_BATCH);
  const rows = truncated
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const message = (entry.message ?? "").toString();
      if (!message.trim()) return null;
      const lvlRaw = (entry.level ?? "info").toString().toLowerCase();
      const level = ALLOWED_LOG_LEVELS.has(lvlRaw) ? lvlRaw : "info";
      const severity =
        level === "error" || level === "critical"
          ? "error"
          : level === "warning" || level === "warn"
            ? "warning"
            : level === "success"
              ? "success"
              : "info";
      return {
        user_id: args.job.user_id,
        project_id: args.job.project_id,
        event_type: "deployment_log",
        level: level === "warn" ? "warning" : level,
        severity,
        message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
        source: (entry.source ?? "worker").toString().slice(0, 64),
        metadata: {
          job_id: args.job.id,
          deployment_id: args.job.deployment_id,
          worker_label: args.workerLabel,
          worker_timestamp: entry.timestamp ?? null,
          ...(entry.metadata && typeof entry.metadata === "object"
            ? (entry.metadata as Record<string, unknown>)
            : {}),
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    return { ok: true, inserted: 0 };
  }

  let res = await client.from("infrastructure_logs").insert(rows);
  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "infrastructure_logs_table_missing",
        message:
          "infrastructure_logs table is not provisioned. Worker logs cannot be persisted.",
      };
    }
    const minimalRows = rows.map((r) => ({
      user_id: r.user_id,
      project_id: r.project_id,
      event_type: r.event_type,
      severity: r.severity,
      message: r.message,
    }));
    res = await client.from("infrastructure_logs").insert(minimalRows);
  }

  if (res.error) {
    return {
      ok: false,
      status: 500,
      error: "log_insert_failed",
      message: res.error.message,
    };
  }
  return { ok: true, inserted: rows.length };
}

// ---------------------------------------------------------------------------
//  Public: apply status update
// ---------------------------------------------------------------------------

export async function applyJobStatus(
  client: SupabaseClient,
  args: ApplyStatusArgs,
): Promise<ApplyStatusResult> {
  const job = args.job;
  if (DEPLOYMENT_JOB_TERMINAL_STATUSES.includes(job.status as DeploymentJobStatus)) {
    return {
      ok: false,
      status: 409,
      error: "job_terminal",
      message: `Job is already in terminal status "${job.status}".`,
    };
  }

  const now = new Date().toISOString();

  // Resolve next job status.
  let jobStatus: DeploymentJobStatus = job.status as DeploymentJobStatus;
  if (args.jobStatus && KNOWN_JOB_STATUSES.has(args.jobStatus)) {
    jobStatus = args.jobStatus;
  } else if (args.deploymentStatus && job.status === DEPLOYMENT_JOB_CLAIMED) {
    // Auto-promote claimed → running on first status push.
    jobStatus = DEPLOYMENT_JOB_RUNNING;
  }

  // 1. Update job row.
  const jobUpdate: Record<string, unknown> = {
    status: jobStatus,
    updated_at: now,
  };
  if (jobStatus === DEPLOYMENT_JOB_RUNNING && !job.started_at) {
    jobUpdate.started_at = now;
  }

  const jobRes = await client
    .from("deployment_jobs")
    .update(jobUpdate)
    .eq("id", job.id)
    .select(DEPLOYMENT_JOB_SELECT)
    .maybeSingle();

  if (jobRes.error || !jobRes.data) {
    return {
      ok: false,
      status: 500,
      error: "job_update_failed",
      message: jobRes.error?.message ?? "Failed to update deployment_jobs row.",
    };
  }
  const updatedJob = jobRes.data as DeploymentJobRow;

  // 2. Optionally update deployment row.
  let deployment: DeploymentRow | null = null;
  let deploymentStatus: string | null = null;
  if (args.deploymentStatus) {
    const desired = args.deploymentStatus.toString().toLowerCase().trim();
    if (!desired) {
      // ignore empty
    } else if (
      !KNOWN_DEPLOYMENT_STATUSES.has(desired) &&
      !DEPLOYMENT_TERMINAL_STATUSES.includes(desired as (typeof DEPLOYMENT_TERMINAL_STATUSES)[number])
    ) {
      // Reject obviously bogus values; allow any inflight/terminal value.
      return {
        ok: false,
        status: 400,
        error: "invalid_deployment_status",
        message: `deployment_status "${desired}" is not a recognized value. Allowed: ${[
          ...DEPLOYMENT_INFLIGHT_STATUSES,
          ...DEPLOYMENT_TERMINAL_STATUSES,
        ].join(", ")}.`,
      };
    } else {
      const depUpdate: Record<string, unknown> = {
        status: desired,
      };
      if (
        (DEPLOYMENT_TERMINAL_STATUSES as readonly string[]).includes(desired)
      ) {
        depUpdate.finished_at = now;
      }

      const depRes = await client
        .from("deployments")
        .update(depUpdate)
        .eq("id", job.deployment_id)
        .eq("user_id", job.user_id)
        .select(DEPLOYMENT_SELECT)
        .maybeSingle();
      if (!depRes.error && depRes.data) {
        deployment = depRes.data as DeploymentRow;
        deploymentStatus = desired;
      } else if (depRes.error) {
        return {
          ok: false,
          status: 500,
          error: "deployment_update_failed",
          message: depRes.error.message,
        };
      }
    }
  }

  return {
    ok: true,
    deployment,
    job: updatedJob,
    deploymentStatus,
    jobStatus,
  };
}

// ---------------------------------------------------------------------------
//  Public: complete job
// ---------------------------------------------------------------------------

export async function completeJob(
  client: SupabaseClient,
  args: CompleteJobArgs,
): Promise<CompleteJobResult> {
  const job = args.job;
  if (DEPLOYMENT_JOB_TERMINAL_STATUSES.includes(job.status as DeploymentJobStatus)) {
    return {
      ok: false,
      status: 409,
      error: "job_terminal",
      message: `Job is already in terminal status "${job.status}".`,
    };
  }

  const now = new Date().toISOString();
  const deploymentUrl = sanitizeUrl(args.deploymentUrl);

  // 1. Mark job succeeded.
  const jobRes = await client
    .from("deployment_jobs")
    .update({
      status: DEPLOYMENT_JOB_SUCCEEDED,
      finished_at: now,
      updated_at: now,
      result: args.result ?? null,
    })
    .eq("id", job.id)
    .select(DEPLOYMENT_JOB_SELECT)
    .maybeSingle();

  if (jobRes.error || !jobRes.data) {
    return {
      ok: false,
      status: 500,
      error: "job_update_failed",
      message: jobRes.error?.message ?? "Failed to mark deployment_job as succeeded.",
    };
  }
  const updatedJob = jobRes.data as DeploymentJobRow;

  // 2. Mark deployment active + url + finished_at.
  const depPayload: Record<string, unknown> = {
    status: "active",
    finished_at: now,
  };
  if (deploymentUrl) {
    depPayload.deployment_url = deploymentUrl;
  }

  let depRes = await client
    .from("deployments")
    .update(depPayload)
    .eq("id", job.deployment_id)
    .eq("user_id", job.user_id)
    .select(DEPLOYMENT_SELECT)
    .maybeSingle();

  if (depRes.error && isMissingColumn(depRes.error.message)) {
    const minimal: Record<string, unknown> = { status: "active" };
    depRes = await client
      .from("deployments")
      .update(minimal)
      .eq("id", job.deployment_id)
      .eq("user_id", job.user_id)
      .select(DEPLOYMENT_SELECT)
      .maybeSingle();
  }

  const deployment =
    !depRes.error && depRes.data ? (depRes.data as DeploymentRow) : null;

  // 3. Best-effort: bump projects.live_url + status. Ignore errors.
  if (deploymentUrl) {
    await updateProjectLive(client, {
      projectId: job.project_id,
      userId: job.user_id,
      liveUrl: deploymentUrl,
      status: "active",
    });
  } else {
    await updateProjectLive(client, {
      projectId: job.project_id,
      userId: job.user_id,
      liveUrl: null,
      status: "active",
    });
  }

  return {
    ok: true,
    deployment,
    job: updatedJob,
    deploymentUrl,
  };
}

// ---------------------------------------------------------------------------
//  Public: fail job
// ---------------------------------------------------------------------------

export async function failJob(
  client: SupabaseClient,
  args: FailJobArgs,
): Promise<FailJobResult> {
  const job = args.job;
  if (DEPLOYMENT_JOB_TERMINAL_STATUSES.includes(job.status as DeploymentJobStatus)) {
    return {
      ok: false,
      status: 409,
      error: "job_terminal",
      message: `Job is already in terminal status "${job.status}".`,
    };
  }

  const now = new Date().toISOString();
  const errorMessage = (args.errorMessage ?? "")
    .toString()
    .slice(0, MAX_LOG_MESSAGE_LENGTH);

  const jobRes = await client
    .from("deployment_jobs")
    .update({
      status: DEPLOYMENT_JOB_FAILED,
      finished_at: now,
      updated_at: now,
      error_message: errorMessage || null,
      result: args.result ?? null,
    })
    .eq("id", job.id)
    .select(DEPLOYMENT_JOB_SELECT)
    .maybeSingle();

  if (jobRes.error || !jobRes.data) {
    return {
      ok: false,
      status: 500,
      error: "job_update_failed",
      message: jobRes.error?.message ?? "Failed to mark deployment_job as failed.",
    };
  }
  const updatedJob = jobRes.data as DeploymentJobRow;

  let depRes = await client
    .from("deployments")
    .update({ status: "failed", finished_at: now })
    .eq("id", job.deployment_id)
    .eq("user_id", job.user_id)
    .select(DEPLOYMENT_SELECT)
    .maybeSingle();

  if (depRes.error && isMissingColumn(depRes.error.message)) {
    depRes = await client
      .from("deployments")
      .update({ status: "failed" })
      .eq("id", job.deployment_id)
      .eq("user_id", job.user_id)
      .select(DEPLOYMENT_SELECT)
      .maybeSingle();
  }

  const deployment =
    !depRes.error && depRes.data ? (depRes.data as DeploymentRow) : null;

  await updateProjectLive(client, {
    projectId: job.project_id,
    userId: job.user_id,
    liveUrl: null,
    status: "error",
  });

  return { ok: true, deployment, job: updatedJob };
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

async function updateProjectLive(
  client: SupabaseClient,
  args: {
    projectId: string;
    userId: string;
    liveUrl: string | null;
    status: string;
  },
): Promise<void> {
  const fullPayload: Record<string, unknown> = { status: args.status };
  if (args.liveUrl) fullPayload.live_url = args.liveUrl;

  const res = await client
    .from("projects")
    .update(fullPayload)
    .eq("id", args.projectId)
    .eq("user_id", args.userId);

  if (!res.error) return;

  // Schema-tolerant retry.
  if (isMissingColumn(res.error.message) || isMissingTable(res.error.message)) {
    if (isMissingTable(res.error.message)) return; // nothing we can do
    const fallback: Record<string, unknown> = {};
    if (args.liveUrl) fallback.live_url = args.liveUrl;
    if (Object.keys(fallback).length === 0) return;
    await client
      .from("projects")
      .update(fallback)
      .eq("id", args.projectId)
      .eq("user_id", args.userId);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[gtlnav/server-worker] projects update failed:", res.error.message);
  }
}

function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.length > 2048) return null;
  return trimmed;
}
