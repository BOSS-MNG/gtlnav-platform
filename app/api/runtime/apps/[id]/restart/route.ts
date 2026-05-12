import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  applyRuntimeTransition,
  logRuntimeEvent,
  runtimeFoundationNote,
} from "@/src/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/runtime/apps/[id]/restart
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * State machine: any -> restarting -> running.
 *
 * Foundation only: this updates `runtime_apps.runtime_status` and writes
 * a `runtime_restarted` audit row to `infrastructure_logs`. No container
 * commands are issued. The "restarting" state is reflected in the
 * response's `via` field; the persisted final status is `running`.
 */
export async function POST(
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

  const result = await applyRuntimeTransition(auth.client, {
    appId: id,
    userId: auth.userId,
    action: "restart",
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

  if (result.synthetic) {
    await logRuntimeEvent(auth.client, {
      userId: auth.userId,
      projectId: result.app.project_id,
      appId: result.app.id,
      event: "runtime_restarted",
      severity: "info",
      message: `Runtime restart requested for ${result.app.name ?? result.app.id}; synthetic app — runtime_apps table missing.`,
      metadata: {
        previous: result.previous,
        via: result.via,
        now: result.now,
        synthetic: true,
        auth_kind: auth.kind,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        action: "restart",
        app: result.app,
        previous: result.previous,
        via: result.via,
        now: result.now,
        no_op: false,
        synthetic: true,
        warning: result.warning,
        setup_sql: result.setup_sql,
        note: runtimeFoundationNote(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logRuntimeEvent(auth.client, {
    userId: auth.userId,
    projectId: result.app.project_id,
    appId: result.app.id,
    event: "runtime_restarted",
    severity: "success",
    message: `Runtime restart applied for ${result.app.name ?? result.app.id} (${result.previous} → ${result.via} → ${result.now}).`,
    metadata: {
      previous: result.previous,
      via: result.via,
      now: result.now,
      auth_kind: auth.kind,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      action: "restart",
      app: result.app,
      previous: result.previous,
      via: result.via,
      now: result.now,
      no_op: false,
      synthetic: false,
      note: runtimeFoundationNote(),
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
