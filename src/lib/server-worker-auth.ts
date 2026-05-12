/**
 * GTLNAV — server-side worker authentication.
 *
 * Two accepted modes:
 *
 *   1. Platform-wide build pool (cross-tenant claim allowed):
 *
 *        x-gtlnav-worker-secret: <GTLNAV_WORKER_SECRET>
 *        x-gtlnav-worker-id:     <worker label>           (optional)
 *
 *   2. Self-hosted / per-tenant worker, authenticated via a GTLNAV API key
 *      that EITHER carries `token_type = "deployment"` OR includes a worker
 *      scope (`"worker"` or `"deployments:worker"`):
 *
 *        Authorization: Bearer gtlnav_live_dep_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *        x-gtlnav-worker-id:     <worker label>           (optional)
 *
 * Mode 1 returns `scopeUserId: null` — the worker can claim any pending job.
 * Mode 2 returns `scopeUserId: <key owner uuid>` — the worker can ONLY act
 * on jobs owned by that user.
 *
 * Both modes return the cached service-role Supabase client so workers can
 * update job rows that are owned by other tenants (mode 1) or update job
 * rows where they don't carry an end-user JWT (mode 2). The service role
 * key is server-only and never reaches the browser — this module throws if
 * imported from a 'use client' component.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  looksLikeGtlnavApiKey,
  parseAuthorizationHeader,
  verifyApiKey,
  type ApiKeyTokenType,
} from "./server-api-keys";
import { getServerAdminClient } from "./server-auth";

if (typeof window !== "undefined") {
  throw new Error(
    "server-worker-auth.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

const WORKER_SCOPES = new Set(["worker", "deployments:worker"]);

const WORKER_SECRET =
  process.env.GTLNAV_WORKER_SECRET ?? process.env.WORKER_SECRET ?? "";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type WorkerSecretIdentity = {
  ok: true;
  kind: "worker_secret";
  /** null = cross-tenant; worker may claim any pending job. */
  scopeUserId: null;
  workerLabel: string;
  client: SupabaseClient;
};

export type WorkerApiKeyIdentity = {
  ok: true;
  kind: "api_key";
  /** API-key worker mode is scoped to the key owner. */
  scopeUserId: string;
  keyId: string;
  tokenType: ApiKeyTokenType;
  scopes: string[];
  workerLabel: string;
  client: SupabaseClient;
};

export type WorkerIdentity = WorkerSecretIdentity | WorkerApiKeyIdentity;

export type WorkerAuthFailure = {
  ok: false;
  status: number;
  error:
    | "missing_authorization"
    | "invalid_worker_secret"
    | "invalid_authorization"
    | "api_key_invalid"
    | "scope_denied"
    | "service_role_missing";
  message: string;
};

export type WorkerAuthResult = WorkerIdentity | WorkerAuthFailure;

// ---------------------------------------------------------------------------
//  Public: authenticateWorker
// ---------------------------------------------------------------------------

export async function authenticateWorker(
  request: NextRequest,
): Promise<WorkerAuthResult> {
  const headerSecret =
    request.headers.get("x-gtlnav-worker-secret") ??
    request.headers.get("X-GTLNAV-Worker-Secret") ??
    "";

  // ---- Mode 1: worker secret ---------------------------------------------
  if (headerSecret) {
    if (!WORKER_SECRET) {
      return {
        ok: false,
        status: 503,
        error: "invalid_worker_secret",
        message:
          "GTLNAV_WORKER_SECRET is not configured on this server. Cannot accept worker secret authentication.",
      };
    }
    if (!constantTimeStringEqual(headerSecret, WORKER_SECRET)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_worker_secret",
        message: "Invalid worker secret.",
      };
    }
    const admin = getServerAdminClient();
    if (!admin) {
      return {
        ok: false,
        status: 503,
        error: "service_role_missing",
        message:
          "Worker authentication requires SUPABASE_SERVICE_ROLE_KEY on this server.",
      };
    }
    return {
      ok: true,
      kind: "worker_secret",
      scopeUserId: null,
      workerLabel:
        request.headers.get("x-gtlnav-worker-id") ??
        request.headers.get("X-GTLNAV-Worker-Id") ??
        "worker:secret",
      client: admin,
    };
  }

  // ---- Mode 2: API key with worker scope ---------------------------------
  const token = parseAuthorizationHeader(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "missing_authorization",
      message:
        "Worker requires either x-gtlnav-worker-secret header or Bearer GTLNAV API key with worker scope.",
    };
  }
  if (!looksLikeGtlnavApiKey(token)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_authorization",
      message:
        "Worker authentication only accepts GTLNAV API keys (gtlnav_live_*).",
    };
  }

  const verified = await verifyApiKey(token, {
    audit: {
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        null,
      userAgent: request.headers.get("user-agent"),
      route: request.nextUrl.pathname,
    },
  });
  if (!verified.ok) {
    if (verified.error === "service_role_missing" || verified.error === "table_missing") {
      return {
        ok: false,
        status: verified.status,
        error: "service_role_missing",
        message: verified.message,
      };
    }
    return {
      ok: false,
      status: verified.status,
      error: "api_key_invalid",
      message: verified.message,
    };
  }

  const tokenType = (verified.tokenType ?? "").toString().toLowerCase();
  const hasWorkerScope =
    tokenType === "deployment" ||
    verified.scopes.some((s) => WORKER_SCOPES.has(s));
  if (!hasWorkerScope) {
    return {
      ok: false,
      status: 403,
      error: "scope_denied",
      message:
        'Worker endpoints require an API key with token_type="deployment" or scope="worker"/"deployments:worker".',
    };
  }

  const admin = getServerAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 503,
      error: "service_role_missing",
      message:
        "Worker authentication requires SUPABASE_SERVICE_ROLE_KEY on this server.",
    };
  }

  return {
    ok: true,
    kind: "api_key",
    scopeUserId: verified.userId,
    keyId: verified.keyId,
    tokenType: verified.tokenType,
    scopes: verified.scopes,
    workerLabel:
      request.headers.get("x-gtlnav-worker-id") ??
      request.headers.get("X-GTLNAV-Worker-Id") ??
      `api_key:${verified.keyId.slice(0, 8)}`,
    client: admin,
  };
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function constantTimeStringEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  if (A.length !== B.length) {
    // Avoid early-return timing leak: do a fixed-cost compare anyway.
    const padded = Buffer.alloc(A.length, 0);
    try {
      timingSafeEqual(A, padded);
    } catch {
      // ignore
    }
    return false;
  }
  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}
