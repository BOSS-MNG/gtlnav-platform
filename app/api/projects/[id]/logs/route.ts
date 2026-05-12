import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { loadOwnedProject } from "@/src/lib/server-deployments";
import {
  parseLogFiltersFromQuery,
  queryInfrastructureLogs,
} from "@/src/lib/server-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/logs
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Returns `infrastructure_logs` rows pinned to the calling user AND the
 * supplied project_id. Project ownership is enforced before any rows are
 * returned, so an attacker cannot probe for project ids by querying logs.
 *
 * Query params:
 *   ?severity=info,warning,error
 *   ?event_type=runtime_started,deployment_completed
 *   ?event_type_prefix=runtime_
 *   ?since=<ISO timestamp>
 *   ?limit=<1..500>
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const project = await loadOwnedProject(auth.client, {
    projectId,
    userId: auth.userId,
  });
  if (!project.ok) {
    return NextResponse.json(
      { ok: false, error: project.error, message: project.message },
      { status: project.status, headers: { "Cache-Control": "no-store" } },
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
      projectId: project.project.id,
      severity: filters.severity,
      eventType: filters.eventType,
      eventTypePrefix: filters.eventTypePrefix,
      since: filters.since,
      limit: filters.limit,
      ascending: false,
    });

    return NextResponse.json(
      {
        ok: true,
        project_id: project.project.id,
        project_name: project.project.name,
        project_slug: project.project.slug,
        count: result.rows.length,
        logs: result.rows,
        filters: {
          severity: filters.severity,
          event_type: filters.eventType,
          event_type_prefix: filters.eventTypePrefix,
          since: filters.since,
          limit: filters.limit,
        },
        warning: result.warning ?? null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "logs_lookup_failed",
        message: err instanceof Error ? err.message : "Failed to load logs.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use GET." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
