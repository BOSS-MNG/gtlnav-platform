import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  GithubOAuthError,
  getGithubOAuthConfig,
  newOAuthState,
} from "@/src/lib/github-oauth";
import { getRequestSession, logServerEvent } from "@/src/lib/server-supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Begin the GitHub OAuth flow.
 *
 * Flow:
 *  1. Browser POSTs here with `Authorization: Bearer <supabase access token>`.
 *  2. We validate the user's session (RLS-bound client).
 *  3. We mint an OAuth state, set HttpOnly cookies (state + uid), and return
 *     `{ url }` for the browser to redirect to.
 *
 * We never expose the GitHub client secret. Cookies use SameSite=Lax so they
 * survive the GitHub round-trip and arrive on the callback request.
 */
export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const redirectUri = resolveRedirectUri(request);

  let config;
  try {
    config = getGithubOAuthConfig(redirectUri);
  } catch (err) {
    const message =
      err instanceof GithubOAuthError ? err.message : "GitHub OAuth is not configured.";
    await logServerEvent(session.client, {
      userId: session.userId,
      event: "github_oauth_misconfigured",
      message,
      level: "warn",
    });
    return NextResponse.json(
      { error: "github_oauth_unavailable", message },
      { status: 503 },
    );
  }

  const state = newOAuthState();
  const authorizeUrl = buildAuthorizeUrl(config, state);

  await logServerEvent(session.client, {
    userId: session.userId,
    event: "github_oauth_start",
    message: "GTLNAV redirected user to GitHub OAuth.",
    metadata: {
      scopes: config.scopes,
      redirect_uri: redirectUri,
    },
  });

  const response = NextResponse.json({ url: authorizeUrl });
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("gtlnav_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set("gtlnav_oauth_uid", session.userId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}

/**
 * Resolve the redirect URI we'll register with GitHub. The order is:
 *   1. `GITHUB_OAUTH_REDIRECT_URI` env var (recommended for production).
 *   2. `NEXT_PUBLIC_APP_URL` env var + `/api/oauth/github/callback`.
 *   3. The current request's origin.
 */
function resolveRedirectUri(request: NextRequest): string {
  const explicit = process.env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return joinUrl(appUrl, "/api/oauth/github/callback");
  const origin = request.nextUrl.origin;
  return joinUrl(origin, "/api/oauth/github/callback");
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}
