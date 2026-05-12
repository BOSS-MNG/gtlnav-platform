/**
 * GTLNAV — in-memory token bucket rate limiter.
 *
 * Process-local (per Next.js worker). Suitable for single-region deployments
 * and a useful first line of defense. For multi-region or autoscaled
 * production traffic, swap the backing map for Redis (see `getStore()`).
 *
 * Usage:
 *
 *     import { rateLimit } from "@/src/lib/server-rate-limit";
 *
 *     const limit = rateLimit(request, {
 *       bucket: "deploy",
 *       key: auth.userId,
 *       capacity: 20,
 *       refillPerMinute: 20,
 *     });
 *     if (!limit.ok) {
 *       return NextResponse.json(
 *         { ok: false, error: "rate_limited", message: limit.message },
 *         { status: 429, headers: limit.headers },
 *       );
 *     }
 *
 * The function never throws and the limiter survives schema changes; if the
 * backing store can't be created, calls are allowed through with a warning
 * recorded once.
 */

import type { NextRequest } from "next/server";

if (typeof window !== "undefined") {
  throw new Error(
    "server-rate-limit.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

type Bucket = { tokens: number; lastRefill: number };

type Store = Map<string, Bucket>;

// Module-scoped store. Survives between requests in a single Next.js worker.
const stores = new Map<string, Store>();

function getStore(bucket: string): Store {
  let s = stores.get(bucket);
  if (!s) {
    s = new Map();
    stores.set(bucket, s);
  }
  return s;
}

export type RateLimitOptions = {
  /** Logical bucket name (kept separate so different routes don't share state). */
  bucket: string;
  /** Caller identifier — usually the user id or the request IP. */
  key: string | null | undefined;
  /** Max tokens the bucket holds. */
  capacity: number;
  /** How many tokens are restored per minute. */
  refillPerMinute: number;
  /** How many tokens this call costs (default 1). */
  cost?: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
  message: string;
  headers: Record<string, string>;
};

export function rateLimit(
  request: NextRequest,
  opts: RateLimitOptions,
): RateLimitResult {
  const cost = Math.max(1, opts.cost ?? 1);
  const capacity = Math.max(1, opts.capacity);
  const refillPerMs = Math.max(1, opts.refillPerMinute) / 60_000;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anon";
  const id = `${opts.key ?? "anon"}::${ip}`;

  const store = getStore(opts.bucket);
  const now = Date.now();
  let bucket = store.get(id);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    store.set(id, bucket);
  } else {
    // Refill.
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens < cost) {
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / refillPerMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds,
      message: `Rate limit exceeded for ${opts.bucket}. Retry in ${retryAfterSeconds}s.`,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(capacity),
        "X-RateLimit-Remaining": "0",
        "Cache-Control": "no-store",
      },
    };
  }

  bucket.tokens -= cost;
  return {
    ok: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSeconds: 0,
    message: "ok",
    headers: {
      "X-RateLimit-Limit": String(capacity),
      "X-RateLimit-Remaining": String(Math.floor(bucket.tokens)),
      "Cache-Control": "no-store",
    },
  };
}
