import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  listRuntimeAppsForUser,
  RUNTIME_STATUSES,
  runtimeFoundationNote,
  type RuntimeStatus,
} from "@/src/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/runtime/apps
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Query params:
 *   ?status=running|stopped|restarting|starting|stopping|failed|unknown
 *   ?project_id=<uuid>
 *   ?limit=<1..500>
 *
 * Returns runtime_apps rows when the table exists, otherwise a synthetic
 * runtime app per project derived from latest deployment status. The
 * response includes `source: "runtime_apps" | "synthetic"` and, in the
 * synthetic case, `setup_sql` so operators can promote to a real table.
 *
 * No container commands are issued.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = request.nextUrl;
  const statusParam = (url.searchParams.get("status") ?? "").toLowerCase().trim();
  const projectIdParam = (url.searchParams.get("project_id") ?? "").trim();
  const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);

  let status: RuntimeStatus | undefined;
  if (statusParam) {
    if (!(RUNTIME_STATUSES as readonly string[]).includes(statusParam)) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_status",
          message: `status must be one of: ${RUNTIME_STATUSES.join(", ")}.`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    status = statusParam as RuntimeStatus;
  }

  try {
    const result = await listRuntimeAppsForUser(auth.client, auth.userId, {
      status,
      projectId: projectIdParam.length > 0 ? projectIdParam : undefined,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
    });

    return NextResponse.json(
      {
        ok: true,
        source: result.source,
        count: result.apps.length,
        apps: result.apps,
        warning: result.warning ?? null,
        setup_sql: result.setup_sql ?? null,
        note: runtimeFoundationNote(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "runtime_apps_lookup_failed",
        message: err instanceof Error ? err.message : "Failed to load runtime apps.",
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
