"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { startRealDeployment } from "@/src/lib/deploy-client";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";
import { AddDomainModal } from "./add-domain-modal";
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
} from "@/src/lib/dashboard-format";
import { providerLabel } from "@/src/lib/project-providers";
import { isInflightStatus } from "@/src/lib/deployment-simulator";

type ProjectTab =
  | "overview"
  | "deployments"
  | "runtime"
  | "domains"
  | "logs"
  | "settings";

type ProjectRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  status?: string | null;
  repo_url?: string | null;
  live_url?: string | null;
  runtime_kind?: string | null;
  hosting_kind?: string | null;
  default_branch?: string | null;
  root_directory?: string | null;
  build_command?: string | null;
  install_command?: string | null;
  build_output_dir?: string | null;
  start_command?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DeploymentRow = {
  id: string;
  status?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  deployment_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RuntimeInstanceRow = {
  id: string;
  runtime_kind?: string | null;
  status?: string | null;
  runtime_status?: string | null;
  health_status?: string | null;
  last_health_status?: string | null;
  internal_port?: number | null;
  external_port?: number | null;
  container_name?: string | null;
  docker_image?: string | null;
  image_tag?: string | null;
  serve_path?: string | null;
  framework?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DomainRow = {
  id: string;
  domain?: string | null;
  status?: string | null;
  ssl_status?: string | null;
  dns_target?: string | null;
  created_at?: string | null;
};

type LogRow = {
  id: string;
  message?: string | null;
  severity?: string | null;
  level?: string | null;
  event_type?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type ProjectWorkspaceData = {
  project: ProjectRow | null;
  deployments: DeploymentRow[];
  runtimeInstances: RuntimeInstanceRow[];
  domains: DomainRow[];
  logs: LogRow[];
};

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deployments", label: "Deployments" },
  { id: "runtime", label: "Runtime" },
  { id: "domains", label: "Domains" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

async function loadProjectWorkspace(
  userId: string,
  projectId: string,
): Promise<ProjectWorkspaceData> {
  const [projectRes, deploymentsRes, runtimeRes, domainsRes, logsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("deployments")
        .select("id, status, branch, commit_sha, deployment_url, created_at, updated_at")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("runtime_instances")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("domains")
        .select("id, domain, status, ssl_status, dns_target, created_at")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("infrastructure_logs")
        .select("id, message, severity, level, event_type, source, metadata, created_at")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(24),
    ]);

  if (projectRes.error) throw new Error(projectRes.error.message);

  return {
    project: (projectRes.data ?? null) as ProjectRow | null,
    deployments: (deploymentsRes.data ?? []) as DeploymentRow[],
    runtimeInstances: (runtimeRes.data ?? []) as RuntimeInstanceRow[],
    domains: (domainsRes.data ?? []) as DomainRow[],
    logs: (logsRes.data ?? []) as LogRow[],
  };
}

export function ProjectHostingFoundationClient({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<ProjectWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domainOpen, setDomainOpen] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (cancelled) return;
      if (!current) {
        router.replace("/login");
        return;
      }
      setSession(current);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        router.replace("/login");
        return;
      }
      setSession(nextSession);
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
        const next = await loadProjectWorkspace(userId, projectId);
        setData(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project.");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    const safeUserId = userId;
    let cancelled = false;
    async function refreshInitial() {
      await Promise.resolve();
      if (cancelled) return;
      await refresh(safeUserId, "initial");
    }
    void refreshInitial();
    return () => {
      cancelled = true;
    };
  }, [refresh, session?.user?.id]);

  const inflight = useMemo(() => {
    const projectInflight = isInflightStatus(data?.project?.status);
    const deploymentInflight = (data?.deployments ?? []).some((row) =>
      isInflightStatus(row.status),
    );
    return projectInflight || deploymentInflight || deployBusy;
  }, [data?.deployments, data?.project?.status, deployBusy]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !inflight) return;
    const id = window.setInterval(() => {
      void refresh(userId, "refresh");
    }, 2500);
    return () => window.clearInterval(id);
  }, [inflight, refresh, session?.user?.id]);

  const project = data?.project ?? null;

  const triggerDeploy = useCallback(async () => {
    if (!project) return;
    setDeployBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await startRealDeployment({
        projectId: project.id,
        branch: project.default_branch ?? "main",
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        `Deployment queued for ${project.name ?? "project"}. A worker will pick it up shortly.`,
      );
      if (session?.user?.id) {
        await refresh(session.user.id, "refresh");
      }
    } finally {
      setDeployBusy(false);
    }
  }, [project, refresh, session?.user?.id]);

  if (session === undefined || loading) {
    return <FullPageState label="Loading project workspace…" />;
  }
  if (!session) return null;
  if (!project) {
    return <FullPageState label={error ?? "Project not found."} />;
  }

  const statusStyle = projectStatusStyle(project.status);

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/15 blur-[110px]" />
        <div className="absolute bottom-0 left-0 h-[22rem] w-[22rem] rounded-full bg-basil-600/10 blur-[90px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="projects" userEmail={session.user.email} />

        <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-8">
          <PageHeader
            eyebrow="// hosting-project"
            title={project.name ?? "Project"}
            subtitle="Docker-native hosting architecture foundation with deployment, runtime, domain, and log surfaces."
            breadcrumbs={[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/dashboard/projects", label: "Projects" },
              { label: project.slug ?? project.id },
            ]}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => void refresh(session.user.id, "refresh")}
                  disabled={refreshing}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white/80 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 disabled:opacity-50"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => void triggerDeploy()}
                  disabled={inflight}
                  className="rounded-full border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-sm font-medium text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20 disabled:opacity-60"
                >
                  {inflight ? "Deploying…" : "Deploy"}
                </button>
                <Link
                  href={`/dashboard/projects/${project.id}/settings`}
                  className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)]"
                >
                  Settings
                </Link>
              </>
            }
          />

          <section className="mt-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${statusStyle.ring}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                  <span className={statusStyle.text}>{project.status ?? "idle"}</span>
                </span>
                {project.framework ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                    {project.framework}
                  </span>
                ) : null}
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                  {project.runtime_kind ?? "auto"} runtime
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                  {project.provider ? providerLabel(project.provider) : "No provider"}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryStat label="Deployments" value={`${data?.deployments.length ?? 0}`} />
                <SummaryStat label="Runtime instances" value={`${data?.runtimeInstances.length ?? 0}`} />
                <SummaryStat label="Domains" value={`${data?.domains.length ?? 0}`} />
                <SummaryStat label="Activity rows" value={`${data?.logs.length ?? 0}`} />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.24em] text-basil-300/80">
                {"// project-runtime-summary"}
              </p>
              <div className="mt-3 space-y-3 text-sm text-white/75">
                <InfoRow label="Branch" value={project.default_branch ?? "main"} mono />
                <InfoRow label="Repo" value={project.repo_url ?? "Not connected"} mono />
                <InfoRow
                  label="Live URL"
                  value={
                    project.live_url ? (
                      <a
                        href={withProtocol(project.live_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
                      >
                        {project.live_url}
                      </a>
                    ) : (
                      "Not live yet"
                    )
                  }
                />
                <InfoRow label="Created" value={absoluteTime(project.created_at)} mono />
              </div>
            </div>
          </section>

          {message ? (
            <div className="mt-4 rounded-2xl border border-basil-400/30 bg-basil-500/10 px-4 py-3 text-sm text-basil-100">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.02] p-2 backdrop-blur-xl">
            <div className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
                    activeTab === tab.id
                      ? "bg-basil-500/15 text-basil-100 border border-basil-400/35"
                      : "border border-white/10 bg-white/[0.03] text-white/55 hover:text-white hover:border-white/20"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-6">
            {activeTab === "overview" ? (
              <OverviewTab project={project} onAddDomain={() => setDomainOpen(true)} />
            ) : activeTab === "deployments" ? (
              <DeploymentsTab deployments={data?.deployments ?? []} />
            ) : activeTab === "runtime" ? (
              <RuntimeTab runtimeInstances={data?.runtimeInstances ?? []} />
            ) : activeTab === "domains" ? (
              <DomainsTab domains={data?.domains ?? []} onAddDomain={() => setDomainOpen(true)} />
            ) : activeTab === "logs" ? (
              <LogsTab logs={data?.logs ?? []} />
            ) : (
              <SettingsTab project={project} />
            )}
          </section>
        </main>
      </div>

      <AddDomainModal
        open={domainOpen}
        userId={session.user.id}
        projectId={project.id}
        onClose={() => setDomainOpen(false)}
        onCreated={() => void refresh(session.user.id, "refresh")}
      />
    </div>
  );
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
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
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2 last:border-b-0">
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</span>
      <span className={`text-right text-white/90 ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}

function OverviewTab({
  project,
  onAddDomain,
}: {
  project: ProjectRow;
  onAddDomain: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel eyebrow="// overview" title="Hosting overview">
        <div className="space-y-2">
          <InfoRow label="Project slug" value={project.slug ?? "—"} mono />
          <InfoRow label="Runtime mode" value={project.runtime_kind ?? "auto"} mono />
          <InfoRow label="Hosting kind" value={project.hosting_kind ?? "static"} mono />
          <InfoRow label="Framework" value={project.framework ?? "—"} />
          <InfoRow
            label="Repository"
            value={project.repo_url ?? "Connect a repository in settings"}
            mono
          />
        </div>
      </Panel>

      <Panel eyebrow="// workflow" title="Next actions">
        <div className="space-y-3">
          <TabEmptyState
            title="Docker worker not implemented in this tab"
            description="This foundation page exposes the hosting model and current project metadata. Real Docker build/extract/health lifecycle still runs through the worker foundation added in later phases."
            actionLabel="Add domain"
            onAction={onAddDomain}
          />
        </div>
      </Panel>
    </div>
  );
}

function DeploymentsTab({ deployments }: { deployments: DeploymentRow[] }) {
  return (
    <Panel eyebrow="// deployments" title="Deployment lifecycle">
      {deployments.length === 0 ? (
        <TabEmptyState
          title="No deployments yet"
          description="Queued, cloning, installing, building, image_building, deploying, running, failed, and stopped states will appear here as the deployment worker matures."
        />
      ) : (
        <ul className="space-y-3">
          {deployments.map((deployment) => {
            const style = deploymentStatusStyle(deployment.status);
            return (
              <li
                key={deployment.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      <span className={style.text}>{deployment.status ?? "queued"}</span>
                    </span>
                    {deployment.branch ? (
                      <span className="font-mono text-[11px] text-white/50">
                        {deployment.branch}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-white/40">
                    {relativeTime(deployment.created_at)}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <InfoRow label="Commit" value={deployment.commit_sha ?? "—"} mono />
                  <InfoRow
                    label="URL"
                    value={
                      deployment.deployment_url ? (
                        <a
                          href={withProtocol(deployment.deployment_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-basil-300 underline-offset-4 hover:text-basil-200 hover:underline"
                        >
                          {deployment.deployment_url}
                        </a>
                      ) : (
                        "Pending"
                      )
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RuntimeTab({ runtimeInstances }: { runtimeInstances: RuntimeInstanceRow[] }) {
  return (
    <Panel eyebrow="// runtime" title="Runtime instances">
      {runtimeInstances.length === 0 ? (
        <TabEmptyState
          title="No runtime instances yet"
          description="When GTLNAV promotes a build into a live container or static runtime, the active runtime instance and health metadata will appear here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {runtimeInstances.map((inst) => (
            <div
              key={inst.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-basil-400/35 bg-basil-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-100">
                  {inst.runtime_kind ?? "runtime"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                  {inst.runtime_status ?? inst.status ?? "unknown"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                  health · {inst.health_status ?? inst.last_health_status ?? "unknown"}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                <InfoRow label="Container" value={inst.container_name ?? "—"} mono />
                <InfoRow
                  label="Image"
                  value={inst.docker_image ?? inst.image_tag ?? "—"}
                  mono
                />
                <InfoRow
                  label="Ports"
                  value={`${inst.internal_port ?? "—"} / ${inst.external_port ?? "—"}`}
                  mono
                />
                <InfoRow label="Serve path" value={inst.serve_path ?? "—"} mono />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DomainsTab({
  domains,
  onAddDomain,
}: {
  domains: DomainRow[];
  onAddDomain: () => void;
}) {
  return (
    <Panel eyebrow="// domains" title="Custom domains">
      {domains.length === 0 ? (
        <TabEmptyState
          title="No domains attached"
          description="Connect a subdomain or apex domain to start validating DNS and SSL routing for this project."
          actionLabel="Add domain"
          onAction={onAddDomain}
        />
      ) : (
        <ul className="space-y-3">
          {domains.map((domain) => {
            const dnsStyle = domainStatusStyle(domain.status);
            const sslStyle = domainStatusStyle(domain.ssl_status);
            return (
              <li
                key={domain.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-white">{domain.domain ?? "—"}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      {domain.dns_target ? `Target: ${domain.dns_target}` : "No DNS target yet"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${dnsStyle.ring}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${dnsStyle.dot}`} />
                      <span className={dnsStyle.text}>{domain.status ?? "pending"}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${sslStyle.ring}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${sslStyle.dot}`} />
                      <span className={sslStyle.text}>{domain.ssl_status ?? "pending"}</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function LogsTab({ logs }: { logs: LogRow[] }) {
  return (
    <Panel eyebrow="// logs" title="Deployment and runtime logs">
      {logs.length === 0 ? (
        <TabEmptyState
          title="No logs yet"
          description="Deployment worker events, runtime actions, and domain activity will stream into this tab as the hosting pipeline advances."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60">
          <ul className="divide-y divide-white/[0.04]">
            {logs.map((log) => {
              const cls = logLevelClasses(logLevel(log));
              return (
                <li
                  key={log.id}
                  className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 font-mono text-[12px] text-white/85"
                >
                  <span className="text-white/35">{relativeTime(log.created_at)}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                  <span className={`text-[10px] uppercase tracking-[0.18em] ${cls.label}`}>
                    {logTag(log)}
                  </span>
                  <span className="truncate">{logMessage(log)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SettingsTab({ project }: { project: ProjectRow }) {
  const hasAdvanced =
    Boolean(project.repo_url) ||
    Boolean(project.root_directory) ||
    Boolean(project.install_command) ||
    Boolean(project.build_command) ||
    Boolean(project.build_output_dir) ||
    Boolean(project.start_command);

  return (
    <Panel eyebrow="// settings" title="Project settings foundation">
      {!hasAdvanced ? (
        <TabEmptyState
          title="No advanced build/runtime settings yet"
          description="Configure repository, root directory, install/build/output/start commands in the project settings screen."
          actionLabel="Open settings"
          href={`/dashboard/projects/${project.id}/settings`}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <InfoRow label="Repo URL" value={project.repo_url ?? "—"} mono />
            <InfoRow label="Branch" value={project.default_branch ?? "main"} mono />
            <InfoRow label="Root directory" value={project.root_directory ?? "—"} mono />
          </div>
          <div className="space-y-2">
            <InfoRow label="Install" value={project.install_command ?? "auto"} mono />
            <InfoRow label="Build" value={project.build_command ?? "auto"} mono />
            <InfoRow
              label="Output"
              value={project.build_output_dir ?? "auto"}
              mono
            />
            <InfoRow label="Start" value={project.start_command ?? "—"} mono />
          </div>
          <div className="lg:col-span-2">
            <Link
              href={`/dashboard/projects/${project.id}/settings`}
              className="inline-flex rounded-full border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-sm font-medium text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
            >
              Open full settings
            </Link>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:p-6">
      <p className="text-[10px] uppercase tracking-[0.24em] text-basil-300/80">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TabEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-black/30 px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
        <span className="text-lg text-basil-300">○</span>
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="max-w-xl text-sm text-white/55">{description}</p>
      {href && actionLabel ? (
        <Link
          href={href}
          className="mt-2 rounded-full border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-sm font-medium text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
        >
          {actionLabel}
        </Link>
      ) : null}
      {!href && actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-full border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-sm font-medium text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function withProtocol(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
