import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  decryptToken,
  fetchAccessibleRepos,
  GithubOAuthError,
  getGithubOAuthConfig,
  type GithubRepoSummary,
} from "@/src/lib/github-oauth";
import { getRequestSession, logServerEvent } from "@/src/lib/server-supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Re-fetch the connected user's GitHub repositories and persist them into
 * `github_repositories` (RLS-scoped to the calling user).
 *
 * Called from the integration page on demand. We do NOT auto-poll on a cron
 * here — repo sync is intended to run on:
 *   - explicit user click (this endpoint), or
 *   - GitHub webhook receipt (future phase).
 */
export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { client, userId } = session;

  const accountResp = await client
    .from("github_accounts")
    .select(
      "id, github_login, github_user_type, access_token_encrypted, token_scope",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (accountResp.error) {
    if (isMissingTable(accountResp.error.message)) {
      return NextResponse.json(
        { error: "github_accounts_missing", message: "Run the GTLNAV GitHub OAuth setup SQL." },
        { status: 412 },
      );
    }
    return NextResponse.json(
      { error: "github_accounts_query_failed", message: accountResp.error.message },
      { status: 500 },
    );
  }

  const account = accountResp.data;
  if (!account?.access_token_encrypted) {
    return NextResponse.json(
      { error: "not_connected", message: "Connect GitHub before syncing repositories." },
      { status: 409 },
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.access_token_encrypted as string);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not decrypt GitHub token.";
    await logServerEvent(client, {
      userId,
      event: "github_token_decrypt_failed",
      message,
      level: "error",
    });
    return NextResponse.json({ error: "decrypt_failed", message }, { status: 500 });
  }

  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI ?? request.nextUrl.origin;
  let config;
  try {
    config = getGithubOAuthConfig(redirectUri);
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "GitHub OAuth not configured.";
    return NextResponse.json(
      { error: "github_oauth_unavailable", message },
      { status: 503 },
    );
  }

  let repos: GithubRepoSummary[];
  try {
    repos = await fetchAccessibleRepos(config, accessToken, {
      perPage: 100,
      pages: 3,
    });
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "Failed to fetch repositories.";
    await logServerEvent(client, {
      userId,
      event: "github_repo_sync_failed",
      message,
      level: "error",
    });
    return NextResponse.json(
      { error: "github_fetch_failed", message },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  let written = 0;
  let writeError: string | null = null;

  for (const repo of repos) {
    const fullPayload = {
      user_id: userId,
      github_account_id: account.id,
      github_repo_id: repo.id,
      full_name: repo.fullName,
      name: repo.name,
      owner_login: repo.ownerLogin,
      owner_type: repo.ownerType,
      html_url: repo.htmlUrl,
      clone_url: repo.cloneUrl,
      default_branch: repo.defaultBranch,
      is_private: repo.private,
      is_archived: repo.archived,
      is_fork: repo.fork,
      description: repo.description,
      language: repo.language,
      stargazers_count: repo.stargazersCount,
      pushed_at: repo.pushedAt,
      synced_at: now,
      updated_at: now,
      metadata: {
        scopes: account.token_scope ?? "",
      },
    };

    let resp = await client
      .from("github_repositories")
      .upsert(fullPayload, { onConflict: "github_repo_id" });

    if (resp.error) {
      // Schema-tolerant fallback — minimal column set.
      const minimal = {
        user_id: userId,
        github_account_id: account.id,
        github_repo_id: repo.id,
        full_name: repo.fullName,
        default_branch: repo.defaultBranch,
        is_private: repo.private,
        synced_at: now,
      } as Record<string, unknown>;
      resp = await client
        .from("github_repositories")
        .upsert(minimal, { onConflict: "github_repo_id" });
      if (resp.error) {
        writeError = resp.error.message;
        break;
      }
    }
    written += 1;
  }

  if (writeError) {
    return NextResponse.json(
      { error: "github_repositories_write_failed", message: writeError, written },
      { status: 500 },
    );
  }

  await logServerEvent(client, {
    userId,
    event: "github_repo_synced",
    message: `Synced ${written} GitHub repositories.`,
    metadata: {
      github_login: account.github_login,
      count: written,
    },
  });

  return NextResponse.json({
    ok: true,
    written,
    fetched: repos.length,
    synced_at: now,
  });
}

function isMissingTable(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("could not find the table") ||
    lower.includes("schema cache")
  );
}
