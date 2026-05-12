"use client";

/**
 * Real runtime instances panel.
 *
 * Reads `/api/runtime/instances` (real database) and presents:
 *   - hosting kind (static / docker)
 *   - container state if docker
 *   - real Start / Stop / Restart / Destroy buttons that POST to
 *     `/api/runtime/instances/[id]/{action}`.
 *
 * The runtime dashboard renders this BEFORE the simulator-based cards so
 * users see what's actually running first, and the legacy simulator stays
 * available below behind a preview banner.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

type Instance = {
  id: string;
  project_id: string | null;
  deployment_id: string | null;
  runtime_kind: "static" | "docker" | string | null;
  target_state: "running" | "stopped" | "destroyed" | string | null;
  status: string | null;
  internal_port: number | null;
  container_name: string | null;
  image_tag: string | null;
  last_health_status: string | null;
  last_health_check: string | null;
  last_action: string | null;
  last_action_at: string | null;
  restart_count: number | null;
  framework: string | null;
  serve_path: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const FETCH_INTERVAL_MS = 10_000;

const ACTION_LABEL: Record<string, string> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  destroy: "Destroy",
};

export function RealRuntimeInstances() {
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});

  // The pollTick ref lets us trigger an immediate refetch after a user
  // action without re-running the effect.
  const [pollTick, setPollTick] = useState(0);
  const triggerRefetch = useCallback(() => setPollTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (cancelled) return;
        if (!session) {
          setError("Sign in to view runtime instances.");
          setLoading(false);
          return;
        }
        const resp = await fetch("/api/runtime/instances", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Accept: "application/json",
          },
          cache: "no-store",
        });
        if (cancelled) return;
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          instances?: Instance[];
          warning?: string;
          message?: string;
        };
        if (cancelled) return;
        if (!resp.ok || data.ok === false) {
          setError(data?.message ?? `HTTP ${resp.status}`);
          return;
        }
        setError(null);
        setWarning(data.warning ?? null);
        setInstances(data.instances ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOnce();
    const id = window.setInterval(fetchOnce, FETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollTick]);

  const doAction = useCallback(
    async (instance: Instance, action: keyof typeof ACTION_LABEL) => {
      if (instance.runtime_kind !== "docker") return;
      if (busy[instance.id]) return;
      const confirmed =
        action !== "destroy" ||
        window.confirm(
          `Destroy container ${instance.container_name ?? instance.id}? It will be removed and you'll need to redeploy to bring it back.`,
        );
      if (!confirmed) return;
      setBusy((prev) => ({ ...prev, [instance.id]: action }));
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) return;
        const resp = await fetch(
          `/api/runtime/instances/${instance.id}/${action}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          },
        );
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
        };
        if (!resp.ok || data.ok === false) {
          window.alert(data?.message ?? `HTTP ${resp.status}`);
          return;
        }
        // Optimistic refresh; full state lands within a poll tick.
        triggerRefetch();
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[instance.id];
          return next;
        });
      }
    },
    [busy, triggerRefetch],
  );

  const stats = useMemo(() => {
    let docker = 0;
    let staticC = 0;
    let healthy = 0;
    for (const inst of instances) {
      if (inst.runtime_kind === "docker") docker += 1;
      else if (inst.runtime_kind === "static") staticC += 1;
      if (inst.last_health_status === "healthy") healthy += 1;
    }
    return { total: instances.length, docker, static: staticC, healthy };
  }, [instances]);

  return (
    <section className="mb-8 rounded-3xl border border-emerald-400/15 bg-white/[0.025] p-6 shadow-[0_24px_64px_-32px_rgba(16,185,129,0.4)] backdrop-blur-xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-emerald-300/80">
            Live runtime
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Real runtime instances
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-white/60">
            Sourced from <code className="rounded bg-white/10 px-1.5 py-0.5">runtime_instances</code>. Container state is reported by the deployment worker via the runtime_instance upsert endpoint.
          </p>
        </div>
        <div className="flex gap-2 text-[11px] uppercase tracking-[0.18em] text-white/55">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            {stats.total} total
          </span>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-200">
            {stats.docker} docker
          </span>
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-sky-200">
            {stats.static} static
          </span>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
          {error}
        </div>
      ) : null}
      {warning ? (
        <div className="mb-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-100">
          {warning}
        </div>
      ) : null}

      {loading && instances.length === 0 ? (
        <p className="text-xs text-white/55">Loading runtime instances…</p>
      ) : !loading && instances.length === 0 && !error ? (
        <p className="text-xs text-white/55">
          No runtime instances yet. They will appear here automatically once you deploy a project.
        </p>
      ) : (
        <ul className="grid gap-3">
          {instances.map((inst) => {
            const isDocker = inst.runtime_kind === "docker";
            const isStatic = inst.runtime_kind === "static";
            const stateBadge =
              inst.target_state === "running"
                ? "bg-emerald-400/15 text-emerald-200 border-emerald-400/30"
                : inst.target_state === "stopped"
                  ? "bg-amber-400/15 text-amber-200 border-amber-400/30"
                  : "bg-white/5 text-white/65 border-white/10";
            const healthBadge =
              inst.last_health_status === "healthy"
                ? "text-emerald-200"
                : inst.last_health_status === "starting"
                  ? "text-amber-200"
                  : "text-rose-200";
            const busyAction = busy[inst.id];
            return (
              <li
                key={inst.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-white/85">
                      {inst.container_name ?? inst.id}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/55">
                      {isDocker
                        ? "Runtime deployment (docker)"
                        : isStatic
                          ? "Static deployment"
                          : `Unsupported runtime (${inst.runtime_kind ?? "unknown"})`}
                      {inst.framework ? ` • ${inst.framework}` : ""}
                      {isDocker && inst.internal_port
                        ? ` • 127.0.0.1:${inst.internal_port}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em]">
                    <span
                      className={`rounded-full border px-2.5 py-1 ${stateBadge}`}
                    >
                      target: {inst.target_state ?? "?"}
                    </span>
                    {inst.last_health_status ? (
                      <span
                        className={`rounded-full border border-white/10 bg-white/5 px-2.5 py-1 ${healthBadge}`}
                      >
                        {inst.last_health_status}
                      </span>
                    ) : null}
                  </div>
                </div>

                {isDocker ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["start", "stop", "restart", "destroy"] as const).map(
                      (action) => {
                        const disabled =
                          Boolean(busyAction) ||
                          (action === "start" &&
                            inst.target_state === "running") ||
                          (action === "stop" &&
                            inst.target_state === "stopped") ||
                          inst.target_state === "destroyed";
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={disabled}
                            onClick={() => void doAction(inst, action)}
                            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                              action === "destroy"
                                ? "border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                                : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            {busyAction === action
                              ? `${ACTION_LABEL[action]}…`
                              : ACTION_LABEL[action]}
                          </button>
                        );
                      },
                    )}
                  </div>
                ) : isStatic ? (
                  <p className="mt-2 text-[11px] text-white/55">
                    Static deployments are managed by the reverse proxy. To
                    change them, redeploy the project.
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-amber-200/80">
                    Unsupported hosting kind. Set <code>projects.runtime_kind</code> to <code>static</code> or <code>docker</code>.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
