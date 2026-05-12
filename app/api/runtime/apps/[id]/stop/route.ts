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
 * POST /api/runtime/apps/[id]/stop
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * State machine: running/starting/restarting -> stopping -> stopped.
 * Already stopped is a 200 no-op. `failed` is treated as already stopped
 * unless the operator wants to re-stop (no-op for now).
 *
 * Foundation only: this updates `runtime_apps.runtime_status` and writes
 * a `runtime_stopped` audit row to `infrastructure_logs`. No container
 * commands are issued.
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
    action: "stop",
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
      event: "runtime_stopped",
      severity: "info",
      message: `Runtime stop requested for ${result.app.name ?? result.app.id}; synthetic app — runtime_apps table missing.`,
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
        action: "stop",
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
    event: "runtime_stopped",
    severity: result.noOp ? "info" : "warning",
    message: result.noOp
      ? `Runtime stop no-op for ${result.app.name ?? result.app.id} (already ${result.app.runtime_status}).`
      : `Runtime stop applied for ${result.app.name ?? result.app.id} (${result.previous} → ${result.now}).`,
    metadata: {
      previous: result.previous,
      via: result.via,
      now: result.now,
      no_op: result.noOp,
      auth_kind: auth.kind,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      action: "stop",
      app: result.app,
      previous: result.previous,
      via: result.via,
      now: result.now,
      no_op: result.noOp,
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
