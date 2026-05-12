"use client";

import { useMemo } from "react";
import { AdminShell } from "@/src/components/admin/admin-shell";
import {
  BILLING_PLANS,
  SELLABLE_PLANS,
  formatMoney,
  generateInvoice,
  stripeReadiness,
  type Invoice,
  type Subscription,
} from "@/src/lib/billing";
import {
  BILLING_TIERS,
  generateWorkspaceRows,
  type BillingTierId,
  type WorkspaceUsageRow,
} from "@/src/lib/usage-meter";

type SimTenant = {
  id: string;
  name: string;
  planId: BillingTierId;
  mrrCents: number;
  seats: number;
  status: Subscription["status"];
  failedPayments: number;
};

const DEMO_TENANTS: SimTenant[] = [
  { id: "t1", name: "GODTECHLABS", planId: "enterprise", mrrCents: 749_00, seats: 42, status: "active", failedPayments: 0 },
  { id: "t2", name: "Basil Runtime", planId: "pro", mrrCents: 59_00 + 4 * 9_00, seats: 16, status: "active", failedPayments: 0 },
  { id: "t3", name: "Kepler Studios", planId: "business", mrrCents: 199_00, seats: 18, status: "trialing", failedPayments: 0 },
  { id: "t4", name: "Orbital Grid", planId: "starter", mrrCents: 19_00, seats: 5, status: "past_due", failedPayments: 2 },
  { id: "t5", name: "Dawn Machine", planId: "starter", mrrCents: 19_00 + 2 * 5_00, seats: 7, status: "active", failedPayments: 0 },
];

export default function BillingAdminClient() {
  return (
    <AdminShell
      activeKey="billing"
      eyebrow="// billing control"
      title="Billing & revenue"
      description="Operator view of plans, MRR, tax posture, Stripe readiness, and tenant health."
    >
      {() => <BillingAdminBody />}
    </AdminShell>
  );
}

function BillingAdminBody() {
  const readiness = useMemo(() => stripeReadiness(), []);
  const workspaces = useMemo(() => generateWorkspaceRows({ range: "24h" }), []);
  const mrr = useMemo(
    () => DEMO_TENANTS.reduce((a, t) => a + t.mrrCents, 0),
    [],
  );
  const atRisk = DEMO_TENANTS.filter((t) => t.status === "past_due" || t.failedPayments > 0);

  const sampleInvoices: Invoice[] = useMemo(() => {
    const ws = workspaces[0];
    if (!ws) return [];
    const plan = BILLING_PLANS[ws.tier];
    const sub: Subscription = {
      id: "sub_demo_admin",
      workspaceId: ws.id,
      workspaceName: ws.name,
      ownerEmail: ws.ownerEmail,
      planId: ws.tier,
      status: "active",
      seats: ws.members,
      currentPeriodStart: new Date().toISOString().slice(0, 10),
      currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      trialEndsAt: null,
      cancelAt: null,
      failedPaymentCount: 0,
      paymentMethodId: null,
    };
    return [generateInvoice({ subscription: sub, plan, usage: ws.snapshot })];
  }, [workspaces]);

  return (
    <div className="space-y-6">
      <StripeReadinessCard readiness={readiness} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Platform MRR" value={formatMoney(mrr)} hint="simulated tenants" />
        <Metric label="Active tenants" value={String(DEMO_TENANTS.filter((t) => t.status === "active").length)} hint="of 5 demo" />
        <Metric label="At risk" value={String(atRisk.length)} hint="past_due or failures" />
        <Metric label="Tax regions" value="9" hint="Stripe Tax ready" />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
          // plan catalog
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">Sellable plans</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SELLABLE_PLANS.map((id) => {
            const p = BILLING_PLANS[id];
            return (
              <div
                key={id}
                className="rounded-2xl border border-white/10 bg-black/40 p-4"
              >
                <p className="text-sm font-semibold text-white">{p.label}</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  ${p.monthlyPriceUsd}
                  <span className="text-xs font-normal text-white/45">/mo</span>
                </p>
                <p className="mt-2 text-[11px] text-white/55">
                  {p.includedSeats} seats incl. · +${p.seatPriceUsd}/seat
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-6 backdrop-blur-xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
          // tenants
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">Tenant billing health</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.18em] text-white/45">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">MRR</th>
                <th className="px-3 py-2">Seats</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Failures</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {DEMO_TENANTS.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 font-medium text-white">{t.name}</td>
                  <td className="px-3 py-2">{BILLING_TIERS[t.planId].label}</td>
                  <td className="px-3 py-2 font-mono">{formatMoney(t.mrrCents)}</td>
                  <td className="px-3 py-2">{t.seats}</td>
                  <td className="px-3 py-2">{t.status}</td>
                  <td className="px-3 py-2">{t.failedPayments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/50 p-6 backdrop-blur-xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
          // invoice engine sample
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">Generated invoice</h2>
        {sampleInvoices[0] ? (
          <ul className="mt-4 space-y-2 text-sm text-white/75">
            <li>
              <span className="text-white/45">Number:</span>{" "}
              <span className="font-mono text-white">{sampleInvoices[0].number}</span>
            </li>
            <li>
              <span className="text-white/45">Total:</span>{" "}
              <span className="font-mono text-white">
                {formatMoney(sampleInvoices[0].totalCents, sampleInvoices[0].currency)}
              </span>{" "}
              ({sampleInvoices[0].taxRegion})
            </li>
            <li className="text-xs text-white/50">
              Line items: {sampleInvoices[0].lineItems.length} · tax rate{" "}
              {(sampleInvoices[0].taxRate * 100).toFixed(1)}%
            </li>
          </ul>
        ) : null}
      </section>

      <TaxPrepCard />

      <WorkspaceUsageCrosswalk workspaces={workspaces} />
    </div>
  );
}

function StripeReadinessCard({
  readiness,
}: {
  readiness: ReturnType<typeof stripeReadiness>;
}) {
  return (
    <div
      className={`rounded-3xl border p-6 backdrop-blur-xl ${
        readiness.configured
          ? "border-basil-400/35 bg-basil-500/10"
          : "border-amber-400/35 bg-amber-500/10"
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/70">
        // stripe readiness
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">
        {readiness.configured ? "Stripe keys detected" : "Stripe not wired"}
      </h2>
      <p className="mt-2 text-sm text-white/65">
        Secret key, publishable key, and webhook secret must exist on the server
        only. This panel reads presence flags — never values.
      </p>
      <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <li className="text-white/70">
          STRIPE_SECRET_KEY: {readiness.hasSecret ? "set" : "missing"}
        </li>
        <li className="text-white/70">
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: {readiness.hasPublishable ? "set" : "missing"}
        </li>
        <li className="text-white/70">
          STRIPE_WEBHOOK_SECRET: {readiness.hasWebhookSecret ? "set" : "missing"}
        </li>
        <li className="text-white/70">
          STRIPE_TAX_REGISTRATION_ID: {readiness.hasTaxConfigured ? "set" : "optional"}
        </li>
      </ul>
      {!readiness.configured ? (
        <p className="mt-3 text-xs text-amber-200/90">
          Missing: {readiness.missing.join(", ") || "—"}
        </p>
      ) : null}
    </div>
  );
}

function TaxPrepCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
        // tax preparation
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">Tax handling</h2>
      <p className="mt-2 text-sm text-white/60">
        Today: <code className="rounded bg-black/50 px-1 font-mono text-[11px]">taxRateFor(country)</code>{" "}
        in <code className="font-mono text-[11px]">src/lib/billing.ts</code> drives invoice
        tax lines. Production: enable Stripe Tax or wire Avalara — store
        <code className="mx-1 rounded bg-black/50 px-1 font-mono text-[11px]">tax_behavior</code>
        on each Price and let webhooks persist finalized tax amounts to{" "}
        <code className="font-mono text-[11px]">invoices</code>.
      </p>
    </div>
  );
}

function WorkspaceUsageCrosswalk({ workspaces }: { workspaces: WorkspaceUsageRow[] }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
        // usage × billing
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">Workspace quota crosswalk</h2>
      <p className="mt-1 text-xs text-white/55">
        Metered overages on invoices pull from the same quota matrix as Usage
        Metering (Phase 4I).
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <thead className="uppercase tracking-[0.16em] text-white/45">
            <tr>
              <th className="px-3 py-2">Workspace</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Bandwidth</th>
              <th className="px-3 py-2">Requests</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-white/75">
            {workspaces.slice(0, 5).map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2 font-medium text-white">{w.name}</td>
                <td className="px-3 py-2">{BILLING_TIERS[w.tier].label}</td>
                <td className="px-3 py-2 font-mono">
                  {w.snapshot.bandwidth.toFixed(1)} / {w.ratios.find((r) => r.metric === "bandwidth")?.quota ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono">
                  {Math.round(w.snapshot.requests)} / {w.ratios.find((r) => r.metric === "requests")?.quota ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-white/40">{hint}</p> : null}
    </div>
  );
}
