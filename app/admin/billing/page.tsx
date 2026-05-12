import type { Metadata } from "next";
import BillingAdminClient from "@/src/components/billing/billing-admin-client";

export const metadata: Metadata = {
  title: "Billing · GTLNAV operator",
  description:
    "Operator billing console — Stripe readiness, tenant MRR, tax prep, and invoice engine samples.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminBillingPage() {
  return <BillingAdminClient />;
}
