/**
 * GTLNAV — Notifications & Alerts Center.
 *
 * Architecture-only foundation. Two tables (`notifications`,
 * `notification_preferences`) cover the persistence surface. The simulator
 * here drives the in-app feed, dropdown, and operator alerts when the
 * Supabase tables are not yet provisioned — the moment they are, the same
 * shapes flow through unchanged.
 *
 * Channels are modeled as architecture stubs:
 *   - in_app   → live; rendered by NotificationCenter / notifications page.
 *   - email    → schema-only (preferences + dispatch table seam).
 *   - webhook  → schema-only (per-user URL + secret rotation later).
 */

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  "deployment",
  "deployment_failed",
  "ssl_expiration",
  "dns_verification",
  "webhook",
  "usage",
  "billing",
  "infrastructure",
  "operator",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationSeverity =
  | "info"
  | "success"
  | "warn"
  | "error"
  | "critical";

export type NotificationChannel = "in_app" | "email" | "webhook";

export type NotificationDigestFrequency =
  | "off"
  | "instant"
  | "daily"
  | "weekly";

export type Notification = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Optional deep link to where this notification originated. */
  href?: string | null;
  /** Used to collapse repeated events (same project + same kind) in the UI. */
  group_key?: string | null;
  read_at: string | null;
  created_at: string;
  source: NotificationSource;
  metadata?: Record<string, unknown>;
};

export type NotificationSource =
  | "deploy_engine"
  | "ssl_monitor"
  | "dns_monitor"
  | "webhook_dispatch"
  | "usage_meter"
  | "billing"
  | "infrastructure"
  | "operator";

export type ChannelToggles = {
  in_app: boolean;
  email: boolean;
  webhook: boolean;
};

export type NotificationPreferences = {
  user_id: string;
  email_enabled: boolean;
  email_address: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
  digest_frequency: NotificationDigestFrequency;
  categories: Record<NotificationCategory, ChannelToggles>;
  updated_at: string;
};

// ---------------------------------------------------------------------------
//  Category metadata (icon hints + tone)
// ---------------------------------------------------------------------------

export type NotificationCategoryMeta = {
  category: NotificationCategory;
  label: string;
  short: string;
  description: string;
  defaultSeverity: NotificationSeverity;
  source: NotificationSource;
};

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  NotificationCategoryMeta
> = {
  deployment: {
    category: "deployment",
    label: "Deployments",
    short: "Deploy",
    description: "Build start/finish, runtime promotions, queue events.",
    defaultSeverity: "info",
    source: "deploy_engine",
  },
  deployment_failed: {
    category: "deployment_failed",
    label: "Deployment failures",
    short: "Failed",
    description: "Failed builds, runtime errors, rollback events.",
    defaultSeverity: "error",
    source: "deploy_engine",
  },
  ssl_expiration: {
    category: "ssl_expiration",
    label: "SSL expiration",
    short: "SSL",
    description: "Certificates approaching expiry or renewal failures.",
    defaultSeverity: "warn",
    source: "ssl_monitor",
  },
  dns_verification: {
    category: "dns_verification",
    label: "DNS verification",
    short: "DNS",
    description: "Domain ownership checks and propagation status.",
    defaultSeverity: "warn",
    source: "dns_monitor",
  },
  webhook: {
    category: "webhook",
    label: "Webhooks",
    short: "Webhook",
    description: "Inbound deploy hook fires and outbound delivery results.",
    defaultSeverity: "info",
    source: "webhook_dispatch",
  },
  usage: {
    category: "usage",
    label: "Usage",
    short: "Usage",
    description: "Quota pressure, overage warnings, traffic anomalies.",
    defaultSeverity: "warn",
    source: "usage_meter",
  },
  billing: {
    category: "billing",
    label: "Billing",
    short: "Billing",
    description: "Subscriptions, invoices, payment failures, dunning.",
    defaultSeverity: "info",
    source: "billing",
  },
  infrastructure: {
    category: "infrastructure",
    label: "Infrastructure",
    short: "Infra",
    description: "Region health, edge saturation, runtime capacity.",
    defaultSeverity: "warn",
    source: "infrastructure",
  },
  operator: {
    category: "operator",
    label: "Operator",
    short: "Operator",
    description: "Admin / super-admin only — security, abuse, audit.",
    defaultSeverity: "critical",
    source: "operator",
  },
};

// ---------------------------------------------------------------------------
//  Severity helpers
// ---------------------------------------------------------------------------

export function severityClass(s: NotificationSeverity): {
  ring: string;
  text: string;
  dot: string;
  bar: string;
  label: string;
} {
  switch (s) {
    case "critical":
      return {
        ring: "border-red-400/45 bg-red-500/15",
        text: "text-red-200",
        dot: "bg-red-300 shadow-[0_0_10px_rgba(248,113,113,1)]",
        bar: "bg-gradient-to-b from-red-300 via-red-400 to-red-600",
        label: "Critical",
      };
    case "error":
      return {
        ring: "border-rose-400/40 bg-rose-500/12",
        text: "text-rose-200",
        dot: "bg-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.95)]",
        bar: "bg-gradient-to-b from-rose-300 via-rose-400 to-rose-500",
        label: "Error",
      };
    case "warn":
      return {
        ring: "border-amber-400/40 bg-amber-500/12",
        text: "text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)]",
        bar: "bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500",
        label: "Warn",
      };
    case "success":
      return {
        ring: "border-basil-400/40 bg-basil-500/10",
        text: "text-basil-100",
        dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]",
        bar: "bg-gradient-to-b from-basil-300 via-basil-400 to-basil-500",
        label: "OK",
      };
    default:
      return {
        ring: "border-cyan-400/35 bg-cyan-500/10",
        text: "text-cyan-100",
        dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)]",
        bar: "bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500",
        label: "Info",
      };
  }
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  success: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

export function compareSeverity(
  a: NotificationSeverity,
  b: NotificationSeverity,
): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function highestSeverity(
  items: { severity: NotificationSeverity }[],
): NotificationSeverity {
  let worst: NotificationSeverity = "info";
  for (const item of items) {
    if (compareSeverity(item.severity, worst) > 0) worst = item.severity;
  }
  return worst;
}

// ---------------------------------------------------------------------------
//  Default preferences
// ---------------------------------------------------------------------------

export function defaultPreferences(userId: string, email: string | null): NotificationPreferences {
  const cats: Record<NotificationCategory, ChannelToggles> = {} as Record<
    NotificationCategory,
    ChannelToggles
  >;
  for (const c of NOTIFICATION_CATEGORIES) {
    cats[c] = {
      in_app: true,
      email: c === "deployment_failed" || c === "billing" || c === "ssl_expiration",
      webhook: false,
    };
  }
  return {
    user_id: userId,
    email_enabled: Boolean(email),
    email_address: email,
    webhook_enabled: false,
    webhook_url: null,
    digest_frequency: "instant",
    categories: cats,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Grouping
// ---------------------------------------------------------------------------

export type NotificationGroup = {
  key: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  count: number;
  unreadCount: number;
  latest: Notification;
  items: Notification[];
};

export function groupNotifications(
  items: Notification[],
): NotificationGroup[] {
  const map = new Map<string, NotificationGroup>();
  for (const n of items) {
    const key = n.group_key ?? `${n.category}:${n.title}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.items.push(n);
      bucket.count += 1;
      if (!n.read_at) bucket.unreadCount += 1;
      if (n.created_at > bucket.latest.created_at) bucket.latest = n;
      if (compareSeverity(n.severity, bucket.severity) > 0) bucket.severity = n.severity;
    } else {
      map.set(key, {
        key,
        category: n.category,
        severity: n.severity,
        count: 1,
        unreadCount: n.read_at ? 0 : 1,
        latest: n,
        items: [n],
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.latest.created_at.localeCompare(a.latest.created_at),
  );
}

export function unreadCount(items: Notification[]): number {
  let c = 0;
  for (const n of items) if (!n.read_at) c += 1;
  return c;
}

// ---------------------------------------------------------------------------
//  Simulator — rich, plausible event templates
// ---------------------------------------------------------------------------

type Template = {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  source: NotificationSource;
  href?: string;
  group?: string;
  operatorOnly?: boolean;
};

const TEMPLATES: Template[] = [
  // Deployment
  {
    category: "deployment",
    severity: "info",
    title: "Deployment started",
    body: "Project ${project} · branch ${branch} · commit ${commit}",
    source: "deploy_engine",
    href: "/dashboard/deployments",
    group: "deploy:${project}",
  },
  {
    category: "deployment",
    severity: "success",
    title: "Deployment promoted",
    body: "${project} is now live in ${region} (${dur}s).",
    source: "deploy_engine",
    href: "/dashboard/deployments",
    group: "deploy:${project}",
  },
  {
    category: "deployment_failed",
    severity: "error",
    title: "Deployment failed",
    body: "${project} · ${reason}. Last successful build retained.",
    source: "deploy_engine",
    href: "/dashboard/deployments",
    group: "deploy_fail:${project}",
  },
  {
    category: "deployment_failed",
    severity: "warn",
    title: "Build queued — slow",
    body: "${project} has been queued for ${dur}s — runtime fleet may be saturated.",
    source: "deploy_engine",
    href: "/dashboard/runtime",
    group: "deploy_queue:${project}",
  },

  // SSL
  {
    category: "ssl_expiration",
    severity: "warn",
    title: "Certificate expiring soon",
    body: "${domain} expires in ${days} days. Auto-renewal scheduled.",
    source: "ssl_monitor",
    href: "/dashboard/domains",
    group: "ssl:${domain}",
  },
  {
    category: "ssl_expiration",
    severity: "error",
    title: "Certificate renewal failed",
    body: "${domain} renewal failed (${reason}). Manual intervention recommended.",
    source: "ssl_monitor",
    href: "/dashboard/domains",
    group: "ssl:${domain}",
  },

  // DNS
  {
    category: "dns_verification",
    severity: "warn",
    title: "DNS verification pending",
    body: "${domain} CNAME record not detected yet. Re-checking in 5 min.",
    source: "dns_monitor",
    href: "/dashboard/domains",
    group: "dns:${domain}",
  },
  {
    category: "dns_verification",
    severity: "success",
    title: "Domain verified",
    body: "${domain} verified and routed through GTLNAV edge.",
    source: "dns_monitor",
    href: "/dashboard/domains",
    group: "dns:${domain}",
  },

  // Webhook
  {
    category: "webhook",
    severity: "info",
    title: "Deploy hook accepted",
    body: "Inbound webhook from ${origin} triggered ${project}.",
    source: "webhook_dispatch",
    href: "/dashboard/webhooks",
    group: "hook:${project}",
  },
  {
    category: "webhook",
    severity: "warn",
    title: "Webhook signature mismatch",
    body: "Rejected webhook from ${origin} — check shared secret.",
    source: "webhook_dispatch",
    href: "/dashboard/webhooks",
    group: "hook:${origin}",
  },

  // Usage
  {
    category: "usage",
    severity: "warn",
    title: "Bandwidth nearing quota",
    body: "Workspace at ${pct}% of bandwidth quota for the current period.",
    source: "usage_meter",
    href: "/dashboard/usage",
    group: "usage:bandwidth",
  },
  {
    category: "usage",
    severity: "error",
    title: "Build minutes exhausted",
    body: "Workspace exceeded build minutes — overages billed at $0.04/min.",
    source: "usage_meter",
    href: "/dashboard/usage",
    group: "usage:build_minutes",
  },

  // Billing
  {
    category: "billing",
    severity: "info",
    title: "Invoice issued",
    body: "Invoice ${invoice} for $${amount} is ready.",
    source: "billing",
    href: "/dashboard/billing",
    group: "billing:invoice",
  },
  {
    category: "billing",
    severity: "error",
    title: "Payment failed",
    body: "Card ending in ${last4} declined. Retry scheduled in ${days} day(s).",
    source: "billing",
    href: "/dashboard/billing",
    group: "billing:dunning",
  },
  {
    category: "billing",
    severity: "success",
    title: "Plan upgraded",
    body: "Workspace moved to ${plan}. Prorated charge: $${amount}.",
    source: "billing",
    href: "/dashboard/billing",
    group: "billing:plan",
  },

  // Infra
  {
    category: "infrastructure",
    severity: "warn",
    title: "Region degraded",
    body: "${region} edge p95 latency elevated to ${ms}ms.",
    source: "infrastructure",
    href: "/dashboard/infrastructure",
    group: "infra:${region}",
  },
  {
    category: "infrastructure",
    severity: "info",
    title: "Region restored",
    body: "${region} returned to nominal latency.",
    source: "infrastructure",
    href: "/dashboard/infrastructure",
    group: "infra:${region}",
  },

  // Operator-only
  {
    category: "operator",
    severity: "critical",
    title: "Suspected API abuse",
    body: "Tenant ${tenant} hit ${count} requests/min — auto rate-limit engaged.",
    source: "operator",
    href: "/admin/audit",
    operatorOnly: true,
  },
  {
    category: "operator",
    severity: "warn",
    title: "Quota offender escalated",
    body: "${tenant} sustained >100% bandwidth for 4 hours. Notify billing.",
    source: "operator",
    href: "/admin/usage",
    operatorOnly: true,
  },
];

const FAKE_PROJECTS = ["atlas-edge", "pulse-console", "helios-cdn", "kepler-app", "basil-runtime"];
const FAKE_DOMAINS = ["app.gtlnav.com", "edge.godtechlabs.com", "demo.acme.dev", "studio.gtlnav.io"];
const FAKE_REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"];
const FAKE_TENANTS = ["godtechlabs", "kepler-studios", "orbital-grid", "basil-runtime"];
const FAKE_REASONS = [
  "build script exited with code 1",
  "out of memory during build",
  "lockfile drift detected",
  "image pull failed",
];
const FAKE_ORIGINS = ["github / godtechlabs", "gitlab / acme", "deploy-hook · eyebrow"];
const FAKE_PLAN_LABELS = ["Pro", "Business", "Enterprise"];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(s: string): string {
  return s
    .replace(/\$\{project\}/g, pick(FAKE_PROJECTS))
    .replace(/\$\{branch\}/g, pick(["main", "preview", "feature/edge-cache", "feat/billing"]))
    .replace(/\$\{commit\}/g, Math.random().toString(16).slice(2, 9))
    .replace(/\$\{region\}/g, pick(FAKE_REGIONS))
    .replace(/\$\{dur\}/g, String(20 + Math.floor(Math.random() * 200)))
    .replace(/\$\{domain\}/g, pick(FAKE_DOMAINS))
    .replace(/\$\{days\}/g, String(1 + Math.floor(Math.random() * 14)))
    .replace(/\$\{reason\}/g, pick(FAKE_REASONS))
    .replace(/\$\{origin\}/g, pick(FAKE_ORIGINS))
    .replace(/\$\{pct\}/g, String(80 + Math.floor(Math.random() * 25)))
    .replace(/\$\{ms\}/g, String(180 + Math.floor(Math.random() * 320)))
    .replace(/\$\{count\}/g, String(2_000 + Math.floor(Math.random() * 30_000)))
    .replace(/\$\{tenant\}/g, pick(FAKE_TENANTS))
    .replace(/\$\{invoice\}/g, `INV-${20260101 + Math.floor(Math.random() * 30)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`)
    .replace(/\$\{amount\}/g, String((19 + Math.floor(Math.random() * 200)).toFixed(2)))
    .replace(/\$\{last4\}/g, String(4000 + Math.floor(Math.random() * 5999)))
    .replace(/\$\{plan\}/g, pick(FAKE_PLAN_LABELS));
}

export type GenerateOptions = {
  userId: string;
  /** Operator scope receives operator-only templates. */
  scope?: "user" | "operator";
};

export function generateNotification(opts: GenerateOptions): Notification {
  const tplPool = TEMPLATES.filter((t) =>
    opts.scope === "operator" ? true : !t.operatorOnly,
  );
  const tpl = pick(tplPool);
  const body = fillTemplate(tpl.body);
  const title = fillTemplate(tpl.title);
  const group = tpl.group ? fillTemplate(tpl.group) : null;
  return {
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: opts.userId,
    category: tpl.category,
    severity: tpl.severity,
    title,
    body,
    href: tpl.href ?? null,
    group_key: group,
    read_at: null,
    created_at: new Date().toISOString(),
    source: tpl.source,
  };
}

export function generateBurst(
  opts: GenerateOptions & { count?: number; spreadMs?: number },
): Notification[] {
  const count = opts.count ?? 14;
  const spread = opts.spreadMs ?? 90 * 60_000; // 90 min
  const out: Notification[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = generateNotification(opts);
    const offset = Math.floor((i / count) * spread);
    const t = new Date(Date.now() - offset).toISOString();
    out.push({
      ...n,
      created_at: t,
      // Mark a few older ones as read so the UI shows mixed states.
      read_at: i > count - 4 ? t : null,
    });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
//  Channel dispatch architecture (stubs)
// ---------------------------------------------------------------------------

export type ChannelDispatchPlan = {
  channel: NotificationChannel;
  willSend: boolean;
  reason: string;
};

/**
 * Computes — without sending — which channels would fire for a given
 * notification under the user's current preferences. Real dispatch lives in
 * a server worker (future).
 */
export function planChannelDispatch(
  notification: Pick<Notification, "category" | "severity">,
  prefs: NotificationPreferences,
): ChannelDispatchPlan[] {
  const cat = prefs.categories[notification.category] ?? {
    in_app: true,
    email: false,
    webhook: false,
  };
  return [
    {
      channel: "in_app",
      willSend: cat.in_app && prefs.digest_frequency !== "off",
      reason: cat.in_app ? "category enabled" : "category disabled",
    },
    {
      channel: "email",
      willSend:
        prefs.email_enabled &&
        cat.email &&
        prefs.digest_frequency === "instant" &&
        Boolean(prefs.email_address),
      reason: !prefs.email_enabled
        ? "email disabled"
        : !cat.email
          ? "category email off"
          : prefs.digest_frequency !== "instant"
            ? `digest=${prefs.digest_frequency}`
            : !prefs.email_address
              ? "no address"
              : "ready",
    },
    {
      channel: "webhook",
      willSend:
        prefs.webhook_enabled &&
        cat.webhook &&
        Boolean(prefs.webhook_url) &&
        prefs.digest_frequency === "instant",
      reason: !prefs.webhook_enabled
        ? "webhook disabled"
        : !cat.webhook
          ? "category webhook off"
          : !prefs.webhook_url
            ? "no url"
            : prefs.digest_frequency !== "instant"
              ? `digest=${prefs.digest_frequency}`
              : "ready",
    },
  ];
}

// ---------------------------------------------------------------------------
//  Time formatting helpers
// ---------------------------------------------------------------------------

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

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
