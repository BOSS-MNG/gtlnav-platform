import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  loadRuntimeAppById,
  loadRuntimeLogsForApp,
  runtimeFoundationNote,
} from "@/src/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_LEVEL_FILTERS = new Set([
  "info",
  "warning",
  "error",
  "success",
  "debug",
]);

/**
 * GET /api/runtime/apps/[id]/logs
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Query params:
 *   ?limit=<1..500>            (default 100)
 *   ?since=<ISO timestamp>     (filter created_at >= since)
 *   ?level=info,warning,error  (csv, filters severity)
 *
 * Returns rows from `infrastructure_logs` tagged with this runtime app —
 * either `metadata->>runtime_app_id = id`, or scoped to the resolved
 * `project_id` with `event_type LIKE 'runtime_%'`.
 *
 * No container shell logs are read; this is purely the audit trail.
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

  const url = request.nextUrl;
  const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;
  const sinceRaw = (url.searchParams.get("since") ?? "").trim();
  const sinceIso = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

  const levelRaw = (url.searchParams.get("level") ?? "").trim();
  const requestedLevels = levelRaw
    ? levelRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && ALLOWED_LEVEL_FILTERS.has(s))
    : [];
  const levels = requestedLevels.length > 0 ? requestedLevels : null;

  const appResult = await loadRuntimeAppById(auth.client, {
    appId: id,
    userId: auth.userId,
  });
  if (!appResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: appResult.error,
        message: appResult.message,
        setup_sql: appResult.setup_sql ?? null,
      },
      { status: appResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const logsResult = await loadRuntimeLogsForApp(auth.client, {
    userId: auth.userId,
    appId: appResult.app.id,
    projectId: appResult.app.project_id,
    limit,
    sinceIso,
    levels,
  });

  return NextResponse.json(
    {
      ok: true,
      app_id: appResult.app.id,
      project_id: appResult.app.project_id,
      source: appResult.source,
      runtime_status: appResult.app.runtime_status,
      count: logsResult.logs.length,
      logs: logsResult.logs,
      filters: {
        limit,
        since: sinceIso,
        levels,
      },
      warning: logsResult.warning ?? appResult.warning ?? null,
      setup_sql: appResult.setup_sql ?? null,
      note: runtimeFoundationNote(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use GET." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
