import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { loadOwnedRuntimeInstance } from "@/src/lib/server-runtime-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/runtime/instances/[id]/health
 *
 * Returns the last health snapshot the worker reported. This endpoint does
 * NOT probe Docker itself — that responsibility belongs to the worker via
 * `runtime_instances.last_health_check`. The frontend can poll this every
 * 10–30s for a near-real-time view.
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
  const inst = loaded.instance;
  return NextResponse.json(
    {
      ok: true,
      runtime_instance_id: inst.id,
      runtime_kind: inst.runtime_kind,
      target_state: inst.target_state,
      status: inst.status,
      runtime_status: (inst as Record<string, unknown>).runtime_status ?? inst.status,
      last_health_status: inst.last_health_status,
      health_status:
        (inst as Record<string, unknown>).health_status ?? inst.last_health_status,
      last_health_check: inst.last_health_check,
      restart_count: inst.restart_count,
      last_action: inst.last_action,
      last_action_at: inst.last_action_at,
      internal_port: inst.internal_port,
      external_port: (inst as Record<string, unknown>).external_port ?? null,
      container_name: inst.container_name,
      docker_image: (inst as Record<string, unknown>).docker_image ?? inst.image_tag,
      exit_code: inst.exit_code,
      exit_reason: inst.exit_reason,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
