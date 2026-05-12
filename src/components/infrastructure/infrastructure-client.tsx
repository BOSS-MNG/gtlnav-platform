"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import {
  logLevel,
  logLevelClasses,
  logMessage,
  logTag,
  relativeTime,
  shortTime,
} from "@/src/lib/dashboard-format";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PreviewBanner } from "@/src/components/ui/preview-banner";

type RegionStatus = "operational" | "degraded" | "warning" | "down";

type Region = {
  id: string;
  code: string;
  name: string;
  flag: string;
  status: RegionStatus;
  nodes: number;
  cpu: number;
  memory: number;
  latency: number;
  traffic: number;
  lastCheck: string;
  position: { x: number; y: number };
};

type RegionDef = {
  id: string;
  code: string;
  name: string;
  flag: string;
  base: { nodes: number; lat: number; traffic: number };
  position: { x: number; y: number };
};

const REGION_DEFS: RegionDef[] = [
  {
    id: "us-east",
    code: "US-East",
    name: "Virginia",
    flag: "🇺🇸",
    base: { nodes: 24, lat: 12, traffic: 482 },
    position: { x: 0.27, y: 0.36 },
  },
  {
    id: "us-west",
    code: "US-West",
    name: "Oregon",
    flag: "🇺🇸",
    base: { nodes: 18, lat: 14, traffic: 384 },
    position: { x: 0.13, y: 0.4 },
  },
  {
    id: "ca",
    code: "Canada",
    name: "Toronto",
    flag: "🇨🇦",
    base: { nodes: 9, lat: 16, traffic: 142 },
    position: { x: 0.25, y: 0.28 },
  },
  {
    id: "eu-west",
    code: "Europe-West",
    name: "Frankfurt",
    flag: "🇪🇺",
    base: { nodes: 32, lat: 22, traffic: 614 },
    position: { x: 0.52, y: 0.32 },
  },
  {
    id: "carib",
    code: "Caribbean Edge",
    name: "Santo Domingo",
    flag: "🇩🇴",
    base: { nodes: 4, lat: 24, traffic: 36 },
    position: { x: 0.31, y: 0.55 },
  },
  {
    id: "sa",
    code: "South America",
    name: "São Paulo",
    flag: "🇧🇷",
    base: { nodes: 7, lat: 38, traffic: 98 },
    position: { x: 0.36, y: 0.74 },
  },
  {
    id: "af-west",
    code: "Africa-West",
    name: "Lagos",
    flag: "🇳🇬",
    base: { nodes: 6, lat: 44, traffic: 74 },
    position: { x: 0.52, y: 0.6 },
  },
];

type Incident = {
  id: string;
  title: string;
  scope: string;
  severity: "minor" | "info" | "major";
  resolvedAt: string;
  duration: string;
  summary: string;
};

const INCIDENTS: Incident[] = [
  {
    id: "inc-001",
    title: "DNS propagation delay",
    scope: "Caribbean Edge",
    severity: "minor",
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
    duration: "14m",
    summary:
      "Recursive resolvers in carib-1 took longer than baseline to propagate updated CNAME records. Cache flushed and TTLs lowered temporarily.",
  },
  {
    id: "inc-002",
    title: "Edge cold start spike",
    scope: "Africa-West",
    severity: "minor",
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    duration: "9m",
    summary:
      "Brief P99 latency increase during a regional traffic burst. Cold start mitigation pool expanded automatically.",
  },
  {
    id: "inc-003",
    title: "Storage sync warning",
    scope: "Europe-West",
    severity: "info",
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    duration: "23m",
    summary:
      "Write replication lag spiked on a single node. Replication lag normalized after node failover.",
  },
];

type LogRow = {
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

type Toast = { kind: "info" | "error"; text: string } | null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function jitter(range: number) {
  return (Math.random() - 0.5) * range;
}

function generateRegions(spike = false): Region[] {
  return REGION_DEFS.map((def) => {
    const cpuBase = 0.22 + Math.random() * 0.4 + (spike ? 0.05 : 0);
    const memBase = 0.32 + Math.random() * 0.32 + (spike ? 0.04 : 0);
    const cpu = clamp(cpuBase, 0.05, 0.94);
    const memory = clamp(memBase, 0.1, 0.94);
    const latency = Math.max(
      4,
      Math.round(def.base.lat + jitter(8) + (spike ? Math.random() * 6 : 0)),
    );
    const traffic = Math.max(
      8,
      Math.round(def.base.traffic + jitter(def.base.traffic * 0.25)),
    );
    let status: RegionStatus = "operational";
    if (cpu > 0.86 || memory > 0.86 || latency > 60) status = "warning";
    else if (cpu > 0.78 || memory > 0.78 || latency > 45) status = "degraded";
    return {
      id: def.id,
      code: def.code,
      name: def.name,
      flag: def.flag,
      status,
      nodes: def.base.nodes,
      cpu,
      memory,
      latency,
      traffic,
      lastCheck: new Date().toISOString(),
      position: def.position,
    };
  });
}

type GlobalMetrics = {
  cpuLoad: number;
  memory: number;
  netIn: number;
  netOut: number;
  reqRate: number;
  errRate: number;
};

function initialMetrics(): GlobalMetrics {
  return {
    cpuLoad: 0.34,
    memory: 0.46,
    netIn: 184,
    netOut: 142,
    reqRate: 12480,
    errRate: 0.0042,
  };
}

function jitterMetrics(prev: GlobalMetrics, spike: boolean): GlobalMetrics {
  const burst = spike ? 1.7 : 1;
  return {
    cpuLoad: clamp(prev.cpuLoad + jitter(0.07 * burst), 0.08, 0.93),
    memory: clamp(prev.memory + jitter(0.05 * burst), 0.18, 0.92),
    netIn: clamp(prev.netIn + jitter(28 * burst), 40, 800),
    netOut: clamp(prev.netOut + jitter(24 * burst), 30, 720),
    reqRate: Math.max(
      0,
      Math.round(prev.reqRate + jitter(1800 * burst)),
    ),
    errRate: clamp(prev.errRate + jitter(0.004 * burst), 0, 0.06),
  };
}

function regionStatusStyle(status: RegionStatus) {
  switch (status) {
    case "operational":
      return {
        dot: "bg-basil-300 shadow-[0_0_14px_rgba(111,232,154,1)]",
        text: "text-basil-200",
        ring: "border-basil-400/40 bg-basil-500/10",
        label: "OPERATIONAL",
      };
    case "degraded":
      return {
        dot: "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,1)] animate-pulse",
        text: "text-amber-200",
        ring: "border-amber-400/40 bg-amber-500/10",
        label: "DEGRADED",
      };
    case "warning":
      return {
        dot: "bg-orange-300 shadow-[0_0_14px_rgba(253,186,116,1)] animate-pulse",
        text: "text-orange-200",
        ring: "border-orange-400/40 bg-orange-500/10",
        label: "WARNING",
      };
    case "down":
      return {
        dot: "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,1)] animate-pulse",
        text: "text-red-200",
        ring: "border-red-400/40 bg-red-500/10",
        label: "DOWN",
      };
  }
}

function incidentSeverityStyle(severity: Incident["severity"]) {
  if (severity === "major") {
    return {
      dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,1)]",
      text: "text-red-200",
      ring: "border-red-400/40 bg-red-500/10",
      label: "MAJOR",
    };
  }
  if (severity === "minor") {
    return {
      dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)]",
      text: "text-amber-200",
      ring: "border-amber-400/40 bg-amber-500/10",
      label: "MINOR",
    };
  }
  return {
    dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]",
    text: "text-basil-200",
    ring: "border-basil-400/40 bg-basil-500/10",
    label: "INFO",
  };
}

async function loadInfrastructureLogs(userId: string): Promise<{
  logs: LogRow[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("infrastructure_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return { logs: [], error: error.message };
  }
  return { logs: (data ?? []) as LogRow[], error: null };
}

async function insertHealthCheckLog(
  userId: string,
  metadata: Record<string, unknown>,
) {
  const message = "Global infrastructure health check completed.";
  const fullPayload = {
    user_id: userId,
    project_id: null,
    event_type: "health_check",
    level: "success",
    severity: "success",
    message,
    source: "control_plane",
    metadata,
  };
  const { error } = await supabase
    .from("infrastructure_logs")
    .insert(fullPayload);
  if (!error) return null;

  const minimalPayload = {
    user_id: userId,
    event_type: "health_check",
    severity: "success",
    message,
  };
  const { error: fallbackError } = await supabase
    .from("infrastructure_logs")
    .insert(minimalPayload);
  return fallbackError?.message ?? null;
}

export function InfrastructureClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [regions, setRegions] = useState<Region[]>(() => generateRegions());
  const [metrics, setMetrics] = useState<GlobalMetrics>(() => initialMetrics());
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

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
    } = supabase.auth.onAuthStateChange((_event, next) => {
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

  const loadLogs = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLogsLoading(true);
      else setLogsRefreshing(true);
      try {
        const { logs: rows, error } = await loadInfrastructureLogs(userId);
        setLogs(rows);
        setLogsError(error);
      } finally {
        if (mode === "initial") setLogsLoading(false);
        else setLogsRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!session?.user?.id) return;
    void loadLogs(session.user.id, "initial");
  }, [session?.user?.id, loadLogs]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMetrics((prev) => jitterMetrics(prev, scanning));
      setRegions((prev) =>
        prev.map((r) => ({
          ...r,
          cpu: clamp(r.cpu + jitter(0.04 * (scanning ? 1.6 : 1)), 0.05, 0.94),
          memory: clamp(
            r.memory + jitter(0.03 * (scanning ? 1.4 : 1)),
            0.1,
            0.94,
          ),
          latency: Math.max(
            4,
            Math.round(r.latency + jitter(scanning ? 8 : 4)),
          ),
          traffic: Math.max(
            8,
            Math.round(r.traffic + jitter(r.traffic * 0.08)),
          ),
        })),
      );
    }, 1500);
    return () => window.clearInterval(id);
  }, [scanning]);

  const flashToast = useCallback(
    (kind: "info" | "error", text: string, ms = 4000) => {
      setToast({ kind, text });
      window.setTimeout(() => {
        setToast((current) => (current?.text === text ? null : current));
      }, ms);
    },
    [],
  );

  const handleHealthCheck = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (scanning) return;

    setScanning(true);
    setScanCount((n) => n + 1);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const next = generateRegions(false);
      setRegions(next);

      const operational = next.filter((r) => r.status === "operational").length;
      const degraded = next.filter((r) => r.status === "degraded").length;
      const warning = next.filter((r) => r.status === "warning").length;
      const avgLatency = Math.round(
        next.reduce((sum, r) => sum + r.latency, 0) / next.length,
      );
      const totalNodes = next.reduce((sum, r) => sum + r.nodes, 0);

      const insertError = await insertHealthCheckLog(userId, {
        regions: next.length,
        operational,
        degraded,
        warning,
        avg_latency_ms: avgLatency,
        total_nodes: totalNodes,
        scanned_at: new Date().toISOString(),
      });

      await loadLogs(userId, "refresh");

      if (insertError) {
        flashToast(
          "error",
          `Health check ran. Log insert failed: ${insertError}`,
        );
      } else {
        flashToast(
          "info",
          `Health check completed across ${next.length} regions · ${operational} operational`,
        );
      }
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Health check failed.",
      );
    } finally {
      setScanning(false);
    }
  }, [session?.user?.id, scanning, loadLogs, flashToast]);

  const overview = useMemo(() => {
    const operational = regions.filter((r) => r.status === "operational").length;
    const totalNodes = regions.reduce((sum, r) => sum + r.nodes, 0);
    const healthyNodes = regions
      .filter((r) => r.status === "operational")
      .reduce((sum, r) => sum + r.nodes, 0);
    const avgLatency = regions.length
      ? Math.round(
          regions.reduce((sum, r) => sum + r.latency, 0) / regions.length,
        )
      : 0;
    const totalTraffic = regions.reduce((sum, r) => sum + r.traffic, 0);
    const allHealthy = operational === regions.length;
    return {
      globalStatus: allHealthy ? "Operational" : "Partially degraded",
      uptime: "99.99%",
      activeRegions: `${operational} / ${regions.length}`,
      healthyNodes: `${healthyNodes} / ${totalNodes}`,
      avgLatency: `${avgLatency} ms`,
      throughput: `${(totalTraffic / 1000).toFixed(2)} GB/s`,
      allHealthy,
    };
  }, [regions]);

  if (session === undefined) {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (!session) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  const user = session.user;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar
          activeKey="infrastructure"
          userEmail={user.email}
        />

        <main className="flex-1 px-5 py-6 sm:px-8 sm:py-10">
          <PreviewBanner title="Infrastructure metrics — demo data only">
            Regions, capacity, and edge-node figures on this page are synthetic.
            Real telemetry will land when GTLNAV owns its own runtime fleet.
          </PreviewBanner>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // infrastructure
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Infrastructure console
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                Real-time view of every GTLNAV edge region, node, and stream
                running under your account.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] backdrop-blur-xl ${
                  overview.allHealthy
                    ? "border-basil-400/40 bg-basil-500/10 text-basil-200"
                    : "border-amber-400/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                      overview.allHealthy ? "bg-basil-400" : "bg-amber-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                      overview.allHealthy ? "bg-basil-300" : "bg-amber-300"
                    }`}
                  />
                </span>
                {overview.globalStatus}
              </span>
              <button
                type="button"
                onClick={() => void handleHealthCheck()}
                disabled={scanning}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-xs font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scanning ? "Scanning…" : "Run health check"}
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

          {/* Overview tiles */}
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <OverviewTile
              label="Global status"
              value={overview.globalStatus}
              accent={overview.allHealthy ? "basil" : "amber"}
              hint="Composite health"
            />
            <OverviewTile
              label="Uptime"
              value={overview.uptime}
              accent="basil"
              hint="Last 30 days"
            />
            <OverviewTile
              label="Active regions"
              value={overview.activeRegions}
              hint={`${REGION_DEFS.length} edge regions`}
            />
            <OverviewTile
              label="Healthy nodes"
              value={overview.healthyNodes}
              hint="Across mesh"
            />
            <OverviewTile
              label="Avg latency"
              value={overview.avgLatency}
              hint="P50 across regions"
            />
            <OverviewTile
              label="Throughput"
              value={overview.throughput}
              accent="basil"
              hint="Egress + ingress"
            />
          </section>

          {/* Region map */}
          <section className="mt-8">
            <SectionHeader
              eyebrow="// edge-mesh"
              title="Region map"
              subtitle="Live view of every GTLNAV point of presence"
              action={
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                  {scanning ? "scanning…" : "stable"}
                </span>
              }
            />
            <div className="mt-4">
              <RegionMap regions={regions} scanning={scanning} key={scanCount} />
            </div>
          </section>

          {/* Region cards */}
          <section className="mt-8">
            <SectionHeader
              eyebrow="// regions"
              title="Edge regions"
              subtitle="Per-region telemetry and last health probe"
            />
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {regions.map((r) => (
                <RegionCard key={r.id} region={r} />
              ))}
            </ul>
          </section>

          {/* Live metrics */}
          <section className="mt-8">
            <SectionHeader
              eyebrow="// telemetry"
              title="Live metrics"
              subtitle="Updated every 1.5s with simulated jitter"
              action={
                <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-[11px] text-basil-200 backdrop-blur-xl">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
                  </span>
                  Streaming
                </span>
              }
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricTile
                label="CPU load"
                value={`${(metrics.cpuLoad * 100).toFixed(1)}%`}
                ratio={metrics.cpuLoad}
                tone="basil"
              />
              <MetricTile
                label="Memory"
                value={`${(metrics.memory * 100).toFixed(1)}%`}
                ratio={metrics.memory}
                tone="cyan"
              />
              <MetricTile
                label="Net IN"
                value={`${metrics.netIn.toFixed(0)} MB/s`}
                ratio={Math.min(metrics.netIn / 800, 1)}
                tone="basil"
              />
              <MetricTile
                label="Net OUT"
                value={`${metrics.netOut.toFixed(0)} MB/s`}
                ratio={Math.min(metrics.netOut / 720, 1)}
                tone="amber"
              />
              <MetricTile
                label="Request rate"
                value={`${metrics.reqRate.toLocaleString()}/min`}
                ratio={Math.min(metrics.reqRate / 24000, 1)}
                tone="cyan"
              />
              <MetricTile
                label="Error rate"
                value={`${(metrics.errRate * 100).toFixed(2)}%`}
                ratio={Math.min(metrics.errRate / 0.06, 1)}
                tone={metrics.errRate > 0.02 ? "amber" : "basil"}
              />
            </div>
          </section>

          {/* Incidents + Logs */}
          <section className="mt-8 grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <IncidentsPanel />
            </div>
            <div className="lg:col-span-3">
              <SystemLogsPanel
                logs={logs}
                loading={logsLoading}
                refreshing={logsRefreshing}
                error={logsError}
                onRefresh={() => {
                  if (session?.user?.id) {
                    void loadLogs(session.user.id, "refresh");
                  }
                }}
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function OverviewTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "basil" | "amber";
}) {
  const valueClass =
    accent === "basil"
      ? "bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent"
      : accent === "amber"
        ? "text-amber-200"
        : "text-white";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-5 backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent opacity-60" />
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/45">
        {label}
      </p>
      <p
        className={`mt-2 text-xl font-semibold tracking-tight ${valueClass}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[10px] text-white/35">{hint}</p> : null}
    </div>
  );
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
      <div className="flex items-baseline justify-between gap-2">
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

function RegionMap({
  regions,
  scanning,
}: {
  regions: Region[];
  scanning: boolean;
}) {
  return (
    <div className="relative aspect-[2.4/1] overflow-hidden rounded-3xl border border-white/10 bg-black/60 shadow-[inset_0_0_80px_-30px_rgba(111,232,154,0.25)]">
      {/* Grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.45) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />

      {/* Latitude bands */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/4 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-basil-300/30 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-3/4 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />

      {/* Glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-basil-500/20 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-10 h-60 w-60 rounded-full bg-basil-600/15 blur-[90px]"
      />

      {/* Region pins */}
      {regions.map((r) => {
        const style = regionStatusStyle(r.status);
        return (
          <div
            key={r.id}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${r.position.x * 100}%`,
              top: `${r.position.y * 100}%`,
            }}
          >
            <span className="relative flex h-3 w-3">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                  r.status === "operational"
                    ? "bg-basil-400"
                    : r.status === "degraded"
                      ? "bg-amber-400"
                      : r.status === "warning"
                        ? "bg-orange-400"
                        : "bg-red-400"
                }`}
              />
              <span
                className={`relative inline-flex h-3 w-3 rounded-full ${style.dot}`}
              />
            </span>
            <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/65 backdrop-blur-xl">
              {r.code}
            </span>
          </div>
        );
      })}

      {/* Scanning sweep */}
      {scanning ? (
        <div
          aria-hidden
          className="absolute inset-y-0 w-1/3"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(111,232,154,0.0) 20%, rgba(111,232,154,0.6) 50%, rgba(111,232,154,0.0) 80%, transparent 100%)",
            animation: "var(--animate-map-scan)",
          }}
        />
      ) : null}

      {/* Header label */}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55 backdrop-blur-xl">
        <span className="font-mono normal-case tracking-normal text-basil-300/80">
          gtlnav://edge-mesh
        </span>
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55 backdrop-blur-xl">
        {regions.length} regions · {regions.filter((r) => r.status === "operational").length} healthy
      </div>
    </div>
  );
}

function RegionCard({ region }: { region: Region }) {
  const style = regionStatusStyle(region.status);
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-5 backdrop-blur-xl transition-colors hover:border-basil-400/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent opacity-50 transition-opacity group-hover:opacity-100" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base">
              {region.flag}
            </span>
            <p className="truncate text-sm font-semibold text-white">
              {region.code}
            </p>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-basil-300/80">
            {region.name}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] backdrop-blur-xl ${style.ring}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          <span className={style.text}>{style.label}</span>
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
        <RegionStat label="Nodes" value={String(region.nodes)} />
        <RegionStat label="Latency" value={`${region.latency} ms`} />
        <RegionStat label="Traffic" value={`${region.traffic} MB/s`} />
        <RegionStat label="Probe" value={relativeTime(region.lastCheck)} />
      </div>

      <div className="mt-4 space-y-2">
        <RegionBar label="CPU" ratio={region.cpu} tone="basil" />
        <RegionBar label="Memory" ratio={region.memory} tone="cyan" />
      </div>
    </li>
  );
}

function RegionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
      <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-white/40">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[12px] text-white/85">{value}</p>
    </div>
  );
}

function RegionBar({
  label,
  ratio,
  tone,
}: {
  label: string;
  ratio: number;
  tone: "basil" | "cyan";
}) {
  const fill =
    tone === "basil"
      ? "from-basil-400 to-basil-300"
      : "from-cyan-400 to-cyan-300";
  const glow =
    tone === "basil" ? "rgba(111,232,154,0.45)" : "rgba(103,232,249,0.45)";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/45">
        <span>{label}</span>
        <span className="font-mono text-white/70">
          {(ratio * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${fill} transition-all duration-700 ease-out`}
          style={{
            width: `${Math.max(4, Math.min(100, ratio * 100))}%`,
            boxShadow: `0 0 12px ${glow}`,
          }}
        />
      </div>
    </div>
  );
}

function IncidentsPanel() {
  const active = 0;
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // incidents
          </p>
          <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
            Incidents
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.22em] backdrop-blur-xl ${
            active === 0
              ? "border-basil-400/30 bg-basil-500/10 text-basil-200"
              : "border-amber-400/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]" />
          {active === 0 ? "No active incidents" : `${active} active`}
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <div className="rounded-2xl border border-basil-400/20 bg-basil-500/[0.04] px-4 py-3 text-sm text-basil-100">
          All systems are reporting healthy. Continuing to monitor.
        </div>

        <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.24em] text-white/45">
          Recently resolved
        </p>
        <ul className="mt-3 space-y-3">
          {INCIDENTS.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const sev = incidentSeverityStyle(incident.severity);
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl transition-colors hover:border-basil-400/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {incident.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-basil-300/80">
            {incident.scope}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${sev.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
            <span className={sev.text}>{sev.label}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-basil-400/30 bg-basil-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-200">
            <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]" />
            Resolved
          </span>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-white/55">
        {incident.summary}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
        <span>Duration · {incident.duration}</span>
        <span aria-hidden className="text-white/20">·</span>
        <span>Closed {relativeTime(incident.resolvedAt)}</span>
      </div>
    </li>
  );
}

function SystemLogsPanel({
  logs,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  logs: LogRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // system-logs
          </p>
          <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
            System logs
          </h2>
          <p className="mt-0.5 text-xs text-white/45">
            Latest infrastructure events for your account
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="p-3 sm:p-4">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 shadow-[inset_0_0_60px_-30px_rgba(111,232,154,0.25)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-white/45">
            <span className="flex items-center gap-2">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-basil-300/80" />
              </span>
              <span className="font-mono normal-case tracking-normal text-white/55">
                gtlnav://stream/system_logs
              </span>
            </span>
            <span className="font-mono normal-case tracking-normal text-basil-300/80">
              tail -f
            </span>
          </div>

          {error ? (
            <div className="px-4 py-3 text-sm text-red-200">{error}</div>
          ) : null}

          {loading ? (
            <div className="space-y-1.5 p-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-6 animate-pulse rounded-md bg-white/[0.04]"
                />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-white/55">
              No system events yet. Run a health check to populate the stream.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {logs.map((log) => (
                <SystemLogRow key={log.id} log={log} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemLogRow({ log }: { log: LogRow }) {
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

function FullPageMessage({ label }: { label: string }) {
  return (
    <div className="relative grid min-h-screen place-items-center bg-black text-white">
      <BackgroundFX />
      <div className="relative z-10 flex items-center gap-3 text-sm text-white/60">
        <span className="grid h-9 w-9 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
          <span className="block h-2 w-2 animate-pulse rounded-full bg-basil-300 shadow-[0_0_12px_rgba(111,232,154,1)]" />
        </span>
        {label}
      </div>
    </div>
  );
}

function BackgroundFX() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-basil-500/15 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-600/10 blur-[100px]" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/40 to-transparent" />
    </div>
  );
}
