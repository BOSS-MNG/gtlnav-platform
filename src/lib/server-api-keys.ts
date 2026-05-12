/**
 * GTLNAV — server-only API key verification.
 *
 * Verifies a plaintext API key (issued from /dashboard/settings) against
 * `public.api_keys` and returns the authenticated user identity + scopes.
 *
 *   Authorization: Bearer gtlnav_live_pat_xxxxxxxxxxxxxxxx
 *
 * Storage contract (created by AccountSettingsClient):
 *   - key_prefix : "gtlnav_live_pat_xxxxx"  (display only, ~17 chars)
 *   - key_hash   : "sha256:<64 hex chars>"  (SHA-256 of full plaintext)
 *   - token_type : "personal" | "deployment" | "cli"
 *   - scopes     : text[]
 *   - revoked_at : nullable timestamptz
 *   - last_used_at : nullable timestamptz
 *
 * This module:
 *   1. Never runs in the browser.
 *   2. Uses the SUPABASE_SERVICE_ROLE_KEY to look up by `key_hash` across
 *      tenants. The service role NEVER reaches the browser; this file is
 *      guarded with an explicit window check.
 *   3. Falls back to the anon client if the service role is missing — that
 *      path will only succeed if your `api_keys` policies permit it (they
 *      should NOT). The route surfaces `service_role_missing` so operators
 *      can fix configuration.
 *   4. Is schema-tolerant: handles a missing `api_keys` table, missing
 *      optional columns, and best-effort `last_used_at` updates.
 *   5. Audits every verification attempt to `infrastructure_logs`.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

if (typeof window !== "undefined") {
  throw new Error(
    "server-api-keys.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type ApiKeyTokenType = "personal" | "deployment" | "cli" | string;

export type VerifiedApiKey = {
  ok: true;
  /** auth.users.id of the key owner. */
  userId: string;
  /** api_keys.id (uuid). */
  keyId: string;
  tokenType: ApiKeyTokenType;
  scopes: string[];
  keyPrefix: string | null;
  /** ISO timestamps echoed back for clients that want them. */
  createdAt: string | null;
  lastUsedAt: string | null;
};

export type ApiKeyError =
  | "missing_authorization"
  | "malformed_authorization"
  | "malformed_key"
  | "table_missing"
  | "service_role_missing"
  | "lookup_failed"
  | "not_found"
  | "revoked"
  | "scope_denied"
  | "internal_error";

export type ApiKeyFailure = {
  ok: false;
  /** HTTP status the route should respond with. */
  status: number;
  error: ApiKeyError;
  message: string;
};

export type ApiKeyResult = VerifiedApiKey | ApiKeyFailure;

export type VerifyOptions = {
  /**
   * Required scopes. Verification fails (403) if the key does not carry
   * EVERY scope listed here. Empty array / undefined = no scope requirement.
   */
  requireScopes?: string[];
  /**
   * Required token type. Useful when an endpoint should only accept e.g.
   * deployment keys. Empty / undefined = no type requirement.
   */
  requireTokenTypes?: ApiKeyTokenType[];
  /**
   * Best-effort metadata captured into the audit log.
   */
  audit?: {
    ip?: string | null;
    userAgent?: string | null;
    route?: string | null;
  };
};

// ---------------------------------------------------------------------------
//  Authorization header parsing
// ---------------------------------------------------------------------------

const KEY_FORMAT = /^gtlnav_(live|test)_(pat|dep|cli)_[A-Za-z0-9]{16,128}$/;

/**
 * Parse an `Authorization` header into a Bearer token. Returns null when the
 * header is missing or doesn't follow the `Bearer <token>` shape.
 *
 * Accepts either a full HeadersInit-style object or a NextRequest.
 */
export function parseAuthorizationHeader(
  source: NextRequest | Headers | { authorization?: string | null } | string | null | undefined,
): string | null {
  let raw: string | null = null;

  if (!source) {
    raw = null;
  } else if (typeof source === "string") {
    raw = source;
  } else if (source instanceof Headers) {
    raw = source.get("authorization") ?? source.get("Authorization");
  } else if ("headers" in source && source.headers && typeof (source.headers as Headers).get === "function") {
    raw =
      (source.headers as Headers).get("authorization") ??
      (source.headers as Headers).get("Authorization");
  } else if ("authorization" in source) {
    raw = (source as { authorization?: string | null }).authorization ?? null;
  }

  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^bearer\s+/i.test(trimmed)) return null;
  const token = trimmed.replace(/^bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Lightweight format validator. Lets the verifier short-circuit obviously
 * malformed values (random JWTs, GitHub tokens, etc.) without hitting the
 * database. NOT a security boundary on its own.
 */
export function looksLikeGtlnavApiKey(token: string): boolean {
  return KEY_FORMAT.test(token);
}

// ---------------------------------------------------------------------------
//  Hashing
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext API key with SHA-256, returning `sha256:<lowercase hex>`.
 * Format intentionally matches the client-side hash written by
 * AccountSettingsClient via `crypto.subtle.digest("SHA-256", ...)` so that
 * existing keys verify without re-issue.
 */
export function hashApiKey(plaintext: string): string {
  const hex = createHash("sha256").update(plaintext, "utf8").digest("hex");
  return `sha256:${hex}`;
}

/**
 * Constant-time compare of two `sha256:<hex>` strings. We pre-compare lengths
 * first (cheap, constant-time-equivalent for our fixed format) then use
 * timingSafeEqual on equal-length buffers. Extra layer of belt-and-suspenders
 * even though the DB lookup itself uses an exact-match query.
 */
export function constantTimeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Supabase clients (server-only)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE ?? "";

let cachedAdmin: SupabaseClient | null = null;
let cachedAnon: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return null;
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-gtlnav-source": "api-key-verifier",
      },
    },
  });
  return cachedAdmin;
}

function getAnonClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  if (cachedAnon) return cachedAnon;
  cachedAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cachedAnon;
}

// ---------------------------------------------------------------------------
//  Audit logging (best-effort)
// ---------------------------------------------------------------------------

type AuditTone = "info" | "warning" | "error";

function safeAudit(
  client: SupabaseClient | null,
  args: {
    userId: string | null;
    event: "api_key_verify_success" | "api_key_verify_failed";
    message: string;
    severity: AuditTone;
    metadata: Record<string, unknown>;
  },
) {
  if (!client) return;
  // Fire-and-forget. We never want auditing to block / fail the verification.
  void (async () => {
    const fullPayload = {
      user_id: args.userId,
      project_id: null,
      event_type: args.event,
      level: args.severity,
      severity: args.severity,
      message: args.message,
      source: "api_key_verifier",
      metadata: args.metadata,
    };
    const first = await client.from("infrastructure_logs").insert(fullPayload);
    if (!first.error) return;

    const minimal = {
      user_id: args.userId,
      project_id: null,
      event_type: args.event,
      severity: args.severity,
      message: args.message,
    };
    const retry = await client.from("infrastructure_logs").insert(minimal);
    if (retry.error && process.env.NODE_ENV !== "production") {
      console.warn(
        "[gtlnav/server-api-keys] audit log insert failed:",
        retry.error.message,
      );
    }
  })();
}

// ---------------------------------------------------------------------------
//  Lookup helpers
// ---------------------------------------------------------------------------

type ApiKeyRow = {
  id: string;
  user_id: string;
  name: string | null;
  key_prefix: string | null;
  key_hash: string | null;
  token_type: string | null;
  scopes: string[] | null;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

function isMissingTableError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("not found")
  );
}

async function lookupByHash(
  client: SupabaseClient,
  keyHash: string,
): Promise<{ row: ApiKeyRow | null; error: { message: string } | null; missingTable: boolean }> {
  const res = await client
    .from("api_keys")
    .select(
      "id, user_id, name, key_prefix, key_hash, token_type, scopes, created_at, last_used_at, revoked_at",
    )
    .eq("key_hash", keyHash)
    .limit(1)
    .maybeSingle();

  if (res.error) {
    if (isMissingTableError(res.error.message)) {
      return { row: null, error: null, missingTable: true };
    }
    return { row: null, error: { message: res.error.message }, missingTable: false };
  }
  return { row: (res.data ?? null) as ApiKeyRow | null, error: null, missingTable: false };
}

/**
 * Best-effort `last_used_at` bump. Never fails the verification on error.
 */
async function bumpLastUsed(
  client: SupabaseClient,
  keyId: string,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("api_keys")
    .update({ last_used_at: now })
    .eq("id", keyId)
    .eq("user_id", userId);
  if (error && process.env.NODE_ENV !== "production") {
    console.warn(
      "[gtlnav/server-api-keys] last_used_at update failed:",
      error.message,
    );
  }
}

// ---------------------------------------------------------------------------
//  Public verification API
// ---------------------------------------------------------------------------

function fail(
  status: number,
  error: ApiKeyError,
  message: string,
): ApiKeyFailure {
  return { ok: false, status, error, message };
}

/**
 * Verify a plaintext GTLNAV API key. Server-only.
 *
 * Resolution order:
 *   1. Validate format & shape.
 *   2. Hash plaintext → sha256:<hex>.
 *   3. Look up `api_keys` by exact `key_hash` using the service-role client
 *      (cross-tenant read by design — the user's JWT is unknown here).
 *   4. Reject if revoked.
 *   5. Enforce required scopes / token types if specified.
 *   6. Best-effort bump `last_used_at`.
 *   7. Audit success/failure to `infrastructure_logs`.
 */
export async function verifyApiKey(
  plaintext: string | null | undefined,
  options: VerifyOptions = {},
): Promise<ApiKeyResult> {
  const auditMeta: Record<string, unknown> = {
    ip: options.audit?.ip ?? null,
    user_agent: options.audit?.userAgent ?? null,
    route: options.audit?.route ?? null,
  };

  if (!plaintext) {
    const failure = fail(401, "missing_authorization", "Missing API key.");
    safeAudit(getAdminClient() ?? getAnonClient(), {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: { ...auditMeta, error: failure.error },
    });
    return failure;
  }

  const token = plaintext.trim();
  if (token.length < 16 || token.length > 256) {
    const failure = fail(400, "malformed_key", "Malformed API key.");
    safeAudit(getAdminClient() ?? getAnonClient(), {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: { ...auditMeta, error: failure.error, length: token.length },
    });
    return failure;
  }

  if (!looksLikeGtlnavApiKey(token)) {
    const failure = fail(400, "malformed_key", "API key format not recognized.");
    safeAudit(getAdminClient() ?? getAnonClient(), {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: { ...auditMeta, error: failure.error },
    });
    return failure;
  }

  const keyHash = hashApiKey(token);
  const prefix = token.slice(0, Math.min(token.length, 22));
  auditMeta.key_prefix = prefix;
  auditMeta.key_hash_short = keyHash.slice(7, 7 + 12); // first 12 hex chars

  const admin = getAdminClient();
  const lookupClient = admin ?? getAnonClient();

  if (!lookupClient) {
    const failure = fail(
      500,
      "internal_error",
      "Supabase is not configured on this server.",
    );
    return failure;
  }

  const { row, error, missingTable } = await lookupByHash(lookupClient, keyHash);

  if (missingTable) {
    const failure = fail(
      503,
      "table_missing",
      "api_keys table is not provisioned. Run the developer settings setup SQL.",
    );
    safeAudit(lookupClient, {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "error",
      metadata: { ...auditMeta, error: failure.error },
    });
    return failure;
  }

  if (error) {
    // If the anon client refused the lookup because of RLS, that is the
    // single most common deployment error here — surface it explicitly so
    // operators can configure the service role.
    const lower = error.message.toLowerCase();
    const looksLikeRls =
      lower.includes("permission denied") ||
      lower.includes("row-level security") ||
      lower.includes("rls");

    if (!admin && looksLikeRls) {
      const failure = fail(
        503,
        "service_role_missing",
        "SUPABASE_SERVICE_ROLE_KEY is not configured on this server. The api_keys table cannot be queried under RLS without it.",
      );
      safeAudit(lookupClient, {
        userId: null,
        event: "api_key_verify_failed",
        message: failure.message,
        severity: "error",
        metadata: { ...auditMeta, error: failure.error, supabase: error.message },
      });
      return failure;
    }

    const failure = fail(500, "lookup_failed", `api_keys lookup failed: ${error.message}`);
    safeAudit(lookupClient, {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "error",
      metadata: { ...auditMeta, error: failure.error, supabase: error.message },
    });
    return failure;
  }

  if (!row || !row.key_hash) {
    const failure = fail(401, "not_found", "API key not recognized.");
    safeAudit(lookupClient, {
      userId: null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: { ...auditMeta, error: failure.error },
    });
    return failure;
  }

  // Belt-and-suspenders timing-safe compare on the hashes we just matched.
  if (!constantTimeHashEqual(row.key_hash, keyHash)) {
    const failure = fail(401, "not_found", "API key not recognized.");
    safeAudit(lookupClient, {
      userId: row.user_id ?? null,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: { ...auditMeta, error: failure.error, reason: "hash_mismatch" },
    });
    return failure;
  }

  if (row.revoked_at) {
    const failure = fail(401, "revoked", "API key has been revoked.");
    safeAudit(lookupClient, {
      userId: row.user_id,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: {
        ...auditMeta,
        error: failure.error,
        key_id: row.id,
        revoked_at: row.revoked_at,
      },
    });
    return failure;
  }

  const scopes = Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === "string") : [];
  const tokenType = (row.token_type ?? "personal") as ApiKeyTokenType;

  const required = options.requireScopes ?? [];
  if (required.length > 0) {
    const missing = required.filter((s) => !scopes.includes(s));
    if (missing.length > 0) {
      const failure = fail(
        403,
        "scope_denied",
        `Missing required scope(s): ${missing.join(", ")}.`,
      );
      safeAudit(lookupClient, {
        userId: row.user_id,
        event: "api_key_verify_failed",
        message: failure.message,
        severity: "warning",
        metadata: {
          ...auditMeta,
          error: failure.error,
          key_id: row.id,
          required_scopes: required,
          available_scopes: scopes,
          missing_scopes: missing,
        },
      });
      return failure;
    }
  }

  const requiredTypes = options.requireTokenTypes ?? [];
  if (requiredTypes.length > 0 && !requiredTypes.includes(tokenType)) {
    const failure = fail(
      403,
      "scope_denied",
      `Token type "${tokenType}" is not allowed for this endpoint.`,
    );
    safeAudit(lookupClient, {
      userId: row.user_id,
      event: "api_key_verify_failed",
      message: failure.message,
      severity: "warning",
      metadata: {
        ...auditMeta,
        error: failure.error,
        key_id: row.id,
        token_type: tokenType,
        required_token_types: requiredTypes,
      },
    });
    return failure;
  }

  // Success — bump last_used_at (best effort) and emit audit success row.
  void bumpLastUsed(lookupClient, row.id, row.user_id);

  safeAudit(lookupClient, {
    userId: row.user_id,
    event: "api_key_verify_success",
    message: `API key ${row.key_prefix ?? row.id} verified.`,
    severity: "info",
    metadata: {
      ...auditMeta,
      key_id: row.id,
      token_type: tokenType,
      scopes,
    },
  });

  return {
    ok: true,
    userId: row.user_id,
    keyId: row.id,
    tokenType,
    scopes,
    keyPrefix: row.key_prefix ?? null,
    createdAt: row.created_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
  };
}

// ---------------------------------------------------------------------------
//  Convenience for API routes
// ---------------------------------------------------------------------------

/**
 * Resolve an API key from a NextRequest's `Authorization` header and verify
 * it. Combines `parseAuthorizationHeader` + `verifyApiKey` and folds the
 * client IP / user agent / route into the audit metadata.
 */
export async function verifyApiKeyFromRequest(
  request: NextRequest,
  options: VerifyOptions = {},
): Promise<ApiKeyResult> {
  const token = parseAuthorizationHeader(request);
  if (!token) {
    return fail(
      401,
      "missing_authorization",
      "Authorization header must be 'Bearer <api key>'.",
    );
  }
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;
  return verifyApiKey(token, {
    ...options,
    audit: {
      ip,
      userAgent: request.headers.get("user-agent"),
      route: request.nextUrl.pathname,
      ...(options.audit ?? {}),
    },
  });
}
