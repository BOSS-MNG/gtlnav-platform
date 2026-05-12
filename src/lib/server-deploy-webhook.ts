/**
 * GTLNAV — deploy webhook (POST /api/hooks/deploy/[hookId]) helpers.
 *
 * Server-only: verifies hook secrets (hashed at rest like API keys) and
 * optionally GitHub `x-hub-signature-256` when the plaintext hook secret is
 * available on the request (header or URL query — GitHub allows query params
 * on the webhook URL).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  constantTimeHashEqual,
  hashApiKey,
} from "./server-api-keys";
import {
  createDeploymentJob,
  createDeploymentRow,
  DEPLOYMENT_JOBS_SCHEMA_SQL,
  isMissingColumn,
  isMissingTable,
  loadOwnedProject,
  logInfra,
} from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-deploy-webhook.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

export type DeployHookRow = {
  id: string;
  user_id: string;
  project_id: string;
  name: string | null;
  branch: string;
  secret_prefix: string | null;
  secret_hash: string;
  status: string | null;
  revoked_at: string | null;
  metadata: Record<string, unknown> | null;
  last_triggered_at: string | null;
  created_at: string | null;
};

export type LoadDeployHookResult =
  | { ok: true; hook: DeployHookRow }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; status: number; error: string; message: string };

const HOOK_SELECT =
  "id, user_id, project_id, name, branch, secret_prefix, secret_hash, status, revoked_at, metadata, last_triggered_at, created_at";

export async function loadDeployHookById(
  client: SupabaseClient,
  hookId: string,
): Promise<LoadDeployHookResult> {
  if (!hookId || !/^[0-9a-f-]{36}$/i.test(hookId)) {
    return {
      ok: false,
      notFound: false,
      status: 400,
      error: "invalid_hook_id",
      message: "hookId must be a UUID.",
    };
  }

  const res = await client
    .from("deploy_hooks")
    .select(HOOK_SELECT)
    .eq("id", hookId)
    .maybeSingle();

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        notFound: false,
        status: 503,
        error: "deploy_hooks_table_missing",
        message:
          "deploy_hooks table is not provisioned. Run the SQL from the Webhooks console setup panel.",
      };
    }
    return {
      ok: false,
      notFound: false,
      status: 500,
      error: "deploy_hook_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return { ok: false, notFound: true };
  }

  const row = res.data as Record<string, unknown>;
  const hook: DeployHookRow = {
    id: String(row.id),
    user_id: String(row.user_id),
    project_id: String(row.project_id),
    name: row.name != null ? String(row.name) : null,
    branch: (row.branch != null ? String(row.branch) : "main").trim() || "main",
    secret_prefix: row.secret_prefix != null ? String(row.secret_prefix) : null,
    secret_hash: String(row.secret_hash ?? ""),
    status: row.status != null ? String(row.status) : null,
    revoked_at: row.revoked_at != null ? String(row.revoked_at) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    last_triggered_at:
      row.last_triggered_at != null ? String(row.last_triggered_at) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
  };

  return { ok: true, hook };
}

export function isHookRevoked(hook: DeployHookRow): boolean {
  const st = (hook.status ?? "").toLowerCase().trim();
  if (st === "revoked") return true;
  if (hook.revoked_at) return true;
  return false;
}

export type HookSecretVerifyResult =
  | { ok: true; plaintextSecret: string }
  | { ok: false; reason: "missing_secret" | "hash_mismatch" | "github_signature_invalid" };

/**
 * Verifies the caller-supplied plaintext hook secret against `secret_hash`
 * (same `sha256:<hex>` format as the Webhooks console). When GitHub sends
 * `x-hub-signature-256`, we verify HMAC-SHA256(rawBody, plaintextSecret)
 * matches that header (GitHub's webhook "Secret" must equal the plaintext
 * hook key).
 */
export function verifyDeployHookSecretAndGithubSignature(args: {
  hook: DeployHookRow;
  plaintextSecret: string | null | undefined;
  rawBodyUtf8: string;
  hubSignature256: string | null;
}): HookSecretVerifyResult {
  const secret = (args.plaintextSecret ?? "").trim();
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }

  const computedHash = hashApiKey(secret);
  if (!constantTimeHashEqual(computedHash, args.hook.secret_hash)) {
    return { ok: false, reason: "hash_mismatch" };
  }

  const ghSig = (args.hubSignature256 ?? "").trim();
  if (!ghSig) {
    return { ok: true, plaintextSecret: secret };
  }

  const match = /^sha256=(.+)$/i.exec(ghSig);
  const theirHex = match?.[1]?.trim().toLowerCase();
  if (!theirHex || !/^[0-9a-f]{64}$/.test(theirHex)) {
    return { ok: false, reason: "github_signature_invalid" };
  }

  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(theirHex, "hex");
  } catch {
    return { ok: false, reason: "github_signature_invalid" };
  }
  const expectedBuf = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(args.rawBodyUtf8, "utf8")
    .digest();
  if (receivedBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "github_signature_invalid" };
  }
  try {
    if (!timingSafeEqual(expectedBuf, receivedBuf)) {
      return { ok: false, reason: "github_signature_invalid" };
    }
  } catch {
    return { ok: false, reason: "github_signature_invalid" };
  }

  return { ok: true, plaintextSecret: secret };
}

/** GitHub / GitLab push-style `refs/heads/<branch>`. */
export function branchFromWebhookRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const r = ref.trim();
  if (!r) return null;
  if (r.startsWith("refs/heads/")) {
    const b = r.slice("refs/heads/".length).trim();
    return b.length > 0 ? b : null;
  }
  return null;
}

export function normalizeBranchName(value: string): string {
  return value.trim().toLowerCase();
}

export type QueueFromHookResult =
  | {
      ok: true;
      deployment_id: string;
      job_id: string | null;
      branch: string;
      commit_sha: string;
      warning?: string;
      setup_sql?: string;
    }
  | { ok: false; status: number; error: string; message: string };

/**
 * Creates a queued deployment + pending job using the same data path as
 * POST /api/deployments/start (no timers, no in-process build).
 */
export async function queueDeploymentFromDeployHook(
  client: SupabaseClient,
  args: {
    hook: DeployHookRow;
    branch: string;
    commitSha?: string | null;
    webhookPayload: Record<string, unknown>;
  },
): Promise<QueueFromHookResult> {
  const project = await loadOwnedProject(client, {
    projectId: args.hook.project_id,
    userId: args.hook.user_id,
  });
  if (!project.ok) {
    return {
      ok: false,
      status: project.status,
      error: project.error,
      message: project.message,
    };
  }

  const created = await createDeploymentRow(client, {
    userId: args.hook.user_id,
    projectId: args.hook.project_id,
    branch: args.branch,
    commitSha: args.commitSha ?? undefined,
  });
  if (!created.ok) {
    return {
      ok: false,
      status: created.status,
      error: created.error,
      message: created.message,
    };
  }

  const projectRow = project.project;
  const resolvedRuntimeKind =
    (projectRow.runtime_kind ?? "auto").toString().toLowerCase() || "auto";
  const resolvedHostingKind =
    (projectRow.hosting_kind ?? "static").toString().toLowerCase() || "static";

  const payload: Record<string, unknown> = {
    kind: "deploy",
    project_id: args.hook.project_id,
    project_slug: projectRow.slug,
    project_name: projectRow.name,
    deployment_id: created.deployment.id,
    branch: created.branch,
    commit_sha: created.commitSha,
    deploy_target: null,
    runtime_kind: resolvedRuntimeKind,
    hosting_kind: resolvedHostingKind,
    repo_url: projectRow.repo_url ?? null,
    default_branch: projectRow.default_branch ?? null,
    framework: projectRow.framework ?? null,
    install_command: projectRow.install_command ?? null,
    build_command: projectRow.build_command ?? null,
    build_output_dir: projectRow.build_output_dir ?? null,
    node_version: projectRow.node_version ?? null,
    env_overrides: null,
    requested_by: {
      kind: "deploy_hook",
      hook_id: args.hook.id,
      hook_name: args.hook.name,
    },
    requested_at: new Date().toISOString(),
    webhook: {
      ref: args.webhookPayload.ref ?? null,
      repository: args.webhookPayload.repository ?? null,
      pusher: args.webhookPayload.pusher ?? null,
      sender: args.webhookPayload.sender ?? null,
      head_commit: args.webhookPayload.head_commit ?? null,
    },
  };

  const jobResult = await createDeploymentJob(client, {
    deploymentId: created.deployment.id,
    userId: args.hook.user_id,
    projectId: args.hook.project_id,
    payload,
    attempt: 1,
  });

  await logInfra(client, {
    userId: args.hook.user_id,
    projectId: args.hook.project_id,
    eventType: "deployment_started",
    severity: jobResult.ok ? "info" : "warning",
    message: jobResult.ok
      ? `Deployment queued via deploy hook ${args.hook.name ?? args.hook.id} (${created.branch}@${created.commitSha}).`
      : `Deploy hook ${args.hook.id} created a deployment row but the job queue is unavailable.`,
    metadata: {
      deployment_id: created.deployment.id,
      job_id: jobResult.ok ? jobResult.job.id : null,
      hook_id: args.hook.id,
      branch: created.branch,
      commit_sha: created.commitSha,
      trigger: "deploy_hook",
      job_queue_available: jobResult.ok,
    },
  });

  if (!jobResult.ok && jobResult.missingTable) {
    return {
      ok: true,
      deployment_id: created.deployment.id,
      job_id: null,
      branch: created.branch,
      commit_sha: created.commitSha,
      warning: jobResult.message,
      setup_sql: DEPLOYMENT_JOBS_SCHEMA_SQL,
    };
  }

  if (!jobResult.ok) {
    return {
      ok: false,
      status: jobResult.status,
      error: "job_queue_failed",
      message: jobResult.message,
    };
  }

  return {
    ok: true,
    deployment_id: created.deployment.id,
    job_id: jobResult.job.id,
    branch: created.branch,
    commit_sha: created.commitSha,
  };
}

export async function touchDeployHookLastTriggered(
  client: SupabaseClient,
  hookId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const res = await client
    .from("deploy_hooks")
    .update({ last_triggered_at: now })
    .eq("id", hookId);
  if (res.error && isMissingColumn(res.error.message)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[gtlnav/server-deploy-webhook] deploy_hooks.last_triggered_at column missing:",
        res.error.message,
      );
    }
  }
}

/** GitHub push `after` or `head_commit.id` — full or short SHA. */
export function commitShaFromWebhookPayload(
  body: Record<string, unknown>,
): string | undefined {
  const after =
    typeof body.after === "string" ? body.after.trim().toLowerCase() : "";
  if (/^[0-9a-f]{7,40}$/.test(after)) {
    return after.length > 7 ? after.slice(0, 40) : after;
  }
  const head = body.head_commit;
  if (head && typeof head === "object" && !Array.isArray(head)) {
    const id = (head as Record<string, unknown>).id;
    if (typeof id === "string") {
      const h = id.trim().toLowerCase();
      if (/^[0-9a-f]{7,40}$/.test(h)) {
        return h.length > 7 ? h.slice(0, 40) : h;
      }
    }
  }
  return undefined;
}
