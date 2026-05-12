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
import { providerLabel } from "@/src/lib/project-providers";

type ProjectRow = {
  id: string;
  user_id: string | null;
  name: string | null;
  slug: string | null;
  status: string | null;
  provider: string | null;
  framework: string | null;
  live_url: string | null;
  repo_url: string | null;
  created_at: string | null;
};

type OwnerProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type StatusFilter =
  | "all"
  | "active"
  | "deploying"
  | "paused"
  | "archived"
  | "error"
  | "other";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "deploying", label: "Deploying" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
  { value: "error", label: "Error" },
  { value: "other", label: "Other" },
];

type ActionKind = "suspend" | "reactivate" | "archive";

const ACTION_LABEL: Record<ActionKind, string> = {
  suspend: "Suspend project",
  reactivate: "Reactivate project",
  archive: "Archive project",
};

const ACTION_DESCRIPTION: Record<ActionKind, string> = {
  suspend:
    "Suspended projects appear paused for the owner. Builds and traffic stop until reactivated.",
  reactivate:
    "Restores the project to active state. The owner can deploy and serve traffic again.",
  archive:
    "Archives the project tenant-wide. Owners must contact operators to restore.",
};

const ACTION_NEXT_STATUS: Record<ActionKind, string> = {
  suspend: "paused",
  reactivate: "active",
  archive: "archived",
};

function bucketStatus(status: string | null | undefined): StatusFilter {
  const s = (status ?? "").toLowerCase();
  if (!s) return "other";
  if (s === "active" || s === "running" || s === "ready") return "active";
  if (
    s === "deploying" ||
    s === "building" ||
    s === "cloning" ||
    s === "installing" ||
    s === "optimizing" ||
    s.includes("rollout")
  )
    return "deploying";
  if (s === "paused" || s === "idle" || s === "stopped" || s === "suspended")
    return "paused";
  if (s === "archived") return "archived";
  if (s.includes("err") || s.includes("fail") || s.includes("crash"))
    return "error";
  return "other";
}

function statusTone(status: string | null | undefined) {
  const b = bucketStatus(status);
  if (b === "active") return "good";
  if (b === "deploying") return "info";
  if (b === "error") return "bad";
  if (b === "paused" || b === "archived") return "default";
  return "warn";
}

export function AdminProjectsClient() {
  return (
    <AdminShell
      activeKey="projects"
      eyebrow="// admin / projects"
      title="Project lifecycle control"
      description="Suspend, reactivate or archive any project on the platform. Every action is logged."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [owners, setOwners] = useState<Record<string, OwnerProfile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<{
    project: ProjectRow;
    action: ActionKind;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const errs: string[] = [];

    const projRes = await supabase
      .from("projects")
      .select(
        "id, user_id, name, slug, status, provider, framework, live_url, repo_url, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (projRes.error) errs.push(`projects: ${projRes.error.message}`);

    const data = (projRes.data ?? []) as ProjectRow[];
    setProjects(data);

    const ownerIds = Array.from(
      new Set(data.map((p) => p.user_id).filter(Boolean) as string[]),
    );

    if (ownerIds.length > 0) {
      const ownersRes = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      if (ownersRes.error) {
        errs.push(`profiles: ${ownersRes.error.message}`);
      } else {
        const map: Record<string, OwnerProfile> = {};
        for (const o of (ownersRes.data ?? []) as OwnerProfile[]) {
          map[o.id] = o;
        }
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
      all: projects.length,
      active: 0,
      deploying: 0,
      paused: 0,
      archived: 0,
      error: 0,
      other: 0,
    };
    for (const p of projects) {
      const b = bucketStatus(p.status);
      c[b] += 1;
    }
    return c;
  }, [projects]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter !== "all" && bucketStatus(p.status) !== filter) return false;
      if (!s) return true;
      const owner = p.user_id ? owners[p.user_id] : undefined;
      return (
        (p.name ?? "").toLowerCase().includes(s) ||
        (p.slug ?? "").toLowerCase().includes(s) ||
        p.id.toLowerCase().includes(s) ||
        (owner?.email ?? "").toLowerCase().includes(s) ||
        (owner?.full_name ?? "").toLowerCase().includes(s)
      );
    });
  }, [projects, owners, filter, search]);

  function requestAction(project: ProjectRow, action: ActionKind) {
    setConfirmError(null);
    setConfirm({ project, action });
  }

  async function performAction() {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    setBusyIds((prev) => ({ ...prev, [confirm.project.id]: true }));
    try {
      const nextStatus = ACTION_NEXT_STATUS[confirm.action];
      const { error: updErr } = await supabase
        .from("projects")
        .update({ status: nextStatus })
        .eq("id", confirm.project.id);

      if (updErr) {
        setConfirmError(updErr.message);
        return;
      }

      await logAdminEvent(
        ctx.session.user.id,
        `admin_project_${confirm.action}`,
        `${ACTION_LABEL[confirm.action]} · ${confirm.project.name ?? confirm.project.id}`,
        confirm.action === "archive"
          ? "warning"
          : confirm.action === "suspend"
          ? "warning"
          : "success",
        {
          project_id: confirm.project.id,
          previous_status: confirm.project.status,
          next_status: nextStatus,
        },
      );

      setProjects((prev) =>
        prev.map((p) =>
          p.id === confirm.project.id ? { ...p, status: nextStatus } : p,
        ),
      );
      setConfirm(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setConfirmBusy(false);
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[confirm.project.id];
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      <AdminRlsWarning
        visible={errors.length > 0}
        message={
          errors.length > 0
            ? errors.slice(0, 3).join(" · ")
            : undefined
        }
      />

      <CardShell
        eyebrow="// projects"
        title={`All projects (${projects.length})`}
        description="Lifecycle actions affect the project owner immediately. Use with care."
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
            placeholder="Search project, slug, owner email…"
            className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-red-400/40 focus:outline-none md:w-72"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {loading ? (
            <div className="p-8 text-center text-xs uppercase tracking-[0.24em] text-white/45">
              Loading projects…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No projects match the current filters"
              description="Adjust the filter or clear the search to see all projects."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Project</th>
                    <th className="px-4 py-3 text-left font-medium">Owner</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Provider</th>
                    <th className="px-4 py-3 text-left font-medium">Created</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((p) => {
                    const owner = p.user_id ? owners[p.user_id] : undefined;
                    const bucket = bucketStatus(p.status);
                    return (
                      <tr key={p.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">
                            {p.name ?? "Untitled"}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {p.slug ? `/${p.slug}` : ""}
                            {p.framework ? ` · ${p.framework}` : ""}
                          </p>
                          <Link
                            href={`/dashboard/projects/${p.id}`}
                            className="mt-1 inline-flex text-[10px] uppercase tracking-[0.18em] text-basil-200 hover:text-basil-100"
                          >
                            Open project →
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/85">
                            {owner?.full_name ?? "—"}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {owner?.email ?? p.user_id ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={p.status ?? "unknown"}
                            tone={statusTone(p.status)}
                            pulse={bucket === "deploying"}
                          />
                        </td>
                        <td className="px-4 py-3 text-white/70">
                          {p.provider ? providerLabel(p.provider) : "—"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          <span title={absoluteTime(p.created_at)}>
                            {relativeTime(p.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <AdminButton
                              onClick={() => requestAction(p, "suspend")}
                              tone="default"
                              disabled={
                                bucket === "paused" || busyIds[p.id]
                              }
                            >
                              Suspend
                            </AdminButton>
                            <AdminButton
                              onClick={() => requestAction(p, "reactivate")}
                              tone="default"
                              disabled={
                                bucket === "active" || busyIds[p.id]
                              }
                            >
                              Reactivate
                            </AdminButton>
                            <AdminButton
                              onClick={() => requestAction(p, "archive")}
                              tone="danger"
                              disabled={
                                bucket === "archived" || busyIds[p.id]
                              }
                            >
                              Archive
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
          Lifecycle changes write to{" "}
          <span className="text-white/70">infrastructure_logs</span> as
          admin_project_* events.
        </p>
      </CardShell>

      <ConfirmModal
        open={Boolean(confirm)}
        title={
          confirm
            ? `${ACTION_LABEL[confirm.action]} · ${confirm.project.name ?? confirm.project.slug ?? confirm.project.id}?`
            : "Confirm"
        }
        description={confirm ? ACTION_DESCRIPTION[confirm.action] : undefined}
        confirmLabel={
          confirm ? ACTION_LABEL[confirm.action] : "Confirm"
        }
        destructive={confirm?.action !== "reactivate"}
        busy={confirmBusy}
        error={confirmError}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => void performAction()}
      />
    </div>
  );
}
