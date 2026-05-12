/**
 * GTLNAV — server-side Git repo access helpers.
 *
 * The browser never sees the GitHub access token. Routes call into here to:
 *
 *   1. Load a project owned by the caller.
 *   2. Resolve the linked `github_repositories` row (by `repo_url`).
 *   3. Decrypt the user's GitHub OAuth access token from `github_accounts`.
 *   4. Talk to the GitHub API on the server with that token.
 *   5. Return only public-safe shapes (branch names, default branch, repo
 *      metadata) — never the token.
 *
 * Schema-tolerant: missing tables / columns degrade gracefully with a
 * `503 / 412` response instead of a crash.
 *
 * Server-only: throws if imported from a 'use client' component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptToken,
  fetchRepoBranches,
  GithubOAuthError,
  getGithubOAuthConfig,
  type GithubBranchSummary,
  type GithubOAuthConfig,
} from "./github-oauth";
import {
  isMissingColumn,
  isMissingTable,
} from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-github-repos.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Project + repo row types
// ---------------------------------------------------------------------------

export type ProjectWithRepoRow = {
  id: string;
  user_id: string;
  name: string | null;
  slug: string | null;
  repo_url: string | null;
  framework: string | null;
  status: string | null;
};

export type GithubAccountRow = {
  id: string;
  user_id: string;
  github_login: string | null;
  github_user_type: string | null;
  access_token_encrypted: string | null;
  token_scope: string | null;
  status: string | null;
};

export type GithubRepoRow = {
  id: string;
  user_id: string;
  github_account_id: string | null;
  github_repo_id: number | null;
  full_name: string | null;
  name: string | null;
  owner_login: string | null;
  owner_type: string | null;
  html_url: string | null;
  clone_url: string | null;
  default_branch: string | null;
  is_private: boolean | null;
  is_archived: boolean | null;
  is_fork: boolean | null;
  description: string | null;
  language: string | null;
  stargazers_count: number | null;
  pushed_at: string | null;
  synced_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type RepoIdentity = {
  ownerLogin: string;
  repoName: string;
  fullName: string;
  /** Original `repo_url` from the project row (cleaned). */
  repoUrl: string;
  /** Canonical `https://github.com/<owner>/<repo>` form. */
  htmlUrl: string;
};

// ---------------------------------------------------------------------------
//  URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub repo URL into `{ owner, repo, fullName, htmlUrl }`.
 * Accepts the formats GTLNAV stores in `projects.repo_url`:
 *
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - http://github.com/owner/repo
 *   - github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *
 * Returns null for any non-GitHub or unparseable input.
 */
export function parseGithubRepoUrl(input: string | null | undefined): RepoIdentity | null {
  if (!input || typeof input !== "string") return null;
  const cleaned = input.trim();
  if (!cleaned) return null;

  // SSH form: git@github.com:owner/repo.git
  const sshMatch = /^git@github\.com:([^\s/]+)\/([^\s/]+?)(?:\.git)?\/?$/i.exec(cleaned);
  if (sshMatch) {
    return makeIdentity(cleaned, sshMatch[1], sshMatch[2]);
  }

  // HTTPS / bare host form
  let normalized = cleaned;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized.replace(/^\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  if (!/^github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.split("/").filter((s) => s.length > 0);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repoRaw = parts[1].replace(/\.git$/i, "");
  if (!owner || !repoRaw) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repoRaw)) {
    return null;
  }
  return makeIdentity(cleaned, owner, repoRaw);
}

function makeIdentity(repoUrl: string, owner: string, repoRaw: string): RepoIdentity {
  const repoName = repoRaw.replace(/\.git$/i, "");
  const ownerLogin = owner.trim();
  return {
    ownerLogin,
    repoName,
    fullName: `${ownerLogin}/${repoName}`,
    repoUrl,
    htmlUrl: `https://github.com/${ownerLogin}/${repoName}`,
  };
}

// ---------------------------------------------------------------------------
//  Project loader (with repo_url)
// ---------------------------------------------------------------------------

const PROJECT_WITH_REPO_SELECT =
  "id, user_id, name, slug, repo_url, framework, status";

export type LoadProjectWithRepoResult =
  | { ok: true; project: ProjectWithRepoRow }
  | { ok: false; status: number; error: string; message: string };

export async function loadProjectWithRepo(
  client: SupabaseClient,
  args: { projectId: string; userId: string },
): Promise<LoadProjectWithRepoResult> {
  if (!args.projectId) {
    return {
      ok: false,
      status: 400,
      error: "missing_project_id",
      message: "project_id is required.",
    };
  }
  let res = await client
    .from("projects")
    .select(PROJECT_WITH_REPO_SELECT)
    .eq("id", args.projectId)
    .eq("user_id", args.userId)
    .maybeSingle();

  // Schema-tolerant: retry without optional columns if framework/status absent.
  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("projects")
      .select("id, user_id, name, slug, repo_url")
      .eq("id", args.projectId)
      .eq("user_id", args.userId)
      .maybeSingle();
  }

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "projects_table_missing",
        message: "projects table is not provisioned.",
      };
    }
    if (isMissingColumn(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "projects_repo_url_missing",
        message:
          'projects.repo_url column is not provisioned. Add it with: alter table public.projects add column if not exists repo_url text;',
      };
    }
    return {
      ok: false,
      status: 500,
      error: "projects_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return {
      ok: false,
      status: 404,
      error: "project_not_found",
      message: "Project not found or not owned by caller.",
    };
  }

  const row = res.data as Record<string, unknown>;
  const project: ProjectWithRepoRow = {
    id: String(row.id),
    user_id: String(row.user_id),
    name: row.name != null ? String(row.name) : null,
    slug: row.slug != null ? String(row.slug) : null,
    repo_url: row.repo_url != null ? String(row.repo_url) : null,
    framework: row.framework != null ? String(row.framework) : null,
    status: row.status != null ? String(row.status) : null,
  };
  return { ok: true, project };
}

// ---------------------------------------------------------------------------
//  github_accounts loader + token decrypt
// ---------------------------------------------------------------------------

export type LoadGithubAccountResult =
  | { ok: true; account: GithubAccountRow }
  | {
      ok: false;
      status: number;
      error:
        | "github_accounts_table_missing"
        | "github_not_connected"
        | "github_accounts_lookup_failed";
      message: string;
    };

export async function loadGithubAccountForUser(
  client: SupabaseClient,
  userId: string,
): Promise<LoadGithubAccountResult> {
  const res = await client
    .from("github_accounts")
    .select(
      "id, user_id, github_login, github_user_type, access_token_encrypted, token_scope, status",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 412,
        error: "github_accounts_table_missing",
        message:
          "github_accounts table is not provisioned. Run the GTLNAV GitHub OAuth setup SQL.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "github_accounts_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data || !(res.data as Record<string, unknown>).access_token_encrypted) {
    return {
      ok: false,
      status: 409,
      error: "github_not_connected",
      message:
        "No connected GitHub account for this user. Connect GitHub from the integrations page.",
    };
  }

  const row = res.data as Record<string, unknown>;
  return {
    ok: true,
    account: {
      id: String(row.id),
      user_id: String(row.user_id),
      github_login: row.github_login != null ? String(row.github_login) : null,
      github_user_type:
        row.github_user_type != null ? String(row.github_user_type) : null,
      access_token_encrypted: String(row.access_token_encrypted),
      token_scope: row.token_scope != null ? String(row.token_scope) : null,
      status: row.status != null ? String(row.status) : null,
    },
  };
}

export type DecryptedTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Decrypt the access token. Returns a friendly failure (never throws to
 * the route) so endpoints can map it to JSON.
 */
export function decryptAccountAccessToken(
  account: GithubAccountRow,
): DecryptedTokenResult {
  if (!account.access_token_encrypted) {
    return {
      ok: false,
      status: 409,
      error: "github_not_connected",
      message: "No GitHub access token stored for this account.",
    };
  }
  try {
    const plaintext = decryptToken(account.access_token_encrypted);
    if (!plaintext) {
      return {
        ok: false,
        status: 500,
        error: "github_token_decrypt_failed",
        message: "Decrypted GitHub token was empty.",
      };
    }
    return { ok: true, accessToken: plaintext };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not decrypt GitHub token.";
    return {
      ok: false,
      status: 500,
      error: "github_token_decrypt_failed",
      message,
    };
  }
}

// ---------------------------------------------------------------------------
//  github_repositories — find row matching the project's repo_url
// ---------------------------------------------------------------------------

const REPO_SELECT =
  "id, user_id, github_account_id, github_repo_id, full_name, name, owner_login, owner_type, html_url, clone_url, default_branch, is_private, is_archived, is_fork, description, language, stargazers_count, pushed_at, synced_at, metadata";

export type FindLinkedRepoResult =
  | { ok: true; repo: GithubRepoRow }
  | { ok: false; notFound: true; message: string }
  | { ok: false; notFound: false; status: number; error: string; message: string };

export async function findLinkedGithubRepository(
  client: SupabaseClient,
  args: { userId: string; identity: RepoIdentity },
): Promise<FindLinkedRepoResult> {
  const candidates = unique([
    `https://github.com/${args.identity.fullName}`,
    `https://github.com/${args.identity.fullName}.git`,
    args.identity.repoUrl,
  ]);

  const orFilter = [
    `full_name.eq.${args.identity.fullName}`,
    ...candidates.map((u) => `html_url.eq.${escapeOrValue(u)}`),
    ...candidates.map((u) => `clone_url.eq.${escapeOrValue(u)}`),
  ].join(",");

  let res = await client
    .from("github_repositories")
    .select(REPO_SELECT)
    .eq("user_id", args.userId)
    .or(orFilter)
    .order("synced_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Schema-tolerant: some columns might be absent (e.g. `synced_at` order).
  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("github_repositories")
      .select("id, user_id, github_account_id, full_name, default_branch, is_private")
      .eq("user_id", args.userId)
      .eq("full_name", args.identity.fullName)
      .limit(1)
      .maybeSingle();
  }

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        notFound: false,
        status: 412,
        error: "github_repositories_table_missing",
        message:
          "github_repositories table is not provisioned. Run the GTLNAV GitHub OAuth setup SQL.",
      };
    }
    return {
      ok: false,
      notFound: false,
      status: 500,
      error: "github_repositories_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return {
      ok: false,
      notFound: true,
      message: `No github_repositories row links project repo "${args.identity.fullName}". Run sync-repo or call /sync from the integrations page.`,
    };
  }

  const row = res.data as Record<string, unknown>;
  return { ok: true, repo: rowToGithubRepoRow(row) };
}

// ---------------------------------------------------------------------------
//  GitHub API helpers
// ---------------------------------------------------------------------------

export type GithubRepoMeta = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  description: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  language: string | null;
  ownerLogin: string;
  ownerType: string;
  stargazersCount: number;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
};

export type FetchRepoMetaResult =
  | { ok: true; meta: GithubRepoMeta }
  | { ok: false; status: number; error: string; message: string };

export async function fetchGithubRepoMeta(
  config: GithubOAuthConfig,
  accessToken: string,
  identity: RepoIdentity,
): Promise<FetchRepoMetaResult> {
  const url = `${config.apiBase}/repos/${encodeURIComponent(identity.ownerLogin)}/${encodeURIComponent(identity.repoName)}`;
  const res = await fetch(url, {
    headers: ghHeaders(accessToken),
    cache: "no-store",
  });
  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      error: "github_token_unauthorized",
      message:
        "GitHub rejected the stored access token. The user must reconnect GitHub.",
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      error: "github_forbidden",
      message:
        "GitHub returned 403 — insufficient permissions or rate limit hit.",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      status: 404,
      error: "github_repo_not_accessible",
      message: `Repository "${identity.fullName}" is not accessible to the connected GitHub account.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: "github_repo_fetch_failed",
      message: `GitHub /repos returned ${res.status}.`,
    };
  }
  const json = (await res.json()) as Record<string, unknown>;
  const owner = (json.owner ?? {}) as Record<string, unknown>;
  const perms = (json.permissions ?? {}) as Record<string, unknown>;
  const meta: GithubRepoMeta = {
    id: Number(json.id ?? 0),
    name: String(json.name ?? identity.repoName),
    fullName: String(json.full_name ?? identity.fullName),
    htmlUrl: String(json.html_url ?? identity.htmlUrl),
    cloneUrl: String(json.clone_url ?? `${identity.htmlUrl}.git`),
    defaultBranch: String(json.default_branch ?? "main"),
    private: Boolean(json.private),
    archived: Boolean(json.archived),
    fork: Boolean(json.fork),
    description: typeof json.description === "string" ? json.description : null,
    pushedAt: typeof json.pushed_at === "string" ? json.pushed_at : null,
    updatedAt: typeof json.updated_at === "string" ? json.updated_at : null,
    language: typeof json.language === "string" ? json.language : null,
    ownerLogin: String(owner.login ?? identity.ownerLogin),
    ownerType: String(owner.type ?? "User"),
    stargazersCount: Number(json.stargazers_count ?? 0),
    permissions: {
      admin: Boolean(perms.admin),
      push: Boolean(perms.push),
      pull: Boolean(perms.pull),
    },
  };
  return { ok: true, meta };
}

export async function fetchBranchesForIdentity(
  config: GithubOAuthConfig,
  accessToken: string,
  identity: RepoIdentity,
): Promise<
  | { ok: true; branches: GithubBranchSummary[] }
  | { ok: false; status: number; error: string; message: string }
> {
  try {
    const branches = await fetchRepoBranches(config, accessToken, identity.fullName);
    return { ok: true, branches };
  } catch (err) {
    if (err instanceof GithubOAuthError) {
      if (err.code === "branches_http_error" && /\b(401)\b/.test(err.message)) {
        return {
          ok: false,
          status: 401,
          error: "github_token_unauthorized",
          message:
            "GitHub rejected the stored access token. The user must reconnect GitHub.",
        };
      }
      if (err.code === "branches_http_error" && /\b(403)\b/.test(err.message)) {
        return {
          ok: false,
          status: 403,
          error: "github_forbidden",
          message: "GitHub returned 403 fetching branches.",
        };
      }
      if (err.code === "branches_http_error" && /\b(404)\b/.test(err.message)) {
        return {
          ok: false,
          status: 404,
          error: "github_repo_not_accessible",
          message: `Repository "${identity.fullName}" is not accessible.`,
        };
      }
      return {
        ok: false,
        status: 502,
        error: "github_branches_fetch_failed",
        message: err.message,
      };
    }
    return {
      ok: false,
      status: 502,
      error: "github_branches_fetch_failed",
      message: err instanceof Error ? err.message : "Failed to fetch branches.",
    };
  }
}

// ---------------------------------------------------------------------------
//  github_repositories upsert (no token, only metadata)
// ---------------------------------------------------------------------------

export type UpsertRepoMetaResult =
  | { ok: true; repo: GithubRepoRow; written: "full" | "minimal" }
  | { ok: false; status: number; error: string; message: string };

export async function upsertGithubRepositoryRow(
  client: SupabaseClient,
  args: {
    userId: string;
    accountId: string;
    meta: GithubRepoMeta;
    tokenScope: string | null;
  },
): Promise<UpsertRepoMetaResult> {
  const now = new Date().toISOString();
  const fullPayload: Record<string, unknown> = {
    user_id: args.userId,
    github_account_id: args.accountId,
    github_repo_id: args.meta.id,
    full_name: args.meta.fullName,
    name: args.meta.name,
    owner_login: args.meta.ownerLogin,
    owner_type: args.meta.ownerType,
    html_url: args.meta.htmlUrl,
    clone_url: args.meta.cloneUrl,
    default_branch: args.meta.defaultBranch,
    is_private: args.meta.private,
    is_archived: args.meta.archived,
    is_fork: args.meta.fork,
    description: args.meta.description,
    language: args.meta.language,
    stargazers_count: args.meta.stargazersCount,
    pushed_at: args.meta.pushedAt,
    synced_at: now,
    updated_at: now,
    metadata: {
      scopes: args.tokenScope ?? "",
      permissions: args.meta.permissions,
    },
  };

  let res = await client
    .from("github_repositories")
    .upsert(fullPayload, { onConflict: "github_repo_id" })
    .select(REPO_SELECT)
    .maybeSingle();

  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 412,
        error: "github_repositories_table_missing",
        message:
          "github_repositories table is not provisioned. Run the GTLNAV GitHub OAuth setup SQL.",
      };
    }
    const minimal: Record<string, unknown> = {
      user_id: args.userId,
      github_account_id: args.accountId,
      github_repo_id: args.meta.id,
      full_name: args.meta.fullName,
      default_branch: args.meta.defaultBranch,
      is_private: args.meta.private,
      synced_at: now,
    };
    res = await client
      .from("github_repositories")
      .upsert(minimal, { onConflict: "github_repo_id" })
      .select("id, user_id, github_account_id, full_name, default_branch, is_private")
      .maybeSingle();
    if (res.error || !res.data) {
      return {
        ok: false,
        status: 500,
        error: "github_repositories_upsert_failed",
        message: res.error?.message ?? "Failed to upsert github_repositories row.",
      };
    }
    return {
      ok: true,
      repo: rowToGithubRepoRow(res.data as Record<string, unknown>),
      written: "minimal",
    };
  }

  if (res.error || !res.data) {
    return {
      ok: false,
      status: 500,
      error: "github_repositories_upsert_failed",
      message: res.error?.message ?? "Failed to upsert github_repositories row.",
    };
  }
  return {
    ok: true,
    repo: rowToGithubRepoRow(res.data as Record<string, unknown>),
    written: "full",
  };
}

// ---------------------------------------------------------------------------
//  Public entry: end-to-end "prepare repo access" flow
// ---------------------------------------------------------------------------

export type PreparedRepoAccess = {
  project: ProjectWithRepoRow;
  identity: RepoIdentity;
  account: GithubAccountRow;
  accessToken: string;
  config: GithubOAuthConfig;
};

export type PreparedRepoAccessResult =
  | { ok: true; ready: PreparedRepoAccess }
  | { ok: false; status: number; error: string; message: string };

/**
 * Common prelude for the three repo-access endpoints:
 *   1. Load the project (must own + must have repo_url).
 *   2. Parse repo_url into owner/repo.
 *   3. Load the user's github_accounts row.
 *   4. Decrypt the token.
 *   5. Resolve a GitHub OAuth config from env.
 *
 * The returned `accessToken` MUST stay server-side. Callers should never
 * place it into an HTTP response.
 */
export async function prepareRepoAccess(
  client: SupabaseClient,
  args: { projectId: string; userId: string; redirectUri: string },
): Promise<PreparedRepoAccessResult> {
  const projectResult = await loadProjectWithRepo(client, {
    projectId: args.projectId,
    userId: args.userId,
  });
  if (!projectResult.ok) return projectResult;

  const project = projectResult.project;
  const identity = parseGithubRepoUrl(project.repo_url);
  if (!identity) {
    return {
      ok: false,
      status: 422,
      error: "project_repo_url_missing",
      message:
        "Project has no parseable github.com repo_url. Set repo_url on the project to a https://github.com/<owner>/<repo> value.",
    };
  }

  const accountResult = await loadGithubAccountForUser(client, args.userId);
  if (!accountResult.ok) return accountResult;

  const tokenResult = decryptAccountAccessToken(accountResult.account);
  if (!tokenResult.ok) return tokenResult;

  let config: GithubOAuthConfig;
  try {
    config = getGithubOAuthConfig(args.redirectUri);
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "GitHub OAuth not configured.";
    return {
      ok: false,
      status: 503,
      error: "github_oauth_unavailable",
      message,
    };
  }

  return {
    ok: true,
    ready: {
      project,
      identity,
      account: accountResult.account,
      accessToken: tokenResult.accessToken,
      config,
    },
  };
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

function ghHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "GTLNAV-Platform",
  };
}

function rowToGithubRepoRow(row: Record<string, unknown>): GithubRepoRow {
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : "",
    github_account_id:
      row.github_account_id != null ? String(row.github_account_id) : null,
    github_repo_id:
      row.github_repo_id != null ? Number(row.github_repo_id) : null,
    full_name: row.full_name != null ? String(row.full_name) : null,
    name: row.name != null ? String(row.name) : null,
    owner_login: row.owner_login != null ? String(row.owner_login) : null,
    owner_type: row.owner_type != null ? String(row.owner_type) : null,
    html_url: row.html_url != null ? String(row.html_url) : null,
    clone_url: row.clone_url != null ? String(row.clone_url) : null,
    default_branch: row.default_branch != null ? String(row.default_branch) : null,
    is_private: row.is_private != null ? Boolean(row.is_private) : null,
    is_archived: row.is_archived != null ? Boolean(row.is_archived) : null,
    is_fork: row.is_fork != null ? Boolean(row.is_fork) : null,
    description: row.description != null ? String(row.description) : null,
    language: row.language != null ? String(row.language) : null,
    stargazers_count:
      row.stargazers_count != null ? Number(row.stargazers_count) : null,
    pushed_at: row.pushed_at != null ? String(row.pushed_at) : null,
    synced_at: row.synced_at != null ? String(row.synced_at) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function escapeOrValue(value: string): string {
  // PostgREST `or=` accepts comma-separated filters. Commas, parentheses,
  // and quotes inside a value must be wrapped in double quotes.
  if (/[,()"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
