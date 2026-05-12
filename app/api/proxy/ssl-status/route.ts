import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateProxy } from "@/src/lib/server-proxy-auth";
import { logInfra } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_SSL_STATES = new Set([
  "pending_ssl",
  "issued",
  "ssl_failed",
  "disabled",
]);

/**
 * POST /api/proxy/ssl-status
 *
 * Auth: x-gtlnav-proxy-secret OR x-gtlnav-worker-secret
 *
 * Reverse proxy callback. After Caddy / ACME finishes (success or failure)
 * the proxy calls this endpoint so the dashboard reflects the real state.
 *
 * Body:
 *   {
 *     "domain":     "app.example.com",
 *     "ssl_status": "issued" | "ssl_failed",
 *     "issuer":     "letsencrypt" | "zerossl" | "...",          (optional)
 *     "reason":     "no_a_record" | "rate_limited" | "..."       (optional, on failure)
 *   }
 *
 * Effect:
 *   - Updates the matching `domains` row scoped to the verified hostname.
 *   - Sets `ssl_issued_at` on success, `ssl_failed_reason` on failure.
 *   - Writes a `proxy_ssl_status` audit row.
 *
 * Frontend can NEVER hit this endpoint — there is no path that exposes the
 * proxy secret to the browser bundle.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateProxy(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const hostname = stringField(body.domain)?.toLowerCase() ?? null;
  const sslStatus = stringField(body.ssl_status)?.toLowerCase() ?? null;
  const issuer = stringField(body.issuer) ?? null;
  const reason = stringField(body.reason) ?? null;

  if (!hostname) {
    return NextResponse.json(
      { ok: false, error: "missing_domain", message: "domain is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!sslStatus || !VALID_SSL_STATES.has(sslStatus)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_ssl_status",
        message: `ssl_status must be one of: ${[...VALID_SSL_STATES].join(", ")}.`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The proxy may report on any domain; we look up by hostname only.
  const domain = await auth.client
    .from("domains")
    .select("id, user_id, project_id, status, ssl_status, ssl_issuer")
    .eq("domain", hostname)
    .limit(1)
    .maybeSingle();

  if (domain.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "lookup_failed",
        message: `domains lookup failed: ${domain.error.message}`,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!domain.data?.id) {
    return NextResponse.json(
      {
        ok: false,
        error: "domain_not_found",
        message: `No GTLNAV record for ${hostname}.`,
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    ssl_status: sslStatus,
    updated_at: now,
  };
  if (sslStatus === "issued") {
    updates.ssl_issued_at = now;
    if (issuer) updates.ssl_issuer = issuer;
    updates.ssl_failed_reason = null;
  } else if (sslStatus === "ssl_failed") {
    updates.ssl_failed_reason = reason ?? "unknown";
  }

  const upd = await auth.client
    .from("domains")
    .update(updates)
    .eq("id", domain.data.id)
    .select("id, domain, status, ssl_status, ssl_issuer, ssl_issued_at, ssl_failed_reason")
    .maybeSingle();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, error: "update_failed", message: upd.error.message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: domain.data.user_id,
    projectId: domain.data.project_id,
    eventType:
      sslStatus === "issued"
        ? "ssl_issued"
        : sslStatus === "ssl_failed"
          ? "ssl_failed"
          : "ssl_status_updated",
    severity:
      sslStatus === "issued"
        ? "success"
        : sslStatus === "ssl_failed"
          ? "error"
          : "info",
    message:
      sslStatus === "issued"
        ? `SSL issued for ${hostname} by ${issuer ?? "proxy"}.`
        : sslStatus === "ssl_failed"
          ? `SSL issuance failed for ${hostname}: ${reason ?? "unknown"}.`
          : `SSL status for ${hostname} → ${sslStatus}.`,
    metadata: {
      hostname,
      previous_ssl_status: domain.data.ssl_status,
      new_ssl_status: sslStatus,
      issuer,
      reason,
      caller: auth.callerLabel,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      domain_id: upd.data?.id ?? domain.data.id,
      domain: hostname,
      ssl_status: sslStatus,
      issuer: upd.data?.ssl_issuer ?? issuer ?? null,
      ssl_issued_at: upd.data?.ssl_issued_at ?? null,
      ssl_failed_reason: upd.data?.ssl_failed_reason ?? null,
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

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
