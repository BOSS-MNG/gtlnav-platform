"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import {
  absoluteTime,
  deploymentStatusStyle,
  domainStatusStyle,
  logLevel,
  logLevelClasses,
  logMessage,
  logTag,
  projectStatusStyle,
  relativeTime,
  shortTime,
} from "@/src/lib/dashboard-format";
import { providerLabel } from "@/src/lib/project-providers";
import { isInflightStatus } from "@/src/lib/deployment-simulator";
import { startRealDeployment } from "@/src/lib/deploy-client";
import { AddDomainModal } from "./add-domain-modal";

type ProjectRow = {
  id: string;
  user_id?: string;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  status?: string | null;
  live_url?: string | null;
  repo_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type DomainRow = {
  id: string;
  domain?: string | null;
  status?: string | null;
  ssl_status?: string | null;
  dns_target?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type DeploymentRow = {
  id: string;
  status?: string | null;
  branch?: string | null;
  deployment_url?: string | null;
  build_logs?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type InfraLogRow = {
  id: string;
  message?: string | null;
  level?: string | null;
  severity?: string | null;
  type?: string | null;
  event_type?: string | null;
  source?: string | null;
  created_at?: string | null;
  event?: unknown;
  [key: string]: unknown;
};

type DetailData = {
  project: ProjectRow | null;
  deployments: DeploymentRow[];
  domains: DomainRow[];
  logs: InfraLogRow[];
};

type LoadResult = {
  data: DetailData;
  errors: string[];
  notFound: boolean;
};

async function loadDetail(
  userId: string,
  projectId: string,
): Promise<LoadResult> {
  const errors: string[] = [];

  const projectRes = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (projectRes.error) {
    errors.push(`projects: ${projectRes.error.message}`);
  }

  if (!projectRes.data) {
    return {
      data: { project: null, deployments: [], domains: [], logs: [] },
      errors,
      notFound: !projectRes.error,
    };
  }

  const [deploymentsRes, domainsRes, logsRes] = await Promise.all([
    supabase
      .from("deployments")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("domains")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("infrastructure_logs")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (deploymentsRes.error)
    errors.push(`deployments: ${deploymentsRes.error.message}`);
  if (domainsRes.error) errors.push(`domains: ${domainsRes.error.message}`);
  if (logsRes.error)
    errors.push(`infrastructure_logs: ${logsRes.error.message}`);

  return {
    data: {
      project: (projectRes.data ?? null) as ProjectRow,
      deployments: (deploymentsRes.data ?? []) as DeploymentRow[],
      domains: (domainsRes.data ?? []) as DomainRow[],
      logs: (logsRes.data ?? []) as InfraLogRow[],
    },
    errors,
    notFound: false,
  };
}

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
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
        const result = await loadDetail(userId, projectId);
        setData(result.data);
        setErrors(result.errors);
        setNotFound(result.notFound);
      } catch (err) {
        setErrors([
          err instanceof Error ? err.message : "Failed to load project.",
        ]);
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!session?.user?.id) return;
    void refresh(session.user.id, "initial");
  }, [session?.user?.id, refresh]);

  const localInflightRef = useRef(false);

  const remoteInflight = useMemo(() => {
    const project = data?.project;
    const deployments = data?.deployments ?? [];
    return (
      isInflightStatus(project?.status) ||
      deployments.some((d) => isInflightStatus(d.status))
    );
  }, [data?.project, data?.deployments]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (!triggering && !remoteInflight) return;
    const id = window.setInterval(() => {
      void refresh(userId, "refresh");
    }, 2500);
    return () => window.clearInterval(id);
  }, [session?.user?.id, triggering, remoteInflight, refresh]);

  const handleTriggerDeployment = useCallback(
    async (userId: string, project: ProjectRow) => {
      if (localInflightRef.current) return;
      setActionError(null);
      localInflightRef.current = true;
      setTriggering(true);

      try {
        const { data: existing } = await supabase
          .from("deployments")
          .select("id")
          .eq("project_id", project.id)
          .eq("user_id", userId)
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
          setActionError("A deployment is already in progress for this project.");
          return;
        }

        const start = await startRealDeployment({
          projectId: project.id,
          branch: "main",
        });

        if (!start.ok) {
          setActionError(start.message);
          return;
        }
        if (start.warning) {
          setActionError(start.warning);
        }

        await refresh(userId, "refresh");
        // From here, the polling loop above re-reads `deployments` until the
        // worker pushes a terminal status. We no longer drive phases from
        // the client.
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to trigger deployment.",
        );
      } finally {
        localInflightRef.current = false;
        setTriggering(false);
        await refresh(userId, "refresh");
      }
    },
    [refresh],
  );

  if (session === undefined) {
    return <FullPageState label="Verifying session…" />;
  }
  if (!session) return null;

  const userId = session.user.id;

  if (loading && !data) {
    return <FullPageState label="Loading project…" />;
  }

  if (notFound) {
    return <NotFoundState />;
  }

  const project = data?.project ?? null;
  if (!project) {
    return <NotFoundState />;
  }

  const projectStyle = projectStatusStyle(project.status);
  const projectName = project.name ?? "Untitled project";

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/15 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[24rem] w-[24rem] rounded-full bg-basil-600/10 blur-[90px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/40 to-transparent" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-white/10 bg-black/30 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-8 sm:py-6">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                <span aria-hidden>←</span> Dashboard
              </Link>
              <span className="text-white/30">/</span>
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-basil-300/80">
                projects
              </span>
              <span className="text-white/30">/</span>
              <span className="truncate font-mono text-xs text-white/70">
                {project.slug ?? project.id}
              </span>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.22em] text-basil-300/80">
                  Project
                </p>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {projectName}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] backdrop-blur-xl ${projectStyle.ring}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${projectStyle.dot}`}
                    />
                    <span className={projectStyle.text}>
                      {project.status ?? "active"}
                    </span>
                  </span>
                  {project.framework ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                      {project.framework}
                    </span>
                  ) : null}
                  {project.provider ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                      {providerLabel(project.provider)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/dashboard/projects/${project.id}/terminal`}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                >
                  Terminal
                </Link>
                <Link
                  href={`/dashboard/projects/${project.id}/shell`}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/65 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 hover:text-white/85"
                  title="Reserved — shell sessions are not enabled yet"
                >
                  Shell · locked
                </Link>
                <Link
                  href={`/dashboard/projects/${project.id}/settings`}
                  className="rounded-full border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-sm font-medium text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
                >
                  Settings
                </Link>
                {project.live_url ? (
                  <a
                    href={withProtocol(project.live_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    Open live ↗
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void refresh(userId, "refresh")}
                  disabled={refreshing}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white/80 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 disabled:opacity-50"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
          {errors.length > 0 ? (
            <div
              role="alert"
              className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            >
              <p className="font-medium">
                Some data couldn&apos;t be loaded:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-200/90">
                {errors.map((e) => (
                  <li key={e} className="font-mono text-xs">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {actionError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {actionError}
            </div>
          ) : null}

          <section className="grid gap-6 lg:grid-cols-3">
            <ProjectInfoCard project={project} />
            <ActionPanel
              busyDeploy={triggering || remoteInflight}
              deployStatus={
                triggering
                  ? "Deploying…"
                  : remoteInflight
                    ? `Phase: ${(project.status ?? "deploying").toLowerCase()}`
                    : null
              }
              onTriggerDeploy={() =>
                void handleTriggerDeployment(userId, project)
              }
              onAddDomain={() => setDomainOpen(true)}
              project={project}
            />
          </section>

          <LiveMetrics inflight={triggering || remoteInflight} />

          <section className="grid gap-6 lg:grid-cols-2">
            <DomainsCard
              domains={data?.domains ?? []}
              onAddClick={() => setDomainOpen(true)}
            />
            <DeploymentsTimeline deployments={data?.deployments ?? []} />
          </section>

          <ActivityLogCard logs={data?.logs ?? []} />
        </main>
      </div>

      <AddDomainModal
        open={domainOpen}
        userId={userId}
        projectId={project.id}
        onClose={() => setDomainOpen(false)}
        onCreated={() => void refresh(userId, "refresh")}
      />
    </div>
  );
}

function withProtocol(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function FullPageState({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-basil-400/30 border-t-basil-400" />
        <p className="text-sm text-white/50">{label}</p>
      </div>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-4 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/15 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[24rem] w-[24rem] rounded-full bg-basil-600/10 blur-[90px]" />
      </div>
      <div className="relative z-10 w-full max-w-md text-center">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/30 via-basil-500/10 to-transparent opacity-70 blur-md" />
        <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-8 backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent" />
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
            <span className="text-xl text-basil-300">○</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">
            Project not found
          </h1>
          <p className="mt-2 text-sm text-white/55">
            This project doesn&apos;t exist or isn&apos;t accessible from your
            account.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function CardShell({
  eyebrow,
  title,
  action,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl ${
        className ?? ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3 last:border-b-0">
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/80">
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right text-sm text-white/85 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ProjectInfoCard({ project }: { project: ProjectRow }) {
  const status = project.status ?? "active";
  return (
    <div className="lg:col-span-2">
      <CardShell eyebrow="// project-info" title="Information">
        <div>
          <InfoRow label="Name" value={project.name ?? "—"} />
          <InfoRow
            label="Slug"
            value={project.slug ? `/${project.slug}` : "—"}
            mono
          />
          <InfoRow label="Status" value={status} mono />
          <InfoRow label="Framework" value={project.framework ?? "—"} />
          <InfoRow
            label="Provider"
            value={project.provider ? providerLabel(project.provider) : "—"}
          />
          <InfoRow
            label="Live URL"
            value={
              project.live_url ? (
                <a
                  href={withProtocol(project.live_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
                >
                  {project.live_url}
                </a>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label="Repo URL"
            value={
              project.repo_url ? (
                <a
                  href={withProtocol(project.repo_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
                >
                  {project.repo_url}
                </a>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label="Created"
            value={absoluteTime(project.created_at)}
            mono
          />
          <InfoRow
            label="Updated"
            value={absoluteTime(project.updated_at)}
            mono
          />
        </div>
      </CardShell>
    </div>
  );
}

function ActionPanel({
  busyDeploy,
  deployStatus,
  onTriggerDeploy,
  onAddDomain,
  project,
}: {
  busyDeploy: boolean;
  deployStatus: string | null;
  onTriggerDeploy: () => void;
  onAddDomain: () => void;
  project: ProjectRow;
}) {
  return (
    <CardShell eyebrow="// actions" title="Action panel" className="h-full">
      <div className="flex h-full flex-col gap-4">
        <button
          type="button"
          onClick={onTriggerDeploy}
          disabled={busyDeploy}
          className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-3 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyDeploy ? (deployStatus ?? "Deploying…") : "Trigger Deployment"}
        </button>

        <button
          type="button"
          onClick={onAddDomain}
          className="rounded-2xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
        >
          ＋ Add domain
        </button>

        <div className="mt-auto rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/55">
          <div className="flex items-center justify-between">
            <span className="text-basil-300/80">project_id</span>
            <span className="truncate">{project.id}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-basil-300/80">branch</span>
            <span>main</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-basil-300/80">simulation</span>
            <span className="text-basil-300">enabled</span>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function LiveMetrics({ inflight }: { inflight: boolean }) {
  const [tick, setTick] = useState(0);
  const [cpu, setCpu] = useState(0.18);
  const [ram, setRam] = useState(384);
  const [netIn, setNetIn] = useState(2.4);
  const [netOut, setNetOut] = useState(1.6);
  const [reqs, setReqs] = useState(312);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      const burst = inflight ? 1.6 : 1;
      setCpu((c) => clamp(c + (Math.random() - 0.4) * 0.08 * burst, 0.05, 0.92));
      setRam((r) =>
        clamp(r + (Math.random() - 0.5) * 28 * burst, 220, 920),
      );
      setNetIn((n) =>
        clamp(n + (Math.random() - 0.45) * 0.8 * burst, 0.4, 12),
      );
      setNetOut((n) =>
        clamp(n + (Math.random() - 0.45) * 0.6 * burst, 0.3, 9),
      );
      setReqs((r) =>
        Math.max(
          0,
          Math.round(r + (Math.random() - 0.4) * 80 * burst),
        ),
      );
    }, 1400);
    return () => window.clearInterval(id);
  }, [inflight]);

  return (
    <CardShell
      eyebrow="// telemetry"
      title="Live metrics"
      action={
        <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-[11px] text-basil-200 backdrop-blur-xl">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
          </span>
          {inflight ? "spike · build phase" : "steady state"}
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="CPU"
          value={`${(cpu * 100).toFixed(1)}%`}
          ratio={cpu}
          tone="basil"
        />
        <MetricTile
          label="Memory"
          value={`${ram.toFixed(0)} MB`}
          ratio={Math.min(ram / 1024, 1)}
          tone="cyan"
        />
        <MetricTile
          label="Net IN"
          value={`${netIn.toFixed(2)} MB/s`}
          ratio={Math.min(netIn / 12, 1)}
          tone="basil"
          spark={tick}
        />
        <MetricTile
          label="Net OUT"
          value={`${netOut.toFixed(2)} MB/s`}
          ratio={Math.min(netOut / 9, 1)}
          tone="amber"
          spark={tick}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Requests / min" value={`${reqs}`} />
        <MiniStat label="Edge regions" value="34 healthy" />
        <MiniStat
          label="Uptime (30d)"
          value={inflight ? "99.96%" : "99.99%"}
        />
      </div>
    </CardShell>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function MetricTile({
  label,
  value,
  ratio,
  tone,
}: {
  label: string;
  value: string;
  ratio: number;
  tone: "basil" | "cyan" | "amber";
  spark?: number;
}) {
  const fill =
    tone === "basil"
      ? "from-basil-400 to-basil-300"
      : tone === "cyan"
        ? "from-cyan-400 to-cyan-300"
        : "from-amber-400 to-amber-300";
  const glow =
    tone === "basil"
      ? "rgba(111,232,154,0.45)"
      : tone === "cyan"
        ? "rgba(103,232,249,0.45)"
        : "rgba(252,211,77,0.45)";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/50">
          {label}
        </p>
        <p className="font-mono text-base font-semibold text-white">{value}</p>
      </div>
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${fill} transition-all duration-700 ease-out`}
          style={{
            width: `${Math.max(4, Math.min(100, ratio * 100))}%`,
            boxShadow: `0 0 14px ${glow}`,
          }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/45">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-white/85">{value}</p>
    </div>
  );
}

function DomainsCard({
  domains,
  onAddClick,
}: {
  domains: DomainRow[];
  onAddClick: () => void;
}) {
  return (
    <CardShell
      eyebrow="// domains"
      title="Domains"
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/domains"
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
          >
            Manage all →
          </Link>
          <button
            type="button"
            onClick={onAddClick}
            className="rounded-full border border-basil-400/40 bg-basil-500/10 px-3 py-1.5 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
          >
            ＋ Add
          </button>
        </div>
      }
    >
      {domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          description="Connect a custom domain to route traffic to this project."
          actionLabel="Add domain"
          onAction={onAddClick}
        />
      ) : (
        <ul className="space-y-3">
          {domains.map((d) => (
            <DomainItem key={d.id} domain={d} />
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function DomainItem({ domain }: { domain: DomainRow }) {
  const status = domain.status ?? "pending";
  const sslStatus = domain.ssl_status ?? "pending";
  const style = domainStatusStyle(status);
  const sslStyle = domainStatusStyle(sslStatus);

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl transition-colors hover:border-basil-400/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-white">
            {domain.domain ?? "—"}
          </p>
          {domain.dns_target ? (
            <p className="mt-1 truncate font-mono text-[11px] text-white/45">
              CNAME → {domain.dns_target}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            <span className={style.text}>{status}</span>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${sslStyle.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${sslStyle.dot}`} />
            <span className={sslStyle.text}>SSL · {sslStatus}</span>
          </span>
        </div>
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
        Added {relativeTime(domain.created_at)}
      </p>
    </li>
  );
}

function DeploymentsTimeline({
  deployments,
}: {
  deployments: DeploymentRow[];
}) {
  return (
    <CardShell eyebrow="// deployments" title="Deployments">
      {deployments.length === 0 ? (
        <EmptyState
          title="No deployments yet"
          description="Trigger your first deployment from the action panel."
        />
      ) : (
        <ol className="relative space-y-4 pl-6">
          <span
            aria-hidden
            className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-basil-300/40 via-white/10 to-transparent"
          />
          {deployments.map((d) => (
            <DeploymentItem key={d.id} deployment={d} />
          ))}
        </ol>
      )}
    </CardShell>
  );
}

function DeploymentItem({ deployment }: { deployment: DeploymentRow }) {
  const style = deploymentStatusStyle(deployment.status);
  return (
    <li className="relative">
      <span
        aria-hidden
        className={`absolute -left-[1.05rem] top-1.5 grid h-3 w-3 place-items-center rounded-full border border-white/20 ${style.dot.replace(
          "shadow-",
          "shadow-",
        )}`}
      />
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl transition-colors hover:border-basil-400/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span className={style.text}>{style.tag}</span>
            </span>
            {deployment.branch ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/65">
                {deployment.branch}
              </span>
            ) : null}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            {relativeTime(deployment.created_at)}
          </span>
        </div>

        {deployment.deployment_url ? (
          <a
            href={withProtocol(deployment.deployment_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
          >
            {deployment.deployment_url} ↗
          </a>
        ) : null}

        {deployment.build_logs ? (
          <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-white/65">
            {deployment.build_logs}
          </pre>
        ) : null}
      </div>
    </li>
  );
}

function ActivityLogCard({ logs }: { logs: InfraLogRow[] }) {
  return (
    <CardShell
      eyebrow="// infrastructure-logs"
      title="Infrastructure activity"
      action={
        <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-[11px] text-basil-200 backdrop-blur-xl">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
          </span>
          Project stream
        </span>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 shadow-[inset_0_0_60px_-30px_rgba(111,232,154,0.25)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-white/45">
          <span className="flex items-center gap-2">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-basil-300/80" />
            </span>
            <span className="font-mono normal-case tracking-normal text-white/55">
              gtlnav://stream/project_logs
            </span>
          </span>
          <span className="font-mono normal-case tracking-normal text-basil-300/80">
            tail -f
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="px-4 py-10">
            <EmptyState
              title="No activity yet"
              description="Trigger a deployment or attach a domain to populate the project log."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {logs.map((log) => (
              <ActivityRow key={log.id} log={log} />
            ))}
          </ul>
        )}
      </div>
    </CardShell>
  );
}

function ActivityRow({ log }: { log: InfraLogRow }) {
  const cls = logLevelClasses(logLevel(log));
  return (
    <li
      className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 font-mono text-[12px] text-white/85 transition-colors hover:bg-basil-400/[0.04]"
      style={{ animation: "var(--animate-log-reveal)" }}
    >
      <span className="text-[11px] tabular-nums text-white/35">
        {shortTime(log.created_at)}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
      <span className={`text-[10px] uppercase tracking-[0.18em] ${cls.label}`}>
        {logTag(log)}
      </span>
      <span className="truncate">{logMessage(log)}</span>
      {log.source ? (
        <span className="hidden truncate text-[10px] uppercase tracking-[0.18em] text-white/35 md:inline">
          {log.source}
        </span>
      ) : (
        <span aria-hidden />
      )}
    </li>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
        <span className="text-lg text-basil-300">○</span>
      </div>
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <p className="max-w-md text-xs text-white/50">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-1.5 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
