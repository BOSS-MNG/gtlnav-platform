import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  createOwnedProject,
  listOwnedProjects,
} from "@/src/lib/server-projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await listOwnedProjects(auth.client, auth.userId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      count: result.projects.length,
      projects: result.projects,
      generated_at: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      body = ((await request.json()) as Record<string, unknown> | null) ?? {};
    }
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_json",
        message: "Request body is not valid JSON.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const created = await createOwnedProject(auth.client, {
    userId: auth.userId,
    name: typeof body.name === "string" ? body.name : "",
    slug: typeof body.slug === "string" ? body.slug : "",
    framework: typeof body.framework === "string" ? body.framework : null,
    provider: typeof body.provider === "string" ? body.provider : null,
    repoUrl: typeof body.repo_url === "string" ? body.repo_url : null,
    branch: typeof body.branch === "string" ? body.branch : null,
    rootDirectory:
      typeof body.root_directory === "string" ? body.root_directory : null,
    buildCommand:
      typeof body.build_command === "string" ? body.build_command : null,
    installCommand:
      typeof body.install_command === "string" ? body.install_command : null,
    outputDirectory:
      typeof body.output_directory === "string" ? body.output_directory : null,
    startCommand:
      typeof body.start_command === "string" ? body.start_command : null,
    runtimeKind:
      typeof body.runtime_kind === "string" ? body.runtime_kind : null,
    hostingKind:
      typeof body.hosting_kind === "string" ? body.hosting_kind : null,
    status: typeof body.status === "string" ? body.status : null,
  });

  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.error, message: created.message },
      { status: created.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, project: created.project },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
