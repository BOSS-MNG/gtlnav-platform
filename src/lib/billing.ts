/**
 * GTLNAV — Billing & Subscription System.
 *
 * Foundation only — no real payments are processed. The shapes here are
 * Stripe-shaped on purpose so that swapping the simulator for the real
 * Stripe API is a 1:1 mapping for the UI.
 *
 * Architecture:
 *   - `BILLING_PLANS` extends `usage-meter#BILLING_TIERS` with billing-only
 *     metadata (seat pricing, included seats, currency, feature flags).
 *   - `Subscription`, `Invoice`, `LineItem`, `BillingEvent`, `PaymentMethod`
 *     match Stripe's resource shape closely.
 *   - `generateInvoice` produces a deterministic invoice for the simulator
 *     and the operator demo.
 *   - `taxRateFor(country)` is a simplified table — production should swap
 *     in Stripe Tax or a tax provider (e.g., Avalara, TaxJar).
 *   - Stripe integration is gated on env vars only — none of which are
 *     ever read in the browser. The `stripeReadiness()` helper inspects
 *     env vars on the server and is exported for the admin status card.
 */

import {
  BILLING_TIERS,
  USAGE_METRIC_META,
  type BillingTier,
  type BillingTierId,
  type Quotas,
  type UsageMetric,
  type UsageSnapshot,
} from "@/src/lib/usage-meter";

// ---------------------------------------------------------------------------
//  Plans (billing-facing extension of usage-meter tiers)
// ---------------------------------------------------------------------------

export type Currency = "USD" | "EUR" | "GBP";

export type FeatureMatrix = {
  customDomains: boolean;
  branchPreviews: boolean;
  prPreviews: boolean;
  multiRegion: boolean;
  auditRetentionDays: number;
  ssoSaml: boolean;
  prioritySupport: boolean;
  dedicatedVps: boolean;
  customSla: boolean;
};

export type BillingPlan = BillingTier & {
  /** Strip "Free" from the public sales surface but keep it as a fallback. */
  publiclySellable: boolean;
  /** Currency the plan is invoiced in. */
  currency: Currency;
  /** How many seats are bundled in the base price. */
  includedSeats: number;
  /** Price per additional seat above the bundled count. */
  seatPriceUsd: number;
  /** Whether the plan supports a 14-day trial. */
  trialEligible: boolean;
  /** Length of the trial when eligible. */
  trialDays: number;
  /** Stripe price IDs — set in env or admin DB once Stripe is wired. */
  stripePriceIds?: {
    monthly?: string;
    yearly?: string;
    seat?: string;
  };
  features: FeatureMatrix;
};

const BASE_FEATURES: Record<BillingTierId, FeatureMatrix> = {
  free: {
    customDomains: false,
    branchPreviews: false,
    prPreviews: false,
    multiRegion: false,
    auditRetentionDays: 7,
    ssoSaml: false,
    prioritySupport: false,
    dedicatedVps: false,
    customSla: false,
  },
  starter: {
    customDomains: true,
    branchPreviews: true,
    prPreviews: false,
    multiRegion: false,
    auditRetentionDays: 30,
    ssoSaml: false,
    prioritySupport: false,
    dedicatedVps: false,
    customSla: false,
  },
  pro: {
    customDomains: true,
    branchPreviews: true,
    prPreviews: true,
    multiRegion: true,
    auditRetentionDays: 90,
    ssoSaml: false,
    prioritySupport: false,
    dedicatedVps: false,
    customSla: false,
  },
  business: {
    customDomains: true,
    branchPreviews: true,
    prPreviews: true,
    multiRegion: true,
    auditRetentionDays: 365,
    ssoSaml: true,
    prioritySupport: true,
    dedicatedVps: false,
    customSla: false,
  },
  enterprise: {
    customDomains: true,
    branchPreviews: true,
    prPreviews: true,
    multiRegion: true,
    auditRetentionDays: 1825, // 5y
    ssoSaml: true,
    prioritySupport: true,
    dedicatedVps: true,
    customSla: true,
  },
};

const SEAT_PRICING: Record<BillingTierId, { included: number; perSeat: number }> = {
  free: { included: 1, perSeat: 0 },
  starter: { included: 5, perSeat: 5 },
  pro: { included: 12, perSeat: 9 },
  business: { included: 30, perSeat: 15 },
  enterprise: { included: 250, perSeat: 29 },
};

export const BILLING_PLANS: Record<BillingTierId, BillingPlan> = Object.fromEntries(
  (Object.keys(BILLING_TIERS) as BillingTierId[]).map((id) => {
    const tier = BILLING_TIERS[id];
    const seats = SEAT_PRICING[id];
    return [
      id,
      {
        ...tier,
        publiclySellable: id !== "free",
        currency: "USD" as Currency,
        includedSeats: seats.included,
        seatPriceUsd: seats.perSeat,
        trialEligible: id !== "free" && id !== "enterprise",
        trialDays: 14,
        stripePriceIds: {},
        features: BASE_FEATURES[id],
      },
    ];
  }),
) as Record<BillingTierId, BillingPlan>;

export const SELLABLE_PLANS: BillingTierId[] = (
  Object.keys(BILLING_PLANS) as BillingTierId[]
).filter((id) => BILLING_PLANS[id].publiclySellable);

export function planById(id: BillingTierId): BillingPlan {
  return BILLING_PLANS[id];
}

// ---------------------------------------------------------------------------
//  Subscription state machine
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "paused";

export type Subscription = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  planId: BillingTierId;
  status: SubscriptionStatus;
  seats: number;
  /** YYYY-MM-DD, marks when the current billing period started. */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Set when status === "trialing". */
  trialEndsAt: string | null;
  /** Set when status === "canceled" or scheduled for cancel. */
  cancelAt: string | null;
  /** Last invoice failure count — drives the dunning panel. */
  failedPaymentCount: number;
  paymentMethodId: string | null;
  /** Stripe customer + subscription ids — wired when Stripe is enabled. */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

const STATUS_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "canceled", "paused"],
  active: ["past_due", "canceled", "paused"],
  past_due: ["active", "canceled"],
  canceled: ["active"],
  incomplete: ["active", "canceled"],
  paused: ["active", "canceled"],
};

export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusStyle(status: SubscriptionStatus): {
  label: string;
  ring: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case "active":
      return {
        label: "Active",
        ring: "border-basil-400/40 bg-basil-500/10",
        text: "text-basil-100",
        dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]",
      };
    case "trialing":
      return {
        label: "Trialing",
        ring: "border-cyan-400/35 bg-cyan-500/10",
        text: "text-cyan-100",
        dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)]",
      };
    case "past_due":
      return {
        label: "Past due",
        ring: "border-amber-400/40 bg-amber-500/15",
        text: "text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)]",
      };
    case "incomplete":
      return {
        label: "Incomplete",
        ring: "border-violet-400/40 bg-violet-500/10",
        text: "text-violet-200",
        dot: "bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.95)]",
      };
    case "canceled":
      return {
        label: "Canceled",
        ring: "border-red-400/40 bg-red-500/15",
        text: "text-red-200",
        dot: "bg-red-300 shadow-[0_0_10px_rgba(248,113,113,1)]",
      };
    case "paused":
      return {
        label: "Paused",
        ring: "border-white/15 bg-white/[0.04]",
        text: "text-white/65",
        dot: "bg-white/45",
      };
    default:
      return {
        label: status,
        ring: "border-white/10 bg-white/[0.03]",
        text: "text-white/60",
        dot: "bg-white/40",
      };
  }
}

// ---------------------------------------------------------------------------
//  Invoice engine
// ---------------------------------------------------------------------------

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
  totalCents: number;
  metric?: UsageMetric;
  /** If true, indicates this line is metered usage (vs. recurring). */
  metered: boolean;
};

export type Invoice = {
  id: string;
  number: string;
  subscriptionId: string;
  workspaceId: string;
  workspaceName: string;
  planId: BillingTierId;
  currency: Currency;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  paidAt: string | null;
  dueAt: string;
  status: InvoiceStatus;
  lineItems: LineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Tax rate applied (0..1). */
  taxRate: number;
  taxRegion: string;
  hostedInvoiceUrl?: string; // Stripe-hosted, populated once Stripe is on
  failureReason?: string;
};

export type GenerateInvoiceArgs = {
  subscription: Subscription;
  plan: BillingPlan;
  /** Snapshot of consumption metrics — drives metered line items. */
  usage?: UsageSnapshot;
  /** Country code (ISO 3166-1 alpha-2) for tax computation. */
  country?: string;
  /** Optional override for the invoice issue date. */
  issuedAt?: string;
};

const METERED_RATE_CENTS: Partial<Record<UsageMetric, number>> = {
  bandwidth: 8, // ¢ / GB
  build_minutes: 4, // ¢ / minute
  edge_usage: 12, // ¢ / GB
  api_requests: 0.012, // ¢ / call (small)
};

export function generateInvoice(args: GenerateInvoiceArgs): Invoice {
  const { subscription, plan, usage, country = "US", issuedAt } = args;
  const issued = issuedAt ?? new Date().toISOString();
  const due = new Date(new Date(issued).getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString();

  const lineItems: LineItem[] = [];

  // Recurring base price (skipped for free plans).
  if (plan.monthlyPriceUsd > 0) {
    lineItems.push({
      id: lineId("base", subscription.id, issued),
      description: `${plan.label} plan · monthly base`,
      quantity: 1,
      unitAmountCents: plan.monthlyPriceUsd * 100,
      totalCents: plan.monthlyPriceUsd * 100,
      metered: false,
    });
  }

  // Seat overage — additional seats above plan.includedSeats.
  const overSeats = Math.max(0, subscription.seats - plan.includedSeats);
  if (overSeats > 0 && plan.seatPriceUsd > 0) {
    lineItems.push({
      id: lineId("seats", subscription.id, issued),
      description: `${overSeats} additional seats × $${plan.seatPriceUsd}`,
      quantity: overSeats,
      unitAmountCents: plan.seatPriceUsd * 100,
      totalCents: overSeats * plan.seatPriceUsd * 100,
      metered: false,
    });
  }

  // Metered overages — per-metric line items above the plan quotas.
  if (usage) {
    for (const metric of Object.keys(METERED_RATE_CENTS) as UsageMetric[]) {
      const used = usage[metric] ?? 0;
      const quota = plan.quotas[metric] ?? 0;
      const over = Math.max(0, used - quota);
      if (over <= 0) continue;
      const rate = METERED_RATE_CENTS[metric] ?? 0;
      const cents = Math.round(over * rate);
      if (cents <= 0) continue;
      lineItems.push({
        id: lineId(metric, subscription.id, issued),
        description: `${USAGE_METRIC_META[metric].label} overage · ${over.toFixed(2)} ${USAGE_METRIC_META[metric].unit}`,
        quantity: Math.round(over),
        unitAmountCents: rate,
        totalCents: cents,
        metric,
        metered: true,
      });
    }
  }

  const subtotal = lineItems.reduce((acc, li) => acc + li.totalCents, 0);
  const { rate, region } = taxRateFor(country);
  const tax = Math.round(subtotal * rate);
  const total = subtotal + tax;

  const status: InvoiceStatus =
    subscription.failedPaymentCount > 0
      ? "open"
      : subscription.status === "canceled"
        ? "void"
        : "paid";
  const paidAt = status === "paid" ? issued : null;

  return {
    id: `inv_${cryptoRandomLike()}`,
    number: invoiceNumber(subscription.workspaceId, issued),
    subscriptionId: subscription.id,
    workspaceId: subscription.workspaceId,
    workspaceName: subscription.workspaceName,
    planId: plan.id,
    currency: plan.currency,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    issuedAt: issued,
    paidAt,
    dueAt: due,
    status,
    lineItems,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: total,
    taxRate: rate,
    taxRegion: region,
    failureReason:
      subscription.failedPaymentCount > 0
        ? "Card declined: insufficient_funds (simulated)"
        : undefined,
  };
}

// ---------------------------------------------------------------------------
//  Tax handling
// ---------------------------------------------------------------------------

const TAX_TABLE: Array<{ countries: string[]; rate: number; region: string }> = [
  { countries: ["DE", "FR", "ES", "IT", "NL", "BE", "AT", "PT", "IE"], rate: 0.21, region: "EU VAT" },
  { countries: ["GB"], rate: 0.2, region: "UK VAT" },
  { countries: ["NO"], rate: 0.25, region: "NO MVA" },
  { countries: ["CH"], rate: 0.077, region: "CH VAT" },
  { countries: ["CA"], rate: 0.13, region: "CA HST/GST" },
  { countries: ["AU"], rate: 0.1, region: "AU GST" },
  { countries: ["BR"], rate: 0.17, region: "BR ICMS" },
  { countries: ["JP"], rate: 0.1, region: "JP CT" },
  { countries: ["IN"], rate: 0.18, region: "IN GST" },
];

export function taxRateFor(country: string): { rate: number; region: string } {
  const code = country.toUpperCase();
  for (const row of TAX_TABLE) {
    if (row.countries.includes(code)) return { rate: row.rate, region: row.region };
  }
  if (code === "US") return { rate: 0, region: "US (varies by state)" };
  return { rate: 0, region: "ROW · no tax" };
}

export function applyTax(
  subtotalCents: number,
  rate: number,
): { taxCents: number; totalCents: number } {
  const tax = Math.round(subtotalCents * rate);
  return { taxCents: tax, totalCents: subtotalCents + tax };
}

// ---------------------------------------------------------------------------
//  Payment methods
// ---------------------------------------------------------------------------

export type PaymentBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "sepa_debit"
  | "us_bank";

export type PaymentMethod = {
  id: string;
  workspaceId: string;
  brand: PaymentBrand;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  /** Stripe payment method id once wired. */
  stripePaymentMethodId?: string;
};

// ---------------------------------------------------------------------------
//  Billing events
// ---------------------------------------------------------------------------

export type BillingEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.upgraded"
  | "subscription.downgraded"
  | "subscription.trial_started"
  | "subscription.trial_ended"
  | "invoice.created"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "invoice.uncollectible"
  | "payment_method.attached"
  | "payment_method.detached"
  | "quota.exceeded";

export type BillingEvent = {
  id: string;
  workspaceId: string;
  type: BillingEventType;
  message: string;
  level: "info" | "warn" | "error" | "ok";
  createdAt: string;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
//  Upgrade / downgrade flow
// ---------------------------------------------------------------------------

export type UpgradePreview = {
  currentPlan: BillingPlan;
  nextPlan: BillingPlan;
  /**
   * Prorated charge for upgrading mid-period (Stripe-shaped). Negative when
   * downgrading — the credit lands on the next invoice.
   */
  prorationCents: number;
  /** When the new plan takes effect — immediate for upgrade, period end for downgrade. */
  effectiveAt: string;
  isUpgrade: boolean;
};

export function previewPlanChange(
  subscription: Subscription,
  next: BillingTierId,
  now: Date = new Date(),
): UpgradePreview {
  const current = BILLING_PLANS[subscription.planId];
  const target = BILLING_PLANS[next];
  const isUpgrade = target.monthlyPriceUsd > current.monthlyPriceUsd;
  const periodEnd = new Date(subscription.currentPeriodEnd);
  const periodStart = new Date(subscription.currentPeriodStart);
  const totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
  const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
  const remainingRatio = remainingMs / totalMs;

  // Credit unused portion of current plan, charge prorated portion of new.
  const credit =
    Math.round(current.monthlyPriceUsd * 100 * remainingRatio) * -1;
  const charge = Math.round(target.monthlyPriceUsd * 100 * remainingRatio);
  const proration = isUpgrade ? charge + credit : 0; // downgrade applies at period end
  const effectiveAt = isUpgrade ? now.toISOString() : periodEnd.toISOString();

  return {
    currentPlan: current,
    nextPlan: target,
    prorationCents: proration,
    effectiveAt,
    isUpgrade,
  };
}

// ---------------------------------------------------------------------------
//  Quota enforcement simulation
// ---------------------------------------------------------------------------

export type QuotaEnforcementMode = "soft" | "hard";

export type QuotaEnforcementDecision = {
  allowed: boolean;
  mode: QuotaEnforcementMode;
  reason: string;
};

/**
 * Simulator-only enforcement gate. Real enforcement will live in the runtime
 * engine (deployments) and the edge layer (bandwidth/requests). This helper
 * is the single place the UI consults when previewing what an enforcement
 * outcome would look like.
 */
export function enforceQuota(args: {
  metric: UsageMetric;
  used: number;
  quota: number;
  plan: BillingPlan;
}): QuotaEnforcementDecision {
  const { metric, used, quota, plan } = args;
  const overRatio = quota > 0 ? used / quota : 0;
  // Free plans hard-stop at the quota — paid plans soft-cap and meter.
  if (plan.id === "free") {
    if (overRatio >= 1) {
      return {
        allowed: false,
        mode: "hard",
        reason: `${USAGE_METRIC_META[metric].label} quota exhausted on Free.`,
      };
    }
    return { allowed: true, mode: "hard", reason: "within quota" };
  }
  if (overRatio < 1) {
    return { allowed: true, mode: "soft", reason: "within quota" };
  }
  return {
    allowed: true,
    mode: "soft",
    reason: `over quota — metered at $${(METERED_RATE_CENTS[metric] ?? 0) / 100} per unit`,
  };
}

// ---------------------------------------------------------------------------
//  Stripe integration architecture (server-only readiness probe)
// ---------------------------------------------------------------------------

export type StripeReadiness = {
  configured: boolean;
  hasSecret: boolean;
  hasPublishable: boolean;
  hasWebhookSecret: boolean;
  hasTaxConfigured: boolean;
  missing: string[];
};

/**
 * Pure-function probe — safe to call on the server. Never resolves to actual
 * env values; returns booleans only. Browser bundles never see this because
 * it inspects `process.env` which Next.js strips client-side except for the
 * `NEXT_PUBLIC_*` variant we deliberately allow.
 */
export function stripeReadiness(): StripeReadiness {
  // Server-side env presence
  const hasSecret = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasWebhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const hasTaxConfigured = Boolean(process.env.STRIPE_TAX_REGISTRATION_ID);
  // Publishable key is intentionally exposed via NEXT_PUBLIC_*
  const hasPublishable = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

  const missing: string[] = [];
  if (!hasSecret) missing.push("STRIPE_SECRET_KEY");
  if (!hasPublishable) missing.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (!hasWebhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");

  return {
    configured: hasSecret && hasPublishable && hasWebhookSecret,
    hasSecret,
    hasPublishable,
    hasWebhookSecret,
    hasTaxConfigured,
    missing,
  };
}

// ---------------------------------------------------------------------------
//  Failed payment + dunning simulation
// ---------------------------------------------------------------------------

export type FailedPaymentReason =
  | "card_declined"
  | "insufficient_funds"
  | "expired_card"
  | "incorrect_cvc"
  | "processing_error"
  | "fraud_suspect";

export const FAILED_PAYMENT_LABELS: Record<FailedPaymentReason, string> = {
  card_declined: "Card declined by issuer",
  insufficient_funds: "Insufficient funds",
  expired_card: "Card expired",
  incorrect_cvc: "Incorrect CVC",
  processing_error: "Processing error",
  fraud_suspect: "Flagged by fraud detection",
};

export function nextDunningStep(failedCount: number): {
  attemptsRemaining: number;
  retryInDays: number;
  willCancelAt: number;
} {
  // 4-attempt dunning ladder: 1d, 3d, 7d, then cancel.
  const ladder = [1, 3, 7];
  const idx = Math.min(failedCount - 1, ladder.length);
  const retryInDays = idx < ladder.length ? ladder[idx] : 0;
  return {
    attemptsRemaining: Math.max(0, ladder.length - failedCount),
    retryInDays,
    willCancelAt: ladder.reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
//  Money formatting
// ---------------------------------------------------------------------------

export function formatMoney(cents: number, currency: Currency = "USD"): string {
  const amount = cents / 100;
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  if (Math.abs(amount) >= 1000) {
    return `${amount < 0 ? "-" : ""}${symbol}${Math.abs(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }
  return `${amount < 0 ? "-" : ""}${symbol}${Math.abs(amount).toFixed(2)}`;
}

export function quotasFromPlan(plan: BillingPlan): Quotas {
  return plan.quotas;
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

function cryptoRandomLike(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function lineId(prefix: string, subId: string, isoDate: string): string {
  return `il_${prefix}_${subId.slice(-6)}_${isoDate.slice(0, 10).replace(/-/g, "")}`;
}

function invoiceNumber(workspaceId: string, isoDate: string): string {
  const date = isoDate.slice(0, 10).replace(/-/g, "");
  return `INV-${date}-${workspaceId.slice(-4).toUpperCase()}`;
}
