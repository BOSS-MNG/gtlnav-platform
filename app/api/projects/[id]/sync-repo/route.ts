import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { logInfra } from "@/src/lib/server-deployments";
import {
  fetchGithubRepoMeta,
  prepareRepoAccess,
  upsertGithubRepositoryRow,
} from "@/src/lib/server-github-repos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/sync-repo
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Effect:
 *   1. Load the owned project, parse `repo_url` into owner/repo.
 *   2. Decrypt the user's GitHub OAuth token (server-side only).
 *   3. Fetch fresh metadata from GitHub /repos/{owner}/{repo}.
 *   4. Upsert into `github_repositories` (RLS-scoped to the user).
 *   5. Append `github_repo_synced` to infrastructure_logs.
 *
 * The GitHub access token is NEVER returned in the response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const auth = await authenticateRequest(request);
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
  const { project, identity, account, accessToken, config } = prepared.ready;

  const meta = await fetchGithubRepoMeta(config, accessToken, identity);
  if (!meta.ok) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: project.id,
      eventType: "github_repo_sync_failed",
      severity: "warning",
      message: `Repo sync failed for ${identity.fullName}: ${meta.message}`,
      metadata: {
        repo_full_name: identity.fullName,
        error: meta.error,
      },
    });
    return NextResponse.json(
      { ok: false, error: meta.error, message: meta.message },
      { status: meta.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const upsert = await upsertGithubRepositoryRow(auth.client, {
    userId: auth.userId,
    accountId: account.id,
    meta: meta.meta,
    tokenScope: account.token_scope,
  });
  if (!upsert.ok) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: project.id,
      eventType: "github_repo_sync_failed",
      severity: "warning",
      message: `Repo metadata persisted to memory but DB upsert failed for ${identity.fullName}: ${upsert.message}`,
      metadata: {
        repo_full_name: identity.fullName,
        error: upsert.error,
      },
    });
    return NextResponse.json(
      { ok: false, error: upsert.error, message: upsert.message },
      { status: upsert.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: project.id,
    eventType: "github_repo_synced",
    severity: "success",
    message: `Synced GitHub repo ${identity.fullName} for project ${project.name ?? project.slug ?? project.id}.`,
    metadata: {
      repo_full_name: identity.fullName,
      default_branch: meta.meta.defaultBranch,
      is_private: meta.meta.private,
      written: upsert.written,
      auth_kind: auth.kind,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      project_id: project.id,
      synced_at: upsert.repo.synced_at,
      written: upsert.written,
      repo: {
        github_repo_id: upsert.repo.github_repo_id,
        full_name: upsert.repo.full_name,
        name: upsert.repo.name,
        owner_login: upsert.repo.owner_login,
        owner_type: upsert.repo.owner_type,
        html_url: upsert.repo.html_url,
        clone_url: upsert.repo.clone_url,
        default_branch: upsert.repo.default_branch,
        is_private: upsert.repo.is_private,
        is_archived: upsert.repo.is_archived,
        is_fork: upsert.repo.is_fork,
        description: upsert.repo.description,
        language: upsert.repo.language,
        stargazers_count: upsert.repo.stargazers_count,
        pushed_at: upsert.repo.pushed_at,
        synced_at: upsert.repo.synced_at,
      },
      permissions: meta.meta.permissions,
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
