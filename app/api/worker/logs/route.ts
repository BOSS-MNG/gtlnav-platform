import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/src/lib/server-worker-auth";
import {
  appendDeploymentLogs,
  loadJobForWorker,
  type WorkerLogInput,
} from "@/src/lib/server-worker";
import { DEPLOYMENT_JOBS_SCHEMA_SQL } from "@/src/lib/server-deployments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/worker/logs
 *
 * Auth: x-gtlnav-worker-secret OR Bearer <api key with worker scope>.
 *
 * Body (single):
 *   { "job_id": "<uuid>", "level": "info", "message": "Cloning repo...", "source": "git" }
 *
 * Body (batch):
 *   { "job_id": "<uuid>", "logs": [
 *       { "level": "info",    "message": "...", "source": "git" },
 *       { "level": "warning", "message": "...", "source": "build", "timestamp": "..." }
 *   ] }
 *
 * Effect: append rows to public.infrastructure_logs scoped to the job's
 * owning user_id and project_id. Worker label and job/deployment ids are
 * captured into metadata for traceability.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWorker(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Request body is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const jobId = stringField(body.job_id);
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "missing_job_id", message: "job_id is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const logs = collectLogEntries(body);
  if (logs.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_log_payload",
        message:
          'Provide a single "message" or a non-empty "logs" array of { level, message, source? } entries.',
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const job = await loadJobForWorker(auth.client, {
    jobId,
    scopeUserId: auth.kind === "api_key" ? auth.scopeUserId : null,
  });
  if (!job.ok) {
    if (job.missingTable) {
      return NextResponse.json(
        {
          ok: false,
          error: "deployment_jobs_table_missing",
          message: job.message,
          setup_sql: DEPLOYMENT_JOBS_SCHEMA_SQL,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: job.error, message: job.message },
      { status: job.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await appendDeploymentLogs(auth.client, {
    job: job.job,
    logs,
    workerLabel: auth.workerLabel,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      job_id: job.job.id,
      deployment_id: job.job.deployment_id,
      inserted: result.inserted,
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

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectLogEntries(body: Record<string, unknown>): WorkerLogInput[] {
  if (Array.isArray(body.logs)) {
    return body.logs
      .map((entry): WorkerLogInput | null => {
        if (!entry || typeof entry !== "object") return null;
        const e = entry as Record<string, unknown>;
        const message = stringField(e.message);
        if (!message) return null;
        return {
          message,
          level: stringField(e.level),
          source: stringField(e.source),
          timestamp: stringField(e.timestamp),
          metadata:
            e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
              ? (e.metadata as Record<string, unknown>)
              : null,
        };
      })
      .filter((entry): entry is WorkerLogInput => entry !== null);
  }

  const message = stringField(body.message);
  if (!message) return [];
  return [
    {
      message,
      level: stringField(body.level),
      source: stringField(body.source),
      timestamp: stringField(body.timestamp),
      metadata:
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : null,
    },
  ];
}
