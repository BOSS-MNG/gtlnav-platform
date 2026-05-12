"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import {
  absoluteTime,
  domainStatusStyle,
  relativeTime,
} from "@/src/lib/dashboard-format";
import {
  DEFAULT_DNS_TARGET,
  dnsProviderLabel,
  dnsRecordHost,
  getDnsProvider,
  isApexDomain,
} from "@/src/lib/dns-providers";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { verifyDomainViaApi } from "@/src/lib/deploy-client";
import {
  AddGlobalDomainModal,
  type ProjectOption,
} from "./add-global-domain-modal";

type DomainRow = {
  id: string;
  user_id?: string | null;
  project_id?: string | null;
  domain?: string | null;
  status?: string | null;
  ssl_status?: string | null;
  dns_target?: string | null;
  dns_provider?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type ProjectRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  status?: string | null;
};

type DomainsData = {
  domains: DomainRow[];
  projects: ProjectRow[];
};

type LoadResult = {
  data: DomainsData;
  errors: string[];
};

const EMPTY_DATA: DomainsData = { domains: [], projects: [] };

async function loadDomains(userId: string): Promise<LoadResult> {
  const errors: string[] = [];

  const [domainsRes, projectsRes] = await Promise.all([
    supabase
      .from("domains")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name, slug, status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (domainsRes.error) errors.push(`domains: ${domainsRes.error.message}`);
  if (projectsRes.error) errors.push(`projects: ${projectsRes.error.message}`);

  return {
    data: {
      domains: (domainsRes.data ?? []) as DomainRow[],
      projects: (projectsRes.data ?? []) as ProjectRow[],
    },
    errors,
  };
}

export function DomainsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<DomainsData>(EMPTY_DATA);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [dataErrors, setDataErrors] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const refresh = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLoadingData(true);
      else setRefreshing(true);
      try {
        const { data: next, errors } = await loadDomains(userId);
        setData(next);
        setDataErrors(errors);
      } catch (err) {
        setDataErrors([
          err instanceof Error ? err.message : "Failed to load domains.",
        ]);
      } finally {
        if (mode === "initial") setLoadingData(false);
        else setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function init() {
      const { data: sessData } = await supabase.auth.getSession();
      if (!active) return;
      const current = sessData.session ?? null;
      setSession(current);
      if (!current) {
        router.replace("/login");
        return;
      }
      await refresh(current.user.id, "initial");
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        if (!nextSession) {
          router.replace("/login");
          return;
        }
        refresh(nextSession.user.id, "refresh");
      },
    );

    return () => {
      active = false;
      listener?.subscription.unsubscribe();
    };
  }, [refresh, router]);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    for (const p of data.projects) map.set(p.id, p);
    return map;
  }, [data.projects]);

  const projectOptions: ProjectOption[] = useMemo(
    () =>
      data.projects.map((p) => ({
        id: p.id,
        name: p.name ?? null,
        slug: p.slug ?? null,
      })),
    [data.projects],
  );

  async function handleCopy(key: string, value: string | null | undefined) {
    if (!value) return;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      // copy is best-effort; ignore failures
    }
  }

  async function handleVerify(domain: DomainRow) {
    if (!session) return;
    const userId = session.user.id;
    setVerifyingId(domain.id);
    setDataErrors([]);

    try {
      // Real DNS verification — the API performs a CNAME/A lookup with
      // node:dns/promises and only flips status if the record actually
      // points at the GTLNAV target. The dashboard never mutates
      // `status` / `ssl_status` directly anymore.
      const result = await verifyDomainViaApi({ domainId: domain.id });

      if (!result.ok) {
        setDataErrors([
          `${domain.domain ?? "Domain"} not verified — ${result.message}`,
        ]);
        return;
      }

      // SSL is handled by the reverse proxy (Caddy on-demand TLS). The API
      // returns the *current* ssl_status — we never fake "issued" here.
      const sslState = (result.ssl_status ?? "pending_ssl").toLowerCase();
      if (sslState === "issued") {
        // success — verification + cert is live.
      } else if (sslState === "pending_ssl") {
        setDataErrors([
          `${domain.domain ?? "Domain"} verified. SSL is being issued by the proxy — refresh in a moment.`,
        ]);
      } else if (sslState === "ssl_failed") {
        setDataErrors([
          `${domain.domain ?? "Domain"} verified but SSL issuance failed. Check Caddy / ACME logs.`,
        ]);
      }

      await refresh(userId, "refresh");
    } catch (err) {
      setDataErrors([
        err instanceof Error ? err.message : "Failed to verify domain.",
      ]);
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleAcknowledge(domain: DomainRow) {
    if (!session) return;
    const userId = session.user.id;
    setAcknowledgingId(domain.id);
    try {
      const message = `User confirmed DNS record for ${domain.domain ?? domain.id}.`;
      const { error: logErr } = await supabase
        .from("infrastructure_logs")
        .insert({
          user_id: userId,
          project_id: domain.project_id ?? null,
          event_type: "domain_dns_added",
          severity: "info",
          message,
        });
      if (logErr) {
        // best-effort: non-fatal
      }
      setAcknowledgedIds((prev) => {
        const next = new Set(prev);
        next.add(domain.id);
        return next;
      });
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

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
        <DashboardSidebar activeKey="domains" userEmail={user.email} />

        <main className="flex-1 px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // domains
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Domain management
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                Connect, verify, and route traffic across all your GTLNAV
                projects from a single console.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => refresh(user.id, "refresh")}
                disabled={refreshing || loadingData}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={data.projects.length === 0}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-xs font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
                title={
                  data.projects.length === 0
                    ? "Create a project first"
                    : "Add domain"
                }
              >
                ＋ Add domain
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          {dataErrors.length > 0 ? (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              <p className="font-medium">Some operations had issues:</p>
              <ul className="mt-1 list-disc pl-5 text-red-100/80">
                {dataErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <SummaryStrip domains={data.domains} loading={loadingData} />

          <section className="mt-8 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium uppercase tracking-[0.28em] text-white/70">
                All domains
              </h2>
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                {loadingData
                  ? "Loading…"
                  : `${data.domains.length} ${data.domains.length === 1 ? "domain" : "domains"}`}
              </p>
            </div>

            {loadingData ? (
              <DomainsSkeleton />
            ) : data.domains.length === 0 ? (
              <EmptyDomains
                hasProjects={data.projects.length > 0}
                onAddClick={() => setCreateOpen(true)}
              />
            ) : (
              <ul className="space-y-4">
                {data.domains.map((d) => (
                  <DomainCard
                    key={d.id}
                    domain={d}
                    project={
                      d.project_id ? projectsById.get(d.project_id) : undefined
                    }
                    copiedKey={copiedKey}
                    onCopy={handleCopy}
                    onVerify={handleVerify}
                    onAcknowledge={handleAcknowledge}
                    verifying={verifyingId === d.id}
                    acknowledged={acknowledgedIds.has(d.id)}
                    acknowledging={acknowledgingId === d.id}
                  />
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      <AddGlobalDomainModal
        open={createOpen}
        userId={user.id}
        projects={projectOptions}
        onClose={() => setCreateOpen(false)}
        onCreated={() => refresh(user.id, "refresh")}
      />
    </div>
  );
}

function SummaryStrip({
  domains,
  loading,
}: {
  domains: DomainRow[];
  loading: boolean;
}) {
  const total = domains.length;
  const verified = domains.filter((d) => {
    const s = (d.status ?? "").toLowerCase();
    return (
      s.includes("verified") || s.includes("active") || s.includes("ready")
    );
  }).length;
  const pending = domains.filter((d) => {
    const s = (d.status ?? "").toLowerCase();
    return !s || s.includes("pending");
  }).length;
  const sslIssued = domains.filter((d) => {
    const s = (d.ssl_status ?? "").toLowerCase();
    return s.includes("issued") || s.includes("active");
  }).length;

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label="Total domains" value={loading ? null : total} />
      <SummaryCard label="Verified" value={loading ? null : verified} accent />
      <SummaryCard label="Pending" value={loading ? null : pending} />
      <SummaryCard label="SSL issued" value={loading ? null : sslIssued} accent />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div
        className={`absolute inset-x-0 top-0 h-px ${
          accent
            ? "bg-gradient-to-r from-transparent via-basil-300/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-white/15 to-transparent"
        }`}
      />
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/45">
        {label}
      </p>
      {value === null ? (
        <div className="mt-3 h-7 w-16 animate-pulse rounded-md bg-white/[0.06]" />
      ) : (
        <p
          className={`mt-2 text-3xl font-semibold tracking-tight ${
            accent ? "text-basil-200" : "text-white"
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

function DomainsSkeleton() {
  return (
    <ul className="space-y-4">
      {Array.from({ length: 3 }).map((_, idx) => (
        <li
          key={idx}
          className="h-44 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]"
        />
      ))}
    </ul>
  );
}

function EmptyDomains({
  hasProjects,
  onAddClick,
}: {
  hasProjects: boolean;
  onAddClick: () => void;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
      <p className="text-base font-medium text-white">No domains yet</p>
      <p className="mt-1 text-sm text-white/55">
        {hasProjects
          ? "Connect your first custom domain to start routing traffic through GTLNAV."
          : "You need at least one project before you can attach a domain."}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        {hasProjects ? (
          <button
            type="button"
            onClick={onAddClick}
            className="rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
          >
            ＋ Add domain
          </button>
        ) : (
          <Link
            href="/dashboard"
            className="rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
          >
            Create a project →
          </Link>
        )}
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  project,
  copiedKey,
  onCopy,
  onVerify,
  onAcknowledge,
  verifying,
  acknowledged,
  acknowledging,
}: {
  domain: DomainRow;
  project: ProjectRow | undefined;
  copiedKey: string | null;
  onCopy: (key: string, value: string | null | undefined) => void;
  onVerify: (domain: DomainRow) => void;
  onAcknowledge: (domain: DomainRow) => void;
  verifying: boolean;
  acknowledged: boolean;
  acknowledging: boolean;
}) {
  const status = (domain.status ?? "pending").toLowerCase();
  const sslStatus = (domain.ssl_status ?? "pending").toLowerCase();
  const statusStyle = domainStatusStyle(status);
  const sslStyle = domainStatusStyle(sslStatus);
  const isVerified =
    status.includes("verified") ||
    status.includes("active") ||
    status.includes("ready");
  const apex = isApexDomain(domain.domain);
  const recordHost = dnsRecordHost(domain.domain);
  const dnsTarget = domain.dns_target ?? DEFAULT_DNS_TARGET;
  const providerInfo = getDnsProvider(domain.dns_provider);
  const providerLabel = providerInfo?.label ?? dnsProviderLabel(domain.dns_provider);
  const providerInstructions = providerInfo?.instructions ?? null;
  const ttl = providerInfo?.ttlHint ?? "Auto · 4 hrs";
  const hostCopyKey = `host:${domain.id}`;
  const targetCopyKey = `target:${domain.id}`;
  const domainCopyKey = `domain:${domain.id}`;
  const projectHref = project ? `/dashboard/projects/${project.id}` : null;

  return (
    <li className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl transition-colors hover:border-basil-400/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/30 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-base text-white">
              {domain.domain ?? "—"}
            </p>
            <button
              type="button"
              onClick={() => onCopy(domainCopyKey, domain.domain)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/55 transition-colors hover:border-basil-400/40 hover:text-white"
            >
              {copiedKey === domainCopyKey ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
            {projectHref ? (
              <Link
                href={projectHref}
                className="inline-flex items-center gap-1.5 text-basil-300 transition-colors hover:text-basil-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.9)]" />
                {project?.name ?? project?.slug ?? "project"}
                {project?.slug ? (
                  <span className="text-white/35">/{project.slug}</span>
                ) : null}
              </Link>
            ) : (
              <span className="text-white/45">No project linked</span>
            )}
            <span className="text-white/25">·</span>
            <span title={absoluteTime(domain.created_at)}>
              Added {relativeTime(domain.created_at)}
            </span>
            {domain.updated_at ? (
              <>
                <span className="text-white/25">·</span>
                <span title={absoluteTime(domain.updated_at)}>
                  Updated {relativeTime(domain.updated_at)}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/65">
            {providerLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${statusStyle.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
            <span className={statusStyle.text}>{status}</span>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${sslStyle.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${sslStyle.dot}`} />
            <span className={sslStyle.text}>SSL · {sslStatus}</span>
          </span>
        </div>
      </div>

      {apex ? (
        <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          <strong className="font-semibold text-amber-50">Heads up:</strong>{" "}
          Root domains like{" "}
          <span className="font-mono text-amber-50">
            {domain.domain ?? "example.com"}
          </span>{" "}
          require A or ALIAS records, which GTLNAV Beta will support next. For
          now, route a subdomain such as{" "}
          <span className="font-mono text-amber-50">
            app.{domain.domain ?? "example.com"}
          </span>
          .
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-basil-300/80">
              DNS setup guide
            </p>
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/35">
              {providerLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Add this CNAME record at your registrar to route traffic to GTLNAV.
          </p>

          <dl className="mt-4 space-y-2 text-xs">
            <DnsRow label="Record type" value="CNAME" mono />
            <DnsRow
              label="Name / Host"
              value={recordHost}
              mono
              copy={{
                copied: copiedKey === hostCopyKey,
                onClick: () => onCopy(hostCopyKey, recordHost),
              }}
            />
            <DnsRow
              label="Target / Value"
              value={dnsTarget}
              mono
              copy={{
                copied: copiedKey === targetCopyKey,
                onClick: () => onCopy(targetCopyKey, dnsTarget),
              }}
            />
            <DnsRow label="TTL" value={ttl} mono />
            <DnsRow
              label="Status"
              value={
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${statusStyle.ring}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`}
                  />
                  <span className={statusStyle.text}>{status}</span>
                </span>
              }
            />
            <DnsRow
              label="SSL"
              value={
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${sslStyle.ring}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${sslStyle.dot}`}
                  />
                  <span className={sslStyle.text}>{sslStatus}</span>
                </span>
              }
            />
          </dl>

          {providerInstructions ? (
            <div className="mt-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-basil-300/80">
                {providerLabel} steps
              </p>
              <ol className="mt-2 space-y-1.5 text-xs text-white/70">
                {providerInstructions.map((step, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="mt-[1px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-basil-400/40 bg-basil-500/10 font-mono text-[9px] text-basil-200">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
              {providerInfo?.note ? (
                <p className="mt-3 rounded-xl border border-basil-400/20 bg-basil-500/5 px-3 py-2 text-[11px] text-basil-100/80">
                  {providerInfo.note}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-basil-300/80">
              Verification
            </p>
            <p className="mt-1 text-xs text-white/55">
              {isVerified
                ? sslStatus === "issued"
                  ? "DNS routing is active and the SSL certificate is live."
                  : sslStatus === "pending_ssl"
                    ? "DNS verified. The reverse proxy is issuing the SSL certificate — refresh shortly."
                    : sslStatus === "ssl_failed"
                      ? "DNS verified, but SSL issuance failed. Check the proxy / ACME logs and retry."
                      : "DNS verified. SSL status will appear here once the proxy provisions it."
                : acknowledged
                  ? "Record acknowledged. Click Verify DNS once propagation finishes."
                  : "Once your CNAME record propagates, click Verify DNS. SSL is issued by the reverse proxy after verification."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onCopy(hostCopyKey, recordHost)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:border-basil-400/40 hover:text-white"
            >
              {copiedKey === hostCopyKey ? "Host copied" : "Copy host"}
            </button>
            <button
              type="button"
              onClick={() => onCopy(targetCopyKey, dnsTarget)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:border-basil-400/40 hover:text-white"
            >
              {copiedKey === targetCopyKey ? "Target copied" : "Copy target"}
            </button>
            <button
              type="button"
              onClick={() => onAcknowledge(domain)}
              disabled={acknowledging || isVerified || acknowledged}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/[0.06] px-4 py-2 text-xs font-medium text-basil-100/90 transition-colors hover:bg-basil-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acknowledging
                ? "Saving…"
                : acknowledged || isVerified
                  ? "Record marked added"
                  : "I added this record"}
            </button>
            <button
              type="button"
              onClick={() => onVerify(domain)}
              disabled={verifying || isVerified}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-xs font-semibold text-black shadow-[0_0_20px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_30px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifying ? "Verifying…" : isVerified ? "Verified" : "Verify DNS"}
            </button>
            {projectHref ? (
              <Link
                href={projectHref}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                Open project →
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function DnsRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  copy?: { copied: boolean; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.2em] text-white/40">
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        <span className={`text-white/85 ${mono ? "font-mono" : ""}`}>
          {value}
        </span>
        {copy ? (
          <button
            type="button"
            onClick={copy.onClick}
            className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/55 transition-colors hover:border-basil-400/40 hover:text-white"
          >
            {copy.copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </dd>
    </div>
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
