"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { ZapIcon } from "@/src/components/ui/icons";
import {
  bindingTone,
  EDGE_FUNCTIONS_SCHEMA_SQL,
  EDGE_REGIONS,
  RUNTIME_META,
  deploymentStatusTone,
  functionStateTone,
  generateAmbientLogs,
  humanCount,
  humanMs,
  humanPct,
  invoke,
  logLevelTone,
  maskValue,
  relativeTime,
  rollbackDeployment,
  startDeployment,
  tickAmbientLog,
  tickDeployment,
  tickFunctionMetrics,
  type EdgeFunction,
  type FunctionDeployment,
  type FunctionLog,
  type Invocation,
  type InvocationRequest,
  type RuntimeKind,
} from "@/src/lib/edge-functions";
import { mergeFunctionSlice, readFunctionsStore } from "@/src/lib/functions-storage";

type LoadState = "loading" | "ready" | "redirect" | "missing";
type Tab = "overview" | "code" | "bindings" | "invoke" | "logs" | "deployments";

export function FunctionDetailClient({ functionId }: { functionId: string }) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [fn, setFn] = useState<EdgeFunction | null>(null);
  const [deployments, setDeployments] = useState<FunctionDeployment[]>([]);
  const [logs, setLogs] = useState<FunctionLog[]>([]);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const fnRef = useRef<EdgeFunction | null>(null);
  fnRef.current = fn;
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setLoadState("redirect");
        router.replace(`/login?next=/dashboard/functions/${functionId}`);
        return;
      }
      setSession(data.session);
      const store = readFunctionsStore(data.session.user.id);
      const found = store?.fns.find((f) => f.id === functionId) ?? null;
      if (!found) {
        setLoadState("missing");
        return;
      }
      const deps = (store?.deployments ?? []).filter((d) => d.function_id === functionId);
      const lg = (store?.logs ?? []).filter((l) => l.function_id === functionId);
      setFn(found);
      setDeployments(deps);
      setLogs(lg.length > 0 ? lg : generateAmbientLogs({ fn: found, count: 14 }));
      setLoadState("ready");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) {
        setLoadState("redirect");
        router.replace(`/login?next=/dashboard/functions/${functionId}`);
      }
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [functionId, router]);

  useEffect(() => {
    if (!session || !fn) return;
    mergeFunctionSlice(session.user.id, fn, deployments, logs);
  }, [session, fn, deployments, logs]);

  useEffect(() => {
    if (loadState !== "ready" || !fn) return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const tickMs = 1100;
      let cur = fnRef.current;
      if (!cur) return;
      cur = tickFunctionMetrics(cur);

      setDeployments((prev) => {
        const newLogs: FunctionLog[] = [];
        const next = prev.map((dep) => {
          if (dep.function_id !== cur!.id) return dep;
          if (
            dep.status === "active" ||
            dep.status === "failed" ||
            dep.status === "rolled_back"
          ) {
            return dep;
          }
          const r = tickDeployment(cur!, dep, tickMs, { failChance: 0.004 });
          if (r.fn !== cur) cur = r.fn;
          newLogs.push(...r.newLogs);
          return r.deployment;
        });
        if (newLogs.length > 0) {
          setLogs((p) => [...newLogs, ...p].slice(0, 200));
        }
        return next;
      });

      const amb = tickAmbientLog(cur);
      if (amb) setLogs((p) => [amb, ...p].slice(0, 200));
      fnRef.current = cur;
      setFn(cur);
    }, 1100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [loadState, fn?.id]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  const handleDeploy = useCallback(() => {
    if (!session || !fn) return;
    const r = startDeployment(fn, { fnId: fn.id, userId: session.user.id, triggeredBy: "manual" });
    setFn(r.fn);
    setDeployments((p) => [r.deployment, ...p].slice(0, 40));
    setLogs((p) => [...r.logs, ...p].slice(0, 200));
  }, [session, fn]);

  const handleRollback = useCallback(
    (dep: FunctionDeployment) => {
      if (!fn) return;
      const { fn: nf, deployment: nd, log } = rollbackDeployment(fn, dep);
      setFn(nf);
      setDeployments((p) => p.map((d) => (d.id === dep.id ? nd : d)));
      setLogs((p) => [log, ...p].slice(0, 200));
    },
    [fn],
  );

  const toggleRegion = useCallback((regionId: string) => {
    setFn((prev) => {
      if (!prev) return prev;
      const has = prev.regions.includes(regionId);
      const regions = has
        ? prev.regions.filter((r) => r !== regionId)
        : [...prev.regions, regionId];
      return { ...prev, regions, updated_at: new Date().toISOString() };
    });
  }, []);

  const [method, setMethod] = useState<InvocationRequest["method"]>("GET");
  const [path, setPath] = useState("/");
  const [headersJson, setHeadersJson] = useState('{"accept":"application/json"}');
  const [queryJson, setQueryJson] = useState("{}");
  const [body, setBody] = useState("");
  const [forceCold, setForceCold] = useState(false);
  const [forceErr, setForceErr] = useState(false);
  const [regionPick, setRegionPick] = useState<string>("");

  const runInvoke = useCallback(
    (ev: FormEvent) => {
      ev.preventDefault();
      if (!fn) return;
      let headers: Record<string, string> = {};
      let query: Record<string, string> = {};
      try {
        headers = JSON.parse(headersJson || "{}") as Record<string, string>;
      } catch {
        headers = {};
      }
      try {
        query = JSON.parse(queryJson || "{}") as Record<string, string>;
      } catch {
        query = {};
      }
      const req: InvocationRequest = {
        method,
        path: path || "/",
        headers,
        query,
        body,
      };
      const inv = invoke({
        fn,
        request: req,
        forceColdStart: forceCold,
        forceError: forceErr,
        preferredRegion: regionPick || undefined,
      });
      setInvocations((p) => [inv, ...p].slice(0, 30));
      setLogs((p) => [...inv.log_lines, ...p].slice(0, 200));
      setTab("invoke");
    },
    [fn, method, path, headersJson, queryJson, body, forceCold, forceErr, regionPick],
  );

  const meta = fn ? RUNTIME_META[fn.runtime] : null;
  const tone = fn ? functionStateTone(fn.state) : null;
  const errRate = useMemo(
    () => (fn && fn.invocations_24h > 0 ? fn.errors_24h / fn.invocations_24h : 0),
    [fn],
  );

  if (loadState === "loading") return <FullPage label="Loading function…" />;
  if (loadState === "redirect") return <FullPage label="Redirecting…" />;
  if (loadState === "missing" || !fn || !session) {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <BackgroundFX />
        <div className="relative z-10 mx-auto max-w-lg px-6 py-24 text-center">
          <p className="text-sm text-white/55">Function not found in local catalog.</p>
          <Link
            href="/dashboard/functions"
            className="mt-4 inline-block rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs text-basil-50"
          >
            Back to functions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />
      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="functions" userEmail={session.user.email} />
        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <Link
                href="/dashboard/functions"
                className="text-[10px] uppercase tracking-[0.28em] text-basil-300/80 hover:text-basil-200"
              >
                ← functions
              </Link>
              <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                <span
                  className={`grid h-10 w-10 place-items-center rounded-2xl border ${tone?.ring ?? ""} ${tone?.text ?? ""}`}
                >
                  <ZapIcon className="h-5 w-5" title={fn.name} />
                </span>
                <span className="min-w-0 truncate">{fn.name}</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${tone?.ring} ${tone?.text}`}
                >
                  {tone?.label}
                </span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">{fn.description}</p>
              <p className="mt-1 font-mono text-[11px] text-white/40">
                {fn.routes[0]?.method} {fn.routes[0]?.path}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDeploy}
                disabled={fn.state === "deploying"}
                className="rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-2 text-xs text-basil-50 transition hover:bg-basil-500/25 disabled:opacity-50"
              >
                Deploy
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          <TabBar tab={tab} onChange={setTab} />

          {tab === "overview" ? (
            <OverviewPanel fn={fn} errRate={errRate} meta={meta} deployments={deployments} />
          ) : null}
          {tab === "code" ? <CodePanel fn={fn} /> : null}
          {tab === "bindings" ? <BindingsPanel fn={fn} /> : null}
          {tab === "invoke" ? (
            <InvokePanel
              fn={fn}
              method={method}
              setMethod={setMethod}
              path={path}
              setPath={setPath}
              headersJson={headersJson}
              setHeadersJson={setHeadersJson}
              queryJson={queryJson}
              setQueryJson={setQueryJson}
              body={body}
              setBody={setBody}
              forceCold={forceCold}
              setForceCold={setForceCold}
              forceErr={forceErr}
              setForceErr={setForceErr}
              regionPick={regionPick}
              setRegionPick={setRegionPick}
              onSubmit={runInvoke}
              invocations={invocations}
            />
          ) : null}
          {tab === "logs" ? <LogsPanel logs={logs} /> : null}
          {tab === "deployments" ? (
            <DeploymentsPanel deployments={deployments} onRollback={handleRollback} />
          ) : null}

          <section className="mt-8 grid gap-4 lg:grid-cols-2">
            <ArchitectureCard />
            <RegionsPanel fn={fn} onToggle={toggleRegion} />
          </section>

          <section className="mt-6">
            <SqlCard />
          </section>
        </main>
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "code", label: "Source" },
    { id: "bindings", label: "Bindings" },
    { id: "invoke", label: "Invoke" },
    { id: "logs", label: "Logs" },
    { id: "deployments", label: "Deploys" },
  ];
  return (
    <div className="mt-6 flex flex-wrap gap-1 border-b border-white/10 pb-px">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`rounded-t-lg border border-b-0 px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition ${
            tab === t.id
              ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
              : "border-transparent text-white/50 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function OverviewPanel({
  fn,
  errRate,
  meta,
  deployments,
}: {
  fn: EdgeFunction;
  errRate: number;
  meta: (typeof RUNTIME_META)[RuntimeKind] | null;
  deployments: FunctionDeployment[];
}) {
  const live = deployments.find((d) => d.id === fn.active_deployment_id);
  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Runtime metrics · 24h</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Invocations" value={humanCount(fn.invocations_24h)} />
          <Metric label="p50 / p95" value={`${humanMs(fn.p50_ms)} / ${humanMs(fn.p95_ms)}`} />
          <Metric label="CPU avg" value={humanMs(fn.cpu_ms_avg)} />
          <Metric label="Cold rate" value={humanPct(fn.cold_start_rate)} />
          <Metric label="Errors" value={humanPct(errRate)} warn={errRate > 0.02} />
          <Metric label="Runtime" value={meta?.label ?? fn.runtime} />
          <Metric label="Isolation" value={meta?.isolation ?? "—"} />
          <Metric label="Regions" value={String(fn.regions.length)} />
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Active deployment</p>
        {live ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-white">
              v{live.version}{" "}
              <span className={deploymentStatusTone(live.status).text}>
                {deploymentStatusTone(live.status).label}
              </span>
            </p>
            <p className="text-xs text-white/55">{live.bundle_kb}KB · branch {live.branch}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-basil-400 transition-all"
                style={{ width: `${Math.round(live.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-white/45">No active deployment id.</p>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-2">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className={`text-sm font-medium ${warn ? "text-rose-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

function CodePanel({ fn }: { fn: EdgeFunction }) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Source excerpt</p>
      <pre className="mt-2 max-h-[480px] overflow-auto font-mono text-[11px] leading-relaxed text-basil-100/90">
        {fn.source_excerpt}
      </pre>
    </div>
  );
}

function BindingsPanel({ fn }: { fn: EdgeFunction }) {
  if (fn.bindings.length === 0) {
    return (
      <p className="mt-4 text-sm text-white/45">
        No bindings yet. Add secrets, KV, queues, and database URLs in the control plane.
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {fn.bindings.map((b) => {
        const t = bindingTone(b.kind);
        return (
          <li
            key={b.id}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${t.ring}`}
          >
            <div>
              <p className={`text-xs font-medium ${t.text}`}>{b.name}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{b.kind}</p>
            </div>
            <code className="max-w-md truncate font-mono text-[11px] text-white/70">{maskValue(b)}</code>
          </li>
        );
      })}
    </ul>
  );
}

function InvokePanel({
  fn,
  method,
  setMethod,
  path,
  setPath,
  headersJson,
  setHeadersJson,
  queryJson,
  setQueryJson,
  body,
  setBody,
  forceCold,
  setForceCold,
  forceErr,
  setForceErr,
  regionPick,
  setRegionPick,
  onSubmit,
  invocations,
}: {
  fn: EdgeFunction;
  method: InvocationRequest["method"];
  setMethod: (m: InvocationRequest["method"]) => void;
  path: string;
  setPath: (s: string) => void;
  headersJson: string;
  setHeadersJson: (s: string) => void;
  queryJson: string;
  setQueryJson: (s: string) => void;
  body: string;
  setBody: (s: string) => void;
  forceCold: boolean;
  setForceCold: (v: boolean) => void;
  forceErr: boolean;
  setForceErr: (v: boolean) => void;
  regionPick: string;
  setRegionPick: (s: string) => void;
  onSubmit: (ev: FormEvent) => void;
  invocations: Invocation[];
}) {
  const last = invocations[0];
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur"
      >
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Simulated invoke</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as InvocationRequest["method"])}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
            >
              {(["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"] as const).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Path
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-white"
            />
          </label>
        </div>
        <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
          Headers (JSON)
          <textarea
            value={headersJson}
            onChange={(e) => setHeadersJson(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-white"
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
          Query (JSON)
          <textarea
            value={queryJson}
            onChange={(e) => setQueryJson(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-white"
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
          Body
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder='{"hello":"gtlnav"}'
            className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-white"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-xs text-white/70">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={forceCold} onChange={(e) => setForceCold(e.target.checked)} />
            Force cold start
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={forceErr} onChange={(e) => setForceErr(e.target.checked)} />
            Force error path
          </label>
        </div>
        <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40">
          Preferred region (optional)
          <select
            value={regionPick}
            onChange={(e) => setRegionPick(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Auto (nearest)</option>
            {fn.regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-50 hover:bg-basil-500/25"
        >
          Run simulation
        </button>
      </form>
      <div className="space-y-3">
        <Inspector title="Request inspector" body={last ? JSON.stringify(last.request, null, 2) : "{}"} />
        <Inspector
          title="Response inspector"
          body={
            last
              ? JSON.stringify(
                  {
                    status: last.response.status,
                    headers: last.response.headers,
                    body: safeJson(last.response.body),
                  },
                  null,
                  2,
                )
              : "{}"
          }
        />
        {last ? (
          <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-white/70">
            <p>
              <span className="text-white/45">Region:</span> {last.region}{" "}
              <span className="text-white/45">· Cold:</span> {last.cold_start ? `${last.cold_start_ms}ms` : "warm"}{" "}
              <span className="text-white/45">· Total:</span> {humanMs(last.total_ms)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function Inspector({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/50 p-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{title}</p>
      <pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-cyan-100/90">{body}</pre>
    </div>
  );
}

function LogsPanel({ logs }: { logs: FunctionLog[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40 font-mono text-[11px]">
      <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
        Runtime logs · tail
      </div>
      <ol className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
        {logs.length === 0 ? (
          <li className="px-3 py-8 text-center text-white/45">No logs yet.</li>
        ) : (
          logs.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-2 px-3 py-1.5">
              <span className="text-white/35">{relativeTime(l.created_at)}</span>
              <span className={logLevelTone(l.level)}>{l.level}</span>
              <span className="text-white/45">{l.source}</span>
              {l.region ? <span className="text-cyan-300/80">{l.region}</span> : null}
              <span className="min-w-0 flex-1 text-white/80">{l.message}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function DeploymentsPanel({
  deployments,
  onRollback,
}: {
  deployments: FunctionDeployment[];
  onRollback: (d: FunctionDeployment) => void;
}) {
  return (
    <ul className="mt-4 space-y-2">
      {deployments.length === 0 ? (
        <li className="text-sm text-white/45">No deployments recorded.</li>
      ) : (
        deployments.map((d) => {
          const t = deploymentStatusTone(d.status);
          return (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div>
                <p className="text-sm text-white">
                  v{d.version}{" "}
                  <span className={t.text}>{t.label}</span>
                </p>
                <p className="text-[11px] text-white/45">
                  {relativeTime(d.created_at)} · {d.bundle_kb}KB · {d.regions.join(", ")}
                </p>
              </div>
              {d.status === "active" ? (
                <button
                  type="button"
                  onClick={() => onRollback(d)}
                  className="rounded-md border border-amber-400/30 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/10"
                >
                  Rollback (sim)
                </button>
              ) : null}
            </li>
          );
        })
      )}
    </ul>
  );
}

function ArchitectureCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Architecture seam</p>
      <h3 className="mt-1 text-lg font-semibold text-white">Toward the real plane</h3>
      <ul className="mt-3 space-y-2 text-xs text-white/60">
        <li>
          <span className="text-basil-200">Edge runtime</span> — V8 isolates at POPs, sub-ms scheduling, no container boot.
        </li>
        <li>
          <span className="text-cyan-200">Workers</span> — pooled isolates with durable bindings (KV, queue, cache).
        </li>
        <li>
          <span className="text-violet-200">Serverless</span> — microVM / container cold path, full Node, heavier isolation.
        </li>
        <li>
          <span className="text-white/80">Multi-region</span> — staged rollout with per-region health gates and automatic
          traffic shift.
        </li>
      </ul>
    </div>
  );
}

function RegionsPanel({ fn, onToggle }: { fn: EdgeFunction; onToggle: (id: string) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Edge regions</p>
      <h3 className="mt-1 text-lg font-semibold text-white">Execution POPs</h3>
      <p className="mt-1 text-xs text-white/55">
        Toggle where this function is scheduled. Real control plane will enforce plan limits.
      </p>
      <ul className="mt-3 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
        {EDGE_REGIONS.map((r) => {
          const on = fn.regions.includes(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onToggle(r.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                  on
                    ? "border-basil-400/35 bg-basil-500/10 text-basil-100"
                    : "border-white/10 bg-black/30 text-white/50 hover:border-white/20"
                }`}
              >
                <span>{r.label}</span>
                <span className="text-[10px] uppercase tracking-[0.15em]">{on ? "on" : "off"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SqlCard() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">Database</p>
          <h3 className="text-sm font-semibold text-white">edge_functions · function_deployments · function_logs</h3>
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
          className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/70 hover:border-basil-400/40"
        >
          {copied ? "Copied" : "Copy SQL"}
        </button>
      </header>
      <pre className="max-h-64 overflow-auto bg-black/50 p-4 font-mono text-[10px] text-white/70">
        {EDGE_FUNCTIONS_SCHEMA_SQL}
      </pre>
    </div>
  );
}

function FullPage({ label }: { label: string }) {
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
