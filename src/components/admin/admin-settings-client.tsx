"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AdminShell,
  type AdminContext,
} from "@/src/components/admin/admin-shell";
import {
  AdminButton,
  CardShell,
  StatusPill,
} from "@/src/components/admin/admin-ui";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";

const PREFS_KEY = "gtlnav.admin.settings.v1";

type AdminPrefs = {
  operator_display_name: string;
  operator_pager: string;
  default_ops_region: string;
  notifications: {
    failed_deployments: boolean;
    abuse_alerts: boolean;
    domain_verification_failures: boolean;
    billing_anomalies: boolean;
    security_events: boolean;
    weekly_digest: boolean;
  };
  security: {
    require_mfa: boolean;
    operator_session_minutes: number;
    audit_retention_days: number;
    impersonation_window_minutes: number;
  };
  branding: {
    platform_name: string;
    accent: "basil" | "red" | "cyan" | "violet";
    operator_motto: string;
  };
  maintenance: {
    enabled: boolean;
    banner: string;
    deploy_freeze: boolean;
    domain_freeze: boolean;
  };
};

const DEFAULT_PREFS: AdminPrefs = {
  operator_display_name: "Operator",
  operator_pager: "#ops-oncall",
  default_ops_region: "us-east-1",
  notifications: {
    failed_deployments: true,
    abuse_alerts: true,
    domain_verification_failures: true,
    billing_anomalies: true,
    security_events: true,
    weekly_digest: false,
  },
  security: {
    require_mfa: true,
    operator_session_minutes: 60,
    audit_retention_days: 365,
    impersonation_window_minutes: 15,
  },
  branding: {
    platform_name: "GTLNAV",
    accent: "basil",
    operator_motto: "// keep the lights on",
  },
  maintenance: {
    enabled: false,
    banner: "GTLNAV is undergoing scheduled maintenance.",
    deploy_freeze: false,
    domain_freeze: false,
  },
};

function readPrefs(): AdminPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AdminPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      notifications: { ...DEFAULT_PREFS.notifications, ...(parsed.notifications ?? {}) },
      security: { ...DEFAULT_PREFS.security, ...(parsed.security ?? {}) },
      branding: { ...DEFAULT_PREFS.branding, ...(parsed.branding ?? {}) },
      maintenance: { ...DEFAULT_PREFS.maintenance, ...(parsed.maintenance ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: AdminPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* no-op */
  }
}

export function AdminSettingsClient() {
  return (
    <AdminShell
      activeKey="settings"
      eyebrow="// admin / settings"
      title="Operator settings"
      description="Operator profile, platform preferences, security policy, and dangerous actions."
    >
      {(ctx) => <Body ctx={ctx} />}
    </AdminShell>
  );
}

function Body({ ctx }: { ctx: AdminContext }) {
  const [prefs, setPrefs] = useState<AdminPrefs>(DEFAULT_PREFS);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "freeze_deploys"; on: boolean }
    | { kind: "purge_audit" }
    | { kind: "rotate_ops" }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  function update<K extends keyof AdminPrefs>(k: K, v: AdminPrefs[K]) {
    setPrefs((p) => ({ ...p, [k]: v }));
    setSavedAt(null);
  }
  function setNotif<K extends keyof AdminPrefs["notifications"]>(k: K, v: boolean) {
    setPrefs((p) => ({ ...p, notifications: { ...p.notifications, [k]: v } }));
    setSavedAt(null);
  }
  function setSec<K extends keyof AdminPrefs["security"]>(k: K, v: AdminPrefs["security"][K]) {
    setPrefs((p) => ({ ...p, security: { ...p.security, [k]: v } }));
    setSavedAt(null);
  }
  function setBrand<K extends keyof AdminPrefs["branding"]>(k: K, v: AdminPrefs["branding"][K]) {
    setPrefs((p) => ({ ...p, branding: { ...p.branding, [k]: v } }));
    setSavedAt(null);
  }
  function setMaint<K extends keyof AdminPrefs["maintenance"]>(k: K, v: AdminPrefs["maintenance"][K]) {
    setPrefs((p) => ({ ...p, maintenance: { ...p.maintenance, [k]: v } }));
    setSavedAt(null);
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    writePrefs(prefs);
    setSavedAt(new Date().toISOString());
    flash("good", "Operator settings saved.");
  }

  function flash(tone: "good" | "bad", text: string) {
    setActionMsg({ tone, text });
    window.setTimeout(() => setActionMsg(null), 3500);
  }

  async function runConfirmed() {
    if (!confirm) return;
    setBusy(true);
    try {
      await new Promise((r) => window.setTimeout(r, 700));
      if (confirm.kind === "freeze_deploys") {
        setMaint("deploy_freeze", confirm.on);
        writePrefs({ ...prefs, maintenance: { ...prefs.maintenance, deploy_freeze: confirm.on } });
        flash("good", confirm.on ? "Deploy freeze engaged." : "Deploy freeze lifted.");
      } else if (confirm.kind === "purge_audit") {
        flash("good", "Audit retention rotation queued (sim).");
      } else if (confirm.kind === "rotate_ops") {
        flash("good", "Operator session rotation triggered (sim).");
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const operatorEmail = ctx.profile.email ?? ctx.session.user.email ?? "operator";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/55">
            Signed in as <span className="text-white/85">{ctx.profile.role?.toUpperCase() ?? "OPERATOR"} · {operatorEmail}</span>
          </p>
          {savedAt ? (
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-basil-300/80">
              Saved · {new Date(savedAt).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            ← Back to user console
          </Link>
          <AdminButton tone="primary" type="submit" size="md">
            Save settings
          </AdminButton>
        </div>
      </div>

      {actionMsg ? (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm ${
            actionMsg.tone === "good"
              ? "border-basil-400/30 bg-basil-500/10 text-basil-100"
              : "border-red-400/30 bg-red-500/10 text-red-200"
          }`}
        >
          {actionMsg.text}
        </div>
      ) : null}

      {/* Operator profile */}
      <CardShell
        eyebrow="// operator profile"
        title="Operator profile"
        description="How you appear in audit logs and operator routing."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Display name"
            value={prefs.operator_display_name}
            onChange={(v) => update("operator_display_name", v)}
            placeholder="On-call operator"
          />
          <Field
            label="Pager / on-call channel"
            value={prefs.operator_pager}
            onChange={(v) => update("operator_pager", v)}
            placeholder="#ops-oncall"
          />
          <Field
            label="Default ops region"
            value={prefs.default_ops_region}
            onChange={(v) => update("default_ops_region", v)}
            placeholder="us-east-1"
          />
          <ReadOnly label="Operator email" value={operatorEmail} />
        </div>
      </CardShell>

      {/* Notification preferences */}
      <CardShell
        eyebrow="// notifications"
        title="Admin notification preferences"
        description="Which platform-wide signals page you. Channels are configured in the security plane."
      >
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle
            label="Failed deployments"
            sub="Page on any failed deployment, any tenant."
            checked={prefs.notifications.failed_deployments}
            onChange={(v) => setNotif("failed_deployments", v)}
          />
          <Toggle
            label="Abuse / anomaly detection"
            sub="High-severity threat rule matches."
            checked={prefs.notifications.abuse_alerts}
            onChange={(v) => setNotif("abuse_alerts", v)}
          />
          <Toggle
            label="Domain verification failures"
            sub="DNS or SSL renewal failure."
            checked={prefs.notifications.domain_verification_failures}
            onChange={(v) => setNotif("domain_verification_failures", v)}
          />
          <Toggle
            label="Billing anomalies"
            sub="Failed charges, dunning escalations."
            checked={prefs.notifications.billing_anomalies}
            onChange={(v) => setNotif("billing_anomalies", v)}
          />
          <Toggle
            label="Security events"
            sub="Operator actions, suspicious activity."
            checked={prefs.notifications.security_events}
            onChange={(v) => setNotif("security_events", v)}
          />
          <Toggle
            label="Weekly platform digest"
            sub="Monday morning summary."
            checked={prefs.notifications.weekly_digest}
            onChange={(v) => setNotif("weekly_digest", v)}
          />
        </div>
      </CardShell>

      {/* Security */}
      <CardShell
        eyebrow="// security"
        title="Security preferences"
        description="Operator-only policy. Workspace policy is set per-workspace under Security."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Require MFA for all operators"
            sub="Forces second factor before /admin access."
            checked={prefs.security.require_mfa}
            onChange={(v) => setSec("require_mfa", v)}
          />
          <NumberRow
            label="Operator session (minutes)"
            value={prefs.security.operator_session_minutes}
            onChange={(v) => setSec("operator_session_minutes", v)}
            min={15}
            max={8 * 60}
          />
          <NumberRow
            label="Audit retention (days)"
            value={prefs.security.audit_retention_days}
            onChange={(v) => setSec("audit_retention_days", v)}
            min={30}
            max={365 * 7}
          />
          <NumberRow
            label="Impersonation window (minutes)"
            value={prefs.security.impersonation_window_minutes}
            onChange={(v) => setSec("impersonation_window_minutes", v)}
            min={5}
            max={120}
          />
          <PlaceholderRow
            label="Audit retention enforcement"
            value="Daily compactor"
            sub="Compactor runs at 03:00 UTC."
          />
          <PlaceholderRow
            label="Operator IP allowlist"
            value="Inherits workspace policy"
            sub="Define under Security · IP allowlist."
          />
        </div>
      </CardShell>

      {/* Maintenance mode */}
      <CardShell
        eyebrow="// maintenance"
        title="Maintenance mode"
        description="Simulated platform freeze. Banners + freeze flags propagate to dashboard + admin shells."
        right={
          <StatusPill
            label={prefs.maintenance.enabled ? "ON" : "OFF"}
            tone={prefs.maintenance.enabled ? "warn" : "default"}
            pulse={prefs.maintenance.enabled}
          />
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Maintenance banner"
            sub="Shows the message below across all consoles."
            checked={prefs.maintenance.enabled}
            onChange={(v) => setMaint("enabled", v)}
          />
          <Field
            label="Banner message"
            value={prefs.maintenance.banner}
            onChange={(v) => setMaint("banner", v)}
            placeholder="Scheduled maintenance window…"
          />
          <Toggle
            label="Deploy freeze"
            sub="Blocks all deployments platform-wide."
            checked={prefs.maintenance.deploy_freeze}
            onChange={(v) =>
              setConfirm({ kind: "freeze_deploys", on: v })
            }
          />
          <Toggle
            label="Domain operations freeze"
            sub="Pause SSL renew, DNS verifies."
            checked={prefs.maintenance.domain_freeze}
            onChange={(v) => setMaint("domain_freeze", v)}
          />
        </div>
      </CardShell>

      {/* Platform branding */}
      <CardShell
        eyebrow="// branding"
        title="Platform branding"
        description="Future hook for white-label deployments. Affects platform name and accent."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Platform name"
            value={prefs.branding.platform_name}
            onChange={(v) => setBrand("platform_name", v)}
            placeholder="GTLNAV"
          />
          <Field
            label="Operator motto"
            value={prefs.branding.operator_motto}
            onChange={(v) => setBrand("operator_motto", v)}
            placeholder="// keep the lights on"
          />
          <SelectRow
            label="Accent color"
            value={prefs.branding.accent}
            options={[
              { v: "basil", label: "Basil (default)" },
              { v: "red", label: "Operator red" },
              { v: "cyan", label: "Edge cyan" },
              { v: "violet", label: "Violet" },
            ]}
            onChange={(v) => setBrand("accent", v as AdminPrefs["branding"]["accent"])}
          />
          <PlaceholderRow
            label="Custom logo"
            value="Default GTLNAV mark"
            sub="Asset upload arrives with white-label."
          />
        </div>
      </CardShell>

      {/* Dangerous actions */}
      <CardShell
        eyebrow="// danger zone"
        title="Dangerous admin actions"
        description="Every action below is recorded in security_events with your operator id."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <DangerRow
            label="Rotate all operator sessions"
            sub="Logs out every active operator including you."
            onAction={() => setConfirm({ kind: "rotate_ops" })}
          />
          <DangerRow
            label="Force audit retention rotation"
            sub="Trims audit beyond retention window."
            onAction={() => setConfirm({ kind: "purge_audit" })}
          />
          <DangerRow
            label="Engage deploy freeze"
            sub="Blocks every deployment platform-wide."
            onAction={() => setConfirm({ kind: "freeze_deploys", on: true })}
          />
          <DangerRow
            label="Lift deploy freeze"
            sub="Resume normal deployments."
            onAction={() => setConfirm({ kind: "freeze_deploys", on: false })}
          />
        </div>
      </CardShell>

      <ConfirmModal
        open={confirm !== null}
        destructive
        busy={busy}
        title={
          confirm?.kind === "freeze_deploys"
            ? confirm.on
              ? "Engage deploy freeze?"
              : "Lift deploy freeze?"
            : confirm?.kind === "purge_audit"
              ? "Force audit retention rotation?"
              : confirm?.kind === "rotate_ops"
                ? "Rotate all operator sessions?"
                : "Confirm operator action"
        }
        description={
          confirm?.kind === "freeze_deploys"
            ? confirm.on
              ? "All deployments will be blocked platform-wide. Existing inflight builds will continue."
              : "Tenants will be able to deploy again immediately."
            : confirm?.kind === "purge_audit"
              ? "Audit rows older than the retention window will be removed. This is irreversible."
              : confirm?.kind === "rotate_ops"
                ? "Every operator session will be invalidated. You will be signed out."
                : ""
        }
        confirmLabel="Confirm"
        onClose={() => {
          if (busy) return;
          setConfirm(null);
        }}
        onConfirm={() => void runConfirmed()}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
//  Field primitives
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
      />
    </label>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      <span>{label}</span>
      <span className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/75">
        {value}
      </span>
    </div>
  );
}

function PlaceholderRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      <span>{label}</span>
      <span className="text-sm text-white/65">{value}</span>
      <span className="text-[10px] tracking-[0.15em] text-white/35">{sub}</span>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        min={min}
        max={max}
        className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[10px] uppercase tracking-[0.2em] text-white/40">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-basil-400/40 bg-basil-500/40" : "border-white/10 bg-white/[0.04]"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full transition-transform ${
            checked
              ? "translate-x-[18px] bg-basil-100 shadow-[0_0_6px_rgba(111,232,154,0.7)]"
              : "translate-x-[3px] bg-white/55"
          }`}
        />
      </button>
    </div>
  );
}

function DangerRow({
  label,
  sub,
  onAction,
}: {
  label: string;
  sub: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-500/[0.04] p-3">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        <p className="mt-0.5 text-[11px] text-white/55">{sub}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-100 transition-colors hover:bg-red-500/20"
      >
        Run
      </button>
    </div>
  );
}
