/**
 * GTLNAV analytics simulator.
 *
 * Produces deterministic-but-jittered data for the Monitoring & Analytics
 * Center. No external dependencies; everything is computed client-side.
 *
 * The shapes here are intentionally lightweight so that future real
 * telemetry sources (edge logs, Postgres, Prometheus, etc.) can replace the
 * generators 1:1 without changing UI components.
 */

// -------- ranges & helpers --------------------------------------------------

export type AnalyticsRange = "1h" | "24h" | "7d";

export type RangeMeta = {
  bucketMs: number;
  buckets: number;
  label: string;
  description: string;
};

export const RANGE_META: Record<AnalyticsRange, RangeMeta> = {
  "1h": {
    bucketMs: 60_000, // 1m
    buckets: 60,
    label: "Last hour",
    description: "1 min buckets",
  },
  "24h": {
    bucketMs: 60 * 60_000, // 1h
    buckets: 24,
    label: "Last 24 hours",
    description: "1 h buckets",
  },
  "7d": {
    bucketMs: 6 * 60 * 60_000, // 6h
    buckets: 28,
    label: "Last 7 days",
    description: "6 h buckets",
  },
};

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function jitter(value: number, range: number): number {
  return value + (Math.random() * 2 - 1) * range;
}

function smoothNoise(seed: number, t: number): number {
  // Cheap deterministic noise (fbm-ish) — combines two sin waves with the
  // bucket index, plus a tiny random component for organic feel.
  const a = Math.sin(t * 0.13 + seed) * 0.5;
  const b = Math.sin(t * 0.47 + seed * 1.7) * 0.3;
  const c = Math.sin(t * 1.03 + seed * 2.3) * 0.15;
  return a + b + c;
}

// -------- request series ---------------------------------------------------

export type SeriesPoint = {
  /** ISO timestamp at the *end* of the bucket. */
  t: string;
  /** Value at the bucket. */
  value: number;
};

export type SeriesOptions = {
  /** Average value across the range (before noise). */
  baseline: number;
  /** Peak amplitude added by daily/diurnal pattern. */
  amplitude: number;
  /** Random noise level around the curve. */
  noise: number;
  /** Optional integer seed so multiple series can stay aligned. */
  seed?: number;
};

/**
 * Generate a single time-series shaped by a soft diurnal curve + noise.
 * The series is anchored to "now" and walks backward in `bucketMs` steps.
 */
export function generateSeries(
  range: AnalyticsRange,
  opts: SeriesOptions,
): SeriesPoint[] {
  const meta = RANGE_META[range];
  const now = Date.now();
  const seed = opts.seed ?? 1;
  const out: SeriesPoint[] = [];

  for (let i = meta.buckets - 1; i >= 0; i -= 1) {
    const t = now - i * meta.bucketMs;
    // Diurnal-ish curve: more traffic during the day, less at night.
    const hour = new Date(t).getHours();
    const diurnal = Math.cos(((hour - 14) / 24) * Math.PI * 2) * -0.5 + 0.5;
    const wave = smoothNoise(seed, meta.buckets - i);
    const noisy = (Math.random() - 0.5) * opts.noise;
    const v =
      opts.baseline + diurnal * opts.amplitude + wave * opts.amplitude * 0.3 + noisy;
    out.push({ t: new Date(t).toISOString(), value: Math.max(0, v) });
  }
  return out;
}

/** Append a single new point to the end and drop the oldest, so charts can
 * tick live without recomputing the whole series. */
export function tickSeries(
  series: SeriesPoint[],
  range: AnalyticsRange,
  opts: SeriesOptions,
): SeriesPoint[] {
  const meta = RANGE_META[range];
  if (series.length === 0) return generateSeries(range, opts);
  const seed = opts.seed ?? 1;
  const last = series[series.length - 1];
  const t = new Date(last.t).getTime() + meta.bucketMs;
  const hour = new Date(t).getHours();
  const diurnal = Math.cos(((hour - 14) / 24) * Math.PI * 2) * -0.5 + 0.5;
  const wave = smoothNoise(seed, series.length + 1);
  const noisy = (Math.random() - 0.5) * opts.noise;
  const v =
    opts.baseline + diurnal * opts.amplitude + wave * opts.amplitude * 0.3 + noisy;
  return [
    ...series.slice(1),
    { t: new Date(t).toISOString(), value: Math.max(0, v) },
  ];
}

// -------- multi-series for admin -------------------------------------------

export type MultiSeries = {
  requests: SeriesPoint[];
  failures: SeriesPoint[];
  deployments: SeriesPoint[];
  incidents: SeriesPoint[];
};

export function generateMultiSeries(range: AnalyticsRange): MultiSeries {
  return {
    requests: generateSeries(range, {
      baseline: 18_000,
      amplitude: 14_000,
      noise: 2_400,
      seed: 17,
    }),
    failures: generateSeries(range, {
      baseline: 80,
      amplitude: 220,
      noise: 60,
      seed: 31,
    }),
    deployments: generateSeries(range, {
      baseline: 12,
      amplitude: 28,
      noise: 6,
      seed: 47,
    }),
    incidents: generateSeries(range, {
      baseline: 1.4,
      amplitude: 4.5,
      noise: 1.6,
      seed: 67,
    }),
  };
}

export function tickMultiSeries(
  prev: MultiSeries,
  range: AnalyticsRange,
): MultiSeries {
  return {
    requests: tickSeries(prev.requests, range, {
      baseline: 18_000,
      amplitude: 14_000,
      noise: 2_400,
      seed: 17,
    }),
    failures: tickSeries(prev.failures, range, {
      baseline: 80,
      amplitude: 220,
      noise: 60,
      seed: 31,
    }),
    deployments: tickSeries(prev.deployments, range, {
      baseline: 12,
      amplitude: 28,
      noise: 6,
      seed: 47,
    }),
    incidents: tickSeries(prev.incidents, range, {
      baseline: 1.4,
      amplitude: 4.5,
      noise: 1.6,
      seed: 67,
    }),
  };
}

// -------- regions ----------------------------------------------------------

export type RegionStatus = "healthy" | "degraded" | "outage";

export type RegionMetrics = {
  code: string;
  city: string;
  status: RegionStatus;
  /** Latency in ms. */
  latency: number;
  /** Compute load 0-100. */
  load: number;
  /** Edge saturation 0-100. */
  saturation: number;
  /** Health percentage 0-100. */
  health: number;
  /** Online users (synthetic). */
  online: number;
  /** Requests / min. */
  rpm: number;
  /** Deploy load 0-100. */
  deployLoad: number;
};

const REGION_SEED: Omit<
  RegionMetrics,
  "load" | "saturation" | "health" | "online" | "rpm" | "deployLoad"
>[] = [
  { code: "US-EAST", city: "Ashburn, VA", status: "healthy", latency: 18 },
  { code: "US-WEST", city: "Hillsboro, OR", status: "healthy", latency: 22 },
  { code: "US-CENTRAL", city: "Dallas, TX", status: "healthy", latency: 27 },
  { code: "EU-WEST", city: "Dublin, IE", status: "healthy", latency: 26 },
  { code: "EU-CENTRAL", city: "Frankfurt, DE", status: "healthy", latency: 24 },
  { code: "AP-SOUTH", city: "Singapore, SG", status: "degraded", latency: 84 },
  { code: "AP-NORTH", city: "Tokyo, JP", status: "healthy", latency: 31 },
  { code: "SA-EAST", city: "São Paulo, BR", status: "healthy", latency: 39 },
  { code: "AF-SOUTH", city: "Cape Town, ZA", status: "outage", latency: 0 },
];

export function generateRegions(): RegionMetrics[] {
  return REGION_SEED.map((r) => {
    if (r.status === "outage") {
      return {
        ...r,
        load: 0,
        saturation: 0,
        health: 0,
        online: 0,
        rpm: 0,
        deployLoad: 0,
      };
    }
    const baseLoad = r.status === "degraded" ? 78 : 38;
    const baseSat = r.status === "degraded" ? 72 : 48;
    const health = r.status === "degraded" ? 78 : clamp(98 - Math.random() * 2, 90, 100);
    return {
      ...r,
      load: clamp(baseLoad + Math.random() * 14, 0, 100),
      saturation: clamp(baseSat + Math.random() * 14, 0, 100),
      health,
      online: Math.round(800 + Math.random() * 4_200),
      rpm: Math.round(2_000 + Math.random() * 9_000),
      deployLoad: clamp(20 + Math.random() * 35, 0, 100),
    };
  });
}

export function jitterRegions(prev: RegionMetrics[]): RegionMetrics[] {
  return prev.map((r) => {
    if (r.status === "outage") return r;
    const delta = r.status === "degraded" ? 12 : 5;
    return {
      ...r,
      latency: clamp(r.latency + (Math.random() * 2 - 1) * delta, 5, 220),
      load: clamp(r.load + (Math.random() * 2 - 1) * 6, 0, 100),
      saturation: clamp(r.saturation + (Math.random() * 2 - 1) * 5, 0, 100),
      health: clamp(r.health + (Math.random() * 2 - 1) * 1.6, 0, 100),
      online: clamp(
        r.online + Math.round((Math.random() * 2 - 1) * 240),
        0,
        20_000,
      ),
      rpm: clamp(
        r.rpm + Math.round((Math.random() * 2 - 1) * 600),
        0,
        50_000,
      ),
      deployLoad: clamp(r.deployLoad + (Math.random() * 2 - 1) * 4, 0, 100),
    };
  });
}

// -------- resources --------------------------------------------------------

export type ResourceUsage = {
  cpu: number;
  memory: number;
  bandwidth: number;
  storage: number;
  edge: number;
};

export function initialResources(): ResourceUsage {
  return {
    cpu: clamp(35 + Math.random() * 12, 0, 100),
    memory: clamp(48 + Math.random() * 14, 0, 100),
    bandwidth: clamp(28 + Math.random() * 18, 0, 100),
    storage: clamp(41 + Math.random() * 8, 0, 100),
    edge: clamp(22 + Math.random() * 22, 0, 100),
  };
}

export function jitterResources(prev: ResourceUsage): ResourceUsage {
  return {
    cpu: clamp(prev.cpu + (Math.random() * 2 - 1) * 3.5, 5, 95),
    memory: clamp(prev.memory + (Math.random() * 2 - 1) * 1.8, 10, 95),
    bandwidth: clamp(prev.bandwidth + (Math.random() * 2 - 1) * 4, 0, 95),
    storage: clamp(prev.storage + (Math.random() * 2 - 1) * 0.4, 5, 99),
    edge: clamp(prev.edge + (Math.random() * 2 - 1) * 3, 0, 95),
  };
}

// -------- overview & performance -------------------------------------------

export type ProjectOverview = {
  totalRequests: number;
  successRate: number;
  activeRegions: number;
  bandwidthGB: number;
  avgResponseMs: number;
  uptime: number;
};

export function generateOverview(regions: RegionMetrics[]): ProjectOverview {
  const active = regions.filter((r) => r.status !== "outage").length;
  const totalRequests = regions.reduce((acc, r) => acc + r.rpm, 0) * 60 * 24;
  const avg =
    regions.reduce((acc, r) => acc + r.latency, 0) /
    Math.max(1, regions.length);
  return {
    totalRequests,
    successRate: clamp(99.4 - Math.random() * 0.4, 96, 100),
    activeRegions: active,
    bandwidthGB: Math.round(820 + Math.random() * 220),
    avgResponseMs: Math.round(avg + Math.random() * 8),
    uptime: clamp(99.9 - Math.random() * 0.05, 99, 100),
  };
}

export type DeploymentPerf = {
  avgBuildSec: number;
  lastDeploySec: number;
  failed24h: number;
  queueWaitSec: number;
};

export function generatePerf(): DeploymentPerf {
  return {
    avgBuildSec: Math.round(38 + Math.random() * 22),
    lastDeploySec: Math.round(31 + Math.random() * 28),
    failed24h: Math.round(Math.random() * 4),
    queueWaitSec: Math.round(2 + Math.random() * 12),
  };
}

// -------- platform metrics (admin) -----------------------------------------

export type PlatformMetrics = {
  totalTenants: number;
  totalDeployments: number;
  totalRequestsToday: number;
  failedDeployments24h: number;
  unhealthyRegions: number;
  activeOperators: number;
  bandwidthConsumedGB: number;
  edgeRpm: number;
};

export function generatePlatformMetrics(
  regions: RegionMetrics[],
  observedTenants?: number,
  observedOperators?: number,
): PlatformMetrics {
  const unhealthy = regions.filter((r) => r.status !== "healthy").length;
  const edgeRpm = regions.reduce((acc, r) => acc + r.rpm, 0);
  return {
    totalTenants: observedTenants ?? Math.round(820 + Math.random() * 60),
    totalDeployments: Math.round(15_000 + Math.random() * 2_400),
    totalRequestsToday: edgeRpm * 60 * 12,
    failedDeployments24h: Math.round(8 + Math.random() * 12),
    unhealthyRegions: unhealthy,
    activeOperators: observedOperators ?? Math.max(1, Math.round(2 + Math.random() * 6)),
    bandwidthConsumedGB: Math.round(48_000 + Math.random() * 12_000),
    edgeRpm,
  };
}

// -------- live event stream ------------------------------------------------

export type LiveEvent = {
  id: string;
  t: string;
  type: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
  source: string;
};

const USER_EVENT_TEMPLATES: Omit<LiveEvent, "id" | "t">[] = [
  {
    type: "deployment_started",
    message: "Deployment kicked off · main@${commit}",
    level: "info",
    source: "deploy_engine",
  },
  {
    type: "deployment_completed",
    message: "Deployment completed in ${dur}s",
    level: "success",
    source: "deploy_engine",
  },
  {
    type: "ssl_issued",
    message: "SSL certificate issued for ${domain}",
    level: "success",
    source: "ssl",
  },
  {
    type: "dns_verified",
    message: "DNS verified for ${domain}",
    level: "success",
    source: "dns",
  },
  {
    type: "webhook_received",
    message: "Deploy hook fired from origin ${origin}",
    level: "info",
    source: "hooks",
  },
  {
    type: "api_key_created",
    message: "API key generated · prefix ${prefix}",
    level: "info",
    source: "api_keys",
  },
  {
    type: "edge_cache_invalidated",
    message: "Edge cache purged in ${region}",
    level: "info",
    source: "edge",
  },
  {
    type: "rate_limit_warn",
    message: "Rate limit at 80% on ${region}",
    level: "warning",
    source: "edge",
  },
  {
    type: "build_optimized",
    message: "Build cache warm hit · ${pct}% reuse",
    level: "info",
    source: "build",
  },
];

const ADMIN_EVENT_TEMPLATES: Omit<LiveEvent, "id" | "t">[] = [
  ...USER_EVENT_TEMPLATES,
  {
    type: "tenant_signup",
    message: "New tenant onboarded · ${email}",
    level: "info",
    source: "auth",
  },
  {
    type: "incident_opened",
    message: "Incident opened · ${region} latency >150ms",
    level: "warning",
    source: "incident",
  },
  {
    type: "incident_resolved",
    message: "Incident resolved · ${region} back to nominal",
    level: "success",
    source: "incident",
  },
  {
    type: "region_degraded",
    message: "Region ${region} flagged degraded",
    level: "warning",
    source: "edge",
  },
  {
    type: "region_recovered",
    message: "Region ${region} recovered",
    level: "success",
    source: "edge",
  },
  {
    type: "auth_anomaly",
    message: "Anomalous sign-in pattern detected · throttled",
    level: "warning",
    source: "auth",
  },
  {
    type: "abuse_blocked",
    message: "Edge blocked ${count} abusive requests",
    level: "warning",
    source: "edge",
  },
];

const FAKE_DOMAINS = [
  "app.gtlnav.com",
  "edge.godtechlabs.com",
  "demo.acme.dev",
  "studio.gtlnav.io",
  "api.basil.run",
];
const FAKE_REGIONS = ["US-EAST", "US-WEST", "EU-WEST", "AP-NORTH", "SA-EAST"];
const FAKE_EMAILS = [
  "ada.lovelace@example.com",
  "linus.torvalds@example.com",
  "grace.hopper@example.com",
  "alan.turing@example.com",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(message: string): string {
  return message
    .replace("${commit}", Math.random().toString(16).slice(2, 9))
    .replace("${dur}", String(20 + Math.floor(Math.random() * 60)))
    .replace("${domain}", pick(FAKE_DOMAINS))
    .replace("${origin}", `203.0.113.${Math.floor(Math.random() * 255)}`)
    .replace("${prefix}", `gtlnav_live_${Math.random().toString(36).slice(2, 6)}`)
    .replace("${region}", pick(FAKE_REGIONS))
    .replace("${pct}", String(60 + Math.floor(Math.random() * 38)))
    .replace("${email}", pick(FAKE_EMAILS))
    .replace("${count}", String(20 + Math.floor(Math.random() * 980)));
}

export function generateLiveEvent(
  scope: "user" | "admin" = "user",
): LiveEvent {
  const tpl = pick(scope === "admin" ? ADMIN_EVENT_TEMPLATES : USER_EVENT_TEMPLATES);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    t: new Date().toISOString(),
    type: tpl.type,
    message: fillTemplate(tpl.message),
    level: tpl.level,
    source: tpl.source,
  };
}

export function generateLiveBurst(
  scope: "user" | "admin" = "user",
  count = 8,
): LiveEvent[] {
  const out: LiveEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const ev = generateLiveEvent(scope);
    out.push({
      ...ev,
      t: new Date(Date.now() - (count - i) * 800).toISOString(),
    });
  }
  return out;
}

// -------- chart helpers ----------------------------------------------------

/**
 * Convert a series into normalized 0..1 chart values, with the min/max used
 * for axis labels.
 */
export function normalizeSeries(series: SeriesPoint[]): {
  min: number;
  max: number;
  points: { x: number; y: number; raw: SeriesPoint }[];
} {
  if (series.length === 0) return { min: 0, max: 1, points: [] };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of series) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 1;
  if (max === min) max = min + 1;

  const points = series.map((p, idx) => ({
    x: series.length === 1 ? 0.5 : idx / (series.length - 1),
    y: 1 - (p.value - min) / (max - min),
    raw: p,
  }));
  return { min, max, points };
}

/**
 * Given normalized [0..1] points, build a smooth SVG cubic Bezier path.
 * Width/height are the *target viewBox* dimensions.
 */
export function buildSmoothPath(
  pts: { x: number; y: number }[],
  width: number,
  height: number,
): string {
  if (pts.length === 0) return "";
  if (pts.length === 1)
    return `M ${pts[0].x * width} ${pts[0].y * height}`;

  const scaled = pts.map((p) => ({ x: p.x * width, y: p.y * height }));
  let d = `M ${scaled[0].x} ${scaled[0].y}`;

  for (let i = 1; i < scaled.length; i += 1) {
    const prev = scaled[i - 1];
    const curr = scaled[i];
    const cx1 = prev.x + (curr.x - prev.x) / 2;
    const cy1 = prev.y;
    const cx2 = prev.x + (curr.x - prev.x) / 2;
    const cy2 = curr.y;
    d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
  }
  return d;
}

/** Build the area-fill version of a smooth path (closed at the bottom). */
export function buildSmoothArea(
  pts: { x: number; y: number }[],
  width: number,
  height: number,
): string {
  if (pts.length === 0) return "";
  const path = buildSmoothPath(pts, width, height);
  return `${path} L ${width} ${height} L 0 ${height} Z`;
}

// -------- humanizers -------------------------------------------------------

export function humanizeNumber(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

export function humanizeBytes(gb: number): string {
  if (gb >= 1_000) return `${(gb / 1_000).toFixed(1)} TB`;
  return `${Math.round(gb)} GB`;
}

export function humanizeMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

export function humanizeSeconds(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
