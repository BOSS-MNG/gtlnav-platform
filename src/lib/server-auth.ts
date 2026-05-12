/**
 * GTLNAV — unified server-side request authentication.
 *
 * Accepts EITHER:
 *   1. A Supabase user session JWT (from a logged-in browser):
 *        Authorization: Bearer <supabase access token>
 *      → returns a SupabaseClient bound to the user's JWT (RLS enforced).
 *
 *   2. A GTLNAV API key issued from /dashboard/settings:
 *        Authorization: Bearer gtlnav_live_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *      → returns the cached service-role client (RLS bypassed) and the
 *        verified user_id. EVERY query made under this identity MUST
 *        explicitly filter by `user_id = identity.userId`.
 *
 * Routing rule:
 *   - Token matches /^gtlnav_(live|test)_(pat|dep|cli)_/  → API key path.
 *   - Anything else                                       → Supabase JWT path.
 *
 * This module is server-only. Importing it from a 'use client' component
 * throws at module evaluation time so the service role secret can never be
 * bundled into the browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import {
  looksLikeGtlnavApiKey,
  parseAuthorizationHeader,
  verifyApiKey,
  type ApiKeyTokenType,
} from "./server-api-keys";
import { getRequestSession } from "./server-supabase";

if (typeof window !== "undefined") {
  throw new Error(
    "server-auth.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Service-role client (cached, server-only)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE ?? "";

let cachedAdmin: SupabaseClient | null = null;

export function getServerAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return null;
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-gtlnav-source": "server-auth" },
    },
  });
  return cachedAdmin;
}

// ---------------------------------------------------------------------------
//  Identity types
// ---------------------------------------------------------------------------

export type SessionIdentity = {
  ok: true;
  kind: "session";
  userId: string;
  email: string | null;
  /** SupabaseClient bound to the user's JWT — RLS-enforced. */
  client: SupabaseClient;
  jwt: string;
};

export type ApiKeyIdentity = {
  ok: true;
  kind: "api_key";
  userId: string;
  keyId: string;
  tokenType: ApiKeyTokenType;
  scopes: string[];
  /** Service-role client. ALL queries MUST filter by user_id manually. */
  client: SupabaseClient;
};

export type AuthIdentity = SessionIdentity | ApiKeyIdentity;

export type AuthFailure = {
  ok: false;
  status: number;
  error:
    | "missing_authorization"
    | "invalid_session"
    | "service_role_missing"
    | "api_key_invalid"
    | "scope_denied"
    | "internal_error";
  message: string;
  /** When the failure originates from API key verification, the underlying
   *  verifier error code (e.g. "revoked", "scope_denied"). */
  apiKeyError?: string;
};

export type AuthResult = AuthIdentity | AuthFailure;

export type AuthenticateOptions = {
  /** Required scopes. Only enforced for API-key callers. Sessions bypass. */
  requireScopes?: string[];
  /** Required token types. Only enforced for API-key callers. */
  requireTokenTypes?: ApiKeyTokenType[];
};

// ---------------------------------------------------------------------------
//  Public: authenticateRequest
// ---------------------------------------------------------------------------

/**
 * Resolve the calling identity for an API route. Returns either an
 * `{ ok: true, kind: "session" | "api_key", ... }` identity or an
 * `{ ok: false, status, error, message }` failure ready for `NextResponse.json`.
 */
export async function authenticateRequest(
  request: NextRequest,
  options: AuthenticateOptions = {},
): Promise<AuthResult> {
  const token = parseAuthorizationHeader(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "missing_authorization",
      message: "Authorization header must be 'Bearer <token>'.",
    };
  }

  // --- API key path ---------------------------------------------------------
  if (looksLikeGtlnavApiKey(token)) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    const result = await verifyApiKey(token, {
      requireScopes: options.requireScopes,
      requireTokenTypes: options.requireTokenTypes,
      audit: {
        ip,
        userAgent: request.headers.get("user-agent"),
        route: request.nextUrl.pathname,
      },
    });

    if (!result.ok) {
      // Map verifier failures to auth failures.
      if (result.error === "service_role_missing" || result.error === "table_missing") {
        return {
          ok: false,
          status: result.status,
          error: "service_role_missing",
          message: result.message,
          apiKeyError: result.error,
        };
      }
      if (result.error === "scope_denied") {
        return {
          ok: false,
          status: 403,
          error: "scope_denied",
          message: result.message,
          apiKeyError: result.error,
        };
      }
      return {
        ok: false,
        status: result.status,
        error: "api_key_invalid",
        message: result.message,
        apiKeyError: result.error,
      };
    }

    const admin = getServerAdminClient();
    if (!admin) {
      return {
        ok: false,
        status: 503,
        error: "service_role_missing",
        message:
          "API key authentication requires SUPABASE_SERVICE_ROLE_KEY on this server.",
      };
    }

    return {
      ok: true,
      kind: "api_key",
      userId: result.userId,
      keyId: result.keyId,
      tokenType: result.tokenType,
      scopes: result.scopes,
      client: admin,
    };
  }

  // --- Supabase session path ------------------------------------------------
  const session = await getRequestSession(request);
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: "invalid_session",
      message: "Invalid or expired Supabase session.",
    };
  }

  return {
    ok: true,
    kind: "session",
    userId: session.userId,
    email: session.email,
    client: session.client,
    jwt: session.jwt,
  };
}
