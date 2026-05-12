import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { logInfra } from "@/src/lib/server-deployments";
import {
  fetchBranchesForIdentity,
  findLinkedGithubRepository,
  prepareRepoAccess,
} from "@/src/lib/server-github-repos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/branches
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Returns the list of branches for the project's linked GitHub repo. The
 * GitHub access token is decrypted server-side and is NEVER included in the
 * response body or headers.
 *
 * Response:
 *   200 { ok: true,
 *         project_id, repo: { full_name, html_url, default_branch, is_private,
 *                              linked_repo_id }, branches: [{ name, sha,
 *                              protected, is_default }] }
 *   4xx { ok: false, error, message }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const auth = await authenticateRequest(request, {
    requireScopes: undefined,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const prepared = await prepareRepoAccess(auth.client, {
    projectId,
    userId: auth.userId,
    redirectUri:
      process.env.GITHUB_OAUTH_REDIRECT_URI ?? request.nextUrl.origin,
  });
  if (!prepared.ok) {
    return NextResponse.json(
      { ok: false, error: prepared.error, message: prepared.message },
      { status: prepared.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { project, identity, accessToken, config } = prepared.ready;

  // Best-effort: associate any local mirror row.
  const linked = await findLinkedGithubRepository(auth.client, {
    userId: auth.userId,
    identity,
  });
  const linkedRepoId =
    linked.ok && linked.repo ? linked.repo.id : null;

  const branchesResult = await fetchBranchesForIdentity(
    config,
    accessToken,
    identity,
  );
  if (!branchesResult.ok) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: project.id,
      eventType: "github_branches_failed",
      severity: "warning",
      message: `Branch fetch failed for ${identity.fullName}: ${branchesResult.message}`,
      metadata: {
        repo_full_name: identity.fullName,
        error: branchesResult.error,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: branchesResult.error,
        message: branchesResult.message,
      },
      { status: branchesResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const defaultBranch =
    (linked.ok && linked.repo?.default_branch
      ? linked.repo.default_branch
      : null) ??
    inferDefaultFromBranchList(branchesResult.branches);

  const branches = branchesResult.branches.map((b) => ({
    name: b.name,
    sha: b.commitSha || null,
    protected: b.protected,
    is_default: defaultBranch ? b.name === defaultBranch : false,
  }));

  return NextResponse.json(
    {
      ok: true,
      project_id: project.id,
      repo: {
        full_name: identity.fullName,
        html_url: identity.htmlUrl,
        default_branch: defaultBranch,
        is_private: linked.ok && linked.repo ? linked.repo.is_private : null,
        linked_repo_id: linkedRepoId,
      },
      branches,
      branch_count: branches.length,
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

function inferDefaultFromBranchList(
  branches: Array<{ name: string }>,
): string | null {
  if (branches.length === 0) return null;
  const lookups = ["main", "master", "develop", "trunk"];
  for (const want of lookups) {
    const hit = branches.find((b) => b.name === want);
    if (hit) return hit.name;
  }
  return branches[0].name;
}
