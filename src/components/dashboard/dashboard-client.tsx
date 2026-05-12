"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import {
  ActivityIcon,
  BellIcon,
  CardIcon,
  GaugeIcon,
  GlobeIcon,
  LayersIcon,
  LockIcon,
  PlugIcon,
  ProjectsIcon,
  RocketIcon,
  ServerIcon,
  UsersIcon,
  WebhookIcon,
  ZapIcon,
} from "@/src/components/ui/icons";
import {
  deploymentStatusStyle,
  logLevelClasses,
  logMessage,
  logLevel,
  logTag,
  projectStatusStyle,
  relativeTime,
  shortTime,
} from "@/src/lib/dashboard-format";
import { providerLabel } from "@/src/lib/project-providers";
import { isInflightStatus } from "@/src/lib/deployment-simulator";
import { CreateProjectModal } from "./create-project-modal";
import { DashboardSidebar } from "./dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";

type ProfileRow = {
  id?: string;
  full_name?: string | null;
  email?: string | null;
};

type BillingProfileRow = {
  plan?: string | null;
  status?: string | null;
};

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

type DomainRow = {
  id: string;
  name?: string | null;
  domain?: string | null;
  status?: string | null;
};

type DeploymentRow = {
  id: string;
  project_id?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type InfraLogRow = {
  id: string;
  message?: string | null;
  level?: string | null;
  type?: string | null;
  event_type?: string | null;
  source?: string | null;
  created_at?: string | null;
};

type DashboardData = {
  profile: ProfileRow | null;
  billing: BillingProfileRow | null;
  projects: ProjectRow[];
  domains: DomainRow[];
  deployments: DeploymentRow[];
  logs: InfraLogRow[];
};

function displayName(user: User | null, profile: ProfileRow | null) {
  if (profile?.full_name && typeof profile.full_name === "string") {
    return profile.full_name;
  }
  if (!user) return "Operator";
  const meta = user.user_metadata as { full_name?: string } | undefined;
  if (meta?.full_name && typeof meta.full_name === "string") {
    return meta.full_name;
  }
  return user.email ?? "Operator";
}

async function loadDashboard(userId: string): Promise<{ data: DashboardData; errors: string[] }> {
  const errors: string[] = [];
  const [
    profileRes,
    billingRes,
    projectsRes,
    domainsRes,
    deploymentsRes,
    logsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("billing_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("domains").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("deployments").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    supabase.from("infrastructure_logs").select("*").order("created_at", { ascending: false }).limit(6),
  ]);

  if (profileRes.error) errors.push(`profiles: ${profileRes.error.message}`);
  if (billingRes.error) errors.push(`billing_profiles: ${billingRes.error.message}`);
  if (projectsRes.error) errors.push(`projects: ${projectsRes.error.message}`);
  if (domainsRes.error) errors.push(`domains: ${domainsRes.error.message}`);
  if (deploymentsRes.error) errors.push(`deployments: ${deploymentsRes.error.message}`);
  if (logsRes.error) errors.push(`infrastructure_logs: ${logsRes.error.message}`);

  return {
    data: {
      profile: (profileRes.data ?? null) as ProfileRow | null,
      billing: (billingRes.data ?? null) as BillingProfileRow | null,
      projects: (projectsRes.data ?? []) as ProjectRow[],
      domains: (domainsRes.data ?? []) as DomainRow[],
      deployments: (deploymentsRes.data ?? []) as DeploymentRow[],
      logs: (logsRes.data ?? []) as InfraLogRow[],
    },
    errors,
  };
}

export function DashboardClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

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
        const { data: result, errors } = await loadDashboard(userId);
        setData(result);
        setErrs(errors);
      } catch (err) {
        setErrs([err instanceof Error ? err.message : "Failed to load dashboard data."]);
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

  const remoteInflight = useMemo(() => {
    const projects = data?.projects ?? [];
    const deployments = data?.deployments ?? [];
    return (
      projects.some((p) => isInflightStatus(p.status)) ||
      deployments.some((d) => isInflightStatus(d.status))
    );
  }, [data?.projects, data?.deployments]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (!remoteInflight) return;
    const id = window.setInterval(() => {
      void refresh(userId, "refresh");
    }, 3000);
    return () => window.clearInterval(id);
  }, [session?.user?.id, remoteInflight, refresh]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

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

  const user = session.user;
  const userId = user.id;

  const projectsCount = data?.projects.length ?? 0;
  const domainsCount = data?.domains.length ?? 0;
  const deploymentsCount = data?.deployments.length ?? 0;
  const activeProjects =
    data?.projects.filter((p) => (p.status ?? "active").toLowerCase() === "active").length ?? 0;

  const recentProjects = (data?.projects ?? []).slice(0, 4);
  const recentDeployments = (data?.deployments ?? []).slice(0, 4);
  const recentLogs = data?.logs ?? [];

  const billingPlan = data?.billing?.plan ?? "Free Beta";
  const billingStatus = data?.billing?.status ?? "active";

  const onboardingDone = {
    project: projectsCount > 0,
    deploy: deploymentsCount > 0,
    domain: domainsCount > 0,
    integrate: false,
  };
  const onboardingProgress =
    Object.values(onboardingDone).filter(Boolean).length;

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/15 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[24rem] w-[24rem] rounded-full bg-basil-600/10 blur-[90px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar
          activeKey="overview"
          userEmail={user.email}
          billingPlan={billingPlan}
          billingStatus={billingStatus}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 space-y-6 p-4 sm:p-8">
            <PageHeader
              eyebrow="// dashboard"
              title={`Welcome back, ${displayName(user, data?.profile ?? null)}`}
              subtitle="Your GTLNAV control plane is live. Here's a snapshot of your platform."
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
                  >
                    ＋ New project
                  </button>
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
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10 disabled:opacity-50"
                  >
                    {loggingOut ? "Signing out…" : "Log out"}
                  </button>
                </>
              }
            />

            {errs.length > 0 ? (
              <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-medium">Some data couldn&apos;t load:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-200/90">
                  {errs.slice(0, 3).map((e) => (
                    <li key={e} className="font-mono text-[11px]">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Key metrics */}
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                title="Active projects"
                value={loading ? "…" : String(activeProjects)}
                hint={projectsCount === 0 ? "Spin up your first" : `${projectsCount} total`}
                href="/dashboard/projects"
              />
              <Metric
                title="Domains"
                value={loading ? "…" : String(domainsCount)}
                hint={domainsCount === 0 ? "Connect a domain" : "Connected"}
                href="/dashboard/domains"
              />
              <Metric
                title="Deployments"
                value={loading ? "…" : String(deploymentsCount)}
                hint={deploymentsCount === 0 ? "Ship from Git" : `Latest ${relativeTime(data?.deployments[0]?.created_at)}`}
                href="/dashboard/deployments"
              />
              <Metric
                title="Infrastructure"
                value="Operational"
                hint="All regions healthy"
                tone="good"
                href="/dashboard/infrastructure"
              />
            </section>

            {/* Onboarding checklist */}
            {onboardingProgress < 4 ? (
              <section className="overflow-hidden rounded-3xl border border-basil-400/20 bg-gradient-to-br from-basil-500/[0.06] via-white/[0.02] to-transparent p-5 backdrop-blur-2xl">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">// getting started</p>
                    <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">Onboarding checklist</h2>
                    <p className="mt-0.5 text-xs text-white/55">Knock these out to unlock the full GTLNAV control plane.</p>
                  </div>
                  <span className="rounded-full border border-basil-400/40 bg-basil-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-100">
                    {onboardingProgress}/4
                  </span>
                </div>
                <ul className="mt-4 grid gap-2 md:grid-cols-2">
                  <ChecklistItem
                    done={onboardingDone.project}
                    title="Create your first project"
                    description="Wire up a repository and pick a runtime."
                    cta={{ href: "/dashboard/projects", label: "Open projects" }}
                  />
                  <ChecklistItem
                    done={onboardingDone.deploy}
                    title="Trigger your first deployment"
                    description="Ship a build to GTLNAV edge in seconds."
                    cta={{ href: "/dashboard/deployments", label: "Open deployments" }}
                  />
                  <ChecklistItem
                    done={onboardingDone.domain}
                    title="Connect a custom domain"
                    description="Verify DNS, issue SSL, route traffic."
                    cta={{ href: "/dashboard/domains", label: "Open domains" }}
                  />
                  <ChecklistItem
                    done={onboardingDone.integrate}
                    title="Connect a Git provider"
                    description="GitHub, GitLab, Bitbucket — branch deploys included."
                    cta={{ href: "/dashboard/integrations", label: "Open integrations" }}
                  />
                </ul>
              </section>
            ) : null}

            {/* Quick actions */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">// quick actions</p>
              <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">Jump back in</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                <QuickAction href="/dashboard/projects" label="Projects" Icon={ProjectsIcon} />
                <QuickAction href="/dashboard/deployments" label="Deployments" Icon={RocketIcon} />
                <QuickAction href="/dashboard/runtime" label="Runtime" Icon={LayersIcon} />
                <QuickAction href="/dashboard/functions" label="Functions" Icon={ZapIcon} />
                <QuickAction href="/dashboard/domains" label="Domains" Icon={GlobeIcon} />
                <QuickAction href="/dashboard/analytics" label="Analytics" Icon={ActivityIcon} />
                <QuickAction href="/dashboard/team" label="Team" Icon={UsersIcon} />
                <QuickAction href="/dashboard/integrations" label="Integrations" Icon={PlugIcon} />
                <QuickAction href="/dashboard/webhooks" label="Webhooks" Icon={WebhookIcon} />
                <QuickAction href="/dashboard/usage" label="Usage" Icon={GaugeIcon} />
                <QuickAction href="/dashboard/billing" label="Billing" Icon={CardIcon} />
                <QuickAction href="/dashboard/security" label="Security" Icon={LockIcon} />
              </div>
            </section>

            {/* Recent projects + Recent deployments */}
            <section className="grid gap-4 lg:grid-cols-2">
              <Card
                eyebrow="// projects"
                title="Recent projects"
                action={{ href: "/dashboard/projects", label: "View all →" }}
              >
                {loading ? (
                  <SkeletonRows />
                ) : recentProjects.length === 0 ? (
                  <Empty
                    title="No projects yet"
                    description="Spin up your first project to deploy on GTLNAV."
                    actionLabel="＋ Create project"
                    onAction={() => setCreateOpen(true)}
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {recentProjects.map((p) => {
                      const style = projectStatusStyle(p.status);
                      return (
                        <li key={p.id}>
                          <Link
                            href={`/dashboard/projects/${p.id}`}
                            className="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:bg-white/[0.02]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{p.name ?? "Untitled"}</p>
                              <p className="mt-0.5 truncate font-mono text-[11px] text-basil-300/75">
                                {p.slug ? `/${p.slug}` : "—"}
                                {p.framework ? ` · ${p.framework}` : ""}
                                {p.provider ? ` · ${providerLabel(p.provider)}` : ""}
                              </p>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${style.ring}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                              <span className={style.text}>{p.status ?? "active"}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card
                eyebrow="// deployments"
                title="Recent deployments"
                action={{ href: "/dashboard/deployments", label: "View all →" }}
              >
                {loading ? (
                  <SkeletonRows />
                ) : recentDeployments.length === 0 ? (
                  <Empty
                    title="No deployments yet"
                    description="Trigger a deploy and you'll see live progress here."
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {recentDeployments.map((d) => {
                      const style = deploymentStatusStyle(d.status);
                      const project = data?.projects.find((p) => p.id === d.project_id);
                      return (
                        <li
                          key={d.id}
                          className="flex items-center justify-between gap-3 px-1 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {project?.name ?? "Project"}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-white/45">
                              {relativeTime(d.created_at)}
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
              </Card>
            </section>

            {/* Infrastructure health + activity */}
            <section className="grid gap-4 lg:grid-cols-3">
              <Card
                eyebrow="// infrastructure"
                title="Infrastructure health"
                action={{ href: "/dashboard/infrastructure", label: "Open console →" }}
              >
                <div className="space-y-2">
                  <HealthRow label="Edge runtime" tone="good" hint="All regions" />
                  <HealthRow label="Database" tone="good" hint="Primary + replicas" />
                  <HealthRow label="Object storage" tone="good" hint="3 buckets" />
                  <HealthRow label="DNS" tone="good" hint="Resolvers nominal" />
                </div>
              </Card>

              <Card
                eyebrow="// activity"
                title="Recent activity"
                action={{ href: "/dashboard/analytics", label: "Open analytics →" }}
                className="lg:col-span-2"
              >
                {loading ? (
                  <SkeletonRows />
                ) : recentLogs.length === 0 ? (
                  <Empty
                    title="No activity yet"
                    description="Events will appear here in real time as your platform operates."
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {recentLogs.slice(0, 6).map((log) => {
                      const cls = logLevelClasses(logLevel(log));
                      return (
                        <li
                          key={log.id}
                          className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2 font-mono text-[12px] text-white/85"
                        >
                          <span className="text-[11px] tabular-nums text-white/35">{shortTime(log.created_at)}</span>
                          <span className={`text-[10px] uppercase tracking-[0.18em] ${cls.label}`}>
                            {logTag(log)}
                          </span>
                          <span className="truncate">{logMessage(log)}</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                            {log.source ?? log.event_type ?? "event"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>
          </main>
        </div>
      </div>

      <CreateProjectModal
        open={createOpen}
        userId={userId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refresh(userId, "refresh")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

function Metric({
  title,
  value,
  hint,
  tone,
  href,
}: {
  title: string;
  value: string;
  hint: string;
  tone?: "good";
  href?: string;
}) {
  const Wrapper: React.ElementType = href ? Link : "div";
  const wrapperProps = href ? { href } : {};
  const valueClass =
    tone === "good"
      ? "bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent"
      : "text-white";
  return (
    <Wrapper
      {...wrapperProps}
      className="group relative block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-5 backdrop-blur-xl transition-all hover:border-basil-400/35"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">{title}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-white/40">{hint}</p>
    </Wrapper>
  );
}

function Card({
  eyebrow,
  title,
  action,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">{eyebrow}</p>
          <h2 className="mt-1 text-base font-semibold text-white sm:text-[15px]">{title}</h2>
        </div>
        {action ? (
          <Link
            href={action.href}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function QuickAction({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof ProjectsIcon;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm transition-all hover:-translate-y-0.5 hover:border-basil-400/40 hover:bg-basil-500/[0.06]"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-basil-400/30 bg-basil-500/10 text-basil-200">
        <Icon className="h-3.5 w-3.5" title={label} />
      </span>
      <span className="truncate text-white/85 group-hover:text-white">{label}</span>
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
        ? "bg-amber-300"
        : "bg-red-400";
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

function ChecklistItem({
  done,
  title,
  description,
  cta,
}: {
  done: boolean;
  title: string;
  description: string;
  cta: { href: string; label: string };
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${
              done
                ? "border-basil-400/40 bg-basil-500/10 text-basil-200"
                : "border-white/15 bg-white/[0.04] text-white/55"
            }`}
            aria-hidden
          >
            {done ? "✓" : ""}
          </span>
          <p
            className={`text-sm font-medium ${done ? "text-white/65 line-through" : "text-white"}`}
          >
            {title}
          </p>
        </div>
        <p className="ml-7 mt-0.5 text-[11px] text-white/50">{description}</p>
      </div>
      <Link
        href={cta.href}
        className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
      >
        {cta.label}
      </Link>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
      ))}
    </ul>
  );
}

function Empty({
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
