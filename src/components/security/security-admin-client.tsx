"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdminShell } from "@/src/components/admin/admin-shell";
import { LockIcon } from "@/src/components/ui/icons";
import {
  EVENT_META,
  absoluteTime,
  categoryLabel,
  generateOperatorTenants,
  generateSecurityEvents,
  maskIp,
  relativeTime,
  severityTone,
  tickSecurityEvent,
  type SecurityEvent,
  type SecuritySeverity,
  type TenantThreatRow,
} from "@/src/lib/security";

const POLL_MS = 4_000;

export default function SecurityAdminClient() {
  return (
    <AdminShell
      activeKey="security"
      eyebrow="// security"
      title="Threat dashboard"
      description="Platform-wide security telemetry — sessions, abuse, audit trail, operator actions."
      headerRight={
        <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,1)]" />
          Threat plane
        </span>
      }
    >
      {() => <Body />}
    </AdminShell>
  );
}

function Body() {
  const [events, setEvents] = useState<SecurityEvent[]>(() =>
    generateSecurityEvents({
      userId: "operator",
      workspaceId: null,
      scope: "operator",
      count: 80,
    }),
  );
  const [tenants, setTenants] = useState<TenantThreatRow[]>(() => generateOperatorTenants());
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const ev = tickSecurityEvent({
        userId: "operator",
        workspaceId: null,
        scope: "operator",
      });
      if (ev) {
        setEvents((prev) => [ev, ...prev].slice(0, 240));
      }
      // Subtle drift on tenant scores — pick one row, jitter a few events.
      setTenants((prev) => {
        if (prev.length === 0) return prev;
        const idx = Math.floor(Math.random() * prev.length);
        const row = prev[idx];
        const drift = (Math.random() * 6 - 2) | 0;
        const next = Math.max(0, Math.min(100, row.threat.score + drift));
        const sev: SecuritySeverity =
          next >= 75 ? "critical" : next >= 55 ? "high" : next >= 30 ? "medium" : next > 0 ? "low" : "info";
        const updated = {
          ...row,
          threat: { ...row.threat, score: next, severity: sev },
          events_24h: row.events_24h + (Math.random() > 0.5 ? 1 : 0),
          last_event_at: new Date().toISOString(),
        };
        return prev.map((r, i) => (i === idx ? updated : r));
      });
    }, POLL_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const overall = useMemo(() => {
    if (tenants.length === 0) return 0;
    return Math.round(
      tenants.reduce((sum, t) => sum + t.threat.score, 0) / tenants.length,
    );
  }, [tenants]);

  const flagged = useMemo(
    () => tenants.filter((t) => t.threat.score >= 55).length,
    [tenants],
  );

  const operatorEvents = useMemo(
    () => events.filter((e) => EVENT_META[e.kind].category === "operator"),
    [events],
  );
  const abuseEvents = useMemo(
    () => events.filter((e) => e.kind === "abuse_detected" || e.kind === "suspicious_activity"),
    [events],
  );

  return (
    <div className="space-y-6">
      {/* Top metric strip */}
      <section className="grid gap-3 md:grid-cols-4">
        <Metric
          label="Platform threat avg"
          value={`${overall}/100`}
          sub={`${tenants.length} tenants tracked`}
          tone={severityTone(overall >= 60 ? "high" : overall >= 30 ? "medium" : "info")}
        />
        <Metric
          label="At-risk tenants"
          value={String(flagged)}
          sub="≥ high severity"
          tone={severityTone(flagged > 0 ? "high" : "info")}
        />
        <Metric
          label="Operator actions · 24h"
          value={String(operatorEvents.length)}
          sub="audit trail"
        />
        <Metric
          label="Abuse signals · 24h"
          value={String(abuseEvents.length)}
          sub="impossible travel + abuse"
          tone={severityTone(abuseEvents.length > 5 ? "critical" : abuseEvents.length > 0 ? "high" : "info")}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <TenantsTable tenants={tenants} />
        <RuleRollup events={events} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Feed
          title="Operator actions"
          eyebrow="// operator audit"
          events={operatorEvents.slice(0, 30)}
        />
        <Feed
          title="Abuse + suspicious activity"
          eyebrow="// threat feed"
          events={abuseEvents.slice(0, 30)}
        />
      </section>

      <section>
        <Feed
          title="Global security events"
          eyebrow="// platform stream"
          events={events.slice(0, 60)}
          dense
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-red-200/70">
              // operator capabilities
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">Active operator powers</h3>
            <p className="mt-1 max-w-2xl text-xs text-white/55">
              Every action below is recorded in <code className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px]">security_events</code> with{" "}
              <code className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px]">actor_id</code> bound to your operator profile.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
            <LockIcon className="h-3.5 w-3.5" /> Audit-bound
          </span>
        </header>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { name: "Force session revoke", blurb: "Kill all sessions for a user." },
            { name: "Reset MFA enrolment", blurb: "Send reset link, log event." },
            { name: "Block tenant", blurb: "Soft-block: deny console + API." },
            { name: "Quarantine deployment", blurb: "Pull traffic from a deployment." },
            { name: "Rotate deploy hooks", blurb: "Bulk rotate per project." },
            { name: "Freeze API keys", blurb: "Disable all keys in a workspace." },
          ].map((p) => (
            <li
              key={p.name}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <p className="text-[12px] font-medium text-white">{p.name}</p>
              <p className="mt-0.5 text-[11px] text-white/55">{p.blurb}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: ReturnType<typeof severityTone>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className={`text-2xl font-semibold ${tone ? tone.text : "text-white"}`}>{value}</p>
        {tone ? <span aria-hidden className={`mb-1 inline-block h-2 w-2 rounded-full ${tone.dot}`} /> : null}
      </div>
      <p className="mt-1 truncate text-xs text-white/45">{sub}</p>
    </div>
  );
}

function TenantsTable({ tenants }: { tenants: TenantThreatRow[] }) {
  const sorted = [...tenants].sort((a, b) => b.threat.score - a.threat.score);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex items-start justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-red-200/75">
            // tenant threat board
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">Workspaces by threat</h3>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.2em] text-white/45">
            <tr>
              <th className="px-5 py-3 text-left">Workspace</th>
              <th className="px-3 py-3 text-left">Score</th>
              <th className="px-3 py-3 text-left">Active rules</th>
              <th className="px-3 py-3 text-left">Users</th>
              <th className="px-3 py-3 text-left">Events</th>
              <th className="px-5 py-3 text-left">Last event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.map((row) => {
              const tone = severityTone(row.threat.severity);
              return (
                <tr key={row.tenant_id} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      <div>
                        <p className="text-white">{row.tenant_label}</p>
                        <p className="text-[10px] text-white/40">{row.tenant_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="w-32">
                      <div className="flex items-center justify-between text-[10px] text-white/55">
                        <span className={tone.text}>{tone.label}</span>
                        <span>{row.threat.score}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${row.threat.score}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-white/65">
                    {row.threat.matched.length === 0 ? (
                      <span className="text-white/35">none</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {row.threat.matched.slice(0, 2).map((r) => (
                          <li key={r.id} className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                            · {r.label}
                          </li>
                        ))}
                        {row.threat.matched.length > 2 ? (
                          <li className="text-[10px] text-white/40">+ {row.threat.matched.length - 2} more</li>
                        ) : null}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-3 text-white/75">{row.active_users}</td>
                  <td className="px-3 py-3 text-white/75">{row.events_24h}</td>
                  <td className="px-5 py-3 text-white/65">{relativeTime(row.last_event_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuleRollup({ events }: { events: SecurityEvent[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [events]);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="border-b border-white/5 px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-red-200/75">// signal rollup</p>
        <h3 className="mt-1 text-lg font-semibold text-white">Top event kinds</h3>
      </header>
      <ul className="divide-y divide-white/5">
        {counts.length === 0 ? (
          <li className="px-5 py-8 text-center text-xs text-white/45">No events.</li>
        ) : (
          counts.map(([kind, count]) => {
            const meta = EVENT_META[kind as keyof typeof EVENT_META];
            const tone = severityTone(meta.defaultSeverity);
            return (
              <li key={kind} className="flex items-center justify-between px-5 py-2 text-[12px]">
                <div className="min-w-0">
                  <p className="text-white">{meta.label}</p>
                  <p className="text-[10px] text-white/45">{categoryLabel(meta.category)}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${tone.ring} ${tone.text}`}>
                  {count}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function Feed({
  title,
  eyebrow,
  events,
  dense,
}: {
  title: string;
  eyebrow: string;
  events: SecurityEvent[];
  dense?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur">
      <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-red-200/75">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/55">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-300 shadow-[0_0_8px_rgba(248,113,113,0.95)]" />
          live
        </span>
      </header>
      <ol
        className={`divide-y divide-white/5 overflow-y-auto font-mono text-[11px] ${
          dense ? "max-h-[560px]" : "max-h-[360px]"
        }`}
      >
        {events.length === 0 ? (
          <li className="px-5 py-8 text-center text-white/45">No events.</li>
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
                {e.actor_id ? <span className="shrink-0 text-rose-300/80">actor {e.actor_id}</span> : null}
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
