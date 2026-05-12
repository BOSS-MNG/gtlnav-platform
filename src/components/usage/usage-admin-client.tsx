"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminShell } from "@/src/components/admin/admin-shell";
import {
  AnalyticsChart,
  type ChartSeries,
} from "@/src/components/analytics/analytics-chart";
import { type AnalyticsRange } from "@/src/lib/analytics-simulator";
import {
  BILLING_TIERS,
  USAGE_METRICS,
  USAGE_METRIC_META,
  formatRatio,
  formatUsageValue,
  generateProjectRows,
  generateUsageBurst,
  generateUsageEvent,
  generateUsageTimeSeries,
  generateWorkspaceRows,
  highestPressure,
  pressureClass,
  pressureLabel,
  tickUsageSeries,
  topConsumers,
  type ProjectUsageRow,
  type UsageEvent,
  type UsageMetric,
  type UsageSnapshot,
  type UsageTimeSeries,
  type WorkspaceUsageRow,
} from "@/src/lib/usage-meter";

const RANGES: AnalyticsRange[] = ["1h", "24h", "7d"];

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7d",
};

const TONE_FOR_METRIC: Record<UsageMetric, ChartSeries["tone"]> = {
  bandwidth: "basil",
  requests: "cyan",
  deployments: "violet",
  build_minutes: "amber",
  storage: "white",
  edge_usage: "cyan",
  domains: "basil",
  seats: "violet",
  api_requests: "amber",
  webhook_triggers: "rose",
};

export default function UsageAdminClient() {
  return (
    <AdminShell
      activeKey="usage"
      eyebrow="// usage metering"
      title="Global usage wall"
      description="Live operator view of every workspace's bandwidth, requests, deployments, and quota pressure."
    >
      {() => <UsageAdminBody />}
    </AdminShell>
  );
}

function UsageAdminBody() {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [activeMetric, setActiveMetric] = useState<UsageMetric>("requests");
  const [spike, setSpike] = useState<{ metric: UsageMetric; magnitude: number } | null>(null);
  const [globalSeries, setGlobalSeries] = useState<UsageTimeSeries>(() =>
    generateUsageTimeSeries({ range: "24h", scale: 28 }),
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceUsageRow[]>(() =>
    generateWorkspaceRows({ range: "24h" }),
  );
  const [projects, setProjects] = useState<ProjectUsageRow[]>(() =>
    generateProjectRows({ range: "24h" }),
  );
  const [events, setEvents] = useState<UsageEvent[]>(() => generateUsageBurst(14));
  const tickRef = useRef<number | null>(null);

  // Regenerate when range changes (or when an operator injects a spike).
  useEffect(() => {
    setGlobalSeries(
      generateUsageTimeSeries({
        range,
        scale: 28,
        spikeAt: spike
          ? { x: 0.7, magnitude: spike.magnitude, metric: spike.metric }
          : undefined,
      }),
    );
    setWorkspaces(
      generateWorkspaceRows({
        range,
        spike: spike ?? undefined,
      }),
    );
    setProjects(
      generateProjectRows({
        range,
        spike: spike ?? undefined,
      }),
    );
  }, [range, spike]);

  // Live tick — push new data + audit-style events.
  useEffect(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      setGlobalSeries((prev) => tickUsageSeries(prev, { range, scale: 28 }));
      setEvents((prev) => [generateUsageEvent(), ...prev].slice(0, 80));
    }, 4000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [range]);

  const platformTotals = useMemo<UsageSnapshot>(() => {
    const out = {} as UsageSnapshot;
    for (const m of USAGE_METRICS) {
      out[m] = workspaces.reduce((acc, w) => acc + (w.snapshot[m] ?? 0), 0);
    }
    return out;
  }, [workspaces]);

  const platformPressure = useMemo(() => {
    const pressureCounts = workspaces.reduce(
      (acc, w) => {
        acc[w.pressure] += 1;
        return acc;
      },
      { ok: 0, watch: 0, warn: 0, critical: 0 } as Record<string, number>,
    );
    return pressureCounts;
  }, [workspaces]);

  const featuredSeries: ChartSeries[] = useMemo(() => {
    return [
      {
        id: "platform-active",
        label: USAGE_METRIC_META[activeMetric].label,
        tone: TONE_FOR_METRIC[activeMetric],
        data: globalSeries[activeMetric] ?? [],
        format: (v) => formatUsageValue(activeMetric, v),
      },
      {
        id: "platform-deploys",
        label: "Deployments",
        tone: "violet",
        area: false,
        data: globalSeries.deployments ?? [],
        format: (v) => formatUsageValue("deployments", v),
      },
    ];
  }, [activeMetric, globalSeries]);

  const topWorkspaces = topConsumers(workspaces, activeMetric, 6);
  const topProjects = topConsumers(projects, activeMetric, 6);

  const overallPressure = highestPressure(
    workspaces.flatMap((w) => w.ratios),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
            // operator wall
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
            Platform usage at a glance
          </h2>
          <p className="text-xs text-white/55">
            All workspaces, all metrics. Live tick · {RANGE_LABELS[range]} ·
            spike injection ready.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeSwitcher value={range} onChange={setRange} />
          <button
            type="button"
            onClick={() =>
              setSpike(
                spike
                  ? null
                  : { metric: activeMetric, magnitude: 4.5 },
              )
            }
            className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
              spike
                ? "border-red-400/40 bg-red-500/15 text-red-200"
                : "border-white/10 bg-white/[0.03] text-white/70 hover:border-red-400/30 hover:text-red-100"
            }`}
            title="Inject a synthetic usage spike to test alerting."
          >
            {spike ? `Spike · ${USAGE_METRIC_META[spike.metric].short} ×${spike.magnitude}` : "Inject spike"}
          </button>
        </div>
      </header>

      <PressureWall
        workspaces={workspaces.length}
        counts={platformPressure}
        overall={overallPressure}
      />

      <PlatformTotalsGrid totals={platformTotals} workspaceCount={workspaces.length} />

      <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <PlatformChartCard
          metric={activeMetric}
          setMetric={setActiveMetric}
          series={featuredSeries}
          totals={platformTotals}
          range={range}
        />
        <RegionPressureCard workspaces={workspaces} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TopConsumersCard
          title="Top workspaces"
          eyebrow="// top consumers · workspaces"
          rows={topWorkspaces}
          metric={activeMetric}
          renderRow={(row) => ({
            primary: row.name,
            secondary: `${row.ownerEmail} · ${BILLING_TIERS[row.tier].label} · ${row.members} seats`,
            value: formatUsageValue(activeMetric, row.snapshot[activeMetric] ?? 0),
            pressure: row.pressure,
          })}
        />
        <TopConsumersCard
          title="Top projects"
          eyebrow="// top consumers · projects"
          rows={topProjects}
          metric={activeMetric}
          renderRow={(row) => ({
            primary: row.name,
            secondary: `${row.framework} · trend ${(row.trend * 100).toFixed(0)}%`,
            value: formatUsageValue(activeMetric, row.snapshot[activeMetric] ?? 0),
            pressure: row.pressure,
          })}
        />
      </section>

      <WorkspaceTable rows={workspaces} metric={activeMetric} />

      <LiveAuditStream events={events} />

      <BillingForecastCard workspaces={workspaces} />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Subcomponents
// ---------------------------------------------------------------------------

function PressureWall({
  workspaces,
  counts,
  overall,
}: {
  workspaces: number;
  counts: Record<string, number>;
  overall: ReturnType<typeof highestPressure>;
}) {
  const pills: Array<{ key: string; label: string; tone: "ok" | "watch" | "warn" | "critical" }> = [
    { key: "ok", label: "Healthy", tone: "ok" },
    { key: "watch", label: "Watching", tone: "watch" },
    { key: "warn", label: "Near limit", tone: "warn" },
    { key: "critical", label: "Over quota", tone: "critical" },
  ];
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
        // platform pressure
      </span>
      <span className="text-xs text-white/55">
        {workspaces} workspaces · highest pressure {pressureLabel(overall)}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        {pills.map((p) => {
          const cls = pressureClass(p.tone);
          return (
            <span
              key={p.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${cls.ring} ${cls.text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
              {p.label}: {counts[p.key] ?? 0}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function PlatformTotalsGrid({
  totals,
  workspaceCount,
}: {
  totals: UsageSnapshot;
  workspaceCount: number;
}) {
  const featured: UsageMetric[] = [
    "bandwidth",
    "requests",
    "deployments",
    "build_minutes",
    "edge_usage",
    "api_requests",
    "webhook_triggers",
    "domains",
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
      {featured.map((metric) => {
        const meta = USAGE_METRIC_META[metric];
        return (
          <div
            key={metric}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-4 backdrop-blur-xl"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
              {meta.label}
            </p>
            <p className="mt-2 text-xl font-semibold text-white">
              {formatUsageValue(metric, totals[metric] ?? 0)}
            </p>
            <p className="mt-1 text-[11px] text-white/55">
              across {workspaceCount} workspaces
            </p>
          </div>
        );
      })}
    </section>
  );
}

function PlatformChartCard({
  metric,
  setMetric,
  series,
  totals,
  range,
}: {
  metric: UsageMetric;
  setMetric: (m: UsageMetric) => void;
  series: ChartSeries[];
  totals: UsageSnapshot;
  range: AnalyticsRange;
}) {
  const meta = USAGE_METRIC_META[metric];
  const total = totals[metric] ?? 0;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
            // platform realtime
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {meta.label} (all workspaces)
          </h2>
          <p className="mt-1 max-w-md text-xs text-white/55">{meta.description}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {USAGE_METRICS.map((m) => {
            const active = m === metric;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  active
                    ? "border-red-400/45 bg-red-500/15 text-red-100"
                    : "border-white/10 bg-white/[0.03] text-white/55 hover:border-red-400/30 hover:text-white"
                }`}
              >
                {USAGE_METRIC_META[m].short}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label={RANGE_LABELS[range]}
          value={formatUsageValue(metric, total)}
          hint="aggregated"
        />
        <Stat
          label="Deploys"
          value={formatUsageValue("deployments", totals.deployments ?? 0)}
          hint="across platform"
        />
        <Stat
          label="Build minutes"
          value={formatUsageValue("build_minutes", totals.build_minutes ?? 0)}
          hint="cumulative"
        />
      </div>
      <div className="mt-5">
        <AnalyticsChart series={series} height={280} emptyLabel="Awaiting data" />
      </div>
    </div>
  );
}

function RegionPressureCard({
  workspaces,
}: {
  workspaces: WorkspaceUsageRow[];
}) {
  // Synthesize "regions" from workspace pressures so the operator wall feels
  // dense without fabricating a parallel region simulator.
  const regions = ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1", "sa-east-1"];
  const data = regions.map((region, idx) => {
    const slice = workspaces.slice(idx, idx + 3).concat(workspaces[(idx * 2) % workspaces.length]);
    const pressure = highestPressure(slice.flatMap((w) => w.ratios));
    const bandwidth = slice.reduce((acc, w) => acc + (w.snapshot.bandwidth ?? 0), 0);
    return { region, pressure, bandwidth };
  });
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
        // regions
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Region pressure</h3>
      <p className="mt-1 text-xs text-white/55">
        Highest workspace pressure routed via the region.
      </p>
      <ul className="mt-4 space-y-2">
        {data.map((r) => {
          const cls = pressureClass(r.pressure);
          return (
            <li
              key={r.region}
              className={`flex items-center justify-between rounded-2xl border px-4 py-2 ${cls.ring}`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                <p className="text-sm font-mono uppercase tracking-[0.18em] text-white/85">
                  {r.region}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-white/55">
                <span>{formatUsageValue("bandwidth", r.bandwidth)}</span>
                <span className={cls.text}>{pressureLabel(r.pressure)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopConsumersCard<T extends { id: string; pressure: WorkspaceUsageRow["pressure"]; snapshot: UsageSnapshot }>({
  title,
  eyebrow,
  rows,
  metric,
  renderRow,
}: {
  title: string;
  eyebrow: string;
  rows: T[];
  metric: UsageMetric;
  renderRow: (row: T) => {
    primary: string;
    secondary: string;
    value: string;
    pressure: WorkspaceUsageRow["pressure"];
  };
}) {
  const max = Math.max(1, ...rows.map((r) => r.snapshot[metric] ?? 0));
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const display = renderRow(row);
          const cls = pressureClass(display.pressure);
          const value = row.snapshot[metric] ?? 0;
          const ratio = value / max;
          return (
            <li
              key={row.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {display.primary}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                    {display.secondary}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-mono ${cls.text}`}>{display.value}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${cls.ring} ${cls.text}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                    {pressureLabel(display.pressure)}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={`h-full rounded-full ${
                    display.pressure === "critical"
                      ? "bg-gradient-to-r from-red-300 via-red-400 to-red-500"
                      : display.pressure === "warn"
                        ? "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500"
                        : display.pressure === "watch"
                          ? "bg-gradient-to-r from-cyan-300 via-cyan-400 to-cyan-500"
                          : "bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500"
                  }`}
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WorkspaceTable({
  rows,
  metric,
}: {
  rows: WorkspaceUsageRow[];
  metric: UsageMetric;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
            // workspace breakdown
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">
            All workspaces
          </h3>
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
          sorted by {USAGE_METRIC_META[metric].short}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
            <tr>
              <th className="px-5 py-3">Workspace</th>
              <th className="px-3 py-3">Tier</th>
              <th className="px-3 py-3">Seats</th>
              <th className="px-3 py-3">Projects</th>
              <th className="px-3 py-3">Bandwidth</th>
              <th className="px-3 py-3">Requests</th>
              <th className="px-3 py-3">Build min</th>
              <th className="px-3 py-3">Edge</th>
              <th className="px-3 py-3">{USAGE_METRIC_META[metric].short}</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows
              .slice()
              .sort((a, b) => (b.snapshot[metric] ?? 0) - (a.snapshot[metric] ?? 0))
              .map((w) => {
                const cls = pressureClass(w.pressure);
                const tier = BILLING_TIERS[w.tier];
                const ratio = w.ratios.find((r) => r.metric === metric);
                return (
                  <tr key={w.id} className="text-white/85 hover:bg-white/[0.03]">
                    <td className="px-5 py-3 align-top">
                      <p className="font-medium text-white">{w.name}</p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                        {w.ownerEmail}
                      </p>
                    </td>
                    <td className="px-3 py-3">{tier.label}</td>
                    <td className="px-3 py-3">{w.members}</td>
                    <td className="px-3 py-3">{w.projects}</td>
                    <td className="px-3 py-3">
                      {formatUsageValue("bandwidth", w.snapshot.bandwidth ?? 0)}
                    </td>
                    <td className="px-3 py-3">
                      {formatUsageValue("requests", w.snapshot.requests ?? 0)}
                    </td>
                    <td className="px-3 py-3">
                      {formatUsageValue("build_minutes", w.snapshot.build_minutes ?? 0)}
                    </td>
                    <td className="px-3 py-3">
                      {formatUsageValue("edge_usage", w.snapshot.edge_usage ?? 0)}
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {formatUsageValue(metric, w.snapshot[metric] ?? 0)}
                      {ratio ? (
                        <span className="ml-1 text-[10px] text-white/40">
                          {formatRatio(ratio.ratio)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${cls.ring} ${cls.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                        {pressureLabel(w.pressure)}
                      </span>
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

function LiveAuditStream({ events }: { events: UsageEvent[] }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-black/60 p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
            // live audit
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">Usage event stream</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/35 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-red-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-300 shadow-[0_0_10px_rgba(248,113,113,1)]" />
          Operator stream
        </span>
      </div>
      <ul className="mt-4 max-h-72 space-y-1.5 overflow-y-auto font-mono text-[11px]">
        {events.length === 0 ? (
          <li className="text-white/45">awaiting events…</li>
        ) : (
          events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-3 border-b border-white/5 py-1.5 last:border-b-0"
            >
              <span className="w-20 shrink-0 text-white/40">
                {new Date(ev.t).toLocaleTimeString()}
              </span>
              <span
                className={`w-14 shrink-0 uppercase tracking-[0.18em] ${
                  ev.level === "error"
                    ? "text-red-300"
                    : ev.level === "warn"
                      ? "text-amber-300"
                      : ev.level === "ok"
                        ? "text-basil-200"
                        : "text-cyan-200"
                }`}
              >
                {ev.level}
              </span>
              <span className="w-20 shrink-0 uppercase tracking-[0.18em] text-white/45">
                {ev.source}
              </span>
              <span className="text-white/85">{ev.message}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function BillingForecastCard({ workspaces }: { workspaces: WorkspaceUsageRow[] }) {
  const subscription = workspaces.reduce(
    (acc, w) => acc + BILLING_TIERS[w.tier].monthlyPriceUsd,
    0,
  );
  // Crude metered surcharge — for every metric over quota, count $0.05 per
  // unit-over for the demo. Actual pricing slots into Stripe later.
  const surcharge = workspaces.reduce((acc, w) => {
    return (
      acc +
      w.ratios.reduce((sum, r) => {
        if (r.ratio <= 1) return sum;
        const over = Math.max(0, r.used - r.quota);
        return sum + Math.min(over * 0.05, 250);
      }, 0)
    );
  }, 0);
  const projected = subscription + surcharge;
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <Stat
        label="Subscription"
        value={`$${subscription.toFixed(0)}`}
        hint="recurring per month"
      />
      <Stat
        label="Metered surcharge"
        value={`$${surcharge.toFixed(2)}`}
        hint="period-to-date overages"
      />
      <Stat
        label="Projected MRR"
        value={`$${projected.toFixed(0)}`}
        hint="subscription + metered"
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Tiny components
// ---------------------------------------------------------------------------

function RangeSwitcher({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
      {RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
              active
                ? "bg-red-500/20 text-red-100"
                : "text-white/55 hover:text-white"
            }`}
          >
            {RANGE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      {hint ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

