/**
 * GTLNAV — Usage Metering simulator + quota engine.
 *
 * The shapes here are designed so a real ingestion pipeline (edge logs,
 * deployment workers, Postgres aggregates) can later replace the generators
 * 1:1 without changing UI components.
 *
 * Tracked metrics (per workspace + per project):
 *   - bandwidth (GB)
 *   - requests (count)
 *   - deployments (count)
 *   - build_minutes (minutes)
 *   - storage (GB)
 *   - edge_usage (GB-equivalent of edge cache served)
 *   - domains (count)
 *   - seats (count)
 *   - api_requests (count)
 *   - webhook_triggers (count)
 *
 * Database integration foundation (architecture only — UI ships without
 * requiring these tables to exist):
 *   - public.usage_snapshots  (raw per-metric ticks for time-series)
 *   - public.workspace_usage  (rollups per workspace per period)
 *   - public.project_usage    (rollups per project per period)
 */

import {
  generateSeries,
  type AnalyticsRange,
  type SeriesPoint,
  tickSeries,
} from "@/src/lib/analytics-simulator";

// ---------------------------------------------------------------------------
//  Metric definitions
// ---------------------------------------------------------------------------

export const USAGE_METRICS = [
  "bandwidth",
  "requests",
  "deployments",
  "build_minutes",
  "storage",
  "edge_usage",
  "domains",
  "seats",
  "api_requests",
  "webhook_triggers",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export type UsageUnit = "gb" | "count" | "minutes";
export type UsageKind = "consumption" | "level";

export type UsageMetricMeta = {
  metric: UsageMetric;
  label: string;
  short: string;
  unit: UsageUnit;
  /**
   * `consumption` resets each billing period (bandwidth, requests, etc.).
   * `level` is a current state (active domains, seats, storage).
   */
  kind: UsageKind;
  /** Pricing-relevant flag — used by the future billing integration card. */
  metered: boolean;
  /** Tone used by charts and pressure pills. */
  tone: "basil" | "cyan" | "amber" | "rose" | "violet" | "white";
  description: string;
};

export const USAGE_METRIC_META: Record<UsageMetric, UsageMetricMeta> = {
  bandwidth: {
    metric: "bandwidth",
    label: "Bandwidth",
    short: "Bandwidth",
    unit: "gb",
    kind: "consumption",
    metered: true,
    tone: "basil",
    description: "GB transferred from the GTLNAV edge to clients.",
  },
  requests: {
    metric: "requests",
    label: "Requests",
    short: "Requests",
    unit: "count",
    kind: "consumption",
    metered: true,
    tone: "cyan",
    description: "HTTP requests served by GTLNAV edge nodes.",
  },
  deployments: {
    metric: "deployments",
    label: "Deployments",
    short: "Deploys",
    unit: "count",
    kind: "consumption",
    metered: false,
    tone: "violet",
    description: "Successful deployment runs through the runtime engine.",
  },
  build_minutes: {
    metric: "build_minutes",
    label: "Build minutes",
    short: "Build min",
    unit: "minutes",
    kind: "consumption",
    metered: true,
    tone: "amber",
    description: "Cumulative minutes consumed by build workers.",
  },
  storage: {
    metric: "storage",
    label: "Storage",
    short: "Storage",
    unit: "gb",
    kind: "level",
    metered: true,
    tone: "white",
    description: "Persistent storage used by artifacts and assets.",
  },
  edge_usage: {
    metric: "edge_usage",
    label: "Edge cache",
    short: "Edge",
    unit: "gb",
    kind: "consumption",
    metered: true,
    tone: "cyan",
    description: "Edge cache responses delivered (counts toward edge tier).",
  },
  domains: {
    metric: "domains",
    label: "Domains",
    short: "Domains",
    unit: "count",
    kind: "level",
    metered: false,
    tone: "basil",
    description: "Custom domains routed through GTLNAV.",
  },
  seats: {
    metric: "seats",
    label: "Seats",
    short: "Seats",
    unit: "count",
    kind: "level",
    metered: true,
    tone: "violet",
    description: "Workspace members occupying paid seats.",
  },
  api_requests: {
    metric: "api_requests",
    label: "API requests",
    short: "API",
    unit: "count",
    kind: "consumption",
    metered: true,
    tone: "amber",
    description: "Calls to the GTLNAV REST/RPC API surface.",
  },
  webhook_triggers: {
    metric: "webhook_triggers",
    label: "Webhook triggers",
    short: "Webhooks",
    unit: "count",
    kind: "consumption",
    metered: false,
    tone: "rose",
    description: "Inbound deploy hook fires accepted by GTLNAV.",
  },
};

// ---------------------------------------------------------------------------
//  Billing tiers
// ---------------------------------------------------------------------------

export type BillingTierId =
  | "free"
  | "starter"
  | "pro"
  | "business"
  | "enterprise";

export type Quotas = Record<UsageMetric, number>;

export type BillingTier = {
  id: BillingTierId;
  label: string;
  blurb: string;
  monthlyPriceUsd: number;
  /** Soft caps surfaced in the UI as "quota" or pressure indicators. */
  quotas: Quotas;
  /** Marketing-style highlights for the tier card (future billing UI). */
  highlights: string[];
};

export const BILLING_TIERS: Record<BillingTierId, BillingTier> = {
  free: {
    id: "free",
    label: "Free",
    blurb: "Hobby + experiments. No commercial use.",
    monthlyPriceUsd: 0,
    quotas: {
      bandwidth: 100, // GB
      requests: 1_000_000,
      deployments: 100,
      build_minutes: 600,
      storage: 5,
      edge_usage: 50,
      domains: 3,
      seats: 1,
      api_requests: 50_000,
      webhook_triggers: 5_000,
    },
    highlights: [
      "Personal workspace",
      "1 region",
      "GTLNAV-managed subdomain",
    ],
  },
  starter: {
    id: "starter",
    label: "Starter",
    blurb: "Small teams shipping production sites.",
    monthlyPriceUsd: 19,
    quotas: {
      bandwidth: 500,
      requests: 10_000_000,
      deployments: 600,
      build_minutes: 3_000,
      storage: 25,
      edge_usage: 250,
      domains: 25,
      seats: 5,
      api_requests: 500_000,
      webhook_triggers: 50_000,
    },
    highlights: [
      "5 paid seats",
      "Custom domains",
      "Edge analytics",
      "Branch deploys",
    ],
  },
  pro: {
    id: "pro",
    label: "Pro",
    blurb: "Production teams with realtime dashboards.",
    monthlyPriceUsd: 59,
    quotas: {
      bandwidth: 1_500,
      requests: 30_000_000,
      deployments: 1_500,
      build_minutes: 8_000,
      storage: 75,
      edge_usage: 750,
      domains: 75,
      seats: 12,
      api_requests: 1_500_000,
      webhook_triggers: 150_000,
    },
    highlights: [
      "12 paid seats",
      "Multi-region edge",
      "Realtime analytics",
      "Branch + PR previews",
    ],
  },
  business: {
    id: "business",
    label: "Business",
    blurb: "Agencies + multi-team production workloads.",
    monthlyPriceUsd: 199,
    quotas: {
      bandwidth: 5_000,
      requests: 100_000_000,
      deployments: 5_000,
      build_minutes: 25_000,
      storage: 250,
      edge_usage: 2_500,
      domains: 200,
      seats: 30,
      api_requests: 5_000_000,
      webhook_triggers: 500_000,
    },
    highlights: [
      "30 paid seats",
      "All regions",
      "Audit log retention",
      "SAML & SSO ready",
      "Priority operator support",
    ],
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    blurb: "GODTECHLABS-grade operator + custom SLAs.",
    monthlyPriceUsd: 749,
    quotas: {
      bandwidth: 50_000,
      requests: 1_000_000_000,
      deployments: 50_000,
      build_minutes: 250_000,
      storage: 2_500,
      edge_usage: 25_000,
      domains: 2_000,
      seats: 250,
      api_requests: 50_000_000,
      webhook_triggers: 5_000_000,
    },
    highlights: [
      "Dedicated VPS pools",
      "Custom SLAs",
      "Encryption-at-rest receipts",
      "Operator-grade audit",
    ],
  },
};

// ---------------------------------------------------------------------------
//  Snapshot + ratio helpers
// ---------------------------------------------------------------------------

export type UsageSnapshot = Record<UsageMetric, number>;

export type UsagePressure = "ok" | "watch" | "warn" | "critical";

export type UsageRatio = {
  metric: UsageMetric;
  used: number;
  quota: number;
  ratio: number;
  pressure: UsagePressure;
};

export function pressureFromRatio(ratio: number): UsagePressure {
  if (ratio >= 1) return "critical";
  if (ratio >= 0.85) return "warn";
  if (ratio >= 0.6) return "watch";
  return "ok";
}

export function computeRatios(
  snapshot: UsageSnapshot,
  quotas: Quotas,
): UsageRatio[] {
  return USAGE_METRICS.map((metric) => {
    const used = snapshot[metric] ?? 0;
    const quota = quotas[metric] || 1;
    const ratio = quota > 0 ? Math.max(0, used / quota) : 0;
    return {
      metric,
      used,
      quota,
      ratio,
      pressure: pressureFromRatio(ratio),
    };
  });
}

export function highestPressure(ratios: UsageRatio[]): UsagePressure {
  let worst: UsagePressure = "ok";
  for (const r of ratios) {
    if (
      r.pressure === "critical" ||
      (r.pressure === "warn" && worst !== "critical") ||
      (r.pressure === "watch" && worst !== "critical" && worst !== "warn")
    ) {
      worst = r.pressure;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
//  Time-series simulation
// ---------------------------------------------------------------------------

export type UsageTimeSeries = Record<UsageMetric, SeriesPoint[]>;

const DEFAULT_BASELINES: UsageSnapshot = {
  bandwidth: 0.6, // GB / hour
  requests: 5800, // per hour
  deployments: 0.4, // per hour
  build_minutes: 4, // minutes / hour
  storage: 0.05, // GB / hour delta (drift)
  edge_usage: 0.3, // GB / hour
  domains: 0.01,
  seats: 0.0,
  api_requests: 320,
  webhook_triggers: 12,
};

const DEFAULT_AMPLITUDES: UsageSnapshot = {
  bandwidth: 0.4,
  requests: 4200,
  deployments: 0.3,
  build_minutes: 3,
  storage: 0.04,
  edge_usage: 0.25,
  domains: 0.005,
  seats: 0,
  api_requests: 220,
  webhook_triggers: 8,
};

const DEFAULT_NOISE: UsageSnapshot = {
  bandwidth: 0.18,
  requests: 1800,
  deployments: 0.6,
  build_minutes: 2,
  storage: 0.02,
  edge_usage: 0.12,
  domains: 0.002,
  seats: 0,
  api_requests: 90,
  webhook_triggers: 6,
};

export type UsageSimOptions = {
  range: AnalyticsRange;
  /** Per-tenant scale factor — bigger workspaces use more. */
  scale?: number;
  /** Optional spike injection at a normalized x in [0,1]. */
  spikeAt?: { x: number; magnitude: number; metric: UsageMetric };
  /** Seed root for deterministic-ish jitter. */
  seed?: number;
};

export function generateUsageSeries(
  metric: UsageMetric,
  options: UsageSimOptions,
): SeriesPoint[] {
  const meta = USAGE_METRIC_META[metric];
  const scale = options.scale ?? 1;
  const seed = (options.seed ?? 0) + metricSeedOffset(metric);

  // For "level" metrics we still produce a series — but it drifts slowly
  // around a centerline (storage, domains) instead of bursting.
  const baseline = DEFAULT_BASELINES[metric] * scale;
  const amplitude =
    meta.kind === "level"
      ? DEFAULT_AMPLITUDES[metric] * scale * 0.3
      : DEFAULT_AMPLITUDES[metric] * scale;
  const noise = DEFAULT_NOISE[metric] * scale;

  const series = generateSeries(options.range, {
    baseline,
    amplitude,
    noise,
    seed,
  });

  if (options.spikeAt) {
    const idx = Math.floor(options.spikeAt.x * (series.length - 1));
    const target = series[idx];
    if (target && options.spikeAt.metric === metric) {
      const factor = options.spikeAt.magnitude;
      series[idx] = { ...target, value: target.value * factor };
      // soften the neighbors so the spike doesn't look like a bug
      if (idx > 0) {
        series[idx - 1] = {
          ...series[idx - 1],
          value: series[idx - 1].value * Math.max(1, factor * 0.55),
        };
      }
      if (idx < series.length - 1) {
        series[idx + 1] = {
          ...series[idx + 1],
          value: series[idx + 1].value * Math.max(1, factor * 0.4),
        };
      }
    }
  }

  return series.map((p) => ({ ...p, value: Math.max(0, p.value) }));
}

export function generateUsageTimeSeries(
  options: UsageSimOptions,
): UsageTimeSeries {
  const out = {} as UsageTimeSeries;
  for (const m of USAGE_METRICS) {
    out[m] = generateUsageSeries(m, options);
  }
  return out;
}

/**
 * Live-tick a previously-generated time series — pushes a fresh bucket onto
 * each metric using `tickSeries` semantics from the analytics simulator.
 */
export function tickUsageSeries(
  current: UsageTimeSeries,
  options: { range: AnalyticsRange; scale?: number },
): UsageTimeSeries {
  const scale = options.scale ?? 1;
  const next = {} as UsageTimeSeries;
  for (const m of USAGE_METRICS) {
    const baseline = DEFAULT_BASELINES[m] * scale;
    const amplitude = DEFAULT_AMPLITUDES[m] * scale;
    const noise = DEFAULT_NOISE[m] * scale;
    next[m] = tickSeries(current[m] ?? [], options.range, {
      baseline,
      amplitude,
      noise,
      seed: metricSeedOffset(m),
    });
  }
  return next;
}

/**
 * Sum a usage series over a window — used to convert hourly buckets into
 * monthly-style rollups for the period totals card.
 */
export function totalize(series: SeriesPoint[]): number {
  return series.reduce((acc, p) => acc + Math.max(0, p.value), 0);
}

// ---------------------------------------------------------------------------
//  Snapshot generators (workspaces + projects)
// ---------------------------------------------------------------------------

export type WorkspaceUsageRow = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  members: number;
  projects: number;
  tier: BillingTierId;
  snapshot: UsageSnapshot;
  ratios: UsageRatio[];
  pressure: UsagePressure;
};

export type ProjectUsageRow = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  framework: string;
  snapshot: UsageSnapshot;
  ratios: UsageRatio[];
  pressure: UsagePressure;
  trend: number; // +/- pct vs previous period
};

const FAKE_WORKSPACES: Array<Omit<WorkspaceUsageRow, "snapshot" | "ratios" | "pressure">> = [
  {
    id: "ws_godtechlabs",
    name: "GODTECHLABS",
    slug: "godtechlabs",
    ownerEmail: "ops@godtechlabs.com",
    members: 42,
    projects: 18,
    tier: "enterprise",
  },
  {
    id: "ws_basil_runtime",
    name: "Basil Runtime",
    slug: "basil-runtime",
    ownerEmail: "marcus@basil.run",
    members: 9,
    projects: 6,
    tier: "pro",
  },
  {
    id: "ws_kepler_studios",
    name: "Kepler Studios",
    slug: "kepler-studios",
    ownerEmail: "ada@kepler.dev",
    members: 12,
    projects: 7,
    tier: "business",
  },
  {
    id: "ws_orbital_grid",
    name: "Orbital Grid",
    slug: "orbital-grid",
    ownerEmail: "linus@orbital.io",
    members: 4,
    projects: 4,
    tier: "starter",
  },
  {
    id: "ws_dawn_machine",
    name: "Dawn Machine",
    slug: "dawn-machine",
    ownerEmail: "grace@dawn.dev",
    members: 3,
    projects: 3,
    tier: "starter",
  },
  {
    id: "ws_solo_marcus",
    name: "Marcus · Solo",
    slug: "marcus-solo",
    ownerEmail: "marcus@gtlnav.com",
    members: 1,
    projects: 2,
    tier: "free",
  },
];

const FAKE_PROJECTS: Array<Omit<ProjectUsageRow, "snapshot" | "ratios" | "pressure" | "trend">> = [
  { id: "p_atlas", name: "Atlas Edge", slug: "atlas-edge", workspaceId: "ws_godtechlabs", framework: "next" },
  { id: "p_pulse", name: "Pulse Console", slug: "pulse-console", workspaceId: "ws_godtechlabs", framework: "remix" },
  { id: "p_helios", name: "Helios CDN", slug: "helios-cdn", workspaceId: "ws_godtechlabs", framework: "static" },
  { id: "p_quasar", name: "Quasar Auth", slug: "quasar-auth", workspaceId: "ws_godtechlabs", framework: "next" },
  { id: "p_basil_studio", name: "Basil Studio", slug: "basil-studio", workspaceId: "ws_basil_runtime", framework: "next" },
  { id: "p_basil_api", name: "Basil API", slug: "basil-api", workspaceId: "ws_basil_runtime", framework: "node" },
  { id: "p_kepler_app", name: "Kepler App", slug: "kepler-app", workspaceId: "ws_kepler_studios", framework: "astro" },
  { id: "p_kepler_docs", name: "Kepler Docs", slug: "kepler-docs", workspaceId: "ws_kepler_studios", framework: "astro" },
  { id: "p_orbital_pwa", name: "Orbital PWA", slug: "orbital-pwa", workspaceId: "ws_orbital_grid", framework: "vite" },
  { id: "p_dawn_landing", name: "Dawn Landing", slug: "dawn-landing", workspaceId: "ws_dawn_machine", framework: "next" },
  { id: "p_marcus_blog", name: "Marcus · Blog", slug: "marcus-blog", workspaceId: "ws_solo_marcus", framework: "next" },
  { id: "p_marcus_lab", name: "Marcus · Lab", slug: "marcus-lab", workspaceId: "ws_solo_marcus", framework: "static" },
];

export type GenerateGlobalArgs = {
  /** Time range — bucket count comes from RANGE_META[range]. */
  range: AnalyticsRange;
  /** Apply a global spike injection (operator demo). */
  spike?: { metric: UsageMetric; magnitude: number };
  seed?: number;
};

export function generateWorkspaceRows(args: GenerateGlobalArgs): WorkspaceUsageRow[] {
  return FAKE_WORKSPACES.map((ws, idx) => {
    const tier = BILLING_TIERS[ws.tier];
    const series = generateUsageTimeSeries({
      range: args.range,
      scale: scaleForWorkspace(ws.tier, idx),
      seed: (args.seed ?? 0) + idx * 13,
      spikeAt: args.spike
        ? { x: 0.7, magnitude: args.spike.magnitude, metric: args.spike.metric }
        : undefined,
    });
    const snapshot = snapshotFromSeries(series, ws.members, ws.projects);
    const ratios = computeRatios(snapshot, tier.quotas);
    return {
      ...ws,
      snapshot,
      ratios,
      pressure: highestPressure(ratios),
    };
  });
}

export function generateProjectRows(args: GenerateGlobalArgs): ProjectUsageRow[] {
  return FAKE_PROJECTS.map((p, idx) => {
    const ws = FAKE_WORKSPACES.find((w) => w.id === p.workspaceId);
    const tier = ws ? BILLING_TIERS[ws.tier] : BILLING_TIERS.starter;
    const series = generateUsageTimeSeries({
      range: args.range,
      scale: scaleForProject(ws?.tier ?? "starter", idx),
      seed: (args.seed ?? 0) + 200 + idx * 7,
      spikeAt: args.spike
        ? { x: 0.55, magnitude: args.spike.magnitude * 0.7, metric: args.spike.metric }
        : undefined,
    });
    const snapshot = snapshotFromSeries(series, 1, 1);
    const ratios = computeRatios(snapshot, tier.quotas);
    const trend = (Math.sin(idx * 1.7) + Math.random() - 0.5) * 0.55;
    return {
      ...p,
      snapshot,
      ratios,
      pressure: highestPressure(ratios),
      trend,
    };
  });
}

function scaleForWorkspace(tier: BillingTierId, idx: number): number {
  const base =
    tier === "enterprise"
      ? 12
      : tier === "business"
        ? 6.5
        : tier === "pro"
          ? 3.2
          : tier === "starter"
            ? 1.2
            : 0.35;
  return base * (1 + (idx % 3) * 0.07);
}

function scaleForProject(tier: BillingTierId, idx: number): number {
  const base =
    tier === "enterprise"
      ? 4.5
      : tier === "business"
        ? 2.4
        : tier === "pro"
          ? 1.2
          : tier === "starter"
            ? 0.45
            : 0.18;
  return base * (1 + (idx % 5) * 0.05);
}

/**
 * Convert a per-metric time series into a single snapshot value used by the
 * cards/tables. Consumption metrics are summed; level metrics use the last
 * bucket value (or the configured count for domains/seats).
 */
export function snapshotFromSeries(
  series: UsageTimeSeries,
  members: number,
  projects: number,
): UsageSnapshot {
  const out = {} as UsageSnapshot;
  for (const metric of USAGE_METRICS) {
    const meta = USAGE_METRIC_META[metric];
    const data = series[metric] ?? [];
    if (metric === "seats") {
      out[metric] = members;
      continue;
    }
    if (metric === "domains") {
      out[metric] = Math.max(1, Math.round(projects * 1.4 + (data.at(-1)?.value ?? 0)));
      continue;
    }
    if (meta.kind === "level") {
      out[metric] = Math.max(0, data.at(-1)?.value ?? 0);
      continue;
    }
    out[metric] = totalize(data);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Live event stream (usage-flavored)
// ---------------------------------------------------------------------------

export type UsageEvent = {
  id: string;
  t: string;
  level: "info" | "warn" | "error" | "ok";
  source: "edge" | "build" | "api" | "billing" | "webhook" | "domain";
  message: string;
};

const USAGE_EVENT_TEMPLATES: Array<Omit<UsageEvent, "id" | "t">> = [
  { level: "ok", source: "edge", message: "edge cache hit ratio 92.4% (last 5m)" },
  { level: "info", source: "build", message: "build worker promoted: bld-3 (3.2 cores avail)" },
  { level: "warn", source: "edge", message: "bandwidth pressure 84% on workspace orbital-grid" },
  { level: "info", source: "api", message: "API tier ceiling at 71% — recommend Scale upgrade" },
  { level: "warn", source: "billing", message: "starter quota crossed 0.85 ratio for build_minutes" },
  { level: "info", source: "webhook", message: "deploy hook accepted from github / godtechlabs" },
  { level: "ok", source: "domain", message: "domain status reconciled: 3 verified, 0 pending" },
  { level: "error", source: "edge", message: "regional saturation alert · region eu-west-1" },
  { level: "info", source: "billing", message: "drafted invoice line: api_requests $0.00012/call" },
];

export function generateUsageEvent(): UsageEvent {
  const tpl =
    USAGE_EVENT_TEMPLATES[Math.floor(Math.random() * USAGE_EVENT_TEMPLATES.length)];
  return {
    ...tpl,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    t: new Date().toISOString(),
  };
}

export function generateUsageBurst(count = 8): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const ev = generateUsageEvent();
    out.push({
      ...ev,
      t: new Date(Date.now() - (count - i) * 700).toISOString(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Top-consumers helper
// ---------------------------------------------------------------------------

export function topConsumers<T extends { snapshot: UsageSnapshot }>(
  rows: T[],
  metric: UsageMetric,
  limit = 5,
): T[] {
  return rows
    .slice()
    .sort((a, b) => (b.snapshot[metric] ?? 0) - (a.snapshot[metric] ?? 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
//  Formatting helpers
// ---------------------------------------------------------------------------

export function formatUsageValue(metric: UsageMetric, value: number): string {
  const meta = USAGE_METRIC_META[metric];
  if (meta.unit === "gb") {
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)} TB`;
    if (value >= 1) return `${value.toFixed(1)} GB`;
    if (value >= 0.001) return `${(value * 1_000).toFixed(0)} MB`;
    return `${(value * 1_000_000).toFixed(0)} KB`;
  }
  if (meta.unit === "minutes") {
    if (value >= 60) return `${(value / 60).toFixed(1)} h`;
    return `${Math.round(value)} min`;
  }
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

export function formatRatio(ratio: number): string {
  return `${Math.round(Math.min(ratio, 1.5) * 100)}%`;
}

export function pressureLabel(p: UsagePressure): string {
  switch (p) {
    case "critical":
      return "Over quota";
    case "warn":
      return "Near limit";
    case "watch":
      return "Watching";
    default:
      return "Healthy";
  }
}

export function pressureClass(p: UsagePressure): {
  ring: string;
  text: string;
  dot: string;
} {
  switch (p) {
    case "critical":
      return {
        ring: "border-red-400/40 bg-red-500/15",
        text: "text-red-200",
        dot: "bg-red-300 shadow-[0_0_10px_rgba(248,113,113,1)]",
      };
    case "warn":
      return {
        ring: "border-amber-400/40 bg-amber-500/15",
        text: "text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)]",
      };
    case "watch":
      return {
        ring: "border-cyan-400/35 bg-cyan-500/10",
        text: "text-cyan-100",
        dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)]",
      };
    default:
      return {
        ring: "border-basil-400/35 bg-basil-500/10",
        text: "text-basil-100",
        dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]",
      };
  }
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

function metricSeedOffset(metric: UsageMetric): number {
  const idx = USAGE_METRICS.indexOf(metric);
  return (idx + 1) * 17;
}
