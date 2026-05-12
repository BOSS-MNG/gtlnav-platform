import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateProxy } from "@/src/lib/server-proxy-auth";
import { logInfra } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/proxy/tls-ok?domain=<hostname>
 *
 * Auth: x-gtlnav-proxy-secret OR x-gtlnav-worker-secret
 *
 * Designed to be hit by Caddy's `on_demand_tls.ask` directive. Caddy issues
 * a GET with `?domain=<hostname>` and obtains a cert only on HTTP 200.
 *
 * Allow rules:
 *   1. Any host under `GTLNAV_DEPLOY_BASE_DOMAIN` (i.e. our wildcard).
 *   2. Any verified custom domain present in `public.domains` with
 *      `status = 'verified'`.
 *
 * All decisions write to `infrastructure_logs` (severity `info` for allow,
 * `warning` for deny).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateProxy(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = request.nextUrl;
  const rawHost = (url.searchParams.get("domain") ?? "").trim().toLowerCase();
  const hostname = sanitizeHostname(rawHost);
  if (!hostname) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_hostname",
        message:
          "Provide ?domain=<hostname> with a valid RFC-1123 hostname.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const baseDomain = (process.env.GTLNAV_DEPLOY_BASE_DOMAIN ?? "")
    .trim()
    .toLowerCase();

  // 1. Apex wildcard match — fastest path.
  if (baseDomain && isUnderBaseDomain(hostname, baseDomain)) {
    await logInfra(auth.client, {
      userId: null,
      projectId: null,
      eventType: "proxy_tls_ok",
      severity: "info",
      message: `tls-ok allowed apex host ${hostname}.`,
      metadata: {
        hostname,
        reason: "apex_wildcard",
        base_domain: baseDomain,
        caller: auth.callerLabel,
      },
    });
    return jsonOk(hostname, "apex_wildcard");
  }

  // 2. Verified custom domain in `domains` table.
  const verified = await auth.client
    .from("domains")
    .select("id, user_id, project_id, status, ssl_status")
    .eq("domain", hostname)
    .eq("status", "verified")
    .limit(1)
    .maybeSingle();

  if (verified.error) {
    await logInfra(auth.client, {
      userId: null,
      projectId: null,
      eventType: "proxy_tls_deny",
      severity: "warning",
      message: `tls-ok lookup failed for ${hostname}: ${verified.error.message}`,
      metadata: { hostname, reason: "lookup_error", caller: auth.callerLabel },
    });
    // Deny on lookup error — never auto-allow an unknown host.
    return jsonDeny(hostname, "lookup_error", 503);
  }

  if (verified.data?.id) {
    await logInfra(auth.client, {
      userId: verified.data.user_id,
      projectId: verified.data.project_id,
      eventType: "proxy_tls_ok",
      severity: "info",
      message: `tls-ok allowed verified custom domain ${hostname}.`,
      metadata: {
        hostname,
        reason: "verified_custom_domain",
        domain_id: verified.data.id,
        ssl_status: verified.data.ssl_status,
        caller: auth.callerLabel,
      },
    });
    return jsonOk(hostname, "verified_custom_domain");
  }

  await logInfra(auth.client, {
    userId: null,
    projectId: null,
    eventType: "proxy_tls_deny",
    severity: "warning",
    message: `tls-ok rejected unknown host ${hostname}.`,
    metadata: {
      hostname,
      reason: "host_not_allowed",
      base_domain: baseDomain || null,
      caller: auth.callerLabel,
    },
  });
  return jsonDeny(hostname, "host_not_allowed", 404);
}

function jsonOk(hostname: string, reason: string) {
  return NextResponse.json(
    { ok: true, hostname, reason },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonDeny(hostname: string, reason: string, status: number) {
  return NextResponse.json(
    { ok: false, hostname, reason },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

function sanitizeHostname(value: string): string | null {
  if (!value) return null;
  if (value.length > 253) return null;
  if (!HOSTNAME_RE.test(value)) return null;
  return value;
}

function isUnderBaseDomain(host: string, base: string): boolean {
  if (host === base) return true;
  return host.endsWith(`.${base}`);
}
