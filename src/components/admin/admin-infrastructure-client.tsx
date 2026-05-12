"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  AdminRlsWarning,
  AdminShell,
  type AdminContext,
} from "@/src/components/admin/admin-shell";
import {
  AdminButton,
  CardShell,
  EmptyState,
  MetricTile,
  StatusPill,
} from "@/src/components/admin/admin-ui";
import {
  logLevel,
  logLevelClasses,
  logMessage,
  shortTime,
} from "@/src/lib/dashboard-format";
import { logAdminEvent } from "@/src/lib/admin-audit";

type LogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  event_type: string | null;
  message: string | null;
  level: string | null;
  severity: string | null;
  source: string | null;
  created_at: string | null;
};

type Region = {
  code: string;
  city: string;
  status: "healthy" | "degraded" | "outage";
  latency: number;
  load: number;
};

const SEED_REGIONS: Region[] = [
  { code: "US-EAST", city: "Ashburn", status: "healthy", latency: 18, load: 32 },
  { code: "US-WEST", city: "Hillsboro", status: "healthy", latency: 22, load: 41 },
  { code: "EU-WEST", city: "Dublin", status: "healthy", latency: 26, load: 38 },
  { code: "EU-CENTRAL", city: "Frankfurt", status: "healthy", latency: 24, load: 36 },
  { code: "AP-SOUTH", city: "Singapore", status: "degraded", latency: 84, load: 71 },
  { code: "AP-NORTH", city: "Tokyo", status: "healthy", latency: 31, load: 29 },
  { code: "SA-EAST", city: "São Paulo", status: "healthy", latency: 39, load: 33 },
  { code: "AF-SOUTH", city: "Cape Town", status: "outage", latency: 0, load: 0 },
];

const HEALTH_EVENT_TYPES = [
  "health_check",
  "admin_health_check",
  "infra_health",
  "region_check",
];

function jitter(value: number, range: number) {
  return Math.max(0, Math.round(value + (Math.random() * 2 - 1) * range));
}

function regionTone(status: Region["status"]) {
  if (status === "healthy") return "good" as const;
  if (status === "degraded") return "warn" as const;
  return "bad" as const;
}

export function AdminInfrastructureClient() {
  return (
    <AdminShell
      activeKey="infrastructure"
      eyebrow="// admin / infrastructure"
      title="Global infrastructure operator"
      description="Run admin health checks, watch the global region map and simulate incidents."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [regions, setRegions] = useState<Region[]>(SEED_REGIONS);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [healthBusy, setHealthBusy] = useState(false);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [counts, setCounts] = useState<{
    inflight: number | null;
    pendingDomains: number | null;
    failedDomains: number | null;
    failedDeployments: number | null;
  }>({
    inflight: null,
    pendingDomains: null,
    failedDomains: null,
    failedDeployments: null,
  });

  const loadCounts = useCallback(async () => {
    const errs: string[] = [];

    const handle = (
      table: string,
      out: { count: number | null; error: { message: string } | null },
    ): number | null => {
      if (out.error) {
        const m = out.error.message.toLowerCase();
        if (
          !m.includes("relation") &&
          !m.includes("does not exist") &&
          !m.includes("schema cache")
        ) {
          errs.push(`${table}: ${out.error.message}`);
        }
        return null;
      }
      return out.count ?? 0;
    };

    const [inflightRes, pendingDomainsRes, failedDomainsRes, failedDepRes] =
      await Promise.all([
        supabase
          .from("deployments")
          .select("*", { count: "exact", head: true })
          .in("status", [
            "queued",
            "building",
            "deploying",
            "running",
            "in_progress",
          ]),
        supabase
          .from("domains")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("domains")
          .select("*", { count: "exact", head: true })
          .eq("status", "failed"),
        supabase
          .from("deployments")
          .select("*", { count: "exact", head: true })
          .in("status", ["failed", "error"]),
      ]);

    setCounts({
      inflight: handle("deployments", inflightRes),
      pendingDomains: handle("domains", pendingDomainsRes),
      failedDomains: handle("domains", failedDomainsRes),
      failedDeployments: handle("deployments", failedDepRes),
    });
    setErrors(errs);
  }, []);

  const loadLogs = useCallback(async () => {
    const res = await supabase
      .from("infrastructure_logs")
      .select(
        "id, user_id, project_id, event_type, message, level, severity, source, created_at",
      )
      .in("event_type", HEALTH_EVENT_TYPES)
      .order("created_at", { ascending: false })
      .limit(40);

    if (res.error) {
      const fallback = await supabase
        .from("infrastructure_logs")
        .select(
          "id, user_id, project_id, event_type, message, level, severity, source, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(40);
      if (!fallback.error)
        setLogs(((fallback.data ?? []) as LogRow[]).slice(0, 40));
    } else {
      setLogs((res.data ?? []) as LogRow[]);
    }
    setLoadingLogs(false);
  }, []);

  useEffect(() => {
    void loadCounts();
    void loadLogs();
  }, [loadCounts, loadLogs]);

  // Live jitter on metrics + counts refresh
  useEffect(() => {
    const id = window.setInterval(() => {
      setRegions((prev) =>
        prev.map((r) =>
          r.status === "outage"
            ? r
            : {
                ...r,
                latency: jitter(
                  r.latency,
                  r.status === "degraded" ? 14 : 6,
                ),
                load: Math.min(95, jitter(r.load, 8)),
              },
        ),
      );
    }, 2_500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadCounts();
    }, 25_000);
    return () => window.clearInterval(id);
  }, [loadCounts]);

  const summary = useMemo(() => {
    const healthy = regions.filter((r) => r.status === "healthy").length;
    const degraded = regions.filter((r) => r.status === "degraded").length;
    const outage = regions.filter((r) => r.status === "outage").length;
    const avgLat = Math.round(
      regions
        .filter((r) => r.status !== "outage")
        .reduce((acc, r) => acc + r.latency, 0) /
        Math.max(1, regions.filter((r) => r.status !== "outage").length),
    );
    return { healthy, degraded, outage, avgLat };
  }, [regions]);

  async function runAdminHealthCheck() {
    setHealthBusy(true);
    setScanning(true);
    try {
      // Add a couple of jittered regions for cinematic effect
      setRegions((prev) =>
        prev.map((r) => ({
          ...r,
          latency:
            r.status === "outage"
              ? 0
              : Math.max(8, r.latency + Math.round(Math.random() * 12 - 4)),
        })),
      );

      await logAdminEvent(
        ctx.session.user.id,
        "admin_health_check",
        `Operator-initiated global health check · ${summary.healthy} healthy / ${summary.degraded} degraded / ${summary.outage} outage`,
        "info",
        {
          actor_role: ctx.profile.role,
          summary,
          regions: regions.map((r) => ({
            code: r.code,
            status: r.status,
            latency: r.latency,
          })),
        },
      );

      await loadLogs();
    } finally {
      window.setTimeout(() => setScanning(false), 1_400);
      setHealthBusy(false);
    }
  }

  async function simulateIncident() {
    setIncidentBusy(true);
    try {
      // Pick a healthy region and degrade it for ~10s
      const healthyIdx = regions.findIndex((r) => r.status === "healthy");
      if (healthyIdx === -1) return;
      const target = regions[healthyIdx];
      setRegions((prev) =>
        prev.map((r, i) =>
          i === healthyIdx
            ? { ...r, status: "degraded", latency: 110, load: 85 }
            : r,
        ),
      );
      await logAdminEvent(
        ctx.session.user.id,
        "admin_incident_sim",
        `Simulated incident · ${target.code} (${target.city}) degraded`,
        "warning",
        { region: target.code, severity: "degraded" },
      );
      await loadLogs();
      window.setTimeout(() => {
        setRegions((prev) =>
          prev.map((r, i) =>
            i === healthyIdx
              ? { ...r, status: "healthy", latency: jitter(target.latency, 6), load: jitter(target.load, 8) }
              : r,
          ),
        );
        void logAdminEvent(
          ctx.session.user.id,
          "admin_incident_sim",
          `Simulated incident resolved · ${target.code} (${target.city})`,
          "success",
          { region: target.code, severity: "resolved" },
        ).then(() => void loadLogs());
      }, 11_000);
    } finally {
      setIncidentBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminRlsWarning
        visible={errors.length > 0}
        message={errors.length > 0 ? errors.slice(0, 3).join(" · ") : undefined}
      />

      {/* Global health */}
      <CardShell
        eyebrow="// global-health"
        title="Edge & infrastructure health"
        description="Aggregated view across all GTLNAV edge regions."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <AdminButton
              onClick={() => void runAdminHealthCheck()}
              tone="primary"
              busy={healthBusy}
            >
              Run health check
            </AdminButton>
            <AdminButton
              onClick={() => void simulateIncident()}
              tone="danger"
              busy={incidentBusy}
            >
              Simulate incident
            </AdminButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <MetricTile
            label="Healthy regions"
            value={summary.healthy}
            tone="good"
            hint={`${regions.length} total`}
          />
          <MetricTile
            label="Degraded"
            value={summary.degraded}
            tone={summary.degraded > 0 ? "warn" : "default"}
          />
          <MetricTile
            label="Outage"
            value={summary.outage}
            tone={summary.outage > 0 ? "bad" : "default"}
          />
          <MetricTile
            label="Avg latency"
            value={`${summary.avgLat}ms`}
            hint="non-outage"
          />
          <MetricTile
            label="Inflight deploys"
            value={counts.inflight ?? "—"}
            hint="globally"
            tone={
              counts.inflight && counts.inflight > 0 ? "good" : "default"
            }
          />
          <MetricTile
            label="Failed events"
            value={
              (counts.failedDomains ?? 0) + (counts.failedDeployments ?? 0)
            }
            hint="domains + deploys"
            tone={
              (counts.failedDomains ?? 0) + (counts.failedDeployments ?? 0) > 0
                ? "bad"
                : "default"
            }
          />
        </div>
      </CardShell>

      {/* Region grid */}
      <CardShell
        eyebrow="// region-map"
        title="GTLNAV regions"
        description="Live ping. Operator actions here are visible to every tenant."
      >
        <div
          className={`relative grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 ${
            scanning ? "scan-active" : ""
          }`}
        >
          {regions.map((r) => (
            <div
              key={r.code}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${
                r.status === "healthy"
                  ? "border-basil-400/30 bg-basil-500/5"
                  : r.status === "degraded"
                  ? "border-amber-400/40 bg-amber-500/10"
                  : "border-red-400/40 bg-red-500/10"
              }`}
            >
              <div
                className={`absolute -inset-[1px] rounded-2xl border-2 ${
                  scanning ? "animate-pulse border-red-400/40" : "border-transparent"
                }`}
                aria-hidden
              />
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                    {r.code}
                  </p>
                  <p className="text-sm font-semibold text-white">{r.city}</p>
                </div>
                <StatusPill
                  label={r.status}
                  tone={regionTone(r.status)}
                  pulse={r.status !== "healthy"}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="uppercase tracking-[0.16em] text-white/40">Latency</p>
                  <p className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : `${r.latency}ms`}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.16em] text-white/40">Load</p>
                  <p className="font-mono text-white/85">
                    {r.status === "outage" ? "—" : `${r.load}%`}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardShell>

      {/* Health check log stream */}
      <CardShell
        eyebrow="// admin-health-log"
        title="Latest health checks & incidents"
        description="Operator-initiated health checks and incident simulations land here."
      >
        {loadingLogs ? (
          <div className="rounded-2xl border border-white/10 bg-black/55 p-5 font-mono text-xs text-white/50">
            Loading health log…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No health events yet"
            description="Run an admin health check to populate this stream."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/55 font-mono text-[12px]">
            <ul className="divide-y divide-white/5">
              {logs.slice(0, 30).map((log) => {
                const styles = logLevelClasses(logLevel(log));
                return (
                  <li
                    key={log.id}
                    className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-2"
                  >
                    <span className="text-white/35">
                      {shortTime(log.created_at)}
                    </span>
                    <span className={`min-w-[80px] ${styles.label}`}>
                      {styles.tag}
                    </span>
                    <span className="truncate text-white/85">
                      {logMessage(log)}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                      {log.event_type ?? log.source ?? "event"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
          Health checks are stored as{" "}
          <span className="text-white/70">admin_health_check</span> events.
          Incidents as <span className="text-white/70">admin_incident_sim</span>.
        </p>
      </CardShell>
    </div>
  );
}
