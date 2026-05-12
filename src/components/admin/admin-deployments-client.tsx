"use client";

import Link from "next/link";
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
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import { logAdminEvent } from "@/src/lib/admin-audit";
import { absoluteTime, relativeTime } from "@/src/lib/dashboard-format";
import {
  INFLIGHT_STATUSES,
  isInflightStatus,
} from "@/src/lib/deployment-simulator";

type DeploymentRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  status: string | null;
  branch: string | null;
  commit_sha: string | null;
  url: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type ProjectMini = {
  id: string;
  name: string | null;
  slug: string | null;
  user_id: string | null;
};

type OwnerMini = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type StatusFilter =
  | "all"
  | "inflight"
  | "active"
  | "failed"
  | "canceled"
  | "other";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "inflight", label: "Inflight" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
  { value: "other", label: "Other" },
];

function bucketStatus(status: string | null | undefined): StatusFilter {
  const s = (status ?? "").toLowerCase();
  if (!s) return "other";
  if (isInflightStatus(s)) return "inflight";
  if (s === "active" || s.includes("success") || s.includes("ready"))
    return "active";
  if (s.includes("fail") || s.includes("err") || s.includes("crash"))
    return "failed";
  if (s.includes("cancel")) return "canceled";
  return "other";
}

function statusTone(status: string | null | undefined) {
  const b = bucketStatus(status);
  if (b === "active") return "good";
  if (b === "inflight") return "info";
  if (b === "failed") return "bad";
  if (b === "canceled") return "default";
  return "warn";
}

export function AdminDeploymentsClient() {
  return (
    <AdminShell
      activeKey="deployments"
      eyebrow="// admin / deployments"
      title="Deployments control"
      description="Inspect and intervene on every deployment across every tenant."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectMini>>({});
  const [owners, setOwners] = useState<Record<string, OwnerMini>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<{ deployment: DeploymentRow } | null>(
    null,
  );
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const errs: string[] = [];

    const depRes = await supabase
      .from("deployments")
      .select(
        "id, user_id, project_id, status, branch, commit_sha, url, created_at, started_at, finished_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (depRes.error) errs.push(`deployments: ${depRes.error.message}`);

    const data = (depRes.data ?? []) as DeploymentRow[];
    setDeployments(data);

    const projIds = Array.from(
      new Set(data.map((d) => d.project_id).filter(Boolean) as string[]),
    );
    const ownerIds = Array.from(
      new Set(data.map((d) => d.user_id).filter(Boolean) as string[]),
    );

    if (projIds.length > 0) {
      const projRes = await supabase
        .from("projects")
        .select("id, name, slug, user_id")
        .in("id", projIds);
      if (projRes.error) errs.push(`projects: ${projRes.error.message}`);
      else {
        const map: Record<string, ProjectMini> = {};
        for (const p of (projRes.data ?? []) as ProjectMini[]) map[p.id] = p;
        setProjects(map);
      }
    } else {
      setProjects({});
    }

    if (ownerIds.length > 0) {
      const ownerRes = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      if (ownerRes.error) errs.push(`profiles: ${ownerRes.error.message}`);
      else {
        const map: Record<string, OwnerMini> = {};
        for (const o of (ownerRes.data ?? []) as OwnerMini[]) map[o.id] = o;
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: deployments.length,
      inflight: 0,
      active: 0,
      failed: 0,
      canceled: 0,
      other: 0,
    };
    for (const d of deployments) c[bucketStatus(d.status)] += 1;
    return c;
  }, [deployments]);

  const hasInflight = counts.inflight > 0;

  // Live refresh while there are inflight rollouts
  useEffect(() => {
    if (!hasInflight) return;
    const interval = window.setInterval(() => {
      void refresh("refresh");
    }, 6_000);
    return () => window.clearInterval(interval);
  }, [hasInflight, refresh]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return deployments.filter((d) => {
      if (filter !== "all" && bucketStatus(d.status) !== filter) return false;
      if (!s) return true;
      const project = d.project_id ? projects[d.project_id] : undefined;
      const owner = d.user_id ? owners[d.user_id] : undefined;
      return (
        d.id.toLowerCase().includes(s) ||
        (d.branch ?? "").toLowerCase().includes(s) ||
        (d.commit_sha ?? "").toLowerCase().includes(s) ||
        (project?.name ?? "").toLowerCase().includes(s) ||
        (project?.slug ?? "").toLowerCase().includes(s) ||
        (owner?.email ?? "").toLowerCase().includes(s)
      );
    });
  }, [deployments, projects, owners, filter, search]);

  function requestCancel(deployment: DeploymentRow) {
    setConfirmError(null);
    setConfirm({ deployment });
  }

  async function performCancel() {
    if (!confirm) return;
    const dep = confirm.deployment;
    setConfirmBusy(true);
    setConfirmError(null);
    setBusyIds((prev) => ({ ...prev, [dep.id]: true }));

    try {
      const finishedAt = new Date().toISOString();

      const update: Record<string, unknown> = {
        status: "canceled",
        finished_at: finishedAt,
      };

      const updateRes = await supabase
        .from("deployments")
        .update(update)
        .eq("id", dep.id);

      if (updateRes.error) {
        // Try fallback without finished_at
        const fallback = await supabase
          .from("deployments")
          .update({ status: "canceled" })
          .eq("id", dep.id);
        if (fallback.error) {
          setConfirmError(fallback.error.message);
          return;
        }
      }

      // Update related project: revert to active if it was inflight
      if (dep.project_id) {
        await supabase
          .from("projects")
          .update({ status: "active" })
          .eq("id", dep.project_id)
          .in("status", INFLIGHT_STATUSES as unknown as string[]);
      }

      await logAdminEvent(
        ctx.session.user.id,
        "admin_deployment_cancel",
        `Operator canceled deployment ${dep.id}`,
        "warning",
        {
          project_id: dep.project_id,
          deployment_id: dep.id,
          previous_status: dep.status,
          target_user_id: dep.user_id,
        },
      );

      setDeployments((prev) =>
        prev.map((row) =>
          row.id === dep.id
            ? { ...row, status: "canceled", finished_at: finishedAt }
            : row,
        ),
      );
      setConfirm(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setConfirmBusy(false);
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[dep.id];
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      <AdminRlsWarning
        visible={errors.length > 0}
        message={errors.length > 0 ? errors.slice(0, 3).join(" · ") : undefined}
      />

      <CardShell
        eyebrow="// deployments"
        title={`All deployments (${deployments.length})`}
        description="Live view of every rollout. Inflight rollouts auto-refresh."
        right={
          <AdminButton onClick={() => void refresh("refresh")} busy={refreshing}>
            Refresh
          </AdminButton>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                label={f.label}
                active={filter === f.value}
                onClick={() => setFilter(f.value)}
                count={counts[f.value]}
              />
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, branch, commit, owner…"
            className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-red-400/40 focus:outline-none md:w-72"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {loading ? (
            <div className="p-8 text-center text-xs uppercase tracking-[0.24em] text-white/45">
              Loading deployments…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No deployments match the filters"
              description="Try selecting another status or clearing the search."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Project / Owner</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Branch / Commit</th>
                    <th className="px-4 py-3 text-left font-medium">Started</th>
                    <th className="px-4 py-3 text-left font-medium">Finished</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((d) => {
                    const project = d.project_id ? projects[d.project_id] : undefined;
                    const owner = d.user_id ? owners[d.user_id] : undefined;
                    const inflight = isInflightStatus(d.status);
                    return (
                      <tr key={d.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">
                            {project?.name ?? "Project"}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {owner?.email ?? d.user_id ?? "—"}
                          </p>
                          {project ? (
                            <Link
                              href={`/dashboard/projects/${project.id}`}
                              className="mt-1 inline-flex text-[10px] uppercase tracking-[0.18em] text-basil-200 hover:text-basil-100"
                            >
                              Open project →
                            </Link>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={d.status ?? "queued"}
                            tone={statusTone(d.status)}
                            pulse={inflight}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-white/70">
                          <p>{d.branch ?? "main"}</p>
                          <p className="text-white/45">
                            {d.commit_sha ? d.commit_sha.slice(0, 8) : "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          <span title={absoluteTime(d.started_at ?? d.created_at)}>
                            {relativeTime(d.started_at ?? d.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          {d.finished_at ? (
                            <span title={absoluteTime(d.finished_at)}>
                              {relativeTime(d.finished_at)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <AdminButton
                              onClick={() => requestCancel(d)}
                              tone="danger"
                              disabled={!inflight || busyIds[d.id]}
                              title={
                                inflight
                                  ? "Cancel this inflight deployment"
                                  : "Only inflight deployments can be canceled"
                              }
                            >
                              Cancel
                            </AdminButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
          Cancellation logs to{" "}
          <span className="text-white/70">infrastructure_logs</span> as
          admin_deployment_cancel.
        </p>
      </CardShell>

      <ConfirmModal
        open={Boolean(confirm)}
        title={
          confirm
            ? `Cancel deployment ${confirm.deployment.id.slice(0, 8)}…?`
            : "Cancel deployment"
        }
        description="The owner's inflight rollout will be marked canceled. The associated project status will be reverted to active so they can deploy again."
        confirmLabel="Cancel deployment"
        destructive
        busy={confirmBusy}
        error={confirmError}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => void performCancel()}
      />
    </div>
  );
}
