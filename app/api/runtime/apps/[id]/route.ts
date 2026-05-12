import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  loadRuntimeAppById,
  runtimeFoundationNote,
} from "@/src/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/runtime/apps/[id]
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Returns a single runtime app. The id is matched against
 * `runtime_apps.id` first; if no row exists, it is matched against
 * `runtime_apps.project_id`. If `runtime_apps` is missing entirely, the
 * id is treated as a `projects.id` and a synthetic app is returned.
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

  const result = await loadRuntimeAppById(auth.client, {
    appId: id,
    userId: auth.userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        message: result.message,
        setup_sql: result.setup_sql ?? null,
      },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      source: result.source,
      app: result.app,
      warning: result.warning ?? null,
      setup_sql: result.setup_sql ?? null,
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
