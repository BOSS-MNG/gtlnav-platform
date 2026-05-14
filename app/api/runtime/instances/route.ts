import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { isMissingColumn } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/runtime/instances
 *
 * Auth: Authorization: Bearer <supabase token | gtlnav api key>
 *
 * Returns ALL real runtime_instances rows owned by the caller. The runtime
 * dashboard reads from here in Phase 6B — the simulator is reserved for
 * placeholder / preview cards only.
 *
 * Optional query: ?project_id=<uuid>
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
  const projectId = url.searchParams.get("project_id");
  // Phase 6C — the column is `runtime_kind` (migration 0006). The legacy
  // `hosting_kind` name is no longer selected; clients can rely on
  // `runtime_kind` only.
  let query = auth.client
    .from("runtime_instances")
    .select(
      "id, user_id, project_id, deployment_id, runtime_kind, target_state, status, runtime_status, internal_port, external_port, container_id, container_name, image_tag, docker_image, dockerfile_source, last_health_status, health_status, last_health_check, last_action, last_action_at, restart_count, exit_code, exit_reason, framework, serve_path, created_at, updated_at",
    )
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  let data: Record<string, unknown>[] | null = null;
  let error: { message?: string } | null = null;

  const initial = await query;
  data = (initial.data ?? null) as Record<string, unknown>[] | null;
  error = initial.error ? { message: initial.error.message } : null;
  if (error && isMissingColumn(error.message)) {
    let fallback = auth.client
      .from("runtime_instances")
      .select(
        "id, user_id, project_id, deployment_id, runtime_kind, target_state, status, internal_port, container_id, container_name, image_tag, dockerfile_source, last_health_status, last_health_check, last_action, last_action_at, restart_count, exit_code, exit_reason, framework, serve_path, created_at, updated_at",
      )
      .eq("user_id", auth.userId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (projectId) {
      fallback = fallback.eq("project_id", projectId);
    }
    const retry = await fallback;
    data = (retry.data ?? null) as Record<string, unknown>[] | null;
    error = retry.error ? { message: retry.error.message } : null;
  }

  if (error) {
    const message = error.message ?? "";
    if (
      message.toLowerCase().includes("does not exist") ||
      message.toLowerCase().includes("not found")
    ) {
      return NextResponse.json(
        {
          ok: true,
          instances: [],
          warning: "runtime_instances table is not provisioned yet.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: "lookup_failed", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      instances: data ?? [],
      generated_at: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
