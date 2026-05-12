"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import {
  FingerprintIcon,
  KeyIcon,
  LockIcon,
  ShieldIcon,
  WebhookIcon,
} from "@/src/components/ui/icons";
import {
  EVENT_META,
  SECURITY_SCHEMA_SQL,
  SSO_PROVIDERS,
  absoluteTime,
  assessThreat,
  categoryLabel,
  defaultMfaStatus,
  defaultWorkspaceSecurity,
  generateLoginSessions,
  generateSecurityEvents,
  generateTrustedDevices,
  isValidCidr,
  maskIp,
  relativeTime,
  severityTone,
  tickSecurityEvent,
  type LoginSession,
  type MfaStatus,
  type SecurityEvent,
  type SecurityEventCategory,
  type SecuritySeverity,
  type SsoProviderTemplate,
  type ThreatAssessment,
  type TrustedDevice,
  type WorkspaceSecurity,
} from "@/src/lib/security";

const STORE_KEY = "gtlnav.security.v1";
const POLL_MS = 7_000;

type LoadState = "loading" | "ready" | "redirect";
type Toast = { tone: "success" | "error" | "info"; text: string } | null;

type StoredState = {
  userId: string;
  events: SecurityEvent[];
  sessions: LoginSession[];
  devices: TrustedDevice[];
  policy: WorkspaceSecurity;
  mfa: MfaStatus;
};

function readStore(userId: string): StoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(s: StoredState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ ...s, events: s.events.slice(0, 200) }),
    );
  } catch {
    /* no-op */
  }
}

type CategoryFilter = "all" | SecurityEventCategory;

export default function SecurityClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [policy, setPolicy] = useState<WorkspaceSecurity | null>(null);
  const [mfa, setMfa] = useState<MfaStatus>(defaultMfaStatus());
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [toast, setToast] = useState<Toast>(null);
  const tickRef = useRef<number | null>(null);

  const flashToast = useCallback((tone: NonNullable<Toast>["tone"], text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/security");
        return;
      }
      setSession(data.session);
      setLoadState("ready");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/security");
        return;
      }
      setSession(next);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  // Hydrate / seed
  useEffect(() => {
    if (!session) return;
    const cached = readStore(session.user.id);
    if (cached) {
      setEvents(cached.events);
      setSessions(cached.sessions);
      setDevices(cached.devices);
      setPolicy(cached.policy);
      setMfa(cached.mfa);
      return;
    }
    const seededEvents = generateSecurityEvents({
      userId: session.user.id,
      workspaceId: "ws_demo",
      scope: "user",
      count: 36,
    });
    const seededSessions = generateLoginSessions({ userId: session.user.id, count: 4 });
    const seededDevices = generateTrustedDevices({ userId: session.user.id, count: 3 });
    const seededPolicy = defaultWorkspaceSecurity("ws_demo");
    const seededMfa: MfaStatus = {
      enrolled: true,
      method: "totp",
      backup_codes_remaining: 6,
      last_verified_at: new Date().toISOString(),
    };
    setEvents(seededEvents);
    setSessions(seededSessions);
    setDevices(seededDevices);
    setPolicy(seededPolicy);
    setMfa(seededMfa);
    writeStore({
      userId: session.user.id,
      events: seededEvents,
      sessions: seededSessions,
      devices: seededDevices,
      policy: seededPolicy,
      mfa: seededMfa,
    });
  }, [session]);

  // Persist
  useEffect(() => {
    if (!session || !policy) return;
    writeStore({
      userId: session.user.id,
      events,
      sessions,
      devices,
      policy,
      mfa,
    });
  }, [session, events, sessions, devices, policy, mfa]);

  // Live event stream
  useEffect(() => {
    if (loadState !== "ready" || !session) return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const ev = tickSecurityEvent({
        userId: session.user.id,
        workspaceId: "ws_demo",
        scope: "user",
      });
      if (ev) {
        setEvents((prev) => [ev, ...prev].slice(0, 200));
      }
    }, POLL_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [loadState, session]);

  // Actions
  const revokeSession = useCallback((id: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, revoked_at: new Date().toISOString() } : s,
      ),
    );
    flashToast("success", "Session revoked.");
  }, [flashToast]);

  const trustDevice = useCallback((id: string) => {
    setDevices((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, trusted_at: new Date().toISOString() } : d,
      ),
    );
    flashToast("success", "Device trusted.");
  }, [flashToast]);

  const revokeDevice = useCallback((id: string) => {
    setDevices((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, revoked_at: new Date().toISOString(), trusted_at: null } : d,
      ),
    );
    flashToast("info", "Device revoked.");
  }, [flashToast]);

  const handleEnroll = useCallback(() => {
    setMfa({
      enrolled: true,
      method: "totp",
      backup_codes_remaining: 8,
      last_verified_at: new Date().toISOString(),
    });
    flashToast("success", "MFA enrolled (sim). Save your backup codes.");
  }, [flashToast]);

  const handleDisableMfa = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Disable MFA? You will only have a password.")) return;
    setMfa({ enrolled: false, method: null, backup_codes_remaining: 0, last_verified_at: null });
    flashToast("info", "MFA disabled.");
  }, [flashToast]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  // Derived
  const activeSessions = useMemo(
    () => sessions.filter((s) => !s.revoked_at),
    [sessions],
  );
  const recentEvents = useMemo(() => events.slice(0, 60), [events]);
  const filteredEvents = useMemo(() => {
    if (filter === "all") return recentEvents;
    return recentEvents.filter((e) => EVENT_META[e.kind].category === filter);
  }, [recentEvents, filter]);
  const threat = useMemo<ThreatAssessment>(() => assessThreat(events.slice(0, 30)), [events]);
  const counts = useMemo(() => {
    const map: Record<SecurityEventCategory, number> = {
      auth: 0, session: 0, device: 0, network: 0, api: 0, webhook: 0, role: 0, sso: 0, operator: 0, threat: 0,
    };
    for (const e of recentEvents) map[EVENT_META[e.kind].category] += 1;
    return map;
  }, [recentEvents]);

  if (loadState === "loading") return <FullPageMessage label="Verifying session…" />;
  if (loadState === "redirect" || !session || !policy) return <FullPageMessage label="Redirecting…" />;

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
        <DashboardSidebar activeKey="security" userEmail={session.user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // enterprise security
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span className={`grid h-10 w-10 place-items-center rounded-2xl border ${severityTone(threat.severity).ring} ${severityTone(threat.severity).text}`}>
                  <LockIcon className="h-5 w-5" title="Security" />
                </span>
                Security center
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                MFA, SSO/SAML, sessions, devices, IP allowlists, API keys, webhook
                signatures, and a realtime threat score. Workspace policy below
                enforces what's required for the org.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThreatPill threat={threat} />
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          <SummaryGrid
            mfa={mfa}
            sessions={activeSessions.length}
            devices={devices.filter((d) => d.trusted_at && !d.revoked_at).length}
            threat={threat}
          />

          <section className="mt-8 grid gap-4 lg:grid-cols-2">
            <MfaCard mfa={mfa} onEnroll={handleEnroll} onDisable={handleDisableMfa} />
            <SsoCard policy={policy} onChange={setPolicy} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <SessionsCard sessions={sessions} onRevoke={revokeSession} />
            <DevicesCard devices={devices} onTrust={trustDevice} onRevoke={revokeDevice} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <IpAllowlistCard policy={policy} onChange={setPolicy} />
            <PolicyCard policy={policy} onChange={setPolicy} />
          </section>

          <section className="mt-6">
            <EventsCard
              events={filteredEvents}
              filter={filter}
              counts={counts}
              onFilterChange={setFilter}
            />
          </section>

          <section className="mt-6">
            <SchemaSetupCard />
          </section>

          <footer className="mt-10 border-t border-white/5 pt-5 text-[10px] uppercase tracking-[0.2em] text-white/35">
            // GTLNAV security plane · MFA · SSO · device trust · policy · audit
          </footer>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Header / summary
// ---------------------------------------------------------------------------

function ThreatPill({ threat }: { threat: ThreatAssessment }) {
  const tone = severityTone(threat.severity);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] ${tone.ring} ${tone.text}`}
      title={`Threat score ${threat.score}/100`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot} animate-pulse`} />
      threat · {threat.score}/100 · {tone.label}
    </span>
  );
}

function SummaryGrid({
  mfa,
  sessions,
  devices,
  threat,
}: {
  mfa: MfaStatus;
  sessions: number;
  devices: number;
  threat: ThreatAssessment;
}) {
  const mfaTone = severityTone(mfa.enrolled ? "info" : "high");
  const tt = severityTone(threat.severity);
  return (
    <section className="mt-6 grid gap-3 md:grid-cols-4">
      <Tile
        label="MFA"
        value={mfa.enrolled ? "Enrolled" : "Off"}
        sub={mfa.enrolled ? `${mfa.backup_codes_remaining} backup codes` : "Strongly recommended"}
        accent={mfaTone}
      />
      <Tile label="Active sessions" value={String(sessions)} sub="across devices" />
      <Tile label="Trusted devices" value={String(devices)} sub="approved by you" />
      <Tile
        label="Threat score"
        value={`${threat.score}/100`}
        sub={`${threat.matched.length} rules matched`}
        accent={tt}
        accentText
      />
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
  accentText,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: ReturnType<typeof severityTone>;
  accentText?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className={`text-2xl font-semibold ${accentText && accent ? accent.text : "text-white"}`}>{value}</p>
        {accent ? <span aria-hidden className={`mb-1 inline-block h-2 w-2 rounded-full ${accent.dot}`} /> : null}
      </div>
      <p className="mt-1 truncate text-xs text-white/45">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  MFA
// ---------------------------------------------------------------------------

function MfaCard({
  mfa,
  onEnroll,
  onDisable,
}: {
  mfa: MfaStatus;
  onEnroll: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// multi-factor</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            <FingerprintIcon className="h-4 w-4 text-basil-200" /> Multi-factor authentication
          </h2>
          <p className="mt-1 max-w-md text-xs text-white/55">
            TOTP today; WebAuthn passkeys + step-up for admin actions are wired
            into the architecture seam below.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
            mfa.enrolled
              ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
              : "border-rose-400/40 bg-rose-500/10 text-rose-200"
          }`}
        >
          {mfa.enrolled ? "Enrolled" : "Required"}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <Spec label="Method" value={mfa.method?.toUpperCase() ?? "—"} />
        <Spec label="Backup codes" value={String(mfa.backup_codes_remaining)} />
        <Spec label="Last verified" value={relativeTime(mfa.last_verified_at)} />
        <Spec label="Recovery" value="email + admin" />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {mfa.enrolled ? (
          <>
            <button
              type="button"
              onClick={onDisable}
              className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200 hover:bg-rose-500/20"
            >
              Disable MFA
            </button>
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-white/70 hover:border-white/25 hover:text-white"
            >
              Regenerate backup codes
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onEnroll}
            className="rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-1.5 text-[11px] text-basil-50 hover:bg-basil-500/25"
          >
            Enroll authenticator
          </button>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className="text-[12px] text-white/85">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  SSO / SAML
// ---------------------------------------------------------------------------

function SsoCard({
  policy,
  onChange,
}: {
  policy: WorkspaceSecurity;
  onChange: (next: WorkspaceSecurity) => void;
}) {
  const [picked, setPicked] = useState<SsoProviderTemplate | null>(
    policy.sso_kind ? SSO_PROVIDERS.find((p) => p.kind === policy.sso_kind) ?? null : null,
  );
  const [entityId, setEntityId] = useState(policy.sso_entity_id ?? "");
  const [acsUrl, setAcsUrl] = useState(policy.sso_acs_url ?? "");
  const [metadataUrl, setMetadataUrl] = useState(policy.sso_metadata_url ?? "");

  function save() {
    onChange({
      ...policy,
      sso_enabled: Boolean(picked),
      sso_kind: picked?.kind ?? null,
      sso_entity_id: entityId.trim() || null,
      sso_acs_url: acsUrl.trim() || null,
      sso_metadata_url: metadataUrl.trim() || null,
      updated_at: new Date().toISOString(),
    });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// single sign-on</p>
          <h2 className="mt-1 text-lg font-semibold text-white">SSO / SAML</h2>
          <p className="mt-1 max-w-md text-xs text-white/55">
            Wire up Okta, Microsoft Entra, Google Workspace, Auth0, or any
            OIDC bridge. Identity stays in your IdP; GTLNAV reads claims and
            maps to workspace roles.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
            policy.sso_enabled
              ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
              : "border-white/15 bg-white/[0.04] text-white/65"
          }`}
        >
          {policy.sso_enabled ? "Active" : "Off"}
        </span>
      </header>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SSO_PROVIDERS.map((p) => {
          const active = picked?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPicked(p)}
              className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${
                active
                  ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                  : "border-white/10 bg-black/30 text-white/65 hover:border-white/25 hover:text-white"
              }`}
            >
              <p className="font-medium">{p.name}</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{p.kind}</p>
            </button>
          );
        })}
      </div>

      {picked ? (
        <div className="mt-3 space-y-2">
          <Field
            label="Entity ID / Issuer"
            value={entityId}
            onChange={setEntityId}
            placeholder={picked.entityIdHint}
          />
          <Field
            label="ACS / Redirect URL"
            value={acsUrl}
            onChange={setAcsUrl}
            placeholder="https://gtlnav.com/sso/callback"
          />
          <Field
            label="Metadata URL"
            value={metadataUrl}
            onChange={setMetadataUrl}
            placeholder="https://idp.example.com/.well-known/saml-configuration"
          />
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          className="rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-1.5 text-[11px] text-basil-50 hover:bg-basil-500/25"
        >
          Save SSO config
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
//  Sessions
// ---------------------------------------------------------------------------

function SessionsCard({
  sessions,
  onRevoke,
}: {
  sessions: LoginSession[];
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex items-start justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// sessions</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldIcon className="h-4 w-4 text-basil-200" /> Active sessions
          </h2>
        </div>
      </header>
      <ul className="divide-y divide-white/5">
        {sessions.length === 0 ? (
          <li className="px-5 py-8 text-center text-xs text-white/45">No sessions.</li>
        ) : (
          sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  s.revoked_at ? "bg-white/30" : s.current ? "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.95)]" : "bg-cyan-300"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">
                  {s.device_label}
                  {s.current ? <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-basil-200">this device</span> : null}
                </p>
                <p className="text-[11px] text-white/50">
                  {s.region} · {maskIp(s.ip)} · {s.sso_provider ? `SSO · ${s.sso_provider}` : "password"}{" "}
                  · {s.mfa_satisfied ? "MFA ✓" : "MFA ✗"}
                </p>
                <p className="text-[10px] text-white/35">
                  Issued {relativeTime(s.issued_at)} · last seen {relativeTime(s.last_seen_at)}
                </p>
              </div>
              {s.revoked_at ? (
                <span className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/45">revoked</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRevoke(s.id)}
                  disabled={s.current}
                  className="rounded-md border border-rose-400/30 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/10 disabled:opacity-40"
                >
                  Revoke
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Devices
// ---------------------------------------------------------------------------

function DevicesCard({
  devices,
  onTrust,
  onRevoke,
}: {
  devices: TrustedDevice[];
  onTrust: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex items-start justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// device trust</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            <FingerprintIcon className="h-4 w-4 text-basil-200" /> Trusted devices
          </h2>
        </div>
      </header>
      <ul className="divide-y divide-white/5">
        {devices.length === 0 ? (
          <li className="px-5 py-8 text-center text-xs text-white/45">No devices yet.</li>
        ) : (
          devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{d.label}</p>
                <p className="text-[11px] text-white/50">
                  {d.os} · {d.browser} · {d.region} · {maskIp(d.ip)}
                </p>
                <p className="text-[10px] text-white/35">
                  First seen {relativeTime(d.first_seen_at)} · last {relativeTime(d.last_seen_at)}
                </p>
              </div>
              {d.revoked_at ? (
                <span className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/45">revoked</span>
              ) : d.trusted_at ? (
                <button
                  type="button"
                  onClick={() => onRevoke(d.id)}
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/65 hover:border-rose-400/30 hover:text-rose-200"
                >
                  Revoke trust
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTrust(d.id)}
                  className="rounded-md border border-basil-400/30 bg-basil-500/10 px-2 py-1 text-[11px] text-basil-100 hover:bg-basil-500/20"
                >
                  Trust device
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  IP allowlist
// ---------------------------------------------------------------------------

function IpAllowlistCard({
  policy,
  onChange,
}: {
  policy: WorkspaceSecurity;
  onChange: (p: WorkspaceSecurity) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add(ev: FormEvent) {
    ev.preventDefault();
    const t = draft.trim();
    if (!t) return;
    if (!isValidCidr(t)) {
      setError("Enter a valid IPv4/IPv6 address or CIDR.");
      return;
    }
    if (policy.ip_allowlist.includes(t)) {
      setError("Already in list.");
      return;
    }
    onChange({
      ...policy,
      ip_allowlist: [...policy.ip_allowlist, t],
      updated_at: new Date().toISOString(),
    });
    setDraft("");
    setError(null);
  }

  function remove(cidr: string) {
    onChange({
      ...policy,
      ip_allowlist: policy.ip_allowlist.filter((c) => c !== cidr),
      updated_at: new Date().toISOString(),
    });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// network</p>
          <h2 className="mt-1 text-lg font-semibold text-white">IP allowlist</h2>
          <p className="mt-1 max-w-md text-xs text-white/55">
            Block traffic outside listed CIDR ranges. Applies to console + API
            once enforcement is on. Validation happens edge-side.
          </p>
        </div>
        <Toggle
          checked={policy.ip_allowlist_enabled}
          onChange={(v) =>
            onChange({ ...policy, ip_allowlist_enabled: v, updated_at: new Date().toISOString() })
          }
          ariaLabel="Enforce IP allowlist"
        />
      </header>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="203.0.113.0/24"
          className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
        />
        <button
          type="submit"
          className="rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-1.5 text-[11px] text-basil-50 hover:bg-basil-500/25"
        >
          Add CIDR
        </button>
      </form>
      {error ? <p className="mt-2 text-[11px] text-rose-300">{error}</p> : null}

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {policy.ip_allowlist.length === 0 ? (
          <li className="text-[11px] text-white/40">No CIDR ranges yet.</li>
        ) : (
          policy.ip_allowlist.map((c) => (
            <li
              key={c}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[11px] text-white/80"
            >
              <span>{c}</span>
              <button
                type="button"
                onClick={() => remove(c)}
                className="text-white/40 hover:text-rose-200"
                aria-label={`Remove ${c}`}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Workspace policy
// ---------------------------------------------------------------------------

function PolicyCard({
  policy,
  onChange,
}: {
  policy: WorkspaceSecurity;
  onChange: (p: WorkspaceSecurity) => void;
}) {
  function set<K extends keyof WorkspaceSecurity>(k: K, v: WorkspaceSecurity[K]) {
    onChange({ ...policy, [k]: v, updated_at: new Date().toISOString() });
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <header>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// policy</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
          <KeyIcon className="h-4 w-4 text-basil-200" /> Workspace security policy
        </h2>
        <p className="mt-1 max-w-md text-xs text-white/55">
          Workspace-wide defaults. Members inherit these constraints; admins
          can require MFA for everyone, shorten sessions, and set retention.
        </p>
      </header>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <ToggleRow
          label="MFA required for all members"
          sub="Forces second factor at next login."
          checked={policy.mfa_required}
          onChange={(v) => set("mfa_required", v)}
        />
        <ToggleRow
          label="Verify webhook signatures"
          sub="Reject inbound hooks without signature."
          checked={policy.webhook_verify_signatures}
          onChange={(v) => set("webhook_verify_signatures", v)}
        />
        <NumberRow
          label="Session idle (hours)"
          value={policy.session_idle_hours}
          onChange={(v) => set("session_idle_hours", v)}
          min={1}
          max={720}
        />
        <NumberRow
          label="Session max lifetime (hours)"
          value={policy.session_max_hours}
          onChange={(v) => set("session_max_hours", v)}
          min={1}
          max={24 * 60}
        />
        <NumberRow
          label="API key max age (days)"
          value={policy.api_key_max_age_days}
          onChange={(v) => set("api_key_max_age_days", v)}
          min={7}
          max={365 * 3}
        />
        <NumberRow
          label="Audit retention (days)"
          value={policy.audit_retention_days}
          onChange={(v) => set("audit_retention_days", v)}
          min={30}
          max={365 * 7}
        />
        <NumberRow
          label="Threat alert threshold"
          value={policy.threat_alert_threshold}
          onChange={(v) => set("threat_alert_threshold", v)}
          min={10}
          max={100}
        />
        <SelectRow
          label="Min webhook signature"
          value={policy.webhook_min_signature_version}
          options={[
            { v: "v1", label: "v1 (legacy)" },
            { v: "v2", label: "v2 (HMAC SHA-256)" },
          ]}
          onChange={(v) => set("webhook_min_signature_version", v as "v1" | "v2")}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="min-w-0">
        <p className="text-[12px] text-white">{label}</p>
        <p className="text-[10px] text-white/50">{sub}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="rounded-lg border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        min={min}
        max={max}
        className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white"
      />
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="rounded-lg border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? "border-basil-400/40 bg-basil-500/40"
          : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full transition-transform ${
          checked
            ? "translate-x-[18px] bg-basil-100 shadow-[0_0_6px_rgba(111,232,154,0.7)]"
            : "translate-x-[3px] bg-white/55"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Events feed
// ---------------------------------------------------------------------------

function EventsCard({
  events,
  filter,
  counts,
  onFilterChange,
}: {
  events: SecurityEvent[];
  filter: CategoryFilter;
  counts: Record<SecurityEventCategory, number>;
  onFilterChange: (f: CategoryFilter) => void;
}) {
  const cats: SecurityEventCategory[] = [
    "auth", "session", "device", "network", "api", "webhook", "role", "sso",
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// audit feed</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Security events</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => onFilterChange("all")} label="All" count={events.length} />
          {cats.map((c) => (
            <Chip
              key={c}
              active={filter === c}
              onClick={() => onFilterChange(c)}
              label={categoryLabel(c)}
              count={counts[c]}
            />
          ))}
        </div>
      </header>
      <ol className="max-h-[480px] divide-y divide-white/5 overflow-y-auto font-mono text-[11px]">
        {events.length === 0 ? (
          <li className="px-5 py-10 text-center text-white/45">No events match.</li>
        ) : (
          events.map((e) => {
            const tone = severityTone(e.severity);
            const meta = EVENT_META[e.kind];
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-2">
                <span className="shrink-0 text-white/30">{absoluteTime(e.created_at)}</span>
                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${tone.text}`}>
                  {tone.label}
                </span>
                <span className="shrink-0 text-white/45">[{categoryLabel(meta.category)}]</span>
                <span className="min-w-0 flex-1 text-white/85">
                  <span className="text-white">{meta.label}</span> — {e.message}
                </span>
                {e.region ? <span className="shrink-0 text-cyan-300/80">{e.region}</span> : null}
                {e.ip ? <span className="shrink-0 text-white/35">{maskIp(e.ip)}</span> : null}
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
        active
          ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
          : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[9px] ${
          active ? "bg-white/10 text-white" : "bg-white/5 text-white/55 group-hover:text-white/80"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Schema / arch helpers
// ---------------------------------------------------------------------------

function SchemaSetupCard() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">// database setup</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Persist security in Supabase</h2>
          <p className="mt-1 max-w-2xl text-xs text-white/55">
            Run once. Until tables exist, the security plane runs locally via
            simulator and survives reloads in <code className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px]">localStorage</code>.
            Schema is enterprise-grade — RLS, indexed audit trail, workspace
            policy, and IP/CIDR types.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(SECURITY_SCHEMA_SQL);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            } catch {
              /* ignore */
            }
          }}
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition hover:border-basil-400/40 hover:text-white"
        >
          {copied ? "Copied" : "Copy SQL"}
        </button>
      </header>
      <pre className="max-h-[360px] overflow-auto bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-white/75">
        {SECURITY_SCHEMA_SQL}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Common scaffolding
// ---------------------------------------------------------------------------

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
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-basil-500/15 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-600/10 blur-[100px]" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/40 to-transparent" />
    </div>
  );
}
