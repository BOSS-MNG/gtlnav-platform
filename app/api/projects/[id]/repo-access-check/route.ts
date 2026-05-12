import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  GithubOAuthError,
  fetchAuthenticatedUser,
  getGithubOAuthConfig,
} from "@/src/lib/github-oauth";
import {
  decryptAccountAccessToken,
  fetchGithubRepoMeta,
  findLinkedGithubRepository,
  loadGithubAccountForUser,
  loadProjectWithRepo,
  parseGithubRepoUrl,
} from "@/src/lib/server-github-repos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/repo-access-check
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Read-only diagnostic that walks the entire repo-access pipeline and
 * reports the status of each step, without mutating any rows. Useful for
 * the project settings UI to render a green/red checklist.
 *
 * The decrypted GitHub access token is NEVER returned in the body.
 */
export async function GET(
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

  type Stage =
    | "project"
    | "repo_url"
    | "github_account"
    | "token_decrypt"
    | "github_oauth_config"
    | "github_token_validate"
    | "repo_accessible"
    | "github_repositories_link";

  type StageStatus = {
    stage: Stage;
    ok: boolean;
    skipped?: boolean;
    detail: string;
    error?: string;
  };

  const stages: StageStatus[] = [];
  const result: Record<string, unknown> = {
    ok: false,
    project_id: projectId,
    auth_kind: auth.kind,
    repo: {
      url: null as string | null,
      full_name: null as string | null,
      html_url: null as string | null,
      default_branch: null as string | null,
      is_private: null as boolean | null,
      archived: null as boolean | null,
    },
    github: {
      connected: false,
      login: null as string | null,
      token_valid: false as boolean,
      scopes: null as string | null,
      permissions: null as Record<string, boolean> | null,
    },
    linked_repo_id: null as string | null,
  };

  // 1. Project + ownership ---------------------------------------------------
  const projectResult = await loadProjectWithRepo(auth.client, {
    projectId,
    userId: auth.userId,
  });
  if (!projectResult.ok) {
    stages.push({
      stage: "project",
      ok: false,
      detail: projectResult.message,
      error: projectResult.error,
    });
    return NextResponse.json(
      { ...result, stages, error: projectResult.error, message: projectResult.message },
      { status: projectResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const project = projectResult.project;
  stages.push({
    stage: "project",
    ok: true,
    detail: `Project "${project.name ?? project.slug ?? project.id}" is owned by caller.`,
  });
  result.repo = { ...(result.repo as Record<string, unknown>), url: project.repo_url };

  // 2. Parse repo_url --------------------------------------------------------
  const identity = parseGithubRepoUrl(project.repo_url);
  if (!identity) {
    stages.push({
      stage: "repo_url",
      ok: false,
      detail: project.repo_url
        ? `repo_url "${project.repo_url}" is not a parseable github.com URL.`
        : "Project has no repo_url set.",
      error: "project_repo_url_missing",
    });
    return NextResponse.json(
      { ...result, stages, error: "project_repo_url_missing", message: "Project repo_url is missing or not a github.com URL." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  stages.push({
    stage: "repo_url",
    ok: true,
    detail: `Resolved repository "${identity.fullName}".`,
  });
  result.repo = {
    ...(result.repo as Record<string, unknown>),
    full_name: identity.fullName,
    html_url: identity.htmlUrl,
  };

  // 3. github_accounts -------------------------------------------------------
  const accountResult = await loadGithubAccountForUser(auth.client, auth.userId);
  if (!accountResult.ok) {
    stages.push({
      stage: "github_account",
      ok: false,
      detail: accountResult.message,
      error: accountResult.error,
    });
    return NextResponse.json(
      { ...result, stages, error: accountResult.error, message: accountResult.message },
      { status: accountResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const account = accountResult.account;
  stages.push({
    stage: "github_account",
    ok: true,
    detail: `GitHub account @${account.github_login ?? "?"} is connected.`,
  });
  result.github = {
    ...(result.github as Record<string, unknown>),
    connected: true,
    login: account.github_login,
    scopes: account.token_scope,
  };

  // 4. Token decrypt ---------------------------------------------------------
  const tokenResult = decryptAccountAccessToken(account);
  if (!tokenResult.ok) {
    stages.push({
      stage: "token_decrypt",
      ok: false,
      detail: tokenResult.message,
      error: tokenResult.error,
    });
    return NextResponse.json(
      { ...result, stages, error: tokenResult.error, message: tokenResult.message },
      { status: tokenResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  stages.push({
    stage: "token_decrypt",
    ok: true,
    detail: "GitHub OAuth token decrypted successfully (server-side only).",
  });

  // 5. GitHub OAuth config ---------------------------------------------------
  let config;
  try {
    config = getGithubOAuthConfig(
      process.env.GITHUB_OAUTH_REDIRECT_URI ?? request.nextUrl.origin,
    );
    stages.push({
      stage: "github_oauth_config",
      ok: true,
      detail: "GitHub OAuth client id/secret are configured.",
    });
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "GitHub OAuth not configured.";
    stages.push({
      stage: "github_oauth_config",
      ok: false,
      detail: message,
      error: "github_oauth_unavailable",
    });
    return NextResponse.json(
      { ...result, stages, error: "github_oauth_unavailable", message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 6. Validate token against GitHub /user -----------------------------------
  try {
    const viewer = await fetchAuthenticatedUser(config, tokenResult.accessToken);
    stages.push({
      stage: "github_token_validate",
      ok: true,
      detail: `GitHub accepted the stored token for @${viewer.login}.`,
    });
    result.github = {
      ...(result.github as Record<string, unknown>),
      token_valid: true,
      login: viewer.login,
    };
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "GitHub /user request failed.";
    stages.push({
      stage: "github_token_validate",
      ok: false,
      detail: message,
      error: "github_token_unauthorized",
    });
    return NextResponse.json(
      { ...result, stages, error: "github_token_unauthorized", message },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 7. Repo accessibility ----------------------------------------------------
  const meta = await fetchGithubRepoMeta(config, tokenResult.accessToken, identity);
  if (!meta.ok) {
    stages.push({
      stage: "repo_accessible",
      ok: false,
      detail: meta.message,
      error: meta.error,
    });
    return NextResponse.json(
      { ...result, stages, error: meta.error, message: meta.message },
      { status: meta.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  stages.push({
    stage: "repo_accessible",
    ok: true,
    detail: `Repository "${meta.meta.fullName}" is accessible (default branch: ${meta.meta.defaultBranch}).`,
  });
  result.repo = {
    ...(result.repo as Record<string, unknown>),
    default_branch: meta.meta.defaultBranch,
    is_private: meta.meta.private,
    archived: meta.meta.archived,
  };
  result.github = {
    ...(result.github as Record<string, unknown>),
    permissions: meta.meta.permissions,
  };

  // 8. Local mirror row (best-effort) ----------------------------------------
  const linked = await findLinkedGithubRepository(auth.client, {
    userId: auth.userId,
    identity,
  });
  if (linked.ok) {
    stages.push({
      stage: "github_repositories_link",
      ok: true,
      detail: `Local mirror row id ${linked.repo.id} is linked.`,
    });
    result.linked_repo_id = linked.repo.id;
  } else if (linked.notFound) {
    stages.push({
      stage: "github_repositories_link",
      ok: false,
      skipped: true,
      detail:
        "No github_repositories row links this repo yet. Call POST /api/projects/[id]/sync-repo to create one.",
      error: "github_repositories_unlinked",
    });
  } else {
    stages.push({
      stage: "github_repositories_link",
      ok: false,
      skipped: true,
      detail: linked.message,
      error: linked.error,
    });
  }

  result.ok = true;
  return NextResponse.json(
    { ...result, stages },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use GET." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
