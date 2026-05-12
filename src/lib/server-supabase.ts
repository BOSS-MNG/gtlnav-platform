/**
 * GTLNAV — server-side Supabase client factory.
 *
 * This is intentionally light: we don't (yet) wire `@supabase/ssr` cookies
 * because the rest of the platform uses `auth.getSession()` in the browser.
 * Instead, API routes accept the user's JWT either:
 *   - via the `Authorization: Bearer <jwt>` header (preferred), or
 *   - via the `gtlnav_supabase_token` HttpOnly cookie that the frontend writes
 *     before redirecting to a server route.
 *
 * The returned client respects Supabase Row Level Security: every query runs
 * as `auth.uid() = <user.id>`. We deliberately do NOT use the service role
 * here — keeping all OAuth writes scoped to the connecting user.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

if (typeof window !== "undefined") {
  throw new Error(
    "server-supabase.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

export const SUPABASE_TOKEN_COOKIE = "gtlnav_supabase_token";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[gtlnav/server-supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.",
  );
}

export type ServerSupabaseSession = {
  client: SupabaseClient;
  userId: string;
  email: string | null;
  jwt: string;
};

export function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookie = request.cookies.get(SUPABASE_TOKEN_COOKIE)?.value;
  if (cookie) return cookie;
  return null;
}

/**
 * Build a Supabase client bound to the user's JWT and validate the session.
 * Returns `null` if the JWT is missing / invalid — callers should respond 401.
 */
export async function getRequestSession(
  request: NextRequest,
): Promise<ServerSupabaseSession | null> {
  const jwt = readBearerToken(request);
  if (!jwt) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data?.user) return null;

  return {
    client,
    userId: data.user.id,
    email: data.user.email ?? null,
    jwt,
  };
}

/**
 * Convenience: append a row to `infrastructure_logs` with payload metadata,
 * gracefully degrading to a minimal payload if optional columns are absent.
 */
export async function logServerEvent(
  client: SupabaseClient,
  args: {
    userId: string;
    event: string;
    message: string;
    level?: "info" | "warn" | "error";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const payload = {
    user_id: args.userId,
    event: args.event,
    message: args.message,
    level: args.level ?? "info",
    metadata: args.metadata ?? {},
    created_at: new Date().toISOString(),
  };
  const { error } = await client.from("infrastructure_logs").insert(payload);
  if (!error) return;
  // Schema-tolerant fallback — drop optional columns and try again.
  const minimal = {
    user_id: args.userId,
    event: args.event,
    message: args.message,
  } as Record<string, unknown>;
  const retry = await client.from("infrastructure_logs").insert(minimal);
  if (retry.error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[gtlnav/server-supabase] infrastructure_logs insert failed:",
        retry.error.message,
      );
    }
  }
}
