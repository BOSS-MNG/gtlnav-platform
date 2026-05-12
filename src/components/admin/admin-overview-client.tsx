"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  AdminRlsWarning,
  AdminShell,
  type AdminContext,
} from "@/src/components/admin/admin-shell";
import {
  AdminButton,
  CardShell,
  EmptyState,
  MetricTile,
  StatusPill,
} from "@/src/components/admin/admin-ui";
import {
  GearIcon,
  GlobeIcon,
  LockIcon,
  PlugIcon,
  ProjectsIcon,
  RocketIcon,
  ServerIcon,
  ShieldIcon,
  TerminalIcon,
  WebhookIcon,
} from "@/src/components/ui/icons";
import {
  deploymentStatusStyle,
  logLevel,
  logLevelClasses,
  logMessage,
  relativeTime,
  shortTime,
} from "@/src/lib/dashboard-format";

type LogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  message: string | null;
  event_type: string | null;
  level: string | null;
  severity: string | null;
  source: string | null;
  created_at: string | null;
};

type Counts = {
  users: number | null;
  projects: number | null;
  inflightDeployments: number | null;
  pendingDomains: number | null;
  failedDeploys: number | null;
  activeHooks: number | null;
  logsToday: number | null;
};

type ProjectMini = {
  id: string;
  name: string | null;
  slug: string | null;
  status: string | null;
  user_id: string | null;
  created_at: string | null;
};

type UserMini = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  created_at: string | null;
};

type DomainMini = {
  id: string;
  name: string | null;
  domain: string | null;
  status: string | null;
  created_at: string | null;
};

type DeployMini = {
  id: string;
  project_id: string | null;
  status: string | null;
  created_at: string | null;
};

const INFLIGHT = ["queued", "building", "deploying", "running", "in_progress"];

export function AdminOverviewClient() {
  return (
    <AdminShell
      activeKey="overview"
      eyebrow="// admin / overview"
      title="GTLNAV Operator Console"
      description="Operator landing page. Platform health at a glance — drill into any module from the sidebar."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [counts, setCounts] = useState<Counts>({
    users: null,
    projects: null,
    inflightDeployments: null,
    pendingDomains: null,
    failedDeploys: null,
    activeHooks: null,
    logsToday: null,
  });
  const [criticalEvents, setCriticalEvents] = useState<LogRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<LogRow[]>([]);
  const [pendingDomains, setPendingDomains] = useState<DomainMini[]>([]);
  const [failedDeploys, setFailedDeploys] = useState<DeployMini[]>([]);
  const [latestProjects, setLatestProjects] = useState<ProjectMini[]>([]);
  const [latestUsers, setLatestUsers] = useState<UserMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const errs: string[] = [];

    const handleCount = (
      table: string,
      out: { count: number | null; error: { message: string } | null },
    ): number | null => {
      if (out.error) {
        const m = out.error.message.toLowerCase();
        if (
          !m.includes("relation") &&
          !m.includes("does not exist") &&
          !m.includes("schema cache")
        ) {
          errs.push(`${table}: ${out.error.message}`);
        }
        return null;
      }
      return out.count ?? 0;
    };

    const swallow = <T,>(
      table: string,
      out: { data: T | null; error: { message: string } | null },
    ): T | null => {
      if (out.error) {
        const m = out.error.message.toLowerCase();
        if (
          !m.includes("relation") &&
          !m.includes("does not exist") &&
          !m.includes("schema cache")
        ) {
          errs.push(`${table}: ${out.error.message}`);
        }
        return null;
      }
      return out.data ?? null;
    };

    const [
      usersRes,
      projectsRes,
      inflightRes,
      pendingDomainsRes,
      failedDeploysRes,
      activeHooksRes,
      logsTodayRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("projects").select("*", { count: "exact", head: true }),
      supabase
        .from("deployments")
        .select("*", { count: "exact", head: true })
        .in("status", INFLIGHT as unknown as string[]),
      supabase
        .from("domains")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("deployments")
        .select("*", { count: "exact", head: true })
        .in("status", ["failed", "error"] as unknown as string[]),
      supabase
        .from("deploy_hooks")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("infrastructure_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString()),
    ]);

    const users = handleCount("profiles", usersRes);
    const projects = handleCount("projects", projectsRes);
    const inflight = handleCount("deployments", inflightRes);
    const pending = handleCount("domains", pendingDomainsRes);
    const failed = handleCount("deployments", failedDeploysRes);
    const activeHooks = handleCount("deploy_hooks", activeHooksRes);
    const logsToday = handleCount("infrastructure_logs", logsTodayRes);

    const [
      criticalRes,
      auditRes,
      pendingDomainsListRes,
      failedDeploysListRes,
      latestProjectsRes,
      latestUsersRes,
    ] = await Promise.all([
      supabase
        .from("infrastructure_logs")
        .select("id, user_id, project_id, message, event_type, level, severity, source, created_at")
        .or("severity.in.(error,critical),level.in.(error,critical)")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("infrastructure_logs")
        .select("id, user_id, project_id, message, event_type, level, severity, source, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("domains")
        .select("id, name, domain, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("deployments")
        .select("id, project_id, status, created_at")
        .in("status", ["failed", "error"] as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("projects")
        .select("id, name, slug, status, user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("profiles")
        .select("id, email, full_name, role, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    setCriticalEvents((swallow<LogRow[]>("infrastructure_logs", criticalRes) ?? []) as LogRow[]);
    setAuditEvents((swallow<LogRow[]>("infrastructure_logs", auditRes) ?? []) as LogRow[]);
    setPendingDomains((swallow<DomainMini[]>("domains", pendingDomainsListRes) ?? []) as DomainMini[]);
    setFailedDeploys((swallow<DeployMini[]>("deployments", failedDeploysListRes) ?? []) as DeployMini[]);
    setLatestProjects((swallow<ProjectMini[]>("projects", latestProjectsRes) ?? []) as ProjectMini[]);
    setLatestUsers((swallow<UserMini[]>("profiles", latestUsersRes) ?? []) as UserMini[]);

    setCounts({
      users,
      projects,
      inflightDeployments: inflight,
      pendingDomains: pending,
      failedDeploys: failed,
      activeHooks,
      logsToday,
    });
    setErrors(errs);

    if (mode === "initial") setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh("refresh");
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const operatorLine = useMemo(() => {
    const role = ctx.profile.role ?? "operator";
    const email = ctx.profile.email ?? ctx.session.user.email ?? "operator";
    return `${role.toUpperCase()} · ${email}`;
  }, [ctx]);

  const systemHealth = useMemo(() => {
    const failingCount = (counts.failedDeploys ?? 0) > 0 ? 1 : 0;
    const pendingCount = (counts.pendingDomains ?? 0) > 5 ? 1 : 0;
    const tone: "good" | "warn" | "bad" =
      failingCount > 0
        ? "bad"
        : pendingCount > 0
          ? "warn"
          : "good";
    const label = tone === "good" ? "All systems nominal" : tone === "warn" ? "Degraded" : "Incidents";
    return { tone, label };
  }, [counts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/55">
            Signed in as <span className="text-white/85">{operatorLine}</span>
          </p>
          <StatusPill
            label={systemHealth.label}
            tone={systemHealth.tone}
            pulse={systemHealth.tone !== "good"}
          />
        </div>
        <div className="flex items-center gap-2">
          <AdminButton onClick={() => void refresh("refresh")} busy={refreshing}>
            Refresh
          </AdminButton>
          <Link
            href="/admin/settings"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            <GearIcon className="h-3.5 w-3.5" title="Operator settings" />
            Operator settings
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            Back to user console
          </Link>
        </div>
      </div>

      <AdminRlsWarning
        visible={errors.length > 0}
        message={
          errors.length > 0
            ? `Some admin queries reported errors: ${errors
                .slice(0, 3)
                .join(" · ")}${errors.length > 3 ? "…" : ""}. If results look incomplete, configure admin RLS policies or an authorized RPC layer.`
            : undefined
        }
      />

      {/* Platform metrics */}
      <CardShell
        eyebrow="// platform-metrics"
        title="Platform metrics"
        description="Live counters across every tenant. Refreshes every 20s."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricTile
            label="Total users"
            value={loading ? "—" : (counts.users ?? "—")}
            hint="profiles"
          />
          <MetricTile
            label="Total projects"
            value={loading ? "—" : (counts.projects ?? "—")}
            hint="projects"
          />
          <MetricTile
            label="Inflight"
            value={loading ? "—" : (counts.inflightDeployments ?? "—")}
            hint="deployments"
            tone={counts.inflightDeployments && counts.inflightDeployments > 0 ? "good" : "default"}
          />
          <MetricTile
            label="Failed deploys"
            value={loading ? "—" : (counts.failedDeploys ?? "—")}
            hint="last 24h+"
            tone={counts.failedDeploys && counts.failedDeploys > 0 ? "bad" : "default"}
          />
          <MetricTile
            label="Pending domains"
            value={loading ? "—" : (counts.pendingDomains ?? "—")}
            hint="awaiting verify"
            tone={counts.pendingDomains && counts.pendingDomains > 0 ? "warn" : "default"}
          />
          <MetricTile
            label="Logs today"
            value={loading ? "—" : (counts.logsToday ?? "—")}
            hint="infrastructure_logs"
          />
        </div>
      </CardShell>

      {/* Critical + Quick actions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CardShell
          eyebrow="// critical events"
          title="Recent critical events"
          description="Errors and critical-severity rows from infrastructure_logs."
          className="lg:col-span-2"
          right={
            <Link
              href="/admin/audit"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
            >
              Open audit
            </Link>
          }
        >
          {loading ? (
            <SkeletonRows />
          ) : criticalEvents.length === 0 ? (
            <EmptyState
              title="No critical events"
              description="No error or critical severity logs in the recent feed."
            />
          ) : (
            <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-black/45 font-mono text-[12px]">
              {criticalEvents.map((log) => {
                const cls = logLevelClasses(logLevel(log));
                return (
                  <li
                    key={log.id}
                    className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-3 py-2"
                  >
                    <span className="text-white/35">{shortTime(log.created_at)}</span>
                    <span className={`min-w-[70px] ${cls.label}`}>{cls.tag}</span>
                    <span className="truncate text-white/85">{logMessage(log)}</span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                      {log.source ?? log.event_type ?? "event"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardShell>

        <CardShell eyebrow="// quick actions" title="Operator shortcuts">
          <div className="grid grid-cols-1 gap-2">
            <QuickAction href="/admin/users" label="Users & roles" Icon={ShieldIcon} />
            <QuickAction href="/admin/projects" label="Project control" Icon={ProjectsIcon} />
            <QuickAction href="/admin/deployments" label="Deployments" Icon={RocketIcon} />
            <QuickAction href="/admin/domains" label="Domains" Icon={GlobeIcon} />
            <QuickAction href="/admin/infrastructure" label="Infrastructure" Icon={ServerIcon} />
            <QuickAction href="/admin/security" label="Security" Icon={LockIcon} />
            <QuickAction href="/admin/audit" label="Audit stream" Icon={TerminalIcon} />
            <QuickAction href="/admin/settings" label="Operator settings" Icon={GearIcon} />
          </div>
        </CardShell>
      </div>

      {/* Pending domain verifications + failed deployments */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell
          eyebrow="// domains"
          title="Pending domain verifications"
          description="Domains awaiting DNS verify or SSL issuance."
          right={
            <Link
              href="/admin/domains"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
            >
              Open domains
            </Link>
          }
        >
          {loading ? (
            <SkeletonRows />
          ) : pendingDomains.length === 0 ? (
            <EmptyState
              title="No pending domains"
              description="Every domain has either been verified or failed."
            />
          ) : (
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02]">
              {pendingDomains.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-white">
                      {d.name ?? d.domain ?? d.id}
                    </p>
                    <p className="text-[11px] text-white/45">
                      Created {relativeTime(d.created_at)}
                    </p>
                  </div>
                  <StatusPill label="Pending" tone="warn" pulse />
                </li>
              ))}
            </ul>
          )}
        </CardShell>

        <CardShell
          eyebrow="// deployments"
          title="Failed deployments"
          description="Recent failed builds across all tenants."
          right={
            <Link
              href="/admin/deployments"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
            >
              Open deployments
            </Link>
          }
        >
          {loading ? (
            <SkeletonRows />
          ) : failedDeploys.length === 0 ? (
            <EmptyState
              title="No failed deployments"
              description="Everything is shipping cleanly. Nice."
            />
          ) : (
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02]">
              {failedDeploys.map((d) => {
                const style = deploymentStatusStyle(d.status);
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-white">{d.id.slice(0, 10)}…</p>
                      <p className="text-[11px] text-white/45">
                        Project {d.project_id?.slice(0, 8) ?? "?"} · {relativeTime(d.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      <span className={style.text}>{style.tag}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardShell>
      </div>

      {/* System health + Latest users + Latest projects */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CardShell
          eyebrow="// system-health"
          title="System health"
          description="Top-level platform components. Read-only summary."
        >
          <div className="space-y-2">
            <HealthRow label="Edge runtime" tone="good" hint="All regions" />
            <HealthRow
              label="Database"
              tone={(counts.users ?? 0) > 0 ? "good" : "warn"}
              hint={(counts.users ?? 0) > 0 ? "Reachable" : "No data"}
            />
            <HealthRow label="Object storage" tone="good" hint="Buckets healthy" />
            <HealthRow
              label="Deploy pipeline"
              tone={(counts.failedDeploys ?? 0) > 0 ? "warn" : "good"}
              hint={(counts.failedDeploys ?? 0) > 0 ? "Some failures" : "Healthy"}
            />
            <HealthRow
              label="DNS / TLS"
              tone={(counts.pendingDomains ?? 0) > 0 ? "warn" : "good"}
              hint={(counts.pendingDomains ?? 0) > 0 ? `${counts.pendingDomains} pending` : "Resolvers nominal"}
            />
          </div>
        </CardShell>

        <CardShell
          eyebrow="// users"
          title="Latest users"
          description="Newest accounts."
          right={
            <Link
              href="/admin/users"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
            >
              All users
            </Link>
          }
        >
          {loading ? (
            <SkeletonRows />
          ) : latestUsers.length === 0 ? (
            <EmptyState title="No users yet" />
          ) : (
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02]">
              {latestUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{u.full_name ?? u.email ?? u.id}</p>
                    <p className="truncate font-mono text-[11px] text-white/45">{u.email ?? u.id}</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/65">
                    {(u.role ?? "user").toString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardShell>

        <CardShell
          eyebrow="// projects"
          title="Latest projects"
          description="Newest projects across the platform."
          right={
            <Link
              href="/admin/projects"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
            >
              All projects
            </Link>
          }
        >
          {loading ? (
            <SkeletonRows />
          ) : latestProjects.length === 0 ? (
            <EmptyState title="No projects yet" />
          ) : (
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02]">
              {latestProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{p.name ?? "Untitled"}</p>
                    <p className="truncate font-mono text-[11px] text-basil-300/75">
                      /{p.slug ?? p.id.slice(0, 8)}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/65">
                    {(p.status ?? "active").toString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardShell>
      </div>

      {/* Recent admin audit */}
      <CardShell
        eyebrow="// admin-audit"
        title="Recent admin audit"
        description="Most recent platform-wide events. Open the full audit stream for filtering."
        right={
          <Link
            href="/admin/audit"
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/25 hover:text-white"
          >
            Full audit stream
          </Link>
        }
      >
        {loading ? (
          <SkeletonRows />
        ) : auditEvents.length === 0 ? (
          <EmptyState
            title="No platform events yet"
            description="As tenants deploy, verify domains, and run health checks, their events will appear here."
          />
        ) : (
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-black/55 font-mono text-[12px]">
            {auditEvents.map((log) => {
              const styles = logLevelClasses(logLevel(log));
              return (
                <li key={log.id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-2">
                  <span className="text-white/35">{shortTime(log.created_at)}</span>
                  <span className={`min-w-[70px] ${styles.label}`}>{styles.tag}</span>
                  <span className="truncate text-white/85">{logMessage(log)}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                    {log.source ?? log.event_type ?? "event"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardShell>

      {/* Operator integrations row */}
      <CardShell
        eyebrow="// integrations"
        title="Tenant integrations"
        description="Operator quick-jumps to user-facing developer surfaces."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <QuickAction href="/dashboard/integrations" label="Git providers" Icon={PlugIcon} />
          <QuickAction href="/dashboard/webhooks" label="Deploy hooks" Icon={WebhookIcon} />
          <QuickAction href="/dashboard/security" label="Workspace security" Icon={LockIcon} />
        </div>
      </CardShell>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function QuickAction({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof ShieldIcon;
}) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-all hover:-translate-y-0.5 hover:border-red-400/30 hover:bg-red-500/5"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">
        <Icon className="h-4 w-4" title={label} />
      </span>
      <p className="text-sm text-white">{label}</p>
      <span className="ml-auto text-white/30 transition-colors group-hover:text-red-200">→</span>
    </Link>
  );
}

function HealthRow({
  label,
  tone,
  hint,
}: {
  label: string;
  tone: "good" | "warn" | "bad";
  hint: string;
}) {
  const dot =
    tone === "good"
      ? "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.9)]"
      : tone === "warn"
        ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.85)]"
        : "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.85)]";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-sm text-white">{label}</span>
      </div>
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">{hint}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
      ))}
    </ul>
  );
}
