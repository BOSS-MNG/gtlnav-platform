import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateProxy } from "@/src/lib/server-proxy-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/proxy/route-config
 *
 * Auth: x-gtlnav-proxy-secret OR x-gtlnav-worker-secret
 *
 * Returns the flat route table the reverse proxy should serve. Caddy /
 * Traefik can either:
 *   - pull this on a timer and rewrite their config, or
 *   - consume it through Caddy's HTTP request matchers + dynamic upstreams.
 *
 * Shape:
 *   {
 *     "ok": true,
 *     "generated_at": "...",
 *     "base_domain": "gtlnav.app",
 *     "routes": [
 *       {
 *         "hostname": "myapp.gtlnav.app",
 *         "upstream_kind": "static",
 *         "serve_path": "/var/gtlnav/deployments/myapp/current",
 *         "project_id": "...",
 *         "deployment_id": "...",
 *         "ssl_status": "issued"
 *       },
 *       {
 *         "hostname": "api.example.com",
 *         "upstream_kind": "docker",
 *         "upstream_target": "127.0.0.1:34001",
 *         "project_id": "...",
 *         "runtime_instance_id": "...",
 *         "ssl_status": "pending_ssl"
 *       }
 *     ]
 *   }
 *
 * Only `active` routes are returned. Disabled / pending routes are filtered
 * server-side so a misconfigured proxy can't accidentally serve them.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateProxy(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const baseDomain = (process.env.GTLNAV_DEPLOY_BASE_DOMAIN ?? "")
    .trim()
    .toLowerCase();

  const { data, error } = await auth.client
    .from("proxy_routes")
    .select(
      "id, user_id, project_id, hostname, upstream_kind, serve_path, upstream_target, runtime_instance_id, deployment_id, status, updated_at",
    )
    .eq("status", "active")
    .order("hostname", { ascending: true })
    .limit(5000);

  if (error) {
    // proxy_routes may not be provisioned yet; degrade to apex-only routing.
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        base_domain: baseDomain || null,
        routes: [],
        warning: `proxy_routes lookup failed: ${error.message}`,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Enrich with SSL status from domains (best-effort).
  const hostnames = (data ?? []).map((r) => r.hostname.toLowerCase());
  const sslByHost = new Map<string, string>();
  if (hostnames.length > 0) {
    const ssl = await auth.client
      .from("domains")
      .select("domain, ssl_status")
      .in("domain", hostnames);
    if (!ssl.error && Array.isArray(ssl.data)) {
      for (const row of ssl.data) {
        sslByHost.set(row.domain.toLowerCase(), row.ssl_status);
      }
    }
  }

  const routes = (data ?? []).map((r) => ({
    hostname: r.hostname,
    upstream_kind: r.upstream_kind,
    serve_path: r.upstream_kind === "static" ? r.serve_path : null,
    upstream_target: r.upstream_kind === "docker" ? r.upstream_target : null,
    project_id: r.project_id,
    deployment_id: r.deployment_id,
    runtime_instance_id: r.runtime_instance_id,
    ssl_status: sslByHost.get(r.hostname.toLowerCase()) ?? "apex_wildcard",
    updated_at: r.updated_at,
  }));

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      base_domain: baseDomain || null,
      route_count: routes.length,
      routes,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
