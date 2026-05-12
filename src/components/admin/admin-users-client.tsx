"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  AdminRlsWarning,
  AdminShell,
  type AdminContext,
  type AnyRole,
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

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  role: AnyRole | null;
  created_at: string | null;
};

type PendingInvite = {
  id: string;
  email: string;
  role: PlatformRole;
  invited_by: string;
  invited_at: string;
};

type StoredInvites = {
  inviterId: string;
  invites: PendingInvite[];
};

const INVITE_STORAGE_KEY = "gtlnav.admin.invites.v1";
const MAX_INVITES = 50;

/* -------------------------------------------------------------------------- */
/*  Roles                                                                     */
/* -------------------------------------------------------------------------- */

type PlatformRole = "client" | "support_agent" | "operator" | "admin" | "super_admin";

const ROLES: {
  value: PlatformRole;
  label: string;
  hint: string;
  tone: "default" | "good" | "warn" | "bad" | "info";
}[] = [
  { value: "client", label: "client", hint: "Standard tenant.", tone: "default" },
  { value: "support_agent", label: "support_agent", hint: "Read-only support desk.", tone: "info" },
  { value: "operator", label: "operator", hint: "Platform engineer; ops actions.", tone: "good" },
  { value: "admin", label: "admin", hint: "Full operator console access.", tone: "warn" },
  { value: "super_admin", label: "super_admin", hint: "Root authority.", tone: "bad" },
];

type RoleFilter = "all" | PlatformRole;

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "client", label: "Clients" },
  { value: "support_agent", label: "Support agents" },
  { value: "operator", label: "Operators" },
  { value: "admin", label: "Admins" },
  { value: "super_admin", label: "Super admins" },
];

function normalizeRole(role: AnyRole | null | undefined): PlatformRole {
  const r = (role ?? "").toString().toLowerCase();
  if (r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  if (r === "operator") return "operator";
  if (r === "support_agent") return "support_agent";
  return "client";
}

function roleTone(role: PlatformRole): "default" | "good" | "warn" | "bad" | "info" {
  return ROLES.find((r) => r.value === role)?.tone ?? "default";
}

/* -------------------------------------------------------------------------- */
/*  Local invite store                                                        */
/* -------------------------------------------------------------------------- */

function readInvites(inviterId: string): PendingInvite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INVITE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredInvites;
    if (parsed.inviterId !== inviterId) return [];
    return Array.isArray(parsed.invites) ? parsed.invites : [];
  } catch {
    return [];
  }
}

function writeInvites(inviterId: string, invites: PendingInvite[]) {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredInvites = {
      inviterId,
      invites: invites.slice(0, MAX_INVITES),
    };
    window.localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function generateInviteId() {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function AdminUsersClient() {
  return (
    <AdminShell
      activeKey="users"
      eyebrow="// admin / users"
      title="User & role management"
      description="Promote operators, invite staff, or revoke access. All role changes are written to the audit log."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<{
    target: ProfileRow;
    next: PlatformRole;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  /* ---------------------- load ------------------------------------ */
  const refresh = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    const res = await supabase
      .from("profiles")
      .select("id, email, full_name, company, role, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (res.error) setError(res.error.message);
    else setError(null);

    setProfiles((res.data ?? []) as ProfileRow[]);

    if (mode === "initial") setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  useEffect(() => {
    setInvites(readInvites(ctx.session.user.id));
  }, [ctx.session.user.id]);

  useEffect(() => {
    writeInvites(ctx.session.user.id, invites);
  }, [ctx.session.user.id, invites]);

  /* ---------------------- derived --------------------------------- */
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (filter !== "all" && normalizeRole(p.role) !== filter) {
        return false;
      }
      if (!s) return true;
      return (
        (p.email ?? "").toLowerCase().includes(s) ||
        (p.full_name ?? "").toLowerCase().includes(s) ||
        (p.company ?? "").toLowerCase().includes(s) ||
        p.id.toLowerCase().includes(s)
      );
    });
  }, [profiles, filter, search]);

  const counts = useMemo(() => {
    const c = {
      all: profiles.length,
      client: 0,
      support_agent: 0,
      operator: 0,
      admin: 0,
      super_admin: 0,
    };
    for (const p of profiles) {
      c[normalizeRole(p.role)] += 1;
    }
    return c;
  }, [profiles]);

  /* ---------------------- permissions ----------------------------- */
  /**
   * Decide whether the calling operator may set `target` → `next`.
   *
   *  - Super admins: anything except changing themselves.
   *  - Admins:
   *      * may NOT touch a super_admin (read-only).
   *      * may NOT promote anyone to admin or super_admin.
   *      * may NOT demote another admin (admins are equals; super_admin only).
   *      * may toggle client ⇄ support_agent ⇄ operator freely.
   */
  function canChangeRole(target: ProfileRow, next: PlatformRole): boolean {
    if (target.id === ctx.session.user.id) return false;
    const current = normalizeRole(target.role);

    if (ctx.isSuperAdmin) return true;

    if (current === "super_admin") return false;
    if (next === "super_admin") return false;
    if (current === "admin") return false; // demote-by-admin blocked
    if (next === "admin") return false; // promote-to-admin blocked

    return true;
  }

  function requestChange(target: ProfileRow, next: PlatformRole) {
    setConfirmError(null);
    setConfirm({ target, next });
  }

  async function performRoleChange() {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);

    setBusyIds((prev) => ({ ...prev, [confirm.target.id]: true }));
    try {
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ role: confirm.next })
        .eq("id", confirm.target.id);

      if (updErr) {
        setConfirmError(updErr.message);
        return;
      }

      await logAdminEvent(
        ctx.session.user.id,
        "admin_role_change",
        `Role changed for ${confirm.target.email ?? confirm.target.id} → ${confirm.next}`,
        "warning",
        {
          target_user_id: confirm.target.id,
          previous_role: confirm.target.role,
          next_role: confirm.next,
        },
      );

      setProfiles((prev) =>
        prev.map((p) =>
          p.id === confirm.target.id ? { ...p, role: confirm.next } : p,
        ),
      );
      setConfirm(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setConfirmBusy(false);
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[confirm.target.id];
        return next;
      });
    }
  }

  /* ---------------------- invite ---------------------------------- */
  async function handleInvite(input: { email: string; role: PlatformRole }) {
    if (!ctx.isSuperAdmin && (input.role === "admin" || input.role === "super_admin")) {
      throw new Error("Only super admins can invite admins or super admins.");
    }
    const invite: PendingInvite = {
      id: generateInviteId(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      invited_by: ctx.session.user.id,
      invited_at: new Date().toISOString(),
    };
    setInvites((prev) => [invite, ...prev]);
    await logAdminEvent(
      ctx.session.user.id,
      "admin_invite_send",
      `Operator invite sent to ${invite.email} (role: ${invite.role})`,
      "info",
      {
        invite_id: invite.id,
        invitee_email: invite.email,
        invite_role: invite.role,
      },
    );
  }

  async function handleRevokeInvite(invite: PendingInvite) {
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    await logAdminEvent(
      ctx.session.user.id,
      "admin_invite_revoke",
      `Operator invite revoked for ${invite.email}`,
      "warning",
      {
        invite_id: invite.id,
        invitee_email: invite.email,
        invite_role: invite.role,
      },
    );
  }

  /* ---------------------- render ---------------------------------- */
  return (
    <div className="space-y-6">
      <AdminRlsWarning visible={Boolean(error)} message={error ?? undefined} />

      {/* Invite operator card */}
      <CardShell
        eyebrow="// invites"
        title="Invite platform staff"
        description="Send a placeholder invite for a new operator, support agent, or client. Real email delivery lands in Phase 6 — invites are persisted locally and audited."
        right={
          <AdminButton tone="primary" onClick={() => setInviteOpen(true)}>
            ＋ New invite
          </AdminButton>
        }
      >
        {invites.length === 0 ? (
          <EmptyState
            title="No pending invites"
            description="Click New invite to draft one. Invites are written to the audit log and listed below until accepted or revoked."
          />
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
            {invites.map((inv) => {
              const tone = roleTone(inv.role);
              return (
                <li
                  key={inv.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {inv.email}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/45">
                      Invited {relativeTime(inv.invited_at)} ·{" "}
                      <span className="font-mono text-[10px] text-white/30">
                        {inv.id}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill label={inv.role} tone={tone} />
                    <AdminButton
                      tone="danger"
                      onClick={() => void handleRevokeInvite(inv)}
                    >
                      Revoke
                    </AdminButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardShell>

      {/* Profiles directory */}
      <CardShell
        eyebrow="// users"
        title={`Profiles (${profiles.length})`}
        description="All registered GTLNAV accounts. Search, filter and adjust roles."
        right={
          <AdminButton onClick={() => void refresh("refresh")} busy={refreshing}>
            Refresh
          </AdminButton>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {ROLE_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                label={f.label}
                active={filter === f.value}
                onClick={() => setFilter(f.value)}
                count={
                  f.value === "all"
                    ? counts.all
                    : counts[f.value as PlatformRole]
                }
              />
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, name, company…"
            className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-red-400/40 focus:outline-none md:w-72"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {loading ? (
            <div className="p-8 text-center text-xs uppercase tracking-[0.24em] text-white/45">
              Loading profiles…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No matching profiles"
              description="Try clearing the search or selecting a different role filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">User</th>
                    <th className="px-4 py-3 text-left font-medium">Company</th>
                    <th className="px-4 py-3 text-left font-medium">Role</th>
                    <th className="px-4 py-3 text-left font-medium">Joined</th>
                    <th className="px-4 py-3 text-right font-medium">Change role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((p) => {
                    const role = normalizeRole(p.role);
                    const isSelf = p.id === ctx.session.user.id;
                    return (
                      <tr key={p.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">
                            {p.full_name ?? "—"}
                            {isSelf ? (
                              <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-basil-200">
                                you
                              </span>
                            ) : null}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {p.email ?? "—"}
                          </p>
                          <p className="font-mono text-[10px] text-white/30">
                            {p.id}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-white/70">
                          {p.company ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill label={role} tone={roleTone(role)} />
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          <span title={absoluteTime(p.created_at)}>
                            {relativeTime(p.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {ROLES.map((opt) => {
                              const allowed =
                                !isSelf && canChangeRole(p, opt.value);
                              const isCurrent = role === opt.value;
                              return (
                                <AdminButton
                                  key={opt.value}
                                  onClick={() => requestChange(p, opt.value)}
                                  disabled={
                                    isCurrent || !allowed || busyIds[p.id]
                                  }
                                  tone={
                                    isCurrent
                                      ? "ghost"
                                      : opt.value === "super_admin" ||
                                          opt.value === "admin"
                                        ? "danger"
                                        : "default"
                                  }
                                  title={
                                    isSelf
                                      ? "You cannot change your own role here."
                                      : !allowed
                                        ? opt.value === "super_admin" || role === "super_admin"
                                          ? "Only super admins can grant or revoke super_admin."
                                          : "You don't have permission to make this change."
                                        : `Set role to ${opt.label}`
                                  }
                                >
                                  {isCurrent ? `· ${opt.label}` : `→ ${opt.label}`}
                                </AdminButton>
                              );
                            })}
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
          Visibility honors Supabase RLS. To enumerate every profile platform-wide,
          add admin-aware policies (or an authorized RPC) on{" "}
          <span className="text-white/70">public.profiles</span>.
        </p>
      </CardShell>

      <ConfirmModal
        open={Boolean(confirm)}
        title={
          confirm
            ? `Change role for ${confirm.target.email ?? confirm.target.id}?`
            : "Change role"
        }
        description={
          confirm
            ? `This sets the user's role to "${confirm.next}". Role changes take effect immediately and are logged to the audit stream.`
            : undefined
        }
        confirmLabel="Confirm change"
        cancelLabel="Cancel"
        destructive={
          confirm?.next === "super_admin" || confirm?.next === "admin"
        }
        busy={confirmBusy}
        error={confirmError}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => void performRoleChange()}
      />

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={async (input) => {
          await handleInvite(input);
          setInviteOpen(false);
        }}
        canInviteAdmin={ctx.isSuperAdmin}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Invite modal                                                              */
/* -------------------------------------------------------------------------- */

function InviteModal({
  open,
  onClose,
  onSubmit,
  canInviteAdmin,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { email: string; role: PlatformRole }) => Promise<void>;
  canInviteAdmin: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("operator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole("operator");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ email: trimmed, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-6 backdrop-blur-2xl"
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
          // operator-invite
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
          Invite platform staff
        </h2>
        <p className="mt-1 text-xs text-white/55">
          Sends a placeholder invite. Real email delivery lands later — for now
          the invite is recorded in the audit log and tracked locally.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              autoFocus
              maxLength={254}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-400/40"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
              Role
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformRole)}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-red-400/40"
            >
              {ROLES.map((r) => {
                const adminOnly = r.value === "admin" || r.value === "super_admin";
                const disabled = adminOnly && !canInviteAdmin;
                return (
                  <option
                    key={r.value}
                    value={r.value}
                    disabled={disabled}
                    className="bg-black"
                  >
                    {r.label}
                    {disabled ? " (super admin only)" : ""} — {r.hint}
                  </option>
                );
              })}
            </select>
            {!canInviteAdmin ? (
              <p className="mt-1 text-[11px] text-white/40">
                Only super admins can invite an admin or super_admin.
              </p>
            ) : null}
          </label>
          {error ? (
            <p role="alert" className="text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-300 via-red-400 to-red-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(248,113,113,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(248,113,113,1)] disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
