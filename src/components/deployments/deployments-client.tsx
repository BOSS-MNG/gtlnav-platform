"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import {
  absoluteTime,
  deploymentStatusStyle,
  logLevel,
  logLevelClasses,
  logMessage,
  logTag,
  relativeTime,
  shortTime,
} from "@/src/lib/dashboard-format";
import {
  generateCommitSha,
  isInflightStatus,
} from "@/src/lib/deployment-simulator";
import { startRealDeployment } from "@/src/lib/deploy-client";
import { providerLabel } from "@/src/lib/project-providers";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";

type ProjectRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type DeploymentRow = {
  id: string;
  user_id?: string;
  project_id?: string | null;
  status?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  deployment_url?: string | null;
  build_logs?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type LogRow = {
  id: string;
  message?: string | null;
  level?: string | null;
  severity?: string | null;
  type?: string | null;
  event_type?: string | null;
  source?: string | null;
  project_id?: string | null;
  created_at?: string | null;
  metadata?: unknown;
  [key: string]: unknown;
};

type DeploymentsPageData = {
  deployments: DeploymentRow[];
  projects: ProjectRow[];
  deployLogs: LogRow[];
};

type LoadResult = {
  data: DeploymentsPageData;
  errors: string[];
};

const FILTER_KEYS = [
  "all",
  "success",
  "progress",
  "queued",
  "failed",
  "cancelled",
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  success: "Active / Success",
  progress: "In progress",
  queued: "Queued",
  failed: "Failed",
  cancelled: "Cancelled",
};

function isDeploymentRelatedLog(log: LogRow): boolean {
  const et = (log.event_type ?? "").toString().toLowerCase();
  if (!et) return false;
  return (
    et.includes("deployment") ||
    et.includes("rollback") ||
    et.includes("build") ||
    et === "health_check"
  );
}

function matchesDeploymentFilter(
  d: DeploymentRow,
  filter: FilterKey,
): boolean {
  const s = (d.status ?? "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "progress") return isInflightStatus(s);
  if (filter === "queued") return s === "queued";
  if (filter === "failed")
    return s.includes("fail") || s.includes("err") || s.includes("crash");
  if (filter === "cancelled") return s.includes("cancel");
  if (filter === "success") {
    return (
      s === "active" ||
      s === "success" ||
      s === "ready" ||
      s.includes("complete") ||
      s.includes("success")
    );
  }
  return true;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

async function insertInfraLog(
  userId: string,
  projectId: string | null,
  eventType: string,
  message: string,
  severity: string,
  metadata?: Record<string, unknown>,
) {
  const full = {
    user_id: userId,
    project_id: projectId,
    event_type: eventType,
    level: severity,
    severity,
    message,
    source: "deployments_console",
    metadata: metadata ?? {},
  };
  const { error } = await supabase.from("infrastructure_logs").insert(full);
  if (!error) return;
  await supabase.from("infrastructure_logs").insert({
    user_id: userId,
    project_id: projectId,
    event_type: eventType,
    severity,
    message,
  });
}

async function loadDeploymentsData(userId: string): Promise<LoadResult> {
  const errors: string[] = [];

  const [depRes, projRes, logsRes] = await Promise.all([
    supabase
      .from("deployments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("projects")
      .select("id, name, slug, framework, provider, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("infrastructure_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  if (depRes.error) errors.push(`deployments: ${depRes.error.message}`);
  if (projRes.error) errors.push(`projects: ${projRes.error.message}`);
  if (logsRes.error) errors.push(`infrastructure_logs: ${logsRes.error.message}`);

  const rawLogs = (logsRes.data ?? []) as LogRow[];
  const deployLogs = rawLogs.filter(isDeploymentRelatedLog);

  return {
    data: {
      deployments: (depRes.data ?? []) as DeploymentRow[],
      projects: (projRes.data ?? []) as ProjectRow[],
      deployLogs,
    },
    errors,
  };
}

function computeStats(deployments: DeploymentRow[]) {
  const total = deployments.length;
  let successful = 0;
  let inProgress = 0;
  let failed = 0;
  let cancelled = 0;
  const durations: number[] = [];
  for (const d of deployments) {
    const s = (d.status ?? "").toLowerCase();
    if (isInflightStatus(s)) inProgress += 1;
    else if (s.includes("cancel")) cancelled += 1;
    else if (s.includes("fail") || s.includes("err") || s.includes("crash"))
      failed += 1;
    else if (
      s === "active" ||
      s === "success" ||
      s === "ready" ||
      s.includes("complete") ||
      s.includes("success")
    )
      successful += 1;

    const start = parseMs(d.started_at ?? d.created_at);
    const end = parseMs(d.finished_at);
    if (start !== null && end !== null && end > start) {
      durations.push(end - start);
    }
  }

  const avgMs =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

  const last = deployments[0];
  const lastLabel = last
    ? relativeTime(last.created_at ?? last.started_at)
    : "—";

  return {
    total,
    successful,
    inProgress,
    failed,
    cancelled,
    avgBuild: avgMs !== null ? formatDurationMs(avgMs) : "—",
    lastDeployment: lastLabel,
  };
}

export function DeploymentsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<DeploymentsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<{ kind: "info" | "error"; text: string } | null>(
    null,
  );
  const [drawerDeployment, setDrawerDeployment] = useState<DeploymentRow | null>(
    null,
  );
  const [drawerLogs, setDrawerLogs] = useState<LogRow[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [pipelineProjects, setPipelineProjects] = useState<Set<string>>(
    () => new Set(),
  );

  const refresh = useCallback(async (userId: string, mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const { data: next, errors: e } = await loadDeploymentsData(userId);
      setData(next);
      setErrors(e);
    } catch (err) {
      setErrors([
        err instanceof Error ? err.message : "Failed to load deployments.",
      ]);
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, next) => {
      if (!next) {
        router.replace("/login");
        return;
      }
      setSession(next);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!session?.user?.id) return;
    void refresh(session.user.id, "initial");
  }, [session?.user?.id, refresh]);

  const projectsById = useMemo(() => {
    const m = new Map<string, ProjectRow>();
    for (const p of data?.projects ?? []) m.set(p.id, p);
    return m;
  }, [data?.projects]);

  const filteredDeployments = useMemo(() => {
    const list = data?.deployments ?? [];
    return list.filter((d) => matchesDeploymentFilter(d, filter));
  }, [data?.deployments, filter]);

  const stats = useMemo(
    () => computeStats(data?.deployments ?? []),
    [data?.deployments],
  );

  const anyInflightRemote = useMemo(
    () => (data?.deployments ?? []).some((d) => isInflightStatus(d.status)),
    [data?.deployments],
  );

  const anyInflight =
    anyInflightRemote || pipelineProjects.size > 0 || demoBusy;

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    if (!anyInflight) return;
    const id = window.setInterval(() => {
      void refresh(uid, "refresh");
    }, 2500);
    return () => window.clearInterval(id);
  }, [session?.user?.id, anyInflight, refresh]);

  const flashToast = useCallback((kind: "info" | "error", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);

  const loadDrawerLogs = useCallback(
    async (userId: string, dep: DeploymentRow) => {
      setDrawerLoading(true);
      setDrawerLogs([]);
      try {
        const startMs =
          parseMs(dep.started_at ?? dep.created_at) ?? Date.now() - 3600_000;
        const endMs =
          parseMs(dep.finished_at) ??
          Date.now() + 120_000;
        const from = new Date(startMs - 60_000).toISOString();
        const to = new Date(endMs + 120_000).toISOString();
        const pid = dep.project_id;
        if (!pid) {
          setDrawerLogs([]);
          return;
        }
        const { data: rows, error } = await supabase
          .from("infrastructure_logs")
          .select("*")
          .eq("user_id", userId)
          .eq("project_id", pid)
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: true });
        if (error) {
          setDrawerLogs([]);
          return;
        }
        setDrawerLogs((rows ?? []) as LogRow[]);
      } finally {
        setDrawerLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!drawerDeployment || !session?.user?.id) return;
    void loadDrawerLogs(session.user.id, drawerDeployment);
  }, [drawerDeployment, session?.user?.id, loadDrawerLogs]);

  async function handleRedeploy(dep: DeploymentRow) {
    const uid = session?.user?.id;
    if (!uid || !dep.project_id) return;
    const project = projectsById.get(dep.project_id);
    if (!project) {
      flashToast("error", "Project not found for this deployment.");
      return;
    }
    setActionBusyId(dep.id);
    try {
      const { data: existing } = await supabase
        .from("deployments")
        .select("id")
        .eq("project_id", dep.project_id)
        .eq("user_id", uid)
        .in("status", [
          "queued",
          "cloning",
          "installing",
          "building",
          "optimizing",
          "deploying",
        ])
        .limit(1);
      if (existing && existing.length > 0) {
        flashToast("error", "A deployment is already running for this project.");
        return;
      }
      const start = await startRealDeployment({
        projectId: dep.project_id,
        branch: dep.branch ?? "main",
      });
      if (!start.ok) {
        flashToast("error", start.message);
        return;
      }
      if (start.warning) flashToast("info", start.warning);
      setPipelineProjects((prev) => new Set(prev).add(dep.project_id!));
      await refresh(uid, "refresh");
      flashToast(
        "info",
        `Redeploy queued for ${project.name ?? project.slug}. A worker will pick it up.`,
      );
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Redeploy failed.",
      );
    } finally {
      if (dep.project_id) {
        setPipelineProjects((prev) => {
          const n = new Set(prev);
          n.delete(dep.project_id!);
          return n;
        });
      }
      setActionBusyId(null);
      if (uid) void refresh(uid, "refresh");
    }
  }

  async function handleRollback(dep: DeploymentRow) {
    const uid = session?.user?.id;
    if (!uid || !dep.project_id) return;
    const project = projectsById.get(dep.project_id);
    const name = project?.name ?? project?.slug ?? "project";
    setActionBusyId(dep.id);
    try {
      await insertInfraLog(
        uid,
        dep.project_id,
        "rollback_started",
        `Rollback initiated for project ${name}`,
        "warning",
        { deployment_id: dep.id },
      );
      await new Promise((r) => setTimeout(r, 900));
      await insertInfraLog(
        uid,
        dep.project_id,
        "rollback_completed",
        `Rollback completed for project ${name}`,
        "success",
        { deployment_id: dep.id },
      );
      const now = new Date().toISOString();
      const { error: rbDepErr } = await supabase.from("deployments").insert({
        user_id: uid,
        project_id: dep.project_id,
        status: "success",
        branch: dep.branch ?? "main",
        commit_sha: generateCommitSha(),
        deployment_url: dep.deployment_url ?? null,
        build_logs: "Rollback completed successfully.",
        started_at: now,
        finished_at: now,
      });
      if (rbDepErr && process.env.NODE_ENV !== "production") {
        console.warn("rollback deployment row:", rbDepErr.message);
      }
      flashToast("info", `Rollback completed for ${name}.`);
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Rollback failed.",
      );
    } finally {
      setActionBusyId(null);
      if (uid) void refresh(uid, "refresh");
    }
  }

  async function handleCancel(dep: DeploymentRow) {
    const uid = session?.user?.id;
    if (!uid || !dep.project_id) return;
    const project = projectsById.get(dep.project_id);
    const name = project?.name ?? project?.slug ?? "project";
    setActionBusyId(dep.id);
    try {
      const finished = new Date().toISOString();
      const { error } = await supabase
        .from("deployments")
        .update({ status: "cancelled", finished_at: finished })
        .eq("id", dep.id)
        .eq("user_id", uid);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        dep.project_id,
        "deployment_cancelled",
        `Deployment cancelled for project ${name}`,
        "warning",
        { deployment_id: dep.id },
      );
      flashToast("info", `Deployment cancelled for ${name}.`);
    } finally {
      setActionBusyId(null);
      if (uid) void refresh(uid, "refresh");
    }
  }

  async function handleDemoDeploy() {
    const uid = session?.user?.id;
    if (!uid) return;
    const projects = data?.projects ?? [];
    if (projects.length === 0) {
      flashToast("error", "Create a project first to queue a deployment.");
      return;
    }
    const latest = projects[0];
    setDemoBusy(true);
    setPipelineProjects((prev) => new Set(prev).add(latest.id));
    try {
      const { data: existing } = await supabase
        .from("deployments")
        .select("id")
        .eq("project_id", latest.id)
        .eq("user_id", uid)
        .in("status", [
          "queued",
          "cloning",
          "installing",
          "building",
          "optimizing",
          "deploying",
        ])
        .limit(1);
      if (existing && existing.length > 0) {
        flashToast("error", "Finish the in-flight deployment before starting a demo.");
        return;
      }
      const start = await startRealDeployment({
        projectId: latest.id,
        branch: "main",
      });
      if (!start.ok) {
        flashToast("error", start.message);
        return;
      }
      if (start.warning) flashToast("info", start.warning);
      await refresh(uid, "refresh");
      flashToast(
        "info",
        `Deployment queued for ${latest.name ?? latest.slug}. A worker will pick it up.`,
      );
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Deployment queue failed.",
      );
    } finally {
      setDemoBusy(false);
      setPipelineProjects((prev) => {
        const n = new Set(prev);
        n.delete(latest.id);
        return n;
      });
      void refresh(uid, "refresh");
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      flashToast("info", "URL copied to clipboard.");
    } catch {
      flashToast("error", "Could not copy URL.");
    }
  }

  if (session === undefined) {
    return <FullPage label="Verifying session…" />;
  }
  if (!session) {
    return <FullPage label="Redirecting…" />;
  }

  const userId = session.user.id;
  const projects = data?.projects ?? [];
  const deployLogs = data?.deployLogs ?? [];

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <Background />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="deployments" userEmail={session.user.email} />

        <main className="flex-1 px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-col gap-4 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // deployments
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Deployments Control Center
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Monitor builds, releases, edge propagation and rollback activity.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refresh(userId, "refresh")}
                disabled={loading || refreshing}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => void handleDemoDeploy()}
                disabled={demoBusy || loading || projects.length === 0}
                title={
                  projects.length === 0
                    ? "Create a project first"
                    : "Run simulator on your latest project"
                }
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-xs font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {demoBusy ? "Queueing…" : "Queue deployment on latest project"}
              </button>
            </div>
          </header>

          {toast ? (
            <div
              role="status"
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl ${
                toast.kind === "error"
                  ? "border-red-400/30 bg-red-500/10 text-red-200"
                  : "border-basil-400/30 bg-basil-500/10 text-basil-100"
              }`}
            >
              {toast.text}
            </div>
          ) : null}

          {errors.length > 0 ? (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            >
              <p className="font-medium">Some data could not be loaded:</p>
              <ul className="mt-1 list-disc pl-5 font-mono text-xs text-amber-200/90">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {projects.length === 0 && !loading ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/60">
              <span className="text-white/80">No projects yet.</span>{" "}
              <Link
                href="/dashboard"
                className="text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
              >
                Create a project on the dashboard
              </Link>{" "}
              before queueing a deployment.
            </div>
          ) : null}

          {/* Summary */}
          <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <SummaryTile label="Total deployments" value={String(stats.total)} />
            <SummaryTile
              label="Successful"
              value={String(stats.successful)}
              accent="basil"
            />
            <SummaryTile
              label="In progress"
              value={String(stats.inProgress)}
              accent="cyan"
            />
            <SummaryTile label="Failed" value={String(stats.failed)} accent="red" />
            <SummaryTile label="Avg build time" value={stats.avgBuild} mono />
            <SummaryTile label="Last deployment" value={stats.lastDeployment} />
          </section>

          {/* Stream strip */}
          <section className="mt-8 rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                // deployment-stream
              </p>
              {anyInflight ? (
                <span className="inline-flex items-center gap-2 text-[11px] text-basil-200">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
                  </span>
                  Live refresh · 2.5s
                </span>
              ) : null}
            </div>
            <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] text-white/55">
              {deployLogs.slice(0, 12).map((log) => (
                <li
                  key={log.id}
                  className="truncate border-b border-white/[0.04] pb-1 transition-colors hover:text-white/80"
                  style={{ animation: "var(--animate-log-reveal)" }}
                >
                  <span className="text-white/35">{shortTime(log.created_at)}</span>{" "}
                  <span className="text-basil-300/70">{logTag(log)}</span>{" "}
                  {logMessage(log)}
                </li>
              ))}
              {deployLogs.length === 0 && !loading ? (
                <li className="text-white/40">No deployment-related log lines yet.</li>
              ) : null}
            </ul>
          </section>

          {/* Filters */}
          <div className="mt-8 flex flex-wrap gap-2">
            {FILTER_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === key
                    ? "border-basil-400/50 bg-basil-500/20 text-basil-100 shadow-[0_0_20px_-8px_rgba(111,232,154,0.5)]"
                    : "border-white/10 bg-white/[0.04] text-white/65 hover:border-basil-400/30 hover:text-white"
                }`}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>

          {/* List */}
          <section className="mt-6">
            {loading && !data ? (
              <ul className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <li
                    key={i}
                    className="h-36 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
                  />
                ))}
              </ul>
            ) : filteredDeployments.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-8 py-16 text-center">
                <p className="text-sm font-medium text-white">No deployments match</p>
                <p className="mt-2 text-xs text-white/50">
                  {filter === "all"
                    ? "Queue a deployment or deploy from a project card."
                    : "Try another filter or clear filters."}
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {filteredDeployments.map((dep) => {
                  const project = dep.project_id
                    ? projectsById.get(dep.project_id)
                    : undefined;
                  return (
                    <DeploymentListRow
                      key={dep.id}
                      dep={dep}
                      project={project}
                      busy={actionBusyId === dep.id}
                      onViewLogs={() => setDrawerDeployment(dep)}
                      onRedeploy={() => void handleRedeploy(dep)}
                      onRollback={() => void handleRollback(dep)}
                      onCancel={() => void handleCancel(dep)}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      {drawerDeployment ? (
        <DeploymentDrawer
          dep={drawerDeployment}
          project={
            drawerDeployment.project_id
              ? projectsById.get(drawerDeployment.project_id)
              : undefined
          }
          logs={drawerLogs}
          loading={drawerLoading}
          onClose={() => setDrawerDeployment(null)}
          onCopyUrl={copyUrl}
        />
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: "basil" | "cyan" | "red";
  mono?: boolean;
}) {
  const valueCls =
    accent === "basil"
      ? "bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent"
      : accent === "cyan"
        ? "text-cyan-200"
        : accent === "red"
          ? "text-red-200"
          : "text-white";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-5 backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/35 to-transparent" />
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p
        className={`mt-2 text-xl font-semibold tracking-tight ${valueCls} ${mono ? "font-mono text-lg" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function DeploymentListRow({
  dep,
  project,
  busy,
  onViewLogs,
  onRedeploy,
  onRollback,
  onCancel,
}: {
  dep: DeploymentRow;
  project?: ProjectRow;
  busy: boolean;
  onViewLogs: () => void;
  onRedeploy: () => void;
  onRollback: () => void;
  onCancel: () => void;
}) {
  const style = deploymentStatusStyle(dep.status);
  const s = (dep.status ?? "").toLowerCase();
  const canCancel = isInflightStatus(s);
  const start = dep.started_at ?? dep.created_at;
  const end = dep.finished_at;
  const startMs = parseMs(start);
  const endMs = parseMs(end);
  const duration =
    startMs !== null && endMs !== null && endMs > startMs
      ? formatDurationMs(endMs - startMs)
      : isInflightStatus(s)
        ? "…"
        : "—";

  return (
    <li className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent p-5 backdrop-blur-xl transition-colors hover:border-basil-400/35">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {project ? (
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="truncate text-base font-semibold text-white transition-colors hover:text-basil-200"
              >
                {project.name ?? "Untitled"}
              </Link>
            ) : (
              <span className="text-base font-semibold text-white/70">
                Unknown project
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span className={style.text}>{style.tag}</span>
            </span>
          </div>
          {project?.slug ? (
            <p className="mt-1 font-mono text-[11px] text-basil-300/75">
              /{project.slug}
            </p>
          ) : null}

          <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <Meta label="Branch" value={dep.branch ?? "—"} mono />
            <Meta label="Commit" value={dep.commit_sha ?? "—"} mono />
            <Meta
              label="URL"
              value={dep.deployment_url ? truncate(dep.deployment_url, 36) : "—"}
              mono
            />
            <Meta label="Started" value={absoluteTime(start)} mono />
            <Meta label="Finished" value={absoluteTime(end)} mono />
            <Meta label="Build duration" value={duration} mono />
          </dl>

          {project ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-white/45">
              {project.framework ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                  {project.framework}
                </span>
              ) : null}
              {project.provider ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                  {providerLabel(project.provider)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col lg:items-stretch">
          <GlassBtn onClick={onViewLogs}>View logs</GlassBtn>
          <GlassBtn onClick={onRedeploy} disabled={busy} tone="primary">
            {busy ? "…" : "Redeploy"}
          </GlassBtn>
          <GlassBtn onClick={onRollback} disabled={busy}>
            Rollback
          </GlassBtn>
          {canCancel ? (
            <GlassBtn onClick={onCancel} disabled={busy} tone="danger">
              Cancel
            </GlassBtn>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
      <dt className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">
        {label}
      </dt>
      <dd
        className={`mt-0.5 truncate text-white/85 ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function GlassBtn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger";
}) {
  const cls =
    tone === "primary"
      ? "border-basil-400/45 bg-basil-500/15 text-basil-100 hover:bg-basil-500/25"
      : tone === "danger"
        ? "border-red-400/35 bg-red-500/10 text-red-100 hover:bg-red-500/15"
        : "border-white/12 bg-white/[0.05] text-white/85 hover:border-basil-400/35 hover:bg-basil-500/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function DeploymentDrawer({
  dep,
  project,
  logs,
  loading,
  onClose,
  onCopyUrl,
}: {
  dep: DeploymentRow;
  project?: ProjectRow;
  logs: LogRow[];
  loading: boolean;
  onClose: () => void;
  onCopyUrl: (u: string) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = dep.deployment_url;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-gradient-to-b from-[#050805] via-black to-black shadow-[-20px_0_80px_-20px_rgba(111,232,154,0.35)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/50 to-transparent" />

        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
              // deployment-logs
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">Build &amp; stream</h2>
            <p className="mt-1 font-mono text-[11px] text-white/50">{dep.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-white/60 transition-colors hover:border-basil-400/40 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">
              Project
            </p>
            <p className="mt-1 font-medium text-white">
              {project?.name ?? "—"}{" "}
              {project?.slug ? (
                <span className="font-mono text-basil-300/80">/{project.slug}</span>
              ) : null}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-white/70">
              <div className="flex justify-between gap-2">
                <span className="text-white/45">Status</span>
                <span className="font-mono">{dep.status ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/45">Branch</span>
                <span className="font-mono">{dep.branch ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/45">Commit</span>
                <span className="font-mono">{dep.commit_sha ?? "—"}</span>
              </div>
            </div>
            {url ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={url.startsWith("http") ? url : `https://${url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-xs text-basil-300 underline-offset-4 hover:underline"
                >
                  {url}
                </a>
                <button
                  type="button"
                  onClick={() => onCopyUrl(url.startsWith("http") ? url : `https://${url}`)}
                  className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60 hover:border-basil-400/40 hover:text-white"
                >
                  Copy URL
                </button>
              </div>
            ) : null}
          </div>

          {dep.build_logs ? (
            <div className="mt-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                Build output
              </p>
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-white/70">
                {dep.build_logs}
              </pre>
            </div>
          ) : null}

          <div className="mt-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
              Infrastructure stream
            </p>
            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/70 shadow-[inset_0_0_40px_-20px_rgba(111,232,154,0.2)]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-white/45">
                <span className="font-mono normal-case">gtlnav://logs</span>
                <span>windowed</span>
              </div>
              {loading ? (
                <div className="space-y-1 p-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-5 animate-pulse rounded bg-white/[0.05]"
                    />
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <p className="p-4 text-xs text-white/45">No log lines in this window.</p>
              ) : (
                <ul className="max-h-64 divide-y divide-white/[0.05] overflow-y-auto">
                  {logs.map((log) => {
                    const cls = logLevelClasses(logLevel(log));
                    return (
                      <li
                        key={log.id}
                        className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] gap-2 px-2 py-1.5 font-mono text-[11px] text-white/85"
                        style={{ animation: "var(--animate-log-reveal)" }}
                      >
                        <span className="text-white/35">{shortTime(log.created_at)}</span>
                        <span className={`h-1 w-1 self-center rounded-full ${cls.dot}`} />
                        <span className={`${cls.label} text-[9px]`}>{logTag(log)}</span>
                        <span className="truncate">{logMessage(log)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function FullPage({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-black text-white">
      <div className="flex items-center gap-3 text-sm text-white/55">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-basil-400/30 border-t-basil-400" />
        {label}
      </div>
    </div>
  );
}

function Background() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -top-32 right-1/4 h-[32rem] w-[32rem] rounded-full bg-basil-500/12 blur-[110px]" />
      <div className="absolute bottom-0 left-0 h-[24rem] w-[24rem] rounded-full bg-basil-600/10 blur-[90px]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.45) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, black 28%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 28%, transparent 72%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/35 to-transparent" />
    </div>
  );
}
