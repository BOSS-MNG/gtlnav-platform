import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { logInfra } from "@/src/lib/server-deployments";
import {
  loadOwnedDomain,
  markSslPending,
} from "@/src/lib/server-domains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/domains/[id]/ssl-request
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Phase 6A behavior — TLS is owned by the reverse proxy (Caddy on-demand
 * TLS / ACME). This endpoint **never** fakes an issued certificate. It only
 * records the user intent to request a cert and queues the work:
 *
 *   - If the domain is `verified`, mark `ssl_status = 'pending_ssl'` so the
 *     proxy worker picks it up on its next sweep.
 *   - Otherwise mark `ssl_status = 'pending_dns'` and report what is
 *     missing so the UI can surface the right hint.
 *   - Append `ssl_requested` to `infrastructure_logs`.
 *
 * When Caddy successfully completes ACME for the domain, a separate worker
 * callback (TODO Phase 6B) flips `ssl_status = 'issued'`. Until then the
 * dashboard surface stays in `pending_ssl` and instructs the user to
 * refresh.
 *
 * Optional body:
 *   { "force_pending": true }   → always set pending, never auto-advance
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: domainId } = await params;

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
    // Tolerate empty / non-JSON body — ssl-request is allowed to be bodiless.
  }
  const forcePending = body.force_pending === true;

  const loaded = await loadOwnedDomain(auth.client, {
    domainId,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if ((loaded.domain.ssl_status ?? "").toLowerCase() === "issued" && !forcePending) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: loaded.domain.project_id,
      eventType: "ssl_requested",
      severity: "info",
      message: `SSL request ignored: ${loaded.domain.domain} is already issued.`,
      metadata: {
        domain_id: loaded.domain.id,
        domain: loaded.domain.domain,
        ssl_status: loaded.domain.ssl_status,
        no_op: true,
        auth_kind: auth.kind,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        no_op: true,
        domain_id: loaded.domain.id,
        domain: loaded.domain.domain,
        status: loaded.domain.status,
        ssl_status: loaded.domain.ssl_status,
        message: "SSL is already issued for this domain.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Phase 6A: never auto-issue. If DNS is verified, request the proxy to
  // issue via ACME (pending_ssl). Otherwise the domain is still waiting on
  // DNS, so we report that explicitly.
  const isVerified = (loaded.domain.status ?? "").toLowerCase() === "verified";
  const desiredSsl: "pending_ssl" | "pending" =
    isVerified && !forcePending ? "pending_ssl" : "pending";

  const upd = await markSslPending(auth.client, {
    domainId: loaded.domain.id,
    userId: auth.userId,
    pendingState: desiredSsl,
  });

  if (!upd.ok) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: loaded.domain.project_id,
      eventType: "ssl_requested",
      severity: "error",
      message: `SSL request failed for ${loaded.domain.domain}: ${upd.message}.`,
      metadata: {
        domain_id: loaded.domain.id,
        update_error: upd.error,
        desired_ssl: desiredSsl,
      },
    });
    return NextResponse.json(
      { ok: false, error: upd.error, message: upd.message },
      { status: upd.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: loaded.domain.project_id,
    eventType: "ssl_requested",
    severity: "info",
    message:
      desiredSsl === "pending_ssl"
        ? `SSL issuance queued for ${loaded.domain.domain}; reverse proxy will handle ACME.`
        : `SSL request held for ${loaded.domain.domain}; DNS not verified yet.`,
    metadata: {
      domain_id: loaded.domain.id,
      domain: loaded.domain.domain,
      previous_ssl_status: loaded.domain.ssl_status,
      new_ssl_status: desiredSsl,
      domain_status: loaded.domain.status,
      forced_pending: forcePending,
      auth_kind: auth.kind,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      no_op: false,
      domain_id: upd.domain.id,
      domain: upd.domain.domain,
      status: upd.domain.status,
      ssl_status: upd.domain.ssl_status,
      ssl_requested_at: upd.domain.ssl_requested_at ?? null,
      message:
        desiredSsl === "pending_ssl"
          ? "SSL issuance requested. The reverse proxy will obtain a certificate via ACME — refresh in a moment."
          : "SSL request recorded as pending. Verify DNS first to advance to issuance.",
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
