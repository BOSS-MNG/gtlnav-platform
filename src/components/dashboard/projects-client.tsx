"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { isInflightStatus } from "@/src/lib/deployment-simulator";
import { startRealDeployment } from "@/src/lib/deploy-client";
import {
  projectStatusStyle,
  relativeTime,
} from "@/src/lib/dashboard-format";
import { providerLabel } from "@/src/lib/project-providers";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import { CreateProjectModal } from "./create-project-modal";
import { DashboardSidebar } from "./dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";

type ProjectRow = {
  id: string;
  user_id?: string;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type StatusFilter = "all" | "active" | "deploying" | "paused" | "failed";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "deploying", label: "Deploying" },
  { id: "paused", label: "Paused" },
  { id: "failed", label: "Failed" },
];

function statusBucket(s: string | null | undefined): StatusFilter {
  const v = (s ?? "active").toLowerCase();
  if (v.includes("err") || v.includes("fail") || v.includes("crash")) return "failed";
  if (v === "paused" || v === "idle" || v === "archived" || v === "stopped") return "paused";
  if (isInflightStatus(v) || v === "rollout" || v.includes("deploy") || v === "building")
    return "deploying";
  return "active";
}

export function ProjectsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [frameworkFilter, setFrameworkFilter] = useState<string>("all");
  const [view, setView] = useState<"grid" | "table">("grid");

  const [createOpen, setCreateOpen] = useState(false);
  const [deployingIds, setDeployingIds] = useState<Set<string>>(new Set());
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{
    tone: "good" | "bad";
    text: string;
  } | null>(null);

  const inflightRef = useRef<Set<string>>(new Set());

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
    } = supabase.auth.onAuthStateChange((_e, newSession) => {
      if (!newSession) {
        router.replace("/login");
        return;
      }
      setSession(newSession);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  const refresh = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) {
          setLoadError(error.message);
          return;
        }
        setProjects((data ?? []) as ProjectRow[]);
        setLoadError(null);
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!session?.user?.id) return;
    void refresh(session.user.id, "initial");
  }, [session?.user?.id, refresh]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (deployingIds.size === 0 && !projects.some((p) => isInflightStatus(p.status))) return;
    const t = window.setInterval(() => {
      void refresh(userId, "refresh");
    }, 2500);
    return () => window.clearInterval(t);
  }, [session?.user?.id, deployingIds, projects, refresh]);

  // Clear tracked-as-deploying ids when the worker reports a terminal status.
  useEffect(() => {
    if (deployingIds.size === 0) return;
    const inflight = new Set(
      projects
        .filter((p) => isInflightStatus(p.status))
        .map((p) => p.id),
    );
    let mutated = false;
    const next = new Set(deployingIds);
    for (const id of deployingIds) {
      if (!inflight.has(id)) {
        next.delete(id);
        inflightRef.current.delete(id);
        mutated = true;
      }
    }
    if (mutated) setDeployingIds(next);
  }, [projects, deployingIds]);

  function flash(tone: "good" | "bad", text: string) {
    setActionMsg({ tone, text });
    window.setTimeout(() => setActionMsg(null), 3500);
  }

  const handleDeploy = useCallback(
    async (project: ProjectRow) => {
      const userId = session?.user?.id;
      if (!userId) return;
      if (inflightRef.current.has(project.id)) return;

      const start = await startRealDeployment({
        projectId: project.id,
        branch: "main",
      });
      if (!start.ok) {
        flash("bad", start.message);
        return;
      }
      if (start.warning) flash("bad", start.warning);
      inflightRef.current.add(project.id);
      setDeployingIds((s) => new Set(s).add(project.id));
      flash(
        "good",
        `Deployment queued for ${project.name ?? "project"}. A worker will pick it up shortly.`,
      );
      void refresh(userId, "refresh");
    },
    [session?.user?.id, refresh],
  );

  const handleTogglePause = useCallback(
    async (project: ProjectRow) => {
      const userId = session?.user?.id;
      if (!userId) return;
      const isPaused = (project.status ?? "").toLowerCase() === "paused";
      const next = isPaused ? "active" : "paused";
      setPausingId(project.id);
      try {
        const { error } = await supabase
          .from("projects")
          .update({ status: next })
          .eq("id", project.id)
          .eq("user_id", userId);
        if (error) {
          flash("bad", error.message);
          return;
        }
        flash("good", `${project.name ?? "Project"} ${isPaused ? "resumed" : "paused"}.`);
        await refresh(userId, "refresh");
      } finally {
        setPausingId(null);
      }
    },
    [session?.user?.id, refresh],
  );

  const handleConfirmDelete = useCallback(async () => {
    const userId = session?.user?.id;
    const project = deleteTarget;
    if (!userId || !project) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await supabase
        .from("infrastructure_logs")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", userId);
      await supabase
        .from("deployments")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", userId);
      await supabase
        .from("domains")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", userId);
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", project.id)
        .eq("user_id", userId);
      if (error) {
        setDeleteError(error.message);
        return;
      }
      setDeleteTarget(null);
      flash("good", `${project.name ?? "Project"} deleted.`);
      await refresh(userId, "refresh");
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete project.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [session?.user?.id, deleteTarget, refresh]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => {
      if (p.provider) set.add(p.provider);
    });
    return Array.from(set).sort();
  }, [projects]);

  const frameworks = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => {
      if (p.framework) set.add(p.framework);
    });
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && statusBucket(p.status) !== statusFilter) return false;
      if (providerFilter !== "all" && (p.provider ?? "") !== providerFilter) return false;
      if (frameworkFilter !== "all" && (p.framework ?? "") !== frameworkFilter) return false;
      if (q.length > 0) {
        const hay = `${p.name ?? ""} ${p.slug ?? ""} ${p.framework ?? ""} ${p.provider ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, statusFilter, providerFilter, frameworkFilter]);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-basil-400/30 border-t-basil-400" />
          <p className="text-sm text-white/50">Verifying session…</p>
        </div>
      </div>
    );
  }
  if (!session) return null;

  const userId = session.user.id;
  const totals = {
    total: projects.length,
    active: projects.filter((p) => statusBucket(p.status) === "active").length,
    deploying: projects.filter((p) => statusBucket(p.status) === "deploying").length,
    paused: projects.filter((p) => statusBucket(p.status) === "paused").length,
    failed: projects.filter((p) => statusBucket(p.status) === "failed").length,
  };

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/15 blur-[100px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar
          activeKey="projects"
          userEmail={session.user.email}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 space-y-6 p-4 sm:p-8">
            <PageHeader
              eyebrow="// projects"
              title="Projects"
              subtitle="Every project deployed on GTLNAV. Search, filter, deploy or archive from here."
              breadcrumbs={[
                { href: "/dashboard", label: "Dashboard" },
                { label: "Projects" },
              ]}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => void refresh(userId, "refresh")}
                    disabled={refreshing || loading}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white/80 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 disabled:opacity-50"
                  >
                    {refreshing ? "Refreshing…" : "Refresh"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
                  >
                    ＋ New project
                  </button>
                </>
              }
            />

            {actionMsg ? (
              <div
                role="status"
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  actionMsg.tone === "good"
                    ? "border-basil-400/30 bg-basil-500/10 text-basil-100"
                    : "border-red-400/30 bg-red-500/10 text-red-200"
                }`}
              >
                {actionMsg.text}
              </div>
            ) : null}

            {loadError ? (
              <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Couldn&apos;t load projects: {loadError}
              </div>
            ) : null}

            {/* Stat strip */}
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Total" value={totals.total} />
              <Stat label="Active" value={totals.active} tone="good" />
              <Stat label="Deploying" value={totals.deploying} tone="info" />
              <Stat label="Paused" value={totals.paused} />
              <Stat label="Failed" value={totals.failed} tone="bad" />
            </section>

            {/* Filters bar */}
            <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 items-center gap-2">
                <div className="relative flex-1 lg:max-w-md">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects, slugs, framework…"
                    className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 pl-10 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-basil-400/40 focus:ring-2 focus:ring-basil-400/15"
                  />
                  <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white/80"
                >
                  <option value="all">All providers</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {providerLabel(p)}
                    </option>
                  ))}
                </select>
                <select
                  value={frameworkFilter}
                  onChange={(e) => setFrameworkFilter(e.target.value)}
                  className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white/80"
                >
                  <option value="all">All frameworks</option>
                  {frameworks.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>

                <span className="hidden h-5 w-px bg-white/10 sm:inline-block" />

                <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
                  <ViewToggle active={view === "grid"} onClick={() => setView("grid")}>
                    Grid
                  </ViewToggle>
                  <ViewToggle active={view === "table"} onClick={() => setView("table")}>
                    Table
                  </ViewToggle>
                </div>
              </div>
            </section>

            {/* Status chips */}
            <section className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    statusFilter === f.id
                      ? "border-basil-400/40 bg-basil-500/15 text-basil-100"
                      : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {f.label}
                  <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-white/65">
                    {f.id === "all" ? totals.total : totals[f.id]}
                  </span>
                </button>
              ))}
            </section>

            {/* List */}
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyProjects
                hasAny={projects.length > 0}
                onCreate={() => setCreateOpen(true)}
              />
            ) : view === "grid" ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    deploying={deployingIds.has(p.id)}
                    pausing={pausingId === p.id}
                    onDeploy={() => void handleDeploy(p)}
                    onTogglePause={() => void handleTogglePause(p)}
                    onDelete={() => {
                      setDeleteError(null);
                      setDeleteTarget(p);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <ProjectsTable
                projects={filtered}
                deployingIds={deployingIds}
                pausingId={pausingId}
                onDeploy={(p) => void handleDeploy(p)}
                onTogglePause={(p) => void handleTogglePause(p)}
                onDelete={(p) => {
                  setDeleteError(null);
                  setDeleteTarget(p);
                }}
              />
            )}
          </main>
        </div>
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refresh(userId, "refresh")}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        destructive
        title={
          deleteTarget?.name
            ? `Delete "${deleteTarget.name}"?`
            : "Delete project?"
        }
        description="This will permanently delete the project, its deployments, domains, and infrastructure logs. This cannot be undone."
        confirmLabel="Delete project"
        busy={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "info" | "bad";
}) {
  const accent =
    tone === "good"
      ? "text-basil-200"
      : tone === "info"
        ? "text-cyan-200"
        : tone === "bad"
          ? "text-red-200"
          : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors ${
        active ? "bg-basil-500/20 text-basil-100" : "text-white/55 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ProjectCard({
  project,
  deploying,
  pausing,
  onDeploy,
  onTogglePause,
  onDelete,
}: {
  project: ProjectRow;
  deploying: boolean;
  pausing: boolean;
  onDeploy: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const status = (project.status ?? "active").toString();
  const lower = status.toLowerCase();
  const style = projectStatusStyle(status);
  const inflight = deploying || isInflightStatus(lower);
  const isPaused = lower === "paused";

  return (
    <li className="group relative">
      <div
        className={`relative overflow-hidden rounded-2xl border bg-white/[0.03] p-4 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-basil-400/40 ${
          inflight
            ? "border-basil-400/40 shadow-[0_0_50px_-15px_rgba(111,232,154,0.65)]"
            : "border-white/10"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="min-w-0 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-basil-400/40"
          >
            <p className="truncate text-sm font-semibold text-white">
              {project.name ?? "Untitled"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-basil-300/80">
              {project.slug ? `/${project.slug}` : "—"}
            </p>
          </Link>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] backdrop-blur-xl ${style.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            <span className={style.text}>{status}</span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/45">
          {project.framework ? (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5">
              {project.framework}
            </span>
          ) : null}
          {project.provider ? (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5">
              {providerLabel(project.provider)}
            </span>
          ) : null}
          <span className="ml-auto text-white/35">
            {relativeTime(project.created_at)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5">
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="grid place-items-center rounded-xl border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 hover:text-white"
          >
            Open
          </Link>
          <ActionButton
            tone="primary"
            onClick={onDeploy}
            disabled={inflight || isPaused}
            title={
              isPaused
                ? "Resume the project to deploy"
                : inflight
                  ? "Deployment in progress"
                  : "Trigger deployment"
            }
          >
            {inflight ? "Deploying…" : "Deploy"}
          </ActionButton>
          <ActionButton
            onClick={onTogglePause}
            disabled={pausing || inflight}
            title={isPaused ? "Resume project" : "Pause project"}
          >
            {pausing ? "…" : isPaused ? "Resume" : "Pause"}
          </ActionButton>
          <ActionButton tone="danger" onClick={onDelete} title="Delete project">
            Delete
          </ActionButton>
        </div>
      </div>
    </li>
  );
}

function ActionButton({
  onClick,
  children,
  disabled,
  tone,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "primary" | "danger";
  title?: string;
}) {
  const cls =
    tone === "primary"
      ? "border-basil-400/40 bg-basil-500/15 text-basil-100 hover:bg-basil-500/25"
      : tone === "danger"
        ? "border-white/10 bg-white/[0.04] text-white/70 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200"
        : "border-white/10 bg-white/[0.04] text-white/80 hover:border-basil-400/40 hover:bg-basil-500/10 hover:text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid place-items-center rounded-xl border px-2 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function ProjectsTable({
  projects,
  deployingIds,
  pausingId,
  onDeploy,
  onTogglePause,
  onDelete,
}: {
  projects: ProjectRow[];
  deployingIds: Set<string>;
  pausingId: string | null;
  onDeploy: (p: ProjectRow) => void;
  onTogglePause: (p: ProjectRow) => void;
  onDelete: (p: ProjectRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.22em] text-white/45">
            <tr>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Framework</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const status = (p.status ?? "active").toString();
              const lower = status.toLowerCase();
              const style = projectStatusStyle(status);
              const inflight = deployingIds.has(p.id) || isInflightStatus(lower);
              const isPaused = lower === "paused";
              return (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="text-white hover:text-basil-200"
                    >
                      <span className="block truncate font-semibold">
                        {p.name ?? "Untitled"}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-basil-300/75">
                        /{p.slug ?? "—"}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      <span className={style.text}>{status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/70">{p.framework ?? "—"}</td>
                  <td className="px-4 py-3 text-white/70">
                    {p.provider ? providerLabel(p.provider) : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/45">
                    {relativeTime(p.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/dashboard/projects/${p.id}`}
                        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 hover:border-basil-400/40 hover:text-white"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDeploy(p)}
                        disabled={inflight || isPaused}
                        className="rounded-md border border-basil-400/40 bg-basil-500/15 px-2 py-1 text-[11px] text-basil-100 disabled:opacity-50"
                      >
                        {inflight ? "Deploying…" : "Deploy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTogglePause(p)}
                        disabled={pausingId === p.id || inflight}
                        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 disabled:opacity-50"
                      >
                        {pausingId === p.id ? "…" : isPaused ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(p)}
                        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-red-400/40 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyProjects({
  hasAny,
  onCreate,
}: {
  hasAny: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
        <span className="text-xl text-basil-300">○</span>
      </div>
      <h4 className="text-sm font-semibold text-white">
        {hasAny ? "No projects match your filters" : "No projects yet"}
      </h4>
      <p className="max-w-md text-xs text-white/50">
        {hasAny
          ? "Try clearing your search or status filter."
          : "Spin up your first project to deploy on GTLNAV infrastructure."}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-1.5 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
      >
        ＋ Create project
      </button>
    </div>
  );
}
