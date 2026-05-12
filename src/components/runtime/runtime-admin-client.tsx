"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdminShell,
  type AdminContext,
} from "@/src/components/admin/admin-shell";
import { CardShell, MetricTile } from "@/src/components/admin/admin-ui";
import { LayersIcon, PulseIcon, TerminalIcon } from "@/src/components/ui/icons";
import {
  deploymentStatusStyle,
  logLevelClasses,
  shortTime,
} from "@/src/lib/dashboard-format";
import {
  isInflightRuntimeStatus,
  isTerminalStatus,
  RuntimeEngine,
  RUNTIME_DEPLOYMENT_STATUSES,
  type RuntimeEngineSnapshot,
} from "@/src/lib/runtime-engine";

export function RuntimeAdminClient() {
  return (
    <AdminShell
      activeKey="runtime"
      eyebrow="// admin / runtime"
      title="Global deployment runtime"
      description="Fleet-wide queue, worker saturation, and lifecycle observability — foundation for Docker, Coolify, Dokploy, and Hetzner VPS."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx: _ctx }: { ctx: AdminContext }) {
  const engineRef = useRef<RuntimeEngine | null>(null);
  const seeded = useRef(false);

  const [snap, setSnap] = useState<RuntimeEngineSnapshot>(() => {
    if (!engineRef.current) {
      engineRef.current = new RuntimeEngine({
        maxConcurrentDeploys: 4,
        phaseSpeed: 0.48,
      });
    }
    return engineRef.current.getSnapshot();
  });

  const engine = engineRef.current!;

  useEffect(() => engine.subscribe(setSnap), [engine]);

  useEffect(() => {
    const id = window.setInterval(() => {
      engine.tick(280);
      engine.prune(48);
    }, 280);
    return () => window.clearInterval(id);
  }, [engine]);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const samples = [
      { projectId: "p-alpha", projectName: "Tenant A · API", branch: "main" },
      { projectId: "p-beta", projectName: "Tenant B · Web", branch: "release" },
      { projectId: "p-gamma", projectName: "Tenant C · Edge fn", branch: "main" },
    ];
    for (const s of samples) {
      engine.enqueue(s);
    }
  }, [engine]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && snap.jobs[0]) setSelectedId(snap.jobs[0].id);
    if (selectedId && !snap.jobs.some((j) => j.id === selectedId)) {
      setSelectedId(snap.jobs[0]?.id ?? null);
    }
  }, [snap.jobs, selectedId]);

  const logs = useMemo(
    () => (selectedId ? engine.getLogs(selectedId) : []),
    [engine, selectedId, snap],
  );

  const queued = snap.jobs.filter((j) => j.status === "queued" && !j.workerId).length;
  const running = snap.jobs.filter(
    (j) => isInflightRuntimeStatus(j.status) && j.status !== "queued",
  ).length;
  const failed = snap.jobs.filter((j) => j.status === "failed").length;
  const active = snap.jobs.filter((j) => j.status === "active").length;

  return (
    <div className="space-y-6">
      <CardShell
        eyebrow="// fleet"
        title="Operator runtime overview"
        right={
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
            <PulseIcon className="h-3.5 w-3.5" title="Live" />
            Simulation · 280ms tick
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile label="Queued" value={String(queued)} hint="global" />
          <MetricTile label="Running" value={String(running)} hint="in-flight" tone="good" />
          <MetricTile label="Active" value={String(active)} hint="completed" tone="good" />
          <MetricTile
            label="Failed"
            value={String(failed)}
            hint="breaker / operator"
            tone={failed > 0 ? "warn" : "default"}
          />
        </div>
        <p className="mt-4 text-xs text-white/55">
          Concurrency cap:{" "}
          <span className="font-mono text-red-100/90">{snap.config.maxConcurrentDeploys}</span>{" "}
          simultaneous deployments. Workers:{" "}
          <span className="font-mono text-red-100/90">
            {snap.workers.filter((w) => w.status === "busy").length}/{snap.workers.length}
          </span>{" "}
          busy. Lifecycle states:{" "}
          <span className="font-mono text-white/70">{RUNTIME_DEPLOYMENT_STATUSES.join(", ")}</span>
          .
        </p>
      </CardShell>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <CardShell eyebrow="// workers" title="Worker fleet">
          <ul className="space-y-2">
            {snap.workers.map((w) => (
              <li
                key={w.id}
                className={`rounded-2xl border px-3 py-2 text-sm ${
                  w.status === "busy"
                    ? "border-red-400/35 bg-red-500/10"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-white/90">{w.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                    {w.region}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-white/45">{w.targets.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </CardShell>

        <CardShell eyebrow="// jobs" title="Live deployment jobs" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                <tr>
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Worker</th>
                  <th className="py-2">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[...snap.jobs]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((job) => {
                    const st = deploymentStatusStyle(job.status);
                    const rowSel = job.id === selectedId;
                    return (
                      <tr
                        key={job.id}
                        className={`cursor-pointer hover:bg-white/[0.03] ${rowSel ? "bg-red-500/5" : ""}`}
                        onClick={() => setSelectedId(job.id)}
                      >
                        <td className="py-2 pr-3">
                          <p className="font-medium text-white/90">{job.projectName}</p>
                          <p className="font-mono text-[11px] text-white/45">{job.id.slice(0, 10)}…</p>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${st.ring} ${st.text}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {st.tag}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-white/55">
                          {job.workerId?.slice(0, 8) ?? "—"}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              disabled={isTerminalStatus(job.status)}
                              onClick={(e) => {
                                e.stopPropagation();
                                engine.cancel(job.id);
                              }}
                              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-amber-400/40 hover:text-amber-100 disabled:opacity-30"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isTerminalStatus(job.status)}
                              onClick={(e) => {
                                e.stopPropagation();
                                engine.failDeployment(job.id);
                              }}
                              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-red-400/40 hover:text-red-100 disabled:opacity-30"
                            >
                              Fail
                            </button>
                            <button
                              type="button"
                              disabled={job.status !== "failed" && job.status !== "cancelled"}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nid = engine.retry(job.id);
                                if (nid) setSelectedId(nid);
                              }}
                              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-red-300/40 hover:text-red-50 disabled:opacity-30"
                            >
                              Retry
                            </button>
                            <button
                              type="button"
                              disabled={job.status !== "active"}
                              onClick={(e) => {
                                e.stopPropagation();
                                engine.rollback(job.id);
                              }}
                              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-violet-400/40 hover:text-violet-100 disabled:opacity-30"
                            >
                              Rollback
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardShell>
      </div>

      <CardShell
        eyebrow="// stream"
        title="Runtime log stream"
        right={<TerminalIcon className="h-4 w-4 text-red-200" title="Logs" />}
      >
        <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
          {logs.length === 0 ? (
            <p className="p-4 text-xs text-white/45">Select a job row to tail logs.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {logs.map((line) => {
                const styles = logLevelClasses(line.level);
                return (
                  <li key={line.id} className="grid grid-cols-[auto_auto_1fr] gap-3 px-3 py-1.5">
                    <span className="text-white/35">
                      {shortTime(new Date(line.ts).toISOString())}
                    </span>
                    <span className={`${styles.label} min-w-[72px]`}>{styles.tag}</span>
                    <span className="text-white/80">
                      <span className="text-white/45">[{line.source}]</span> {line.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardShell>

      <CardShell eyebrow="// roadmap" title="Provider adapters (planned)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AdapterCard
            title="Coolify / Dokploy"
            body="Control-plane hooks: create/update compose stacks, route domains, stream remote build logs."
          />
          <AdapterCard
            title="Docker + Hetzner VPS"
            body="Node provisioning: SSH bootstrap, daemon socket, image pulls, health checks before traffic shift."
          />
        </div>
      </CardShell>
    </div>
  );
}

function AdapterCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2">
        <LayersIcon className="h-4 w-4 text-red-200" title="Layers" />
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-xs text-white/55">{body}</p>
    </div>
  );
}
