"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PreviewBanner } from "@/src/components/ui/preview-banner";
import { RealRuntimeInstances } from "@/src/components/runtime/real-runtime-instances";
import { LayersIcon, PulseIcon, RocketIcon, TerminalIcon } from "@/src/components/ui/icons";
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

type ProjectRow = { id: string; name: string | null };

export function RuntimeDashboardClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const engineRef = useRef<RuntimeEngine | null>(null);
  const demoSeeded = useRef(false);
  const [snap, setSnap] = useState<RuntimeEngineSnapshot>(() => {
    if (!engineRef.current) {
      engineRef.current = new RuntimeEngine({
        maxConcurrentDeploys: 2,
        phaseSpeed: 0.52,
      });
    }
    return engineRef.current.getSnapshot();
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [enqueueChoice, setEnqueueChoice] = useState<string>("demo");

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, newSession) => {
      if (!newSession) {
        router.replace("/login");
        return;
      }
      setSession(newSession);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  const engine = engineRef.current!;

  useEffect(() => {
    return engine.subscribe(setSnap);
  }, [engine]);

  useEffect(() => {
    const id = window.setInterval(() => {
      engine.tick(260);
      engine.prune(36);
    }, 260);
    return () => window.clearInterval(id);
  }, [engine]);

  const uid = session?.user?.id;

  const loadProjects = useCallback(async () => {
    if (!uid) return;
    const res = await supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(40);
    if (!res.error && res.data) {
      setProjects(res.data as ProjectRow[]);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    void loadProjects();
  }, [uid, loadProjects]);

  useEffect(() => {
    if (!uid) return;
    if (demoSeeded.current) return;
    if (snap.jobs.length > 0) {
      demoSeeded.current = true;
      return;
    }
    demoSeeded.current = true;
    engine.enqueue({
      projectId: "demo-project",
      projectName: "Demo · Edge API",
      branch: "main",
    });
  }, [uid, snap.jobs.length, engine]);

  useEffect(() => {
    if (!selectedId && snap.jobs[0]) setSelectedId(snap.jobs[0].id);
    if (selectedId && !snap.jobs.some((j) => j.id === selectedId)) {
      setSelectedId(snap.jobs[0]?.id ?? null);
    }
  }, [snap.jobs, selectedId]);

  const selected = useMemo(
    () => snap.jobs.find((j) => j.id === selectedId) ?? null,
    [snap.jobs, selectedId],
  );

  const logs = useMemo(
    () => (selectedId ? engine.getLogs(selectedId) : []),
    [engine, selectedId, snap],
  );

  const queued = snap.jobs.filter((j) => j.status === "queued" && !j.workerId).length;
  const running = snap.jobs.filter((j) => isInflightRuntimeStatus(j.status) && j.status !== "queued").length;

  const handleEnqueue = () => {
    if (enqueueChoice === "demo") {
      engine.enqueue({
        projectId: `demo-${Date.now().toString(36)}`,
        projectName: "Synthetic workload",
        branch: "main",
      });
      return;
    }
    const p = projects.find((x) => x.id === enqueueChoice);
    if (p) {
      engine.enqueue({
        projectId: p.id,
        projectName: p.name ?? p.id,
        branch: "main",
      });
    }
  };

  const isLoading = session === undefined;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 45% at 85% -10%, rgba(111,232,154,0.09) 0%, transparent 60%), radial-gradient(40% 40% at 5% 110%, rgba(111,232,154,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="runtime" userEmail={session?.user?.email ?? null} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <RealRuntimeInstances />
          <PreviewBanner title="Runtime simulator — preview metrics only">
            The cards below are driven by an in-process simulator for design
            review. Real container state lives in the panel above.
          </PreviewBanner>
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200 shadow-[0_0_24px_-8px_rgba(111,232,154,0.65)]">
                <LayersIcon className="h-5 w-5" title="Runtime" />
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                  // deployment runtime
                </p>
                <h1 className="text-lg font-semibold tracking-tight md:text-xl">
                  Real deployment engine (foundation)
                </h1>
                <p className="mt-1 max-w-2xl text-xs text-white/55">
                  Workers, queue, lifecycle, Docker/VPS prep hooks, concurrency — no external
                  providers yet. Designed for Coolify, Dokploy, Docker, and Hetzner VPS next.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-basil-200">
                <PulseIcon className="h-3.5 w-3.5" title="Live" />
                Live tick · 260ms
              </span>
            </div>
          </header>

          {isLoading ? (
            <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center text-xs uppercase tracking-[0.28em] text-white/50">
              Authenticating…
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Queued" value={String(queued)} hint="waiting for worker" />
                <Metric label="Running" value={String(running)} hint="in-flight phases" />
                <Metric
                  label="Concurrency cap"
                  value={String(snap.config.maxConcurrentDeploys)}
                  hint="global slot limit"
                />
                <Metric
                  label="Workers"
                  value={`${snap.workers.filter((w) => w.status === "busy").length}/${snap.workers.length}`}
                  hint="busy / total"
                />
              </section>

              <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-xl lg:flex-row lg:items-end">
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                    Enqueue deployment
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      className="min-w-[200px] rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-basil-400/40"
                      value={enqueueChoice}
                      onChange={(e) => setEnqueueChoice(e.target.value)}
                    >
                      <option value="demo">Synthetic demo project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name ?? p.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleEnqueue}
                      className="inline-flex items-center gap-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 hover:border-basil-300/60"
                    >
                      <RocketIcon className="h-4 w-4" title="Enqueue" />
                      Enqueue
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-[11px] text-white/55">
                    <span className="uppercase tracking-[0.16em]">Slots</span>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      value={snap.config.maxConcurrentDeploys}
                      onChange={(e) =>
                        engine.setConfig({
                          maxConcurrentDeploys: Number(e.target.value),
                        })
                      }
                      className="accent-basil-400"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <section className="rounded-3xl border border-white/10 bg-black/35 p-5 xl:col-span-1">
                  <h2 className="text-sm font-semibold text-white">Build runners & workers</h2>
                  <p className="mt-1 text-xs text-white/50">
                    Each job binds to a worker during prepare → deploy. Targets list shows
                    future adapter slots.
                  </p>
                  <ul className="mt-4 space-y-2">
                    {snap.workers.map((w) => (
                      <li
                        key={w.id}
                        className={`rounded-2xl border px-3 py-2 text-sm ${
                          w.status === "busy"
                            ? "border-basil-400/35 bg-basil-500/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-white/90">{w.label}</span>
                          <span className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                            {w.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-white/45">
                          {w.region} · {w.targets.join(" · ")}
                        </p>
                        {w.currentJobId ? (
                          <p className="mt-1 font-mono text-[10px] text-basil-200/90">
                            job {w.currentJobId.slice(0, 8)}…
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-3xl border border-white/10 bg-black/35 p-5 xl:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-white">Deployment queue</h2>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                      States: {RUNTIME_DEPLOYMENT_STATUSES.join(" · ")}
                    </p>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                        <tr>
                          <th className="py-2 pr-3">Project</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Worker</th>
                          <th className="py-2 pr-3">Queue</th>
                          <th className="py-2 pr-3">Retry</th>
                          <th className="py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {[...snap.jobs]
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .map((job) => {
                            const st = deploymentStatusStyle(job.status);
                            const activeRow = job.id === selectedId;
                            return (
                              <tr
                                key={job.id}
                                className={`cursor-pointer hover:bg-white/[0.03] ${
                                  activeRow ? "bg-basil-500/5" : ""
                                }`}
                                onClick={() => setSelectedId(job.id)}
                              >
                                <td className="py-2 pr-3">
                                  <p className="font-medium text-white/90">{job.projectName}</p>
                                  <p className="font-mono text-[11px] text-white/45">
                                    {job.branch} @ {job.commitSha}
                                  </p>
                                </td>
                                <td className="py-2 pr-3">
                                  <span
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${st.ring} ${st.text}`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                                    {st.tag}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs text-white/60">
                                  {job.workerId?.slice(0, 8) ?? "—"}
                                </td>
                                <td className="py-2 pr-3 text-xs text-white/55">
                                  {job.status === "queued" && !job.workerId ? `#${job.queuePosition}` : "—"}
                                </td>
                                <td className="py-2 pr-3 text-xs text-white/55">{job.retryCount}</td>
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
                                        engine.failDeployment(job.id, "Injected failure (operator sim)");
                                      }}
                                      className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-red-400/40 hover:text-red-100 disabled:opacity-30"
                                    >
                                      Fail
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        job.status !== "failed" && job.status !== "cancelled"
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const nid = engine.retry(job.id);
                                        if (nid) setSelectedId(nid);
                                      }}
                                      className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:border-basil-400/40 hover:text-basil-100 disabled:opacity-30"
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
                </section>
              </div>

              <section className="rounded-3xl border border-white/10 bg-black/50 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <TerminalIcon className="h-4 w-4 text-basil-200" title="Logs" />
                  <h2 className="text-sm font-semibold text-white">Runtime logs</h2>
                  {selected ? (
                    <span className="text-xs text-white/45">
                      · {selected.projectName}{" "}
                      <span className="font-mono text-white/55">({selected.id.slice(0, 8)}…)</span>
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 max-h-[380px] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 font-mono text-[12px]">
                  {logs.length === 0 ? (
                    <p className="p-4 text-xs text-white/45">Select a deployment to stream logs.</p>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {logs.map((line) => {
                        const styles = logLevelClasses(line.level);
                        return (
                          <li
                            key={line.id}
                            className="grid grid-cols-[auto_auto_1fr] gap-3 px-3 py-1.5"
                          >
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
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-basil-100">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/35">{hint}</p>
    </div>
  );
}
