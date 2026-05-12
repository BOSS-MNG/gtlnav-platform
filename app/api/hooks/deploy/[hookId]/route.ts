import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminClient } from "@/src/lib/server-auth";
import {
  branchFromWebhookRef,
  commitShaFromWebhookPayload,
  isHookRevoked,
  loadDeployHookById,
  normalizeBranchName,
  queueDeploymentFromDeployHook,
  touchDeployHookLastTriggered,
  verifyDeployHookSecretAndGithubSignature,
  type DeployHookRow,
} from "@/src/lib/server-deploy-webhook";
import { logInfra } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/hooks/deploy/[hookId]
 *
 * Secured deploy hook endpoint. Verifies the hook secret (stored as
 * `sha256:<hex>` in `deploy_hooks.secret_hash`, matching the Webhooks console)
 * via:
 *
 *   - `x-gtlnav-hook-secret: <gtlnav_hook_…>` header, and/or
 *   - `?gtlnav_hook_secret=` / `?hook_secret=` on the webhook URL (GitHub
 *     supports query strings on the configured webhook URL).
 *
 * When `x-hub-signature-256` is present, it must match HMAC-SHA256(raw body,
 * UTF-8 secret) after the hook secret hash matches (same secret as GitHub’s
 * webhook “Secret” field).
 *
 * GitHub `ping` deliveries are acknowledged without enqueueing a deployment.
 * Push events must include `ref: refs/heads/<branch>` matching `hook.branch`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hookId: string }> },
) {
  const { hookId } = await params;

  const admin = getServerAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        error: "service_role_missing",
        message:
          "Deploy webhooks require SUPABASE_SERVICE_ROLE_KEY on this server.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loaded = await loadDeployHookById(admin, hookId);
  if (!loaded.ok) {
    if (loaded.notFound) {
      return NextResponse.json(
        { ok: false, error: "hook_not_found", message: "Unknown deploy hook id." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const hook = loaded.hook;

  if (isHookRevoked(hook)) {
    await logWebhook(admin, hook, "webhook_rejected", "warning", "Deploy hook is revoked.", {
      reason: "revoked",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "hook_revoked",
        message: "This deploy hook has been revoked.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const hookStatus = (hook.status ?? "active").toLowerCase().trim();
  if (hookStatus !== "active") {
    await logWebhook(admin, hook, "webhook_rejected", "warning", "Deploy hook is not active.", {
      reason: "hook_not_active",
      status: hook.status,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "hook_not_active",
        message: `Deploy hook status is "${hook.status ?? "unknown"}"; only active hooks accept traffic.`,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawBody = await request.text();
  const hubSig =
    request.headers.get("x-hub-signature-256") ??
    request.headers.get("X-Hub-Signature-256");

  const plaintextSecret =
    request.headers.get("x-gtlnav-hook-secret")?.trim() ??
    request.headers.get("X-GTLNAV-Hook-Secret")?.trim() ??
    request.nextUrl.searchParams.get("gtlnav_hook_secret")?.trim() ??
    request.nextUrl.searchParams.get("hook_secret")?.trim() ??
    null;

  const verified = verifyDeployHookSecretAndGithubSignature({
    hook,
    plaintextSecret,
    rawBodyUtf8: rawBody,
    hubSignature256: hubSig,
  });

  if (!verified.ok) {
    const reason =
      verified.reason === "missing_secret"
        ? "missing_or_invalid_secret"
        : verified.reason === "hash_mismatch"
          ? "invalid_hook_secret"
          : "invalid_github_signature";
    await logWebhook(admin, hook, "webhook_rejected", "warning", "Deploy webhook secret verification failed.", {
      reason: verified.reason,
      has_github_signature: Boolean(hubSig?.trim()),
    });
    return NextResponse.json(
      {
        ok: false,
        error: reason,
        message:
          verified.reason === "missing_secret"
            ? hubSig?.trim()
              ? "Provide the plaintext hook secret via x-gtlnav-hook-secret header or ?gtlnav_hook_secret= on the webhook URL (required to verify x-hub-signature-256)."
              : "Missing hook secret. Send x-gtlnav-hook-secret or add ?gtlnav_hook_secret= to the webhook URL."
            : verified.reason === "hash_mismatch"
              ? "Hook secret does not match this deploy hook."
              : "GitHub signature x-hub-signature-256 does not match the request body and hook secret.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = rawBody.trim().length === 0 ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
  } catch {
    await logWebhook(admin, hook, "webhook_rejected", "warning", "Webhook body is not valid JSON.", {
      reason: "invalid_json",
    });
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const githubEvent =
    request.headers.get("x-github-event")?.toLowerCase() ??
    request.headers.get("X-GitHub-Event")?.toLowerCase() ??
    null;

  if (githubEvent === "ping") {
    await logWebhook(admin, hook, "webhook_received", "info", "GitHub ping received; no deployment queued.", {
      github_event: "ping",
    });
    return NextResponse.json(
      { ok: true, hook_id: hook.id, skipped: "ping", github_event: "ping" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const refBranch = branchFromWebhookRef(body.ref);
  if (!refBranch) {
    await logWebhook(admin, hook, "webhook_rejected", "warning", "Payload has no refs/heads branch ref.", {
      reason: "missing_branch_ref",
      ref: body.ref ?? null,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "branch_ref_missing",
        message:
          "Expected a Git-style branch ref (e.g. refs/heads/main) in the payload `ref` field.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (normalizeBranchName(refBranch) !== normalizeBranchName(hook.branch)) {
    await logWebhook(admin, hook, "webhook_rejected", "info", "Branch does not match deploy hook branch filter.", {
      reason: "branch_mismatch",
      ref_branch: refBranch,
      hook_branch: hook.branch,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "branch_mismatch",
        message: `Hook is scoped to branch "${hook.branch}"; payload ref targets "${refBranch}".`,
        hook_branch: hook.branch,
        ref_branch: refBranch,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const commitSha = commitShaFromWebhookPayload(body);

  const queued = await queueDeploymentFromDeployHook(admin, {
    hook,
    branch: refBranch,
    commitSha,
    webhookPayload: body,
  });

  if (!queued.ok) {
    await logWebhook(admin, hook, "webhook_rejected", "error", "Failed to queue deployment from deploy hook.", {
      reason: "queue_failed",
      error: queued.error,
      message: queued.message,
    });
    return NextResponse.json(
      { ok: false, error: queued.error, message: queued.message },
      { status: queued.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await touchDeployHookLastTriggered(admin, hook.id);

  await logWebhook(admin, hook, "webhook_received", "success", "Deploy webhook accepted; deployment queued.", {
    deployment_id: queued.deployment_id,
    job_id: queued.job_id,
    branch: queued.branch,
    commit_sha: queued.commit_sha,
    github_event: githubEvent,
    warning: queued.warning ?? null,
  });

  const responseBody: Record<string, unknown> = {
    ok: true,
    hook_id: hook.id,
    deployment_id: queued.deployment_id,
    job_id: queued.job_id,
    branch: queued.branch,
    commit_sha: queued.commit_sha,
    status: "queued",
  };
  if (queued.warning) {
    responseBody.warning = queued.warning;
    responseBody.setup_sql = queued.setup_sql;
  }

  return NextResponse.json(responseBody, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hookId: string }> },
) {
  const { hookId } = await params;
  return NextResponse.json({
    ok: true,
    hook_id: hookId,
    message:
      "POST JSON payloads to this URL to trigger a deployment. Authenticate with x-gtlnav-hook-secret or append ?gtlnav_hook_secret= to the URL (same value as the GitHub webhook Secret). When using GitHub, optional x-hub-signature-256 is verified against the raw body.",
    method: "POST",
    docs: {
      headers: ["x-gtlnav-hook-secret", "x-hub-signature-256 (optional, GitHub)"],
      query: ["gtlnav_hook_secret", "hook_secret"],
    },
  });
}

async function logWebhook(
  client: SupabaseClient,
  hook: DeployHookRow,
  eventType: "webhook_received" | "webhook_rejected",
  severity: "info" | "warning" | "error" | "success",
  message: string,
  metadata: Record<string, unknown>,
) {
  await logInfra(client, {
    userId: hook.user_id,
    projectId: hook.project_id,
    eventType,
    severity,
    message,
    metadata: {
      hook_id: hook.id,
      hook_name: hook.name,
      ...metadata,
    },
  });
}
