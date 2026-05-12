import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  buildDnsInstructions,
  getExpectedDnsTarget,
  loadOwnedDomain,
  runDnsCheck,
} from "@/src/lib/server-domains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/domains/[id]/dns-check
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Read-only diagnostic. Resolves the user's domain via Node DNS and
 * returns the structured result without writing anything to the database.
 * Useful for live "preview" badges in the domains UI before the operator
 * commits to the `verify` mutation.
 */
export async function GET(
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

  return NextResponse.json(
    {
      ok: true,
      mutated: false,
      domain_id: loaded.domain.id,
      domain: loaded.domain.domain,
      status: loaded.domain.status,
      ssl_status: loaded.domain.ssl_status,
      result,
      instructions,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use GET." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
