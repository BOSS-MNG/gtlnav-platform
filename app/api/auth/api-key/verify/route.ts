import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  verifyApiKeyFromRequest,
  type ApiKeyResult,
  type VerifyOptions,
} from "@/src/lib/server-api-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/api-key/verify
 *
 * Verifies a GTLNAV API key carried in the `Authorization` header and returns
 * the authenticated user identity, token type and scopes.
 *
 *   Authorization: Bearer gtlnav_live_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   Content-Type:  application/json   (optional)
 *
 *   Body (optional):
 *     {
 *       "require_scopes":      ["projects:read", "deployments:write"],
 *       "require_token_types": ["personal", "deployment"]
 *     }
 *
 * Response shape on success (HTTP 200):
 *   {
 *     "ok": true,
 *     "user_id": "...",
 *     "key_id":  "...",
 *     "token_type": "personal",
 *     "scopes": ["projects:read"],
 *     "key_prefix": "gtlnav_live_pat_abc12",
 *     "created_at":  "...",
 *     "last_used_at": "..."
 *   }
 *
 * Response shape on failure (4xx/5xx):
 *   { "ok": false, "error": "<code>", "message": "..." }
 *
 * Error codes:
 *   missing_authorization | malformed_authorization | malformed_key
 *   not_found | revoked | scope_denied | table_missing
 *   service_role_missing | lookup_failed | internal_error
 */
export async function POST(request: NextRequest) {
  const options = await readOptions(request);
  const result = await verifyApiKeyFromRequest(request, options);
  return toJsonResponse(result);
}

/**
 * Convenience: GET returns 405 to make the contract explicit. Some clients
 * (curl probes, k6 smoke tests) hit GET first; we don't want to leak
 * verification semantics through an unintended GET.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "method_not_allowed",
      message: "Use POST with an Authorization: Bearer <gtlnav_*> header.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

async function readOptions(request: NextRequest): Promise<VerifyOptions> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return {};

    const requireScopes = sanitizeStringArray(body.require_scopes);
    const requireTokenTypes = sanitizeStringArray(body.require_token_types);

    return {
      requireScopes: requireScopes.length > 0 ? requireScopes : undefined,
      requireTokenTypes:
        requireTokenTypes.length > 0 ? requireTokenTypes : undefined,
    };
  } catch {
    return {};
  }
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > 96) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
}

function toJsonResponse(result: ApiKeyResult) {
  if (result.ok) {
    return NextResponse.json(
      {
        ok: true,
        user_id: result.userId,
        key_id: result.keyId,
        token_type: result.tokenType,
        scopes: result.scopes,
        key_prefix: result.keyPrefix,
        created_at: result.createdAt,
        last_used_at: result.lastUsedAt,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      message: result.message,
    },
    {
      status: result.status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
