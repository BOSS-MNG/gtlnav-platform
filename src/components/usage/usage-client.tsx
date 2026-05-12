"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import {
  AnalyticsChart,
  type ChartSeries,
} from "@/src/components/analytics/analytics-chart";
import { type AnalyticsRange } from "@/src/lib/analytics-simulator";
import {
  BILLING_TIERS,
  USAGE_METRICS,
  USAGE_METRIC_META,
  computeRatios,
  formatRatio,
  formatUsageValue,
  generateUsageBurst,
  generateUsageEvent,
  generateUsageTimeSeries,
  highestPressure,
  pressureClass,
  pressureLabel,
  tickUsageSeries,
  totalize,
  type BillingTier,
  type BillingTierId,
  type UsageEvent,
  type UsageMetric,
  type UsageRatio,
  type UsageSnapshot,
  type UsageTimeSeries,
} from "@/src/lib/usage-meter";
import { GaugeIcon } from "@/src/components/ui/icons";

type LoadState = "loading" | "ready" | "redirect";

type ProjectRow = {
  id: string;
  name: string | null;
  slug: string | null;
  framework: string | null;
};

type Toast = { tone: "success" | "error" | "info"; text: string } | null;

type ProjectUsageEntry = ProjectRow & {
  snapshot: UsageSnapshot;
};

const RANGES: AnalyticsRange[] = ["1h", "24h", "7d"];

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

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7d",
};

export default function UsageClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [tierId, setTierId] = useState<BillingTierId>("free");
  const [series, setSeries] = useState<UsageTimeSeries>(() =>
    generateUsageTimeSeries({ range: "24h", scale: 0.55 }),
  );
  const [activeMetric, setActiveMetric] = useState<UsageMetric>("requests");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectUsage, setProjectUsage] = useState<ProjectUsageEntry[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>(() => generateUsageBurst(10));
  const [toast, setToast] = useState<Toast>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tickRef = useRef<number | null>(null);

  const flashToast = useCallback((tone: NonNullable<Toast>["tone"], text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ------- Auth bootstrap ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const next = data.session ?? null;
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/usage");
        return;
      }
      setSession(next);
      await loadProjects(next.user.id);
      setLoadState("ready");
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (cancelled) return;
        if (!next) {
          setLoadState("redirect");
          router.replace("/login?next=/dashboard/usage");
          return;
        }
        setSession(next);
      },
    );
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ------- Project load --------------------------------------------------
  const loadProjects = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, slug, framework")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setProjects([]);
      return;
    }
    const rows = (data as ProjectRow[] | null) ?? [];
    setProjects(rows);
  }, []);

  // ------- Regenerate series when range changes --------------------------
  useEffect(() => {
    setSeries(
      generateUsageTimeSeries({
        range,
        scale: scaleFromTier(tierId) * 0.6,
      }),
    );
  }, [range, tierId]);

  // ------- Recompute project usage when projects change ------------------
  useEffect(() => {
    if (projects.length === 0) {
      setProjectUsage([]);
      return;
    }
    const entries: ProjectUsageEntry[] = projects.map((p, idx) => {
      const projSeries = generateUsageTimeSeries({
        range,
        scale: scaleFromTier(tierId) * (0.18 + (idx % 5) * 0.12),
        seed: idx * 23,
      });
      return {
        ...p,
        snapshot: snapshotFromSeries(projSeries),
      };
    });
    setProjectUsage(entries);
  }, [projects, range, tierId]);

  // ------- Live tick -----------------------------------------------------
  useEffect(() => {
    if (loadState !== "ready") return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      setSeries((prev) =>
        tickUsageSeries(prev, { range, scale: scaleFromTier(tierId) * 0.6 }),
      );
      setEvents((prev) => [generateUsageEvent(), ...prev].slice(0, 60));
    }, 4500);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [loadState, tierId, range]);

  // ------- Derived -------------------------------------------------------
  const tier: BillingTier = BILLING_TIERS[tierId];
  const snapshot = useMemo<UsageSnapshot>(() => snapshotFromSeries(series), [series]);
  const ratios = useMemo(
    () => computeRatios(snapshot, tier.quotas),
    [snapshot, tier.quotas],
  );
  const overall = highestPressure(ratios);
  const warnings = ratios.filter(
    (r) => r.pressure === "warn" || r.pressure === "critical",
  );
  const watching = ratios.filter((r) => r.pressure === "watch");
  const activeMeta = USAGE_METRIC_META[activeMetric];

  const featuredSeries: ChartSeries[] = useMemo(
    () => [
      {
        id: activeMetric,
        label: activeMeta.label,
        tone: TONE_FOR_METRIC[activeMetric],
        data: series[activeMetric] ?? [],
        format: (v) => formatUsageValue(activeMetric, v),
      },
    ],
    [activeMetric, activeMeta.label, series],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    await loadProjects(session.user.id);
    setSeries(
      generateUsageTimeSeries({
        range,
        scale: scaleFromTier(tierId) * 0.6,
      }),
    );
    setRefreshing(false);
    flashToast("info", "Usage refreshed.");
  }, [session, loadProjects, range, tierId, flashToast]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  if (loadState === "loading") {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (loadState === "redirect" || !session) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[60] max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
            toast.tone === "success"
              ? "border-basil-400/40 bg-basil-500/15 text-basil-50"
              : toast.tone === "error"
                ? "border-red-400/40 bg-red-500/15 text-red-100"
                : "border-white/15 bg-white/[0.08] text-white/90"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="usage" userEmail={session.user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // usage metering
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200">
                  <GaugeIcon className="h-5 w-5" title="Usage" />
                </span>
                Usage & quotas
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Track bandwidth, requests, deployments, build minutes,
                storage, and edge usage — across every project in your
                workspace. Quota math runs locally; live data wires in once
                metering pipes are turned on.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RangeSwitcher value={range} onChange={setRange} />
              <TierSwitcher value={tierId} onChange={setTierId} />
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          <PressureBanner overall={overall} warnings={warnings} watching={watching} />

          <SummaryGrid ratios={ratios} snapshot={snapshot} tier={tier} />

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <FeaturedChartCard
              metric={activeMetric}
              setMetric={setActiveMetric}
              series={featuredSeries}
              ratios={ratios}
              snapshot={snapshot}
              tier={tier}
              range={range}
            />
            <QuotaPanel ratios={ratios} tier={tier} />
          </section>

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ProjectBreakdownCard rows={projectUsage} metric={activeMetric} />
            <ResourcePressurePanel ratios={ratios} />
          </section>

          <BillingPreview tier={tier} ratios={ratios} onUpgrade={(id) => setTierId(id)} />

          <LiveStreamCard events={events} />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  UI subcomponents
// ---------------------------------------------------------------------------

function PressureBanner({
  overall,
  warnings,
  watching,
}: {
  overall: ReturnType<typeof highestPressure>;
  warnings: UsageRatio[];
  watching: UsageRatio[];
}) {
  if (overall === "ok") return null;
  const cls = pressureClass(overall);
  const label = pressureLabel(overall);
  return (
    <div
      className={`mt-6 flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl ${cls.ring}`}
    >
      <span
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${cls.dot}`}
      />
      <div className="min-w-0 text-sm">
        <p className={`font-medium ${cls.text}`}>{label} — review usage</p>
        <p className="mt-0.5 text-xs text-white/55">
          {warnings.length > 0
            ? warnings
                .map(
                  (r) =>
                    `${USAGE_METRIC_META[r.metric].label} ${formatRatio(r.ratio)}`,
                )
                .join(" · ")
            : watching
                .map(
                  (r) =>
                    `${USAGE_METRIC_META[r.metric].label} ${formatRatio(r.ratio)}`,
                )
                .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function SummaryGrid({
  ratios,
  snapshot,
  tier,
}: {
  ratios: UsageRatio[];
  snapshot: UsageSnapshot;
  tier: BillingTier;
}) {
  const featured: UsageMetric[] = [
    "bandwidth",
    "requests",
    "deployments",
    "build_minutes",
    "edge_usage",
    "storage",
  ];
  return (
    <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {featured.map((metric) => {
        const meta = USAGE_METRIC_META[metric];
        const r = ratios.find((x) => x.metric === metric);
        const cls = pressureClass(r?.pressure ?? "ok");
        return (
          <div
            key={metric}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-4 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
                {meta.short}
              </p>
              <span
                className={`inline-flex h-2 w-2 rounded-full ${cls.dot}`}
                aria-hidden
              />
            </div>
            <p className="mt-3 text-lg font-semibold text-white">
              {formatUsageValue(metric, snapshot[metric] ?? 0)}
            </p>
            <p className="mt-1 text-[11px] text-white/45">
              of {formatUsageValue(metric, tier.quotas[metric])} ·{" "}
              {formatRatio(r?.ratio ?? 0)}
            </p>
            <ProgressBar ratio={r?.ratio ?? 0} pressure={r?.pressure ?? "ok"} />
          </div>
        );
      })}
    </section>
  );
}

function FeaturedChartCard({
  metric,
  setMetric,
  series,
  ratios,
  snapshot,
  tier,
  range,
}: {
  metric: UsageMetric;
  setMetric: (m: UsageMetric) => void;
  series: ChartSeries[];
  ratios: UsageRatio[];
  snapshot: UsageSnapshot;
  tier: BillingTier;
  range: AnalyticsRange;
}) {
  const meta = USAGE_METRIC_META[metric];
  const r = ratios.find((x) => x.metric === metric);
  const cls = pressureClass(r?.pressure ?? "ok");
  const periodTotal = snapshot[metric] ?? 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // realtime
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">{meta.label}</h2>
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
                    ? "border-basil-400/50 bg-basil-500/15 text-basil-100"
                    : "border-white/10 bg-white/[0.03] text-white/55 hover:border-basil-400/30 hover:text-white"
                }`}
              >
                {USAGE_METRIC_META[m].short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className={`rounded-2xl border ${cls.ring} px-4 py-3`}>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/50">
            {RANGE_LABELS[range]}
          </p>
          <p className="mt-2 text-xl font-semibold text-white">
            {formatUsageValue(metric, periodTotal)}
          </p>
          <p className="mt-1 text-[11px] text-white/55">
            quota {formatUsageValue(metric, tier.quotas[metric])} ·{" "}
            <span className={cls.text}>{formatRatio(r?.ratio ?? 0)}</span>
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/50">
            Status
          </p>
          <p className="mt-2 text-sm font-semibold text-white">
            {pressureLabel(r?.pressure ?? "ok")}
          </p>
          <p className="mt-1 text-[11px] text-white/55">
            {r?.pressure === "ok"
              ? "Plenty of headroom on this tier."
              : r?.pressure === "watch"
                ? "Watching — climb continues, no action needed."
                : r?.pressure === "warn"
                  ? "Approaching quota — consider upgrade."
                  : "Over quota — billing meter engaged."}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/50">
            Tier
          </p>
          <p className="mt-2 text-sm font-semibold text-white">
            {tier.label} · ${tier.monthlyPriceUsd}/mo
          </p>
          <p className="mt-1 text-[11px] text-white/55">{tier.blurb}</p>
        </div>
      </div>

      <div className="mt-5">
        <AnalyticsChart series={series} height={260} emptyLabel="Awaiting data" />
      </div>
    </div>
  );
}

function QuotaPanel({
  ratios,
  tier,
}: {
  ratios: UsageRatio[];
  tier: BillingTier;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // quotas
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">{tier.label} tier</h3>
      <p className="mt-1 text-xs text-white/55">{tier.blurb}</p>

      <ul className="mt-5 space-y-3">
        {ratios.map((r) => {
          const meta = USAGE_METRIC_META[r.metric];
          const cls = pressureClass(r.pressure);
          return (
            <li key={r.metric} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">{meta.label}</p>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${cls.ring} ${cls.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                  {pressureLabel(r.pressure)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/55">
                <span>
                  {formatUsageValue(r.metric, r.used)} /
                  {" "}
                  {formatUsageValue(r.metric, r.quota)}
                </span>
                <span className={cls.text}>{formatRatio(r.ratio)}</span>
              </div>
              <ProgressBar ratio={r.ratio} pressure={r.pressure} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResourcePressurePanel({ ratios }: { ratios: UsageRatio[] }) {
  const sorted = ratios.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 5);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // resource pressure
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Top pressure</h3>
      <p className="mt-1 text-xs text-white/55">
        Highest ratio against current tier quota.
      </p>
      <ul className="mt-4 space-y-2">
        {sorted.map((r) => {
          const meta = USAGE_METRIC_META[r.metric];
          const cls = pressureClass(r.pressure);
          return (
            <li
              key={r.metric}
              className={`flex items-center justify-between rounded-2xl border px-3 py-2 ${cls.ring}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
                <p className={`text-sm font-medium ${cls.text}`}>{meta.label}</p>
              </div>
              <p className="font-mono text-xs text-white/70">{formatRatio(r.ratio)}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProjectBreakdownCard({
  rows,
  metric,
}: {
  rows: ProjectUsageEntry[];
  metric: UsageMetric;
}) {
  const meta = USAGE_METRIC_META[metric];
  const sorted = rows
    .slice()
    .sort((a, b) => (b.snapshot[metric] ?? 0) - (a.snapshot[metric] ?? 0));
  const max = Math.max(1, ...sorted.map((r) => r.snapshot[metric] ?? 0));
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // breakdown
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            {meta.label} by project
          </h3>
          <p className="mt-1 text-xs text-white/55">
            Top consumers in your workspace. Rebalance traffic or split into a
            new project if one consumer dominates.
          </p>
        </div>
        <Link
          href="/dashboard/projects"
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/65 transition-colors hover:border-basil-400/40 hover:text-white"
        >
          Projects →
        </Link>
      </div>
      {sorted.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/50">
          You don&apos;t have any projects yet — create one and usage will show
          here.
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {sorted.slice(0, 8).map((row) => {
            const value = row.snapshot[metric] ?? 0;
            const ratio = max > 0 ? value / max : 0;
            return (
              <li
                key={row.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/projects/${row.id}`}
                      className="block truncate text-sm font-medium text-white hover:text-basil-200"
                    >
                      {row.name ?? row.slug ?? "(unnamed)"}
                    </Link>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                      {row.framework ?? "framework: —"}
                    </p>
                  </div>
                  <p className="font-mono text-xs text-white/70">
                    {formatUsageValue(metric, value)}
                  </p>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-basil-300/70 via-basil-400/80 to-basil-500"
                    style={{ width: `${Math.max(2, ratio * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BillingPreview({
  tier,
  ratios,
  onUpgrade,
}: {
  tier: BillingTier;
  ratios: UsageRatio[];
  onUpgrade: (id: BillingTierId) => void;
}) {
  const tiers: BillingTierId[] = [
    "free",
    "starter",
    "pro",
    "business",
    "enterprise",
  ];
  const recommend = ratios.find(
    (r) => r.pressure === "warn" || r.pressure === "critical",
  );
  return (
    <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // billing preview
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Future billing integration
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-white/55">
            Each metered metric will become a Stripe usage record. Tiers below
            are wired to the same quota engine — switch to preview pressure on
            a different plan.
          </p>
        </div>
        {recommend ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,1)]" />
            Recommend upgrade · {USAGE_METRIC_META[recommend.metric].short}{" "}
            {formatRatio(recommend.ratio)}
          </span>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {tiers.map((id) => {
          const t = BILLING_TIERS[id];
          const active = id === tier.id;
          return (
            <div
              key={id}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${
                active
                  ? "border-basil-400/50 bg-basil-500/10"
                  : "border-white/10 bg-white/[0.03] hover:border-basil-400/30"
              }`}
            >
              {active ? (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-basil-400/40 bg-basil-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,1)]" />
                  Current
                </span>
              ) : null}
              <p className="text-sm font-semibold text-white">{t.label}</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                ${t.monthlyPriceUsd}/mo
              </p>
              <p className="mt-2 text-xs text-white/55">{t.blurb}</p>
              <ul className="mt-3 space-y-1.5 text-[11px] text-white/65">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-basil-300/80" />
                    {h}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onUpgrade(id)}
                disabled={active}
                className={`mt-4 w-full rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  active
                    ? "cursor-default border border-white/10 bg-white/[0.03] text-white/40"
                    : "border border-basil-400/40 bg-basil-500/15 text-basil-100 hover:border-basil-300/60 hover:bg-basil-400/20"
                }`}
              >
                {active ? "Currently selected" : "Preview tier"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LiveStreamCard({ events }: { events: UsageEvent[] }) {
  return (
    <section className="mt-10 rounded-3xl border border-white/10 bg-black/60 p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // live stream
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">Usage events</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-basil-400/35 bg-basil-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-basil-100">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]" />
          Streaming
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
              <span className="text-white/80">{ev.message}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Tiny components
// ---------------------------------------------------------------------------

function ProgressBar({
  ratio,
  pressure,
}: {
  ratio: number;
  pressure: UsageRatio["pressure"];
}) {
  const cls = pressureClass(pressure);
  const pct = Math.max(2, Math.min(1, ratio) * 100);
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
      <div
        className={`h-full rounded-full ${
          pressure === "critical"
            ? "bg-gradient-to-r from-red-300 via-red-400 to-red-500"
            : pressure === "warn"
              ? "bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500"
              : pressure === "watch"
                ? "bg-gradient-to-r from-cyan-300 via-cyan-400 to-cyan-500"
                : "bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500"
        } shadow-[0_0_12px_-3px_currentColor] ${cls.text}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

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
                ? "bg-basil-500/20 text-basil-100"
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

function TierSwitcher({
  value,
  onChange,
}: {
  value: BillingTierId;
  onChange: (next: BillingTierId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BillingTierId)}
      className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/80 hover:border-basil-400/40 focus:border-basil-400/50 focus:outline-none"
      title="Preview a tier's quotas"
    >
      <option value="free">Free</option>
      <option value="starter">Starter</option>
      <option value="pro">Pro</option>
      <option value="business">Business</option>
      <option value="enterprise">Enterprise</option>
    </select>
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

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function snapshotFromSeries(series: UsageTimeSeries): UsageSnapshot {
  const snap = {} as UsageSnapshot;
  for (const m of USAGE_METRICS) {
    const meta = USAGE_METRIC_META[m];
    const data = series[m] ?? [];
    if (m === "seats") {
      snap[m] = 1;
      continue;
    }
    if (m === "domains") {
      snap[m] = Math.max(1, Math.round((data.at(-1)?.value ?? 0) + 1));
      continue;
    }
    snap[m] = meta.kind === "level" ? data.at(-1)?.value ?? 0 : totalize(data);
  }
  return snap;
}

function scaleFromTier(t: BillingTierId): number {
  switch (t) {
    case "enterprise":
      return 4.5;
    case "business":
      return 2.6;
    case "pro":
      return 1.6;
    case "starter":
      return 1;
    default:
      return 0.45;
  }
}
