/**
 * GTLNAV — Enterprise Security Layer (Phase 4J).
 *
 * Architecture-only foundation for:
 *   • MFA enrollment + recovery codes
 *   • SSO / SAML 2.0 + OIDC bridges (workspace-scoped IdP)
 *   • Session lifecycle, revoke, device fingerprinting
 *   • Trusted devices + per-device approval
 *   • IP allowlists (CIDR-based, per-workspace)
 *   • Login audit, API key audit, webhook security, deploy hook rotation
 *   • Role audit trail
 *   • Suspicious activity detection (rule-based threat score 0..100)
 *   • Workspace security policies
 *   • Operator-only: global threat dashboard, abuse detection, action audit
 *
 * Persistence model uses four tables (DDL exported below):
 *   - security_events       — append-only audit ledger
 *   - login_sessions        — current + historical sessions
 *   - trusted_devices       — long-lived per-user devices
 *   - workspace_security    — per-workspace policy row
 */

// ---------------------------------------------------------------------------
//  Severity model
// ---------------------------------------------------------------------------

export type SecuritySeverity = "info" | "low" | "medium" | "high" | "critical";

export const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function severityTone(s: SecuritySeverity): {
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
    case "high":
      return {
        ring: "border-rose-400/40 bg-rose-500/12",
        text: "text-rose-200",
        dot: "bg-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.95)]",
        bar: "bg-gradient-to-b from-rose-300 via-rose-400 to-rose-500",
        label: "High",
      };
    case "medium":
      return {
        ring: "border-amber-400/40 bg-amber-500/12",
        text: "text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)]",
        bar: "bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500",
        label: "Medium",
      };
    case "low":
      return {
        ring: "border-cyan-400/35 bg-cyan-500/10",
        text: "text-cyan-100",
        dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)]",
        bar: "bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500",
        label: "Low",
      };
    default:
      return {
        ring: "border-white/15 bg-white/[0.04]",
        text: "text-white/70",
        dot: "bg-white/45",
        bar: "bg-gradient-to-b from-white/15 via-white/25 to-white/35",
        label: "Info",
      };
  }
}

// ---------------------------------------------------------------------------
//  Event taxonomy
// ---------------------------------------------------------------------------

export const SECURITY_EVENT_KINDS = [
  "login_success",
  "login_failed",
  "login_blocked",
  "mfa_enrolled",
  "mfa_disabled",
  "mfa_challenge",
  "mfa_failed",
  "session_revoked",
  "session_expired",
  "device_trusted",
  "device_revoked",
  "ip_allowlist_changed",
  "ip_allowlist_block",
  "api_key_created",
  "api_key_revoked",
  "api_key_used",
  "deploy_hook_rotated",
  "webhook_verified",
  "webhook_signature_failed",
  "role_changed",
  "role_demoted",
  "role_promoted",
  "sso_enabled",
  "sso_login",
  "saml_metadata_updated",
  "suspicious_activity",
  "operator_action",
  "abuse_detected",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export type SecurityEventCategory =
  | "auth"
  | "session"
  | "device"
  | "network"
  | "api"
  | "webhook"
  | "role"
  | "sso"
  | "operator"
  | "threat";

export const EVENT_META: Record<
  SecurityEventKind,
  {
    label: string;
    category: SecurityEventCategory;
    defaultSeverity: SecuritySeverity;
    /** Free-form description used in event detail and UI. */
    description: string;
    /** Whether this event surfaces in the user dashboard (false = operator-only). */
    userVisible: boolean;
  }
> = {
  login_success: { label: "Login success", category: "auth", defaultSeverity: "info", description: "Successful sign-in.", userVisible: true },
  login_failed: { label: "Login failed", category: "auth", defaultSeverity: "low", description: "Invalid credentials.", userVisible: true },
  login_blocked: { label: "Login blocked", category: "auth", defaultSeverity: "high", description: "Login blocked by allowlist or velocity rule.", userVisible: true },
  mfa_enrolled: { label: "MFA enrolled", category: "auth", defaultSeverity: "info", description: "Authenticator device enrolled.", userVisible: true },
  mfa_disabled: { label: "MFA disabled", category: "auth", defaultSeverity: "high", description: "Authenticator disabled — recommend re-enrolment.", userVisible: true },
  mfa_challenge: { label: "MFA challenge", category: "auth", defaultSeverity: "info", description: "Second factor challenged.", userVisible: true },
  mfa_failed: { label: "MFA failed", category: "auth", defaultSeverity: "medium", description: "Incorrect second factor.", userVisible: true },
  session_revoked: { label: "Session revoked", category: "session", defaultSeverity: "info", description: "Session ended by user or operator.", userVisible: true },
  session_expired: { label: "Session expired", category: "session", defaultSeverity: "info", description: "Session reached max idle.", userVisible: true },
  device_trusted: { label: "Device trusted", category: "device", defaultSeverity: "info", description: "New device approved.", userVisible: true },
  device_revoked: { label: "Device revoked", category: "device", defaultSeverity: "info", description: "Device removed from trusted list.", userVisible: true },
  ip_allowlist_changed: { label: "IP allowlist changed", category: "network", defaultSeverity: "medium", description: "Allowlist policy updated.", userVisible: true },
  ip_allowlist_block: { label: "IP blocked", category: "network", defaultSeverity: "high", description: "Request blocked by allowlist.", userVisible: true },
  api_key_created: { label: "API key created", category: "api", defaultSeverity: "info", description: "New API key issued.", userVisible: true },
  api_key_revoked: { label: "API key revoked", category: "api", defaultSeverity: "info", description: "API key revoked.", userVisible: true },
  api_key_used: { label: "API key used", category: "api", defaultSeverity: "info", description: "API key used for a request.", userVisible: true },
  deploy_hook_rotated: { label: "Deploy hook rotated", category: "webhook", defaultSeverity: "info", description: "Deploy hook secret rotated.", userVisible: true },
  webhook_verified: { label: "Webhook verified", category: "webhook", defaultSeverity: "info", description: "Inbound webhook passed signature check.", userVisible: true },
  webhook_signature_failed: { label: "Webhook signature failed", category: "webhook", defaultSeverity: "high", description: "Inbound webhook failed signature.", userVisible: true },
  role_changed: { label: "Role changed", category: "role", defaultSeverity: "medium", description: "Member role updated.", userVisible: true },
  role_demoted: { label: "Role demoted", category: "role", defaultSeverity: "info", description: "Member privileges reduced.", userVisible: true },
  role_promoted: { label: "Role promoted", category: "role", defaultSeverity: "medium", description: "Member privileges elevated.", userVisible: true },
  sso_enabled: { label: "SSO enabled", category: "sso", defaultSeverity: "info", description: "SAML or OIDC enabled.", userVisible: true },
  sso_login: { label: "SSO login", category: "sso", defaultSeverity: "info", description: "Logged in via SSO.", userVisible: true },
  saml_metadata_updated: { label: "SAML metadata updated", category: "sso", defaultSeverity: "medium", description: "IdP metadata refreshed.", userVisible: true },
  suspicious_activity: { label: "Suspicious activity", category: "threat", defaultSeverity: "high", description: "Heuristic detected anomalous behavior.", userVisible: true },
  operator_action: { label: "Operator action", category: "operator", defaultSeverity: "medium", description: "Action taken from the operator console.", userVisible: false },
  abuse_detected: { label: "Abuse detected", category: "threat", defaultSeverity: "critical", description: "Tenant flagged for abuse.", userVisible: false },
};

export type SecurityEvent = {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  /** Where the event originated (UI source, IP, region). */
  ip: string | null;
  user_agent: string | null;
  region: string | null;
  /** Linked actor identity for operator events (admin uid). */
  actor_id: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
//  Sessions
// ---------------------------------------------------------------------------

export type LoginSession = {
  id: string;
  user_id: string;
  current: boolean;
  /** Friendly device label like "MacBook Pro · Chrome 130". */
  device_label: string;
  device_id: string | null;
  user_agent: string;
  ip: string;
  region: string;
  /** When session was issued. */
  issued_at: string;
  /** Last seen (heartbeat). */
  last_seen_at: string;
  /** When session naturally expires. */
  expires_at: string;
  revoked_at: string | null;
  /** SSO provider, if any. */
  sso_provider: string | null;
  mfa_satisfied: boolean;
};

// ---------------------------------------------------------------------------
//  Trusted devices
// ---------------------------------------------------------------------------

export type TrustedDevice = {
  id: string;
  user_id: string;
  /** Sticky id derived from a fingerprint cookie. */
  device_id: string;
  label: string;
  os: string;
  browser: string;
  /** First time the device was seen. */
  first_seen_at: string;
  last_seen_at: string;
  trusted_at: string | null;
  ip: string;
  region: string;
  revoked_at: string | null;
};

// ---------------------------------------------------------------------------
//  Workspace policy
// ---------------------------------------------------------------------------

export type WorkspaceSecurity = {
  workspace_id: string;
  mfa_required: boolean;
  /** Hours until idle session ends. */
  session_idle_hours: number;
  /** Hours until any session expires regardless of activity. */
  session_max_hours: number;
  ip_allowlist_enabled: boolean;
  /** CIDR ranges. */
  ip_allowlist: string[];
  sso_enabled: boolean;
  sso_kind: "saml" | "oidc" | null;
  sso_entity_id: string | null;
  sso_acs_url: string | null;
  sso_metadata_url: string | null;
  webhook_verify_signatures: boolean;
  webhook_min_signature_version: "v1" | "v2";
  api_key_max_age_days: number;
  audit_retention_days: number;
  /** Suspicious-activity threshold (0..100); events at-or-above auto-alert. */
  threat_alert_threshold: number;
  updated_at: string;
};

export function defaultWorkspaceSecurity(workspaceId: string): WorkspaceSecurity {
  return {
    workspace_id: workspaceId,
    mfa_required: false,
    session_idle_hours: 24,
    session_max_hours: 24 * 30,
    ip_allowlist_enabled: false,
    ip_allowlist: [],
    sso_enabled: false,
    sso_kind: null,
    sso_entity_id: null,
    sso_acs_url: null,
    sso_metadata_url: null,
    webhook_verify_signatures: true,
    webhook_min_signature_version: "v2",
    api_key_max_age_days: 365,
    audit_retention_days: 365,
    threat_alert_threshold: 60,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Threat scoring
// ---------------------------------------------------------------------------

export type ThreatRule = {
  id: string;
  label: string;
  weight: number;
  /** Pure check against a recent window of events. */
  match: (events: SecurityEvent[]) => boolean;
  description: string;
};

export const THREAT_RULES: ThreatRule[] = [
  {
    id: "many_failed_logins",
    label: "5+ failed logins in 1h",
    weight: 22,
    description: "Brute force attempt or stuffed credentials.",
    match: (events) =>
      events.filter((e) => e.kind === "login_failed").length >= 5,
  },
  {
    id: "impossible_travel",
    label: "Impossible-travel logins",
    weight: 30,
    description: "Successful logins from regions too far apart in too little time.",
    match: (events) => {
      const successes = events.filter((e) => e.kind === "login_success" && e.region);
      const regions = new Set(successes.map((s) => s.region as string));
      return successes.length >= 2 && regions.size >= 2;
    },
  },
  {
    id: "mfa_failed_burst",
    label: "MFA failures > 3",
    weight: 18,
    description: "Repeated second factor failures.",
    match: (events) => events.filter((e) => e.kind === "mfa_failed").length > 3,
  },
  {
    id: "webhook_sig_failed",
    label: "Webhook signature failures",
    weight: 14,
    description: "Inbound webhooks repeatedly fail verification.",
    match: (events) =>
      events.filter((e) => e.kind === "webhook_signature_failed").length >= 3,
  },
  {
    id: "ip_allowlist_block",
    label: "Allowlist blocks",
    weight: 10,
    description: "Requests blocked by IP allowlist.",
    match: (events) =>
      events.some((e) => e.kind === "ip_allowlist_block"),
  },
  {
    id: "role_promotion",
    label: "Role escalations",
    weight: 8,
    description: "Privileges elevated.",
    match: (events) => events.some((e) => e.kind === "role_promoted"),
  },
  {
    id: "mfa_disabled",
    label: "MFA disabled recently",
    weight: 12,
    description: "MFA disabled for an account in the last hour.",
    match: (events) => events.some((e) => e.kind === "mfa_disabled"),
  },
];

export type ThreatAssessment = {
  score: number;
  severity: SecuritySeverity;
  matched: ThreatRule[];
};

export function assessThreat(events: SecurityEvent[]): ThreatAssessment {
  const matched = THREAT_RULES.filter((r) => r.match(events));
  const raw = matched.reduce((sum, r) => sum + r.weight, 0);
  const score = Math.min(100, raw);
  const severity: SecuritySeverity =
    score >= 75 ? "critical" : score >= 55 ? "high" : score >= 30 ? "medium" : score > 0 ? "low" : "info";
  return { score, severity, matched };
}

// ---------------------------------------------------------------------------
//  Sample data + simulators
// ---------------------------------------------------------------------------

const FAKE_REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1", "sa-east-1", "eu-central-1"];
const FAKE_DEVICES = [
  { label: "MacBook Pro · Chrome 130", os: "macOS 15.1", browser: "Chrome 130" },
  { label: "iPhone 15 Pro · Safari", os: "iOS 18.0", browser: "Safari 18" },
  { label: "Windows 11 · Edge 131", os: "Windows 11", browser: "Edge 131" },
  { label: "Pixel 8 · Chrome", os: "Android 15", browser: "Chrome 131" },
  { label: "Linux · Firefox 132", os: "Ubuntu 24.04", browser: "Firefox 132" },
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function randIp(): string {
  return `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
}

function offsetTime(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export type GenerateOpts = {
  userId: string;
  workspaceId?: string | null;
  scope?: "user" | "operator";
};

export function generateLoginSessions(opts: GenerateOpts & { count?: number }): LoginSession[] {
  const count = opts.count ?? 4;
  const list: LoginSession[] = [];
  for (let i = 0; i < count; i += 1) {
    const dev = pick(FAKE_DEVICES);
    const issued = offsetTime((i + 1) * 60 + Math.floor(Math.random() * 200));
    list.push({
      id: newId("ses"),
      user_id: opts.userId,
      current: i === 0,
      device_label: dev.label,
      device_id: `dev_${Math.random().toString(36).slice(2, 10)}`,
      user_agent: `Mozilla/5.0 (${dev.os}) ${dev.browser}`,
      ip: randIp(),
      region: pick(FAKE_REGIONS),
      issued_at: issued,
      last_seen_at: i === 0 ? new Date().toISOString() : offsetTime(i * 30),
      expires_at: new Date(Date.now() + (i === 0 ? 24 : 4) * 3_600_000).toISOString(),
      revoked_at: null,
      sso_provider: i === 1 ? "okta" : null,
      mfa_satisfied: i === 0 ? true : Math.random() > 0.3,
    });
  }
  return list;
}

export function generateTrustedDevices(opts: GenerateOpts & { count?: number }): TrustedDevice[] {
  const count = opts.count ?? 3;
  const list: TrustedDevice[] = [];
  for (let i = 0; i < count; i += 1) {
    const dev = pick(FAKE_DEVICES);
    const seenAgo = (i + 1) * 60 * 24;
    list.push({
      id: newId("dev"),
      user_id: opts.userId,
      device_id: `dev_${Math.random().toString(36).slice(2, 12)}`,
      label: dev.label,
      os: dev.os,
      browser: dev.browser,
      first_seen_at: offsetTime(seenAgo + 600),
      last_seen_at: i === 0 ? new Date().toISOString() : offsetTime(i * 360),
      trusted_at: i === 0 ? offsetTime(seenAgo) : i === 1 ? offsetTime(seenAgo) : null,
      ip: randIp(),
      region: pick(FAKE_REGIONS),
      revoked_at: null,
    });
  }
  return list;
}

type EventTpl = {
  kind: SecurityEventKind;
  format: (ctx: { ip: string; region: string; ua: string }) => string;
  severityOverride?: SecuritySeverity;
};

const USER_EVENT_TEMPLATES: EventTpl[] = [
  { kind: "login_success", format: (c) => `Logged in from ${c.region} (${c.ip}).` },
  { kind: "login_failed", format: () => "Invalid password." },
  { kind: "mfa_challenge", format: () => "TOTP requested." },
  { kind: "mfa_failed", format: () => "TOTP code rejected." },
  { kind: "session_revoked", format: () => "Revoked stale session." },
  { kind: "device_trusted", format: (c) => `Marked ${c.region} device as trusted.` },
  { kind: "ip_allowlist_changed", format: () => "Added 203.0.113.0/24 to allowlist." },
  { kind: "ip_allowlist_block", format: (c) => `Blocked request from ${c.ip} (${c.region}).` },
  { kind: "api_key_created", format: () => "Created API key gtl_••••2c4f for production." },
  { kind: "api_key_used", format: (c) => `gtl_••••2c4f used from ${c.region}.` },
  { kind: "api_key_revoked", format: () => "Revoked API key gtl_••••a91b." },
  { kind: "deploy_hook_rotated", format: () => "Rotated deploy hook secret for atlas-edge." },
  { kind: "webhook_verified", format: () => "Inbound webhook signature verified (v2)." },
  { kind: "webhook_signature_failed", format: () => "Inbound webhook signature verification failed." },
  { kind: "role_changed", format: () => "Changed marina@ from developer → admin.", severityOverride: "medium" },
  { kind: "sso_login", format: () => "Signed in via Okta SSO." },
];

const OPERATOR_EVENT_TEMPLATES: EventTpl[] = [
  ...USER_EVENT_TEMPLATES,
  { kind: "operator_action", format: () => "Operator forced session revoke for tenant tnt_atlas." },
  { kind: "abuse_detected", format: (c) => `Tenant tnt_atlas hit 12,000 req/min from ${c.region}.`, severityOverride: "critical" },
  { kind: "suspicious_activity", format: (c) => `Impossible-travel sign-in from ${c.region}.`, severityOverride: "high" },
];

export function generateSecurityEvents(
  opts: GenerateOpts & { count?: number },
): SecurityEvent[] {
  const count = opts.count ?? 32;
  const pool = opts.scope === "operator" ? OPERATOR_EVENT_TEMPLATES : USER_EVENT_TEMPLATES;
  const out: SecurityEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const tpl = pick(pool);
    const meta = EVENT_META[tpl.kind];
    const ctx = { ip: randIp(), region: pick(FAKE_REGIONS), ua: pick(FAKE_DEVICES).browser };
    const sev: SecuritySeverity = tpl.severityOverride ?? meta.defaultSeverity;
    out.push({
      id: newId("sec"),
      user_id: opts.userId,
      workspace_id: opts.workspaceId ?? null,
      kind: tpl.kind,
      severity: sev,
      ip: ctx.ip,
      user_agent: ctx.ua,
      region: ctx.region,
      actor_id: meta.category === "operator" ? `op_${Math.random().toString(36).slice(2, 7)}` : null,
      message: tpl.format(ctx),
      created_at: offsetTime(i * (4 + Math.floor(Math.random() * 18))),
    });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function tickSecurityEvent(opts: GenerateOpts): SecurityEvent | null {
  if (Math.random() > 0.6) return null;
  const pool = opts.scope === "operator" ? OPERATOR_EVENT_TEMPLATES : USER_EVENT_TEMPLATES;
  const tpl = pick(pool);
  const meta = EVENT_META[tpl.kind];
  const ctx = { ip: randIp(), region: pick(FAKE_REGIONS), ua: pick(FAKE_DEVICES).browser };
  const sev: SecuritySeverity = tpl.severityOverride ?? meta.defaultSeverity;
  return {
    id: newId("sec"),
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    kind: tpl.kind,
    severity: sev,
    ip: ctx.ip,
    user_agent: ctx.ua,
    region: ctx.region,
    actor_id: meta.category === "operator" ? `op_${Math.random().toString(36).slice(2, 7)}` : null,
    message: tpl.format(ctx),
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  CIDR validation (IP allowlist)
// ---------------------------------------------------------------------------

export function isValidCidr(input: string): boolean {
  // Simple IPv4 / IPv6-prefix CIDR validation.
  const t = input.trim();
  const v4 = /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/(3[0-2]|[12]?\d))?$/;
  const v6 = /^[a-fA-F0-9:]+(\/(12[0-8]|1[01]\d|\d?\d))?$/;
  if (v4.test(t)) {
    const [ip] = t.split("/");
    return ip.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  return v6.test(t);
}

// ---------------------------------------------------------------------------
//  MFA / SSO architecture stubs
// ---------------------------------------------------------------------------

export type MfaStatus = {
  enrolled: boolean;
  method: "totp" | "webauthn" | "sms" | null;
  backup_codes_remaining: number;
  last_verified_at: string | null;
};

export function defaultMfaStatus(): MfaStatus {
  return {
    enrolled: false,
    method: null,
    backup_codes_remaining: 0,
    last_verified_at: null,
  };
}

export type SsoProviderKind = "saml" | "oidc";

export type SsoProviderTemplate = {
  id: string;
  name: string;
  kind: SsoProviderKind;
  entityIdHint: string;
  blurb: string;
};

export const SSO_PROVIDERS: SsoProviderTemplate[] = [
  { id: "okta", name: "Okta", kind: "saml", entityIdHint: "https://www.okta.com/saml2/...", blurb: "SAML 2.0 with optional SCIM provisioning." },
  { id: "azure-ad", name: "Microsoft Entra ID", kind: "saml", entityIdHint: "https://sts.windows.net/{tenant}/", blurb: "SAML 2.0 + group claims." },
  { id: "google", name: "Google Workspace", kind: "saml", entityIdHint: "https://accounts.google.com/o/saml2?idpid=...", blurb: "SAML SSO scoped to your domain." },
  { id: "auth0", name: "Auth0 / OIDC", kind: "oidc", entityIdHint: "https://{tenant}.auth0.com/.well-known/openid-configuration", blurb: "OIDC bridge — discovery + JWKS." },
  { id: "github", name: "GitHub OIDC", kind: "oidc", entityIdHint: "https://token.actions.githubusercontent.com", blurb: "OIDC bridge for workload identity." },
];

// ---------------------------------------------------------------------------
//  Time helpers
// ---------------------------------------------------------------------------

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
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

// ---------------------------------------------------------------------------
//  Operator aggregations (admin dashboard)
// ---------------------------------------------------------------------------

export type TenantThreatRow = {
  tenant_id: string;
  tenant_label: string;
  active_users: number;
  events_24h: number;
  threat: ThreatAssessment;
  last_event_at: string | null;
};

const FAKE_TENANTS = [
  "godtechlabs",
  "atlas-edge",
  "kepler-studios",
  "orbital-grid",
  "basil-runtime",
  "helios-cdn",
];

export function generateOperatorTenants(): TenantThreatRow[] {
  return FAKE_TENANTS.map((id) => {
    const events = generateSecurityEvents({
      userId: `tenant_owner_${id}`,
      workspaceId: id,
      scope: "operator",
      count: 18 + Math.floor(Math.random() * 12),
    });
    const threat = assessThreat(events.slice(0, 30));
    return {
      tenant_id: id,
      tenant_label: id.replace(/-/g, " "),
      active_users: 4 + Math.floor(Math.random() * 90),
      events_24h: events.length,
      threat,
      last_event_at: events[0]?.created_at ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
//  DDL — security_events / login_sessions / trusted_devices / workspace_security
// ---------------------------------------------------------------------------

export const SECURITY_SCHEMA_SQL = `-- GTLNAV — Enterprise Security Layer (Phase 4J)

create table if not exists public.security_events (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete set null,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  kind          text not null,
  severity      text not null,
  ip            inet,
  user_agent    text,
  region        text,
  actor_id      text,
  message       text not null,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists security_events_user_created_idx
  on public.security_events (user_id, created_at desc);
create index if not exists security_events_workspace_created_idx
  on public.security_events (workspace_id, created_at desc);
create index if not exists security_events_kind_idx
  on public.security_events (kind, created_at desc);

alter table public.security_events enable row level security;

create policy "security_events_owner_select"
  on public.security_events for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = security_events.workspace_id
        and m.user_id = auth.uid()
    )
  );

create policy "security_events_admin_select"
  on public.security_events for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','super_admin')
    )
  );

create table if not exists public.login_sessions (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_id     text,
  device_label  text not null,
  user_agent    text not null default '',
  ip            inet,
  region        text,
  current       boolean not null default false,
  issued_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  sso_provider  text,
  mfa_satisfied boolean not null default false
);

create index if not exists login_sessions_user_issued_idx
  on public.login_sessions (user_id, issued_at desc);

alter table public.login_sessions enable row level security;

create policy "login_sessions_owner_all"
  on public.login_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.trusted_devices (
  id             text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  device_id      text not null,
  label          text not null,
  os             text not null default '',
  browser        text not null default '',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  trusted_at     timestamptz,
  ip             inet,
  region         text,
  revoked_at     timestamptz
);

create unique index if not exists trusted_devices_user_device_uniq
  on public.trusted_devices (user_id, device_id);

alter table public.trusted_devices enable row level security;

create policy "trusted_devices_owner_all"
  on public.trusted_devices for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.workspace_security (
  workspace_id                  uuid primary key references public.workspaces(id) on delete cascade,
  mfa_required                  boolean not null default false,
  session_idle_hours            int not null default 24,
  session_max_hours             int not null default 720,
  ip_allowlist_enabled          boolean not null default false,
  ip_allowlist                  jsonb not null default '[]'::jsonb,
  sso_enabled                   boolean not null default false,
  sso_kind                      text,
  sso_entity_id                 text,
  sso_acs_url                   text,
  sso_metadata_url              text,
  webhook_verify_signatures     boolean not null default true,
  webhook_min_signature_version text not null default 'v2',
  api_key_max_age_days          int not null default 365,
  audit_retention_days          int not null default 365,
  threat_alert_threshold        int not null default 60,
  updated_at                    timestamptz not null default now()
);

alter table public.workspace_security enable row level security;

create policy "workspace_security_member_select"
  on public.workspace_security for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_security.workspace_id
        and m.user_id = auth.uid()
    )
  );

create policy "workspace_security_admin_upsert"
  on public.workspace_security for insert
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_security.workspace_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

create policy "workspace_security_admin_update"
  on public.workspace_security for update
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_security.workspace_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );
`;

// ---------------------------------------------------------------------------
//  Convenience formatters
// ---------------------------------------------------------------------------

export function categoryLabel(c: SecurityEventCategory): string {
  switch (c) {
    case "auth":
      return "Auth";
    case "session":
      return "Session";
    case "device":
      return "Device";
    case "network":
      return "Network";
    case "api":
      return "API";
    case "webhook":
      return "Webhook";
    case "role":
      return "Role";
    case "sso":
      return "SSO";
    case "operator":
      return "Operator";
    case "threat":
      return "Threat";
  }
}

export function maskIp(ip: string | null): string {
  if (!ip) return "—";
  if (ip.includes(":")) return ip;
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.•••`;
}
