import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import { rateLimit } from "@/src/lib/server-rate-limit";
import { logInfra } from "@/src/lib/server-deployments";
import {
  buildDnsInstructions,
  getExpectedDnsTarget,
  loadOwnedDomain,
  markDomainVerified,
  runDnsCheck,
} from "@/src/lib/server-domains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/domains/[id]/verify
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Effect:
 *   1. Load the owned `domains` row.
 *   2. Run a real CNAME / A lookup with `node:dns/promises`.
 *   3. If the user's domain points at the expected target, set
 *      `domains.status = 'verified'` (and `verified_at = now`).
 *   4. Append `dns_check_success` or `dns_check_failed` to
 *      `infrastructure_logs`.
 *
 * The route never auto-demotes a previously-verified row on a transient
 * lookup failure — operators control demotion explicitly.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: domainId } = await params;

  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Phase 6B.7 — DNS lookups are expensive and ACME has its own rate limits.
  // Cap at 10 verify checks / minute per user.
  const limit = rateLimit(request, {
    bucket: "domain_verify",
    key: auth.userId,
    capacity: 10,
    refillPerMinute: 10,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: limit.message,
        retry_after_seconds: limit.retryAfterSeconds,
      },
      { status: 429, headers: limit.headers },
    );
  }

  const loaded = await loadOwnedDomain(auth.client, {
    domainId,
    userId: auth.userId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, error: loaded.error, message: loaded.message },
      { status: loaded.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const expected = getExpectedDnsTarget(loaded.domain);
  const result = await runDnsCheck(loaded.domain.domain, expected);
  const instructions = buildDnsInstructions(loaded.domain, expected);

  if (!result.matched) {
    await logInfra(auth.client, {
      userId: auth.userId,
      projectId: loaded.domain.project_id,
      eventType: "dns_check_failed",
      severity: "warning",
      message: `DNS check failed for ${loaded.domain.domain} — expected target ${expected}.`,
      metadata: {
        domain_id: loaded.domain.id,
        domain: loaded.domain.domain,
        expected_target: expected,
        match_kind: result.match_kind,
        is_apex: result.is_apex,
        found_records: result.found_records,
        errors: result.errors,
        auth_kind: auth.kind,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "dns_not_matched",
        message: `Did not find a ${result.is_apex ? "matching A record" : "CNAME"} at ${loaded.domain.domain} pointing to ${expected}.`,
        domain_id: loaded.domain.id,
        domain: loaded.domain.domain,
        status: loaded.domain.status,
        ssl_status: loaded.domain.ssl_status,
        verified: false,
        result,
        instructions,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Matched. Promote status if not already verified.
  let updatedDomain = loaded.domain;
  let mutated = false;
  if ((loaded.domain.status ?? "").toLowerCase() !== "verified") {
    const upd = await markDomainVerified(auth.client, {
      domainId: loaded.domain.id,
      userId: auth.userId,
    });
    if (upd.ok) {
      updatedDomain = upd.domain;
      mutated = true;
    } else {
      // Update failure is non-fatal for verification — surface a warning but
      // still report the DNS check succeeded.
      await logInfra(auth.client, {
        userId: auth.userId,
        projectId: loaded.domain.project_id,
        eventType: "dns_check_success",
        severity: "warning",
        message: `DNS verified for ${loaded.domain.domain} but row update failed: ${upd.message}.`,
        metadata: {
          domain_id: loaded.domain.id,
          update_error: upd.error,
        },
      });
    }
  }

  await logInfra(auth.client, {
    userId: auth.userId,
    projectId: loaded.domain.project_id,
    eventType: "dns_check_success",
    severity: "success",
    message: `DNS verified for ${loaded.domain.domain} → ${expected} (${result.match_kind}).`,
    metadata: {
      domain_id: loaded.domain.id,
      domain: loaded.domain.domain,
      expected_target: expected,
      match_kind: result.match_kind,
      mutated,
      previous_status: loaded.domain.status,
      auth_kind: auth.kind,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      verified: true,
      mutated,
      domain_id: updatedDomain.id,
      domain: updatedDomain.domain,
      status: updatedDomain.status,
      ssl_status: updatedDomain.ssl_status,
      verified_at: updatedDomain.verified_at ?? null,
      result,
      instructions,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use POST." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } },
  );
}
