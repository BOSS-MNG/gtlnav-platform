import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { loadOwnedProjectRecord } from "@/src/lib/server-projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const loaded = await loadOwnedProjectRecord(auth.client, {
    projectId: id,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      project: loaded.project,
      generated_at: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
