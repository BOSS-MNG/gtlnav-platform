/**
 * GTLNAV — Real GitHub OAuth foundation (server-only helpers).
 *
 * IMPORTANT:
 * - This module is server-only. It reads `GITHUB_OAUTH_CLIENT_ID`,
 *   `GITHUB_OAUTH_CLIENT_SECRET`, and `GTLNAV_TOKEN_ENCRYPTION_KEY` from
 *   `process.env`. Never import this from a `"use client"` component.
 * - We use AES-256-GCM via `node:crypto` to encrypt access / refresh tokens
 *   at rest. If `GTLNAV_TOKEN_ENCRYPTION_KEY` is not set, we still encode the
 *   token with a marker prefix so it is obvious it is not encrypted yet —
 *   but we log a warning. Production deployments MUST set the env var.
 * - Webhook installation, organization sync, and token refresh are wired as
 *   architecture only (function stubs / metadata) — no outbound writes.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Hard guard — fail fast if this module is somehow bundled into a browser.
if (typeof window !== "undefined") {
  throw new Error(
    "github-oauth.ts must only be imported from server runtime (API routes, server components). " +
      "Never import it from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Configuration
// ---------------------------------------------------------------------------

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";

/** OAuth scopes requested by GTLNAV — minimum surface for repo + webhook prep. */
export const GITHUB_DEFAULT_SCOPES = [
  "read:user",
  "user:email",
  "repo",
  "admin:repo_hook",
  "read:org",
] as const;

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
  /** Optional override (e.g. for GitHub App vs OAuth App separation). */
  authorizeUrl: string;
  tokenUrl: string;
  apiBase: string;
};

export class GithubOAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GithubOAuthError";
  }
}

/**
 * Resolve the OAuth config from env. Throws a descriptive error if either
 * the client id or secret is missing — surface that to the operator UI so
 * they know to set environment variables.
 */
export function getGithubOAuthConfig(redirectUri: string): GithubOAuthConfig {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new GithubOAuthError(
      "missing_env",
      "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be set on the server.",
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: GITHUB_DEFAULT_SCOPES,
    authorizeUrl: process.env.GITHUB_OAUTH_AUTHORIZE_URL ?? GITHUB_AUTHORIZE_URL,
    tokenUrl: process.env.GITHUB_OAUTH_TOKEN_URL ?? GITHUB_TOKEN_URL,
    apiBase: process.env.GITHUB_API_BASE ?? GITHUB_API_BASE,
  };
}

/**
 * Build the redirect URL for a GitHub authorization request.
 * The `state` value MUST be persisted in an HttpOnly cookie before the user
 * is bounced to GitHub so the callback can verify it.
 */
export function buildAuthorizeUrl(
  config: GithubOAuthConfig,
  state: string,
  options?: { allowSignup?: boolean; login?: string },
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    allow_signup: options?.allowSignup === false ? "false" : "true",
  });
  if (options?.login) params.set("login", options.login);
  return `${config.authorizeUrl}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
//  State + nonce helpers
// ---------------------------------------------------------------------------

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time comparison for the OAuth state parameter. */
export function verifyOAuthState(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Token exchange + GitHub API
// ---------------------------------------------------------------------------

export type GithubTokenExchange = {
  accessToken: string;
  tokenType: string;
  scope: string;
  refreshToken: string | null;
  expiresIn: number | null;
  refreshTokenExpiresIn: number | null;
};

export async function exchangeCodeForToken(
  config: GithubOAuthConfig,
  code: string,
): Promise<GithubTokenExchange> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "GTLNAV-Platform",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new GithubOAuthError(
      "token_http_error",
      `GitHub token endpoint returned ${res.status}.`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.error === "string") {
    throw new GithubOAuthError(
      json.error,
      typeof json.error_description === "string"
        ? json.error_description
        : "GitHub rejected the OAuth code.",
    );
  }

  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) {
    throw new GithubOAuthError("token_missing", "GitHub did not return an access token.");
  }

  return {
    accessToken,
    tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
    scope: typeof json.scope === "string" ? json.scope : "",
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
    refreshTokenExpiresIn:
      typeof json.refresh_token_expires_in === "number"
        ? json.refresh_token_expires_in
        : null,
  };
}

// ---------------------------------------------------------------------------
//  GitHub API helpers (read-only foundation)
// ---------------------------------------------------------------------------

export type GithubViewer = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  type: "User" | "Organization" | string;
};

export async function fetchAuthenticatedUser(
  config: GithubOAuthConfig,
  accessToken: string,
): Promise<GithubViewer> {
  const res = await fetch(`${config.apiBase}/user`, {
    headers: ghHeaders(accessToken),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GithubOAuthError(
      "user_http_error",
      `GitHub /user returned ${res.status}.`,
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    id: Number(json.id ?? 0),
    login: String(json.login ?? ""),
    name: typeof json.name === "string" ? json.name : null,
    email: typeof json.email === "string" ? json.email : null,
    avatarUrl: typeof json.avatar_url === "string" ? json.avatar_url : null,
    type: typeof json.type === "string" ? json.type : "User",
  };
}

export type GithubRepoSummary = {
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
};

export async function fetchAccessibleRepos(
  config: GithubOAuthConfig,
  accessToken: string,
  options?: { perPage?: number; pages?: number },
): Promise<GithubRepoSummary[]> {
  const perPage = Math.min(Math.max(options?.perPage ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(options?.pages ?? 1, 1), 5);
  const out: GithubRepoSummary[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${config.apiBase}/user/repos`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");

    const res = await fetch(url, { headers: ghHeaders(accessToken), cache: "no-store" });
    if (!res.ok) {
      throw new GithubOAuthError(
        "repos_http_error",
        `GitHub /user/repos returned ${res.status}.`,
      );
    }
    const arr = (await res.json()) as unknown;
    if (!Array.isArray(arr)) break;
    for (const r of arr) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const owner = (row.owner ?? {}) as Record<string, unknown>;
      out.push({
        id: Number(row.id ?? 0),
        name: String(row.name ?? ""),
        fullName: String(row.full_name ?? ""),
        htmlUrl: String(row.html_url ?? ""),
        cloneUrl: String(row.clone_url ?? row.html_url ?? ""),
        defaultBranch: String(row.default_branch ?? "main"),
        private: Boolean(row.private),
        archived: Boolean(row.archived),
        fork: Boolean(row.fork),
        description:
          typeof row.description === "string" ? row.description : null,
        pushedAt: typeof row.pushed_at === "string" ? row.pushed_at : null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        language: typeof row.language === "string" ? row.language : null,
        ownerLogin: String(owner.login ?? ""),
        ownerType: String(owner.type ?? "User"),
        stargazersCount: Number(row.stargazers_count ?? 0),
      });
    }
    if (arr.length < perPage) break;
  }

  return out;
}

export type GithubBranchSummary = {
  name: string;
  commitSha: string;
  protected: boolean;
};

/** Foundation: fetch branches for a single repo. Wired but UI calls it on demand. */
export async function fetchRepoBranches(
  config: GithubOAuthConfig,
  accessToken: string,
  fullName: string,
): Promise<GithubBranchSummary[]> {
  const res = await fetch(
    `${config.apiBase}/repos/${fullName}/branches?per_page=100`,
    { headers: ghHeaders(accessToken), cache: "no-store" },
  );
  if (!res.ok) {
    throw new GithubOAuthError(
      "branches_http_error",
      `GitHub /repos/${fullName}/branches returned ${res.status}.`,
    );
  }
  const arr = (await res.json()) as unknown;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => ({
      name: String(r.name ?? ""),
      commitSha:
        typeof r.commit === "object" && r.commit
          ? String((r.commit as Record<string, unknown>).sha ?? "")
          : "",
      protected: Boolean(r.protected),
    }));
}

// ---------------------------------------------------------------------------
//  Webhook installation — architecture stub
// ---------------------------------------------------------------------------

export type WebhookInstallPlan = {
  fullName: string;
  webhookUrl: string;
  events: string[];
  active: boolean;
};

/**
 * Returns the request body GTLNAV would POST to
 * `https://api.github.com/repos/{owner}/{repo}/hooks`. Not executed — keeping
 * the network surface explicit so reviewers can enable it deliberately.
 */
export function planRepoWebhook(
  fullName: string,
  webhookUrl: string,
): WebhookInstallPlan {
  return {
    fullName,
    webhookUrl,
    events: ["push", "pull_request"],
    active: true,
  };
}

// ---------------------------------------------------------------------------
//  Token refresh — architecture stub
// ---------------------------------------------------------------------------

export type RefreshedTokens = GithubTokenExchange;

/**
 * Foundation only: real implementation will POST `grant_type=refresh_token` to
 * GitHub's token endpoint once GitHub Apps with refresh tokens are enabled.
 */
export async function refreshAccessToken(
  config: GithubOAuthConfig,
  refreshToken: string,
): Promise<RefreshedTokens> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "GTLNAV-Platform",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GithubOAuthError(
      "refresh_http_error",
      `GitHub refresh endpoint returned ${res.status}.`,
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.error === "string") {
    throw new GithubOAuthError(json.error, "GitHub refused token refresh.");
  }
  return {
    accessToken: String(json.access_token ?? ""),
    tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
    scope: typeof json.scope === "string" ? json.scope : "",
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
    refreshTokenExpiresIn:
      typeof json.refresh_token_expires_in === "number"
        ? json.refresh_token_expires_in
        : null,
  };
}

// ---------------------------------------------------------------------------
//  Token encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

/**
 * Token storage envelope. The leading `v1:` lets us migrate algorithms later.
 * - `v1:enc:<iv>:<authTag>:<ciphertext>` (when encryption key is set)
 * - `v0:pt:<base64>` fallback (warning logged in dev)
 */
export type TokenEnvelope = string;

function getEncryptionKey(): Buffer | null {
  const raw = process.env.GTLNAV_TOKEN_ENCRYPTION_KEY ?? "";
  if (!raw) return null;
  // Accept either a hex string (32 bytes / 64 hex chars) or a passphrase that
  // we hash to 32 bytes via SHA-256. Either way we end up with a 256-bit key.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptToken(plaintext: string): TokenEnvelope {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[gtlnav/github-oauth] GTLNAV_TOKEN_ENCRYPTION_KEY missing — token will be stored without encryption. DO NOT ship to production.",
      );
    }
    return `v0:pt:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:enc:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptToken(envelope: TokenEnvelope): string {
  if (!envelope) return "";
  if (envelope.startsWith("v0:pt:")) {
    return Buffer.from(envelope.slice("v0:pt:".length), "base64").toString("utf8");
  }
  if (envelope.startsWith("v1:enc:")) {
    const parts = envelope.slice("v1:enc:".length).split(":");
    if (parts.length !== 3) throw new Error("Invalid token envelope");
    const [ivB64, tagB64, ctB64] = parts;
    const key = getEncryptionKey();
    if (!key) {
      throw new Error(
        "GTLNAV_TOKEN_ENCRYPTION_KEY is not set but token is encrypted.",
      );
    }
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const ct = Buffer.from(ctB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString("utf8");
  }
  throw new Error("Unknown token envelope version");
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
