"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PreviewBanner } from "@/src/components/ui/preview-banner";
import { ZapIcon } from "@/src/components/ui/icons";
import {
  EDGE_FUNCTIONS_SCHEMA_SQL,
  EDGE_REGIONS,
  FUNCTION_STATES,
  RUNTIME_KINDS,
  RUNTIME_META,
  SAMPLE_SOURCE,
  functionStateTone,
  generateFunctions,
  humanCount,
  humanMs,
  humanPct,
  relativeTime,
  startDeployment,
  tickAmbientLog,
  tickDeployment,
  tickFunctionMetrics,
  type EdgeFunction,
  type FunctionDeployment,
  type FunctionLog,
  type FunctionState,
  type RuntimeKind,
} from "@/src/lib/edge-functions";
import {
  readFunctionsStore,
  writeFunctionsStore,
} from "@/src/lib/functions-storage";

type LoadState = "loading" | "ready" | "redirect";
type Toast = { tone: "success" | "error" | "info"; text: string } | null;

type StateFilter = "all" | FunctionState;
type RuntimeFilter = "all" | RuntimeKind;

export default function FunctionsClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [fns, setFns] = useState<EdgeFunction[]>([]);
  const [deployments, setDeployments] = useState<FunctionDeployment[]>([]);
  const [logs, setLogs] = useState<FunctionLog[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const tickRef = useRef<number | null>(null);
  const fnsRef = useRef<EdgeFunction[]>([]);
  fnsRef.current = fns;

  const flashToast = useCallback((tone: NonNullable<Toast>["tone"], text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Auth
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/functions");
        return;
      }
      setSession(data.session);
      setLoadState("ready");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/functions");
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
    const cached = readFunctionsStore(session.user.id);
    if (cached && cached.fns.length > 0) {
      setFns(cached.fns);
      setDeployments(cached.deployments);
      setLogs(cached.logs);
      return;
    }
    const seeded = generateFunctions({ userId: session.user.id, count: 6 });
    setFns(seeded);
    setDeployments([]);
    setLogs([]);
    writeFunctionsStore({
      userId: session.user.id,
      fns: seeded,
      deployments: [],
      logs: [],
    });
  }, [session]);

  // Persist
  useEffect(() => {
    if (!session) return;
    writeFunctionsStore({ userId: session.user.id, fns, deployments, logs });
  }, [session, fns, deployments, logs]);

  // Live ticking — advance deploys, mutate metrics, emit ambient logs.
  useEffect(() => {
    if (loadState !== "ready") return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const tickMs = 1100;
      let nextFns = fnsRef.current.map((f) => tickFunctionMetrics(f));

      setDeployments((prevDeps) => {
        const newLogsAccum: FunctionLog[] = [];
        const nextDeps = prevDeps.map((dep) => {
          const fn = nextFns.find((f) => f.id === dep.function_id);
          if (!fn) return dep;
          if (
            dep.status === "active" ||
            dep.status === "failed" ||
            dep.status === "rolled_back"
          ) {
            return dep;
          }
          const result = tickDeployment(fn, dep, tickMs, { failChance: 0.005 });
          if (result.fn !== fn) {
            nextFns = nextFns.map((f) => (f.id === result.fn.id ? result.fn : f));
          }
          if (result.newLogs.length > 0) newLogsAccum.push(...result.newLogs);
          return result.deployment;
        });

        if (newLogsAccum.length > 0) {
          setLogs((prev) => [...newLogsAccum, ...prev].slice(0, 400));
        }
        return nextDeps;
      });

      const ambient: FunctionLog[] = [];
      for (const f of nextFns) {
        const log = tickAmbientLog(f);
        if (log) ambient.push(log);
      }
      if (ambient.length > 0) {
        setLogs((prev) => [...ambient, ...prev].slice(0, 400));
      }

      fnsRef.current = nextFns;
      setFns(nextFns);
    }, 1100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [loadState]);

  // Actions
  const handleCreate = useCallback(
    (input: { name: string; runtime: RuntimeKind; description: string }) => {
      if (!session) return;
      const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) {
        flashToast("error", "Name is required.");
        return;
      }
      if (fns.some((f) => f.slug === slug)) {
        flashToast("error", "Function slug already exists.");
        return;
      }
      const created: EdgeFunction = {
        id: `fn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        user_id: session.user.id,
        project_id: null,
        name: input.name,
        slug,
        description: input.description,
        runtime: input.runtime,
        state: "draft",
        triggers: ["http"],
        routes: [{ method: "ANY", path: `/api/fn/${slug}/*` }],
        regions:
          input.runtime === "edge"
            ? ["iad1", "lhr1", "nrt1"]
            : input.runtime === "worker"
              ? ["iad1", "lhr1"]
              : ["iad1"],
        active_deployment_id: null,
        version: 0,
        invocations_24h: 0,
        errors_24h: 0,
        p50_ms: RUNTIME_META[input.runtime].latencyMs[0],
        p95_ms: RUNTIME_META[input.runtime].latencyMs[1],
        cpu_ms_avg: 0,
        cold_start_rate: 0.04,
        bindings: [],
        source_excerpt: SAMPLE_SOURCE[input.runtime],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setFns((prev) => [created, ...prev]);
      setCreateOpen(false);
      flashToast("success", `${input.name} created. Deploy to bring it live.`);
    },
    [session, fns, flashToast],
  );

  const handleDeploy = useCallback(
    (fnId: string) => {
      if (!session) return;
      const fn = fns.find((f) => f.id === fnId);
      if (!fn) return;
      const result = startDeployment(fn, {
        fnId,
        userId: session.user.id,
        triggeredBy: "manual",
      });
      setFns((prev) => prev.map((f) => (f.id === fnId ? result.fn : f)));
      setDeployments((prev) => [result.deployment, ...prev].slice(0, 80));
      setLogs((prev) => [...result.logs, ...prev].slice(0, 400));
      flashToast("info", `Deploying ${fn.name} v${result.deployment.version}…`);
    },
    [session, fns, flashToast],
  );

  const handleDelete = useCallback(
    (fnId: string) => {
      const fn = fns.find((f) => f.id === fnId);
      if (!fn) return;
      if (typeof window !== "undefined" && !window.confirm(`Delete ${fn.name}? This cannot be undone.`)) {
        return;
      }
      setFns((prev) => prev.filter((f) => f.id !== fnId));
      setDeployments((prev) => prev.filter((d) => d.function_id !== fnId));
      setLogs((prev) => prev.filter((l) => l.function_id !== fnId));
      flashToast("success", `${fn.name} removed.`);
    },
    [fns, flashToast],
  );

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  // Derived
  const filtered = useMemo(() => {
    return fns.filter((f) => {
      if (stateFilter !== "all" && f.state !== stateFilter) return false;
      if (runtimeFilter !== "all" && f.runtime !== runtimeFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !f.name.toLowerCase().includes(q) &&
          !f.description.toLowerCase().includes(q) &&
          !f.slug.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [fns, stateFilter, runtimeFilter, search]);

  const totals = useMemo(() => {
    let invocations = 0;
    let errors = 0;
    let active = 0;
    let deploying = 0;
    let failed = 0;
    for (const f of fns) {
      invocations += f.invocations_24h;
      errors += f.errors_24h;
      if (f.state === "active") active += 1;
      else if (f.state === "deploying") deploying += 1;
      else if (f.state === "failed") failed += 1;
    }
    return { invocations, errors, active, deploying, failed, total: fns.length };
  }, [fns]);

  if (loadState === "loading") return <FullPageMessage label="Verifying session…" />;
  if (loadState === "redirect" || !session) return <FullPageMessage label="Redirecting to sign in…" />;

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
        <DashboardSidebar activeKey="functions" userEmail={session.user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <PreviewBanner title="Edge functions — preview, not executing user code">
            This module persists configuration only. Real function execution
            (V8 isolates / WASM) is on the Phase 6C roadmap.
          </PreviewBanner>
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // edge runtime & functions
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200">
                  <ZapIcon className="h-5 w-5" title="Functions" />
                </span>
                Functions
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Edge isolates, regional workers, and serverless containers — one
                control plane. Deploy, invoke, and inspect every request across
                {` ${EDGE_REGIONS.length} regions`}. Runtime is simulated locally
                today and wires into the real isolate plane next.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-50 transition hover:bg-basil-500/25"
              >
                + New function
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          <SummaryGrid totals={totals} />

          <RuntimeShowcase />

          <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                  // function catalog
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  All functions
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  placeholder="Search functions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/35 outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
                />
              </div>
            </header>

            <div className="flex flex-wrap gap-1.5 border-b border-white/5 px-3 py-2">
              <FilterChip active={stateFilter === "all"} onClick={() => setStateFilter("all")} label="All" count={fns.length} />
              {FUNCTION_STATES.map((s) => (
                <FilterChip
                  key={s}
                  active={stateFilter === s}
                  onClick={() => setStateFilter(s)}
                  label={functionStateTone(s).label}
                  count={fns.filter((f) => f.state === s).length}
                  tone={functionStateTone(s)}
                />
              ))}
              <span className="mx-2 h-5 w-px self-center bg-white/10" />
              <FilterChip active={runtimeFilter === "all"} onClick={() => setRuntimeFilter("all")} label="Any runtime" count={fns.length} />
              {RUNTIME_KINDS.map((r) => (
                <FilterChip
                  key={r}
                  active={runtimeFilter === r}
                  onClick={() => setRuntimeFilter(r)}
                  label={RUNTIME_META[r].short}
                  count={fns.filter((f) => f.runtime === r).length}
                />
              ))}
            </div>

            <ul className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <li className="px-6 py-16 text-center text-sm text-white/45">
                  No functions match the current filters.
                </li>
              ) : (
                filtered.map((fn) => (
                  <FunctionRow
                    key={fn.id}
                    fn={fn}
                    deployments={deployments.filter((d) => d.function_id === fn.id)}
                    onDeploy={() => handleDeploy(fn.id)}
                    onDelete={() => handleDelete(fn.id)}
                  />
                ))
              )}
            </ul>
          </section>

          <section className="mt-6">
            <SchemaSetupCard />
          </section>

          <footer className="mt-10 border-t border-white/5 pt-5 text-[10px] uppercase tracking-[0.2em] text-white/35">
            // GTLNAV runtime · v8 isolates · regional workers · firecracker vms · multi-region by default
          </footer>
        </main>
      </div>

      {createOpen ? (
        <CreateFunctionModal
          onCancel={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Summary
// ---------------------------------------------------------------------------

function SummaryGrid({
  totals,
}: {
  totals: { invocations: number; errors: number; active: number; deploying: number; failed: number; total: number };
}) {
  const errRate = totals.invocations > 0 ? totals.errors / totals.invocations : 0;
  return (
    <section className="mt-6 grid gap-3 md:grid-cols-4">
      <Tile label="Active" value={String(totals.active)} sub={`of ${totals.total} total`} accent={functionStateTone("active")} />
      <Tile label="Deploying" value={String(totals.deploying)} sub="rolling out…" accent={functionStateTone("deploying")} />
      <Tile label="Invocations · 24h" value={humanCount(totals.invocations)} sub={`${humanCount(totals.errors)} errors`} />
      <Tile label="Error rate" value={humanPct(errRate)} sub={totals.failed > 0 ? `${totals.failed} failed deploys` : "all healthy"} accent={errRate > 0.02 ? functionStateTone("failed") : functionStateTone("active")} />
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: ReturnType<typeof functionStateTone>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className={`text-2xl font-semibold ${accent ? accent.text : "text-white"}`}>{value}</p>
        {accent ? <span aria-hidden className={`mb-1 inline-block h-2 w-2 rounded-full ${accent.dot}`} /> : null}
      </div>
      <p className="mt-1 truncate text-xs text-white/45">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Runtime showcase
// ---------------------------------------------------------------------------

function RuntimeShowcase() {
  return (
    <section className="mt-6 grid gap-3 md:grid-cols-3">
      {RUNTIME_KINDS.map((r) => {
        const meta = RUNTIME_META[r];
        return (
          <div
            key={r}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-5 backdrop-blur"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-basil-300/70">
              {r}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">{meta.label}</h3>
            <p className="mt-1 text-xs text-white/55">{meta.blurb}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <Spec label="Cold start" value={`${meta.coldStartMs[0]}–${meta.coldStartMs[1]}ms`} />
              <Spec label="CPU limit" value={humanMs(meta.cpuLimitMs)} />
              <Spec label="Memory" value={`${meta.memoryMb}MB`} />
              <Spec label="p50 latency" value={`${meta.latencyMs[0]}–${meta.latencyMs[1]}ms`} />
              <Spec label="Isolation" value={meta.isolation} />
            </dl>
          </div>
        );
      })}
    </section>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className="text-[11px] text-white/85">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: ReturnType<typeof functionStateTone>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
        active
          ? tone
            ? `${tone.ring} ${tone.text}`
            : "border-basil-400/40 bg-basil-500/10 text-basil-100"
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
//  Row
// ---------------------------------------------------------------------------

function FunctionRow({
  fn,
  deployments,
  onDeploy,
  onDelete,
}: {
  fn: EdgeFunction;
  deployments: FunctionDeployment[];
  onDeploy: () => void;
  onDelete: () => void;
}) {
  const tone = functionStateTone(fn.state);
  const meta = RUNTIME_META[fn.runtime];
  const liveDep = deployments.find((d) => d.id === fn.active_deployment_id);
  const errRate = fn.invocations_24h > 0 ? fn.errors_24h / fn.invocations_24h : 0;
  const canDeploy = fn.state !== "deploying";
  return (
    <li className="relative px-5 py-4 transition-colors hover:bg-white/[0.02]">
      <span aria-hidden className={`pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-full ${tone.bar}`} />
      <div className="grid items-center gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <div className="min-w-0">
          <Link
            href={`/dashboard/functions/${fn.id}`}
            className="block group"
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
              <span className={tone.text}>{tone.label}</span>
              <span>·</span>
              <span>{meta.short}</span>
              <span>·</span>
              <span>v{fn.version}</span>
              {fn.regions.length > 0 ? (
                <>
                  <span>·</span>
                  <span>{fn.regions.length} regions</span>
                </>
              ) : null}
            </div>
            <h3 className="mt-1 truncate text-sm font-medium text-white group-hover:text-basil-100">
              {fn.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-white/55">{fn.description}</p>
            <p className="mt-1 truncate font-mono text-[11px] text-white/40">
              {fn.routes[0]?.method} {fn.routes[0]?.path}
            </p>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Invocations" value={humanCount(fn.invocations_24h)} sub="24h" />
          <Stat label="p50 / p95" value={`${humanMs(fn.p50_ms)} / ${humanMs(fn.p95_ms)}`} sub="latency" />
          <Stat
            label="Errors"
            value={humanPct(errRate)}
            sub={`${humanCount(fn.errors_24h)} total`}
            accent={errRate > 0.02 ? "rose" : "muted"}
          />
        </div>

        <div className="text-[11px] text-white/55">
          {fn.state === "deploying" && liveDep ? (
            <DeployStrip dep={liveDep} />
          ) : (
            <div className="flex flex-col">
              <span>Cold {humanPct(fn.cold_start_rate)}</span>
              <span className="text-white/35">CPU avg {humanMs(fn.cpu_ms_avg)}</span>
              <span className="text-white/35">Updated {relativeTime(fn.updated_at)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-self-end">
          <Link
            href={`/dashboard/functions/${fn.id}`}
            className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/75 transition hover:border-white/20 hover:text-white"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={onDeploy}
            disabled={!canDeploy}
            className="rounded-md border border-basil-400/30 bg-basil-500/10 px-2.5 py-1 text-[11px] text-basil-100 transition hover:bg-basil-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Deploy
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition hover:border-rose-400/30 hover:text-rose-200"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "muted" | "rose";
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className={`text-[12px] font-medium ${accent === "rose" ? "text-rose-200" : "text-white"}`}>{value}</p>
      <p className="text-[9px] text-white/35">{sub}</p>
    </div>
  );
}

function DeployStrip({ dep }: { dep: FunctionDeployment }) {
  const phaseLabel: Record<string, string> = {
    queued: "Queued",
    bundling: "Bundling",
    uploading: "Uploading",
    rolling_out: "Rolling out",
    active: "Active",
    failed: "Failed",
    rolled_back: "Rolled back",
  };
  const total = dep.regions.length || 1;
  const ready = dep.regions.filter((r) => dep.region_status[r] === "active").length;
  const propPct = (ready / total) * 100;
  const phasePct = dep.progress * 100;
  return (
    <div className="rounded-md border border-cyan-400/25 bg-cyan-500/5 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.2em] text-cyan-200/85">
        {phaseLabel[dep.status] ?? dep.status}
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-400 to-basil-400 transition-all"
          style={{
            width: `${dep.status === "rolling_out" ? Math.max(8, propPct) : Math.max(8, phasePct)}%`,
          }}
        />
      </div>
      <p className="mt-1 text-[9px] text-white/45">
        {dep.status === "rolling_out"
          ? `${ready}/${total} regions live`
          : `v${dep.version} · ${dep.bundle_kb}KB bundle`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Create modal
// ---------------------------------------------------------------------------

function CreateFunctionModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { name: string; runtime: RuntimeKind; description: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runtime, setRuntime] = useState<RuntimeKind>("edge");

  function submit(ev: FormEvent) {
    ev.preventDefault();
    onSubmit({ name: name.trim(), runtime, description: description.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-xl rounded-2xl border border-white/15 bg-black/80 p-6 shadow-2xl backdrop-blur-xl"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-basil-300/70">
              // create function
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">New edge function</h2>
            <p className="mt-1 text-xs text-white/55">
              Pick a runtime, give it a name. You can deploy it from the
              catalog once it's saved.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/55 transition hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </header>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
              Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="auth-edge"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/35 outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/35 outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Runtime</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {RUNTIME_KINDS.map((r) => {
                const meta = RUNTIME_META[r];
                const active = runtime === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRuntime(r)}
                    className={`rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-basil-400/40 bg-basil-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{r}</p>
                    <p className="mt-0.5 text-sm font-medium text-white">{meta.label}</p>
                    <p className="mt-1 text-[11px] text-white/55">{meta.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/65 transition hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-50 transition hover:bg-basil-500/25"
          >
            Create function
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Schema setup card
// ---------------------------------------------------------------------------

function SchemaSetupCard() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // database setup
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Persist functions in Supabase
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-white/55">
            Run once. Until the tables exist, the catalog runs locally via the
            simulator and survives across reloads in localStorage. Schema is
            forward-compatible with the real isolate plane.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(EDGE_FUNCTIONS_SCHEMA_SQL);
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
        {EDGE_FUNCTIONS_SCHEMA_SQL}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Misc
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
