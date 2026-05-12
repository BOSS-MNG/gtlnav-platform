/**
 * GTLNAV — Edge Runtime & Functions Platform.
 *
 * Architectural foundation for serverless / edge / worker functions.
 * Today everything is in-memory simulation; tomorrow the same shapes flow
 * out of three Supabase tables (`edge_functions`, `function_deployments`,
 * `function_logs`) and a real isolate runtime.
 *
 * Inspiration: Cloudflare Workers, Vercel Edge Functions, Supabase Edge
 * Functions. Concepts kept platform-neutral so the engine can swap between
 * V8 isolates, WASM, or container-backed serverless without UI churn.
 */

// ---------------------------------------------------------------------------
//  Runtime kinds
// ---------------------------------------------------------------------------

export const RUNTIME_KINDS = ["edge", "worker", "serverless"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export const RUNTIME_META: Record<
  RuntimeKind,
  {
    label: string;
    short: string;
    blurb: string;
    coldStartMs: [number, number];
    /** Maximum CPU ms allowed per request. */
    cpuLimitMs: number;
    /** Memory cap (MB). */
    memoryMb: number;
    /** Default p50 latency band. */
    latencyMs: [number, number];
    isolation: string;
  }
> = {
  edge: {
    label: "Edge runtime",
    short: "Edge",
    blurb: "V8 isolate at the closest POP. ~5ms cold start, web-standard APIs.",
    coldStartMs: [3, 12],
    cpuLimitMs: 50,
    memoryMb: 128,
    latencyMs: [4, 28],
    isolation: "v8-isolate",
  },
  worker: {
    label: "Worker",
    short: "Worker",
    blurb:
      "Long-running stateful worker on a regional pool. Survives between requests.",
    coldStartMs: [40, 180],
    cpuLimitMs: 50_000,
    memoryMb: 512,
    latencyMs: [12, 60],
    isolation: "isolate-pool",
  },
  serverless: {
    label: "Serverless",
    short: "Lambda",
    blurb:
      "Container-backed function. Heavier cold start, full Node.js APIs, NPM compatible.",
    coldStartMs: [200, 900],
    cpuLimitMs: 10_000,
    memoryMb: 1024,
    latencyMs: [80, 320],
    isolation: "firecracker-vm",
  },
};

// ---------------------------------------------------------------------------
//  Function state machine
// ---------------------------------------------------------------------------

export const FUNCTION_STATES = ["draft", "deploying", "active", "failed"] as const;
export type FunctionState = (typeof FUNCTION_STATES)[number];

export type FunctionTrigger = "http" | "cron" | "queue" | "webhook";

export type FunctionRoute = {
  method: "ANY" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
};

export type EnvBindingKind =
  | "secret"
  | "env"
  | "kv"
  | "queue"
  | "cache"
  | "database"
  | "storage";

export type EnvBinding = {
  id: string;
  name: string;
  kind: EnvBindingKind;
  value: string;
  /** Whether to mask in UI (always true for secret/database). */
  masked: boolean;
};

export type EdgeFunction = {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  slug: string;
  description: string;
  runtime: RuntimeKind;
  state: FunctionState;
  triggers: FunctionTrigger[];
  routes: FunctionRoute[];
  /** Regions selected for execution. Empty = all enabled. */
  regions: string[];
  /** Latest deployment id (for active/deploying states). */
  active_deployment_id: string | null;
  /** Soft "version" counter for deploys. */
  version: number;
  invocations_24h: number;
  errors_24h: number;
  p50_ms: number;
  p95_ms: number;
  cpu_ms_avg: number;
  cold_start_rate: number;
  bindings: EnvBinding[];
  source_excerpt: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
//  Deployments
// ---------------------------------------------------------------------------

export const DEPLOYMENT_STATUSES = [
  "queued",
  "bundling",
  "uploading",
  "rolling_out",
  "active",
  "failed",
  "rolled_back",
] as const;
export type FunctionDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export type FunctionDeployment = {
  id: string;
  function_id: string;
  user_id: string;
  version: number;
  status: FunctionDeploymentStatus;
  /** Phase progress 0..1 for bundling/upload UI. */
  progress: number;
  /** Bundle size in KB. */
  bundle_kb: number;
  /** Regions targeted. */
  regions: string[];
  /** Region propagation map (regionId -> propagated). */
  region_status: Record<string, "queued" | "propagating" | "active" | "failed">;
  commit_sha: string | null;
  branch: string | null;
  triggered_by: "push" | "manual" | "rollback" | "cron";
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

// ---------------------------------------------------------------------------
//  Logs
// ---------------------------------------------------------------------------

export type FunctionLogLevel = "info" | "warn" | "error" | "debug" | "ok" | "deploy";

export type FunctionLog = {
  id: string;
  function_id: string;
  deployment_id: string | null;
  region: string | null;
  level: FunctionLogLevel;
  source: string;
  message: string;
  request_id: string | null;
  duration_ms: number | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
//  Invocations
// ---------------------------------------------------------------------------

export type InvocationOutcome = "ok" | "error" | "timeout";

export type InvocationRequest = {
  method: FunctionRoute["method"];
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string;
};

export type InvocationResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type Invocation = {
  id: string;
  function_id: string;
  deployment_id: string | null;
  region: string;
  cold_start: boolean;
  cold_start_ms: number;
  cpu_ms: number;
  total_ms: number;
  outcome: InvocationOutcome;
  request: InvocationRequest;
  response: InvocationResponse;
  log_lines: FunctionLog[];
  created_at: string;
};

// ---------------------------------------------------------------------------
//  Edge regions
// ---------------------------------------------------------------------------

export type EdgeRegion = {
  id: string;
  city: string;
  country: string;
  continent: "NA" | "SA" | "EU" | "AS" | "AF" | "OC";
  lat: number;
  lng: number;
  label: string;
};

export const EDGE_REGIONS: EdgeRegion[] = [
  { id: "iad1", city: "Ashburn", country: "US", continent: "NA", lat: 39, lng: -77.5, label: "iad1 · Ashburn" },
  { id: "sfo1", city: "San Francisco", country: "US", continent: "NA", lat: 37.7, lng: -122.4, label: "sfo1 · San Francisco" },
  { id: "ord1", city: "Chicago", country: "US", continent: "NA", lat: 41.8, lng: -87.6, label: "ord1 · Chicago" },
  { id: "lhr1", city: "London", country: "GB", continent: "EU", lat: 51.5, lng: -0.1, label: "lhr1 · London" },
  { id: "fra1", city: "Frankfurt", country: "DE", continent: "EU", lat: 50.1, lng: 8.7, label: "fra1 · Frankfurt" },
  { id: "cdg1", city: "Paris", country: "FR", continent: "EU", lat: 48.9, lng: 2.4, label: "cdg1 · Paris" },
  { id: "gru1", city: "São Paulo", country: "BR", continent: "SA", lat: -23.5, lng: -46.6, label: "gru1 · São Paulo" },
  { id: "syd1", city: "Sydney", country: "AU", continent: "OC", lat: -33.9, lng: 151.2, label: "syd1 · Sydney" },
  { id: "nrt1", city: "Tokyo", country: "JP", continent: "AS", lat: 35.7, lng: 139.7, label: "nrt1 · Tokyo" },
  { id: "sin1", city: "Singapore", country: "SG", continent: "AS", lat: 1.35, lng: 103.8, label: "sin1 · Singapore" },
  { id: "bom1", city: "Mumbai", country: "IN", continent: "AS", lat: 19.1, lng: 72.9, label: "bom1 · Mumbai" },
  { id: "jnb1", city: "Johannesburg", country: "ZA", continent: "AF", lat: -26.2, lng: 28, label: "jnb1 · Johannesburg" },
];

export function regionById(id: string): EdgeRegion | null {
  return EDGE_REGIONS.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
//  Sample source code (for the source excerpt panel)
// ---------------------------------------------------------------------------

export const SAMPLE_SOURCE: Record<RuntimeKind, string> = {
  edge: `// edge runtime — runs on V8 isolates at the nearest POP
export const config = { runtime: "edge", regions: ["iad1", "lhr1", "nrt1"] };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "world";
  return new Response(JSON.stringify({ hello: name, region: process.env.GTLNAV_REGION }), {
    status: 200,
    headers: { "content-type": "application/json", "x-gtlnav-edge": "1" },
  });
}
`,
  worker: `// gtlnav worker — long-running, stateful pool
import { kv } from "gtlnav:bindings";

export default {
  async fetch(req: Request): Promise<Response> {
    const hits = (await kv.get<number>("hits")) ?? 0;
    await kv.put("hits", hits + 1);
    return new Response(JSON.stringify({ hits: hits + 1 }), {
      headers: { "content-type": "application/json" },
    });
  },
};
`,
  serverless: `// serverless — full node, container-backed cold starts
import type { GtlnavRequest, GtlnavResponse } from "@gtlnav/serverless";

export default async function handler(req: GtlnavRequest, res: GtlnavResponse) {
  res.setHeader("content-type", "application/json");
  res.status(200).json({
    runtime: "serverless",
    node: process.versions.node,
    region: process.env.GTLNAV_REGION,
  });
}
`,
};

// ---------------------------------------------------------------------------
//  Utilities
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function shortId(id: string): string {
  return id.slice(-7);
}

export function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  if (abs < 30_000) return "just now";
  if (abs < 60_000) return `${Math.round(abs / 1000)}s ago`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  return `${Math.round(abs / 86_400_000)}d ago`;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function jitter(base: number, spreadPct = 0.2): number {
  return base * (1 + (Math.random() * 2 - 1) * spreadPct);
}

// ---------------------------------------------------------------------------
//  State + status styling helpers
// ---------------------------------------------------------------------------

export type StatusTone = {
  ring: string;
  text: string;
  dot: string;
  bar: string;
  label: string;
};

export function functionStateTone(state: FunctionState): StatusTone {
  switch (state) {
    case "active":
      return {
        ring: "border-basil-400/40 bg-basil-500/10",
        text: "text-basil-200",
        dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]",
        bar: "bg-gradient-to-b from-basil-300 via-basil-400 to-basil-500",
        label: "Active",
      };
    case "deploying":
      return {
        ring: "border-cyan-400/40 bg-cyan-500/10",
        text: "text-cyan-100",
        dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)]",
        bar: "bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500",
        label: "Deploying",
      };
    case "failed":
      return {
        ring: "border-rose-400/40 bg-rose-500/12",
        text: "text-rose-200",
        dot: "bg-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.95)]",
        bar: "bg-gradient-to-b from-rose-300 via-rose-400 to-rose-500",
        label: "Failed",
      };
    default:
      return {
        ring: "border-white/15 bg-white/[0.04]",
        text: "text-white/70",
        dot: "bg-white/45",
        bar: "bg-gradient-to-b from-white/20 via-white/30 to-white/40",
        label: "Draft",
      };
  }
}

export function deploymentStatusTone(s: FunctionDeploymentStatus): StatusTone {
  switch (s) {
    case "active":
      return functionStateTone("active");
    case "failed":
      return functionStateTone("failed");
    case "rolled_back":
      return {
        ring: "border-amber-400/40 bg-amber-500/10",
        text: "text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)]",
        bar: "bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500",
        label: "Rolled back",
      };
    default:
      return functionStateTone("deploying");
  }
}

export function logLevelTone(level: FunctionLogLevel): string {
  switch (level) {
    case "error":
      return "text-rose-300";
    case "warn":
      return "text-amber-300";
    case "ok":
      return "text-basil-200";
    case "deploy":
      return "text-cyan-300";
    case "debug":
      return "text-white/45";
    default:
      return "text-white/75";
  }
}

// ---------------------------------------------------------------------------
//  Sample / seed data
// ---------------------------------------------------------------------------

const FAKE_FUNCTION_NAMES = [
  { name: "auth-edge", description: "Cookie-bound auth edge gate; signs short-lived JWTs at the POP." },
  { name: "image-resize", description: "Resizes inbound /og/* images and serves cache-friendly variants." },
  { name: "ab-router", description: "Hashes session id and forwards to A/B variants. Sticky for 24h." },
  { name: "geo-redirect", description: "Redirects users to country-specific store fronts based on geo." },
  { name: "rate-limiter", description: "Sliding-window per-IP throttling with KV-backed counters." },
  { name: "webhook-fanout", description: "Fans GitHub events into ops, audit, and analytics pipelines." },
  { name: "feed-cache", description: "Cron-driven warmer for /feed/* paths. Worker pool, persistent." },
  { name: "checkout-webhook", description: "Stripe-shaped checkout receiver; verifies signatures & enqueues." },
  { name: "ai-router", description: "Streams completions; routes models by latency budget per region." },
  { name: "feature-flags", description: "Reads flag bundles from KV and resolves cohorts per request." },
];

function sampleBindings(runtime: RuntimeKind): EnvBinding[] {
  const base: EnvBinding[] = [
    {
      id: newId("b"),
      name: "GTLNAV_API_KEY",
      kind: "secret",
      value: `gtl_${Math.random().toString(36).slice(2, 10)}`,
      masked: true,
    },
    {
      id: newId("b"),
      name: "STAGE",
      kind: "env",
      value: "production",
      masked: false,
    },
  ];
  if (runtime === "edge") {
    base.push({
      id: newId("b"),
      name: "FLAGS_KV",
      kind: "kv",
      value: "kv-namespace://flags",
      masked: false,
    });
  }
  if (runtime === "worker") {
    base.push(
      {
        id: newId("b"),
        name: "INBOUND_QUEUE",
        kind: "queue",
        value: "queue://inbound-events",
        masked: false,
      },
      {
        id: newId("b"),
        name: "EDGE_CACHE",
        kind: "cache",
        value: "cache://edge",
        masked: false,
      },
    );
  }
  if (runtime === "serverless") {
    base.push(
      {
        id: newId("b"),
        name: "DATABASE_URL",
        kind: "database",
        value: "postgres://******@db.gtlnav.local/main",
        masked: true,
      },
      {
        id: newId("b"),
        name: "ASSET_BUCKET",
        kind: "storage",
        value: "s3://gtlnav-assets/${branch}",
        masked: false,
      },
    );
  }
  return base;
}

function pickRegions(runtime: RuntimeKind): string[] {
  const pools: Record<RuntimeKind, string[]> = {
    edge: ["iad1", "sfo1", "lhr1", "fra1", "cdg1", "nrt1", "sin1"],
    worker: ["iad1", "lhr1", "nrt1", "syd1"],
    serverless: ["iad1", "fra1"],
  };
  return pools[runtime];
}

export function generateFunctions(opts: {
  userId: string;
  count?: number;
}): EdgeFunction[] {
  const count = opts.count ?? 6;
  const out: EdgeFunction[] = [];
  for (let i = 0; i < Math.min(count, FAKE_FUNCTION_NAMES.length); i += 1) {
    const tpl = FAKE_FUNCTION_NAMES[i];
    const runtime: RuntimeKind = pick(RUNTIME_KINDS);
    const meta = RUNTIME_META[runtime];
    const stateRand = Math.random();
    const state: FunctionState =
      stateRand < 0.65
        ? "active"
        : stateRand < 0.78
          ? "deploying"
          : stateRand < 0.9
            ? "draft"
            : "failed";
    const slug = tpl.name;
    const created = new Date(Date.now() - i * 36 * 3_600_000).toISOString();
    const updated = new Date(Date.now() - i * 1.2 * 3_600_000).toISOString();
    out.push({
      id: newId("fn"),
      user_id: opts.userId,
      project_id: null,
      name: tpl.name,
      slug,
      description: tpl.description,
      runtime,
      state,
      triggers: ["http", ...(Math.random() > 0.7 ? ["cron"] as const : [])],
      routes: [{ method: "ANY", path: `/api/fn/${slug}/*` }],
      regions: pickRegions(runtime),
      active_deployment_id: state === "active" ? newId("dep") : null,
      version: 1 + Math.floor(Math.random() * 14),
      invocations_24h: state === "active" ? 1_200 + Math.floor(Math.random() * 80_000) : 0,
      errors_24h: state === "failed" ? 200 + Math.floor(Math.random() * 600) : Math.floor(Math.random() * 60),
      p50_ms: Math.round(jitter((meta.latencyMs[0] + meta.latencyMs[1]) / 2, 0.2)),
      p95_ms: Math.round(jitter(meta.latencyMs[1] * 1.4, 0.2)),
      cpu_ms_avg: Math.round(jitter(meta.cpuLimitMs * 0.18, 0.4)),
      cold_start_rate: clamp(jitter(0.04 + (i % 4) * 0.015, 0.5), 0.01, 0.25),
      bindings: sampleBindings(runtime),
      source_excerpt: SAMPLE_SOURCE[runtime],
      created_at: created,
      updated_at: updated,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Deploy simulation
// ---------------------------------------------------------------------------

export type StartDeployOptions = {
  fnId: string;
  userId: string;
  triggeredBy?: FunctionDeployment["triggered_by"];
  branch?: string;
  commitSha?: string;
  regions?: string[];
};

export function startDeployment(
  fn: EdgeFunction,
  opts: StartDeployOptions,
): { fn: EdgeFunction; deployment: FunctionDeployment; logs: FunctionLog[] } {
  const regions = opts.regions ?? fn.regions;
  const region_status: Record<
    string,
    "queued" | "propagating" | "active" | "failed"
  > = {};
  for (const r of regions) region_status[r] = "queued";

  const dep: FunctionDeployment = {
    id: newId("dep"),
    function_id: fn.id,
    user_id: opts.userId,
    version: fn.version + 1,
    status: "queued",
    progress: 0,
    bundle_kb: Math.round(jitter(60 + Math.random() * 220, 0.4)),
    regions,
    region_status,
    commit_sha:
      opts.commitSha ??
      Math.random().toString(16).slice(2, 9),
    branch: opts.branch ?? "main",
    triggered_by: opts.triggeredBy ?? "manual",
    duration_ms: null,
    error: null,
    created_at: new Date().toISOString(),
    finished_at: null,
  };

  const logs: FunctionLog[] = [
    {
      id: newId("lg"),
      function_id: fn.id,
      deployment_id: dep.id,
      region: null,
      level: "deploy",
      source: "deploy",
      message: `Queued deployment v${dep.version} (${regions.length} regions, ~${dep.bundle_kb}KB bundle).`,
      request_id: null,
      duration_ms: null,
      created_at: new Date().toISOString(),
    },
  ];

  return {
    fn: {
      ...fn,
      state: "deploying",
      version: dep.version,
      active_deployment_id: dep.id,
      updated_at: new Date().toISOString(),
    },
    deployment: dep,
    logs,
  };
}

const DEPLOY_PHASE_ORDER: FunctionDeploymentStatus[] = [
  "queued",
  "bundling",
  "uploading",
  "rolling_out",
  "active",
];

const DEPLOY_PHASE_DURATION_MS: Record<FunctionDeploymentStatus, number> = {
  queued: 600,
  bundling: 1500,
  uploading: 1100,
  rolling_out: 1800,
  active: 0,
  failed: 0,
  rolled_back: 0,
};

/**
 * Advances a deployment by `tickMs` simulated milliseconds, returning new
 * status, region propagation map, progress, and any new log lines emitted.
 */
export function tickDeployment(
  fn: EdgeFunction,
  dep: FunctionDeployment,
  tickMs: number,
  options: { failChance?: number } = {},
): {
  fn: EdgeFunction;
  deployment: FunctionDeployment;
  newLogs: FunctionLog[];
} {
  if (
    dep.status === "active" ||
    dep.status === "failed" ||
    dep.status === "rolled_back"
  ) {
    return { fn, deployment: dep, newLogs: [] };
  }

  const newLogs: FunctionLog[] = [];
  let next: FunctionDeployment = { ...dep, region_status: { ...dep.region_status } };
  const phaseIdx = DEPLOY_PHASE_ORDER.indexOf(next.status);
  const phaseDur = DEPLOY_PHASE_DURATION_MS[next.status] || 1000;
  next.progress = clamp(next.progress + tickMs / phaseDur, 0, 1);

  // Optional failure injection.
  if ((options.failChance ?? 0) > 0 && Math.random() < (options.failChance ?? 0)) {
    next.status = "failed";
    next.error = "bundler error: unresolved import 'crypto/edge'";
    next.finished_at = new Date().toISOString();
    next.duration_ms =
      new Date(next.finished_at).getTime() - new Date(next.created_at).getTime();
    for (const r of Object.keys(next.region_status)) {
      if (next.region_status[r] !== "active") next.region_status[r] = "failed";
    }
    newLogs.push({
      id: newId("lg"),
      function_id: fn.id,
      deployment_id: dep.id,
      region: null,
      level: "error",
      source: "deploy",
      message: `Deployment v${dep.version} failed: ${next.error}`,
      request_id: null,
      duration_ms: null,
      created_at: next.finished_at,
    });
    return {
      fn: {
        ...fn,
        state: "failed",
        updated_at: next.finished_at,
      },
      deployment: next,
      newLogs,
    };
  }

  if (next.progress >= 1 && phaseIdx >= 0 && phaseIdx < DEPLOY_PHASE_ORDER.length - 1) {
    const advancedTo = DEPLOY_PHASE_ORDER[phaseIdx + 1];
    next.status = advancedTo;
    next.progress = 0;
    if (advancedTo === "rolling_out") {
      const ts = new Date().toISOString();
      newLogs.push({
        id: newId("lg"),
        function_id: fn.id,
        deployment_id: dep.id,
        region: null,
        level: "deploy",
        source: "rollout",
        message: `Beginning multi-region rollout to ${dep.regions.join(", ")}.`,
        request_id: null,
        duration_ms: null,
        created_at: ts,
      });
      for (const r of dep.regions) next.region_status[r] = "propagating";
    } else if (advancedTo === "active") {
      const ts = new Date().toISOString();
      next.finished_at = ts;
      next.duration_ms = new Date(ts).getTime() - new Date(dep.created_at).getTime();
      for (const r of dep.regions) next.region_status[r] = "active";
      newLogs.push({
        id: newId("lg"),
        function_id: fn.id,
        deployment_id: dep.id,
        region: null,
        level: "ok",
        source: "deploy",
        message: `Deployment v${dep.version} active across ${dep.regions.length} regions.`,
        request_id: null,
        duration_ms: next.duration_ms,
        created_at: ts,
      });
    } else if (advancedTo === "bundling") {
      const ts = new Date().toISOString();
      newLogs.push({
        id: newId("lg"),
        function_id: fn.id,
        deployment_id: dep.id,
        region: null,
        level: "deploy",
        source: "bundle",
        message: `Bundling ${fn.runtime} module · target ${RUNTIME_META[fn.runtime].isolation}`,
        request_id: null,
        duration_ms: null,
        created_at: ts,
      });
    } else if (advancedTo === "uploading") {
      const ts = new Date().toISOString();
      newLogs.push({
        id: newId("lg"),
        function_id: fn.id,
        deployment_id: dep.id,
        region: null,
        level: "deploy",
        source: "upload",
        message: `Uploading bundle (${dep.bundle_kb}KB) to control plane.`,
        request_id: null,
        duration_ms: null,
        created_at: ts,
      });
    }
  }

  // While rolling out, flip region statuses one by one for realism.
  if (next.status === "rolling_out") {
    const propagating = Object.keys(next.region_status).filter(
      (r) => next.region_status[r] === "propagating",
    );
    if (propagating.length > 0 && Math.random() < tickMs / 700) {
      const r = pick(propagating);
      next.region_status[r] = "active";
      newLogs.push({
        id: newId("lg"),
        function_id: fn.id,
        deployment_id: dep.id,
        region: r,
        level: "ok",
        source: "rollout",
        message: `Region ${r} accepted v${dep.version}.`,
        request_id: null,
        duration_ms: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  const advancedFn: EdgeFunction =
    next.status === "active"
      ? { ...fn, state: "active", updated_at: next.finished_at ?? fn.updated_at }
      : fn;

  return { fn: advancedFn, deployment: next, newLogs };
}

export function rollbackDeployment(
  fn: EdgeFunction,
  dep: FunctionDeployment,
): { fn: EdgeFunction; deployment: FunctionDeployment; log: FunctionLog } {
  const ts = new Date().toISOString();
  const log: FunctionLog = {
    id: newId("lg"),
    function_id: fn.id,
    deployment_id: dep.id,
    region: null,
    level: "warn",
    source: "deploy",
    message: `Rolled back v${dep.version} → v${Math.max(1, dep.version - 1)}.`,
    request_id: null,
    duration_ms: null,
    created_at: ts,
  };
  return {
    fn: { ...fn, state: "active", version: Math.max(1, dep.version - 1), updated_at: ts },
    deployment: { ...dep, status: "rolled_back", finished_at: ts },
    log,
  };
}

// ---------------------------------------------------------------------------
//  Invoke simulation
// ---------------------------------------------------------------------------

const RESP_BODY_BY_RUNTIME: Record<RuntimeKind, (req: InvocationRequest) => string> = {
  edge: (req) =>
    JSON.stringify(
      {
        ok: true,
        runtime: "edge",
        method: req.method,
        path: req.path,
        echo: safeParseBody(req.body),
        served_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  worker: (req) =>
    JSON.stringify(
      {
        ok: true,
        runtime: "worker",
        request: { method: req.method, path: req.path },
        kv: { hits: Math.floor(Math.random() * 5_000) },
      },
      null,
      2,
    ),
  serverless: (req) =>
    JSON.stringify(
      {
        ok: true,
        runtime: "serverless",
        node: "v20.18.0",
        method: req.method,
        path: req.path,
        body: safeParseBody(req.body),
      },
      null,
      2,
    ),
};

function safeParseBody(body: string): unknown {
  if (!body || !body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export type InvokeOptions = {
  fn: EdgeFunction;
  request: InvocationRequest;
  forceColdStart?: boolean;
  forceError?: boolean;
  preferredRegion?: string;
};

export function invoke(opts: InvokeOptions): Invocation {
  const { fn, request } = opts;
  const meta = RUNTIME_META[fn.runtime];
  const region =
    opts.preferredRegion ??
    (fn.regions.length ? pick(fn.regions) : EDGE_REGIONS[0].id);

  const cold = opts.forceColdStart ?? Math.random() < fn.cold_start_rate;
  const cold_ms = cold
    ? Math.round(jitter((meta.coldStartMs[0] + meta.coldStartMs[1]) / 2, 0.4))
    : 0;
  const cpu_ms = Math.round(jitter(meta.cpuLimitMs * 0.06, 0.6));
  const exec_ms = Math.round(
    jitter((meta.latencyMs[0] + meta.latencyMs[1]) / 2, 0.4),
  );
  const total = cold_ms + cpu_ms + exec_ms;

  const error =
    opts.forceError ?? (Math.random() < (fn.errors_24h > 0 ? 0.08 : 0.02));
  const outcome: InvocationOutcome = error ? "error" : "ok";

  const status = error ? pick([500, 502, 504, 429]) : pick([200, 200, 200, 201, 204]);
  const respBody = error
    ? JSON.stringify(
        {
          ok: false,
          error: pick([
            "isolate timeout exceeded",
            "binding 'GTLNAV_API_KEY' not found",
            "upstream returned 502",
            "TypeError: Cannot read properties of undefined",
          ]),
          request_id: `req_${Math.random().toString(36).slice(2, 12)}`,
        },
        null,
        2,
      )
    : RESP_BODY_BY_RUNTIME[fn.runtime](request);

  const requestId = `req_${Math.random().toString(36).slice(2, 12)}`;
  const ts = new Date().toISOString();

  const logs: FunctionLog[] = [];
  if (cold) {
    logs.push({
      id: newId("lg"),
      function_id: fn.id,
      deployment_id: fn.active_deployment_id,
      region,
      level: "info",
      source: "isolate",
      message: `Cold start initialized in ${cold_ms}ms (${meta.isolation}).`,
      request_id: requestId,
      duration_ms: cold_ms,
      created_at: ts,
    });
  }
  logs.push({
    id: newId("lg"),
    function_id: fn.id,
    deployment_id: fn.active_deployment_id,
    region,
    level: error ? "error" : "ok",
    source: "handler",
    message: error
      ? `Invocation ${requestId} failed in ${total}ms (status ${status}).`
      : `Invocation ${requestId} completed in ${total}ms (status ${status}).`,
    request_id: requestId,
    duration_ms: total,
    created_at: ts,
  });

  return {
    id: newId("inv"),
    function_id: fn.id,
    deployment_id: fn.active_deployment_id,
    region,
    cold_start: cold,
    cold_start_ms: cold_ms,
    cpu_ms,
    total_ms: total,
    outcome,
    request,
    response: {
      status,
      headers: {
        "content-type": "application/json",
        "x-gtlnav-region": region,
        "x-gtlnav-request-id": requestId,
        "x-gtlnav-runtime": fn.runtime,
        "x-gtlnav-cold-start": String(cold),
      },
      body: respBody,
    },
    log_lines: logs,
    created_at: ts,
  };
}

// ---------------------------------------------------------------------------
//  Live log generator (between explicit invocations)
// ---------------------------------------------------------------------------

const AMBIENT_LOG_TEMPLATES: { level: FunctionLogLevel; source: string; msg: string }[] = [
  { level: "info", source: "router", msg: "GET /api/fn/{slug}/health → 200 (4ms)" },
  { level: "info", source: "router", msg: "POST /api/fn/{slug}/event → 202 (12ms)" },
  { level: "info", source: "isolate", msg: "Warm pool reused isolate i-{id}" },
  { level: "ok", source: "kv", msg: "kv.get(\"flags:{slug}\") cache hit" },
  { level: "warn", source: "limiter", msg: "Sliding window 60s · throttling 1 ip" },
  { level: "info", source: "fetch", msg: "fetch(\"https://api.upstream.dev/\") → 200 (38ms)" },
  { level: "warn", source: "isolate", msg: "Memory pressure 78% · scheduling GC" },
  { level: "error", source: "handler", msg: "Unhandled rejection: Error: 5xx from upstream" },
  { level: "debug", source: "trace", msg: "trace span [auth.verify] 1.2ms" },
];

export function generateAmbientLogs(opts: {
  fn: EdgeFunction;
  count?: number;
}): FunctionLog[] {
  const count = opts.count ?? 18;
  const out: FunctionLog[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    const tpl = pick(AMBIENT_LOG_TEMPLATES);
    const ts = new Date(now - i * (1500 + Math.random() * 1500)).toISOString();
    out.push({
      id: newId("lg"),
      function_id: opts.fn.id,
      deployment_id: opts.fn.active_deployment_id,
      region: opts.fn.regions.length ? pick(opts.fn.regions) : null,
      level: tpl.level,
      source: tpl.source,
      message: tpl.msg
        .replace(/\{slug\}/g, opts.fn.slug)
        .replace(/\{id\}/g, Math.random().toString(36).slice(2, 8)),
      request_id: `req_${Math.random().toString(36).slice(2, 12)}`,
      duration_ms: tpl.level === "info" || tpl.level === "ok" ? Math.round(jitter(20, 0.6)) : null,
      created_at: ts,
    });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function tickAmbientLog(fn: EdgeFunction): FunctionLog | null {
  if (fn.state !== "active") return null;
  if (Math.random() > 0.65) return null;
  const tpl = pick(AMBIENT_LOG_TEMPLATES);
  return {
    id: newId("lg"),
    function_id: fn.id,
    deployment_id: fn.active_deployment_id,
    region: fn.regions.length ? pick(fn.regions) : null,
    level: tpl.level,
    source: tpl.source,
    message: tpl.msg
      .replace(/\{slug\}/g, fn.slug)
      .replace(/\{id\}/g, Math.random().toString(36).slice(2, 8)),
    request_id: `req_${Math.random().toString(36).slice(2, 12)}`,
    duration_ms: tpl.level === "info" || tpl.level === "ok" ? Math.round(jitter(20, 0.6)) : null,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Live metric tick
// ---------------------------------------------------------------------------

export function tickFunctionMetrics(fn: EdgeFunction): EdgeFunction {
  if (fn.state !== "active") return fn;
  const meta = RUNTIME_META[fn.runtime];
  const burst = Math.floor(jitter(40, 0.5));
  return {
    ...fn,
    invocations_24h: fn.invocations_24h + burst,
    errors_24h: fn.errors_24h + (Math.random() > 0.92 ? 1 : 0),
    p50_ms: clamp(
      Math.round(fn.p50_ms * 0.92 + jitter((meta.latencyMs[0] + meta.latencyMs[1]) / 2, 0.3) * 0.08),
      meta.latencyMs[0],
      meta.latencyMs[1] * 1.3,
    ),
    p95_ms: clamp(
      Math.round(fn.p95_ms * 0.9 + jitter(meta.latencyMs[1] * 1.4, 0.3) * 0.1),
      meta.latencyMs[1],
      meta.latencyMs[1] * 2,
    ),
    cpu_ms_avg: clamp(
      Math.round(fn.cpu_ms_avg * 0.92 + jitter(meta.cpuLimitMs * 0.18, 0.3) * 0.08),
      0,
      meta.cpuLimitMs,
    ),
    cold_start_rate: clamp(
      fn.cold_start_rate * 0.96 + Math.random() * 0.01,
      0.005,
      0.3,
    ),
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Bindings helpers
// ---------------------------------------------------------------------------

export function bindingTone(kind: EnvBindingKind): { ring: string; text: string } {
  switch (kind) {
    case "secret":
      return { ring: "border-rose-400/30 bg-rose-500/10", text: "text-rose-200" };
    case "kv":
      return { ring: "border-cyan-400/30 bg-cyan-500/10", text: "text-cyan-100" };
    case "queue":
      return { ring: "border-amber-400/30 bg-amber-500/10", text: "text-amber-200" };
    case "cache":
      return { ring: "border-violet-400/30 bg-violet-500/10", text: "text-violet-200" };
    case "database":
      return { ring: "border-basil-400/30 bg-basil-500/10", text: "text-basil-100" };
    case "storage":
      return { ring: "border-white/15 bg-white/[0.04]", text: "text-white/80" };
    default:
      return { ring: "border-white/10 bg-white/[0.03]", text: "text-white/70" };
  }
}

export function maskValue(b: EnvBinding): string {
  if (!b.masked) return b.value;
  if (b.value.length < 6) return "••••••";
  return `${b.value.slice(0, 3)}••••${b.value.slice(-2)}`;
}

// ---------------------------------------------------------------------------
//  Number formatting helpers
// ---------------------------------------------------------------------------

export function humanCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function humanMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function humanPct(n: number): string {
  return `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;
}

/** Supabase DDL for `edge_functions`, `function_deployments`, `function_logs`. */
export const EDGE_FUNCTIONS_SCHEMA_SQL = `-- GTLNAV — Edge Runtime & Functions (Phase 4H)

create table if not exists public.edge_functions (
  id                    text primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  project_id            uuid references public.projects(id) on delete set null,
  name                  text not null,
  slug                  text not null,
  description           text not null default '',
  runtime               text not null check (runtime in ('edge','worker','serverless')),
  state                 text not null check (state in ('draft','deploying','active','failed')),
  triggers              jsonb not null default '["http"]'::jsonb,
  routes                jsonb not null default '[]'::jsonb,
  regions               jsonb not null default '[]'::jsonb,
  bindings              jsonb not null default '[]'::jsonb,
  active_deployment_id  text,
  version               int not null default 0,
  source_excerpt        text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists edge_functions_user_slug_uniq
  on public.edge_functions (user_id, slug);

alter table public.edge_functions enable row level security;

create policy "edge_functions_owner_all"
  on public.edge_functions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.function_deployments (
  id              text primary key,
  function_id     text not null references public.edge_functions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  version         int not null,
  status          text not null,
  progress        real not null default 0,
  bundle_kb       int not null default 0,
  regions         jsonb not null default '[]'::jsonb,
  region_status   jsonb not null default '{}'::jsonb,
  commit_sha      text,
  branch          text,
  triggered_by    text not null default 'manual',
  duration_ms     int,
  error           text,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists function_deployments_fn_created_idx
  on public.function_deployments (function_id, created_at desc);

alter table public.function_deployments enable row level security;

create policy "function_deployments_owner_all"
  on public.function_deployments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.function_logs (
  id              text primary key,
  function_id     text not null references public.edge_functions(id) on delete cascade,
  deployment_id   text references public.function_deployments(id) on delete set null,
  region          text,
  level           text not null,
  source          text not null,
  message         text not null,
  request_id      text,
  duration_ms     int,
  created_at      timestamptz not null default now()
);

create index if not exists function_logs_fn_created_idx
  on public.function_logs (function_id, created_at desc);

alter table public.function_logs enable row level security;

create policy "function_logs_owner_select"
  on public.function_logs for select
  using (
    exists (
      select 1 from public.edge_functions f
      where f.id = function_id and f.user_id = auth.uid()
    )
  );

create policy "function_logs_owner_insert"
  on public.function_logs for insert
  with check (
    exists (
      select 1 from public.edge_functions f
      where f.id = function_id and f.user_id = auth.uid()
    )
  );
`;
