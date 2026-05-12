/**
 * GTLNAV — server-side runtime control plane (foundation only).
 *
 * Server-only: throws if imported from a 'use client' component.
 *
 * Workflow:
 *   - When `public.runtime_apps` exists, this module reads/writes that
 *     table directly (schema-tolerant against optional columns).
 *   - When the table is missing, list/get endpoints synthesize an "app"
 *     per `public.projects` row using the project's latest deployment as
 *     a status hint. Mutation endpoints return a 503 with `setup_sql` so
 *     the operator can provision the table.
 *
 * IMPORTANT: this module does NOT execute any container / docker / VPS
 * commands. It is purely the database-side control plane that real worker
 * processes will call into in a later phase. Mutations are a state-machine
 * over the `runtime_status` column (and an audit log).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingColumn,
  isMissingTable,
} from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-runtime.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Status constants & types
// ---------------------------------------------------------------------------

export const RUNTIME_STATUS_RUNNING = "running" as const;
export const RUNTIME_STATUS_STOPPED = "stopped" as const;
export const RUNTIME_STATUS_RESTARTING = "restarting" as const;
export const RUNTIME_STATUS_STARTING = "starting" as const;
export const RUNTIME_STATUS_STOPPING = "stopping" as const;
export const RUNTIME_STATUS_FAILED = "failed" as const;
export const RUNTIME_STATUS_UNKNOWN = "unknown" as const;

export const RUNTIME_STATUSES = [
  RUNTIME_STATUS_RUNNING,
  RUNTIME_STATUS_STOPPED,
  RUNTIME_STATUS_RESTARTING,
  RUNTIME_STATUS_STARTING,
  RUNTIME_STATUS_STOPPING,
  RUNTIME_STATUS_FAILED,
  RUNTIME_STATUS_UNKNOWN,
] as const;

export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number];

export type RuntimeAction = "start" | "stop" | "restart";

export type RuntimeAppRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  deployment_id: string | null;
  name: string | null;
  runtime_status: RuntimeStatus;
  runtime_target: string | null;
  replicas: number | null;
  container_id: string | null;
  host: string | null;
  port: number | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  last_health_at: string | null;
  last_event: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  /** True iff this row is synthesized from `projects` + latest deployment
   *  rather than read from `public.runtime_apps`. */
  synthetic: boolean;
};

const RUNTIME_FOUNDATION_NOTE =
  "Runtime control plane foundation only — this endpoint updates the database state machine but does not execute any container commands.";

// ---------------------------------------------------------------------------
//  Setup SQL
// ---------------------------------------------------------------------------

export const RUNTIME_APPS_SCHEMA_SQL = `-- GTLNAV runtime_apps control-plane table
create table if not exists public.runtime_apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  deployment_id uuid,
  name text,
  runtime_status text not null default 'unknown'
    check (runtime_status in ('running','stopped','restarting','starting','stopping','failed','unknown')),
  runtime_target text,
  replicas int default 1,
  container_id text,
  host text,
  port int,
  last_started_at timestamptz,
  last_stopped_at timestamptz,
  last_health_at timestamptz,
  last_event text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_apps_user_idx on public.runtime_apps (user_id);
create index if not exists runtime_apps_project_idx on public.runtime_apps (project_id);
create index if not exists runtime_apps_status_idx on public.runtime_apps (runtime_status);

alter table public.runtime_apps enable row level security;

create policy "runtime_apps read own"
  on public.runtime_apps for select
  using (auth.uid() = user_id);
create policy "runtime_apps insert own"
  on public.runtime_apps for insert
  with check (auth.uid() = user_id);
create policy "runtime_apps update own"
  on public.runtime_apps for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "runtime_apps delete own"
  on public.runtime_apps for delete
  using (auth.uid() = user_id);
`;

// ---------------------------------------------------------------------------
//  Selects
// ---------------------------------------------------------------------------

const RUNTIME_APP_SELECT_FULL =
  "id, user_id, project_id, deployment_id, name, runtime_status, runtime_target, replicas, container_id, host, port, last_started_at, last_stopped_at, last_health_at, last_event, metadata, created_at, updated_at";

const RUNTIME_APP_SELECT_MINIMAL =
  "id, user_id, project_id, name, runtime_status, runtime_target, created_at, updated_at";

// ---------------------------------------------------------------------------
//  Public: list
// ---------------------------------------------------------------------------

export type ListRuntimeAppsOptions = {
  status?: RuntimeStatus | string;
  projectId?: string;
  limit?: number;
};

export type ListRuntimeAppsResult = {
  apps: RuntimeAppRow[];
  source: "runtime_apps" | "synthetic";
  warning?: string;
  setup_sql?: string;
};

export async function listRuntimeAppsForUser(
  client: SupabaseClient,
  userId: string,
  options: ListRuntimeAppsOptions = {},
): Promise<ListRuntimeAppsResult> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let query = client
    .from("runtime_apps")
    .select(RUNTIME_APP_SELECT_FULL)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (options.status) query = query.eq("runtime_status", options.status);
  if (options.projectId) query = query.eq("project_id", options.projectId);

  let res = await query.returns<Record<string, unknown>[]>();

  if (res.error && isMissingColumn(res.error.message)) {
    let retry = client
      .from("runtime_apps")
      .select(RUNTIME_APP_SELECT_MINIMAL)
      .eq("user_id", userId)
      .limit(limit);
    if (options.status) retry = retry.eq("runtime_status", options.status);
    if (options.projectId) retry = retry.eq("project_id", options.projectId);
    res = await retry.returns<Record<string, unknown>[]>();
  }

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return await synthesizeAppsFromProjects(client, userId, options);
    }
    throw new Error(`runtime_apps lookup failed: ${res.error.message}`);
  }

  const rows = (res.data ?? []) as Record<string, unknown>[];
  return {
    apps: rows.map((r) => mapRuntimeAppRow(r, false)),
    source: "runtime_apps",
  };
}

// ---------------------------------------------------------------------------
//  Public: load by id
// ---------------------------------------------------------------------------

export type LoadRuntimeAppResult =
  | { ok: true; app: RuntimeAppRow; source: "runtime_apps" | "synthetic"; warning?: string; setup_sql?: string }
  | { ok: false; status: number; error: string; message: string; setup_sql?: string };

export async function loadRuntimeAppById(
  client: SupabaseClient,
  args: { appId: string; userId: string },
): Promise<LoadRuntimeAppResult> {
  if (!args.appId) {
    return {
      ok: false,
      status: 400,
      error: "missing_app_id",
      message: "app_id is required.",
    };
  }

  let res = await client
    .from("runtime_apps")
    .select(RUNTIME_APP_SELECT_FULL)
    .eq("id", args.appId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("runtime_apps")
      .select(RUNTIME_APP_SELECT_MINIMAL)
      .eq("id", args.appId)
      .eq("user_id", args.userId)
      .maybeSingle();
  }

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      const synthetic = await synthesizeAppByProjectId(client, args);
      if (synthetic.ok) return synthetic;
      return synthetic;
    }
    return {
      ok: false,
      status: 500,
      error: "runtime_apps_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    // Maybe the caller passed a project_id and the runtime_apps row doesn't
    // exist yet — try to find one keyed on project_id.
    const byProject = await client
      .from("runtime_apps")
      .select(RUNTIME_APP_SELECT_FULL)
      .eq("project_id", args.appId)
      .eq("user_id", args.userId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (byProject.data && !byProject.error) {
      return {
        ok: true,
        app: mapRuntimeAppRow(byProject.data as Record<string, unknown>, false),
        source: "runtime_apps",
      };
    }
    return {
      ok: false,
      status: 404,
      error: "runtime_app_not_found",
      message: "Runtime app not found or not owned by caller.",
    };
  }

  return {
    ok: true,
    app: mapRuntimeAppRow(res.data as Record<string, unknown>, false),
    source: "runtime_apps",
  };
}

// ---------------------------------------------------------------------------
//  Public: state transition
// ---------------------------------------------------------------------------

const RUNNING_LIKE = new Set<RuntimeStatus>([
  RUNTIME_STATUS_RUNNING,
  RUNTIME_STATUS_STARTING,
  RUNTIME_STATUS_RESTARTING,
]);

const STOPPED_LIKE = new Set<RuntimeStatus>([
  RUNTIME_STATUS_STOPPED,
  RUNTIME_STATUS_STOPPING,
  RUNTIME_STATUS_FAILED,
]);

export type TransitionPlan = {
  action: RuntimeAction;
  /** True if the transition is a no-op (already in desired state). */
  noOp: boolean;
  /** Final status to write into runtime_apps.runtime_status. */
  toStatus: RuntimeStatus;
  /** Optional intermediate status for narrative / response (e.g. "restarting"). */
  viaStatus: RuntimeStatus | null;
  /** Human-readable message if the transition is rejected. */
  rejectionReason: string | null;
  /** Status code to use if rejected. */
  rejectionStatus: number;
};

export function planRuntimeTransition(
  current: RuntimeStatus,
  action: RuntimeAction,
): TransitionPlan {
  const cur = (current ?? RUNTIME_STATUS_UNKNOWN) as RuntimeStatus;
  switch (action) {
    case "start":
      if (RUNNING_LIKE.has(cur)) {
        return {
          action,
          noOp: true,
          toStatus: RUNTIME_STATUS_RUNNING,
          viaStatus: null,
          rejectionReason: null,
          rejectionStatus: 200,
        };
      }
      return {
        action,
        noOp: false,
        toStatus: RUNTIME_STATUS_RUNNING,
        viaStatus: RUNTIME_STATUS_STARTING,
        rejectionReason: null,
        rejectionStatus: 200,
      };
    case "stop":
      if (STOPPED_LIKE.has(cur) && cur !== RUNTIME_STATUS_FAILED) {
        return {
          action,
          noOp: true,
          toStatus: RUNTIME_STATUS_STOPPED,
          viaStatus: null,
          rejectionReason: null,
          rejectionStatus: 200,
        };
      }
      return {
        action,
        noOp: false,
        toStatus: RUNTIME_STATUS_STOPPED,
        viaStatus: RUNTIME_STATUS_STOPPING,
        rejectionReason: null,
        rejectionStatus: 200,
      };
    case "restart":
      // Restart is permissive: any non-terminal state moves to running via
      // a "restarting" hop.
      return {
        action,
        noOp: false,
        toStatus: RUNTIME_STATUS_RUNNING,
        viaStatus: RUNTIME_STATUS_RESTARTING,
        rejectionReason: null,
        rejectionStatus: 200,
      };
    default:
      return {
        action,
        noOp: false,
        toStatus: RUNTIME_STATUS_UNKNOWN,
        viaStatus: null,
        rejectionReason: `Unknown action "${String(action)}".`,
        rejectionStatus: 400,
      };
  }
}

export type TransitionResult =
  | {
      ok: true;
      synthetic: false;
      app: RuntimeAppRow;
      previous: RuntimeStatus;
      via: RuntimeStatus | null;
      now: RuntimeStatus;
      noOp: boolean;
    }
  | {
      ok: true;
      synthetic: true;
      app: RuntimeAppRow;
      previous: RuntimeStatus;
      via: RuntimeStatus | null;
      now: RuntimeStatus;
      noOp: false;
      warning: string;
      setup_sql: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      setup_sql?: string;
    };

export async function applyRuntimeTransition(
  client: SupabaseClient,
  args: { appId: string; userId: string; action: RuntimeAction },
): Promise<TransitionResult> {
  const loaded = await loadRuntimeAppById(client, {
    appId: args.appId,
    userId: args.userId,
  });
  if (!loaded.ok) return loaded;

  const plan = planRuntimeTransition(loaded.app.runtime_status, args.action);
  if (plan.rejectionReason) {
    return {
      ok: false,
      status: plan.rejectionStatus,
      error: "transition_rejected",
      message: plan.rejectionReason,
    };
  }

  // Synthetic source = no row to mutate. Return the planned target state but
  // surface a clear warning + setup_sql so the caller knows nothing was
  // persisted.
  if (loaded.source === "synthetic") {
    return {
      ok: true,
      synthetic: true,
      app: { ...loaded.app, runtime_status: plan.toStatus },
      previous: loaded.app.runtime_status,
      via: plan.viaStatus,
      now: plan.toStatus,
      noOp: false,
      warning:
        "runtime_apps table is not provisioned. Transition was simulated against a synthetic project app — no row was persisted.",
      setup_sql: RUNTIME_APPS_SCHEMA_SQL,
    };
  }

  if (plan.noOp) {
    return {
      ok: true,
      synthetic: false,
      app: loaded.app,
      previous: loaded.app.runtime_status,
      via: null,
      now: plan.toStatus,
      noOp: true,
    };
  }

  const now = new Date().toISOString();
  const fullPayload: Record<string, unknown> = {
    runtime_status: plan.toStatus,
    last_event:
      args.action === "restart"
        ? "runtime_restarted"
        : args.action === "start"
          ? "runtime_started"
          : "runtime_stopped",
    updated_at: now,
  };
  if (args.action === "start" || args.action === "restart") {
    fullPayload.last_started_at = now;
  }
  if (args.action === "stop") {
    fullPayload.last_stopped_at = now;
  }

  let res = await client
    .from("runtime_apps")
    .update(fullPayload)
    .eq("id", loaded.app.id)
    .eq("user_id", args.userId)
    .select(RUNTIME_APP_SELECT_FULL)
    .maybeSingle();

  if (res.error && isMissingColumn(res.error.message)) {
    const minimal: Record<string, unknown> = {
      runtime_status: plan.toStatus,
      updated_at: now,
    };
    res = await client
      .from("runtime_apps")
      .update(minimal)
      .eq("id", loaded.app.id)
      .eq("user_id", args.userId)
      .select(RUNTIME_APP_SELECT_MINIMAL)
      .maybeSingle();
  }

  if (res.error || !res.data) {
    if (res.error && isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "runtime_apps_table_missing",
        message:
          "runtime_apps table is not provisioned. Run the GTLNAV runtime control-plane setup SQL.",
        setup_sql: RUNTIME_APPS_SCHEMA_SQL,
      };
    }
    return {
      ok: false,
      status: 500,
      error: "runtime_apps_update_failed",
      message: res.error?.message ?? "Failed to update runtime_apps row.",
    };
  }

  const updatedApp = mapRuntimeAppRow(res.data as Record<string, unknown>, false);
  return {
    ok: true,
    synthetic: false,
    app: updatedApp,
    previous: loaded.app.runtime_status,
    via: plan.viaStatus,
    now: plan.toStatus,
    noOp: false,
  };
}

// ---------------------------------------------------------------------------
//  Public: logs
// ---------------------------------------------------------------------------

export type RuntimeLogRow = {
  id: string;
  created_at: string | null;
  event_type: string | null;
  level: string | null;
  severity: string | null;
  message: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
};

export type LoadRuntimeLogsResult = {
  logs: RuntimeLogRow[];
  warning?: string;
};

export async function loadRuntimeLogsForApp(
  client: SupabaseClient,
  args: {
    userId: string;
    appId: string;
    projectId: string | null;
    limit?: number;
    sinceIso?: string | null;
    levels?: string[] | null;
  },
): Promise<LoadRuntimeLogsResult> {
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

  // Strategy: prefer rows tagged via metadata.runtime_app_id, fall back to
  // matching by project_id + event_type starting with "runtime_". Some
  // schemas don't allow OR across jsonb path filters cleanly, so we run two
  // queries and merge. Both paths are schema-tolerant against missing
  // columns / tables.
  const tagged = await fetchLogsByMetadataAppId(client, args.userId, args.appId, limit, args.sinceIso, args.levels);
  if (tagged.tableMissing) {
    return {
      logs: [],
      warning:
        "infrastructure_logs table is not provisioned. Worker logs cannot be returned.",
    };
  }

  let logs = tagged.rows;

  if (args.projectId) {
    const byProject = await fetchRuntimeLogsByProject(
      client,
      args.userId,
      args.projectId,
      limit,
      args.sinceIso,
      args.levels,
    );
    logs = mergeUniqueById([...logs, ...byProject]);
  }

  logs.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return { logs: logs.slice(0, limit) };
}

// ---------------------------------------------------------------------------
//  Public: append a runtime audit log
// ---------------------------------------------------------------------------

export type RuntimeAuditEvent =
  | "runtime_started"
  | "runtime_stopped"
  | "runtime_restarted"
  | "runtime_state_changed"
  | "runtime_action_rejected";

export type RuntimeAuditSeverity = "info" | "warning" | "error" | "success";

export async function logRuntimeEvent(
  client: SupabaseClient,
  args: {
    userId: string;
    projectId: string | null;
    appId: string;
    event: RuntimeAuditEvent;
    severity: RuntimeAuditSeverity;
    message: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const fullPayload = {
    user_id: args.userId,
    project_id: args.projectId,
    event_type: args.event,
    level: args.severity,
    severity: args.severity,
    source: "runtime_control_plane",
    message: args.message,
    metadata: { ...args.metadata, runtime_app_id: args.appId },
  };
  let res = await client.from("infrastructure_logs").insert(fullPayload);
  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) return;
    const minimal = {
      user_id: args.userId,
      project_id: args.projectId,
      event_type: args.event,
      severity: args.severity,
      message: args.message,
    };
    res = await client.from("infrastructure_logs").insert(minimal);
  }
  if (res.error && process.env.NODE_ENV !== "production") {
    console.warn(
      "[gtlnav/server-runtime] infrastructure_logs insert failed:",
      res.error.message,
    );
  }
}

// ---------------------------------------------------------------------------
//  Public-ish: foundation-only reminder string
// ---------------------------------------------------------------------------

export function runtimeFoundationNote(): string {
  return RUNTIME_FOUNDATION_NOTE;
}

// ---------------------------------------------------------------------------
//  Internal: row mapping
// ---------------------------------------------------------------------------

function mapRuntimeAppRow(
  row: Record<string, unknown>,
  synthetic: boolean,
): RuntimeAppRow {
  const status = ((row.runtime_status ?? RUNTIME_STATUS_UNKNOWN) as string)
    .toString()
    .toLowerCase();
  const safeStatus = (RUNTIME_STATUSES as readonly string[]).includes(status)
    ? (status as RuntimeStatus)
    : RUNTIME_STATUS_UNKNOWN;
  return {
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    project_id: row.project_id != null ? String(row.project_id) : null,
    deployment_id: row.deployment_id != null ? String(row.deployment_id) : null,
    name: row.name != null ? String(row.name) : null,
    runtime_status: safeStatus,
    runtime_target: row.runtime_target != null ? String(row.runtime_target) : null,
    replicas: row.replicas != null ? Number(row.replicas) : null,
    container_id: row.container_id != null ? String(row.container_id) : null,
    host: row.host != null ? String(row.host) : null,
    port: row.port != null ? Number(row.port) : null,
    last_started_at: row.last_started_at != null ? String(row.last_started_at) : null,
    last_stopped_at: row.last_stopped_at != null ? String(row.last_stopped_at) : null,
    last_health_at: row.last_health_at != null ? String(row.last_health_at) : null,
    last_event: row.last_event != null ? String(row.last_event) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
    synthetic,
  };
}

// ---------------------------------------------------------------------------
//  Internal: synthetic apps from projects + latest deployments
// ---------------------------------------------------------------------------

type ProjectMini = {
  id: string;
  user_id: string;
  name: string | null;
  slug: string | null;
  status: string | null;
  framework: string | null;
  live_url: string | null;
};

async function loadProjectsMini(
  client: SupabaseClient,
  userId: string,
  options: { projectId?: string },
): Promise<ProjectMini[]> {
  let query = client
    .from("projects")
    .select("id, user_id, name, slug, status, framework, live_url")
    .eq("user_id", userId);
  if (options.projectId) query = query.eq("id", options.projectId);
  let res = await query.returns<Record<string, unknown>[]>();
  if (res.error && isMissingColumn(res.error.message)) {
    let retry = client
      .from("projects")
      .select("id, user_id, name, slug, status")
      .eq("user_id", userId);
    if (options.projectId) retry = retry.eq("id", options.projectId);
    res = await retry.returns<Record<string, unknown>[]>();
  }
  if (res.error) return [];
  const rows = (res.data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    name: r.name != null ? String(r.name) : null,
    slug: r.slug != null ? String(r.slug) : null,
    status: r.status != null ? String(r.status) : null,
    framework: r.framework != null ? String(r.framework) : null,
    live_url: r.live_url != null ? String(r.live_url) : null,
  }));
}

type LatestDeployment = {
  project_id: string;
  status: string | null;
  deployment_url: string | null;
  finished_at: string | null;
  started_at: string | null;
  id: string;
};

async function loadLatestDeploymentByProject(
  client: SupabaseClient,
  userId: string,
  projectIds: string[],
): Promise<Map<string, LatestDeployment>> {
  if (projectIds.length === 0) return new Map();
  const res = await client
    .from("deployments")
    .select("id, project_id, status, deployment_url, finished_at, started_at, created_at")
    .eq("user_id", userId)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });
  if (res.error) return new Map();
  const out = new Map<string, LatestDeployment>();
  for (const raw of (res.data ?? []) as Record<string, unknown>[]) {
    const projectId = raw.project_id != null ? String(raw.project_id) : "";
    if (!projectId || out.has(projectId)) continue;
    out.set(projectId, {
      id: String(raw.id),
      project_id: projectId,
      status: raw.status != null ? String(raw.status) : null,
      deployment_url: raw.deployment_url != null ? String(raw.deployment_url) : null,
      finished_at: raw.finished_at != null ? String(raw.finished_at) : null,
      started_at: raw.started_at != null ? String(raw.started_at) : null,
    });
  }
  return out;
}

function projectAndDeploymentToRuntimeApp(
  project: ProjectMini,
  deployment: LatestDeployment | null,
): RuntimeAppRow {
  const depStatus = (deployment?.status ?? "").toLowerCase();
  let status: RuntimeStatus = RUNTIME_STATUS_UNKNOWN;
  if (depStatus === "active") status = RUNTIME_STATUS_RUNNING;
  else if (depStatus === "failed") status = RUNTIME_STATUS_FAILED;
  else if (depStatus === "canceled" || depStatus === "cancelled")
    status = RUNTIME_STATUS_STOPPED;
  else if (
    depStatus === "queued" ||
    depStatus === "cloning" ||
    depStatus === "installing" ||
    depStatus === "building" ||
    depStatus === "optimizing" ||
    depStatus === "deploying" ||
    depStatus === "running"
  ) {
    status = RUNTIME_STATUS_STARTING;
  } else if ((project.status ?? "").toLowerCase() === "active") {
    status = RUNTIME_STATUS_RUNNING;
  }

  return {
    id: project.id,
    user_id: project.user_id,
    project_id: project.id,
    deployment_id: deployment?.id ?? null,
    name: project.name ?? project.slug ?? `project-${project.id.slice(0, 8)}`,
    runtime_status: status,
    runtime_target: null,
    replicas: status === RUNTIME_STATUS_RUNNING ? 1 : 0,
    container_id: null,
    host: null,
    port: null,
    last_started_at: deployment?.started_at ?? null,
    last_stopped_at: null,
    last_health_at: null,
    last_event: null,
    metadata: {
      synthetic: true,
      project_status: project.status,
      framework: project.framework,
      live_url: project.live_url ?? deployment?.deployment_url ?? null,
      latest_deployment_status: deployment?.status ?? null,
    },
    created_at: null,
    updated_at: deployment?.finished_at ?? null,
    synthetic: true,
  };
}

async function synthesizeAppsFromProjects(
  client: SupabaseClient,
  userId: string,
  options: ListRuntimeAppsOptions,
): Promise<ListRuntimeAppsResult> {
  const projects = await loadProjectsMini(client, userId, {
    projectId: options.projectId,
  });
  const latest = await loadLatestDeploymentByProject(
    client,
    userId,
    projects.map((p) => p.id),
  );
  let apps = projects.map((p) =>
    projectAndDeploymentToRuntimeApp(p, latest.get(p.id) ?? null),
  );
  if (options.status) {
    apps = apps.filter((a) => a.runtime_status === options.status);
  }
  if (options.limit && apps.length > options.limit) {
    apps = apps.slice(0, options.limit);
  }
  return {
    apps,
    source: "synthetic",
    warning:
      "runtime_apps table is not provisioned. Returning a synthetic app per project derived from latest deployment status.",
    setup_sql: RUNTIME_APPS_SCHEMA_SQL,
  };
}

async function synthesizeAppByProjectId(
  client: SupabaseClient,
  args: { appId: string; userId: string },
): Promise<LoadRuntimeAppResult> {
  const projects = await loadProjectsMini(client, args.userId, {
    projectId: args.appId,
  });
  if (projects.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "runtime_app_not_found",
      message:
        "runtime_apps table is not provisioned and no project matches the supplied id.",
      setup_sql: RUNTIME_APPS_SCHEMA_SQL,
    };
  }
  const project = projects[0];
  const latest = await loadLatestDeploymentByProject(client, args.userId, [project.id]);
  return {
    ok: true,
    app: projectAndDeploymentToRuntimeApp(project, latest.get(project.id) ?? null),
    source: "synthetic",
    warning:
      "runtime_apps table is not provisioned. Returning a synthetic app derived from project + latest deployment.",
    setup_sql: RUNTIME_APPS_SCHEMA_SQL,
  };
}

// ---------------------------------------------------------------------------
//  Internal: log queries
// ---------------------------------------------------------------------------

async function fetchLogsByMetadataAppId(
  client: SupabaseClient,
  userId: string,
  appId: string,
  limit: number,
  sinceIso: string | null | undefined,
  levels: string[] | null | undefined,
): Promise<{ rows: RuntimeLogRow[]; tableMissing: boolean }> {
  let q = client
    .from("infrastructure_logs")
    .select("id, created_at, event_type, level, severity, message, source, metadata")
    .eq("user_id", userId)
    .eq("metadata->>runtime_app_id", appId)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  if (levels && levels.length > 0) q = q.in("severity", levels);

  let res = await q.returns<Record<string, unknown>[]>();

  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) {
      return { rows: [], tableMissing: true };
    }
    // Retry with a coarser select that omits potentially-missing columns.
    let retry = client
      .from("infrastructure_logs")
      .select("id, created_at, event_type, severity, message, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceIso) retry = retry.gte("created_at", sinceIso);
    if (levels && levels.length > 0) retry = retry.in("severity", levels);
    res = await retry.returns<Record<string, unknown>[]>();
    if (res.error) return { rows: [], tableMissing: false };
    const filtered = ((res.data ?? []) as Record<string, unknown>[]).filter((r) => {
      const meta = r.metadata;
      if (!meta || typeof meta !== "object") return false;
      const v = (meta as Record<string, unknown>).runtime_app_id;
      return typeof v === "string" && v === appId;
    });
    return { rows: filtered.map(mapLogRow), tableMissing: false };
  }

  if (res.error) return { rows: [], tableMissing: false };
  return {
    rows: ((res.data ?? []) as Record<string, unknown>[]).map(mapLogRow),
    tableMissing: false,
  };
}

async function fetchRuntimeLogsByProject(
  client: SupabaseClient,
  userId: string,
  projectId: string,
  limit: number,
  sinceIso: string | null | undefined,
  levels: string[] | null | undefined,
): Promise<RuntimeLogRow[]> {
  let q = client
    .from("infrastructure_logs")
    .select("id, created_at, event_type, level, severity, message, source, metadata")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .like("event_type", "runtime_%")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  if (levels && levels.length > 0) q = q.in("severity", levels);

  let res = await q.returns<Record<string, unknown>[]>();

  if (res.error && (isMissingColumn(res.error.message) || isMissingTable(res.error.message))) {
    if (isMissingTable(res.error.message)) return [];
    let retry = client
      .from("infrastructure_logs")
      .select("id, created_at, event_type, severity, message, metadata")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .like("event_type", "runtime_%")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceIso) retry = retry.gte("created_at", sinceIso);
    if (levels && levels.length > 0) retry = retry.in("severity", levels);
    res = await retry.returns<Record<string, unknown>[]>();
    if (res.error) return [];
  }

  if (res.error) return [];
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapLogRow);
}

function mapLogRow(row: Record<string, unknown>): RuntimeLogRow {
  return {
    id: String(row.id),
    created_at: row.created_at != null ? String(row.created_at) : null,
    event_type: row.event_type != null ? String(row.event_type) : null,
    level: row.level != null ? String(row.level) : null,
    severity: row.severity != null ? String(row.severity) : null,
    message: row.message != null ? String(row.message) : null,
    source: row.source != null ? String(row.source) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}

function mergeUniqueById(rows: RuntimeLogRow[]): RuntimeLogRow[] {
  const seen = new Set<string>();
  const out: RuntimeLogRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
