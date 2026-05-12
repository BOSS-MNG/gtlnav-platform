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
import { dnsProviderLabel } from "@/src/lib/dns-providers";

type DomainRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  domain: string | null;
  status: string | null;
  ssl_status: string | null;
  dns_target: string | null;
  dns_provider: string | null;
  created_at: string | null;
  updated_at: string | null;
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

type StatusFilter = "all" | "verified" | "pending" | "failed";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

type SslFilter = "all" | "issued" | "pending" | "failed";

const SSL_FILTERS: { value: SslFilter; label: string }[] = [
  { value: "all", label: "Any SSL" },
  { value: "issued", label: "SSL issued" },
  { value: "pending", label: "SSL pending" },
  { value: "failed", label: "SSL failed" },
];

function statusBucket(status: string | null | undefined): StatusFilter {
  const s = (status ?? "pending").toLowerCase();
  if (s.includes("verified") || s.includes("active") || s.includes("ready"))
    return "verified";
  if (s.includes("err") || s.includes("fail")) return "failed";
  return "pending";
}

function sslBucket(ssl: string | null | undefined): SslFilter {
  const s = (ssl ?? "pending").toLowerCase();
  if (s.includes("issued") || s.includes("active") || s.includes("ready"))
    return "issued";
  if (s.includes("err") || s.includes("fail")) return "failed";
  return "pending";
}

function statusTone(status: string | null | undefined) {
  const b = statusBucket(status);
  if (b === "verified") return "good";
  if (b === "failed") return "bad";
  return "warn";
}

function sslTone(ssl: string | null | undefined) {
  const b = sslBucket(ssl);
  if (b === "issued") return "good";
  if (b === "failed") return "bad";
  return "warn";
}

type ActionKind = "verify" | "fail" | "issue_ssl";

const ACTION_LABEL: Record<ActionKind, string> = {
  verify: "Mark verified",
  fail: "Mark failed",
  issue_ssl: "Issue SSL",
};

const ACTION_DESC: Record<ActionKind, string> = {
  verify:
    "Force-set this domain to verified state. The owner's project will see DNS as resolved.",
  fail: "Mark this domain as failed. The owner will be prompted to re-check DNS.",
  issue_ssl:
    "Simulate SSL certificate issuance for this domain. SSL status becomes issued.",
};

export function AdminDomainsClient() {
  return (
    <AdminShell
      activeKey="domains"
      eyebrow="// admin / domains"
      title="Domains operations"
      description="Verify, fail or issue SSL for any tenant's custom domain. Every change is logged."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectMini>>({});
  const [owners, setOwners] = useState<Record<string, OwnerMini>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sslFilter, setSslFilter] = useState<SslFilter>("all");
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<{
    domain: DomainRow;
    action: ActionKind;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const errs: string[] = [];

    const domainsRes = await supabase
      .from("domains")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (domainsRes.error) errs.push(`domains: ${domainsRes.error.message}`);

    const data = (domainsRes.data ?? []) as DomainRow[];
    setDomains(data);

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
      const ownersRes = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      if (ownersRes.error) errs.push(`profiles: ${ownersRes.error.message}`);
      else {
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: domains.length,
      verified: 0,
      pending: 0,
      failed: 0,
    };
    for (const d of domains) c[statusBucket(d.status)] += 1;
    return c;
  }, [domains]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return domains.filter((d) => {
      if (statusFilter !== "all" && statusBucket(d.status) !== statusFilter)
        return false;
      if (sslFilter !== "all" && sslBucket(d.ssl_status) !== sslFilter)
        return false;
      if (!s) return true;
      const project = d.project_id ? projects[d.project_id] : undefined;
      const owner = d.user_id ? owners[d.user_id] : undefined;
      return (
        (d.domain ?? "").toLowerCase().includes(s) ||
        (d.dns_target ?? "").toLowerCase().includes(s) ||
        (project?.name ?? "").toLowerCase().includes(s) ||
        (owner?.email ?? "").toLowerCase().includes(s) ||
        d.id.toLowerCase().includes(s)
      );
    });
  }, [domains, projects, owners, statusFilter, sslFilter, search]);

  function requestAction(domain: DomainRow, action: ActionKind) {
    setConfirmError(null);
    setConfirm({ domain, action });
  }

  async function performAction() {
    if (!confirm) return;
    const { domain, action } = confirm;
    setConfirmBusy(true);
    setConfirmError(null);
    setBusyIds((prev) => ({ ...prev, [domain.id]: true }));

    try {
      let nextStatus = domain.status;
      let nextSsl = domain.ssl_status;
      if (action === "verify") nextStatus = "verified";
      if (action === "fail") nextStatus = "failed";
      if (action === "issue_ssl") nextSsl = "issued";

      const update: Record<string, unknown> = {};
      if (action === "verify" || action === "fail") update.status = nextStatus;
      if (action === "issue_ssl") update.ssl_status = nextSsl;
      update.updated_at = new Date().toISOString();

      const updateRes = await supabase
        .from("domains")
        .update(update)
        .eq("id", domain.id);

      if (updateRes.error) {
        const m = updateRes.error.message.toLowerCase();
        if (m.includes("updated_at")) {
          const fallback: Record<string, unknown> = {};
          if (action === "verify" || action === "fail")
            fallback.status = nextStatus;
          if (action === "issue_ssl") fallback.ssl_status = nextSsl;
          const fb = await supabase
            .from("domains")
            .update(fallback)
            .eq("id", domain.id);
          if (fb.error) {
            setConfirmError(fb.error.message);
            return;
          }
        } else {
          setConfirmError(updateRes.error.message);
          return;
        }
      }

      await logAdminEvent(
        ctx.session.user.id,
        `admin_domain_${action}`,
        `${ACTION_LABEL[action]} · ${domain.domain ?? domain.id}`,
        action === "fail" ? "warning" : "success",
        {
          target_user_id: domain.user_id,
          project_id: domain.project_id,
          domain: domain.domain,
          previous_status: domain.status,
          previous_ssl_status: domain.ssl_status,
          next_status: nextStatus,
          next_ssl_status: nextSsl,
        },
      );

      setDomains((prev) =>
        prev.map((row) =>
          row.id === domain.id
            ? {
                ...row,
                status: nextStatus ?? row.status,
                ssl_status: nextSsl ?? row.ssl_status,
                updated_at: new Date().toISOString(),
              }
            : row,
        ),
      );
      setConfirm(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setConfirmBusy(false);
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[domain.id];
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
        eyebrow="// domains"
        title={`All domains (${domains.length})`}
        description="Force-verify, fail or issue SSL for any custom domain on the platform."
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
                active={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
                count={counts[f.value]}
              />
            ))}
            <span className="mx-1 hidden h-5 w-px bg-white/10 md:inline-block" />
            {SSL_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                label={f.label}
                active={sslFilter === f.value}
                onClick={() => setSslFilter(f.value)}
              />
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domain, project, owner…"
            className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-red-400/40 focus:outline-none md:w-72"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {loading ? (
            <div className="p-8 text-center text-xs uppercase tracking-[0.24em] text-white/45">
              Loading domains…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No domains match the current filters"
              description="Try a different status, SSL filter, or clear the search."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Domain</th>
                    <th className="px-4 py-3 text-left font-medium">Owner / Project</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">SSL</th>
                    <th className="px-4 py-3 text-left font-medium">DNS</th>
                    <th className="px-4 py-3 text-left font-medium">Created</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((d) => {
                    const project = d.project_id ? projects[d.project_id] : undefined;
                    const owner = d.user_id ? owners[d.user_id] : undefined;
                    return (
                      <tr key={d.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">
                            {d.domain ?? "—"}
                          </p>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                            {dnsProviderLabel(d.dns_provider)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/85">
                            {owner?.email ?? d.user_id ?? "—"}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {project?.name ?? "no project"}
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
                            label={d.status ?? "pending"}
                            tone={statusTone(d.status)}
                            pulse={statusBucket(d.status) === "pending"}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={d.ssl_status ?? "pending"}
                            tone={sslTone(d.ssl_status)}
                            pulse={sslBucket(d.ssl_status) === "pending"}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-white/65">
                          {d.dns_target ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          <span title={absoluteTime(d.created_at)}>
                            {relativeTime(d.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <AdminButton
                              onClick={() => requestAction(d, "verify")}
                              disabled={
                                statusBucket(d.status) === "verified" ||
                                busyIds[d.id]
                              }
                            >
                              Verify
                            </AdminButton>
                            <AdminButton
                              onClick={() => requestAction(d, "fail")}
                              tone="danger"
                              disabled={
                                statusBucket(d.status) === "failed" ||
                                busyIds[d.id]
                              }
                            >
                              Fail
                            </AdminButton>
                            <AdminButton
                              onClick={() => requestAction(d, "issue_ssl")}
                              disabled={
                                sslBucket(d.ssl_status) === "issued" ||
                                busyIds[d.id]
                              }
                            >
                              Issue SSL
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
          Domain operations log to{" "}
          <span className="text-white/70">infrastructure_logs</span> as
          admin_domain_* events.
        </p>
      </CardShell>

      <ConfirmModal
        open={Boolean(confirm)}
        title={
          confirm
            ? `${ACTION_LABEL[confirm.action]} · ${confirm.domain.domain ?? confirm.domain.id}?`
            : "Confirm"
        }
        description={confirm ? ACTION_DESC[confirm.action] : undefined}
        confirmLabel={confirm ? ACTION_LABEL[confirm.action] : "Confirm"}
        destructive={confirm?.action === "fail"}
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
