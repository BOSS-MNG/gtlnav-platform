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
  FilterChip,
  StatusPill,
} from "@/src/components/admin/admin-ui";
import {
  logLevel,
  logLevelClasses,
  logMessage,
  shortTime,
} from "@/src/lib/dashboard-format";

type LogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  event_type: string | null;
  message: string | null;
  level: string | null;
  severity: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type ProjectMini = {
  id: string;
  name: string | null;
  slug: string | null;
};

type OwnerMini = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type SeverityFilter = "all" | "info" | "success" | "warning" | "error";

const SEVERITY_FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

function severityBucket(log: LogRow): SeverityFilter {
  const v = (log.severity ?? log.level ?? "info").toLowerCase();
  if (v.includes("err") || v.includes("crit") || v.includes("fail"))
    return "error";
  if (v.includes("warn")) return "warning";
  if (v.includes("success") || v.includes("ok")) return "success";
  return "info";
}

function severityTone(b: SeverityFilter) {
  if (b === "error") return "bad" as const;
  if (b === "warning") return "warn" as const;
  if (b === "success") return "good" as const;
  return "info" as const;
}

export function AdminAuditClient() {
  return (
    <AdminShell
      activeKey="audit"
      eyebrow="// admin / audit"
      title="Global audit stream"
      description="Real-time terminal of every infrastructure event across the platform."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx: _ctx }: { ctx: AdminContext }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectMini>>({});
  const [owners, setOwners] = useState<Record<string, OwnerMini>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const errs: string[] = [];

    const res = await supabase
      .from("infrastructure_logs")
      .select(
        "id, user_id, project_id, event_type, message, level, severity, source, metadata, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);

    if (res.error) errs.push(`infrastructure_logs: ${res.error.message}`);
    const data = (res.data ?? []) as LogRow[];
    setLogs(data);

    const projIds = Array.from(
      new Set(data.map((d) => d.project_id).filter(Boolean) as string[]),
    );
    const ownerIds = Array.from(
      new Set(data.map((d) => d.user_id).filter(Boolean) as string[]),
    );

    if (projIds.length > 0) {
      const projRes = await supabase
        .from("projects")
        .select("id, name, slug")
        .in("id", projIds);
      if (!projRes.error) {
        const map: Record<string, ProjectMini> = {};
        for (const p of (projRes.data ?? []) as ProjectMini[]) map[p.id] = p;
        setProjects(map);
      }
    } else {
      setProjects({});
    }

    if (ownerIds.length > 0) {
      const ownersRes = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      if (!ownersRes.error) {
        const map: Record<string, OwnerMini> = {};
        for (const o of (ownersRes.data ?? []) as OwnerMini[]) map[o.id] = o;
        setOwners(map);
      }
    } else {
      setOwners({});
    }

    setErrors(errs);
    if (mode === "initial") setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void refresh("refresh");
    }, 8_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh]);

  const eventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.event_type) set.add(l.event_type);
    }
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const userOptions = useMemo(() => {
    const arr = Object.values(owners);
    arr.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    return arr;
  }, [owners]);

  const projectOptions = useMemo(() => {
    const arr = Object.values(projects);
    arr.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return arr;
  }, [projects]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (severityFilter !== "all" && severityBucket(l) !== severityFilter)
        return false;
      if (eventTypeFilter !== "all" && (l.event_type ?? "") !== eventTypeFilter)
        return false;
      if (userFilter !== "all" && (l.user_id ?? "") !== userFilter)
        return false;
      if (projectFilter !== "all" && (l.project_id ?? "") !== projectFilter)
        return false;
      if (!s) return true;
      const owner = l.user_id ? owners[l.user_id] : undefined;
      const project = l.project_id ? projects[l.project_id] : undefined;
      return (
        (l.message ?? "").toLowerCase().includes(s) ||
        (l.event_type ?? "").toLowerCase().includes(s) ||
        (l.source ?? "").toLowerCase().includes(s) ||
        (owner?.email ?? "").toLowerCase().includes(s) ||
        (project?.name ?? "").toLowerCase().includes(s) ||
        l.id.toLowerCase().includes(s)
      );
    });
  }, [
    logs,
    owners,
    projects,
    search,
    severityFilter,
    eventTypeFilter,
    userFilter,
    projectFilter,
  ]);

  const counts = useMemo(() => {
    const c: Record<SeverityFilter, number> = {
      all: logs.length,
      info: 0,
      success: 0,
      warning: 0,
      error: 0,
    };
    for (const l of logs) c[severityBucket(l)] += 1;
    return c;
  }, [logs]);

  return (
    <div className="space-y-6">
      <AdminRlsWarning
        visible={errors.length > 0}
        message={errors.length > 0 ? errors.slice(0, 3).join(" · ") : undefined}
      />

      <CardShell
        eyebrow="// global-audit"
        title={`Audit stream (${filtered.length} / ${logs.length})`}
        description="Operator-grade view of every infrastructure_logs event. Filters narrow the live tail."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                autoRefresh
                  ? "border-basil-400/40 bg-basil-500/10 text-basil-200"
                  : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  autoRefresh ? "animate-pulse bg-basil-300" : "bg-white/40"
                }`}
              />
              {autoRefresh ? "Live" : "Paused"}
            </button>
            <AdminButton
              onClick={() => void refresh("refresh")}
              busy={refreshing}
            >
              Refresh
            </AdminButton>
          </div>
        }
      >
        {/* Filter bar */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITY_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                label={f.label}
                active={severityFilter === f.value}
                onClick={() => setSeverityFilter(f.value)}
                count={counts[f.value]}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 focus:border-red-400/40 focus:outline-none"
            >
              {eventTypes.map((t) => (
                <option key={t} value={t} className="bg-black">
                  {t === "all" ? "All event types" : t}
                </option>
              ))}
            </select>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 focus:border-red-400/40 focus:outline-none"
            >
              <option value="all" className="bg-black">
                All users
              </option>
              {userOptions.map((o) => (
                <option key={o.id} value={o.id} className="bg-black">
                  {o.email ?? o.id}
                </option>
              ))}
            </select>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 focus:border-red-400/40 focus:outline-none"
            >
              <option value="all" className="bg-black">
                All projects
              </option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id} className="bg-black">
                  {p.name ?? p.slug ?? p.id}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages, ids, sources…"
              className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-red-400/40 focus:outline-none"
            />
          </div>
        </div>

        {/* Terminal */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
          {loading ? (
            <div className="p-5 text-white/50">Loading audit stream…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No events match the filters"
                description="Adjust filters or clear search to see more events."
              />
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-white/5 overflow-y-auto">
              {filtered.map((log) => {
                const styles = logLevelClasses(logLevel(log));
                const owner = log.user_id ? owners[log.user_id] : undefined;
                const project = log.project_id
                  ? projects[log.project_id]
                  : undefined;
                const expanded = expandedId === log.id;
                return (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((curr) =>
                          curr === log.id ? null : log.id,
                        )
                      }
                      className="grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="text-white/35">
                        {shortTime(log.created_at)}
                      </span>
                      <span
                        className={`min-w-[90px] truncate ${styles.label}`}
                      >
                        {styles.tag}
                      </span>
                      <span className="truncate text-white/85">
                        {logMessage(log)}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                        {log.event_type ?? log.source ?? "event"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="bg-white/[0.02] px-4 py-3 text-[11px] text-white/70">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-white/40">
                              User
                            </p>
                            <p className="font-mono text-white/80">
                              {owner?.email ?? log.user_id ?? "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-white/40">
                              Project
                            </p>
                            <p className="font-mono text-white/80">
                              {project?.name ?? log.project_id ?? "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-white/40">
                              Severity
                            </p>
                            <StatusPill
                              label={log.severity ?? log.level ?? "info"}
                              tone={severityTone(severityBucket(log))}
                            />
                          </div>
                        </div>
                        {log.metadata ? (
                          <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/60 p-3 text-[10px] leading-relaxed text-white/60">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
          Stream tails the latest 300 events from{" "}
          <span className="text-white/70">infrastructure_logs</span>. Older
          events are available via direct query or future RPC.
        </p>
      </CardShell>
    </div>
  );
}
