import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { loadOwnedRuntimeInstance } from "@/src/lib/server-runtime-control";
import {
  parseLogFiltersFromQuery,
  queryInfrastructureLogs,
  type InfrastructureLogRow,
} from "@/src/lib/server-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/runtime/instances/[id]/logs
 *
 * Foundation route for runtime-specific logs. Today this reads the audit
 * ledger (`infrastructure_logs`) and filters rows down to the requested
 * runtime instance. Future phases can layer container stdout/stderr from
 * `deployment_logs` on top without changing the route contract.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loaded = await loadOwnedRuntimeInstance(auth.client, {
    id,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = parseLogFiltersFromQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error, message: parsed.message },
      { status: parsed.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const filters = parsed.filters;
  try {
    const result = await queryInfrastructureLogs(auth.client, {
      userId: auth.userId,
      projectId: loaded.instance.project_id,
      eventTypePrefix: "runtime_",
      severity: filters.severity,
      since: filters.since,
      limit: Math.max(filters.limit, 200),
      ascending: false,
    });

    const rows = result.rows.filter((row) =>
      matchesRuntimeInstance(row, loaded.instance.id, loaded.instance.container_name),
    );

    return NextResponse.json(
      {
        ok: true,
        runtime_instance_id: loaded.instance.id,
        project_id: loaded.instance.project_id,
        runtime_kind: loaded.instance.runtime_kind,
        status: loaded.instance.status,
        count: rows.length,
        logs: rows.slice(0, filters.limit),
        filters: {
          severity: filters.severity,
          since: filters.since,
          limit: filters.limit,
        },
        warning:
          result.warning ??
          "Container stdout/stderr streaming is not wired yet; this route currently returns runtime audit events only.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "runtime_logs_lookup_failed",
        message:
          err instanceof Error ? err.message : "Failed to load runtime logs.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function matchesRuntimeInstance(
  row: InfrastructureLogRow,
  runtimeInstanceId: string,
  containerName: string | null,
) {
  const meta =
    row.metadata && typeof row.metadata === "object" ? row.metadata : null;
  if (!meta) return false;
  const taggedRuntime = (meta as Record<string, unknown>).runtime_instance_id;
  if (typeof taggedRuntime === "string" && taggedRuntime === runtimeInstanceId) {
    return true;
  }
  const taggedContainer = (meta as Record<string, unknown>).container_name;
  return (
    typeof containerName === "string" &&
    containerName.length > 0 &&
    typeof taggedContainer === "string" &&
    taggedContainer === containerName
  );
}
