import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/terminal/[sessionId]
 *
 * RESERVED — NOT IMPLEMENTED.
 *
 * This is the future placeholder for the per-session terminal endpoint.
 * No method on this route currently spawns a shell, runs a command, or
 * reads system state. Every verb returns 501 Not Implemented with a
 * description of the future contract.
 *
 * Future contract:
 *   - GET    /api/terminal/[sessionId]  →  WebSocket upgrade for I/O.
 *   - POST   /api/terminal/[sessionId]/command (separate route, future)
 *   - DELETE /api/terminal/[sessionId]  →  close + flush audit recording.
 *
 * Auth (future): same Supabase JWT + workspace permission enforcement
 * as POST /api/terminal/session. Session id must match a row provisioned
 * by /api/terminal/session and must belong to the calling user.
 */
function notImplemented(sessionId: string, verb: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "not_implemented",
      message:
        "Terminal shell sessions are not enabled yet. This endpoint is reserved for a future GTLNAV release.",
      session_id: sessionId,
      requested_method: verb,
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
        Allow: "GET, DELETE",
        "X-GTLNAV-Stub": "terminal-session-id",
      },
    },
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  return notImplemented(sessionId, "GET");
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  return notImplemented(sessionId, "DELETE");
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  // Acknowledge that POST .../command is the *future* shape, but it lives
  // on its own route. This base path stays read/upgrade-only.
  return notImplemented(sessionId, "POST");
}
