import type { Metadata } from "next";
import BillingClient from "@/src/components/billing/billing-client";

export const metadata: Metadata = {
  title: "Billing · GTLNAV",
  description:
    "Subscriptions, invoices, payment methods, and plan changes — GTLNAV billing foundation (no live charges).",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function BillingPage() {
  return <BillingClient />;
}
