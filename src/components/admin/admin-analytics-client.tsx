"use client";

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
  FilterChip,
  MetricTile,
  StatusPill,
} from "@/src/components/admin/admin-ui";
import { AnalyticsChart } from "@/src/components/analytics/analytics-chart";
import {
  ChartIcon,
  ServerIcon,
  ShieldIcon,
  TerminalIcon,
} from "@/src/components/ui/icons";
import {
  generateLiveBurst,
  generateLiveEvent,
  generateMultiSeries,
  generatePlatformMetrics,
  generateRegions,
  humanizeBytes,
  humanizeNumber,
  jitterRegions,
  RANGE_META,
  tickMultiSeries,
  type AnalyticsRange,
  type LiveEvent,
  type MultiSeries,
  type PlatformMetrics,
  type RegionMetrics,
} from "@/src/lib/analytics-simulator";
import {
  logLevel,
  logLevelClasses,
  logMessage,
  shortTime,
} from "@/src/lib/dashboard-format";

type LogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  event_type: string | null;
  level: string | null;
  severity: string | null;
  message: string | null;
  source: string | null;
  created_at: string | null;
};

type ProjectRow = {
  id: string;
  user_id: string | null;
  name: string | null;
  status: string | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  role: string | null;
  created_at: string | null;
};

type TenantRollup = {
  profile: ProfileRow;
  projects: number;
  deploysToday: number;
  bandwidthGB: number;
  status: "healthy" | "degraded" | "incident";
  incidents: number;
};

type IncidentSeverity = "info" | "warning" | "critical";

type IncidentSummary = {
  id: string;
  title: string;
  detail: string;
  severity: IncidentSeverity;
  region?: string;
  count?: number;
};

const RANGE_OPTIONS: AnalyticsRange[] = ["1h", "24h", "7d"];

export function AdminAnalyticsClient() {
  return (
    <AdminShell
      activeKey="analytics"
      eyebrow="// admin / analytics"
      title="Analytics Center"
      description="Platform-wide observability across every tenant, project and region."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx: _ctx }: { ctx: AdminContext }) {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [series, setSeries] = useState<MultiSeries>(() =>
    generateMultiSeries("24h"),
  );
  const [regions, setRegions] = useState<RegionMetrics[]>(() => generateRegions());
  const [platform, setPlatform] = useState<PlatformMetrics>(() =>
    generatePlatformMetrics(generateRegions()),
  );

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(() =>
    generateLiveBurst("admin", 14),
  );
  const [auditEvents, setAuditEvents] = useState<LogRow[]>([]);
  const [auditDisabled, setAuditDisabled] = useState(false);

  const loadData = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    const errs: string[] = [];

    const [profilesRes, projectsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, company, role, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("projects")
        .select("id, user_id, name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (profilesRes.error) errs.push(`profiles: ${profilesRes.error.message}`);
    if (projectsRes.error) errs.push(`projects: ${projectsRes.error.message}`);

    setProfiles((profilesRes.data ?? []) as ProfileRow[]);
    setProjects((projectsRes.data ?? []) as ProjectRow[]);
    setErrors(errs);

    if (mode === "initial") setLoading(false);
    else setRefreshing(false);
  }, []);

  const loadAudit = useCallback(async () => {
    if (auditDisabled) return;
    const res = await supabase
      .from("infrastructure_logs")
      .select(
        "id, user_id, project_id, event_type, level, severity, message, source, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(40);
    if (res.error) {
      const m = res.error.message.toLowerCase();
      if (
        m.includes("relation") ||
        m.includes("does not exist") ||
        m.includes("schema cache")
      ) {
        setAuditDisabled(true);
      }
      return;
    }
    setAuditEvents((res.data ?? []) as LogRow[]);
  }, [auditDisabled]);

  useEffect(() => {
    void loadData("initial");
    void loadAudit();
  }, [loadData, loadAudit]);

  // when range changes, regenerate full series
  useEffect(() => {
    setSeries(generateMultiSeries(range));
  }, [range]);

  // platform-wide live tick. We avoid putting `regions` in deps so the
  // interval doesn't restart on every jitter.
  useEffect(() => {
    const id = window.setInterval(() => {
      setRegions((prev) => {
        const next = jitterRegions(prev);
        // Re-derive platform metrics from the freshly jittered regions.
        setPlatform((p) =>
          generatePlatformMetrics(next, p.totalTenants, p.activeOperators),
        );
        return next;
      });
      setSeries((prev) => tickMultiSeries(prev, range));
      setLiveEvents((prev) => {
        const burst = 1 + Math.floor(Math.random() * 2);
        const stream = [...prev];
        for (let i = 0; i < burst; i += 1)
          stream.unshift(generateLiveEvent("admin"));
        return stream.slice(0, 100);
      });
    }, 3_400);
    return () => window.clearInterval(id);
  }, [range]);

  // periodic re-poll of audit + tenant data
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadAudit();
    }, 9_000);
    return () => window.clearInterval(id);
  }, [loadAudit]);

  // Recompute platform metrics with live counts when both load.
  const observed = useMemo(
    () => ({
      tenants: profiles.length,
      operators: profiles.filter((p) =>
        ["admin", "super_admin"].includes((p.role ?? "").toLowerCase()),
      ).length,
    }),
    [profiles],
  );

  useEffect(() => {
    setPlatform((prev) =>
      generatePlatformMetrics(regions, observed.tenants, observed.operators ||
        prev.activeOperators),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observed.tenants, observed.operators]);

  // tenant rollups
  const tenants = useMemo<TenantRollup[]>(() => {
    const projectsByOwner = new Map<string, ProjectRow[]>();
    for (const p of projects) {
      if (!p.user_id) continue;
      const arr = projectsByOwner.get(p.user_id) ?? [];
      arr.push(p);
      projectsByOwner.set(p.user_id, arr);
    }
    return profiles
      .map((p) => {
        const owned = projectsByOwner.get(p.id) ?? [];
        const incidents = Math.round(Math.random() * 2);
        const status: TenantRollup["status"] =
          incidents >= 2
            ? "incident"
            : owned.some((proj) =>
                  ["error", "failed"].includes((proj.status ?? "").toLowerCase()),
                )
              ? "degraded"
              : "healthy";
        return {
          profile: p,
          projects: owned.length,
          deploysToday: Math.round(Math.random() * Math.max(1, owned.length) * 4),
          bandwidthGB: Math.round((owned.length || 1) * (12 + Math.random() * 24)),
          status,
          incidents,
        };
      })
      .sort((a, b) => b.deploysToday - a.deploysToday)
      .slice(0, 50);
  }, [profiles, projects]);

  // critical incidents derived from regions + live events
  const criticalIncidents = useMemo<IncidentSummary[]>(() => {
    const out: IncidentSummary[] = [];
    for (const r of regions) {
      if (r.status === "outage") {
        out.push({
          id: `region-${r.code}-outage`,
          title: `Region outage · ${r.code}`,
          detail: `${r.city} is offline. Edge requests failing over to nearest healthy region.`,
          severity: "critical",
          region: r.code,
        });
      } else if (r.status === "degraded") {
        out.push({
          id: `region-${r.code}-degraded`,
          title: `Region degraded · ${r.code}`,
          detail: `Latency ${Math.round(r.latency)}ms · saturation ${Math.round(
            r.saturation,
          )}%.`,
          severity: "warning",
          region: r.code,
        });
      }
    }

    const failures = liveEvents.filter(
      (e) => e.level === "error" || e.type.includes("fail"),
    ).length;
    if (failures >= 3) {
      out.push({
        id: "deploy-fail-spike",
        title: "Deployment failure spike",
        detail: `${failures} failed deployment events in the live stream.`,
        severity: "warning",
        count: failures,
      });
    }

    const sslWarn = liveEvents.find((e) =>
      e.message.toLowerCase().includes("ssl"),
    );
    if (sslWarn && sslWarn.level !== "success") {
      out.push({
        id: "ssl-issue",
        title: "SSL anomaly",
        detail: sslWarn.message,
        severity: "warning",
      });
    }

    if (platform.failedDeployments24h > 12) {
      out.push({
        id: "deploy-24h",
        title: "High failure rate (24h)",
        detail: `${platform.failedDeployments24h} failed deployments in last 24 hours.`,
        severity: "warning",
        count: platform.failedDeployments24h,
      });
    }

    return out;
  }, [regions, liveEvents, platform.failedDeployments24h]);

  return (
    <div className="space-y-6">
      <AdminRlsWarning
        visible={errors.length > 0}
        message={errors.length > 0 ? errors.slice(0, 3).join(" · ") : undefined}
      />

      <CardShell
        eyebrow="// platform-metrics"
        title="Platform metrics"
        description="Operator-wide signal surface. Refreshes live."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker range={range} onChange={setRange} />
            <AdminButton
              onClick={() => void loadData("refresh")}
              busy={refreshing}
            >
              Refresh
            </AdminButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <MetricTile
            label="Tenants"
            value={loading ? "—" : humanizeNumber(platform.totalTenants)}
            hint="profiles"
          />
          <MetricTile
            label="Total deploys"
            value={humanizeNumber(platform.totalDeployments)}
            hint="lifetime"
          />
          <MetricTile
            label="Requests today"
            value={humanizeNumber(platform.totalRequestsToday)}
            hint="edge"
            tone="good"
          />
          <MetricTile
            label="Failed deploys"
            value={humanizeNumber(platform.failedDeployments24h)}
            hint="24h"
            tone={platform.failedDeployments24h > 12 ? "bad" : "default"}
          />
          <MetricTile
            label="Unhealthy regions"
            value={humanizeNumber(platform.unhealthyRegions)}
            tone={platform.unhealthyRegions > 0 ? "warn" : "good"}
          />
          <MetricTile
            label="Active operators"
            value={humanizeNumber(platform.activeOperators)}
            hint="admin / super"
          />
          <MetricTile
            label="Bandwidth"
            value={humanizeBytes(platform.bandwidthConsumedGB)}
            hint="last 24h"
          />
          <MetricTile
            label="Edge req/min"
            value={humanizeNumber(platform.edgeRpm)}
            hint="aggregated"
            tone="good"
          />
        </div>
      </CardShell>

      <CardShell
        eyebrow="// platform-graph"
        title="Global activity"
        description={`${RANGE_META[range].label} · ${RANGE_META[range].description}`}
        right={
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,1)]" />
            Streaming
          </span>
        }
      >
        <AnalyticsChart
          series={[
            {
              id: "requests",
              label: "Requests",
              tone: "basil",
              data: series.requests,
            },
            {
              id: "deployments",
              label: "Deployments",
              tone: "cyan",
              data: series.deployments,
              area: false,
            },
            {
              id: "failures",
              label: "Failures",
              tone: "amber",
              data: series.failures,
              area: false,
            },
            {
              id: "incidents",
              label: "Incidents",
              tone: "rose",
              data: series.incidents,
              area: false,
            },
          ]}
          height={340}
        />
      </CardShell>

      <CardShell
        eyebrow="// tenants"
        title={`Tenant activity (${tenants.length})`}
        description="Top tenants by deploy throughput. Live counts are simulated until per-tenant telemetry is wired."
        right={
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/65">
            <ShieldIcon className="h-3.5 w-3.5" title="Tenant rollup" />
            operator view
          </span>
        }
      >
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-8 text-center text-xs uppercase tracking-[0.24em] text-white/45">
            Loading tenant rollups…
          </div>
        ) : tenants.length === 0 ? (
          <EmptyState
            title="No tenants visible"
            description="If you expect tenants here, ensure admin RLS allows reading from public.profiles."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Tenant</th>
                    <th className="px-4 py-3 text-left font-medium">Projects</th>
                    <th className="px-4 py-3 text-left font-medium">Deploys today</th>
                    <th className="px-4 py-3 text-left font-medium">Bandwidth</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Incidents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tenants.map((t) => {
                    const role = (t.profile.role ?? "client").toLowerCase();
                    return (
                      <tr key={t.profile.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">
                            {t.profile.full_name ?? "—"}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {t.profile.email ?? t.profile.id}
                          </p>
                          {role !== "client" ? (
                            <span className="mt-1 inline-flex rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-red-200">
                              {role}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-white/80">
                          {t.projects}
                        </td>
                        <td className="px-4 py-3 font-mono text-white/80">
                          {t.deploysToday}
                        </td>
                        <td className="px-4 py-3 font-mono text-white/80">
                          {humanizeBytes(t.bandwidthGB)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={t.status}
                            tone={
                              t.status === "healthy"
                                ? "good"
                                : t.status === "degraded"
                                ? "warn"
                                : "bad"
                            }
                            pulse={t.status !== "healthy"}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-white/80">
                          {t.incidents}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardShell>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CardShell
          eyebrow="// incident-command"
          title="Incident command center"
          description="Critical anomalies and warnings derived from the live stream and region map."
          right={
            <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
              <ShieldIcon className="h-3.5 w-3.5" title="Incidents" />
              {criticalIncidents.length} active
            </span>
          }
        >
          {criticalIncidents.length === 0 ? (
            <EmptyState
              title="All systems nominal"
              description="No active incidents. The platform is operating within normal envelope."
            />
          ) : (
            <ul className="space-y-3">
              {criticalIncidents.map((i) => (
                <IncidentRow key={i.id} incident={i} />
              ))}
            </ul>
          )}
        </CardShell>

        <CardShell
          eyebrow="// audit-tail"
          title="Live audit stream"
          description="Real infrastructure_logs tail (admin)"
          right={
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">
              <TerminalIcon className="h-4 w-4" title="Audit" />
            </span>
          }
        >
          {auditDisabled ? (
            <EmptyState
              title="Audit table not available"
              description="Once public.infrastructure_logs exists, real events stream here. The simulator continues to drive the global feed."
            />
          ) : auditEvents.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/55 p-5 font-mono text-xs text-white/50">
              Tailing infrastructure_logs…
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
              <ul className="max-h-[360px] divide-y divide-white/5 overflow-y-auto">
                {auditEvents.map((log) => {
                  const styles = logLevelClasses(logLevel(log));
                  return (
                    <li
                      key={log.id}
                      className="grid grid-cols-[auto_auto_1fr] items-center gap-3 px-4 py-2"
                    >
                      <span className="text-white/35">
                        {shortTime(log.created_at)}
                      </span>
                      <span className={`min-w-[100px] truncate ${styles.label}`}>
                        {styles.tag}
                      </span>
                      <span className="truncate text-white/85">
                        {logMessage(log)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardShell>
      </div>

      <CardShell
        eyebrow="// region-wall"
        title="Region status wall"
        description="Realtime infrastructure wall · health, latency, online users, deploy load, edge saturation."
        right={
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">
            <ServerIcon className="h-4 w-4" title="Regions" />
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {regions.map((r) => (
            <RegionWallCard key={r.code} region={r} />
          ))}
        </div>
      </CardShell>

      <CardShell
        eyebrow="// global-stream"
        title="Global live feed"
        description="Combined synthetic and real telemetry across every tenant."
        right={
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">
            <ChartIcon className="h-4 w-4" title="Stream" />
          </span>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
          <ul className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
            {liveEvents.map((e) => {
              const styles = logLevelClasses(e.level);
              return (
                <li
                  key={e.id}
                  className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-2"
                  style={{ animation: "log-reveal 360ms ease-out both" }}
                >
                  <span className="text-white/35">{shortTime(e.t)}</span>
                  <span className={`min-w-[120px] truncate ${styles.label}`}>
                    [{e.type.toUpperCase()}]
                  </span>
                  <span className="truncate text-white/85">{e.message}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                    {e.source}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardShell>
    </div>
  );
}

function RangePicker({
  range,
  onChange,
}: {
  range: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {RANGE_OPTIONS.map((r) => (
        <FilterChip
          key={r}
          label={RANGE_META[r].label.replace("Last ", "")}
          active={range === r}
          onClick={() => onChange(r)}
        />
      ))}
    </div>
  );
}

function IncidentRow({ incident }: { incident: IncidentSummary }) {
  const tone =
    incident.severity === "critical"
      ? "bad"
      : incident.severity === "warning"
      ? "warn"
      : "info";
  const ring =
    incident.severity === "critical"
      ? "border-red-400/40 bg-red-500/10"
      : incident.severity === "warning"
      ? "border-amber-400/40 bg-amber-500/10"
      : "border-cyan-400/40 bg-cyan-500/10";
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${ring}`}
    >
      <div className="leading-tight">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={incident.severity} tone={tone} pulse />
          <p className="text-sm font-semibold text-white">{incident.title}</p>
        </div>
        <p className="mt-1 text-xs text-white/65">{incident.detail}</p>
      </div>
      {incident.region ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
          {incident.region}
        </span>
      ) : null}
    </li>
  );
}

function RegionWallCard({ region }: { region: RegionMetrics }) {
  const tone =
    region.status === "healthy"
      ? "border-basil-400/30 bg-basil-500/5"
      : region.status === "degraded"
      ? "border-amber-400/40 bg-amber-500/10"
      : "border-red-400/40 bg-red-500/10";
  const dot =
    region.status === "healthy"
      ? "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]"
      : region.status === "degraded"
      ? "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)] animate-pulse"
      : "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,1)] animate-pulse";

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-4 ${tone}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            {region.code}
          </p>
          <p className="text-sm font-semibold text-white">{region.city}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/75">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {region.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <Stat label="Health" value={`${Math.round(region.health)}%`} />
        <Stat
          label="Latency"
          value={region.status === "outage" ? "—" : `${Math.round(region.latency)}ms`}
        />
        <Stat
          label="Online"
          value={
            region.status === "outage" ? "—" : humanizeNumber(region.online)
          }
        />
        <Stat
          label="Deploy load"
          value={
            region.status === "outage"
              ? "—"
              : `${Math.round(region.deployLoad)}%`
          }
        />
      </div>
      <div className="mt-3">
        <p className="text-[9px] uppercase tracking-[0.18em] text-white/40">
          Edge saturation
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-basil-400 to-cyan-300 shadow-[0_0_10px_-2px_rgba(111,232,154,0.7)]"
            style={{ width: `${Math.round(region.saturation)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </p>
      <p className="font-mono text-white/85">{value}</p>
    </div>
  );
}
