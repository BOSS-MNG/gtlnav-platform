import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GTLNAV — root middleware.
 *
 * Phase 6B.7 — security hardening.
 *
 * The current control plane keeps Supabase sessions in localStorage (client
 * default). That means a hard server-side gate would block legitimate users
 * whose session has not yet been mirrored to a cookie. To honour the
 * "without breaking auth" requirement, this middleware:
 *
 *   1. Adds defensive security headers to every protected response.
 *   2. Adds a soft redirect from `/dashboard` and `/admin` ONLY when:
 *        - the operator opts in via `GTLNAV_STRICT_AUTH_MIDDLEWARE=true`, AND
 *        - the request has no Supabase session cookie at all (`sb-*-auth-token`)
 *          AND no `Authorization` header.
 *   3. Never touches API routes, marketing pages, or static assets.
 *
 * Until strict mode is enabled, the existing client-side guards in
 * `dashboard-client.tsx` and `admin-shell.tsx` remain the source of truth.
 */
const STRICT =
  (process.env.GTLNAV_STRICT_AUTH_MIDDLEWARE ?? "").toLowerCase() === "true";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (!isProtected) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (STRICT && !hasSomeAuthSignal(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return applySecurityHeaders(NextResponse.next());
}

function hasSomeAuthSignal(request: NextRequest): boolean {
  if (request.headers.get("authorization")) return true;
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      return true;
    }
    if (cookie.name === "gtlnav_session") return true;
  }
  return false;
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets, image optimizer, and the worker
    ///proxy callback routes (which authenticate themselves with secrets).
    "/((?!_next/static|_next/image|favicon.ico|branding/|images/|api/worker/|api/proxy/).*)",
  ],
};
