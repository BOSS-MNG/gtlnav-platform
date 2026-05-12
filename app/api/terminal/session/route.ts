import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/terminal/session
 *
 * RESERVED — NOT IMPLEMENTED.
 *
 * This is the future contract for opening an isolated, audited shell
 * session against a GTLNAV project workspace. The endpoint is intentionally
 * stubbed and returns 501 Not Implemented. It does NOT spawn a shell, run
 * a container, exec into a process, or read any file from the host.
 *
 * Future design:
 *   - Caller must hold a session JWT with workspace permission `shell:open`.
 *   - Server enforces:
 *       * Container isolation (per-project ephemeral container).
 *       * Non-root user inside the container.
 *       * Allowlisted command set.
 *       * Hard wall-clock timeout (default 15m).
 *       * Idle-timeout (default 5m).
 *       * Full audit log of every command + exit code to
 *         `infrastructure_logs` and a per-session recording bucket.
 *       * Per-tenant + per-project rate limits.
 *
 * Future response (200):
 *   {
 *     ok: true,
 *     session_id:    "<uuid>",
 *     project_id:    "<uuid>",
 *     expires_at:    "<iso>",
 *     ws_url:        "/api/terminal/<session_id>",
 *     command_url:   "/api/terminal/<session_id>/command",
 *     allowlist:     ["ls","cat","tail",...],
 *   }
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "not_implemented",
      message:
        "Terminal shell sessions are not enabled yet. This endpoint is reserved for a future GTLNAV release.",
      requirements: [
        "container_isolation",
        "non_root_user",
        "command_allowlist",
        "audit_logs",
        "wall_clock_timeout",
        "idle_timeout",
        "session_recording",
        "workspace_permissions",
      ],
      future_routes: {
        open_session: "POST /api/terminal/session",
        websocket: "WS /api/terminal/[sessionId]",
        send_command: "POST /api/terminal/[sessionId]/command",
        close_session: "DELETE /api/terminal/[sessionId]",
      },
      executes_commands: false,
      spawns_shell: false,
    },
    {
      status: 501,
      headers: {
        "Cache-Control": "no-store",
        Allow: "POST",
        "X-GTLNAV-Stub": "terminal-session",
      },
    },
  );
}

export function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "method_not_allowed",
      message: "Use POST. This endpoint is reserved and currently returns 501.",
    },
    {
      status: 405,
      headers: { "Cache-Control": "no-store", Allow: "POST" },
    },
  );
}
