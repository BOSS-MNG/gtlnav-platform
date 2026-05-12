/**
 * GTLNAV — server-side reverse-proxy authentication.
 *
 * The reverse proxy (Caddy / Traefik / your own thing) needs to call back
 * into the control plane for three things:
 *
 *   1. `/api/proxy/tls-ok`     — "is it safe to issue a cert for host X?"
 *   2. `/api/proxy/route-config` — "what should I serve for host X?"
 *   3. `/api/proxy/ssl-status` — "I obtained / failed an ACME cert for X."
 *
 * These endpoints must accept calls from the proxy (which has no Supabase
 * session) AND optionally from the deployment worker. We authenticate with
 * a shared `GTLNAV_PROXY_SECRET`. Workers may reuse `GTLNAV_WORKER_SECRET`
 * because the deployment worker is the entity that registers routes.
 *
 * Constant-time string comparison is used for both secrets.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminClient } from "./server-auth";

if (typeof window !== "undefined") {
  throw new Error(
    "server-proxy-auth.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

const PROXY_SECRET =
  process.env.GTLNAV_PROXY_SECRET ?? process.env.PROXY_SECRET ?? "";
const WORKER_SECRET =
  process.env.GTLNAV_WORKER_SECRET ?? process.env.WORKER_SECRET ?? "";

export type ProxyAuthFailure = {
  ok: false;
  status: number;
  error:
    | "missing_secret"
    | "invalid_secret"
    | "service_role_missing"
    | "no_secret_configured";
  message: string;
};

export type ProxyAuthSuccess = {
  ok: true;
  kind: "proxy_secret" | "worker_secret";
  callerLabel: string;
  client: SupabaseClient;
};

export type ProxyAuthResult = ProxyAuthSuccess | ProxyAuthFailure;

export async function authenticateProxy(
  request: NextRequest,
): Promise<ProxyAuthResult> {
  const proxyHeader =
    request.headers.get("x-gtlnav-proxy-secret") ??
    request.headers.get("X-GTLNAV-Proxy-Secret") ??
    "";
  const workerHeader =
    request.headers.get("x-gtlnav-worker-secret") ??
    request.headers.get("X-GTLNAV-Worker-Secret") ??
    "";

  if (!PROXY_SECRET && !WORKER_SECRET) {
    return {
      ok: false,
      status: 503,
      error: "no_secret_configured",
      message:
        "Server has neither GTLNAV_PROXY_SECRET nor GTLNAV_WORKER_SECRET configured.",
    };
  }

  let identifiedAs: "proxy_secret" | "worker_secret" | null = null;
  if (proxyHeader) {
    if (!PROXY_SECRET) {
      return {
        ok: false,
        status: 503,
        error: "no_secret_configured",
        message:
          "GTLNAV_PROXY_SECRET is not configured. Cannot accept proxy callbacks.",
      };
    }
    if (!constantTimeEqual(proxyHeader, PROXY_SECRET)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_secret",
        message: "Invalid proxy secret.",
      };
    }
    identifiedAs = "proxy_secret";
  } else if (workerHeader) {
    if (!WORKER_SECRET) {
      return {
        ok: false,
        status: 503,
        error: "no_secret_configured",
        message: "GTLNAV_WORKER_SECRET is not configured.",
      };
    }
    if (!constantTimeEqual(workerHeader, WORKER_SECRET)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_secret",
        message: "Invalid worker secret.",
      };
    }
    identifiedAs = "worker_secret";
  } else {
    return {
      ok: false,
      status: 401,
      error: "missing_secret",
      message:
        "Provide x-gtlnav-proxy-secret or x-gtlnav-worker-secret header.",
    };
  }

  const admin = getServerAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 503,
      error: "service_role_missing",
      message:
        "Proxy authentication requires SUPABASE_SERVICE_ROLE_KEY on this server.",
    };
  }

  const callerLabel =
    request.headers.get("x-gtlnav-proxy-id") ??
    request.headers.get("x-gtlnav-worker-id") ??
    identifiedAs;

  return { ok: true, kind: identifiedAs, callerLabel, client: admin };
}

function constantTimeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  if (A.length !== B.length) {
    // Fixed-cost compare against zero buffer to avoid early-return timing leaks.
    const pad = Buffer.alloc(A.length, 0);
    try {
      timingSafeEqual(A, pad);
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
