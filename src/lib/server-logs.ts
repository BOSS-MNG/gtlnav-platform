/**
 * GTLNAV — server-side `infrastructure_logs` query helpers.
 *
 * Server-only: throws if imported from a 'use client' component.
 *
 * `queryInfrastructureLogs` is the single read path used by:
 *   - GET /api/logs/stream            (SSE polling)
 *   - GET /api/projects/[id]/logs     (list)
 *   - GET /api/deployments/[id]/logs  (list)
 *
 * Filtering is RLS-safe: we always pin `user_id` to the caller. When the
 * caller is on a Supabase JWT client, RLS is the second line of defense.
 * When the caller is on a service-role client (API key auth), the manual
 * `eq("user_id", …)` filter is the only line of defense — DO NOT remove it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn, isMissingTable } from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-logs.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type InfrastructureLogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  event_type: string | null;
  level: string | null;
  severity: string | null;
  message: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

export type LogFilters = {
  userId: string;
  projectId?: string | null;
  /** Matches `metadata->>deployment_id`. */
  deploymentId?: string | null;
  severity?: string[] | null;
  eventType?: string[] | null;
  /** PostgREST LIKE prefix on event_type, e.g. "runtime_" → `runtime_%`. */
  eventTypePrefix?: string | null;
  /** Filter rows with `created_at >= since`. ISO string. */
  since?: string | null;
  /**
   * If true, use strict `created_at > since` (used by the SSE poll to avoid
   * re-emitting the boundary log). Defaults to false.
   */
  strictlyAfter?: boolean;
  /** 1..500. */
  limit?: number;
  /** Default false → newest first. SSE flips to true. */
  ascending?: boolean;
};

export type LogQueryResult = {
  ok: true;
  rows: InfrastructureLogRow[];
  warning?: string;
};

// ---------------------------------------------------------------------------
//  Constants & validation
// ---------------------------------------------------------------------------

export const ALLOWED_SEVERITY_VALUES = new Set([
  "debug",
  "info",
  "notice",
  "warning",
  "warn",
  "error",
  "critical",
  "success",
]);

const SAFE_EVENT_TYPE = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_EVENT_TYPE_PREFIX = /^[A-Za-z0-9_.-]{1,64}$/;

const LOG_SELECT_FULL =
  "id, user_id, project_id, event_type, level, severity, message, source, metadata, created_at";

const LOG_SELECT_MINIMAL =
  "id, user_id, project_id, event_type, severity, message, metadata, created_at";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

// ---------------------------------------------------------------------------
//  Filter parsing (used by all three routes)
// ---------------------------------------------------------------------------

export type ParsedFilters = {
  severity: string[] | null;
  eventType: string[] | null;
  eventTypePrefix: string | null;
  since: string | null;
  limit: number;
};

export type ParseFiltersOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

export function parseLogFiltersFromQuery(
  searchParams: URLSearchParams,
  opts: ParseFiltersOptions = {},
): { ok: true; filters: ParsedFilters } | { ok: false; status: number; error: string; message: string } {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_LIMIT;

  // severity
  const severityRaw = (searchParams.get("severity") ?? "").trim();
  let severity: string[] | null = null;
  if (severityRaw) {
    const parts = severityRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    const bad = parts.find((p) => !ALLOWED_SEVERITY_VALUES.has(p));
    if (bad) {
      return {
        ok: false,
        status: 400,
        error: "invalid_severity",
        message: `Unknown severity "${bad}". Allowed: ${[...ALLOWED_SEVERITY_VALUES].join(", ")}.`,
      };
    }
    severity = parts.length > 0 ? Array.from(new Set(parts)) : null;
  }

  // event_type CSV
  const eventTypeRaw = (searchParams.get("event_type") ?? "").trim();
  let eventType: string[] | null = null;
  if (eventTypeRaw) {
    const parts = eventTypeRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const bad = parts.find((p) => !SAFE_EVENT_TYPE.test(p));
    if (bad) {
      return {
        ok: false,
        status: 400,
        error: "invalid_event_type",
        message: `event_type "${bad}" contains invalid characters. Allowed: A-Z a-z 0-9 _ . -`,
      };
    }
    eventType = parts.length > 0 ? Array.from(new Set(parts)) : null;
  }

  // event_type_prefix
  const eventTypePrefixRaw = (searchParams.get("event_type_prefix") ?? "").trim();
  let eventTypePrefix: string | null = null;
  if (eventTypePrefixRaw) {
    if (!SAFE_EVENT_TYPE_PREFIX.test(eventTypePrefixRaw)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_event_type_prefix",
        message:
          'event_type_prefix must match [A-Za-z0-9_.-]{1,64}. Wildcards are appended automatically — pass e.g. "runtime_".',
      };
    }
    eventTypePrefix = eventTypePrefixRaw;
  }

  // since
  const sinceRaw = (searchParams.get("since") ?? "").trim();
  let since: string | null = null;
  if (sinceRaw) {
    const parsed = Date.parse(sinceRaw);
    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_since",
        message: 'since must be an ISO timestamp (e.g. "2026-05-10T18:00:00Z").',
      };
    }
    since = new Date(parsed).toISOString();
  }

  // limit
  const limitRaw = (searchParams.get("limit") ?? "").trim();
  let limit = defaultLimit;
  if (limitRaw) {
    const n = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        status: 400,
        error: "invalid_limit",
        message: "limit must be a positive integer.",
      };
    }
    limit = Math.min(n, maxLimit);
  }

  return {
    ok: true,
    filters: { severity, eventType, eventTypePrefix, since, limit },
  };
}

// ---------------------------------------------------------------------------
//  Query
// ---------------------------------------------------------------------------

export async function queryInfrastructureLogs(
  client: SupabaseClient,
  filters: LogFilters,
): Promise<LogQueryResult> {
  const limit = clampLimit(filters.limit ?? DEFAULT_LIMIT);
  const ascending = filters.ascending ?? false;

  const built = (select: string) => {
    let q = client
      .from("infrastructure_logs")
      .select(select)
      .eq("user_id", filters.userId)
      .order("created_at", { ascending, nullsFirst: false })
      .limit(limit);

    if (filters.projectId) q = q.eq("project_id", filters.projectId);
    if (filters.deploymentId) {
      q = q.eq("metadata->>deployment_id", filters.deploymentId);
    }
    if (filters.severity && filters.severity.length > 0) {
      q = q.in("severity", filters.severity);
    }
    if (filters.eventType && filters.eventType.length > 0) {
      q = q.in("event_type", filters.eventType);
    }
    if (filters.eventTypePrefix) {
      q = q.like("event_type", `${filters.eventTypePrefix}%`);
    }
    if (filters.since) {
      const stricter = filters.strictlyAfter === true;
      q = stricter ? q.gt("created_at", filters.since) : q.gte("created_at", filters.since);
    }
    return q;
  };

  let res = await built(LOG_SELECT_FULL).returns<Record<string, unknown>[]>();

  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: true,
        rows: [],
        warning:
          "infrastructure_logs table is not provisioned. No log rows are available yet.",
      };
    }
    // Retry with a slimmer column set (drops `level` / `source`).
    let retry = client
      .from("infrastructure_logs")
      .select(LOG_SELECT_MINIMAL)
      .eq("user_id", filters.userId)
      .order("created_at", { ascending, nullsFirst: false })
      .limit(limit);
    if (filters.projectId) retry = retry.eq("project_id", filters.projectId);
    if (filters.severity && filters.severity.length > 0) {
      retry = retry.in("severity", filters.severity);
    }
    if (filters.eventType && filters.eventType.length > 0) {
      retry = retry.in("event_type", filters.eventType);
    }
    if (filters.eventTypePrefix) {
      retry = retry.like("event_type", `${filters.eventTypePrefix}%`);
    }
    if (filters.since) {
      const stricter = filters.strictlyAfter === true;
      retry = stricter
        ? retry.gt("created_at", filters.since)
        : retry.gte("created_at", filters.since);
    }
    res = await retry.returns<Record<string, unknown>[]>();

    if (res.error) {
      throw new Error(`infrastructure_logs lookup failed: ${res.error.message}`);
    }
    let rows = ((res.data ?? []) as Record<string, unknown>[]).map(mapLogRow);
    // deployment_id filter requires post-filtering when jsonb path isn't supported.
    if (filters.deploymentId) {
      rows = rows.filter((r) => {
        const meta = r.metadata;
        if (!meta || typeof meta !== "object") return false;
        const v = (meta as Record<string, unknown>).deployment_id;
        return typeof v === "string" && v === filters.deploymentId;
      });
    }
    return { ok: true, rows };
  }

  if (res.error) {
    throw new Error(`infrastructure_logs lookup failed: ${res.error.message}`);
  }

  return {
    ok: true,
    rows: ((res.data ?? []) as Record<string, unknown>[]).map(mapLogRow),
  };
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT);
}

function mapLogRow(row: Record<string, unknown>): InfrastructureLogRow {
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    event_type: row.event_type != null ? String(row.event_type) : null,
    level: row.level != null ? String(row.level) : null,
    severity: row.severity != null ? String(row.severity) : null,
    message: row.message != null ? String(row.message) : null,
    source: row.source != null ? String(row.source) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
  };
}

// ---------------------------------------------------------------------------
//  SSE encoding
// ---------------------------------------------------------------------------

/**
 * Encode a payload as a single SSE message:
 *   event: <name>
 *   id: <id>
 *   data: <json>
 *
 *   (blank line)
 *
 * `id` is optional but useful for `Last-Event-ID` reconnects.
 */
export function encodeSseEvent(args: {
  event: string;
  data: unknown;
  id?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`event: ${args.event}`);
  if (args.id) lines.push(`id: ${args.id}`);
  const json = JSON.stringify(args.data);
  // Split on \n so multi-line JSON is allowed (it never is for our payloads,
  // but staying spec-compliant is cheap).
  for (const line of json.split("\n")) {
    lines.push(`data: ${line}`);
  }
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

export function encodeSseComment(text: string): string {
  return `: ${text.replace(/\r?\n/g, " ")}\n\n`;
}

export function encodeSseRetry(ms: number): string {
  return `retry: ${Math.max(1000, Math.floor(ms))}\n\n`;
}
