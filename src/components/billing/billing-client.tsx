"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import {
  BILLING_PLANS,
  SELLABLE_PLANS,
  enforceQuota,
  formatMoney,
  generateInvoice,
  nextDunningStep,
  previewPlanChange,
  statusStyle,
  type BillingEvent,
  type BillingPlan,
  type FailedPaymentReason,
  type Invoice,
  type PaymentMethod,
  type Subscription,
  type SubscriptionStatus,
} from "@/src/lib/billing";
import {
  USAGE_METRIC_META,
  computeRatios,
  formatRatio,
  formatUsageValue,
  generateUsageTimeSeries,
  snapshotFromSeries,
  type BillingTierId,
  type UsageMetric,
  type UsageSnapshot,
} from "@/src/lib/usage-meter";
import { CardIcon } from "@/src/components/ui/icons";

type LoadState = "loading" | "ready" | "redirect";

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  owner_id?: string | null;
};

type Toast = { tone: "success" | "error" | "info"; text: string } | null;

const DEMO_WORKSPACE_ID = "ws_demo_billing";

export default function BillingClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<BillingTierId>("pro");
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);

  const flashToast = useCallback((tone: NonNullable<Toast>["tone"], text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const next = data.session ?? null;
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/billing");
        return;
      }
      setSession(next);
      await loadWorkspace(next.user.id, next.user.email ?? null);
      setLoadState("ready");
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (cancelled) return;
        if (!next) {
          setLoadState("redirect");
          router.replace("/login?next=/dashboard/billing");
          return;
        }
        setSession(next);
      },
    );
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  const loadWorkspace = useCallback(async (uid: string, userEmail: string | null) => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, slug, owner_id")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      setWorkspace({
        id: DEMO_WORKSPACE_ID,
        name: "Personal workspace",
        slug: "personal",
        owner_id: uid,
      });
    } else {
      setWorkspace(data as WorkspaceRow);
    }

    const ws = (data as WorkspaceRow | null) ?? {
      id: DEMO_WORKSPACE_ID,
      name: "Personal workspace",
      slug: "personal",
      owner_id: uid,
    };

    const email = userEmail ?? "you@example.com";

    const sub: Subscription = {
      id: `sub_${ws.id.slice(-8)}`,
      workspaceId: ws.id,
      workspaceName: ws.name ?? "Workspace",
      ownerEmail: email,
      planId: "pro",
      status: "active",
      seats: 9,
      currentPeriodStart: isoDaysAgo(12),
      currentPeriodEnd: isoDaysFromNow(18),
      trialEndsAt: null,
      cancelAt: null,
      failedPaymentCount: 0,
      paymentMethodId: "pm_demo",
    };
    setSubscription(sub);
    setPaymentMethod({
      id: "pm_demo",
      workspaceId: ws.id,
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2028,
      isDefault: true,
    });

    const plan = BILLING_PLANS[sub.planId];
    const series = generateUsageTimeSeries({ range: "24h", scale: 1.4 });
    const usage = snapshotFromSeries(series, sub.seats, 4);
    const inv = generateInvoice({ subscription: sub, plan, usage });
    const inv2 = generateInvoice({
      subscription: { ...sub, failedPaymentCount: 0 },
      plan,
      usage,
      issuedAt: isoDaysAgo(32),
    });
    setInvoices([inv, { ...inv2, status: "paid", paidAt: inv2.issuedAt }]);

    setEvents([
      {
        id: "evt_1",
        workspaceId: ws.id,
        type: "subscription.created",
        message: "Subscription created (simulation).",
        level: "ok",
        createdAt: isoDaysAgo(45),
      },
      {
        id: "evt_2",
        workspaceId: ws.id,
        type: "invoice.paid",
        message: `Invoice ${inv2.number} paid.`,
        level: "ok",
        createdAt: isoDaysAgo(32),
      },
      {
        id: "evt_3",
        workspaceId: ws.id,
        type: "payment_method.attached",
        message: "Visa ·4242 attached as default.",
        level: "info",
        createdAt: isoDaysAgo(30),
      },
    ]);
  }, []);

  const plan = subscription ? BILLING_PLANS[subscription.planId] : null;
  const usageSeries = useMemo(
    () => generateUsageTimeSeries({ range: "24h", scale: 1.35 }),
    [subscription?.planId, subscription?.seats],
  );
  const usageSnapshot = useMemo(
    () =>
      snapshotFromSeries(
        usageSeries,
        subscription?.seats ?? 1,
        4,
      ),
    [usageSeries, subscription?.seats],
  );
  const ratios = useMemo(() => {
    if (!plan) return [];
    return computeRatios(usageSnapshot, plan.quotas);
  }, [plan, usageSnapshot]);

  const preview = useMemo(() => {
    if (!subscription) return null;
    return previewPlanChange(subscription, selectedPlan);
  }, [subscription, selectedPlan]);

  const handleSimulateFailedPayment = useCallback(() => {
    if (!subscription) return;
    setBusy(true);
    const reasons: FailedPaymentReason[] = [
      "card_declined",
      "insufficient_funds",
      "expired_card",
    ];
    const reason = reasons[Math.floor(Math.random() * reasons.length)];
    const nextCount = subscription.failedPaymentCount + 1;
    const dunning = nextDunningStep(nextCount);
    setSubscription((s) =>
      s
        ? {
            ...s,
            status: "past_due" as SubscriptionStatus,
            failedPaymentCount: nextCount,
          }
        : s,
    );
    const inv = generateInvoice({
      subscription: {
        ...subscription,
        failedPaymentCount: nextCount,
        status: "past_due",
      },
      plan: BILLING_PLANS[subscription.planId],
      usage: usageSnapshot,
    });
    setInvoices((prev) => [inv, ...prev]);
    setEvents((prev) => [
      {
        id: `evt_${Date.now()}`,
        workspaceId: subscription.workspaceId,
        type: "invoice.payment_failed",
        message: `Payment failed: ${reason} · retry in ${dunning.retryInDays}d`,
        level: "error",
        createdAt: new Date().toISOString(),
        metadata: { reason },
      },
      ...prev,
    ]);
    flashToast("error", "Simulated payment failure — check dunning ladder.");
    setBusy(false);
  }, [subscription, usageSnapshot, flashToast]);

  const handleApplyPlanChange = useCallback(() => {
    if (!subscription || !preview) return;
    setBusy(true);
    const nextPlan = preview.nextPlan;
    setSubscription((s) =>
      s
        ? {
            ...s,
            planId: nextPlan.id,
            status: preview.isUpgrade ? "active" : s.status,
            failedPaymentCount: 0,
          }
        : s,
    );
    const newSub = {
      ...subscription,
      planId: nextPlan.id,
      failedPaymentCount: 0,
    };
    const inv = generateInvoice({
      subscription: newSub,
      plan: nextPlan,
      usage: usageSnapshot,
    });
    setInvoices((prev) => [inv, ...prev]);
    setEvents((prev) => [
      {
        id: `evt_${Date.now()}`,
        workspaceId: subscription.workspaceId,
        type: preview.isUpgrade ? "subscription.upgraded" : "subscription.downgraded",
        message: preview.isUpgrade
          ? `Upgraded to ${nextPlan.label}.`
          : `Downgrade to ${nextPlan.label} scheduled.`,
        level: "ok",
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    flashToast(
      "success",
      preview.isUpgrade
        ? `Now on ${nextPlan.label}.`
        : `Downgrade to ${nextPlan.label} takes effect at period end.`,
    );
    setBusy(false);
  }, [subscription, preview, usageSnapshot, flashToast]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  if (loadState === "loading") {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (loadState === "redirect" || !session || !subscription || !plan) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  const dunning = nextDunningStep(subscription.failedPaymentCount);

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
        <DashboardSidebar activeKey="billing" userEmail={session.user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // billing & subscriptions
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200">
                  <CardIcon className="h-5 w-5" title="Billing" />
                </span>
                Billing
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Plans, invoices, and payment methods — architecture only. No
                real charges are processed; Stripe hooks are documented below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/dashboard/usage"
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                Usage →
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          {subscription.failedPaymentCount > 0 ? (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            >
              <p className="font-medium">Payment issue</p>
              <p className="mt-1 text-xs text-amber-200/85">
                {dunning.attemptsRemaining} automatic retries left · next retry
                in {dunning.retryInDays}d · after {dunning.willCancelAt}d total
                dunning the subscription cancels (simulated).
              </p>
            </div>
          ) : null}

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <SubscriptionCard
              subscription={subscription}
              plan={plan}
              workspace={workspace}
              paymentMethod={paymentMethod}
            />
            <WorkspaceOwnershipCard
              subscription={subscription}
              workspace={workspace}
            />
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-white">Plans</h2>
            <p className="mt-1 text-xs text-white/55">
              Starter, Pro, Business, Enterprise — compare features and included
              seats.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {SELLABLE_PLANS.map((id) => (
                <PlanCard
                  key={id}
                  plan={BILLING_PLANS[id]}
                  current={subscription.planId === id}
                  onSelect={() => setSelectedPlan(id)}
                />
              ))}
            </div>
          </section>

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <PlanComparisonTable currentPlanId={subscription.planId} />
            <UpgradePanel
              preview={preview}
              selectedPlan={selectedPlan}
              busy={busy}
              onApply={() => void handleApplyPlanChange()}
            />
          </section>

          <section className="mt-8 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <UsageVsLimitsCard ratios={ratios} usage={usageSnapshot} plan={plan} />
            <QuotaSimulationCard plan={plan} usage={usageSnapshot} />
          </section>

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <InvoicesCard invoices={invoices} />
            <PaymentMethodCard
              paymentMethod={paymentMethod}
              onSimulateFail={() => void handleSimulateFailedPayment()}
              busy={busy}
            />
          </section>

          <StripeArchitectureCard />

          <DatabaseSetupCard />

          <EventsCard events={events} />
        </main>
      </div>
    </div>
  );
}

function SubscriptionCard({
  subscription,
  plan,
  workspace,
  paymentMethod,
}: {
  subscription: Subscription;
  plan: BillingPlan;
  workspace: WorkspaceRow | null;
  paymentMethod: PaymentMethod | null;
}) {
  const st = statusStyle(subscription.status);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/50 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // current subscription
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">{plan.label}</h3>
          <p className="mt-1 text-sm text-white/55">{plan.blurb}</p>
          <p className="mt-3 text-xs text-white/45">
            Workspace:{" "}
            <span className="font-medium text-white/80">
              {workspace?.name ?? "—"}
            </span>{" "}
            · owner billing
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${st.ring} ${st.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {st.label}
        </span>
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <Info label="Seats" value={`${subscription.seats} / ${plan.includedSeats} included`} />
        <Info
          label="Seat overage"
          value={
            plan.seatPriceUsd > 0
              ? `$${plan.seatPriceUsd}/seat/mo`
              : "—"
          }
        />
        <Info label="Period start" value={subscription.currentPeriodStart} />
        <Info label="Period end" value={subscription.currentPeriodEnd} />
        <Info
          label="Default payment"
          value={
            paymentMethod
              ? `${paymentMethod.brand.toUpperCase()} ·${paymentMethod.last4}`
              : "None on file"
          }
        />
        <Info label="Failed attempts" value={String(subscription.failedPaymentCount)} />
      </dl>
    </div>
  );
}

function WorkspaceOwnershipCard({
  subscription,
  workspace,
}: {
  subscription: Subscription;
  workspace: WorkspaceRow | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/45 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // workspace billing ownership
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Who pays</h3>
      <p className="mt-2 text-sm text-white/55">
        The workspace owner is the billing identity. Team members never see
        card data — only owners and billing admins (future role) can change
        payment methods.
      </p>
      <ul className="mt-4 space-y-2 text-xs text-white/65">
        <li>
          <span className="text-white/40">Workspace ID:</span>{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">
            {workspace?.id ?? subscription.workspaceId}
          </code>
        </li>
        <li>
          <span className="text-white/40">Owner email:</span>{" "}
          {subscription.ownerEmail}
        </li>
        <li>
          <span className="text-white/40">Stripe customer (future):</span>{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">
            cus_········
          </code>
        </li>
      </ul>
      <Link
        href="/dashboard/team"
        className="mt-5 inline-flex rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20"
      >
        Team & access →
      </Link>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  onSelect,
}: {
  plan: BillingPlan;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-all ${
        current
          ? "border-basil-400/50 bg-basil-500/10 shadow-[0_0_40px_-12px_rgba(111,232,154,0.45)]"
          : "border-white/10 bg-white/[0.03] hover:border-basil-400/30 hover:bg-white/[0.05]"
      }`}
    >
      {current ? (
        <span className="absolute right-3 top-3 rounded-full border border-basil-400/40 bg-basil-500/20 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em] text-basil-100">
          Current
        </span>
      ) : null}
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
        {plan.currency}
      </p>
      <h4 className="mt-1 text-lg font-semibold text-white">{plan.label}</h4>
      <p className="mt-2 text-2xl font-bold text-white">
        {plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd}`}
        <span className="text-sm font-normal text-white/45">/mo</span>
      </p>
      <p className="mt-2 text-xs text-white/55">{plan.blurb}</p>
      <ul className="mt-3 space-y-1 text-[11px] text-white/65">
        {plan.highlights.slice(0, 4).map((h) => (
          <li key={h} className="flex gap-1.5">
            <span className="text-basil-300">✓</span>
            {h}
          </li>
        ))}
      </ul>
    </button>
  );
}

function PlanComparisonTable({ currentPlanId }: { currentPlanId: BillingTierId }) {
  const rows: Array<{
    key: string;
    label: string;
    get: (p: BillingPlan) => string | boolean;
  }> = [
    { key: "price", label: "Base price", get: (p) => `$${p.monthlyPriceUsd}/mo` },
    { key: "seats", label: "Included seats", get: (p) => String(p.includedSeats) },
    { key: "seat", label: "Extra seat", get: (p) => `$${p.seatPriceUsd}/mo` },
    { key: "domains", label: "Domains", get: (p) => String(p.quotas.domains) },
    { key: "bw", label: "Bandwidth (GB)", get: (p) => String(p.quotas.bandwidth) },
    { key: "sso", label: "SAML / SSO", get: (p) => p.features.ssoSaml },
    { key: "audit", label: "Audit retention", get: (p) => `${p.features.auditRetentionDays}d` },
    { key: "vps", label: "Dedicated VPS", get: (p) => p.features.dedicatedVps },
  ];
  const plans = SELLABLE_PLANS.map((id) => BILLING_PLANS[id]);
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-xl">
      <div className="border-b border-white/10 px-5 py-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          // compare
        </p>
        <h3 className="mt-1 text-lg font-semibold text-white">Plan comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.18em] text-white/45">
            <tr>
              <th className="px-4 py-3">Feature</th>
              {plans.map((p) => (
                <th
                  key={p.id}
                  className={`px-4 py-3 ${p.id === currentPlanId ? "text-basil-200" : ""}`}
                >
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr key={row.key} className="text-white/80">
                <td className="px-4 py-2.5 font-medium text-white/60">{row.label}</td>
                {plans.map((p) => {
                  const v = row.get(p);
                  return (
                    <td key={p.id} className="px-4 py-2.5">
                      {typeof v === "boolean" ? (v ? "Yes" : "—") : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UpgradePanel({
  preview,
  selectedPlan,
  busy,
  onApply,
}: {
  preview: ReturnType<typeof previewPlanChange> | null;
  selectedPlan: BillingTierId;
  busy: boolean;
  onApply: () => void;
}) {
  if (!preview) return null;
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // change plan
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Upgrade / downgrade</h3>
      <p className="mt-2 text-xs text-white/55">
        {preview.isUpgrade
          ? "Upgrades take effect immediately with a prorated charge (Stripe-shaped)."
          : "Downgrades apply at the end of the current billing period — no mid-cycle refunds in simulation."}
      </p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
        <p className="text-white/70">
          <span className="text-white/45">From</span>{" "}
          <span className="font-semibold text-white">
            {preview.currentPlan.label}
          </span>
        </p>
        <p className="mt-2 text-white/70">
          <span className="text-white/45">To</span>{" "}
          <span className="font-semibold text-basil-200">
            {preview.nextPlan.label}
          </span>
        </p>
        <p className="mt-3 text-xs text-white/55">
          Proration (simulated):{" "}
          <span className="font-mono text-white">
            {formatMoney(preview.prorationCents, preview.nextPlan.currency)}
          </span>
        </p>
        <p className="mt-1 text-xs text-white/45">
          Effective: {preview.effectiveAt.slice(0, 10)}
        </p>
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={busy || selectedPlan === preview.currentPlan.id}
        className="mt-4 w-full rounded-full border border-basil-400/40 bg-basil-500/15 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {selectedPlan === preview.currentPlan.id
          ? "Select a different plan"
          : preview.isUpgrade
            ? "Apply upgrade (sim)"
            : "Schedule downgrade (sim)"}
      </button>
    </div>
  );
}

function UsageVsLimitsCard({
  ratios,
  usage,
  plan,
}: {
  ratios: ReturnType<typeof computeRatios>;
  usage: UsageSnapshot;
  plan: BillingPlan;
}) {
  const top = ratios.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 6);
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // usage vs limits
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Consumption</h3>
      <ul className="mt-4 space-y-3">
        {top.map((r) => {
          const meta = USAGE_METRIC_META[r.metric];
          const pct = Math.min(100, r.ratio * 100);
          return (
            <li key={r.metric}>
              <div className="flex justify-between text-[11px] text-white/65">
                <span>{meta.label}</span>
                <span>
                  {formatUsageValue(r.metric, usage[r.metric] ?? 0)} /{" "}
                  {formatUsageValue(r.metric, plan.quotas[r.metric])} ·{" "}
                  {formatRatio(r.ratio)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${
                    r.ratio >= 1
                      ? "bg-gradient-to-r from-red-400 to-red-500"
                      : r.ratio >= 0.85
                        ? "bg-gradient-to-r from-amber-300 to-amber-500"
                        : "bg-gradient-to-r from-basil-300 to-basil-500"
                  }`}
                  style={{ width: `${Math.max(3, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuotaSimulationCard({
  plan,
  usage,
}: {
  plan: BillingPlan;
  usage: UsageSnapshot;
}) {
  const metric: UsageMetric = "bandwidth";
  const used = usage[metric] ?? 0;
  const quota = plan.quotas[metric];
  const decision = enforceQuota({ metric, used, quota, plan });
  return (
    <div className="rounded-3xl border border-white/10 bg-black/45 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // quota enforcement
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Simulator</h3>
      <p className="mt-2 text-xs text-white/55">
        Preview how GTLNAV would gate{" "}
        <span className="text-white/80">{USAGE_METRIC_META[metric].label}</span>{" "}
        on your current plan.
      </p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
        <p className="text-white/70">
          Used:{" "}
          <span className="font-mono text-white">
            {formatUsageValue(metric, used)}
          </span>
        </p>
        <p className="mt-1 text-white/70">
          Quota:{" "}
          <span className="font-mono text-white">
            {formatUsageValue(metric, quota)}
          </span>
        </p>
        <p className="mt-3 text-xs text-white/55">
          <span className="font-medium text-basil-200">{decision.mode}</span> ·{" "}
          {decision.allowed ? "allowed" : "blocked"} — {decision.reason}
        </p>
      </div>
    </div>
  );
}

function InvoicesCard({ invoices }: { invoices: Invoice[] }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // invoices
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">Invoice engine</h3>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-white/5">
        {invoices.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-mono text-sm text-white">{inv.number}</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                {inv.status} · {inv.taxRegion} tax {(inv.taxRate * 100).toFixed(0)}%
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm text-white">
                {formatMoney(inv.totalCents, inv.currency)}
              </p>
              <p className="text-[10px] text-white/45">{inv.issuedAt.slice(0, 10)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentMethodCard({
  paymentMethod,
  onSimulateFail,
  busy,
}: {
  paymentMethod: PaymentMethod | null;
  onSimulateFail: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/50 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // payment method
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Default card</h3>
      <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-center">
        {paymentMethod ? (
          <>
            <p className="text-sm font-medium text-white">
              {paymentMethod.brand.toUpperCase()} ending in {paymentMethod.last4}
            </p>
            <p className="mt-1 text-xs text-white/45">
              Expires {paymentMethod.expMonth}/{paymentMethod.expYear}
            </p>
          </>
        ) : (
          <p className="text-sm text-white/55">No payment method on file</p>
        )}
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
          Stripe Elements + SetupIntent (future)
        </p>
      </div>
      <button
        type="button"
        onClick={onSimulateFail}
        disabled={busy}
        className="mt-4 w-full rounded-full border border-red-400/35 bg-red-500/10 py-2 text-xs font-medium uppercase tracking-[0.18em] text-red-200 transition-colors hover:border-red-400/55 hover:bg-red-500/20 disabled:opacity-50"
      >
        Simulate failed payment
      </button>
    </div>
  );
}

function StripeArchitectureCard() {
  return (
    <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // stripe architecture
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Integration map</h3>
      <p className="mt-2 max-w-3xl text-sm text-white/55">
        Server routes will own Checkout Sessions, Customer Portal, webhooks
        (`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`),
        and Stripe Tax. The browser only receives publishable keys and client
        secrets scoped to a single session.
      </p>
      <ol className="mt-4 grid gap-3 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-3">
        <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <span className="font-mono text-[10px] text-basil-300/90">POST</span>{" "}
          <code className="text-white/80">/api/billing/checkout</code>
          <p className="mt-1 text-white/50">Creates Stripe Checkout Session</p>
        </li>
        <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <span className="font-mono text-[10px] text-basil-300/90">POST</span>{" "}
          <code className="text-white/80">/api/billing/portal</code>
          <p className="mt-1 text-white/50">Customer billing portal link</p>
        </li>
        <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <span className="font-mono text-[10px] text-basil-300/90">POST</span>{" "}
          <code className="text-white/80">/api/billing/webhook</code>
          <p className="mt-1 text-white/50">Verifies signature, writes billing_events</p>
        </li>
      </ol>
      <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-white/40">
        Env: STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET ·
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY · STRIPE_TAX_REGISTRATION_ID (optional)
      </p>
    </section>
  );
}

function DatabaseSetupCard() {
  const sql = `-- GTLNAV Phase 4E — Billing tables (run in Supabase)
-- Order: payment_methods before subscriptions if using FK to payment_methods.

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stripe_payment_method_id text unique,
  brand text,
  last4 text,
  exp_month smallint,
  exp_year smallint,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan_id text not null check (plan_id in ('free','starter','pro','business','enterprise')),
  status text not null default 'active',
  seats integer not null default 1,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at timestamptz,
  failed_payment_count integer not null default 0,
  default_payment_method_id uuid references public.payment_methods (id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  stripe_invoice_id text unique,
  number text,
  currency text not null default 'USD',
  status text not null default 'draft',
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  tax_rate numeric(6,4),
  tax_region text,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz default now(),
  due_at timestamptz,
  paid_at timestamptz,
  hosted_invoice_url text,
  failure_reason text,
  line_items jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  type text not null,
  message text,
  level text default 'info',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_workspace_idx on public.subscriptions (workspace_id);
create index if not exists invoices_workspace_idx on public.invoices (workspace_id);
create index if not exists billing_events_workspace_idx on public.billing_events (workspace_id);
create index if not exists payment_methods_workspace_idx on public.payment_methods (workspace_id);`;

  return (
    <section className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-500/[0.06] p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-200">
        // database
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">
        subscriptions · invoices · billing_events · payment_methods
      </h3>
      <p className="mt-1 text-sm text-white/55">
        Adjust FK order if your workspace table name differs. Enable RLS with
        policies keyed on workspace membership.
      </p>
      <pre className="mt-4 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-[10px] leading-relaxed text-white/80">
        {sql}
      </pre>
    </section>
  );
}

function EventsCard({ events }: { events: BillingEvent[] }) {
  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-black/60 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // billing events
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Audit trail</h3>
      <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto font-mono text-[11px]">
        {events.map((e) => (
          <li key={e.id} className="border-b border-white/5 pb-2 last:border-b-0">
            <span className="text-white/40">{e.createdAt.slice(0, 19)}</span>{" "}
            <span
              className={
                e.level === "error"
                  ? "text-red-300"
                  : e.level === "warn"
                    ? "text-amber-300"
                    : "text-basil-200"
              }
            >
              [{e.type}]
            </span>{" "}
            <span className="text-white/80">{e.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/40">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white/90">{value}</dd>
    </div>
  );
}

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
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -top-40 right-1/4 h-[36rem] w-[36rem] translate-x-1/2 rounded-full bg-basil-500/12 blur-[120px]" />
      <div className="absolute bottom-0 left-0 h-[28rem] w-[28rem] rounded-full bg-violet-600/10 blur-[100px]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(167,139,250,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/35 to-transparent" />
    </div>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
