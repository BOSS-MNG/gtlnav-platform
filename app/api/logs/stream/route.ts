import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/src/lib/server-auth";
import {
  encodeSseComment,
  encodeSseEvent,
  encodeSseRetry,
  parseLogFiltersFromQuery,
  queryInfrastructureLogs,
  type InfrastructureLogRow,
} from "@/src/lib/server-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BATCH = 100;
const RECENT_ID_WINDOW_MS = 60_000;

/**
 * GET /api/logs/stream
 *
 * Auth: Authorization: Bearer <supabase access token | gtlnav_live_pat_*>
 *
 * Server-Sent Events stream of `infrastructure_logs` rows. The handler:
 *
 *   1. Validates filters and authenticates the caller.
 *   2. Sends an `event: ready` payload echoing the active filters.
 *   3. Backfills the most recent rows that match the filters.
 *   4. Polls every 2 seconds for rows newer than the last emitted
 *      `created_at` (strict `>`), with a recently-emitted id set to dedupe
 *      logs that share the same timestamp.
 *   5. Sends a heartbeat comment line every 30s minimum so middleboxes
 *      keep the connection alive.
 *   6. Closes cleanly when `request.signal` aborts.
 *
 * Optional query params:
 *   ?project_id=<uuid>
 *   ?deployment_id=<uuid>
 *   ?severity=info,warning,error
 *   ?event_type=runtime_started,deployment_completed
 *   ?event_type_prefix=runtime_
 *   ?since=<ISO timestamp>
 *   ?limit=<1..500>            (initial backfill cap)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = request.nextUrl;
  const filterParse = parseLogFiltersFromQuery(url.searchParams, {
    defaultLimit: 50,
    maxLimit: MAX_BATCH,
  });
  if (!filterParse.ok) {
    return NextResponse.json(
      { ok: false, error: filterParse.error, message: filterParse.message },
      { status: filterParse.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const filters = filterParse.filters;
  const projectId = (url.searchParams.get("project_id") ?? "").trim() || null;
  const deploymentId = (url.searchParams.get("deployment_id") ?? "").trim() || null;

  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      const safeEnqueue = (chunk: string): boolean => {
        if (cancelled) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          cancelled = true;
          if (timer) clearTimeout(timer);
          return false;
        }
      };

      // Preamble.
      safeEnqueue(encodeSseRetry(5000));
      safeEnqueue(
        encodeSseEvent({
          event: "ready",
          data: {
            ok: true,
            poll_interval_ms: POLL_INTERVAL_MS,
            heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
            filters: {
              project_id: projectId,
              deployment_id: deploymentId,
              severity: filters.severity,
              event_type: filters.eventType,
              event_type_prefix: filters.eventTypePrefix,
              since: filters.since,
              limit: filters.limit,
            },
          },
        }),
      );

      let lastCreatedAt: string | null = filters.since ?? null;
      let lastHeartbeatAt = Date.now();
      const recentIds = new Map<string, number>();

      const trimRecent = (now: number) => {
        for (const [id, ts] of recentIds) {
          if (now - ts > RECENT_ID_WINDOW_MS) recentIds.delete(id);
        }
      };

      const emitRow = (row: InfrastructureLogRow) => {
        if (!row.id) return;
        if (recentIds.has(row.id)) return;
        recentIds.set(row.id, Date.now());
        if (row.created_at && (!lastCreatedAt || row.created_at > lastCreatedAt)) {
          lastCreatedAt = row.created_at;
        }
        safeEnqueue(
          encodeSseEvent({ event: "log", id: row.id, data: row }),
        );
      };

      // Initial backfill — newest first, but emit ascending so the client
      // appends in order. We invert by reversing the array.
      try {
        const initial = await queryInfrastructureLogs(auth.client, {
          userId: auth.userId,
          projectId,
          deploymentId,
          severity: filters.severity,
          eventType: filters.eventType,
          eventTypePrefix: filters.eventTypePrefix,
          since: lastCreatedAt,
          limit: filters.limit,
          ascending: false,
        });
        const ascRows = [...initial.rows].reverse();
        for (const row of ascRows) emitRow(row);
        if (initial.warning) {
          safeEnqueue(
            encodeSseEvent({
              event: "warning",
              data: { message: initial.warning },
            }),
          );
        }
      } catch (err) {
        safeEnqueue(
          encodeSseEvent({
            event: "error",
            data: {
              message:
                err instanceof Error ? err.message : "Initial log fetch failed.",
            },
          }),
        );
      }

      const tick = async () => {
        if (cancelled || request.signal.aborted) return;

        try {
          const now = Date.now();
          trimRecent(now);

          const result = await queryInfrastructureLogs(auth.client, {
            userId: auth.userId,
            projectId,
            deploymentId,
            severity: filters.severity,
            eventType: filters.eventType,
            eventTypePrefix: filters.eventTypePrefix,
            since: lastCreatedAt,
            strictlyAfter: lastCreatedAt != null,
            limit: MAX_BATCH,
            ascending: true,
          });
          for (const row of result.rows) emitRow(row);

          if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
            safeEnqueue(encodeSseComment(`heartbeat ${new Date(now).toISOString()}`));
            lastHeartbeatAt = now;
          }
        } catch (err) {
          safeEnqueue(
            encodeSseEvent({
              event: "error",
              data: {
                message:
                  err instanceof Error ? err.message : "Polling lookup failed.",
              },
            }),
          );
        }

        if (!cancelled && !request.signal.aborted) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };

      timer = setTimeout(tick, POLL_INTERVAL_MS);
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use GET." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
