import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { loadOwnedDeployment } from "@/src/lib/server-deployments";
import {
  parseLogFiltersFromQuery,
  queryInfrastructureLogs,
} from "@/src/lib/server-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/deployments/[id]/logs
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Returns `infrastructure_logs` rows pinned to:
 *   - the calling user_id
 *   - the deployment's project_id (project-level events still surface)
 *   - PLUS rows whose `metadata->>deployment_id` equals this deployment's id
 *
 * Deployment ownership is verified before any logs are returned.
 *
 * Query params:
 *   ?severity=info,warning,error
 *   ?event_type=deployment_started,deployment_completed
 *   ?event_type_prefix=deployment_
 *   ?since=<ISO timestamp>
 *   ?limit=<1..500>
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: deploymentId } = await params;

  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const deployment = await loadOwnedDeployment(auth.client, {
    deploymentId,
    userId: auth.userId,
  });
  if (!deployment.ok) {
    return NextResponse.json(
      { ok: false, error: deployment.error, message: deployment.message },
      { status: deployment.status, headers: { "Cache-Control": "no-store" } },
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
      projectId: deployment.deployment.project_id,
      deploymentId: deployment.deployment.id,
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
        deployment_id: deployment.deployment.id,
        project_id: deployment.deployment.project_id,
        deployment_status: deployment.deployment.status,
        commit_sha: deployment.deployment.commit_sha,
        branch: deployment.deployment.branch,
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
