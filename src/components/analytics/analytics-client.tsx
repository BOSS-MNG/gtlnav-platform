"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PreviewBanner } from "@/src/components/ui/preview-banner";
import { AnalyticsChart } from "@/src/components/analytics/analytics-chart";
import {
  ActivityIcon,
  ChartIcon,
  PulseIcon,
  ShieldIcon,
  TerminalIcon,
} from "@/src/components/ui/icons";
import {
  generateOverview,
  generatePerf,
  generateRegions,
  generateSeries,
  generateLiveBurst,
  generateLiveEvent,
  humanizeBytes,
  humanizeMs,
  humanizeNumber,
  humanizeSeconds,
  initialResources,
  jitterRegions,
  jitterResources,
  RANGE_META,
  tickSeries,
  type AnalyticsRange,
  type DeploymentPerf,
  type LiveEvent,
  type ProjectOverview,
  type RegionMetrics,
  type ResourceUsage,
  type SeriesPoint,
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

const INCIDENT_KEYWORDS = [
  "fail",
  "incident",
  "ssl",
  "dns",
  "deploy",
  "region",
  "webhook",
  "outage",
  "warn",
];

const REQUEST_OPTS = {
  baseline: 1_400,
  amplitude: 1_700,
  noise: 220,
  seed: 11,
} as const;

const BANDWIDTH_OPTS = {
  baseline: 60,
  amplitude: 90,
  noise: 14,
  seed: 23,
} as const;

export function AnalyticsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [range, setRange] = useState<AnalyticsRange>("24h");

  // simulator state
  const [requestSeries, setRequestSeries] = useState<SeriesPoint[]>(() =>
    generateSeries("24h", REQUEST_OPTS),
  );
  const [bandwidthSeries, setBandwidthSeries] = useState<SeriesPoint[]>(() =>
    generateSeries("24h", BANDWIDTH_OPTS),
  );
  const [regions, setRegions] = useState<RegionMetrics[]>(() =>
    generateRegions(),
  );
  const [resources, setResources] = useState<ResourceUsage>(() =>
    initialResources(),
  );
  const [perf, setPerf] = useState<DeploymentPerf>(() => generatePerf());
  const [overview, setOverview] = useState<ProjectOverview>(() =>
    generateOverview(generateRegions()),
  );

  // live stream
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(() =>
    generateLiveBurst("user", 10),
  );
  const [liveErrors, setLiveErrors] = useState<string | null>(null);

  // incidents (real or fallback)
  const [incidents, setIncidents] = useState<LogRow[]>([]);
  const [incidentsErr, setIncidentsErr] = useState<string | null>(null);

  const lastTickRef = useRef<number>(Date.now());

  // gate
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

  // when range changes, regenerate series
  useEffect(() => {
    setRequestSeries(generateSeries(range, REQUEST_OPTS));
    setBandwidthSeries(generateSeries(range, BANDWIDTH_OPTS));
  }, [range]);

  // load incidents from infrastructure_logs
  const loadIncidents = useCallback(async (uid: string) => {
    const res = await supabase
      .from("infrastructure_logs")
      .select(
        "id, user_id, project_id, event_type, level, severity, message, source, created_at",
      )
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (res.error) {
      const m = res.error.message.toLowerCase();
      if (
        m.includes("relation") ||
        m.includes("does not exist") ||
        m.includes("schema cache")
      ) {
        setIncidents([]);
        setIncidentsErr(null);
      } else {
        setIncidentsErr(res.error.message);
      }
      return;
    }
    const data = (res.data ?? []) as LogRow[];
    const filtered = data.filter((d) => {
      const haystack = `${d.event_type ?? ""} ${d.severity ?? ""} ${
        d.level ?? ""
      } ${d.message ?? ""}`.toLowerCase();
      return INCIDENT_KEYWORDS.some((k) => haystack.includes(k));
    });
    setIncidents(filtered.slice(0, 30));
    setIncidentsErr(null);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void loadIncidents(session.user.id);
  }, [session?.user?.id, loadIncidents]);

  // live tick: jitter regions/resources, append to chart, push live events
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

      setRegions((prev) => jitterRegions(prev));
      setResources((prev) => jitterResources(prev));

      // Append a new bucket every once in a while; otherwise just nudge.
      if (Math.random() < 0.55) {
        setRequestSeries((prev) => tickSeries(prev, range, REQUEST_OPTS));
        setBandwidthSeries((prev) => tickSeries(prev, range, BANDWIDTH_OPTS));
      }

      // Add 1-2 live events
      const burstCount = 1 + Math.floor(Math.random() * 2);
      setLiveEvents((prev) => {
        const next = [...prev];
        for (let i = 0; i < burstCount; i += 1) next.unshift(generateLiveEvent("user"));
        return next.slice(0, 60);
      });

      // Recompute overview occasionally
      if (dt > 6_000) {
        setOverview(generateOverview(regions));
        setPerf(generatePerf());
      }
    }, 3_400);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // tail latest infra logs into the live terminal too (so real events surface)
  useEffect(() => {
    if (!session?.user?.id) return;
    if (liveErrors) return;
    const uid = session.user.id;
    const id = window.setInterval(async () => {
      const res = await supabase
        .from("infrastructure_logs")
        .select(
          "id, user_id, project_id, event_type, level, severity, message, source, created_at",
        )
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(5);
      if (res.error) {
        const m = res.error.message.toLowerCase();
        if (
          m.includes("relation") ||
          m.includes("does not exist") ||
          m.includes("schema cache")
        ) {
          // Disable tail; simulator covers it.
          setLiveErrors("logs_table_missing");
        }
        return;
      }
      const data = (res.data ?? []) as LogRow[];
      if (data.length === 0) return;
      const events: LiveEvent[] = data.map((d) => ({
        id: d.id,
        t: d.created_at ?? new Date().toISOString(),
        type: d.event_type ?? "event",
        message: d.message ?? d.event_type ?? "Event",
        level:
          (d.severity as LiveEvent["level"]) ??
          (d.level as LiveEvent["level"]) ??
          "info",
        source: d.source ?? "infrastructure_logs",
      }));
      setLiveEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = events.filter((e) => !seen.has(e.id));
        if (fresh.length === 0) return prev;
        return [...fresh, ...prev].slice(0, 60);
      });
    }, 9_000);
    return () => window.clearInterval(id);
  }, [session?.user?.id, liveErrors]);

  const isLoading = session === undefined;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar
          activeKey="analytics"
          userEmail={session?.user?.email ?? null}
        />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <PreviewBanner title="Analytics — demo data only">
            Charts use a deterministic-but-simulated series. Real traffic
            ingest will land alongside the production runtime.
          </PreviewBanner>
          <Header range={range} onRange={setRange} />

          {isLoading ? (
            <div className="mt-10 grid place-items-center rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-xs uppercase tracking-[0.28em] text-white/55">
              Booting analytics core…
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-3">
                <ProjectOverviewSection overview={overview} regions={regions} />
              </div>

              <div className="xl:col-span-2">
                <RequestChartSection
                  range={range}
                  requestSeries={requestSeries}
                  bandwidthSeries={bandwidthSeries}
                />
              </div>

              <div>
                <DeploymentPerfSection perf={perf} />
              </div>

              <div className="xl:col-span-3">
                <RegionMonitoringSection regions={regions} />
              </div>

              <div className="xl:col-span-2">
                <ResourceUsageSection resources={resources} />
              </div>

              <div>
                <IncidentHistorySection
                  incidents={incidents}
                  err={incidentsErr}
                />
              </div>

              <div className="xl:col-span-3">
                <LiveStreamSection events={liveEvents} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// -------- ui pieces --------------------------------------------------------

function BackgroundFX() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 80% -10%, rgba(111,232,154,0.10) 0%, transparent 60%), radial-gradient(40% 40% at 10% 110%, rgba(111,232,154,0.06) 0%, transparent 70%), radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.025) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 75%)",
        }}
      />
    </>
  );
}

function Header({
  range,
  onRange,
}: {
  range: AnalyticsRange;
  onRange: (r: AnalyticsRange) => void;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200 shadow-[0_0_24px_-8px_rgba(111,232,154,0.7)]">
          <ActivityIcon className="h-5 w-5" title="Analytics" />
        </div>
        <div className="leading-tight">
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // analytics
          </p>
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">
            Monitoring &amp; analytics
          </h1>
          <p className="mt-1 text-xs text-white/55">
            Real-time observability across your projects, regions and edge
            traffic.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1">
          {(["1h", "24h", "7d"] as AnalyticsRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                range === r
                  ? "bg-basil-500/20 text-basil-100"
                  : "text-white/55 hover:text-white"
              }`}
            >
              {RANGE_META[r].label.replace("Last ", "")}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-basil-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,1)]" />
          Live
        </span>
      </div>
    </header>
  );
}

function ProjectOverviewSection({
  overview,
  regions,
}: {
  overview: ProjectOverview;
  regions: RegionMetrics[];
}) {
  const failingRegions = regions.filter((r) => r.status !== "healthy").length;
  return (
    <Card eyebrow="// project-overview" title="Project overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Total requests"
          value={humanizeNumber(overview.totalRequests)}
          hint="last 24h"
          tone="basil"
        />
        <Tile
          label="Success rate"
          value={`${overview.successRate.toFixed(2)}%`}
          hint="2xx + 3xx"
          tone={overview.successRate > 99 ? "basil" : "amber"}
        />
        <Tile
          label="Active regions"
          value={`${overview.activeRegions}/${regions.length}`}
          hint={`${failingRegions} need attention`}
          tone={failingRegions === 0 ? "basil" : "amber"}
        />
        <Tile
          label="Bandwidth"
          value={humanizeBytes(overview.bandwidthGB)}
          hint="last 24h"
        />
        <Tile
          label="Avg response"
          value={humanizeMs(overview.avgResponseMs)}
          hint="edge p50"
        />
        <Tile
          label="Uptime"
          value={`${overview.uptime.toFixed(2)}%`}
          hint="rolling 30d"
          tone={overview.uptime > 99.9 ? "basil" : "amber"}
        />
      </div>
    </Card>
  );
}

function RequestChartSection({
  range,
  requestSeries,
  bandwidthSeries,
}: {
  range: AnalyticsRange;
  requestSeries: SeriesPoint[];
  bandwidthSeries: SeriesPoint[];
}) {
  return (
    <Card
      eyebrow="// requests"
      title="Edge requests"
      description={`${RANGE_META[range].label} · ${RANGE_META[range].description}`}
      icon={<ChartIcon className="h-4 w-4" title="Chart" />}
    >
      <AnalyticsChart
        series={[
          {
            id: "req",
            label: "Requests",
            tone: "basil",
            data: requestSeries,
          },
          {
            id: "bw",
            label: "Bandwidth (MB)",
            tone: "cyan",
            data: bandwidthSeries,
            area: false,
          },
        ]}
        height={300}
      />
    </Card>
  );
}

function DeploymentPerfSection({ perf }: { perf: DeploymentPerf }) {
  return (
    <Card eyebrow="// deployments" title="Deployment performance">
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label="Avg build"
          value={humanizeSeconds(perf.avgBuildSec)}
          hint="last 24h"
        />
        <Tile
          label="Last deploy"
          value={humanizeSeconds(perf.lastDeploySec)}
          hint="duration"
          tone="basil"
        />
        <Tile
          label="Failed"
          value={String(perf.failed24h)}
          hint="last 24h"
          tone={perf.failed24h > 0 ? "amber" : "basil"}
        />
        <Tile
          label="Queue wait"
          value={humanizeSeconds(perf.queueWaitSec)}
          hint="median"
        />
      </div>
    </Card>
  );
}

function RegionMonitoringSection({ regions }: { regions: RegionMetrics[] }) {
  return (
    <Card
      eyebrow="// regions"
      title="Region monitoring"
      description="Per-region edge health, refreshed every few seconds."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {regions.map((r) => {
          const tone =
            r.status === "healthy"
              ? "border-basil-400/30 bg-basil-500/5"
              : r.status === "degraded"
              ? "border-amber-400/40 bg-amber-500/10"
              : "border-red-400/40 bg-red-500/10";
          const dot =
            r.status === "healthy"
              ? "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]"
              : r.status === "degraded"
              ? "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)] animate-pulse"
              : "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)] animate-pulse";
          return (
            <div
              key={r.code}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${tone}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                    {r.code}
                  </p>
                  <p className="text-sm font-semibold text-white">{r.city}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/75`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {r.status}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <dt className="uppercase tracking-[0.18em] text-white/40">
                    Latency
                  </dt>
                  <dd className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : `${Math.round(r.latency)}ms`}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.18em] text-white/40">
                    Health
                  </dt>
                  <dd className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : `${Math.round(r.health)}%`}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.18em] text-white/40">
                    Online
                  </dt>
                  <dd className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : humanizeNumber(r.online)}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.18em] text-white/40">
                    Req / min
                  </dt>
                  <dd className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : humanizeNumber(r.rpm)}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ResourceUsageSection({ resources }: { resources: ResourceUsage }) {
  return (
    <Card
      eyebrow="// resources"
      title="Resource usage"
      description="Smoothed compute/storage envelope."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Bar label="CPU" value={resources.cpu} tone="basil" />
        <Bar label="Memory" value={resources.memory} tone="cyan" />
        <Bar label="Bandwidth" value={resources.bandwidth} tone="violet" />
        <Bar label="Storage" value={resources.storage} tone="amber" />
        <Bar label="Edge" value={resources.edge} tone="basil" />
      </div>
    </Card>
  );
}

function IncidentHistorySection({
  incidents,
  err,
}: {
  incidents: LogRow[];
  err: string | null;
}) {
  return (
    <Card
      eyebrow="// incidents"
      title="Incident history"
      description="Recent failures, SSL & DNS events, region anomalies."
      icon={<ShieldIcon className="h-4 w-4" title="Incidents" />}
    >
      {err ? (
        <p className="text-xs text-amber-200">{err}</p>
      ) : null}
      {incidents.length === 0 ? (
        <Empty
          title="No recent incidents"
          description="When deployments fail, SSL renews or DNS propagates, the timeline lights up here."
        />
      ) : (
        <ol className="relative space-y-3 pl-4">
          <span
            aria-hidden
            className="absolute left-1 top-1 bottom-1 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent"
          />
          {incidents.map((log) => {
            const styles = logLevelClasses(logLevel(log));
            return (
              <li key={log.id} className="relative">
                <span
                  className={`absolute -left-[3px] top-1.5 h-2 w-2 rounded-full ${styles.dot}`}
                  aria-hidden
                />
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-[10px] uppercase tracking-[0.18em] ${styles.label}`}>
                      {log.event_type ?? styles.tag.replace(/[\[\]]/g, "")}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                      {shortTime(log.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/85">
                    {logMessage(log)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function LiveStreamSection({ events }: { events: LiveEvent[] }) {
  return (
    <Card
      eyebrow="// live-stream"
      title="Live infrastructure feed"
      description="Streaming events from your projects, simulated and real."
      icon={<TerminalIcon className="h-4 w-4" title="Terminal" />}
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
        <ul className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
          {events.map((e) => {
            const styles = logLevelClasses(e.level);
            return (
              <li
                key={e.id}
                className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-2"
                style={{ animation: "log-reveal 360ms ease-out both" }}
              >
                <span className="text-white/35">{shortTime(e.t)}</span>
                <span className={`min-w-[110px] truncate ${styles.label}`}>
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
      <p className="mt-3 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
        <PulseIcon className="h-3.5 w-3.5" />
        Streaming · ticks every ~3.4s
      </p>
    </Card>
  );
}

// -------- shared visuals ---------------------------------------------------

function Card({
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
      {(eyebrow || title) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h3 className="mt-1 text-base font-semibold tracking-tight text-white md:text-lg">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-xs text-white/55">
                {description}
              </p>
            ) : null}
          </div>
          {icon ? (
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10 text-basil-200">
              {icon}
            </span>
          ) : null}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "basil" | "amber" | "rose" | "cyan" | "violet" | "default";

function Tile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  const text =
    tone === "basil"
      ? "text-basil-200"
      : tone === "amber"
      ? "text-amber-200"
      : tone === "rose"
      ? "text-rose-200"
      : tone === "cyan"
      ? "text-cyan-200"
      : tone === "violet"
      ? "text-violet-200"
      : "text-white";
  const accent =
    tone === "basil"
      ? "from-basil-400/30"
      : tone === "amber"
      ? "from-amber-400/30"
      : tone === "rose"
      ? "from-rose-400/30"
      : tone === "cyan"
      ? "from-cyan-400/30"
      : tone === "violet"
      ? "from-violet-400/30"
      : "from-white/15";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accent} via-white/10 to-transparent`}
      />
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${text}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/40">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Bar({
  label,
  value,
  tone = "basil",
}: {
  label: string;
  value: number;
  tone?: Tone;
}) {
  const fill =
    tone === "basil"
      ? "from-basil-400 to-basil-300"
      : tone === "amber"
      ? "from-amber-400 to-amber-300"
      : tone === "cyan"
      ? "from-cyan-400 to-cyan-300"
      : tone === "violet"
      ? "from-violet-400 to-violet-300"
      : tone === "rose"
      ? "from-rose-400 to-rose-300"
      : "from-white/40 to-white/70";
  const tonal =
    tone === "basil"
      ? "text-basil-200"
      : tone === "amber"
      ? "text-amber-200"
      : tone === "cyan"
      ? "text-cyan-200"
      : tone === "violet"
      ? "text-violet-200"
      : tone === "rose"
      ? "text-rose-200"
      : "text-white";
  const pct = Math.round(value);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
          {label}
        </p>
        <p className={`text-sm font-semibold ${tonal}`}>{pct}%</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${fill} shadow-[0_0_18px_-2px_rgba(111,232,154,0.6)] transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Empty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
      <p className="text-sm font-medium text-white/85">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-white/50">{description}</p>
      ) : null}
    </div>
  );
}

