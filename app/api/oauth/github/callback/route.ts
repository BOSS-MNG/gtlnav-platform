import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  encryptToken,
  exchangeCodeForToken,
  fetchAuthenticatedUser,
  GithubOAuthError,
  getGithubOAuthConfig,
  verifyOAuthState,
} from "@/src/lib/github-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GitHub redirects the browser back here with `?code=...&state=...`.
 *
 * We:
 *  1. Verify the `state` cookie matches the `state` query param (CSRF guard).
 *  2. Read the `uid` cookie we set in `/start` to know which Supabase user is
 *     connecting (we are not in a user session here — the redirect is a top
 *     level GET so no Authorization header is available).
 *  3. Exchange the code for an access token (server-only secret).
 *  4. Fetch `/user` to capture login + viewer metadata.
 *  5. Upsert into `github_accounts` using a Supabase client *bound to the
 *     user's identity* through a JWT we mint via `auth.signInWithIdToken` —
 *     except we don't have one. We therefore use the anon client with an
 *     `Authorization: Bearer <uid>` header? — no, that won't satisfy RLS.
 *
 * Pragmatic approach: this route uses the service role key (server-only env
 * var, never exposed to the browser) to write the OAuth account row scoped to
 * the user_id we read from the HttpOnly cookie. RLS policies on
 * `github_accounts` SHOULD restrict `select/update/delete` to the owning
 * user — keeping our blast radius the same as a per-user JWT client.
 *
 * If `SUPABASE_SERVICE_ROLE_KEY` is not configured, we fall back to the anon
 * client and rely on a permissive `insert` policy (documented in the SQL
 * setup card on the integration page). Either way, no service role secret
 * ever reaches the browser.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const settledRedirect = settledRedirectUrl(request);

  if (errorParam) {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: errorParam }),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "missing_code" }),
    );
  }

  const cookieState = request.cookies.get("gtlnav_oauth_state")?.value ?? "";
  const cookieUid = request.cookies.get("gtlnav_oauth_uid")?.value ?? "";
  if (!cookieState || !verifyOAuthState(cookieState, state)) {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "state_mismatch" }),
    );
  }
  if (!cookieUid) {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "session_lost" }),
    );
  }

  const redirectUri = resolveRedirectUri(request);

  let config;
  try {
    config = getGithubOAuthConfig(redirectUri);
  } catch {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "oauth_misconfigured" }),
    );
  }

  let token;
  try {
    token = await exchangeCodeForToken(config, code);
  } catch (err) {
    const reason =
      err instanceof GithubOAuthError ? err.code : "token_exchange_failed";
    return NextResponse.redirect(withParams(settledRedirect, { error: reason }));
  }

  let viewer;
  try {
    viewer = await fetchAuthenticatedUser(config, token.accessToken);
  } catch {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "viewer_lookup_failed" }),
    );
  }

  const supabase = buildWriteClient();
  if (!supabase) {
    return NextResponse.redirect(
      withParams(settledRedirect, { error: "supabase_unconfigured" }),
    );
  }

  const accessTokenEncrypted = encryptToken(token.accessToken);
  const refreshTokenEncrypted = token.refreshToken
    ? encryptToken(token.refreshToken)
    : null;

  const expiresAt = token.expiresIn
    ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
    : null;
  const refreshExpiresAt = token.refreshTokenExpiresIn
    ? new Date(Date.now() + token.refreshTokenExpiresIn * 1000).toISOString()
    : null;

  const now = new Date().toISOString();

  const fullPayload = {
    user_id: cookieUid,
    github_user_id: viewer.id,
    github_login: viewer.login,
    github_user_type: viewer.type,
    display_name: viewer.name,
    email: viewer.email,
    avatar_url: viewer.avatarUrl,
    access_token_encrypted: accessTokenEncrypted,
    refresh_token_encrypted: refreshTokenEncrypted,
    token_scope: token.scope,
    token_type: token.tokenType,
    expires_at: expiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    status: "connected",
    connected_at: now,
    updated_at: now,
    metadata: {
      scopes_requested: config.scopes,
      redirect_uri: redirectUri,
    },
  };

  const { error: upsertError } = await supabase
    .from("github_accounts")
    .upsert(fullPayload, { onConflict: "user_id" });

  if (upsertError) {
    // Schema-tolerant fallback — drop optional metadata columns and retry.
    const minimalPayload = {
      user_id: cookieUid,
      github_user_id: viewer.id,
      github_login: viewer.login,
      access_token_encrypted: accessTokenEncrypted,
      status: "connected",
      connected_at: now,
    } as Record<string, unknown>;
    const retry = await supabase
      .from("github_accounts")
      .upsert(minimalPayload, { onConflict: "user_id" });
    if (retry.error) {
      return NextResponse.redirect(
        withParams(settledRedirect, {
          error: "store_failed",
          detail: encodeURIComponent(retry.error.message),
        }),
      );
    }
  }

  // Best-effort audit log.
  await safeLog(supabase, {
    user_id: cookieUid,
    event: "github_oauth_connected",
    message: `Connected GitHub account @${viewer.login}.`,
    level: "info",
    metadata: {
      github_login: viewer.login,
      github_user_type: viewer.type,
      scopes: token.scope,
    },
  });

  // Clear the short-lived OAuth cookies so they cannot be reused.
  const response = NextResponse.redirect(
    withParams(settledRedirect, { connected: "1", login: viewer.login }),
  );
  response.cookies.set("gtlnav_oauth_state", "", { path: "/", maxAge: 0 });
  response.cookies.set("gtlnav_oauth_uid", "", { path: "/", maxAge: 0 });
  return response;
}

/**
 * Build a Supabase client that can write to `github_accounts`. We prefer the
 * service-role key (server-only env var) because the browser never has a
 * session at the OAuth callback — but if it isn't set we fall back to the
 * anon key and require an `INSERT/UPDATE` policy on `github_accounts` keyed
 * by `user_id`.
 */
function buildWriteClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl) return null;
  const key = serviceRoleKey || anonKey;
  if (!key) return null;
  return createClient(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function safeLog(
  client: ReturnType<typeof buildWriteClient>,
  payload: {
    user_id: string;
    event: string;
    message: string;
    level: "info" | "warn" | "error";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!client) return;
  const full = {
    ...payload,
    created_at: new Date().toISOString(),
  };
  const { error } = await client.from("infrastructure_logs").insert(full);
  if (!error) return;
  const minimal = {
    user_id: payload.user_id,
    event: payload.event,
    message: payload.message,
  } as Record<string, unknown>;
  await client.from("infrastructure_logs").insert(minimal);
}

function settledRedirectUrl(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return joinUrl(appUrl, "/dashboard/integrations/github");
  return joinUrl(request.nextUrl.origin, "/dashboard/integrations/github");
}

function resolveRedirectUri(request: NextRequest): string {
  const explicit = process.env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return joinUrl(appUrl, "/api/oauth/github/callback");
  return joinUrl(request.nextUrl.origin, "/api/oauth/github/callback");
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

function withParams(
  baseUrl: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
