import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import { logInfra } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["static", "docker"]);

/**
 * POST /api/worker/route-register
 *
 * Auth: x-gtlnav-worker-secret OR api key with worker scope.
 *
 * Upserts a row in `proxy_routes`. Called by the worker after a successful
 * deploy or runtime restart so the reverse proxy can pick up the new
 * upstream the next time it polls /api/proxy/route-config.
 *
 * The endpoint normalises hostnames (lowercase, trimmed) and validates
 * structure to avoid an attacker registering arbitrary upstreams.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWorker(request);
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
      { ok: false, error: "invalid_json", message: "Body must be JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const hostname = stringField(body.hostname)?.toLowerCase();
  const upstreamKind = stringField(body.upstream_kind)?.toLowerCase();
  const upstreamTarget = stringField(body.upstream_target);
  const servePath = stringField(body.serve_path);
  const projectId = stringField(body.project_id);
  const userId = stringField(body.user_id);
  const deploymentId = stringField(body.deployment_id);
  const runtimeInstanceId = stringField(body.runtime_instance_id);
  const status = (stringField(body.status) ?? "active").toLowerCase();

  if (!hostname || !isHostname(hostname)) {
    return jsonError(400, "invalid_hostname", "hostname must be a valid RFC-1123 host.");
  }
  if (!upstreamKind || !ALLOWED_KINDS.has(upstreamKind)) {
    return jsonError(
      400,
      "invalid_upstream_kind",
      `upstream_kind must be one of: ${[...ALLOWED_KINDS].join(", ")}.`,
    );
  }
  if (upstreamKind === "docker" && !isLoopbackTarget(upstreamTarget)) {
    return jsonError(
      400,
      "invalid_upstream_target",
      "Docker routes must point at 127.0.0.1:<port>.",
    );
  }
  if (upstreamKind === "static" && !servePath) {
    return jsonError(
      400,
      "invalid_serve_path",
      "Static routes must include serve_path.",
    );
  }

  const scopedUserId = auth.kind === "api_key" ? auth.scopeUserId : userId;
  if (!scopedUserId) {
    return jsonError(
      400,
      "missing_user_id",
      "user_id is required when calling via worker secret.",
    );
  }

  // Look up existing row by hostname (the unique key).
  const existing = await auth.client
    .from("proxy_routes")
    .select("id, user_id")
    .eq("hostname", hostname)
    .maybeSingle();
  if (existing.error && !isMissingTable(existing.error.message)) {
    return jsonError(500, "lookup_failed", existing.error.message);
  }

  if (
    existing.data?.id &&
    auth.kind === "api_key" &&
    existing.data.user_id !== auth.scopeUserId
  ) {
    return jsonError(
      403,
      "scope_denied",
      "This API key cannot rewrite routes owned by other users.",
    );
  }

  const now = new Date().toISOString();
  const writable: Record<string, unknown> = {
    hostname,
    upstream_kind: upstreamKind,
    serve_path: upstreamKind === "static" ? servePath : null,
    upstream_target: upstreamKind === "docker" ? upstreamTarget : null,
    project_id: projectId,
    deployment_id: deploymentId,
    runtime_instance_id: runtimeInstanceId,
    status,
    last_seen_at: now,
    updated_at: now,
  };

  let row: Record<string, unknown> | null = null;
  let writeErr: string | null = null;
  if (existing.data?.id) {
    const upd = await auth.client
      .from("proxy_routes")
      .update(writable)
      .eq("id", existing.data.id)
      .select("*")
      .maybeSingle();
    if (upd.error) writeErr = upd.error.message;
    row = (upd.data as Record<string, unknown> | null) ?? null;
  } else {
    const ins = await auth.client
      .from("proxy_routes")
      .insert({ ...writable, user_id: scopedUserId, created_at: now })
      .select("*")
      .maybeSingle();
    if (ins.error) writeErr = ins.error.message;
    row = (ins.data as Record<string, unknown> | null) ?? null;
  }

  if (writeErr) return jsonError(500, "write_failed", writeErr);

  await logInfra(auth.client, {
    userId: scopedUserId,
    projectId,
    eventType: "proxy_route_registered",
    severity: "info",
    message: `Worker ${auth.workerLabel} registered route ${hostname} → ${upstreamKind}.`,
    metadata: {
      hostname,
      upstream_kind: upstreamKind,
      upstream_target: upstreamTarget,
      serve_path: servePath,
      worker: auth.workerLabel,
      deployment_id: deploymentId,
      runtime_instance_id: runtimeInstanceId,
    },
  });

  return NextResponse.json(
    { ok: true, route: row },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
function isHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

function isLoopbackTarget(value: string | null): boolean {
  if (!value) return false;
  return /^127\.0\.0\.1:\d{2,5}$/.test(value);
}

function isMissingTable(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("not found") ||
    m.includes("schema cache")
  );
}
